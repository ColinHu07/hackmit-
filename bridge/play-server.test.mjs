import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createPlayServer } from './play-server.mjs';
import { parsePlayMessage } from '../shared/play-protocol.mjs';

async function setup(t, options = {}) {
  const app = createPlayServer(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function connect(path = '/play', settings = {}) {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + path, settings);
    const queue = [];
    const waiters = [];
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      const index = waiters.findIndex(waiter => waiter.match(message));
      if (index < 0) { queue.push(message); return; }
      const waiter = waiters.splice(index, 1)[0];
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
    });
    await once(ws, 'open');
    function next(match = () => true, timeoutMs = 3000) {
      const index = queue.findIndex(match);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve, timeout: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error('Timed out waiting for playground message'));
        }, timeoutMs) };
        waiters.push(waiter);
      });
    }
    return { ws, next, send: value => ws.send(JSON.stringify(value)), clear: () => { queue.length = 0; } };
  }
  return { app, origin, connect };
}
const welcome = client => client.next(message => message.type === 'welcome');
const error = (client, code) => client.next(message => message.type === 'error' && message.code === code);
const state = (client, match) => client.next(message => message.type === 'snapshot' && match(message.snapshot)).then(message => message.snapshot);

test('two phones share authoritative movement, quests, and one cooperative bond reward', async t => {
  const { origin, connect } = await setup(t);
  assert.deepEqual(await (await fetch(origin + '/health')).json(), { ok: true, service: 'bondimals-play', rooms: 0 });
  const a = await connect('/');
  a.send({ type: 'create', name: 'Alex' });
  const first = await welcome(a);
  assert.match(first.roomCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(first.snapshot.players.length, 1, 'the server never fabricates a companion');
  const b = await connect();
  b.send({ type: 'join', roomCode: first.roomCode.toLowerCase(), name: 'Blair' });
  const second = await welcome(b);
  assert.equal(second.snapshot.players.length, 2);
  assert.notEqual(second.playerToken, first.playerToken);
  const outsider = await connect('/ws');
  outsider.send({ type: 'join', roomCode: first.roomCode, name: 'Chris' });
  await error(outsider, 'room_full');
  a.clear();
  a.send({ type: 'move', x: 0, z: 0 });
  const moving = await state(a, snapshot => snapshot.players[0].targetX === 0 && snapshot.players[0].x > -1.2);
  assert.ok(moving.players[0].x < -0.8, 'a destination cannot teleport a pet');
  assert.ok(Math.abs(moving.players[0].yaw - Math.PI / 2) < 0.001);
  const met = await state(b, snapshot => snapshot.quest.met);
  assert.ok(Math.hypot(met.players[0].x - met.players[1].x, met.players[0].z - met.players[1].z) <= 1.5);
  a.send({ type: 'action', action: 'wave' });
  const waved = await state(b, snapshot => snapshot.quest.waved);
  assert.equal(waved.players[0].action.kind, 'wave');
  b.send({ type: 'action', action: 'play' });
  const played = await state(a, snapshot => snapshot.quest.played);
  assert.equal(played.bond, 1);
  assert.ok(played.players.every(player => player.action.kind === 'play'));
  assert.equal(played.players[0].action.startedAt, played.players[1].action.startedAt);
  b.send({ type: 'action', action: 'play' });
  await error(b, 'action_busy');
  b.clear();
  assert.equal((await state(b, snapshot => snapshot.bond === 1)).bond, 1);
});

test('room membership, token rejoin, and socket replacement isolate control', async t => {
  const { connect } = await setup(t);
  const a = await connect();
  a.send({ type: 'create', name: 'Alex' });
  const session = await welcome(a);
  const other = await connect();
  other.send({ type: 'create', name: 'Other room' });
  const otherSession = await welcome(other);
  const stranger = await connect();
  stranger.send({ type: 'join', roomCode: session.roomCode, name: 'Intruder', playerToken: otherSession.playerToken });
  await error(stranger, 'invalid_token');
  stranger.send({ type: 'move', x: 3, z: 3 });
  await error(stranger, 'not_joined');
  stranger.send({ type: 'join', roomCode: session.roomCode, name: 'Blair' });
  const b = await welcome(stranger);
  assert.equal(b.snapshot.players[0].x, -1.2);
  assert.ok(!JSON.stringify(b.snapshot).includes(session.playerToken), 'snapshots never expose bearer tokens');
  const aClosed = once(a.ws, 'close');
  a.ws.close();
  await aClosed;
  const disconnected = await state(stranger, snapshot => snapshot.players.some(player => !player.connected));
  assert.equal(disconnected.players.length, 2);
  const resumed = await connect();
  resumed.send({ type: 'join', roomCode: session.roomCode, name: 'Alex', playerToken: session.playerToken });
  const back = await welcome(resumed);
  assert.equal(back.playerId, session.playerId);
  assert.equal(back.playerToken, session.playerToken);
  assert.ok(back.snapshot.players.every(player => player.connected));
  const replacement = await connect();
  const replacedClosed = once(resumed.ws, 'close');
  replacement.send({ type: 'join', roomCode: session.roomCode, name: 'Alex', playerToken: session.playerToken });
  await welcome(replacement);
  assert.equal((await replacedClosed)[0], 4001);
  replacement.send({ type: 'move', x: -99, z: 99 });
  const moved = await state(stranger, snapshot => snapshot.players[0].targetX === -3);
  assert.equal(moved.players[0].targetZ, 3);
  assert.ok(moved.players[0].connected, 'old socket closure cannot detach replacement');
  replacement.send({ type: 'leave' });
  await state(stranger, snapshot => snapshot.players.length === 1);
  replacement.send({ type: 'join', roomCode: session.roomCode, name: 'Alex', playerToken: session.playerToken });
  await error(replacement, 'invalid_token');
});

test('malformed, unknown, oversized, and unsupported actions cannot mutate rooms', async t => {
  const { connect } = await setup(t);
  const a = await connect();
  a.send({ type: 'join', roomCode: 'ABC234', name: 'Alex' });
  await error(a, 'room_not_found');
  a.ws.send('{bad json');
  await error(a, 'invalid_message');
  a.send({ type: 'create', name: 'Alex' });
  const session = await welcome(a);
  for (const message of [
    { type: 'move', x: null, z: 0 },
    { type: 'move', x: 1, z: 1, playerId: session.playerId },
    { type: 'teleport', x: 3, z: 3 },
  ]) {
    a.send(message);
    await error(a, 'invalid_message');
  }
  a.send({ type: 'action', action: 'play' });
  await error(a, 'friend_too_far');
  a.clear();
  const unchanged = await state(a, snapshot => snapshot.players.length === 1);
  assert.equal(unchanged.players[0].x, -1.2);
  assert.equal(unchanged.bond, 0);
  assert.equal(unchanged.quest.played, false);
  const tooLarge = await connect();
  const closed = once(tooLarge.ws, 'close');
  tooLarge.ws.send('x'.repeat(2048));
  assert.equal((await closed)[0], 1009);
  assert.equal(parsePlayMessage({ type: 'move', x: Infinity, z: 0 }), null);
  assert.equal(parsePlayMessage({ type: ['leave'] }), null);
});

test('expired reservations free slots; empty rooms expire; room count is bounded', async t => {
  const { connect } = await setup(t, { tickMs: 10, rejoinGraceMs: 40, roomIdleMs: 100, maxRooms: 1 });
  const a = await connect();
  a.send({ type: 'create', name: 'Alex' });
  const session = await welcome(a);
  const b = await connect();
  b.send({ type: 'create', name: 'Blair' });
  await error(b, 'server_full');
  b.send({ type: 'join', roomCode: session.roomCode, name: 'Blair' });
  await welcome(b);
  const close = once(a.ws, 'close'); a.ws.close(); await close;
  await state(b, snapshot => snapshot.players.length === 1);
  const c = await connect();
  c.send({ type: 'join', roomCode: session.roomCode, name: 'Alex', playerToken: session.playerToken });
  await error(c, 'invalid_token');
  c.send({ type: 'join', roomCode: session.roomCode, name: 'Chris' });
  const replacement = await welcome(c);
  assert.equal(replacement.snapshot.players.find(player => player.name === 'Chris').slot, 0);
  const bClose = once(b.ws, 'close'), cClose = once(c.ws, 'close');
  b.ws.close(); c.ws.close();
  await Promise.all([bClose, cClose]);
  await new Promise(resolve => setTimeout(resolve, 150));
  const fresh = await connect();
  fresh.send({ type: 'join', roomCode: session.roomCode, name: 'Fresh' });
  await error(fresh, 'room_not_found');
  fresh.send({ type: 'create', name: 'Fresh' });
  await welcome(fresh);
});

test('configured browser origins are enforced before websocket admission', async t => {
  const { origin, connect } = await setup(t, { allowedOrigins: ['https://friends.example'] });
  const blocked = new WebSocket(origin.replace('http:', 'ws:') + '/play', { origin: 'https://other.example' });
  const [failure] = await once(blocked, 'error');
  assert.match(failure.message, /403/);
  const accepted = await connect('/play', { origin: 'https://friends.example' });
  accepted.send({ type: 'create', name: 'Alex' });
  await welcome(accepted);
});
