import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createPlayServer } from './play-server.mjs';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function setup(t, options = {}) {
  const app = createPlayServer(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function join(entry = { type: 'lobby', name: 'Quest player' }) {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/play');
    await once(socket, 'open');
    const welcome = new Promise((resolve, reject) => socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'welcome') resolve(message);
      if (message.type === 'error') reject(new Error(message.message));
    }));
    socket.send(JSON.stringify(entry));
    const { playerId, roomCode, playerToken } = await welcome;
    return { playerId, auth: { roomCode, playerToken }, socket };
  }
  async function post(path, input, token) {
    const response = await fetch(origin + path, { method: path === '/glasses/command' ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(path === '/glasses/command' ? {} : { body: JSON.stringify(input) }),
    });
    return { status: response.status, body: await response.json() };
  }
  async function capture(auth, questId = 'touchGrass') {
    const pairing = await post('/glasses/pair', auth);
    const token = (await post('/glasses/claim', { code: pairing.body.code })).body.cameraToken;
    await post('/glasses/command', null, token);
    await post('/glasses/heartbeat', { cameraReady: true, cameraState: 'ready' }, token);
    const request = await post('/glasses/capture', { ...auth, questId, kind: 'photo' });
    assert.equal(request.status, 200);
    const result = await post('/glasses/result', { requestId: request.body.requestId, status: 'ready', photoDataUrl: IMAGE }, token);
    assert.equal(result.status, 200);
    return { ...auth, questId, submissionId: randomUUID(), captureRequestId: request.body.requestId };
  }
  async function finished(submission) {
    for (let i = 0; i < 100; i++) {
      const status = await post('/verify/status', submission);
      if (status.body.status !== 'pending') return status;
      await delay(5);
    }
    throw new Error('Test grading did not finish');
  }
  const pet = async auth => (await fetch(`${origin}/api/pet?playerToken=${auth.playerToken}`)).json();
  return { app, origin, join, post, capture, finished, pet };
}

test('a saved capture starts one nonblocking grading job and recovers a lost acknowledgement without duplicate rewards', async t => {
  let finish, checks = 0, evidence;
  const { app, join, post, capture, finished, pet } = await setup(t, { photoVerifier: {
    configured: true, verify(input) { checks++; evidence = input; return new Promise(resolve => { finish = resolve; }); },
  } });
  const owner = await join(), other = await join();
  const submission = await capture(owner.auth);
  assert.equal((await post('/glasses/status', owner.auth)).body.verification, undefined,
    'reading a saved capture never starts grading');
  assert.ok(Buffer.byteLength(JSON.stringify(submission)) < 500, 'submission sends IDs rather than the saved media');
  app.server.prependOnceListener('request', (request, response) => {
    assert.equal(request.url, '/verify');
    response.end = () => { response.destroy(); return response; };
  });
  await assert.rejects(post('/verify', submission), /fetch failed|socket/i);
  assert.equal(checks, 1);
  assert.equal(evidence.photoDataUrl, IMAGE, 'the server resolves the owner’s retained evidence');
  const pending = { submissionId: submission.submissionId, questId: 'touchGrass', status: 'pending' };
  assert.deepEqual(await post('/verify/status', submission), { status: 202, body: pending });
  assert.deepEqual(await post('/verify', submission), { status: 202, body: pending });
  assert.deepEqual((await post('/glasses/status', owner.auth)).body.verification, pending);
  assert.equal((await post('/verify/status', { ...submission, ...other.auth })).status, 404);
  assert.equal((await post('/glasses/status', other.auth)).body.verification, undefined);
  assert.equal(checks, 1);
  finish({ verified: true, reason: 'A hand touches real grass.' });
  const completed = await finished(submission);
  assert.equal(completed.status, 200); assert.equal(completed.body.status, 'complete');
  assert.equal(completed.body.verified, true);
  const rewarded = await pet(owner.auth);
  assert.equal(rewarded.points, 10); assert.equal(rewarded.inventory.berry, 5);
  assert.equal((await pet(other.auth)).points, 0);
  assert.deepEqual(await post('/verify', submission), completed, 'lost completion responses are recoverable even on quest cooldown');
  assert.deepEqual((await post('/glasses/status', owner.auth)).body.verification, completed.body);
  assert.equal((await pet(owner.auth)).lastQuestReward.eventId, rewarded.lastQuestReward.eventId);
  assert.equal(checks, 1);
});

