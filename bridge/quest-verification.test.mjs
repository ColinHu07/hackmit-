import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuestPhotoVerifier, validatePhoto } from './quest-verification.mjs';

const tinyPhoto = 'data:image/png;base64,iVBORw0KGgo=';

for (const [questId, action, people] of [
  ['touchGrass', /hand physically touching natural grass outdoors/, 1],
  ['meetFriend', /a person visibly waving hello.*other player may be behind the camera/, 1],
  ['dapHandshake', /hands together into a handshake, fist bump, or high-five and then releasing/, 2],
  ['squadCircle', /full group gathered together in a circle.*shared cheer/, 4],
]) {
  test(`${questId} sends its own action criteria and participant count to Muse`, async () => {
    let body;
    const verifier = createQuestPhotoVerifier({
      apiKey: 'test', baseUrl: 'https://model.example/v1', model: 'vision',
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"verified":false,"reason":"Required action is not visible."}' } }] }) };
      },
    });
    await verifier.verify({ questId, participantCount: questId === 'meetFriend' ? 2 : people, frames: Array(12).fill(tinyPhoto), durationSeconds: 6 });
    const prompt = body.messages[0].content[0].text;
    assert.match(prompt, action);
    assert.ok(prompt.includes(`Required visible participants: at least ${people}.`));
    assert.match(prompt, /12 images are chronological, evenly spaced samples from a 6-second clip/);
    assert.match(prompt, /Check the sequence, not just one frame/);
    assert.match(prompt, /Approve only when the action and participant count are unambiguous/);
    assert.match(prompt, /Reject images of screens, game characters, illustrations/);
    assert.equal(body.messages[0].content.length, 13);
  });
}

test('the Meta verifier sends an image_url request and returns only a concise decision', async () => {
  let request;
  const verifier = createQuestPhotoVerifier({
    apiKey: 'test-key', baseUrl: 'https://model.example/v1', model: 'test-vision',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"verified":true,"reason":"Green grass is clearly visible."}' } }] }) };
    },
  });
  const result = await verifier.verify({ questId: 'touchGrass', photoDataUrl: tinyPhoto });
  assert.deepEqual(result, { verified: true, reason: 'Green grass is clearly visible.' });
  assert.equal(request.url, 'https://model.example/v1/chat/completions');
  assert.equal(request.init.headers.authorization, 'Bearer test-key');
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, 'test-vision');
  assert.equal(body.messages[0].content[1].image_url.url, tinyPhoto);
});

test('the verifier rejects unsupported photos and fails closed on malformed model output', async () => {
  assert.throws(() => validatePhoto('data:text/plain;base64,SGVsbG8='), /JPEG, PNG, or WebP/);
  const verifier = createQuestPhotoVerifier({
    apiKey: 'test-key', baseUrl: 'https://model.example/v1', model: 'vision', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'maybe' } }] }) }),
  });
  assert.deepEqual(await verifier.verify({ questId: 'touchGrass', photoDataUrl: tinyPhoto }), {
    verified: false, reason: 'The evidence check returned an unreadable result. Please retry.',
  });
});

test('handshake requires chronological clip evidence and never accepts a still photo', async () => {
  const { validateEvidence } = await import('./quest-verification.mjs');
  assert.throws(() => validateEvidence({ questId: 'dapHandshake', photoDataUrl: tinyPhoto }), /short clip/);
  assert.throws(() => validateEvidence({ questId: 'dapHandshake', frames: [tinyPhoto, tinyPhoto], durationSeconds: 5 }), /1 and 10/);
  assert.throws(() => validateEvidence({ questId: 'dapHandshake', frames: Array(3).fill(tinyPhoto), durationSeconds: 30 }), /1 and 10/);
  assert.equal(validateEvidence({ questId: 'dapHandshake', frames: Array(3).fill(tinyPhoto), durationSeconds: 5 }).length, 3);
});

test('squad verification sends ordered frames and the server-supplied participant count', async () => {
  let body;
  const verifier = createQuestPhotoVerifier({ apiKey: 'test', baseUrl: 'https://model.example/v1/', model: 'vision', fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"verified":false,"reason":"Only two people are visible."}' } }] }) };
  } });
  const result = await verifier.verify({ questId: 'squadCircle', frames: Array(12).fill(tinyPhoto), durationSeconds: 8, participantCount: 4 });
  assert.equal(result.verified, false);
  assert.match(body.messages[0].content[0].text, /at least 4/);
  assert.match(body.messages[0].content[0].text, /chronological/);
  assert.equal(body.messages[0].content.length, 13);
});

test('invalid files, provider failures, and missing configuration cannot approve a quest', async () => {
  assert.throws(() => validatePhoto('data:image/jpeg;base64,SGVsbG8='), /format/);
  const unconfigured = createQuestPhotoVerifier({ apiKey: '', model: '', baseUrl: '' });
  await assert.rejects(unconfigured.verify({ questId: 'touchGrass', photoDataUrl: tinyPhoto }), /not configured/);
  const failing = createQuestPhotoVerifier({ apiKey: 'test', baseUrl: 'https://model.example/v1', model: 'vision', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(failing.verify({ questId: 'touchGrass', photoDataUrl: tinyPhoto }), /HTTP 401/);
});
