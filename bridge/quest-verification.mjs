const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export const PHOTO_VERIFICATION_QUESTS = Object.freeze({
  touchGrass: {
    label: 'touch grass',
    evidence: 'natural grass or other outdoor ground-level vegetation',
  },
});

function safeReason(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) || fallback;
}

function parseDecision(content) {
  const text = typeof content === 'string' ? content.trim() : '';
  const candidate = text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return { verified: false, reason: 'The photo check returned an unreadable result.' };
  try {
    const parsed = JSON.parse(candidate);
    return {
      verified: parsed?.verified === true,
      reason: safeReason(parsed?.reason, parsed?.verified === true ? 'The photo supports this quest.' : 'The photo does not clearly support this quest.'),
    };
  } catch {
    return { verified: false, reason: 'The photo check returned an unreadable result.' };
  }
}

export function validatePhoto(dataUrl) {
  const match = typeof dataUrl === 'string' ? dataUrl.match(PHOTO_DATA_URL) : null;
  if (!match) throw new Error('Use a JPEG, PNG, or WebP photo.');
  const encoded = match[2] ?? '';
  if (Buffer.byteLength(encoded, 'base64') > MAX_PHOTO_BYTES) throw new Error('Use a photo smaller than 4 MB.');
  return dataUrl;
}

/**
 * Thin, server-only adapter for Meta Model API's OpenAI-compatible vision endpoint.
 * The image is forwarded for this one decision and intentionally is not persisted.
 */
export function createQuestPhotoVerifier(options = {}) {
  const apiKey = options.apiKey ?? process.env.MODEL_API_KEY ?? '';
  const baseUrl = (options.baseUrl ?? process.env.META_MODEL_API_BASE_URL ?? 'https://api.meta.ai/v1').replace(/\/$/, '');
  const model = options.model ?? process.env.META_MODEL_ID ?? 'muse-spark-1.3';
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    configured: Boolean(apiKey),
    async verify({ questId, photoDataUrl }) {
      const quest = PHOTO_VERIFICATION_QUESTS[questId];
      if (!quest) throw new Error('That quest does not accept photo verification.');
      validatePhoto(photoDataUrl);
      if (!apiKey) throw new Error('Photo verification is not configured on this server.');
      const prompt = [
        'You are a cautious photo-verification assistant for a friendly game.',
        `Decide whether this image clearly shows ${quest.evidence}, which supports the quest “${quest.label}”.`,
        'Approve only when the visual evidence is clear. A photo of a screen, an indoor plant, a vague scene, or an unrelated image must not pass.',
        'Do not identify people, infer personal traits, or require a face in the image.',
        'Return JSON only: {"verified": boolean, "reason": "short visual description of the evidence or what is missing"}.',
      ].join(' ');
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: photoDataUrl } },
            ] }],
          }),
        });
      } catch {
        throw new Error('The photo verification service could not be reached. Try again shortly.');
      }
      if (!response.ok) throw new Error('The photo verification service could not check that photo. Try again shortly.');
      let payload;
      try { payload = await response.json(); } catch { throw new Error('The photo verification service returned an unreadable result.'); }
      return parseDecision(payload?.choices?.[0]?.message?.content);
    },
  };
}
