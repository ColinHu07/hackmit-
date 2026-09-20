import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createPlayServer } from './play-server.mjs';
import { parsePlayMessage, PLAY_WORLD_LIMIT, PLAY_ACTION_DURATION } from '../shared/play-protocol.mjs';

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
const state = (client, match, timeoutMs = 3000) => client.next(message => message.type === 'snapshot' && match(message.snapshot), timeoutMs).then(message => message.snapshot);

test('walking away and turning keeps both phones in the same world beyond the old pen', async t => {
  const { connect } = await setup(t);
  const phone = await connect(), ipad = await connect();
  phone.send({ type: 'lobby', name: 'Walking phone' });
  const session = await welcome(phone);
  ipad.send({ type: 'lobby', name: 'Stationary iPad' });
  await welcome(ipad);
  assert.equal(session.snapshot.worldLimit, PLAY_WORLD_LIMIT);
  const mine = s => s.players.find(p => p.id === session.playerId);
  phone.send({ type: 'move', x: -1.2, z: -8 });
  const arrived = s => mine(s)?.z === -8;
  const [onPhone, onIpad] = await Promise.all([state(phone, arrived, 6000), state(ipad, arrived, 6000)]);
  assert.deepEqual(mine(onPhone), mine(onIpad));
  assert.equal(mine(onPhone).x, -1.2);
  const stationary = onIpad.players.find(p => p.id !== session.playerId);
  assert.ok(Math.hypot(stationary.x - mine(onPhone).x, stationary.z - mine(onPhone).z) > 8);
  phone.clear(); ipad.clear();
  phone.send({ type: 'heading', yaw: Math.PI / 2 });
  const turned = s => Math.abs(mine(s)?.yaw - Math.PI / 2) < 0.001;
  for (const s of await Promise.all([state(phone, turned), state(ipad, turned)])) {
    assert.equal(mine(s).x, -1.2); assert.equal(mine(s).z, -8);
    assert.equal(mine(s).targetZ, -8);
  }
  phone.send({ type: 'move', x: -0.5, z: -8 });
  const onward = await state(ipad, s => mine(s)?.x === -0.5);
  assert.equal(mine(onward).z, -8, 'a step after the turn preserves the accumulated distance');
});

test('phones automatically share one lobby, with independent pets, live motion, and private reconnect tokens', async t => {
  const { connect } = await setup(t);
  const a = await connect();
  const b = await connect();
  a.send({ type: 'lobby', name: 'Alex' });
  b.send({ type: 'lobby', name: 'Blair' });
  const [first, second] = await Promise.all([welcome(a), welcome(b)]);
  assert.equal(first.roomCode, second.roomCode);
  assert.equal(first.snapshot.publicLobby, true);
  assert.notEqual(first.playerId, second.playerId);
  assert.notEqual(first.playerToken, second.playerToken);
  const together = await state(a, s => s.players.length === 2);
  assert.equal(new Set(together.players.map(p => p.slot)).size, 2);
  assert.ok(together.players.every(p => !('token' in p) && !('playerToken' in p)));
  a.send({ type: 'move', x: 0, z: 1 });
  await state(b, s => s.players.some(p => p.id === first.playerId && p.targetZ === 1));
  b.send({ type: 'action', action: 'wave' });
  await state(a, s => s.players.some(p => p.id === second.playerId && p.action?.kind === 'wave'));
  a.ws.close();
  await state(b, s => s.players.some(p => p.id === first.playerId && !p.connected));
  const resumed = await connect();
  resumed.send({ type: 'lobby', name: 'Alex', playerToken: first.playerToken });
  assert.equal((await welcome(resumed)).playerId, first.playerId);
  const privateClient = await connect();
  privateClient.send({ type: 'create', name: 'Private' });
  const privateRoom = await welcome(privateClient);
  assert.notEqual(privateRoom.roomCode, first.roomCode);
  assert.equal(privateRoom.snapshot.publicLobby, undefined);
  const intruder = await connect();
  intruder.send({ type: 'lobby', name: 'Other', playerToken: privateRoom.playerToken });
  await error(intruder, 'invalid_token');
});

test('a full shared lobby rejects overflow instead of silently splitting friends into different rooms', async t => {
  const { connect } = await setup(t);
  const clients = [];
  let code;
  for (let i = 0; i < 4; i++) {
    const client = await connect();
    clients.push(client);
    client.send({ type: 'lobby', name: `Player ${i}` });
    const joined = await welcome(client);
    code ??= joined.roomCode;
    assert.equal(joined.roomCode, code);
  }
  const fifth = await connect();
  fifth.send({ type: 'lobby', name: 'Fifth' });
  await error(fifth, 'room_full');
  clients[0].send({ type: 'leave' });
  await state(clients[1], s => s.players.length === 3);
  fifth.send({ type: 'lobby', name: 'Fifth' });
  assert.equal((await welcome(fifth)).roomCode, code);
});

