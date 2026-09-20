import type { PlaySnapshot, PetActionKind, ServerMessage } from '../../shared/play-protocol';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';
export interface Membership { roomCode: string; playerId: string; playerToken: string; name: string }
export type CompatibleSnapshot = PlaySnapshot & { legacyServer?: true };
/** Older team servers omit quest objects. Preserve their world without inventing rewards. */
export function compatibleSnapshot(snapshot: PlaySnapshot): CompatibleSnapshot {
  if (snapshot.quests && snapshot.squad && snapshot.raid && snapshot.dap) return snapshot;
  return {
    ...snapshot, legacyServer: true, quests: {}, squad: { ready: [], minPlayers: 3 }, dap: { pending: [] },
    raid: { state: 'waiting', ready: [], participants: [], minPlayers: 3, health: 0, maxHealth: 0, endsAt: null },
  };
}
interface Callbacks {
  state: (state: ConnectionState) => void;
  snapshot: (snapshot: CompatibleSnapshot, membership: Membership) => void;
  error: (message: string, terminal?: boolean) => void;
}
interface ConnectionOptions {
  /** Display apps should recover a temporarily unavailable tunnel on first entry. */
  retryInitialConnection?: boolean;
}
type Entry = { type: 'lobby'; name: string; playerToken?: string } | { type: 'create'; name: string } | { type: 'join'; name: string; roomCode: string; playerToken?: string };

export function normalizeServerUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Enter a ws:// or wss:// server address without credentials or a fragment.');
  }
  if (window.location.protocol === 'https:' && url.protocol !== 'wss:') {
    throw new Error('This page uses HTTPS. Your multiplayer server needs a wss:// address.');
  }
  return url.href;
}

/** Transport only. The server owns movement, membership, and shared rewards. */
export class RoomClient {
  private socket: WebSocket | null = null;
  private membership: Membership | null = null;
  private entry: Entry | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private stopped = true;
  private connected = false;
  private url = '';
  private lastMove = 0;
  private lastSnapshotTime = 0;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private legacyServer = false;

  constructor(private readonly callbacks: Callbacks, private readonly options: ConnectionOptions = {}) {}

  start(serverUrl: string, entry: Entry): void {
    const url = normalizeServerUrl(serverUrl);
    this.stop();
    this.url = url;
    this.entry = entry;
    this.stopped = false;
    this.attempts = 0;
    this.connect();
  }

