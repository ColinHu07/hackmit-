// Wire contract shared by the relay, browser, and native camera producers.
export const MAX_FRAME_AGE_MS = 1500;
export const MAX_CLOCK_LEAD_MS = 1500;
export function validHandFrame(value, now = Date.now()) {
  if (!value || value.v !== 1 || value.type !== 'hands' || value.source !== 'glasses-camera') return false;
  if (typeof value.streamId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(value.streamId)) return false;
  if (!Number.isSafeInteger(value.seq) || value.seq < 0 || !Number.isFinite(value.capturedAtMs)) return false;
  const age = now - value.capturedAtMs;
  if (age > MAX_FRAME_AGE_MS || age < -MAX_CLOCK_LEAD_MS) return false;
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 4096 || value.height > 4096) return false;
  // Producers rotate their input image first, then send unmirrored, top-left coordinates.
  if (value.coordinateSpace !== 'image-top-left' || value.mirrored !== false) return false;
  if (value.preview != null && !validPreview(value.preview)) return false;
  if (!Array.isArray(value.hands) || value.hands.length > 2) return false;
  const ids = new Set();
  return value.hands.every(hand => {
    if (!hand || typeof hand.id !== 'string' || hand.id.length > 32 || ids.has(hand.id)) return false;
    ids.add(hand.id);
    if (!Number.isFinite(hand.score) || hand.score < 0 || hand.score > 1 || !Array.isArray(hand.points) || hand.points.length !== 21) return false;
    return hand.points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
      && point.x >= -0.25 && point.x <= 1.25 && point.y >= -0.25 && point.y <= 1.25 && Math.abs(point.z) <= 5);
  });
}

function validPreview(value) {
  return value && value.mime === 'image/jpeg'
    && Number.isInteger(value.width) && value.width > 0 && value.width <= 320
    && Number.isInteger(value.height) && value.height > 0 && value.height <= 320
    && typeof value.jpeg === 'string' && value.jpeg.length >= 8 && value.jpeg.length <= 65_536
    && value.jpeg.startsWith('/9j/') && /^[A-Za-z0-9+/]+={0,2}$/.test(value.jpeg);
}
