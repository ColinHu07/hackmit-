import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaySnapshot, ServerMessage } from '../../shared/play-protocol';
import { RoomClient } from './RoomClient';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly send = vi.fn<(data: string) => void>();
  readonly close = vi.fn(() => { this.readyState = MockWebSocket.CLOSING; });

  constructor(readonly url: string) { MockWebSocket.instances.push(this); }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  serverClose(code = 1006): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }

  commands(): unknown[] { return this.send.mock.calls.map(([data]) => JSON.parse(data)); }
}

const snapshot: PlaySnapshot = {
  roomCode: 'ABC234', serverTime: 1000, players: [], bond: 0,
  quests: {}, squad: { ready: [], minPlayers: 3 },
  dap: { pending: [] },
  raid: { state: 'waiting', ready: [], participants: [], minPlayers: 3, health: 0, maxHealth: 0, endsAt: null },
  quest: { met: false, waved: false, played: false }, notice: 'Invite a friend.',
};
const welcome: ServerMessage = {
  type: 'welcome', roomCode: snapshot.roomCode, playerId: 'alex-player',
  playerToken: 'a'.repeat(48), snapshot,
};

function socket(index: number): MockWebSocket {
  const result = MockWebSocket.instances[index];
  if (!result) throw new Error(`Missing test socket ${index}`);
  return result;
}

