const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians));
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

export interface DeviceAttitude {
  yaw: number; gravityX: number; gravityY: number; gravityZ: number;
  screenAngle: number; timestamp: number;
}

/** Relative gyroscope navigation works without a GPS fix or compass lock.
 * Tilt changes the camera only; it never changes the player's X/Z position. */
export class DeviceView {
  private previousYaw: number | null = null;
  private baseline: { pitch: number; roll: number; screenAngle: number } | null = null;
  private timestamp = -Infinity;
  private degrees = 0;

  reset(degrees = 0): void {
    this.previousYaw = null; this.baseline = null; this.timestamp = -Infinity;
    this.alignHeading(degrees);
  }
  alignHeading(degrees: number): void {
    if (Number.isFinite(degrees)) this.degrees = (degrees % 360 + 360) % 360;
  }
  sample(value: DeviceAttitude): { degrees: number; pitch: number; roll: number } | null {
    if (!Object.values(value).every(Number.isFinite) || value.timestamp <= this.timestamp
      || Math.abs(Math.hypot(value.gravityX, value.gravityY, value.gravityZ) - 1) > 0.2) return null;
    const angle = value.screenAngle * Math.PI / 180;
    const right = value.gravityX * Math.cos(angle) + value.gravityY * Math.sin(angle);
    const up = -value.gravityX * Math.sin(angle) + value.gravityY * Math.cos(angle);
    const pitch = Math.atan2(-up, -value.gravityZ);
    const roll = Math.atan2(right, Math.hypot(up, value.gravityZ));
    const recalibrate = !this.baseline || this.baseline.screenAngle !== value.screenAngle || value.timestamp - this.timestamp > 1000;
    if (recalibrate) this.baseline = { pitch, roll, screenAngle: value.screenAngle };
    else if (this.previousYaw !== null) {
      const delta = wrap(value.yaw - this.previousYaw);
      if (Math.abs(delta) < Math.PI / 3) this.alignHeading(this.degrees - delta * 180 / Math.PI);
    }
    this.previousYaw = value.yaw; this.timestamp = value.timestamp;
    return { degrees: this.degrees,
      pitch: clamp(wrap(pitch - this.baseline!.pitch) * 0.55, 0.3),
      roll: clamp(wrap(roll - this.baseline!.roll) * 0.45, 0.2) };
  }
}