  private connect(): void {
    if (this.stopped || !this.entry) return;
    this.connected = false;
    this.callbacks.state(this.membership ? 'reconnecting' : 'connecting');
    let socket: WebSocket;
    try { socket = new WebSocket(this.url); }
    catch { this.fail('Could not open that server address. Check Server settings.'); return; }
    this.socket = socket;
    this.timeout = setTimeout(() => {
      if (socket !== this.socket) return;
      this.retryConnection('The server did not respond. Check its address in Server settings.');
    }, 10_000);

    socket.onopen = () => {
      if (socket !== this.socket || this.stopped) return;
      const entry = this.membership
        ? this.entry?.type === 'lobby'
          ? { type: 'lobby', playerToken: this.membership.playerToken, name: this.membership.name }
          : { type: 'join', roomCode: this.membership.roomCode, playerToken: this.membership.playerToken, name: this.membership.name }
        : this.entry;
      socket.send(JSON.stringify(entry));
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      if (socket !== this.socket || this.stopped) return;
      let message: ServerMessage;
      try { message = JSON.parse(event.data) as ServerMessage; }
      catch { this.fail('The server sent an unreadable response.'); return; }
      if (message.type === 'error') {
        if (!this.connected && this.entry?.type === 'lobby') {
          if (message.code === 'invalid_token' && (this.membership || this.entry.playerToken)) {
            this.membership = null;
            this.entry = { type: 'lobby', name: this.entry.name };
            socket.send(JSON.stringify(this.entry));
            return;
          }
          if (message.code === 'invalid_message') {
            this.fail('This server needs an update for automatic joining. Ask the host to update and restart the Bondimals server.');
            return;
          }
        }
        if (!this.connected) this.fail(message.message);
        else this.callbacks.error(message.message);
        return;
      }
      if (message.type === 'welcome') {
        const snapshot = compatibleSnapshot(message.snapshot);
        this.legacyServer = !!snapshot.legacyServer;
        clearTimeout(this.timeout);
        this.membership = {
          roomCode: message.roomCode, playerId: message.playerId,
          playerToken: message.playerToken, name: this.entry!.name,
        };
        this.connected = true;
        this.attempts = 0;
        this.callbacks.state('connected');
        this.lastSnapshotTime = performance.now();
        clearInterval(this.watchdog);
        this.watchdog = setInterval(() => {
          if (performance.now() - this.lastSnapshotTime > 8000) socket.close();
        }, 2000);
        this.callbacks.snapshot(snapshot, this.membership);
      } else if (message.type === 'snapshot' && this.membership && this.connected) {
        this.lastSnapshotTime = performance.now();
        const snapshot = compatibleSnapshot(message.snapshot);
        this.legacyServer = !!snapshot.legacyServer;
        this.callbacks.snapshot(snapshot, this.membership);
      }
    };
    socket.onerror = () => { /* onclose owns error/retry so there is only one path. */ };
    socket.onclose = (event: CloseEvent) => {
      if (socket !== this.socket || this.stopped) return;
      clearTimeout(this.timeout);
      clearInterval(this.watchdog);
      this.connected = false;
      if (event.code === 4001) {
        this.fail('This pet continued in another tab. Return home to join as a different player.');
        return;
      }
      this.retryConnection(this.membership
        ? 'Connection lost. Return home and rejoin the playground.'
        : 'Could not connect. Start the multiplayer server, then check Server settings.');
    };
  }

  private retryConnection(message: string): void {
    if (!this.membership && !this.options.retryInitialConnection || ++this.attempts > 8) {
      this.fail(message);
      return;
    }
    clearTimeout(this.timeout);
    clearTimeout(this.retry);
    clearInterval(this.watchdog);
    this.connected = false;
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    this.callbacks.state('reconnecting');
    this.retry = setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** (this.attempts - 1)));
  }

  steps(count: number, yaw: number): void { if (!this.legacyServer) this.send({ type: 'steps', count, yaw }); }
  location(fix: { latitude: number; longitude: number; accuracy: number; timestamp: number }): void {
    if (!this.legacyServer) this.send({ type: 'location', ...fix });
  }
  move(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z) || performance.now() - this.lastMove < 60) return;
    this.lastMove = performance.now();
    this.send({ type: 'move', x, z });
  }
  /** Explicit lock keeps head-facing direction while walking; omission preserves phone behavior. */
  heading(yaw: number, lock?: boolean): void {
    if (!this.legacyServer && Number.isFinite(yaw)) this.send({ type: 'heading', yaw, ...(lock === undefined ? {} : { lock }) });
  }
  action(action: PetActionKind): void { if (action !== 'dap' || !this.legacyServer) this.send({ type: 'action', action }); }
  confirmDap(): void { this.send({ type: 'confirm_dap' }); }
  readySquadQuest(): void { if (!this.legacyServer) this.send({ type: 'ready_squad_quest' }); }
  readyRaid(): void { if (!this.legacyServer) this.send({ type: 'ready_raid' }); }
  private send(message: object): void {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  private fail(message: string): void {
    this.stop(false);
    this.callbacks.state('offline');
    this.callbacks.error(message, true);
  }
  stop(sendLeave = true): void {
    if (sendLeave) this.send({ type: 'leave' });
    this.stopped = true;
    this.connected = false;
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    clearInterval(this.watchdog);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.membership = null;
    this.entry = null;
    this.callbacks.state('idle');
  }
}
