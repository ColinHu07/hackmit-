// GPS coordinates stay in server memory; snapshots expose only game positions.
export const LOCATION_WORLD_SCALE = 0.2;
export function locationPosition(origin, fix) {
  const longitude = ((fix.longitude - origin.longitude + 540) % 360) - 180;
  return { x: longitude * Math.PI / 180 * 6371000 * Math.cos((origin.latitude + fix.latitude) * Math.PI / 360) * LOCATION_WORLD_SCALE,
    z: -(fix.latitude - origin.latitude) * Math.PI / 180 * 6371000 * LOCATION_WORLD_SCALE };
}
export function validPlayLocation(fix, now = Date.now()) {
  return [fix.latitude, fix.longitude, fix.accuracy, fix.timestamp].every(Number.isFinite)
    && Math.abs(fix.latitude) <= 90 && Math.abs(fix.longitude) <= 180 && fix.accuracy >= 0 && fix.accuracy <= 25
    && now - fix.timestamp <= 20000 && fix.timestamp <= now + 5000;
}
