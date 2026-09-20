import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import WebSocket from 'ws';
import { createPlayServer } from './play-server.mjs';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const READY = { cameraReady: true, cameraState: 'ready' };
const READY_STATUS = { ...READY, captureAvailable: true };
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
    const received = new Promise((resolve, reject) => socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'welcome') resolve(message);
      else if (message.type === 'error') reject(new Error(message.message || message.code));
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
  async function pair(auth, ready = true) {
    const result = await call('pair', auth);
    assert.equal(result.status, 200);
    const claimed = await call('claim', { code: result.body.code });
    assert.equal(claimed.status, 200);
    const token = claimed.body.cameraToken;
    assert.deepEqual((await call('command', null, token)).body, { command: null });
    if (ready) assert.equal((await call('heartbeat', READY, token)).status, 200);
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

test('same authenticated player reconnect recovers private ready evidence while offline access and new captures stay denied', async t => {
  const { join, call, pair } = await setup(t);
  const first = await join(), other = await join();
  const token = await pair(first.auth);
  const { requestId } = (await call('capture', { ...first.auth, kind: 'photo', questId: 'touchGrass' })).body;
  await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token);
  first.socket.close(); await once(first.socket, 'close');
  const retained = await call('command', null, token);
  assert.equal(retained.status, 200, 'the paired phone remains linked while the game reconnects');
  assert.equal(retained.body.command, null);
  assert.equal((await call('capture', { ...first.auth, kind: 'photo', questId: 'touchGrass' })).status, 401);
  assert.equal((await call('status', first.auth)).status, 401);
  assert.equal((await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 409);
  assert.equal((await call('status', other.auth)).body.paired, false);
  assert.equal((await call('capture', { ...other.auth, kind: 'photo', questId: 'touchGrass' })).status, 409);
  const resumed = await join({ type: 'join', ...first.auth, name: 'Returned player' });
  assert.equal(resumed.playerId, first.playerId);
  const resumedStatus = (await call('status', resumed.auth)).body;
  assert.equal(resumedStatus.paired, true); assert.equal(resumedStatus.connected, true);
  assert.equal(resumedStatus.requestId, requestId); assert.equal(resumedStatus.status, 'ready');
  assert.equal(resumedStatus.photoDataUrl, IMAGE); assert.equal(resumedStatus.questId, 'touchGrass');
  assert.equal(resumedStatus.kind, 'photo'); assert.equal(typeof resumedStatus.captureAt, 'number');
  assert.equal(resumedStatus.cameraReady, false, 'reconnect requires a fresh camera health report');
  assert.equal((await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 409,
    'a completed request cannot replace the retained review after reconnect');
  assert.equal((await call('heartbeat', READY, token)).status, 200);
  const next = await call('capture', { ...resumed.auth, kind: 'photo', questId: 'touchGrass' });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.requestId, requestId);
  assert.equal((await call('result', { requestId: next.body.requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 200);
});

test('a result upload spanning display suspension and same-player reconnect completes the authorized request', async t => {
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
  assert.equal((await finished).status, 200);
  const status = await call('status', resumed.auth);
  assert.equal(status.body.paired, true);
  assert.equal(status.body.status, 'ready');
  assert.equal(status.body.photoDataUrl, IMAGE);
  assert.equal(status.body.requestId, requestId);
});

test('offline polling never extends the bounded camera reconnect grace', async t => {
  const { join, call, pair, advance } = await setup(t, { glassesCamera: { disconnectGraceMs: 1000 } });
  const first = await join();
  const token = await pair(first.auth);
  first.socket.close(); await once(first.socket, 'close');
  assert.equal((await call('status', first.auth)).status, 401, 'observe server detach before advancing the test clock');
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
  assert.equal((await call('status', a.auth)).body.cameraReady, false, 'polling alone does not prove a camera stream is ready');
  await call('heartbeat', READY, token);
  const request = await call('capture', capture);
  assert.equal(request.status, 200);
  const command = { id: request.body.requestId, kind: 'photo', questId: 'touchGrass' };
  assert.deepEqual((await call('command', null, token)).body.command, command);
  assert.deepEqual((await call('command', null, token)).body.command, command, 'polling does not lose uncompleted work');
  assert.deepEqual((await call('status', b.auth)).body, { paired: false, connected: false, requestId: null, status: 'idle', cameraReady: false, captureAvailable: false, cameraState: 'idle' });
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
  const ready = (await call('status', auth)).body;
  assert.deepEqual(ready, { paired: true, connected: true, requestId, status: 'ready', photoDataUrl: IMAGE,
    questId: 'touchGrass', kind: 'photo', captureAt: ready.captureAt, ...READY_STATUS });
  assert.equal(typeof ready.captureAt, 'number');
  assert.equal((await call('result', result, token)).status, 409, 'duplicate results cannot replace reviewed evidence');
  await call('discard', auth);
  assert.deepEqual((await call('status', auth)).body, { paired: true, connected: true, requestId: null, status: 'idle', ...READY_STATUS });
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
  advance(60_000);
  assert.equal((await call('status', auth)).body.status, 'error');
  assert.equal((await call('command', null, token)).body.command.kind, 'cancel');
  assert.equal((await call('result', { requestId: initial.body.requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 409);
  await call('heartbeat', READY, token);
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

test('capture requires a fresh ready camera heartbeat independently of phone polling', async t => {
  const { join, call, pair, advance } = await setup(t);
  const { auth } = await join();
  const token = await pair(auth, false);
  const capture = { ...auth, kind: 'clip', questId: 'dapHandshake' };
  const legacy = await call('capture', capture);
  assert.equal(legacy.status, 409); assert.match(legacy.body.error, /updated Kith Camera/);
  assert.equal((await call('heartbeat', READY, auth.playerToken)).status, 401);
  assert.equal((await call('heartbeat', { cameraReady: true, cameraState: 'starting' }, token)).status, 400);
  assert.equal((await call('heartbeat', { cameraReady: false, cameraState: 'permission', message: '\0Allow camera access' }, token)).status, 200);
  const permission = (await call('status', auth)).body;
  assert.equal(permission.connected, true); assert.equal(permission.cameraReady, false);
  assert.equal(permission.cameraState, 'permission'); assert.equal(permission.cameraMessage, 'Allow camera access');
  assert.equal((await call('capture', capture)).status, 409);
  await call('heartbeat', READY, token);
  assert.equal((await call('status', auth)).body.cameraReady, true);
  assert.equal((await call('capture', capture)).status, 200);
  await call('discard', auth);
  advance(6_000); await call('command', null, token);
  const stale = (await call('status', auth)).body;
  assert.equal(stale.connected, true); assert.equal(stale.cameraReady, false); assert.equal(stale.cameraState, 'paused');
  advance(5_001); await call('heartbeat', READY, token);
  assert.equal((await call('status', auth)).body.cameraReady, false, 'fresh camera frames do not replace the relay poll');
  await call('command', null, token);
  assert.equal((await call('status', auth)).body.cameraReady, true);
});

test('requested clip preview stays owner-private, replaces frames, rejects replay, and expires', async t => {
  const { join, call, pair, advance } = await setup(t);
  const first = await join(), other = await join();
  const token = await pair(first.auth), otherToken = await pair(other.auth);
  const capture = { ...first.auth, kind: 'clip', questId: 'dapHandshake' };
  const requestId = (await call('capture', capture)).body.requestId;
  const preview = { requestId, sequence: 1, elapsedSeconds: 0, previewDataUrl: IMAGE };
  assert.equal((await call('progress', preview)).status, 401);
  assert.equal((await call('progress', preview, first.auth.playerToken)).status, 401);
  assert.equal((await call('progress', preview, otherToken)).status, 409);
  assert.equal((await call('progress', preview, token)).status, 200);
  const initial = (await call('status', first.auth)).body;
  assert.equal(initial.status, 'capturing'); assert.equal(initial.previewDataUrl, IMAGE);
  assert.equal(initial.sequence, 1); assert.equal(initial.elapsedSeconds, 0); assert.equal(typeof initial.previewAt, 'number');
  assert.equal((await call('status', other.auth)).body.previewDataUrl, undefined);
  assert.equal((await call('progress', preview, token)).status, 409, 'replayed frame cannot extend freshness');
  advance(500);
  const jpeg = 'data:image/jpeg;base64,/9j/';
  assert.equal((await call('progress', { ...preview, sequence: 2, elapsedSeconds: 0.5, previewDataUrl: jpeg }, token)).status, 200);
  const latest = (await call('status', first.auth)).body;
  assert.equal(latest.previewDataUrl, jpeg); assert.equal(latest.sequence, 2); assert.equal(latest.elapsedSeconds, 0.5);
  assert.equal(latest.previewAt - initial.previewAt, 500);
  advance(500);
  assert.equal((await call('progress', { ...preview, sequence: 3, elapsedSeconds: 0.1 }, token)).status, 409);
  advance(2_500);
  const expired = (await call('status', first.auth)).body;
  assert.equal(expired.previewDataUrl, undefined); assert.equal(expired.sequence, undefined);
  assert.equal(expired.status, 'capturing', 'preview expiry does not submit or finish the capture');
  assert.equal((await call('progress', { ...preview, sequence: 2, elapsedSeconds: 3.5 }, token)).status, 409,
    'expiry must not erase replay protection');
  advance(2_000); await call('command', null, token);
  assert.equal((await call('progress', { ...preview, sequence: 4, elapsedSeconds: 5.5 }, token)).status, 409,
    'the camera heartbeat must still be fresh');
  await call('heartbeat', READY, token);
  assert.equal((await call('progress', { ...preview, sequence: 4, elapsedSeconds: 5.5 }, token)).status, 200);
});

test('live preview is restricted to clip capture and validates type, size, time, and rate', async t => {
  const { join, call, pair, advance } = await setup(t);
  const { auth } = await join();
  const token = await pair(auth);
  const photoId = (await call('capture', { ...auth, kind: 'photo', questId: 'touchGrass' })).body.requestId;
  const preview = { sequence: 1, elapsedSeconds: 0, previewDataUrl: IMAGE };
  assert.equal((await call('progress', { ...preview, requestId: photoId }, token)).status, 400);
  await call('discard', auth);
  const requestId = (await call('capture', { ...auth, kind: 'clip', questId: 'dapHandshake' })).body.requestId;
  const invalids = [
    { previewDataUrl: 'data:image/svg+xml;base64,AAAA' },
    { previewDataUrl: 'data:image/jpeg;base64,AAAA' },
    { previewDataUrl: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(100 * 1024)]).toString('base64') },
    { elapsedSeconds: -1 }, { elapsedSeconds: 12 }, { sequence: 0 }, { sequence: 0.5 },
  ];
  for (const invalid of invalids) {
    advance(500);
    const result = await call('progress', { ...preview, requestId, ...invalid }, token);
    assert.ok([400, 409].includes(result.status), JSON.stringify(result));
  }
  advance(1_000);
  assert.equal((await call('progress', { ...preview, requestId }, token)).status, 200);
  assert.equal((await call('progress', { ...preview, requestId, sequence: 2 }, token)).status, 200);
  assert.equal((await call('progress', { ...preview, requestId, sequence: 3 }, token)).status, 429);
  advance(500); await call('command', null, token); await call('heartbeat', READY, token);
  assert.equal((await call('progress', { ...preview, requestId, sequence: 3 }, token)).status, 200);
});

test('normal command, heartbeat, and two-fps preview traffic fits camera rate limits', async t => {
  const { join, call, pair, advance } = await setup(t);
  const { auth } = await join();
  const token = await pair(auth);
  const requestId = (await call('capture', { ...auth, kind: 'clip', questId: 'dapHandshake' })).body.requestId;
  for (let sequence = 1; sequence <= 12; sequence++) {
    advance(500);
    if (sequence % 2 === 0) {
      assert.equal((await call('command', null, token)).status, 200);
      assert.equal((await call('heartbeat', READY, token)).status, 200);
    }
    assert.equal((await call('progress', { requestId, sequence, elapsedSeconds: sequence / 2, previewDataUrl: IMAGE }, token)).status, 200);
    assert.equal((await call('status', auth)).status, 200);
  }
  assert.equal((await call('result', { requestId, status: 'ready', frames: [IMAGE, IMAGE, IMAGE], durationSeconds: 6 }, token)).status, 200);
  const status = (await call('status', auth)).body;
  assert.equal(status.previewDataUrl, undefined); assert.equal(status.sequence, undefined);
  assert.deepEqual(status.frames, [IMAGE, IMAGE, IMAGE]);
});

test('cancel, camera errors, disconnect, and re-pair erase live frames and reject late progress', async t => {
  const { join, call, pair, advance } = await setup(t);
  let player = await join();
  let token = await pair(player.auth);
  const start = async () => {
    advance(10_000); await call('command', null, token); await call('heartbeat', READY, token);
    const requestId = (await call('capture', { ...player.auth, kind: 'clip', questId: 'dapHandshake' })).body.requestId;
    const preview = { requestId, sequence: 1, elapsedSeconds: 0, previewDataUrl: IMAGE };
    assert.equal((await call('progress', preview, token)).status, 200);
    return preview;
  };
  let preview = await start();
  await call('discard', player.auth);
  assert.equal((await call('status', player.auth)).body.previewDataUrl, undefined);
  assert.equal((await call('progress', { ...preview, sequence: 2 }, token)).status, 409);
  preview = await start();
  await call('result', { requestId: preview.requestId, status: 'error', error: 'Camera stream stopped' }, token);
  assert.equal((await call('status', player.auth)).body.previewDataUrl, undefined);
  assert.equal((await call('progress', { ...preview, sequence: 2 }, token)).status, 409);
  preview = await start();
  await call('heartbeat', { cameraReady: false, cameraState: 'paused' }, token);
  assert.equal((await call('status', player.auth)).body.previewDataUrl, undefined);
  assert.equal((await call('progress', { ...preview, sequence: 2 }, token)).status, 409);
  player.socket.close(); await once(player.socket, 'close');
  assert.equal((await call('progress', { ...preview, sequence: 2 }, token)).status, 409);
  player = await join({ type: 'join', ...player.auth, name: 'Reconnected preview' });
  assert.equal((await call('status', player.auth)).body.previewDataUrl, undefined);
  await call('discard', player.auth);
  preview = await start();
  const oldToken = token; token = await pair(player.auth);
  assert.equal((await call('status', player.auth)).body.previewDataUrl, undefined);
  assert.equal((await call('progress', { ...preview, sequence: 2 }, oldToken)).status, 401);
});

test('live preview storage is bounded globally, overwritten in place, and freed on discard', async t => {
  const frameBytes = Buffer.byteLength(IMAGE);
  const { join, call, pair, advance } = await setup(t, { glassesCamera: { maxProgressBytes: frameBytes } });
  const a = await join(), b = await join();
  const aToken = await pair(a.auth), bToken = await pair(b.auth);
  const aId = (await call('capture', { ...a.auth, kind: 'clip', questId: 'dapHandshake' })).body.requestId;
  const bId = (await call('capture', { ...b.auth, kind: 'clip', questId: 'dapHandshake' })).body.requestId;
  const preview = { sequence: 1, elapsedSeconds: 0, previewDataUrl: IMAGE };
  assert.equal((await call('progress', { ...preview, requestId: aId }, aToken)).status, 200);
  assert.equal((await call('progress', { ...preview, requestId: bId }, bToken)).status, 503);
  assert.equal((await call('progress', { ...preview, requestId: aId, sequence: 2 }, aToken)).status, 200);
  await call('discard', a.auth);
  advance(500);
  assert.equal((await call('progress', { ...preview, requestId: bId }, bToken)).status, 200);
});

test('progress upload spanning cancellation cannot restore a live camera frame', async t => {
  const { app, origin, join, call, pair } = await setup(t);
  const { auth } = await join();
  const token = await pair(auth);
  const requestId = (await call('capture', { ...auth, kind: 'clip', questId: 'dapHandshake' })).body.requestId;
  const body = JSON.stringify({ requestId, sequence: 1, elapsedSeconds: 0, previewDataUrl: IMAGE });
  const received = once(app.server, 'request');
  const upload = httpRequest(origin + '/glasses/progress', { method: 'POST', headers: {
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
  upload.write(body.slice(0, 20)); await received;
  await call('discard', auth);
  upload.end(body.slice(20));
  assert.equal((await finished).status, 409);
  const status = (await call('status', auth)).body;
  assert.equal(status.status, 'idle'); assert.equal(status.previewDataUrl, undefined);
});

test('live frames and completed evidence share the total media memory budget', async t => {
  const evidenceSize = Buffer.byteLength(JSON.stringify({ photoDataUrl: IMAGE }));
  const { join, call, pair } = await setup(t, { glassesCamera: { maxEvidenceBytes: evidenceSize + Buffer.byteLength(IMAGE) - 1 } });
  const a = await join(), b = await join();
  const aToken = await pair(a.auth), bToken = await pair(b.auth);
  const aId = (await call('capture', { ...a.auth, kind: 'clip', questId: 'dapHandshake' })).body.requestId;
  const bId = (await call('capture', { ...b.auth, kind: 'photo', questId: 'touchGrass' })).body.requestId;
  assert.equal((await call('progress', { requestId: aId, sequence: 1, elapsedSeconds: 0, previewDataUrl: IMAGE }, aToken)).status, 200);
  const result = { requestId: bId, status: 'ready', photoDataUrl: IMAGE };
  assert.equal((await call('result', result, bToken)).status, 503);
  await call('discard', a.auth);
  assert.equal((await call('result', result, bToken)).status, 200);
});

test('on-demand capture requires an explicit fresh native capability and rejects unavailable camera states', async t => {
  const { join, call, pair, advance } = await setup(t);
  const { auth } = await join();
  const token = await pair(auth, false);
  const capture = { ...auth, kind: 'clip', questId: 'dapHandshake' };
  const idle = { cameraReady: false, cameraState: 'idle' };
  await call('heartbeat', idle, token);
  assert.equal((await call('status', auth)).body.captureAvailable, false, 'old idle native apps cannot claim on-demand support');
  assert.equal((await call('capture', capture)).status, 409);
  assert.equal((await call('heartbeat', { ...idle, onDemandCapture: 'yes' }, token)).status, 400);
  await call('heartbeat', { ...idle, onDemandCapture: true }, token);
  const available = (await call('status', auth)).body;
  assert.equal(available.cameraReady, false); assert.equal(available.captureAvailable, true);
  const requested = await call('capture', capture);
  assert.equal(requested.status, 200);
  assert.equal((await call('command', null, token)).body.command.id, requested.body.requestId);
  await call('discard', auth);
  for (const cameraState of ['permission', 'paused', 'error']) {
    advance(10_000); await call('command', null, token);
    await call('heartbeat', { cameraReady: false, cameraState, onDemandCapture: true }, token);
    assert.equal((await call('status', auth)).body.captureAvailable, false);
    assert.equal((await call('capture', capture)).status, 409);
  }
  advance(10_000); await call('command', null, token);
  await call('heartbeat', { cameraReady: false, cameraState: 'starting', onDemandCapture: true }, token);
  assert.equal((await call('capture', capture)).status, 200, 'an opted-in app can finish bounded startup for a pending command');
});

test('an authorized clip can finish while display suspension exceeds normal player rejoin grace', async t => {
  const { join, call, pair, advance } = await setup(t, { tickMs: 5, rejoinGraceMs: 25 });
  const player = await join(), other = await join();
  const token = await pair(player.auth);
  const requestId = (await call('capture', { ...player.auth, kind: 'clip', questId: 'dapHandshake' })).body.requestId;
  player.socket.close(); await once(player.socket, 'close');
  assert.equal((await call('status', player.auth)).status, 401);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await call('command', null, token)).body.command.id, requestId,
    'the same player and explicit command survive normal room eviction while capture is pending');
  advance(55_000);
  await call('heartbeat', { cameraReady: false, cameraState: 'idle', onDemandCapture: true }, token);
  const evidence = { requestId, status: 'ready', frames: [IMAGE, IMAGE, IMAGE], durationSeconds: 6 };
  assert.equal((await call('result', evidence, token)).status, 200, 'camera release before upload and display suspension must not cancel explicit evidence');
  assert.equal((await call('status', other.auth)).body.frames, undefined);
  assert.equal((await call('capture', { ...player.auth, kind: 'photo', questId: 'touchGrass' })).status, 401);
  const resumed = await join({ type: 'join', ...player.auth, name: 'Returned from camera' });
  assert.equal(resumed.playerId, player.playerId);
  const status = (await call('status', resumed.auth)).body;
  assert.equal(status.status, 'ready'); assert.equal(status.requestId, requestId);
  assert.equal(status.questId, 'dapHandshake'); assert.equal(status.kind, 'clip');
  assert.deepEqual(status.frames, evidence.frames); assert.equal(status.durationSeconds, 6);
});

test('pending-camera retention and ready evidence expire without extending ordinary player reservations', async t => {
  const { join, call, pair, advance } = await setup(t, {
    tickMs: 5, rejoinGraceMs: 25, glassesCamera: { disconnectGraceMs: 1_000 },
  });
  const player = await join();
  await join();
  const token = await pair(player.auth);
  const requestId = (await call('capture', { ...player.auth, kind: 'photo', questId: 'touchGrass' })).body.requestId;
  player.socket.close(); await once(player.socket, 'close');
  assert.equal((await call('status', player.auth)).status, 401);
  assert.equal((await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 200);
  await new Promise(resolve => setTimeout(resolve, 40));
  advance(999);
  assert.equal((await call('command', null, token)).status, 200);
  await call('heartbeat', READY, token);
  advance(1);
  assert.equal((await call('command', null, token)).status, 401, 'phone traffic cannot extend the original disconnect deadline');
  await new Promise(resolve => setTimeout(resolve, 15));
  const replacement = await join({ type: 'lobby', playerToken: player.auth.playerToken, name: 'Returned too late' });
  assert.notEqual(replacement.playerId, player.playerId);
  const status = (await call('status', replacement.auth)).body;
  assert.equal(status.paired, false); assert.equal(status.photoDataUrl, undefined);
  assert.equal((await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 401);
});

test('explicit cancel after display recovery still prevents delayed evidence from returning', async t => {
  const { join, call, pair } = await setup(t);
  const player = await join();
  const token = await pair(player.auth);
  const requestId = (await call('capture', { ...player.auth, kind: 'photo', questId: 'touchGrass' })).body.requestId;
  player.socket.close(); await once(player.socket, 'close');
  const resumed = await join({ type: 'join', ...player.auth, name: 'Cancel recording' });
  assert.equal((await call('status', resumed.auth)).body.requestId, requestId);
  await call('discard', resumed.auth);
  assert.equal((await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 409);
  assert.equal((await call('status', resumed.auth)).body.photoDataUrl, undefined);
});

test('same-token reload preserves only a current capture or ready review while the old socket is still open', async t => {
  const { join, call, pair } = await setup(t);
  const original = await join();
  const token = await pair(original.auth);
  const requestId = (await call('capture', { ...original.auth, kind: 'photo', questId: 'touchGrass' })).body.requestId;
  assert.equal(original.socket.readyState, WebSocket.OPEN);
  const originalClosed = once(original.socket, 'close');
  const capturing = await join({ type: 'join', ...original.auth, name: 'Reloaded while capturing' });
  assert.equal((await originalClosed)[0], 4001);
  assert.equal(capturing.playerId, original.playerId);
  assert.equal((await call('command', null, token)).body.command.id, requestId);
  assert.equal((await call('status', capturing.auth)).body.status, 'capturing');
  assert.equal((await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token)).status, 200);

  const captureSocketClosed = once(capturing.socket, 'close');
  const reviewing = await join({ type: 'join', ...original.auth, name: 'Reloaded before review' });
  assert.equal((await captureSocketClosed)[0], 4001);
  assert.equal(reviewing.playerId, original.playerId);
  const recovered = (await call('status', reviewing.auth)).body;
  assert.equal(recovered.requestId, requestId); assert.equal(recovered.status, 'ready');
  assert.equal(recovered.photoDataUrl, IMAGE); assert.equal(recovered.questId, 'touchGrass');

  await call('discard', reviewing.auth);
  const reviewSocketClosed = once(reviewing.socket, 'close');
  const idle = await join({ type: 'join', ...original.auth, name: 'Idle replacement' });
  assert.equal((await reviewSocketClosed)[0], 4001);
  assert.equal((await call('status', idle.auth)).body.paired, false,
    'a previous capture must not permanently authorize active replacement of an idle binding');
  assert.equal((await call('command', null, token)).status, 401);
});

test('active replacement never preserves expired captures or expired ready evidence', async t => {
  const { join, call, pair, advance } = await setup(t);
  let player = await join();
  let token = await pair(player.auth);
  await call('capture', { ...player.auth, kind: 'photo', questId: 'touchGrass' });
  advance(60_000);
  let replaced = once(player.socket, 'close');
  player = await join({ type: 'join', ...player.auth, name: 'Expired capture reload' });
  await replaced;
  assert.equal((await call('command', null, token)).status, 401);
  assert.equal((await call('status', player.auth)).body.paired, false);

  token = await pair(player.auth);
  const requestId = (await call('capture', { ...player.auth, kind: 'photo', questId: 'touchGrass' })).body.requestId;
  await call('result', { requestId, status: 'ready', photoDataUrl: IMAGE }, token);
  advance(5 * 60_000);
  replaced = once(player.socket, 'close');
  player = await join({ type: 'join', ...player.auth, name: 'Expired review reload' });
  await replaced;
  assert.equal((await call('command', null, token)).status, 401);
  const status = (await call('status', player.auth)).body;
  assert.equal(status.paired, false); assert.equal(status.photoDataUrl, undefined);
});
