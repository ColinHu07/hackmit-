import type { PlaySnapshot, PetActionKind, ServerMessage } from '../../shared/play-protocol';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';
export interface Membership { roomCode: string; playerId: string; playerToken: string; name: string }
interface Callbacks {
  state: (state: ConnectionState) => void;
  snapshot: (snapshot: PlaySnapshot, membership: Membership) => void;
  error: (message: string, terminal?: boolean) => void;
}
type Entry = { type: 'create'; name: string } | { type: 'join'; name: string; roomCode: string; playerToken?: string };

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
  private accountToken: string | null = null;

  constructor(private readonly callbacks: Callbacks) {}

  setAccountToken(token: string): void { this.accountToken = token; }

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
      if (!this.membership) this.fail('The server did not respond. Check its address in Server settings.');
      else socket.close();
    }, 10_000);

    socket.onopen = () => {
      if (socket !== this.socket || this.stopped) return;
      const entry = this.membership
        ? { type: 'join', roomCode: this.membership.roomCode, playerToken: this.membership.playerToken, name: this.membership.name }
        : this.entry;
      socket.send(JSON.stringify(this.accountToken ? { ...entry, accountToken: this.accountToken } : entry));
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      if (socket !== this.socket || this.stopped) return;
      let message: ServerMessage;
      try { message = JSON.parse(event.data) as ServerMessage; }
      catch { this.fail('The server sent an unreadable response.'); return; }
      if (message.type === 'error') {
        if (!this.connected) this.fail(message.message);
        else this.callbacks.error(message.message);
        return;
      }
      if (message.type === 'welcome') {
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
        this.callbacks.snapshot(message.snapshot, this.membership);
      } else if (message.type === 'snapshot' && this.membership && this.connected) {
        this.lastSnapshotTime = performance.now();
        this.callbacks.snapshot(message.snapshot, this.membership);
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
      if (!this.membership) {
        this.fail('Could not connect. Start the multiplayer server, then check Server settings.');
        return;
      }
      if (++this.attempts > 8) {
        this.fail('Connection lost. Return home and rejoin the playground.');
        return;
      }
      this.callbacks.state('reconnecting');
      this.retry = setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** (this.attempts - 1)));
    };
  }

  move(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z) || performance.now() - this.lastMove < 60) return;
    this.lastMove = performance.now();
    this.send({ type: 'move', x, z });
  }
  action(action: PetActionKind): void { this.send({ type: 'action', action }); }
  confirmDap(): void { this.send({ type: 'confirm_dap' }); }
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
