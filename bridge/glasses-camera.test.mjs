import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import WebSocket from 'ws';
import { createPlayServer } from './play-server.mjs';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
async function setup(t, options = {}) {
  let clock = Date.now();
  const app = createPlayServer({ ...options, glassesCamera: { ...options.glassesCamera, now: () => clock } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function join(entry = { type: 'lobby', name: 'Camera player' }) {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/play', {
      ...(options.allowedOrigins?.length ? { origin: options.allowedOrigins[0] } : {}),
    });
    await once(socket, 'open');
    const received = new Promise(resolve => socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'welcome') resolve(message);
    }));
    socket.send(JSON.stringify(entry));
    const { roomCode, playerToken, playerId } = await received;
    return { auth: { roomCode, playerToken }, playerId, socket };
  }
  async function call(route, body, token, headers = {}) {
    const response = await fetch(origin + '/glasses/' + route, {
      method: route === 'command' ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers },
      ...(route !== 'command' ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function pair(auth) {
    const result = await call('pair', auth);
    assert.equal(result.status, 200);
    const claimed = await call('claim', { code: result.body.code });
    assert.equal(claimed.status, 200);
    const token = claimed.body.cameraToken;
    assert.deepEqual((await call('command', null, token)).body, { command: null });
    return token;
  }
  return { app, origin, join, call, pair, advance: delta => { clock += delta; } };
}

test('camera pairing requires a connected owner, claims once, and cannot authorize a game socket', async t => {
  const { origin, join, call } = await setup(t);
  assert.equal((await call('pair', {})).status, 401);
  const { auth } = await join();
  assert.equal((await call('pair', { ...auth, playerToken: 'a'.repeat(48) })).status, 401);
  const pairing = await call('pair', auth);
  assert.equal(pairing.status, 200);
  assert.match(pairing.body.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.ok(pairing.body.expiresAt > Date.now());
  const claimed = await call('claim', { code: pairing.body.code.toLowerCase() });
  assert.equal(claimed.status, 200);
  assert.match(claimed.body.cameraToken, /^[a-f0-9]{48}$/);
  assert.equal((await call('claim', { code: pairing.body.code })).status, 401);
  assert.equal((await call('status', { ...auth, playerToken: claimed.body.cameraToken })).status, 401);
  assert.equal((await call('command', null, auth.playerToken)).status, 401);
  const intruder = new WebSocket(origin.replace('http:', 'ws:') + '/play');
  await once(intruder, 'open');
  const refused = once(intruder, 'message');
  intruder.send(JSON.stringify({ type: 'lobby', name: 'Camera token', playerToken: claimed.body.cameraToken }));
  assert.equal(JSON.parse((await refused)[0]).code, 'invalid_token');
  intruder.close();
});

test('code expiry and owner disconnect revoke unclaimed pairing codes', async t => {
  const { join, call, advance } = await setup(t);
  const { auth, socket } = await join();
  const expired = await call('pair', auth);
  advance(5 * 60_000);
  assert.equal((await call('claim', { code: expired.body.code })).status, 401);
  const pending = await call('pair', auth);
  socket.close(); await once(socket, 'close');
  assert.equal((await call('claim', { code: pending.body.code })).status, 401);
  assert.equal((await call('status', auth)).status, 401);
});

test('same authenticated player reconnect retains the camera binding but erases evidence and denies offline capture/results', async t => {
  const { join, call, pair } = await setup(t);
  const first = await join(), other = await join();
  const token = await pair(first.auth);
  const { requestId } = (await call('capture', { ...first.auth, kind: 'photo', questId: 'touchGrass' })).body;
  await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token);
  first.socket.close(); await once(first.socket, 'close');
  const canceled = await call('command', null, token);
  assert.equal(canceled.status, 200, 'the paired phone can receive cancellation while the game reconnects');
  assert.equal(canceled.body.command.kind, 'cancel');
  assert.equal(canceled.body.command.requestId, requestId);
  assert.equal((await call('capture', { ...first.auth, kind: 'photo', questId: 'touchGrass' })).status, 401);
  assert.equal((await call('status', first.auth)).status, 401);
  assert.equal((await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 409);
  assert.equal((await call('status', other.auth)).body.paired, false);
  assert.equal((await call('capture', { ...other.auth, kind: 'photo', questId: 'touchGrass' })).status, 409);
  const resumed = await join({ type: 'join', ...first.auth, name: 'Returned player' });
  assert.equal(resumed.playerId, first.playerId);
  assert.deepEqual((await call('status', resumed.auth)).body,
    { paired: true, connected: true, requestId: null, status: 'idle' });
  assert.equal((await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 409,
    'an old preview cannot reappear after reconnect');
  const next = await call('capture', { ...resumed.auth, kind: 'photo', questId: 'touchGrass' });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.requestId, requestId);
  assert.equal((await call('result', { requestId: next.body.requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 200);
});

test('a result upload spanning disconnect and reconnect cannot restore canceled evidence', async t => {
  const { app, origin, join, call, pair } = await setup(t);
  const first = await join();
  const token = await pair(first.auth);
  const { requestId } = (await call('capture', { ...first.auth, kind: 'photo', questId: 'touchGrass' })).body;
  const body = JSON.stringify({ requestId, status: 'ready', photoDataUrl: IMAGE });
  const received = once(app.server, 'request');
  const upload = httpRequest(origin + '/glasses/result', { method: 'POST', headers: {
    authorization: 'Bearer ' + token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
  } });
  const finished = new Promise((resolve, reject) => {
    upload.on('error', reject);
    upload.on('response', response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
  });
  upload.write(body.slice(0, 20));
  await received;
  first.socket.close(); await once(first.socket, 'close');
  const resumed = await join({ type: 'join', ...first.auth, name: 'Reconnected' });
  upload.end(body.slice(20));
  assert.equal((await finished).status, 409);
  const status = await call('status', resumed.auth);
  assert.equal(status.body.paired, true);
  assert.equal(status.body.status, 'idle');
  assert.equal(status.body.photoDataUrl, undefined);
  assert.equal(status.body.requestId, null);
});

test('offline polling never extends the bounded camera reconnect grace', async t => {
  const { join, call, pair, advance } = await setup(t, { glassesCamera: { disconnectGraceMs: 1000 } });
  const first = await join();
  const token = await pair(first.auth);
  first.socket.close(); await once(first.socket, 'close');
  advance(900);
  assert.equal((await call('command', null, token)).status, 200);
  advance(100);
  assert.equal((await call('command', null, token)).status, 401);
  const resumed = await join({ type: 'join', ...first.auth, name: 'Returning too late' });
  assert.equal(resumed.playerId, first.playerId);
  assert.equal((await call('status', resumed.auth)).body.paired, false);
});

test('active replacement and intentional leave revoke camera authority immediately', async t => {
  const { join, call, pair } = await setup(t);
  const first = await join();
  const token = await pair(first.auth);
  const replaced = once(first.socket, 'close');
  const replacement = await join({ type: 'join', ...first.auth, name: 'Replacement' });
  assert.equal((await replaced)[0], 4001);
  assert.equal((await call('command', null, token)).status, 401);
  assert.equal((await call('status', replacement.auth)).body.paired, false);
  const newToken = await pair(replacement.auth);
  replacement.socket.send(JSON.stringify({ type: 'leave' }));
  replacement.socket.close(); await once(replacement.socket, 'close');
  assert.equal((await call('command', null, newToken)).status, 401);
});

test('expired game membership cannot transfer a retained binding to a new player with the saved pet token', async t => {
  const { join, call, pair } = await setup(t, { tickMs: 5, rejoinGraceMs: 25 });
  const first = await join();
  const token = await pair(first.auth);
  first.socket.close(); await once(first.socket, 'close');
  await new Promise(resolve => setTimeout(resolve, 40));
  const replacement = await join({ type: 'lobby', playerToken: first.auth.playerToken, name: 'New membership' });
  assert.notEqual(replacement.playerId, first.playerId);
  assert.equal(replacement.auth.playerToken, first.auth.playerToken);
  assert.equal((await call('command', null, token)).status, 401);
  assert.equal((await call('status', replacement.auth)).body.paired, false);
});

test('capture waits for a recent camera poll and never routes another player’s evidence', async t => {
  const { join, call, advance } = await setup(t);
  const a = await join(), b = await join();
  const p = await call('pair', a.auth);
  const token = (await call('claim', { code: p.body.code })).body.cameraToken;
  const capture = { ...a.auth, kind: 'photo', questId: 'touchGrass' };
  assert.equal((await call('capture', capture)).status, 409, 'claiming is not proof the camera is polling');
  await call('command', null, token);
  const request = await call('capture', capture);
  assert.equal(request.status, 200);
  const command = { id: request.body.requestId, kind: 'photo', questId: 'touchGrass' };
  assert.deepEqual((await call('command', null, token)).body.command, command);
  assert.deepEqual((await call('command', null, token)).body.command, command, 'polling does not lose uncompleted work');
  assert.deepEqual((await call('status', b.auth)).body, { paired: false, connected: false, requestId: null, status: 'idle' });
  assert.equal((await call('capture', { ...b.auth, kind: 'photo', questId: 'touchGrass' })).status, 409);
  await call('discard', a.auth);
  advance(6_000);
  assert.equal((await call('status', a.auth)).body.connected, false);
  assert.equal((await call('capture', capture)).status, 409);
});

test('photo completion exposes private review data only, and discard clears it', async t => {
  let verifications = 0;
  const { join, call, pair } = await setup(t, { photoVerifier: { configured: true, async verify() { verifications++; } } });
  const { auth } = await join();
  const token = await pair(auth);
  const { requestId } = (await call('capture', { ...auth, kind: 'photo', questId: 'touchGrass' })).body;
  const result = { requestId, status: 'ready', photoDataUrl: IMAGE };
  assert.equal((await call('result', result, token)).status, 200);
  assert.equal(verifications, 0, 'capture must not submit evidence for AI verification');
  assert.deepEqual((await call('command', null, token)).body, { command: null });
  assert.deepEqual((await call('status', auth)).body, { paired: true, connected: true, requestId, status: 'ready', photoDataUrl: IMAGE });
  assert.equal((await call('result', result, token)).status, 409, 'duplicate results cannot replace reviewed evidence');
  await call('discard', auth);
  assert.deepEqual((await call('status', auth)).body, { paired: true, connected: true, requestId: null, status: 'idle' });
  const released = (await call('command', null, token)).body.command;
  assert.equal(released.kind, 'cancel'); assert.equal(released.requestId, requestId);
  assert.notEqual(released.id, requestId, 'discard also clears the completed preview on the native phone');
});

test('clip requests validate sequence evidence and reject mismatched or oversized results', async t => {
  const { join, call, pair, advance } = await setup(t);
  const { auth } = await join();
  const token = await pair(auth);
  assert.equal((await call('capture', { ...auth, kind: 'photo', questId: 'dapHandshake' })).status, 400);
  const { requestId } = (await call('capture', { ...auth, kind: 'clip', questId: 'dapHandshake' })).body;
  const send = input => call('result', { requestId, status: 'ready', ...input }, token);
  assert.equal((await send({ photoDataUrl: IMAGE })).status, 400);
  assert.equal((await send({ frames: [IMAGE, IMAGE], durationSeconds: 6 })).status, 400);
  assert.equal((await send({ frames: Array(13).fill(IMAGE), durationSeconds: 6 })).status, 400);
  assert.equal((await send({ frames: Array(3).fill('data:image/jpeg;base64,AAAA'), durationSeconds: 6 })).status, 400);
  assert.equal((await send({ frames: Array(3).fill(IMAGE), durationSeconds: 30 })).status, 400);
  advance(2_000);
  const frame = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(1_400_000)]).toString('base64');
  assert.equal((await send({ frames: [frame, frame, frame], durationSeconds: 6 })).status, 400, 'combined decoded evidence over4MiB is rejected');
  assert.equal((await send({ frames: [IMAGE, IMAGE, IMAGE], durationSeconds: 6 })).status, 200);
  const state = (await call('status', auth)).body;
  assert.deepEqual(state.frames, [IMAGE, IMAGE, IMAGE]); assert.equal(state.durationSeconds, 6);
});

test('discard sends a distinct cancel command and rejects late camera results', async t => {
  const { join, call, pair } = await setup(t);
  const { auth } = await join();
  const token = await pair(auth);
  const { requestId } = (await call('capture', { ...auth, kind: 'clip', questId: 'dapHandshake' })).body;
  await call('discard', auth);
  const command = (await call('command', null, token)).body.command;
  assert.equal(command.kind, 'cancel'); assert.equal(command.requestId, requestId);
  assert.notEqual(command.id, requestId);
  assert.equal((await call('result', { requestId, status: 'ready', frames: [IMAGE, IMAGE, IMAGE], durationSeconds: 6 }, token)).status, 409);
  const next = await call('capture', { ...auth, kind: 'photo', questId: 'touchGrass' });
  assert.notEqual(next.body.requestId, requestId);
  assert.equal((await call('command', null, token)).body.command.id, next.body.requestId);
});

test('capture timeout cancels work, preview expiry clears images, and idle sessions expire', async t => {
  const { join, call, pair, advance } = await setup(t);
  const { auth } = await join();
  const token = await pair(auth);
  const initial = await call('capture', { ...auth, kind: 'photo', questId: 'touchGrass' });
  advance(30_000);
  assert.equal((await call('status', auth)).body.status, 'error');
  assert.equal((await call('command', null, token)).body.command.kind, 'cancel');
  assert.equal((await call('result', { requestId: initial.body.requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 409);
  const next = await call('capture', { ...auth, kind: 'photo', questId: 'touchGrass' });
  await call('result', { requestId: next.body.requestId, status: 'ready', photoDataUrl: IMAGE }, token);
  advance(5 * 60_000);
  const expired = (await call('status', auth)).body;
  assert.equal(expired.status, 'error'); assert.equal(expired.photoDataUrl, undefined);
  const released = (await call('command', null, token)).body.command;
  assert.equal(released.kind, 'cancel'); assert.equal(released.requestId, next.body.requestId,
    'expiry must release the completed native preview too');
  advance(60 * 60_000);
  assert.equal((await call('command', null, token)).status, 401);
  assert.equal((await call('status', auth)).body.paired, false);
});

test('re-pairing revokes the previous camera and drops old previews', async t => {
  const { join, call, pair } = await setup(t);
  const { auth } = await join();
  const token = await pair(auth);
  const { requestId } = (await call('capture', { ...auth, kind: 'photo', questId: 'touchGrass' })).body;
  await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token);
  const second = await pair(auth);
  assert.notEqual(second, token);
  assert.equal((await call('command', null, token)).status, 401);
  assert.equal((await call('status', auth)).body.photoDataUrl, undefined);
});

test('total preview storage is bounded and camera failures are sanitized for the game', async t => {
  const { join, call, pair } = await setup(t, { glassesCamera: { maxEvidenceBytes: 1 } });
  const { auth } = await join();
  const token = await pair(auth);
  const { requestId } = (await call('capture', { ...auth, kind: 'photo', questId: 'touchGrass' })).body;
  assert.equal((await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 503);
  assert.equal((await call('result', { requestId, status: 'error', error: '\0' + 'x'.repeat(300) }, token)).status, 200);
  const failed = (await call('status', auth)).body;
  assert.equal(failed.status, 'error'); assert.equal(failed.error, 'x'.repeat(200));
});

test('pairing requests and code guesses are rate limited', async t => {
  const { join, call } = await setup(t);
  const { auth } = await join();
  for (let i = 0; i < 3; i++) assert.equal((await call('pair', auth)).status, 200);
  assert.equal((await call('pair', auth)).status, 429);
  for (let i = 0; i < 10; i++) assert.equal((await call('claim', { code: 'AAAAAAAA' })).status, 401);
  assert.equal((await call('claim', { code: 'AAAAAAAA' })).status, 429);
});

test('camera routes enforce browser origins, support preflight, and admit authenticated native requests', async t => {
  const { origin, join, call, pair } = await setup(t, { allowedOrigins: ['https://kith.example'] });
  const { auth } = await join();
  assert.equal((await call('pair', auth, null, { origin: 'https://other.example' })).status, 403);
  const token = await pair(auth);
  assert.equal((await call('command', null, token)).status, 200, 'native requests have no Origin');
  const state = await call('status', auth, null, { origin: 'https://kith.example' });
  assert.equal(state.headers.get('access-control-allow-origin'), 'https://kith.example');
  assert.equal(state.headers.get('cache-control'), 'no-store');
  const preflight = await fetch(origin + '/glasses/result', { method: 'OPTIONS', headers: { origin: 'https://kith.example' } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);
});
