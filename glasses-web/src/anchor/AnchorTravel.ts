import { normalizeDegrees, type WorldAnchor } from './PseudoWorldAnchor';

/** Angular travel is independent of the viewer's pose and the visible field of view. */
export interface AnchorTravelFrame {
  anchor: WorldAnchor | null;
  /** Angular speed in degrees per second. */
  speed: number;
  yawVelocity: number;
  pitchVelocity: number;
  /** Angular distance covered by this update, suitable for advancing the run cycle. */
  distanceDelta: number;
  travelling: boolean;
}

const MAX_ANGULAR_SPEED = 24;
const MIN_DURATION_SECONDS = 0.4;
const POSITION_EPSILON = 1e-8;

function copyAnchor(anchor: WorldAnchor): WorldAnchor | null {
  if (!Number.isFinite(anchor.yaw) || !Number.isFinite(anchor.pitch)
    || !Number.isFinite(anchor.confidence) || Math.abs(anchor.pitch) > 90) return null;
  return {
    ...anchor,
    yaw: normalizeDegrees(anchor.yaw),
    confidence: Math.max(0, Math.min(1, anchor.confidence)),
  };
}

/**
 * Move an angular world anchor along its shortest yaw path with smooth starts and
 * stops. Call update only for elapsed active-page time; looking away must not
 * pause travel. Placement/reset is explicit and separate from a move request.
 */
export class AnchorTravel {
  private current: WorldAnchor | null = null;
  private start: WorldAnchor | null = null;
  private target: WorldAnchor | null = null;
  private yawDelta = 0;
  private pitchDelta = 0;
  private distance = 0;
  private duration = 0;
  private elapsed = 0;
  private progress = 0;

  constructor(initialAnchor: WorldAnchor | null = null) {
    this.reset(initialAnchor);
  }

  get currentAnchor(): WorldAnchor | null {
    return this.current ? { ...this.current } : null;
  }

  get travelling(): boolean {
    return this.target !== null;
  }

  /** Place immediately or clear the anchor, cancelling any previous travel. */
  reset(anchor: WorldAnchor | null = null): void {
    this.current = anchor ? copyAnchor(anchor) : null;
    this.start = null;
    this.target = null;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.distance = 0;
    this.duration = 0;
    this.elapsed = 0;
    this.progress = 0;
  }

  /**
   * Start at the supplied current ground bearing without snapping to the target.
   * To retarget during travel, pass currentAnchor as from. An externally derived
   * bearing can also absorb any local idle wandering before starting a run.
   * Invalid requests leave the existing path intact.
   */
  request(from: WorldAnchor, to: WorldAnchor, maxSpeedDegreesPerSecond = MAX_ANGULAR_SPEED): void {
    const start = copyAnchor(from);
    const target = copyAnchor(to);
    if (!start || !target) return;
    this.reset(start);
    this.yawDelta = normalizeDegrees(target.yaw - start.yaw);
    this.pitchDelta = target.pitch - start.pitch;
    this.distance = Math.hypot(this.yawDelta, this.pitchDelta);
    if (this.distance <= POSITION_EPSILON) return;
    this.start = start;
    this.target = target;
    // Cubic smoothstep's peak derivative is 1.5. Scale duration accordingly so
    // even the middle of a long run stays within the angular speed limit.
    const speedLimit = Number.isFinite(maxSpeedDegreesPerSecond) && maxSpeedDegreesPerSecond > 0
      ? Math.max(0.1, Math.min(MAX_ANGULAR_SPEED, maxSpeedDegreesPerSecond))
      : MAX_ANGULAR_SPEED;
    this.duration = Math.max(MIN_DURATION_SECONDS, 1.5 * this.distance / speedLimit);
  }

  update(dtSeconds: number): AnchorTravelFrame {
    if (!this.start || !this.target || !Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return this.frame(0);
    }

    this.elapsed = Math.min(this.duration, this.elapsed + dtSeconds);
    const t = this.elapsed / this.duration;
    const progress = t * t * (3 - 2 * t);
    const distanceDelta = Math.max(0, progress - this.progress) * this.distance;
    this.progress = progress;
    this.current = {
      ...this.start,
      yaw: normalizeDegrees(this.start.yaw + this.yawDelta * progress),
      pitch: this.start.pitch + this.pitchDelta * progress,
    };

    if (this.elapsed >= this.duration) {
      this.current = { ...this.target };
      this.start = null;
      this.target = null;
    }
    return this.frame(distanceDelta);
  }

  private frame(distanceDelta: number): AnchorTravelFrame {
    const t = this.duration > 0 ? this.elapsed / this.duration : 0;
    const progressVelocity = this.travelling ? 6 * t * (1 - t) / this.duration : 0;
    return {
      anchor: this.currentAnchor,
      speed: this.distance * progressVelocity,
      yawVelocity: this.yawDelta * progressVelocity,
      pitchVelocity: this.pitchDelta * progressVelocity,
      distanceDelta,
      travelling: this.travelling,
    };
  }
}