function setup() {
  const callbacks = { state: vi.fn(), snapshot: vi.fn(), error: vi.fn() };
  const client = new RoomClient(callbacks);
  client.start('ws://play.example/play', { type: 'create', name: 'Alex' });
  return { client, callbacks, first: socket(0) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('window', { location: { protocol: 'http:' } });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RoomClient session lifecycle', () => {
  it('automatically joins without a room code and resumes its own lobby pet', () => {
    const { client, callbacks } = setup();
    client.start('ws://play.example/play', { type: 'lobby', name: 'Alex' });
    const joined = socket(1);
    joined.open();
    expect(joined.commands()).toEqual([{ type: 'lobby', name: 'Alex' }]);
    joined.receive(welcome);
    joined.serverClose();
    vi.advanceTimersByTime(500);
    const resumed = socket(2);
    resumed.open();
    expect(resumed.commands()).toEqual([{ type: 'lobby', name: 'Alex', playerToken: welcome.playerToken }]);
    resumed.receive(welcome);
    expect(callbacks.state).toHaveBeenLastCalledWith('connected');
  });

  it('recovers an expired lobby identity after a server restart without requiring a code', () => {
    const { client, callbacks } = setup();
    client.start('ws://play.example/play', { type: 'lobby', name: 'Alex', playerToken: welcome.playerToken });
    const joined = socket(1);
    joined.open();
    joined.receive({ type: 'error', code: 'invalid_token', message: 'Expired' });
    expect(joined.commands().at(-1)).toEqual({ type: 'lobby', name: 'Alex' });
    joined.receive(welcome);
    expect(callbacks.state).toHaveBeenLastCalledWith('connected');
    expect(callbacks.error).not.toHaveBeenCalled();
  });

  it('explains that the host needs an update when an older server rejects automatic joining', () => {
    const { client, callbacks } = setup();
    client.start('ws://play.example/play', { type: 'lobby', name: 'Alex' });
    const joined = socket(1);
    joined.open();
    joined.receive({ type: 'error', code: 'invalid_message', message: 'Unknown command' });
    expect(callbacks.error).toHaveBeenLastCalledWith(expect.stringContaining('update and restart'), true);
    expect(joined.commands()).toEqual([{ type: 'lobby', name: 'Alex' }]);
  });

  it('resumes the same player and token after a dropped connection', () => {
    const { client, callbacks, first } = setup();
    first.open();
    expect(first.commands()).toEqual([{ type: 'create', name: 'Alex' }]);
    first.receive(welcome);
    expect(callbacks.state).toHaveBeenLastCalledWith('connected');

    first.serverClose();
    expect(callbacks.state).toHaveBeenLastCalledWith('reconnecting');
    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);

    const resumed = socket(1);
    expect(resumed.url).toBe('ws://play.example/play');
    resumed.open();
    expect(resumed.commands()).toEqual([{
      type: 'join', roomCode: welcome.roomCode, playerToken: welcome.playerToken, name: 'Alex',
    }]);
    resumed.receive(welcome);
    expect(callbacks.snapshot).toHaveBeenLastCalledWith(snapshot, {
      roomCode: welcome.roomCode, playerId: welcome.playerId,
      playerToken: welcome.playerToken, name: 'Alex',
    });
    client.action('wave');
    expect(resumed.commands().at(-1)).toEqual({ type: 'action', action: 'wave' });
    expect(callbacks.error).not.toHaveBeenCalled();
  });

  it('ignores late events from a socket superseded by a new room request', () => {
    const { client, callbacks, first } = setup();
    first.open();
    first.receive(welcome);
    client.start('ws://other.example/play', { type: 'join', name: 'Blair', roomCode: 'DEF567' });
    expect(first.commands().at(-1)).toEqual({ type: 'leave' });
    callbacks.state.mockClear();
    callbacks.snapshot.mockClear();
    const oldSendCount = first.send.mock.calls.length;

    first.open();
    first.receive(welcome);
    first.receive({ type: 'error', code: 'old_error', message: 'An old error' });
    first.serverClose();
    expect(first.send).toHaveBeenCalledTimes(oldSendCount);
    expect(callbacks.state).not.toHaveBeenCalled();
    expect(callbacks.snapshot).not.toHaveBeenCalled();
    expect(callbacks.error).not.toHaveBeenCalled();

    const current = socket(1);
    current.open();
    expect(current.commands()).toEqual([{ type: 'join', name: 'Blair', roomCode: 'DEF567' }]);
    const currentSnapshot = { ...snapshot, roomCode: 'DEF567' };
    current.receive({ ...welcome, roomCode: 'DEF567', playerId: 'blair-player', snapshot: currentSnapshot });
    expect(callbacks.snapshot).toHaveBeenCalledTimes(1);
    expect(callbacks.snapshot.mock.calls[0]?.[1]).toMatchObject({ name: 'Blair', playerId: 'blair-player' });
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('cancels pending retries on stop and ignores events arriving afterward', () => {
    const { client, callbacks, first } = setup();
    first.open();
    first.receive(welcome);
    first.serverClose();
    client.stop();
    callbacks.state.mockClear();
    callbacks.snapshot.mockClear();
    const sentBeforeStop = first.send.mock.calls.length;

    first.open();
    first.receive(welcome);
    first.serverClose();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(first.send).toHaveBeenCalledTimes(sentBeforeStop);
    expect(callbacks.state).not.toHaveBeenCalled();
    expect(callbacks.snapshot).not.toHaveBeenCalled();
    expect(callbacks.error).not.toHaveBeenCalled();
  });

  it('does not steal a session back when another connection replaces it', () => {
    const { callbacks, first } = setup();
    first.open();
    first.receive(welcome);
    first.serverClose(4001);

    expect(callbacks.state).toHaveBeenLastCalledWith('offline');
    expect(callbacks.error).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(callbacks.error).toHaveBeenCalledTimes(1);
  });

  it.each(['rejected', 'closed', 'timeout'] as const)('ends a %s initial handshake without a retry loop', reason => {
    const { callbacks, first } = setup();
    first.open();
    if (reason === 'rejected') first.receive({ type: 'error', code: 'room_full', message: 'This room is full.' });
    if (reason === 'closed') first.serverClose();
    if (reason === 'timeout') vi.advanceTimersByTime(10_000);

    expect(callbacks.state).toHaveBeenLastCalledWith('offline');
    expect(callbacks.error).toHaveBeenCalledTimes(1);
    expect(callbacks.snapshot).not.toHaveBeenCalled();
    // A browser may dispatch close after the application has already failed.
    first.serverClose();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(callbacks.error).toHaveBeenCalledTimes(1);
  });

  it('sends gameplay only after welcome and stops sending while disconnected', () => {
    const { client, first } = setup();
    vi.advanceTimersByTime(100);
    client.move(1, 2);
    client.action('wave');
    expect(first.commands()).toEqual([]);

    first.open();
    vi.advanceTimersByTime(100);
    client.move(1, 2);
    client.action('feed');
    expect(first.commands()).toEqual([{ type: 'create', name: 'Alex' }]);

    first.receive(welcome);
    vi.advanceTimersByTime(100);
    client.move(1, 2);
    client.action('jump');
    expect(first.commands().slice(-2)).toEqual([{ type: 'move', x: 1, z: 2 }, { type: 'action', action: 'jump' }]);
    const connectedCount = first.send.mock.calls.length;
    client.move(Number.NaN, 2);
    client.move(1, Number.POSITIVE_INFINITY);
    expect(first.send).toHaveBeenCalledTimes(connectedCount);

    first.serverClose();
    vi.advanceTimersByTime(100);
    client.move(2, 3);
    client.action('play');
    expect(first.send).toHaveBeenCalledTimes(connectedCount);
    client.stop();
  });
});

it('renders the older team server without quest objects and does not send unsupported commands', () => {
  const { client, callbacks, first } = setup();
  first.open();
  const { quests: _quests, squad: _squad, raid: _raid, dap: _dap, ...legacy } = snapshot;
  first.receive({ ...welcome, snapshot: legacy } as ServerMessage);
  const rendered = callbacks.snapshot.mock.calls.at(-1)![0];
  expect(rendered.legacyServer).toBe(true);
  expect(rendered.players).toEqual(legacy.players);
  expect(rendered.quests).toEqual({});
  expect(rendered.squad.ready).toEqual([]);
  expect(rendered.raid.state).toBe('waiting');
  first.send.mockClear();
  client.heading(0.8); client.action('dap'); client.readySquadQuest(); client.readyRaid();
  expect(first.commands()).toEqual([]);
  vi.advanceTimersByTime(100);
  client.move(1, 1); client.action('wave');
  expect(first.commands()).toEqual([{ type: 'move', x: 1, z: 1 }, { type: 'action', action: 'wave' }]);
  first.receive({ type: 'snapshot', snapshot });
  first.send.mockClear(); client.heading(0.8);
  expect(first.commands()).toEqual([{ type: 'heading', yaw: 0.8 }]);
});
