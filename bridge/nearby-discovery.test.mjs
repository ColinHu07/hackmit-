import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createPlayServer } from './play-server.mjs';
import { distanceMeters, parseNearbyMessage } from '../shared/nearby-protocol.mjs';

async function setup(t, options = {}) {
  const app = createPlayServer({ ...options, nearby: { tickMs: 20, ...options.nearby } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const origin = `ws://127.0.0.1:${app.server.address().port}`;
  async function connect(path = '/nearby', settings = {}) {
    const ws = new WebSocket(origin + path, settings);
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
    const next = (match = () => true) => {
      const index = queue.findIndex(match);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve, timeout: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error('Timed out waiting for discovery message'));
        }, 3000) };
        waiters.push(waiter);
      });
    };
    return { ws, next, send: value => ws.send(JSON.stringify(value)), clear: () => { queue.length = 0; } };
  }
  async function discover(name, meters = 0, accuracy = 1) {
    const client = await connect();
    client.send({ type: 'discover', name });
    const ready = await client.next(message => message.type === 'discovery_ready');
    client.id = ready.selfId;
    client.fix = (distance = meters, precision = accuracy, timestamp = Date.now()) => client.send({
      type: 'location', latitude: 42 + distance / 111_195, longitude: -71, accuracy: precision, timestamp,
    });
    client.fix();
    await client.next(message => message.type === 'nearby' && message.accuracy === accuracy);
    client.clear();
    return client;
  }
  return { app, origin, connect, discover };
}
const error = (client, code) => client.next(message => message.type === 'error' && message.code === code);
const nearby = (client, match) => client.next(message => message.type === 'nearby' && match(message));
async function invite(from, to) {
  from.send({ type: 'meet', peerId: to.id });
  const sent = await from.next(message => message.type === 'meet_sent');
  const received = await to.next(message => message.type === 'meet_request');
  assert.equal(sent.requestId, received.requestId);
  return sent;
}

test('discovery filters at ten meters, marks uncertainty, and exposes no raw locations or fake peers', async t => {
  const { discover } = await setup(t);
  const a = await discover('Alex');
  const empty = await nearby(a, message => message.peers.length === 0);
  assert.equal(empty.accuracy, 1);
  const b = await discover('Blair', 5, 1);
  const c = await discover('Casey', 11, 1);
  const broad = await discover('Broad fix', 2, 40);
  const broadNotice = await nearby(broad, message => message.accuracy === 40);
  assert.match(broadNotice.notice, /broad/);
  assert.deepEqual(broadNotice.peers, []);
  a.clear();
  const found = await nearby(a, message => message.peers.length > 0);
  assert.deepEqual(found.peers, [{ id: b.id, name: 'Blair', distanceMeters: 5, uncertain: false }]);
  assert.ok(!found.peers.some(peer => peer.id === c.id || peer.id === broad.id));
  assert.deepEqual(Object.keys(found).sort(), ['accuracy', 'notice', 'peers', 'type']);
  assert.ok(!/latitude|longitude|timestamp|bearing|playerToken/.test(JSON.stringify(found)));
  b.fix(5, 8, Date.now() + 1);
  const uncertain = await nearby(a, message => message.peers.some(peer => peer.id === b.id && peer.uncertain));
  assert.equal(uncertain.peers[0].distanceMeters, 5);
});

test('location validation rejects stale, future, nonfinite, out-of-range and out-of-order fixes', async t => {
  const { discover } = await setup(t);
  const a = await discover('Alex');
  const b = await discover('Blair', 4);
  const latest = Date.now() + 100;
  a.fix(0, 1, latest);
  await nearby(a, message => message.peers.some(peer => peer.id === b.id));
  a.fix(100, 1, latest - 1);
  await error(a, 'outdated_location');
  a.fix(100, 1, Date.now() - 21_000);
  await error(a, 'invalid_location_time');
  a.fix(100, 1, Date.now() + 31_000);
  await error(a, 'invalid_location_time');
  a.send({ type: 'location', latitude: 91, longitude: 0, accuracy: 1, timestamp: Date.now() });
  await error(a, 'invalid_message');
  a.clear();
  assert.equal((await nearby(a, message => message.peers.length === 1)).peers[0].id, b.id);
  assert.equal(parseNearbyMessage({ type: 'location', latitude: Infinity, longitude: 0, accuracy: 1, timestamp: 123 }), null);
  assert.equal(parseNearbyMessage({ type: 'location', latitude: 0, longitude: 181, accuracy: 1, timestamp: 123 }), null);
  assert.equal(parseNearbyMessage({ type: 'location', latitude: 0, longitude: 0, accuracy: -1, timestamp: 123 }), null);
  assert.equal(parseNearbyMessage({ type: 'pause', latitude: 1 }), null);
  assert.equal(parseNearbyMessage({ type: ['pause'] }), null);
  assert.ok(Math.abs(distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }) - 222.39) < 0.1);
});

