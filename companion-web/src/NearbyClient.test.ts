import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NearbyServerMessage } from '../../shared/nearby-protocol';
import { NearbyClient, nearbyServerUrl } from './NearbyClient';
import type { LocationFix } from './LocationDiscovery';

class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly send = vi.fn<(data: string) => void>();
  readonly close = vi.fn(() => { this.readyState = 3; });
  constructor(readonly url: string) { MockWebSocket.instances.push(this); }
  open(): void { this.readyState = 1; this.onopen?.(); }
  receive(message: NearbyServerMessage): void { this.raw(JSON.stringify(message)); }
  raw(data: string): void { this.onmessage?.({ data } as MessageEvent<string>); }
  commands(): unknown[] { return this.send.mock.calls.map(([data]) => JSON.parse(data)); }
}

function fix(latitude = 42): LocationFix {
  return { latitude, longitude: -71, accuracy: 4, timestamp: Date.now() };
}
function setup(ready = true) {
  const callbacks = {
    state: vi.fn(), ready: vi.fn(), nearby: vi.fn(), incoming: vi.fn(), outgoing: vi.fn(),
    closed: vi.fn(), matched: vi.fn(), error: vi.fn(),
  };
  const client = new NearbyClient(callbacks);
  client.start('https://play.example/play', 'Alex');
  const socket = MockWebSocket.instances.at(-1)!;
  if (ready) {
    socket.open();
    socket.receive({ type: 'discovery_ready', selfId: 'alex' });
  }
  return { client, socket, callbacks };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-09-19T15:00:00Z'));
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('window', { location: { protocol: 'https:' } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('NearbyClient', () => {
  it.each([
    ['https://example.com/play', 'wss://example.com/nearby'],
    ['https://example.com/ws/', 'wss://example.com/nearby'],
    ['wss://example.com/', 'wss://example.com/nearby'],
    ['wss://example.com/bondimals/play?session=demo', 'wss://example.com/bondimals/nearby?session=demo'],
    ['wss://example.com/bondimals/nearby', 'wss://example.com/bondimals/nearby'],
  ])('converts %s to its discovery endpoint', (input, expected) => {
    expect(nearbyServerUrl(input)).toBe(expected);
  });

  it('rejects insecure discovery addresses on HTTPS', () => {
    expect(() => nearbyServerUrl('ws://example.com/play')).toThrow('HTTPS');
  });

  it('buffers only the newest location during handshake and sends it after ready', () => {
    const { client, socket, callbacks } = setup(false);
    const initial = fix();
    client.location(initial);
    vi.advanceTimersByTime(100);
    const latest = fix(43);
    client.location(latest);
    client.meet('blair');
    expect(socket.commands()).toEqual([]);
    socket.open();
    expect(socket.commands()).toEqual([{ type: 'discover', name: 'Alex' }]);
    socket.receive({ type: 'discovery_ready', selfId: 'alex' });
    expect(callbacks.ready).toHaveBeenCalledWith('alex');
    expect(socket.commands()).toEqual([{ type: 'discover', name: 'Alex' }, { type: 'location', ...latest }]);
  });

  it('sends the newest throttled fix when one second elapses even if motion stops', () => {
    const { client, socket } = setup();
    client.location(fix());
    vi.advanceTimersByTime(100);
    client.location(fix(43));
    vi.advanceTimersByTime(100);
    const latest = fix(44);
    client.location(latest);
    vi.advanceTimersByTime(799);
    expect(socket.commands()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(socket.commands()).toHaveLength(3);
    expect(socket.commands().at(-1)).toEqual({ type: 'location', ...latest });
  });

  it('ignores invalid, stale, or future location fixes', () => {
    const { client, socket } = setup();
    for (const invalid of [
      { ...fix(), latitude: NaN }, { ...fix(), longitude: 181 }, { ...fix(), latitude: 91 },
      { ...fix(), accuracy: -1 }, { ...fix(), timestamp: Date.now() - 20_001 },
      { ...fix(), timestamp: Date.now() + 5001 },
    ]) client.location(invalid);
    expect(socket.commands()).toHaveLength(1);
  });

  it('clears buffered coordinates when paused during handshake', () => {
    const { client, socket } = setup(false);
    client.location(fix());
    client.pause();
    socket.open();
    socket.receive({ type: 'discovery_ready', selfId: 'alex' });
    expect(socket.commands()).toEqual([{ type: 'discover', name: 'Alex' }]);
  });

  it('pauses server discovery and cancels a pending location send', () => {
    const { client, socket } = setup();
    client.location(fix());
    client.location(fix(43));
    client.pause();
    vi.advanceTimersByTime(1000);
    expect(socket.commands().at(-1)).toEqual({ type: 'pause' });
    expect(socket.commands()).toHaveLength(3);
  });

  it('relays nearby pets and mutual meet requests without coordinates', () => {
    const { client, socket, callbacks } = setup();
    const peers = [{ id: 'blair', name: 'Blair', distanceMeters: 6, uncertain: true }];
    socket.receive({ type: 'nearby', peers, accuracy: 7, notice: 'An approximate distance.' });
    expect(callbacks.nearby).toHaveBeenCalledWith(peers, 7, 'An approximate distance.');
    client.meet('blair');
    expect(socket.commands().at(-1)).toEqual({ type: 'meet', peerId: 'blair' });
    const request = { requestId: 'meeting', peerId: 'blair', name: 'Blair', expiresAt: Date.now() + 30_000 };
    socket.receive({ type: 'meet_sent', ...request });
    expect(callbacks.outgoing).toHaveBeenCalledWith(expect.objectContaining(request));
    socket.receive({ type: 'meet_request', ...request });
    expect(callbacks.incoming).toHaveBeenCalledWith(expect.objectContaining(request));
    client.respond('meeting', true);
    expect(socket.commands().at(-1)).toEqual({ type: 'respond', requestId: 'meeting', accept: true });
    socket.receive({ type: 'request_closed', requestId: 'meeting', reason: 'declined' });
    expect(callbacks.closed).toHaveBeenCalledWith('meeting', 'declined');
  });

  it('closes discovery and discards pending coordinates before match handoff', () => {
    const { client, socket, callbacks } = setup();
    client.location(fix());
    client.location(fix(43));
    callbacks.matched.mockImplementation(() => { expect(socket.close).toHaveBeenCalledTimes(1); });
    socket.receive({ type: 'matched', roomCode: 'ABCD23', playerToken: 'secret-room-token' });
    expect(callbacks.matched).toHaveBeenCalledWith('ABCD23', 'secret-room-token');
    vi.advanceTimersByTime(60_000);
    client.location(fix());
    expect(socket.commands()).toHaveLength(2);
    expect(callbacks.error).not.toHaveBeenCalled();
  });

  it.each(['close', 'error', 'handshake', 'stale'] as const)('stops on %s without reconnecting or reusing location', failure => {
    const { client, socket, callbacks } = setup(failure !== 'handshake');
    client.location(fix());
    client.location(fix(43));
    if (failure === 'close') socket.onclose?.();
    if (failure === 'error') socket.onerror?.();
    if (failure === 'handshake') vi.advanceTimersByTime(10_000);
    if (failure === 'stale') vi.advanceTimersByTime(30_000);
    expect(callbacks.state).toHaveBeenLastCalledWith('offline');
    expect(callbacks.error).toHaveBeenCalledTimes(1);
    const sent = socket.commands().length;
    socket.onclose?.();
    client.location(fix());
    vi.advanceTimersByTime(60_000);
    expect(socket.commands()).toHaveLength(sent);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(callbacks.error).toHaveBeenCalledTimes(1);
  });

  it('keeps a healthy connection alive through empty nearby heartbeat snapshots', () => {
    const { socket, callbacks } = setup();
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(20_000);
      socket.receive({ type: 'nearby', peers: [], accuracy: null, notice: 'Location paused.' });
    }
    expect(callbacks.state).toHaveBeenLastCalledWith('connected');
    expect(callbacks.error).not.toHaveBeenCalled();
  });

  it('ignores stale socket events and starts fresh only after an explicit restart', () => {
    const { client, socket, callbacks } = setup();
    client.location(fix());
    client.location(fix(43));
    client.start('https://other.example/play', 'Blair');
    callbacks.state.mockClear();
    callbacks.ready.mockClear();
    const count = socket.commands().length;
    socket.open();
    socket.receive({ type: 'discovery_ready', selfId: 'old' });
    socket.receive({ type: 'matched', roomCode: 'OLD123', playerToken: 'old-token' });
    socket.onclose?.();
    socket.onerror?.();
    expect(socket.commands()).toHaveLength(count);
    expect(callbacks.state).not.toHaveBeenCalled();
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(callbacks.matched).not.toHaveBeenCalled();
    const fresh = MockWebSocket.instances.at(-1)!;
    fresh.open();
    fresh.receive({ type: 'discovery_ready', selfId: 'new' });
    vi.advanceTimersByTime(1000);
    expect(fresh.commands()).toEqual([{ type: 'discover', name: 'Blair' }]);
  });

  it('ignores malformed payload shapes and handles malformed JSON without throwing', () => {
    const { socket, callbacks } = setup();
    socket.raw(JSON.stringify({ type: 'nearby', peers: [null], accuracy: 4, notice: 'oops' }));
    socket.raw(JSON.stringify({ type: 'matched', roomCode: 'ABC123' }));
    expect(callbacks.nearby).not.toHaveBeenCalled();
    expect(callbacks.matched).not.toHaveBeenCalled();
    expect(() => socket.raw('not json')).not.toThrow();
    expect(callbacks.state).toHaveBeenLastCalledWith('offline');
  });
});
