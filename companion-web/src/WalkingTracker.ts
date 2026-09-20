import type { LocationFix } from './LocationDiscovery';

export interface WalkingPose { x: number; z: number; yaw: number }
export const WALK_SCALE = 0.2; // One real meter is 0.2 world units; this is a scaled world.
export const STEP_METERS = 0.7; // Approximate stride for responsive gameplay, not measured distance.
export const STEP_MOVEMENT_GAIN = 2.5; // Exaggerate steps so walking reads clearly on a small screen.
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
  hasHeading = false;
  private stepTracking = false;
  pose: WalkingPose = { x: 0, z: 0, yaw: Math.PI };
  reset(x = 0, z = 0): void {
    this.anchor = null; this.lastTimestamp = -Infinity; this.hasHeading = false;
    this.pose = { ...this.pose, x, z };
  }
  heading(degrees: number, accuracy: number): boolean {
    if (!Number.isFinite(degrees) || degrees < 0 || degrees >= 360 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 25) return false;
    this.hasHeading = true;
    this.pose = { ...this.pose, yaw: headingToYaw(degrees) };
    return true;
  }
  setStepTracking(active: boolean): void {
    this.stepTracking = active;
    this.anchor = null; this.lastTimestamp = -Infinity;
  }
  steps(count: number): boolean {
    if (!this.stepTracking || !Number.isInteger(count) || count < 1 || count > 2) return false;
    const distance = count * STEP_METERS * WALK_SCALE * STEP_MOVEMENT_GAIN;
    this.translate(Math.sin(this.pose.yaw) * distance, Math.cos(this.pose.yaw) * distance);
    return true;
  }
  private translate(dx: number, dz: number): boolean {
    const x = this.pose.x + dx, z = this.pose.z + dz;
    const rebase = Math.abs(x) > 3 || Math.abs(z) > 3;
    this.pose = { ...this.pose, x: rebase ? 0 : x, z: rebase ? 0 : z };
    return rebase;
  }
  location(fix: LocationFix, now = Date.now()): { moved: boolean; message: string } {
    const waiting = (message: string) => ({ moved: false, message });
    if (this.stepTracking) return waiting('Step tracking ready · hold your phone facing the way you walk.');
    if (!Object.values(fix).every(Number.isFinite) || Math.abs(fix.latitude) > 90 || Math.abs(fix.longitude) > 180
      || fix.accuracy < 0 || now - fix.timestamp > 20_000 || fix.timestamp > now + 5000 || fix.timestamp <= this.lastTimestamp) return waiting('Waiting for a fresh location…');
    this.lastTimestamp = fix.timestamp;
    if (fix.accuracy > 10) { this.anchor = null; return waiting(`GPS ±${Math.ceil(fix.accuracy)} m. Move somewhere with a clearer sky to walk with your pet.`); }
    const previous = this.anchor;
    if (!previous || fix.timestamp - previous.timestamp > 20_000) {
      this.anchor = fix; return waiting('Ready to walk. Your starting direction is toward the top of the screen.');
    }
    const { east, north } = localMeters(previous, fix);
    const distance = Math.hypot(east, north);
    if (distance < Math.max(2, previous.accuracy, fix.accuracy)) return waiting(`GPS ±${Math.ceil(fix.accuracy)} m · waiting for a clear walking change.`);
    if (distance / ((fix.timestamp - previous.timestamp) / 1000) > 4) {
      this.anchor = null; return waiting('GPS jumped. Finding your position again without moving your pet.');
    }
    this.anchor = fix;
    const rebase = this.translate(east * WALK_SCALE, -north * WALK_SCALE);
    return { moved: true, message: rebase
      ? 'Your view adjusted automatically. Keep exploring.'
      : `Walking with you · GPS ±${Math.ceil(fix.accuracy)} m.` };
  }
}