test('pause and disconnect immediately remove presence, location, and pending invitations', async t => {
  const { discover } = await setup(t);
  const a = await discover('Alex');
  const b = await discover('Blair', 5);
  const request = await invite(a, b);
  a.clear(); b.clear();
  b.send({ type: 'pause' });
  const closed = await a.next(message => message.type === 'request_closed');
  assert.equal(closed.requestId, request.requestId);
  assert.deepEqual((await nearby(a, message => message.peers.length === 0)).peers, []);
  const paused = await nearby(b, message => message.accuracy === null);
  assert.match(paused.notice, /paused/);
  b.fix();
  await error(b, 'not_discovering');
  b.send({ type: 'discover', name: 'Blair' });
  await b.next(message => message.type === 'discovery_ready');
  b.fix(5, 1, Date.now() + 1);
  await nearby(a, message => message.peers.length === 1);
  await invite(a, b);
  a.clear();
  const closedSocket = once(b.ws, 'close'); b.ws.close(); await closedSocket;
  await a.next(message => message.type === 'request_closed');
  await nearby(a, message => message.peers.length === 0);
});

test('freshness expiry clears location and cancels pending requests without another client update', async t => {
  const { discover } = await setup(t, { nearby: { freshMs: 180, tickMs: 10 } });
  const a = await discover('Alex');
  const b = await discover('Blair', 5);
  await invite(a, b);
  const expired = await a.next(message => message.type === 'request_closed');
  assert.match(expired.reason, /fresh/);
  const cleared = await nearby(a, message => message.accuracy === null);
  assert.deepEqual(cleared.peers, []);
  assert.match(cleared.notice, /fresh/);
});

test('requests are exclusive, can be declined, and expire; acceptance requires fresh nearby estimates', async t => {
  const { discover } = await setup(t, { nearby: { requestTtlMs: 100 } });
  const a = await discover('Alex');
  const b = await discover('Blair', 5);
  const c = await discover('Casey', 3);
  const first = await invite(a, b);
  c.send({ type: 'meet', peerId: b.id });
  await error(c, 'request_pending');
  c.send({ type: 'respond', requestId: first.requestId, accept: true });
  await error(c, 'request_unavailable');
  a.send({ type: 'respond', requestId: first.requestId, accept: true });
  await error(a, 'invalid_response');
  b.send({ type: 'respond', requestId: first.requestId, accept: false });
  assert.match((await a.next(message => message.type === 'request_closed' && message.requestId === first.requestId)).reason, /declined/);
  const second = await invite(a, b);
  assert.match((await a.next(message => message.type === 'request_closed' && message.requestId === second.requestId)).reason, /expired/);
  b.send({ type: 'respond', requestId: second.requestId, accept: true });
  await error(b, 'request_unavailable');
  const third = await invite(a, b);
  b.fix(50, 1, Date.now() + 1);
  await a.next(message => message.type === 'request_closed' && message.requestId === third.requestId);
  b.send({ type: 'respond', requestId: third.requestId, accept: true });
  await error(b, 'request_unavailable');
  a.send({ type: 'meet', peerId: b.id });
  await error(a, 'peer_unavailable');
});

test('accepted invitations reserve private memberships and mutual dap confirmation grants one bond', async t => {
  const { discover, connect } = await setup(t);
  const a = await discover('Alex');
  const b = await discover('Blair', 5);
  const observer = await discover('Casey', 3);
  const request = await invite(a, b);
  b.send({ type: 'respond', requestId: request.requestId, accept: true });
  const ma = await a.next(message => message.type === 'matched');
  const mb = await b.next(message => message.type === 'matched');
  assert.equal(ma.roomCode, mb.roomCode);
  assert.notEqual(ma.playerToken, mb.playerToken);
  observer.clear();
  assert.deepEqual((await nearby(observer, message => message.peers.length === 0)).peers, []);
  assert.equal((await nearby(a, message => message.accuracy === null)).accuracy, null);
  const outsider = await connect('/play');
  outsider.send({ type: 'join', name: 'Intruder', roomCode: ma.roomCode });
  await error(outsider, 'private_room');
  const pa = await connect('/play');
  pa.send({ type: 'join', name: 'Alex', roomCode: ma.roomCode, playerToken: ma.playerToken });
  const wa = await pa.next(message => message.type === 'welcome');
  assert.equal(wa.snapshot.players.length, 2);
  assert.deepEqual(wa.snapshot.encounter, { kind: 'nearby', dapConfirmed: [], dapComplete: false });
  pa.send({ type: 'confirm_dap' });
  await error(pa, 'friend_disconnected');
  const pb = await connect('/play');
  pb.send({ type: 'join', name: 'Blair', roomCode: mb.roomCode, playerToken: mb.playerToken });
  const wb = await pb.next(message => message.type === 'welcome');
  assert.ok(wb.snapshot.players.every(player => player.connected));
  assert.ok(!JSON.stringify(wb.snapshot).includes(ma.playerToken));
  assert.ok(!JSON.stringify(wb.snapshot).includes(mb.playerToken));
  pa.send({ type: 'confirm_dap' });
  const first = await pb.next(message => message.type === 'snapshot' && message.snapshot.encounter.dapConfirmed.length === 1);
  assert.equal(first.snapshot.bond, 0);
  assert.equal(first.snapshot.encounter.dapConfirmed[0], wa.playerId);
  pa.send({ type: 'confirm_dap' });
  pb.send({ type: 'confirm_dap' });
  const completed = await pa.next(message => message.type === 'snapshot' && message.snapshot.encounter.dapComplete);
  assert.equal(completed.snapshot.bond, 1);
  assert.equal(completed.snapshot.encounter.dapConfirmed.length, 2);
  pa.send({ type: 'confirm_dap' });
  pb.send({ type: 'confirm_dap' });
  pa.clear();
  const unchanged = await pa.next(message => message.type === 'snapshot' && message.snapshot.encounter.dapComplete);
  assert.equal(unchanged.snapshot.bond, 1);
  assert.equal(unchanged.snapshot.quest.played, false, 'participant confirmation does not fabricate pet-game progress');
});

