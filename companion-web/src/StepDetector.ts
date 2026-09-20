/** Foreground walking estimate, not a fitness counter. Two rhythmic footfalls
 * confirm a new walk; isolated bumps and turning do not create steps. */
export class StepDetector {
  private lastSample = -Infinity;
  private filtered = 0;
  private peakAt: number | null = null;
  private lastStep = -Infinity;
  private confirmed = false;

  reset(): void {
    this.lastSample = this.lastStep = -Infinity;
    this.filtered = 0; this.peakAt = null; this.confirmed = false;
  }

  sample(verticalG: number, timestamp: number): number {
    if (!Number.isFinite(verticalG) || !Number.isFinite(timestamp) || timestamp <= this.lastSample) return 0;
    if (timestamp - this.lastSample > 500 || Math.abs(verticalG) > 2) this.reset();
    const elapsed = Math.min(100, timestamp - this.lastSample);
    this.lastSample = timestamp;
    if (Math.abs(verticalG) > 2) return 0;
    this.filtered += (verticalG - this.filtered) * (1 - Math.exp(-elapsed / 45));
    if (timestamp - this.lastStep > 1600) this.confirmed = false;
    if (this.peakAt !== null && timestamp - this.peakAt > 650) this.peakAt = null;
    if (this.peakAt === null && this.filtered > 0.075 && timestamp - this.lastStep >= 280) this.peakAt = timestamp;
    if (this.peakAt === null || this.filtered > -0.035) return 0;
    const width = timestamp - this.peakAt;
    this.peakAt = null;
    if (width < 80 || width > 650) return 0;
    const interval = timestamp - this.lastStep;
    if (interval < 280) return 0;
    this.lastStep = timestamp;
    if (interval > 1600) return 0;
    const steps = this.confirmed ? 1 : 2;
    this.confirmed = true;
    return steps;
  }
}

/** Browser acceleration is m/s²; native Core Motion uses g. Remove gravity and
 * project along vertical so screen rotation cannot itself count as a footfall. */
export function browserVerticalG(acceleration: DeviceMotionEventAcceleration | null, includingGravity: DeviceMotionEventAcceleration | null): number | null {
  if (!acceleration || !includingGravity) return null;
  const values = [acceleration.x, acceleration.y, acceleration.z, includingGravity.x, includingGravity.y, includingGravity.z];
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return null;
  const [x, y, z, ax, ay, az] = values as number[];
  const gx = ax! - x!, gy = ay! - y!, gz = az! - z!;
  const gravity = Math.hypot(gx, gy, gz);
  if (gravity < 7 || gravity > 12) return null;
  return -(x! * gx + y! * gy + z! * gz) / gravity / 9.80665;
}
