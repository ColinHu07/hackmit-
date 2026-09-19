import { normalizeDegrees, type Orientation } from '../anchor/PseudoWorldAnchor';

export interface SensorSample { alpha: number | null; beta: number | null }
export type TrackingStatus = 'off' | 'waiting' | 'live' | 'stale' | 'denied' | 'unavailable';
export type CalibrationStep = 'right' | 'up' | 'place' | 'done';
const FRESH_MS = 1200;
const MAX_SPEED = 650; // degrees/second; faster changes need a second sensor sample.
const PREDICTION_MS = 30;
const MAX_PREDICTION = 3;
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/** Relative IMU directions, not a position/SLAM tracker. Calibrate signs on-device. */
export class OrientationTracker {
  private origin: Orientation | null = null;
  private raw: Orientation | null = null;
  private calibrationBaseline: Orientation | null = null;
  private lastSample = -Infinity;
  private rendered: Orientation | null = null;
  private lastFrame = -Infinity;
  private velocity: Orientation = { yaw: 0, pitch: 0 };
  private pendingJump: { pose: Orientation; at: number } | null = null;
  horizontalFov = 60;
  verticalFov = 60;
  private yawSign = 1;
  private pitchSign = 1;
  step: CalibrationStep = 'right';

  accept(sample: SensorSample, now: number): boolean {
    if (sample.alpha === null || sample.beta === null || !Number.isFinite(sample.alpha) || !Number.isFinite(sample.beta) || !Number.isFinite(now) || now < this.lastSample) return false;
    const pose = { yaw: normalizeDegrees(sample.alpha), pitch: normalizeDegrees(sample.beta) };
    const elapsed = now - this.lastSample;
    const delta = this.raw ? angularDelta(pose, this.raw) : { yaw: 0, pitch: 0 };
    const limit = Math.max(12, MAX_SPEED * elapsed / 1000);
    let confirmedJump = false;
    // Keep calibration measurements immediate. Once placed, an isolated IMU
    // discontinuity must not fling the animal across the display.
    if (this.raw && (this.step === 'place' || this.step === 'done') && Math.max(Math.abs(delta.yaw), Math.abs(delta.pitch)) > limit) {
      const pending = this.pendingJump;
      const pendingDelta = pending ? angularDelta(pose, pending.pose) : null;
      confirmedJump = !!pending && now - pending.at <= 150 && !!pendingDelta &&
        Math.max(Math.abs(pendingDelta.yaw), Math.abs(pendingDelta.pitch)) <= Math.max(4, MAX_SPEED * (now - pending.at) / 1000);
      if (!confirmedJump) {
        this.pendingJump = { pose, at: now };
        return false;
      }
    }
    this.pendingJump = null;
    // Advance using the previous target before changing it, so interpolation is
    // independent of whether an event arrives just before or after a frame.
    if (this.raw) this.sample(now);
    if (this.raw && elapsed > 0 && elapsed <= 150 && !confirmedJump) {
      const blend = 1 - Math.exp(-elapsed / 24);
      for (const axis of ['yaw', 'pitch'] as const) {
        const measured = clamp(delta[axis] * 1000 / elapsed, MAX_SPEED);
        this.velocity[axis] = Math.abs(delta[axis]) < 0.03 ? 0 : this.velocity[axis] + blend * (measured - this.velocity[axis]);
      }
    } else this.velocity = { yaw: 0, pitch: 0 };
    this.raw = pose;
    if (!this.origin) {
      this.origin = { ...this.raw };
      this.calibrationBaseline = { ...this.raw };
      this.resetRendering(now);
    }
    this.lastSample = now;
    return true;
  }

  isFresh(now: number): boolean { return !!this.raw && now - this.lastSample >= 0 && now - this.lastSample <= FRESH_MS; }

  get current(): Orientation {
    if (!this.raw || !this.origin) return { yaw: 0, pitch: 0 };
    return this.relative(this.raw);
  }

  /** Sample at display cadence, filling the gaps between slower sensor events. */
  sample(now: number): Orientation {
    if (!this.raw || !this.origin || !this.rendered) return { yaw: 0, pitch: 0 };
    if (!Number.isFinite(now) || now <= this.lastFrame || now - this.lastSample > FRESH_MS) return this.relative(this.rendered);
    const elapsed = Math.min(100, now - this.lastFrame);
    const age = Math.max(0, now - this.lastSample);
    // Short prediction reduces motion latency; taper it away on a stalled stream
    // instead of integrating stale velocity indefinitely.
    const prediction = Math.min(age, PREDICTION_MS) * Math.max(0, 1 - Math.max(0, age - 50) / 70) / 1000;
    const speed = Math.max(Math.abs(this.velocity.yaw), Math.abs(this.velocity.pitch));
    const smoothingMs = Math.max(18, 70 / (1 + speed / 30));
    const blend = 1 - Math.exp(-elapsed / smoothingMs);
    for (const axis of ['yaw', 'pitch'] as const) {
      const target = this.raw[axis] + clamp(this.velocity[axis] * prediction, MAX_PREDICTION);
      this.rendered[axis] = normalizeDegrees(this.rendered[axis] + blend * normalizeDegrees(target - this.rendered[axis]));
    }
    this.lastFrame = now;
    return this.relative(this.rendered);
  }