test('nearby reservations expire and ordinary code rooms cannot claim a nearby quest', async t => {
  const { discover, connect } = await setup(t, { rejoinGraceMs: 50, tickMs: 10 });
  const a = await discover('Alex');
  const b = await discover('Blair', 5);
  const request = await invite(a, b);
  b.send({ type: 'respond', requestId: request.requestId, accept: true });
  const membership = await a.next(message => message.type === 'matched');
  await new Promise(resolve => setTimeout(resolve, 80));
  const play = await connect('/play');
  play.send({ type: 'join', name: 'Alex', roomCode: membership.roomCode, playerToken: membership.playerToken });
  await error(play, 'invalid_token');
  play.send({ type: 'join', name: 'Intruder', roomCode: membership.roomCode });
  await error(play, 'private_room');
  play.send({ type: 'create', name: 'Alex' });
  const ordinary = await play.next(message => message.type === 'welcome');
  assert.equal(ordinary.snapshot.encounter, undefined);
  play.send({ type: 'confirm_dap' });
  await error(play, 'not_nearby_encounter');
});

test('discovery shares origin restrictions and enforces socket and payload bounds', async t => {
  const { origin, connect } = await setup(t, { allowedOrigins: ['https://friends.example'], nearby: { maxConnections: 1 } });
  const blocked = new WebSocket(origin + '/nearby', { origin: 'https://other.example' });
  assert.match((await once(blocked, 'error'))[0].message, /403/);
  const accepted = await connect('/nearby', { origin: 'https://friends.example' });
  accepted.send({ type: 'discover', name: 'Alex' });
  await accepted.next(message => message.type === 'discovery_ready');
  const full = new WebSocket(origin + '/nearby', { origin: 'https://friends.example' });
  assert.match((await once(full, 'error'))[0].message, /503/);
  const closed = once(accepted.ws, 'close');
  accepted.ws.send('x'.repeat(2048));
  assert.equal((await closed)[0], 1009);
});

test('discovery returns at most eight closest peers in distance order', async t => {
  const { discover } = await setup(t);
  const viewer = await discover('Viewer');
  const peers = [];
  for (let index = 9; index >= 1; index--) peers.push({ client: await discover(`Pet ${index}`, index), meters: index });
  viewer.clear();
  const found = await nearby(viewer, message => message.peers.length === 8);
  assert.deepEqual(found.peers.map(peer => peer.id), peers.filter(peer => peer.meters <= 8).reverse().map(peer => peer.client.id));
});

test('requester cancellation, broad location changes, and room capacity prevent a match', async t => {
  const { discover } = await setup(t, { maxRooms: 0 });
  const a = await discover('Alex');
  const b = await discover('Blair', 5);
  const canceled = await invite(a, b);
  a.send({ type: 'respond', requestId: canceled.requestId, accept: false });
  assert.match((await b.next(message => message.type === 'request_closed' && message.requestId === canceled.requestId)).reason, /canceled/);
  const broad = await invite(a, b);
  b.fix(5, 40, Date.now() + 1);
  await a.next(message => message.type === 'request_closed' && message.requestId === broad.requestId);
  b.fix(5, 1, Date.now() + 2);
  await nearby(a, message => message.peers.length === 1);
  const full = await invite(a, b);
  b.send({ type: 'respond', requestId: full.requestId, accept: true });
  assert.match((await a.next(message => message.type === 'request_closed' && message.requestId === full.requestId)).reason, /full/);
  a.clear();
  assert.equal((await nearby(a, message => message.peers.length === 1)).peers[0].id, b.id);
});
