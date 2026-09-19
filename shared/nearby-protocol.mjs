export const NEARBY_RADIUS_METERS = 10;
export const NEARBY_MAX_ACCURACY_METERS = 25;
export const NEARBY_LOCATION_FRESH_MS = 20_000;
export const NEARBY_REQUEST_TTL_MS = 30_000;
export const NEARBY_MAX_MESSAGE_BYTES = 1024;

export function parseNearbyMessage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = {
    discover: ['type', 'name'], location: ['type', 'latitude', 'longitude', 'accuracy', 'timestamp'],
    pause: ['type'], meet: ['type', 'peerId'], respond: ['type', 'requestId', 'accept'],
  };
  if (typeof input.type !== 'string' || !Object.hasOwn(allowed, input.type)
    || Object.keys(input).some(key => !allowed[input.type].includes(key))) return null;
  if (input.type === 'pause') return { type: 'pause' };
  if (input.type === 'discover') {
    if (typeof input.name !== 'string' || input.name.length > 80) return null;
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (!name || Array.from(name).length > 24 || /[\u0000-\u001f\u007f]/u.test(name)) return null;
    return { type: 'discover', name };
  }
  if (input.type === 'location') {
    if (!['latitude', 'longitude', 'accuracy', 'timestamp'].every(key => typeof input[key] === 'number' && Number.isFinite(input[key]))) return null;
    if (Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180 || input.accuracy < 0 || input.timestamp < 0) return null;
    return { type: 'location', latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy, timestamp: input.timestamp };
  }
  const idKey = input.type === 'meet' ? 'peerId' : 'requestId';
  if (typeof input[idKey] !== 'string' || !/^[a-f0-9-]{36}$/.test(input[idKey])) return null;
  if (input.type === 'meet') return { type: 'meet', peerId: input.peerId };
  if (typeof input.accept !== 'boolean') return null;
  return { type: 'respond', requestId: input.requestId, accept: input.accept };
}

export function distanceMeters(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const latDelta = radians(b.latitude - a.latitude);
  const lonDelta = radians(b.longitude - a.longitude);
  const h = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
