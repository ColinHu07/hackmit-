import { normalizeDegrees, type Orientation } from '../anchor/PseudoWorldAnchor';

export interface SensorSample { alpha: number | null; beta: number | null }
export type TrackingStatus = 'off' | 'waiting' | 'live' | 'stale' | 'denied' | 'unavailable';
export type CalibrationStep = 'right' | 'up' | 'place' | 'done';
const FRESH_MS = 1200;

/** Relative IMU directions, not a position/SLAM tracker. Calibrate signs on-device. */
export class OrientationTracker {
  private origin: Orientation | null = null;
  private raw: Orientation | null = null;
  private calibrationBaseline: Orientation | null = null;
  private lastSample = -Infinity;
  horizontalFov = 60;
  verticalFov = 60;
  private yawSign = 1;
  private pitchSign = 1;
  step: CalibrationStep = 'right';

  accept(sample: SensorSample, now: number): boolean {
    if (sample.alpha === null || sample.beta === null || !Number.isFinite(sample.alpha) || !Number.isFinite(sample.beta)) return false;
    this.raw = { yaw: normalizeDegrees(sample.alpha), pitch: normalizeDegrees(sample.beta) };
    if (!this.origin) {
      this.origin = { ...this.raw };
      this.calibrationBaseline = { ...this.raw };
    }
    this.lastSample = now;
    return true;
  }

  isFresh(now: number): boolean { return !!this.raw && now - this.lastSample >= 0 && now - this.lastSample <= FRESH_MS; }

  get current(): Orientation {
    if (!this.raw || !this.origin) return { yaw: 0, pitch: 0 };
    return {
      yaw: normalizeDegrees(this.yawSign * normalizeDegrees(this.raw.yaw - this.origin.yaw)),
      pitch: Math.max(-90, Math.min(90, this.pitchSign * normalizeDegrees(this.raw.pitch - this.origin.pitch))),
    };
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
      this.step = 'place';
    } else if (this.step === 'place') this.step = 'done';
    return null;
  }
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
  get current(): Orientation { return this.tracker.current; }

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