test('lobby messages validate names and tokens and respect server admission limits', async t => {
  assert.equal(parsePlayMessage({ type: 'lobby', name: '' }), null);
  assert.equal(parsePlayMessage({ type: 'lobby', name: 'Alex', playerToken: 'bad' }), null);
  assert.equal(parsePlayMessage({ type: 'lobby', name: 'Alex', roomCode: 'ABC234' }), null);
  const { connect } = await setup(t, { maxRooms: 0 });
  const client = await connect();
  client.send({ type: 'lobby', name: 'Alex' });
  await error(client, 'server_full');
});

test('two phones share authoritative movement, quests, and one cooperative bond reward', async t => {
  const { origin, connect } = await setup(t);
  assert.deepEqual(await (await fetch(origin + '/health')).json(), {
    ok: true, service: 'bondimals-play', rooms: 0, activeRooms: 0,
    players: 0, connections: 0, maxPlayersPerRoom: 4, maxRooms: 500, maxConnections: 1200,
  });
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

test('solo, duo, and squad quests are individual and enforce party-size gates', async t => {
  const { connect } = await setup(t);
  const a = await connect(); a.send({ type: 'create', name: 'Alex' }); const first = await welcome(a);
  const b = await connect(); b.send({ type: 'join', roomCode: first.roomCode, name: 'Blair' }); const second = await welcome(b);
  const c = await connect(); c.send({ type: 'join', roomCode: first.roomCode, name: 'Casey' }); const third = await welcome(c);
  const d = await connect(); d.send({ type: 'join', roomCode: first.roomCode, name: 'Devon' }); await welcome(d);
  const fifth = await connect(); fifth.send({ type: 'join', roomCode: first.roomCode, name: 'Evan' }); await error(fifth, 'room_full');

  a.send({ type: 'move', x: 0, z: 0 });
  b.send({ type: 'move', x: 0, z: 0 });
  c.send({ type: 'move', x: 0, z: 0 });
  d.send({ type: 'move', x: 0, z: 0 });
  const gathered = await state(a, snapshot => snapshot.players.every(player => Math.hypot(player.x, player.z) < 0.1));
  assert.equal(gathered.quests[first.playerId].touchGrass, true, 'walking is the solo touch-grass proof');
  assert.equal(gathered.quests[second.playerId].meetFriend, true, 'a nearby player completes only that player’s duo quest');

  a.send({ type: 'ready_squad_quest' });
  b.send({ type: 'ready_squad_quest' });
  c.send({ type: 'ready_squad_quest' });
  d.send({ type: 'ready_squad_quest' });
  const completed = await state(c, snapshot => Object.values(snapshot.quests).every(quest => quest.squadCircle));
  assert.equal(completed.bond, 3);
  assert.deepEqual(completed.squad.ready, []);
  assert.equal(parsePlayMessage({ type: 'ready_squad_quest' }).type, 'ready_squad_quest');
});

test('photo verification is gated by earned quest progress and stores only its decision', async t => {
  const checks = [];
  const { origin, connect } = await setup(t, { photoVerifier: {
    configured: true,
    async verify(input) { checks.push(input); return { verified: true, reason: 'Grass is clearly visible.' }; },
  } });
  const a = await connect(); a.send({ type: 'create', name: 'Alex' }); const session = await welcome(a);
  const body = {
    roomCode: session.roomCode, playerToken: session.playerToken, questId: 'touchGrass',
    photoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  };
  let response = await fetch(origin + '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 409, 'a photo cannot bypass the movement requirement');
  a.send({ type: 'move', x: 0, z: 0 });
  await state(a, snapshot => snapshot.quests[session.playerId].touchGrass);
  response = await fetch(origin + '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual(await response.json(), { verified: true, reason: 'Grass is clearly visible.' });
  const verified = await state(a, snapshot => snapshot.quests[session.playerId].photoVerification.touchGrass === 'approved');
  assert.equal(verified.quests[session.playerId].photoVerification.touchGrass, 'approved');
  assert.deepEqual(checks, [{ questId: 'touchGrass', photoDataUrl: body.photoDataUrl, participantCount: 1 }]);
  assert.equal(JSON.stringify(verified).includes(body.photoDataUrl), false, 'snapshots never contain uploaded image data');
});

test('two nearby players must both dap up to finish the individual handshake quest', async t => {
  const { connect } = await setup(t);
  const a = await connect(); a.send({ type: 'create', name: 'Alex' }); const first = await welcome(a);
  const b = await connect(); b.send({ type: 'join', roomCode: first.roomCode, name: 'Blair' }); const second = await welcome(b);
  a.send({ type: 'action', action: 'dap' });
  await error(a, 'dap_too_far');
  a.send({ type: 'move', x: 0, z: 0 }); b.send({ type: 'move', x: 0, z: 0 });
  await state(a, snapshot => snapshot.players.every(player => Math.hypot(player.x, player.z) < 0.1));
  a.send({ type: 'action', action: 'dap' });
  const offered = await state(b, snapshot => snapshot.dap.pending.length === 1);
  assert.deepEqual(offered.dap.pending[0]?.from, first.playerId);
  b.send({ type: 'action', action: 'dap' });
  const complete = await state(a, snapshot => snapshot.quests[first.playerId].dapHandshakeReady && snapshot.quests[second.playerId].dapHandshakeReady);
  assert.equal(complete.dap.pending.length, 0);
  assert.equal(complete.bond, 0);
  assert.equal(complete.quests[first.playerId].dapHandshake, false, 'camera approval is still required');
  assert.equal(complete.players[0]?.action?.kind, 'dap');
  assert.equal(complete.players[1]?.action?.kind, 'dap');
});

test('a completed squad can start and finish the Mossback raid with per-player rewards', async t => {
  const { connect } = await setup(t);
  const a = await connect(); a.send({ type: 'create', name: 'Alex' }); const first = await welcome(a);
  const b = await connect(); b.send({ type: 'join', roomCode: first.roomCode, name: 'Blair' }); const second = await welcome(b);
  const c = await connect(); c.send({ type: 'join', roomCode: first.roomCode, name: 'Casey' }); const third = await welcome(c);

  a.send({ type: 'ready_raid' });
  await error(a, 'raid_needs_squad');
  for (const client of [a, b, c]) client.send({ type: 'move', x: 0, z: 0 });
  await state(a, snapshot => snapshot.players.every(player => Math.hypot(player.x, player.z) < 0.1));
  for (const client of [a, b, c]) client.send({ type: 'ready_squad_quest' });
  await state(a, snapshot => snapshot.players.every(player => snapshot.quests[player.id].squadCircle));

  a.send({ type: 'ready_raid' }); b.send({ type: 'ready_raid' });
  const waiting = await state(c, snapshot => snapshot.raid.ready.length === 2);
  assert.equal(waiting.raid.state, 'waiting');
  c.send({ type: 'ready_raid' });
  const active = await state(a, snapshot => snapshot.raid.state === 'active');
  assert.equal(active.raid.maxHealth, 14);
  assert.equal(parsePlayMessage({ type: 'ready_raid' }).type, 'ready_raid');

  // Waving beside teammates must calm Mossback too (regression).
  a.send({ type: 'action', action: 'wave' });
  await state(a, snapshot => snapshot.raid.health === 13);
  await new Promise(resolve => setTimeout(resolve, PLAY_ACTION_DURATION.wave + 100));
  // Continue until the cooperative meter reaches zero.
  for (let round = 0; round < 4; round++) {
    for (const client of [a, b, c]) client.send({ type: 'action', action: 'jump' });
    await new Promise(resolve => setTimeout(resolve, PLAY_ACTION_DURATION.jump + 100));
  }
  a.send({ type: 'action', action: 'jump' });
  b.send({ type: 'action', action: 'jump' });
  const defeated = await state(c, snapshot => snapshot.raid.state === 'defeated');
  assert.equal(defeated.bond, 8, 'three squad moments plus five raid moments');
  for (const id of [first.playerId, second.playerId, third.playerId]) assert.equal(defeated.quests[id].raidBoss, true);
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
  replacement.send({ type: 'move', x: -PLAY_WORLD_LIMIT * 2, z: PLAY_WORLD_LIMIT * 2 });
  const moved = await state(stranger, snapshot => snapshot.players[0].targetX === -PLAY_WORLD_LIMIT);
  assert.equal(moved.players[0].targetZ, PLAY_WORLD_LIMIT);
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

test('compass heading changes shared facing without moving the pet', async t => {
  const { connect } = await setup(t);
  const a = await connect(); a.send({ type: 'create', name: 'Walker' });
  const first = await welcome(a);
  const b = await connect(); b.send({ type: 'join', roomCode: first.roomCode, name: 'Friend' }); await welcome(b);
  a.send({ type: 'heading', yaw: Math.PI });
  const next = await state(b, snapshot => Math.abs(snapshot.players[0].yaw - Math.PI) < 0.001);
  assert.equal(next.players[0].x, first.snapshot.players[0].x);
  assert.equal(next.players[0].z, first.snapshot.players[0].z);
  assert.equal(next.bond, 0);
  assert.equal(parsePlayMessage({ type: 'heading', yaw: 'north' }), null);
  assert.equal(parsePlayMessage({ type: 'heading', yaw: Infinity }), null);
  assert.equal(parsePlayMessage({ type: 'heading', yaw: 0, latitude: 42 }), null);
});

test('duo clip verification approves only original participants and is idempotent', async t => {
  let calls = 0;
  const { connect, origin } = await setup(t, { photoVerifier: { configured: true, async verify(input) {
    calls++; assert.equal(input.participantCount, 2); return { verified: true, reason: 'A handshake is visible.' };
  } } });
  const a = await connect(); a.send({ type: 'create', name: 'A' }); const first = await welcome(a);
  const b = await connect(); b.send({ type: 'join', roomCode: first.roomCode, name: 'B' }); const second = await welcome(b);
  a.send({ type: 'move', x: 0, z: 0 }); b.send({ type: 'move', x: 0, z: 0 });
  await state(a, s => s.players.every(p => Math.abs(p.x) < 0.1));
  a.send({ type: 'action', action: 'dap' }); await state(b, s => s.dap.pending.length === 1);
  b.send({ type: 'action', action: 'dap' }); await state(a, s => s.quests[first.playerId].dapHandshakeReady);
  const c = await connect(); c.send({ type: 'join', roomCode: first.roomCode, name: 'C' }); const third = await welcome(c);
  const body = { roomCode: first.roomCode, playerToken: first.playerToken, questId: 'dapHandshake', frames: Array(3).fill('data:image/png;base64,iVBORw0KGgo='), durationSeconds: 5 };
  const post = value => fetch(origin + '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await post({ ...body, playerToken: third.playerToken })).status, 409);
  assert.equal((await post(body)).status, 200);
  const verified = await state(a, s => s.quests[first.playerId].photoVerification.dapHandshake === 'approved');
  assert.equal(verified.quests[second.playerId].photoVerification.dapHandshake, 'approved');
  assert.equal(verified.quests[third.playerId].photoVerification.dapHandshake, undefined);
  assert.equal((await post(body)).status, 200); assert.equal(calls, 1);
  assert.equal(JSON.stringify(verified).includes('base64'), false);
});

test('failed evidence stays retryable and configured origins are enforced on uploads', async t => {
  const { connect, origin } = await setup(t, { allowedOrigins: ['https://allowed.example'], photoVerifier: { configured: true, async verify() { throw new Error('Provider timeout'); } } });
  const denied = await fetch(origin + '/verify', { method: 'POST', body: '{}' });
  assert.equal(denied.status, 403);
});

test('provider failure restores quest state for retry instead of leaving it pending', async t => {
  let calls = 0;
  const { connect, origin } = await setup(t, { photoVerifier: { configured: true, async verify() {
    if (++calls === 1) throw new Error('Provider timeout');
    return { verified: false, reason: 'No hand touches the grass.' };
  } } });
  const a = await connect(); a.send({ type: 'create', name: 'A' }); const session = await welcome(a);
  a.send({ type: 'move', x: 0, z: 0 }); await state(a, s => s.quests[session.playerId].touchGrass);
  const body = { roomCode: session.roomCode, playerToken: session.playerToken, questId: 'touchGrass', photoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
  const post = () => fetch(origin + '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post()).status, 502);
  await state(a, s => s.quests[session.playerId].photoVerification.touchGrass === 'required');
  assert.equal((await post()).status, 200);
  await state(a, s => s.quests[session.playerId].photoVerification.touchGrass === 'rejected');
});

test('squad evidence checks all participants and marks only their group approved', async t => {
  let people;
  const { connect, origin } = await setup(t, { photoVerifier: { configured: true, async verify(input) {
    people = input.participantCount; return { verified: true, reason: 'Three people cheer together.' };
  } } });
  const a = await connect(); a.send({ type: 'create', name: 'A' }); const first = await welcome(a);
  const peers = [a]; const sessions = [first];
  for (const name of ['B', 'C']) { const peer = await connect(); peer.send({ type: 'join', roomCode: first.roomCode, name }); sessions.push(await welcome(peer)); peers.push(peer); }
  for (const peer of peers) peer.send({ type: 'move', x: 0, z: 0 });
  await state(a, s => s.players.every(p => Math.hypot(p.x, p.z) < 0.1));
  for (const peer of peers) peer.send({ type: 'ready_squad_quest' });
  await state(a, s => s.players.every(p => s.quests[p.id].squadCircle));
  const response = await fetch(origin + '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomCode: first.roomCode, playerToken: first.playerToken, questId: 'squadCircle', photoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }) });
  assert.equal(response.status, 200); assert.equal(people, 3);
  const verified = await state(a, s => s.players.every(p => s.quests[p.id].photoVerification.squadCircle === 'approved'));
  assert.equal(Object.keys(verified.quests).length, 3);
});