  private relative(pose: Orientation): Orientation {
    if (!this.origin) return { yaw: 0, pitch: 0 };
    return {
      yaw: normalizeDegrees(this.yawSign * normalizeDegrees(pose.yaw - this.origin.yaw)),
      pitch: clamp(this.pitchSign * normalizeDegrees(pose.pitch - this.origin.pitch), 90),
    };
  }

  private resetRendering(now: number): void {
    this.rendered = this.raw && { ...this.raw };
    this.lastFrame = now;
    this.velocity = { yaw: 0, pitch: 0 };
  }

  confirm(now: number): string | null {
    if (!this.isFresh(now) || !this.raw || !this.calibrationBaseline) return 'Waiting for fresh head motion. Keep the glasses awake.';
    if (this.step === 'right') {
      const turn = normalizeDegrees(this.raw.yaw - this.calibrationBaseline.yaw);
      if (Math.abs(turn) < 2 || Math.abs(turn) > 45) return 'Turn right until your fixed point reaches the left + marker, then confirm.';
      this.yawSign = Math.sign(turn);
      this.horizontalFov = measuredFov(Math.abs(turn));
      this.step = 'up';
    } else if (this.step === 'up') {
      const tilt = normalizeDegrees(this.raw.pitch - this.calibrationBaseline.pitch);
      if (Math.abs(tilt) < 2 || Math.abs(tilt) > 45) return 'Recenter your fixed point, then tilt UP until it reaches the bottom + marker.';
      if (Math.abs(normalizeDegrees(this.raw.yaw - this.calibrationBaseline.yaw)) > this.horizontalFov / 4) return 'Face the original point again before tilting up.';
      this.pitchSign = Math.sign(tilt);
      this.verticalFov = measuredFov(Math.abs(tilt));
      // Set the angular origin at this calibrated pose, avoiding beta's wrap boundary.
      this.origin = { ...this.raw };
      this.resetRendering(now);
      this.step = 'place';
    } else if (this.step === 'place') this.step = 'done';
    return null;
  }
}

function angularDelta(pose: Orientation, reference: Orientation): Orientation {
  return { yaw: normalizeDegrees(pose.yaw - reference.yaw), pitch: normalizeDegrees(pose.pitch - reference.pitch) };
}

// Calibration markers sit 16px inside the 600px canvas. Recover full angular FOV.
export function measuredFov(angleToMarker: number): number {
  return 2 * Math.atan(Math.tan(angleToMarker * Math.PI / 180) * 300 / 284) * 180 / Math.PI;
}

type OrientationConstructor = { prototype?: DeviceOrientationEvent; requestPermission?: () => Promise<string> };
export interface SensorHost {
  DeviceOrientationEvent?: OrientationConstructor;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/** Explicit user-gesture start; denial never installs listeners. */
export class HeadOrientation {
  tracker = new OrientationTracker();
  private state: TrackingStatus = 'off';
  private generation = 0;
  private listening = false;
  private startedAt = 0;
  private readonly onSample: EventListener = (event) => {
    const now = this.now();
    if (this.state === 'live' && !this.tracker.isFresh(now)) {
      this.host.removeEventListener('deviceorientation', this.onSample);
      this.listening = false;
      this.state = 'stale';
      return;
    }
    if (this.tracker.accept(event as DeviceOrientationEvent, now)) this.state = 'live';
  };

  constructor(private readonly host: SensorHost = window, private readonly now = () => performance.now()) {}

  get status(): TrackingStatus {
    if (this.state === 'live' && !this.tracker.isFresh(this.now())) return 'stale';
    if (this.state === 'waiting' && this.now() - this.startedAt > 5000) return 'unavailable';
    return this.state;
  }
  get current(): Orientation { return this.sample(this.now()); }
  sample(now = this.now()): Orientation { return this.tracker.sample(now); }

  async start(): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.tracker = new OrientationTracker();
    const api = this.host.DeviceOrientationEvent;
    if (!api) { this.state = 'unavailable'; return; }
    this.state = 'waiting';
    this.startedAt = this.now();
    try {
      if (api.requestPermission && await api.requestPermission() !== 'granted') {
        if (generation === this.generation) this.state = 'denied';
        return;
      }
      if (generation !== this.generation) return;
      this.host.addEventListener('deviceorientation', this.onSample);
      this.listening = true;
    } catch {
      if (generation === this.generation) this.state = 'denied';
    }
  }

  stop(): void {
    this.generation += 1;
    if (this.listening) this.host.removeEventListener('deviceorientation', this.onSample);
    this.listening = false;
    this.state = 'off';
  }
}
