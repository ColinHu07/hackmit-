import { normalizeServerUrl } from './RoomClient';
import type { LocationFix } from './LocationDiscovery';
import { NEARBY_LOCATION_FRESH_MS } from '../../shared/nearby-protocol';
import type { NearbyPet, MeetRequest } from '../../shared/nearby-protocol';

export type { NearbyPet, MeetRequest } from '../../shared/nearby-protocol';
export type NearbyConnectionState = 'idle' | 'connecting' | 'connected' | 'offline';
interface Callbacks {
  state: (state: NearbyConnectionState) => void;
  ready: (id: string) => void;
  nearby: (peers: NearbyPet[], accuracy: number | null, notice: string) => void;
  incoming: (request: MeetRequest) => void;
  outgoing: (request: MeetRequest) => void;
  closed: (requestId: string, reason: string) => void;
  matched: (roomCode: string, playerToken: string) => void;
  error: (message: string) => void;
}

/** /play and /ws are sibling routes of /nearby, including behind a hosting prefix. */
export function nearbyServerUrl(serverUrl: string): string {
  const url = new URL(normalizeServerUrl(serverUrl));
  const base = url.pathname.replace(/\/+$/, '').replace(/\/(play|ws|nearby)$/, '');
  url.pathname = `${base}/nearby`;
  return url.href;
}

function validFix(fix: LocationFix): boolean {
  const age = Date.now() - fix.timestamp;
  return [fix.latitude, fix.longitude, fix.accuracy, fix.timestamp].every(Number.isFinite)
    && Math.abs(fix.latitude) <= 90 && Math.abs(fix.longitude) <= 180 && fix.accuracy >= 0
    && age >= -5000 && age <= NEARBY_LOCATION_FRESH_MS;
}
function validRequest(value: Record<string, unknown>): value is Record<string, unknown> & MeetRequest {
  return typeof value.requestId === 'string' && typeof value.peerId === 'string'
    && typeof value.name === 'string' && typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt);
}
function validPet(value: unknown): value is NearbyPet {
  if (!value || typeof value !== 'object') return false;
  const pet = value as Record<string, unknown>;
  return typeof pet.id === 'string' && typeof pet.name === 'string'
    && typeof pet.distanceMeters === 'number' && Number.isFinite(pet.distanceMeters)
    && pet.distanceMeters >= 0 && typeof pet.uncertain === 'boolean';
}

/** Discovery deliberately never reconnects or restores location sharing on its own. */
export class NearbyClient {
  private socket: WebSocket | null = null;
  private connected = false;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private locationTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingFix: LocationFix | null = null;
  private lastLocationAt = -Infinity;
  private lastMessageAt = 0;

  constructor(private readonly callbacks: Callbacks) {}

  start(serverUrl: string, name: string): void {
    const url = nearbyServerUrl(serverUrl);
    this.stop();
    this.callbacks.state('connecting');
    let socket: WebSocket;
    try { socket = new WebSocket(url); }
    catch { this.fail('Could not connect to nearby pets. Check Server settings.'); return; }
    this.socket = socket;
    this.handshake = setTimeout(() => {
      if (this.socket === socket) this.fail('The nearby server did not respond. Tap Resume nearby to try again.');
    }, 10_000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      try { socket.send(JSON.stringify({ type: 'discover', name })); }
      catch { this.fail('Connection lost. Tap Resume nearby to reconnect.'); }
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      if (this.socket !== socket) return;
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        message = parsed as Record<string, unknown>;
      } catch { this.fail('The nearby server sent an unreadable response.'); return; }
      this.lastMessageAt = performance.now();
      if (message.type === 'error' && typeof message.message === 'string') {
        if (!this.connected) this.fail(message.message);
        else this.callbacks.error(message.message);
      } else if (message.type === 'discovery_ready' && typeof message.selfId === 'string' && !this.connected) {
        clearTimeout(this.handshake);
        this.connected = true;
        this.watchdog = setInterval(() => {
          if (this.socket === socket && performance.now() - this.lastMessageAt >= 30_000) {
            this.fail('Connection lost. Location sharing stopped. Tap Resume nearby to reconnect.');
          }
        }, 5000);
        this.callbacks.state('connected');
        this.callbacks.ready(message.selfId);
        this.flushLocation();
      } else if (!this.connected) {
        return;
      } else if (message.type === 'nearby' && Array.isArray(message.peers) && message.peers.every(validPet)
        && (message.accuracy === null || (typeof message.accuracy === 'number' && Number.isFinite(message.accuracy) && message.accuracy >= 0))
        && typeof message.notice === 'string') {
        this.callbacks.nearby(message.peers, message.accuracy, message.notice);
      } else if (message.type === 'meet_request' && validRequest(message)) {
        this.callbacks.incoming(message);
      } else if (message.type === 'meet_sent' && validRequest(message)) {
        this.callbacks.outgoing(message);
      } else if (message.type === 'request_closed' && typeof message.requestId === 'string' && typeof message.reason === 'string') {
        this.callbacks.closed(message.requestId, message.reason);
      } else if (message.type === 'matched' && typeof message.roomCode === 'string' && typeof message.playerToken === 'string') {
        this.stop();
        this.callbacks.matched(message.roomCode, message.playerToken);
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) this.fail('Could not connect to nearby pets. Tap Resume nearby to try again.');
    };
    socket.onclose = () => {
      if (this.socket === socket) this.fail('Connection lost. Location sharing stopped. Tap Resume nearby to reconnect.');
    };
  }

  location(fix: LocationFix): void {
    if (!this.socket || !validFix(fix)) return;
    if (this.pendingFix && this.pendingFix.timestamp > fix.timestamp) return;
    this.pendingFix = { ...fix };
    this.flushLocation();
  }

  private flushLocation(): void {
    if (!this.connected || !this.pendingFix || this.locationTimer !== undefined) return;
    const remaining = 1000 - (performance.now() - this.lastLocationAt);
    if (remaining > 0) {
      this.locationTimer = setTimeout(() => {
        this.locationTimer = undefined;
        this.flushLocation();
      }, remaining);
      return;
    }
    const fix = this.pendingFix;
    this.pendingFix = null;
    if (!validFix(fix)) return;
    if (this.send({ type: 'location', ...fix })) this.lastLocationAt = performance.now();
  }

  pause(): void {
    this.clearLocation();
    this.send({ type: 'pause' });
  }
  meet(peerId: string): void { this.send({ type: 'meet', peerId }); }
  respond(requestId: string, accept: boolean): void { this.send({ type: 'respond', requestId, accept }); }

  private send(message: object): boolean {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    try { this.socket.send(JSON.stringify(message)); return true; }
    catch { this.fail('Connection lost. Location sharing stopped. Tap Resume nearby to reconnect.'); return false; }
  }
  private clearLocation(): void {
    this.pendingFix = null;
    clearTimeout(this.locationTimer);
    this.locationTimer = undefined;
  }
  private fail(message: string): void {
    this.stop();
    this.callbacks.state('offline');
    this.callbacks.error(message);
  }
  stop(): void {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.clearLocation();
    clearTimeout(this.handshake);
    clearInterval(this.watchdog);
    this.handshake = undefined;
    this.watchdog = undefined;
    this.lastLocationAt = -Infinity;
    socket?.close();
    this.callbacks.state('idle');
  }
}