test('submission IDs are bound to their authenticated owner, capture and quest', async t => {
  let checks = 0;
  const { join, post, capture, finished } = await setup(t, { photoVerifier: {
    configured: true, async verify() { checks++; return { verified: false, reason: 'No grass visible.' }; },
  } });
  const owner = await join(), other = await join();
  const submission = await capture(owner.auth);
  assert.equal((await post('/verify', { ...submission, ...other.auth })).status, 409);
  assert.equal((await post('/verify', { ...submission, photoDataUrl: IMAGE })).status, 400);
  assert.equal((await post('/verify', { ...submission, questId: 'meetFriend' })).status, 409);
  assert.equal(checks, 0);
  assert.equal((await post('/verify', submission)).status, 202);
  await finished(submission);
  assert.equal((await post('/verify', { ...submission, captureRequestId: randomUUID() })).status, 409);
  assert.equal((await post('/verify', { ...submission, questId: 'meetFriend' })).status, 409);
  assert.equal((await post('/verify/status', { ...submission, questId: 'meetFriend' })).status, 404);
  assert.equal((await post('/verify/status', { ...submission, playerToken: 'a'.repeat(48) })).status, 401);
  assert.equal(checks, 1);
});

test('provider errors stay explicit and cached while a new user submission can retry the saved capture', async t => {
  let checks = 0;
  const { join, post, capture, finished } = await setup(t, { photoVerifier: {
    configured: true, async verify() {
      if (++checks === 1) throw new Error('Quest grading returned HTTP 503. Please retry shortly.');
      return { verified: false, reason: 'Move your hand into view.' };
    },
  } });
  const owner = await join();
  const submission = await capture(owner.auth);
  assert.equal((await post('/verify', submission)).status, 202);
  const failed = await finished(submission);
  assert.equal(failed.status, 200); assert.equal(failed.body.status, 'error');
  assert.match(failed.body.error, /HTTP 503/);
  assert.deepEqual(await post('/verify', submission), failed);
  assert.equal(checks, 1, 'a transport retry must not silently repeat provider grading');
  const manualRetry = { ...submission, submissionId: randomUUID() };
  assert.equal((await post('/verify', manualRetry)).status, 202);
  const completed = await finished(manualRetry);
  assert.equal(completed.body.status, 'complete'); assert.equal(completed.body.verified, false);
  assert.equal(checks, 2);
  assert.deepEqual((await post('/glasses/status', owner.auth)).body.verification, completed.body);
});

test('bounded grading times out, restores quest state and ignores a late provider success', async t => {
  let finish, providerSignal, checks = 0;
  const { join, post, capture, finished, pet } = await setup(t, { verification: { timeoutMs: 30 }, photoVerifier: {
    configured: true, verify(_input, { signal }) { checks++; providerSignal = signal; return new Promise(resolve => { finish = resolve; }); },
  } });
  const owner = await join();
  const submission = await capture(owner.auth);
  assert.equal((await post('/verify', submission)).status, 202);
  const failed = await finished(submission);
  assert.equal(failed.body.status, 'error'); assert.match(failed.body.error, /timed out/);
  assert.equal(providerSignal.aborted, true);
  finish({ verified: true, reason: 'Late approval.' });
  await delay(10);
  assert.deepEqual(await post('/verify/status', submission), failed);
  assert.equal((await pet(owner.auth)).points, 0);
  assert.deepEqual(await post('/verify', submission), failed);
  assert.equal(checks, 1);
});

test('a brief display disconnect preserves an explicitly started grade and same-player review recovery', async t => {
  let finish;
  const { join, post, capture, finished, pet } = await setup(t, { rejoinGraceMs: 10, tickMs: 5,
    glassesCamera: { disconnectGraceMs: 10 }, photoVerifier: {
      configured: true, verify() { return new Promise(resolve => { finish = resolve; }); },
    },
  });
  const owner = await join();
  const submission = await capture(owner.auth);
  await post('/verify', submission);
  owner.socket.close(); await once(owner.socket, 'close');
  await delay(30);
  assert.equal((await post('/verify/status', submission)).status, 401);
  const resumed = await join({ type: 'join', ...owner.auth, name: 'Returned' });
  assert.equal(resumed.playerId, owner.playerId, 'pending grading keeps only the same membership beyond normal rejoin grace');
  assert.equal((await post('/verify/status', submission)).body.status, 'pending');
  finish({ verified: true, reason: 'Grass visible.' });
  assert.equal((await finished(submission)).body.verified, true);
  assert.equal((await pet(owner.auth)).points, 10);
});

