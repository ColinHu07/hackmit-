import type { LocationFix } from './LocationDiscovery';

export interface WalkingPose { x: number; z: number; yaw: number }
export const WALK_SCALE = 0.2; // One real meter is 0.2 world units; this is a scaled world.
export function headingToYaw(degrees: number): number { return Math.PI - degrees * Math.PI / 180; }
export function localMeters(from: LocationFix, to: LocationFix): { east: number; north: number } {
  let longitude = to.longitude - from.longitude;
  longitude = ((longitude + 540) % 360) - 180;
  return {
    east: longitude * Math.PI / 180 * 6_371_000 * Math.cos((from.latitude + to.latitude) * Math.PI / 360),
    north: (to.latitude - from.latitude) * Math.PI / 180 * 6_371_000,
  };
}
/** Translation comes from accepted location changes, never from rotating the phone. */
export class WalkingTracker {
  private anchor: LocationFix | null = null;
  private lastTimestamp = -Infinity;
  pose: WalkingPose = { x: 0, z: 0, yaw: Math.PI };
  reset(x = 0, z = 0): void {
    this.anchor = null; this.lastTimestamp = -Infinity;
    this.pose = { ...this.pose, x, z };
  }
  heading(degrees: number, accuracy: number): boolean {
    if (!Number.isFinite(degrees) || degrees < 0 || degrees >= 360 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 25) return false;
    this.pose = { ...this.pose, yaw: headingToYaw(degrees) };
    return true;
  }
  location(fix: LocationFix, now = Date.now()): { moved: boolean; message: string } {
    const waiting = (message: string) => ({ moved: false, message });
    if (!Object.values(fix).every(Number.isFinite) || Math.abs(fix.latitude) > 90 || Math.abs(fix.longitude) > 180
      || fix.accuracy < 0 || now - fix.timestamp > 20_000 || fix.timestamp > now + 5000 || fix.timestamp <= this.lastTimestamp) return waiting('Waiting for a fresh location…');
    this.lastTimestamp = fix.timestamp;
    if (fix.accuracy > 10) { this.anchor = null; return waiting(`GPS ±${Math.ceil(fix.accuracy)} m. Move somewhere with a clearer sky to walk with your pet.`); }
    const previous = this.anchor;
    if (!previous || fix.timestamp - previous.timestamp > 20_000) {
      this.anchor = fix; return waiting('Ready to walk. North is toward N in your world.');
    }
    const { east, north } = localMeters(previous, fix);
    const distance = Math.hypot(east, north);
    if (distance < Math.max(2, previous.accuracy, fix.accuracy)) return waiting(`GPS ±${Math.ceil(fix.accuracy)} m · waiting for a clear walking change.`);
    if (distance / ((fix.timestamp - previous.timestamp) / 1000) > 4) {
      this.anchor = null; return waiting('GPS jumped. Finding your position again without moving your pet.');
    }
    this.anchor = fix;
    const x = this.pose.x + east * WALK_SCALE, z = this.pose.z - north * WALK_SCALE;
    // Keep the finite shared scene usable without a manual recenter control.
    const rebase = Math.abs(x) > 3 || Math.abs(z) > 3;
    this.pose = { ...this.pose, x: rebase ? 0 : x, z: rebase ? 0 : z };
    return { moved: true, message: rebase
      ? 'Your view adjusted automatically. Keep exploring.'
      : `Walking with you · GPS ±${Math.ceil(fix.accuracy)} m.` };
  }
}
