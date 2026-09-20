/** Critically damped follow motion. Carry velocity between footfalls instead of
 * easing almost to a stop after every sensor update. No predicted extra steps. */
export class SmoothWalk {
  x = 0;
  z = 0;
  private vx = 0;
  private vz = 0;

  reset(x: number, z: number): void {
    this.x = x; this.z = z; this.vx = this.vz = 0;
  }

  advance(x: number, z: number, dt: number): number {
    if (dt <= 0) return 0;
    const beforeX = this.x, beforeZ = this.z;
    const omega = 7;
    const decay = Math.exp(-omega * dt);
    const dx = this.x - x, dz = this.z - z;
    const ax = this.vx + omega * dx, az = this.vz + omega * dz;
    this.x = x + (dx + ax * dt) * decay;
    this.z = z + (dz + az * dt) * decay;
    this.vx = (this.vx - omega * ax * dt) * decay;
    this.vz = (this.vz - omega * az * dt) * decay;
    return Math.hypot(this.x - beforeX, this.z - beforeZ);
  }
}