test('an intentional leave invalidates the grading group and never rewards a later membership', async t => {
  let finish;
  const { join, post, capture, finished, pet } = await setup(t, { photoVerifier: {
    configured: true, verify() { return new Promise(resolve => { finish = resolve; }); },
  } });
  const owner = await join(), partner = await join();
  const submission = await capture(owner.auth, 'meetFriend');
  await post('/verify', submission);
  partner.socket.send(JSON.stringify({ type: 'leave' }));
  partner.socket.close(); await once(partner.socket, 'close');
  finish({ verified: true, reason: 'Wave visible.' });
  const failed = await finished(submission);
  assert.equal(failed.body.status, 'error'); assert.match(failed.body.error, /group changed/i);
  assert.equal((await pet(owner.auth)).points, 0); assert.equal((await pet(partner.auth)).points, 0);
});

test('a grade completed while the display is away stays recoverable only within its bounded reconnect grace', async t => {
  let finish;
  const { join, post, capture, finished, pet } = await setup(t, {
    rejoinGraceMs: 10, tickMs: 5, glassesCamera: { disconnectGraceMs: 10 },
    verification: { reconnectGraceMs: 120 },
    photoVerifier: { configured: true, verify() { return new Promise(resolve => { finish = resolve; }); } },
  });
  const owner = await join();
  const submission = await capture(owner.auth);
  await post('/verify', submission);
  owner.socket.close(); await once(owner.socket, 'close');
  await delay(20);
  finish({ verified: true, reason: 'Real grass visible.' });
  await delay(20);
  const resumed = await join({ type: 'join', ...owner.auth, name: 'Returned after result' });
  assert.equal(resumed.playerId, owner.playerId);
  assert.equal((await finished(submission)).body.verified, true);
  assert.equal((await pet(owner.auth)).points, 10);
  resumed.socket.close(); await once(resumed.socket, 'close');
  await delay(150);
  const later = await join({ type: 'lobby', playerToken: owner.auth.playerToken, name: 'New membership' });
  assert.notEqual(later.playerId, owner.playerId);
  assert.equal((await post('/verify/status', { ...submission, ...later.auth })).status, 404);
  assert.equal((await pet(later.auth)).points, 10, 'earned rewards survive without exposing old session jobs');
});

test('concurrent grading is bounded independently of the retained result cache', async t => {
  let finish, checks = 0;
  const { join, post, capture, finished } = await setup(t, {
    verification: { maxConcurrent: 1, maxJobs: 10 },
    photoVerifier: { configured: true, verify() { checks++; return new Promise(resolve => { finish = resolve; }); } },
  });
  const owner = await join(), other = await join();
  const first = await capture(owner.auth), second = await capture(other.auth);
  await post('/verify', first);
  const busy = await post('/verify', second);
  assert.equal(busy.status, 503); assert.match(busy.body.error, /grading is busy/);
  assert.equal(checks, 1);
  finish({ verified: false, reason: 'Try again.' });
  await finished(first);
  assert.equal((await post('/verify', second)).status, 202);
  assert.equal(checks, 2);
  finish({ verified: false, reason: 'Try again.' });
  await finished(second);
});

test('retained status metadata is bounded, and reads never extend result expiry', async t => {
  let clock = Date.now(), finish;
  const { join, post, capture, finished } = await setup(t, {
    verification: { maxConcurrent: 1, maxJobs: 1, resultTtlMs: 1000, now: () => clock },
    photoVerifier: { configured: true, verify() { return new Promise(resolve => { finish = resolve; }); } },
  });
  const owner = await join(), other = await join();
  const first = await capture(owner.auth), second = await capture(other.auth);
  await post('/verify', first);
  assert.equal((await post('/verify', second)).status, 503);
  finish({ verified: false, reason: 'Try again.' });
  const completed = await finished(first);
  clock += 900;
  assert.deepEqual(await post('/verify', first), completed);
  clock += 100;
  assert.equal((await post('/verify/status', first)).status, 404);
  assert.equal((await post('/glasses/status', owner.auth)).body.verification, undefined);
  assert.equal((await post('/verify', second)).status, 202);
  finish({ verified: false, reason: 'Try again.' });
  await finished(second);
});
