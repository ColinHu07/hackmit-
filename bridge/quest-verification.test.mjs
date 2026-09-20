import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuestPhotoVerifier, validatePhoto } from './quest-verification.mjs';

const tinyPhoto = 'data:image/png;base64,iVBORw0KGgo=';

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
  assert.equal(request.url, 'https://model.example/v1/v1/chat/completions');
  assert.equal(request.init.headers.authorization, 'Bearer test-key');
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, 'test-vision');
  assert.equal(body.messages[0].content[1].image_url.url, tinyPhoto);
});

test('the verifier rejects unsupported photos and fails closed on malformed model output', async () => {
  assert.throws(() => validatePhoto('data:text/plain;base64,SGVsbG8='), /JPEG, PNG, or WebP/);
  const verifier = createQuestPhotoVerifier({
    apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'maybe' } }] }) }),
  });
  assert.deepEqual(await verifier.verify({ questId: 'touchGrass', photoDataUrl: tinyPhoto }), {
    verified: false, reason: 'The photo check returned an unreadable result.',
  });
});
