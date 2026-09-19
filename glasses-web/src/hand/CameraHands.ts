import { validHandFrame, type HandFrame } from '../../../shared/hand-protocol.mjs';
export type { HandFrame };
export interface Pairing { relay: string; room: string; token: string }
export function parsePairing(fragment: string, securePage = location.protocol === 'https:'): Pairing | null {
  const query = new URLSearchParams(fragment.replace(/^#/, ''));
  const relay = query.get('relay'), room = query.get('room'), token = query.get('token');
  if (!relay || !room || !token || !/^[a-f0-9]{16}$/.test(room) || !/^[a-f0-9]{48}$/.test(token)) return null;
  try {
    const url = new URL(relay);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local && !securePage)) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/ws') return null;
    return { relay, room, token };
  } catch { return null; }
}

/** Reject old, replayed, wrong-source, and malformed observations before interaction logic. */
export class FrameInbox {
  frame: HandFrame | null = null;
  receivedAt = -Infinity;
  private stream: string | null = null;
  private sequence = -1;
  private capturedAt = -Infinity;
  accept(value: unknown, wallNow: number, now: number): boolean {
    if (!validHandFrame(value, wallNow)) return false;
    if (this.stream && value.streamId !== this.stream) return false;
    if (value.seq <= this.sequence || value.capturedAtMs <= this.capturedAt) return false;
    this.stream = value.streamId;
    this.sequence = value.seq;
    this.capturedAt = value.capturedAtMs;
    this.frame = value;
    this.receivedAt = now;
    return true;
  }
  fresh(now: number): HandFrame | null { return now - this.receivedAt <= 350 ? this.frame : null; }
  clear(): void { this.frame = null; this.stream = null; this.sequence = -1; this.capturedAt = -Infinity; this.receivedAt = -Infinity; }
}

export class CameraHands {
  readonly inbox = new FrameInbox();
  status = 'No camera bridge paired';
  private socket: WebSocket | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private epoch = 0;
  private preview = false;
  onReset: () => void = () => {};
  onFrame: (frame: HandFrame) => void = () => {};
  constructor(private readonly pairing: Pairing) {}
  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.reconnect = null;
    this.stopped = false;
    const epoch = ++this.epoch;
    this.status = 'Connecting to glasses camera…';
    const socket = new WebSocket(this.pairing.relay);
    this.socket = socket;
    socket.onopen = () => {
      if (epoch !== this.epoch) return;
      socket.send(JSON.stringify({ type: 'hello', role: 'viewer', room: this.pairing.room, token: this.pairing.token }));
    };
    socket.onmessage = event => {
      if (epoch !== this.epoch) return;
      let message: unknown;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (this.inbox.accept(message, Date.now(), performance.now())) {
        this.status = 'Glasses camera live';
        this.onFrame(this.inbox.frame!);
      } else if (message && typeof message === 'object' && 'type' in message) {
        if (message.type === 'ready') {
          this.status = 'Waiting for glasses-camera frames…';
          if (this.preview) this.setPreview(true);
        }
        if (message.type === 'camera') {
          this.inbox.clear();
          this.onReset();
          this.status = 'connected' in message && message.connected ? 'Waiting for glasses-camera frames…' : 'Glasses camera disconnected';
        }
      }
    };
    socket.onclose = event => {
      if (epoch !== this.epoch) return;
      this.socket = null;
      this.inbox.clear(); this.onReset();
      this.status = event.code === 1008 ? 'Camera pairing rejected. Check the pairing link.' : 'Camera bridge disconnected';
      if (!this.stopped && event.code !== 1008) this.reconnect = setTimeout(() => this.connect(), 2000);
    };
    socket.onerror = () => { if (epoch === this.epoch) this.status = 'Camera bridge unavailable'; };
  }
  setPreview(enabled: boolean): void {
    this.preview = enabled;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'preview', enabled }));
  }
  stop(): void {
    this.stopped = true; this.epoch += 1;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.reconnect = null;
    this.socket?.close(); this.socket = null;
    this.inbox.clear(); this.onReset();
  }
}
