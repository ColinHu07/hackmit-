import { browserVerticalG, StepDetector } from '../../../companion-web/src/StepDetector';
import { WalkingTracker, type WalkingPose } from '../../../companion-web/src/WalkingTracker';

export type GlassesMotionStatus = 'off' | 'requesting' | 'waiting' | 'live' | 'stale' | 'paused' | 'denied' | 'unavailable' | 'simulated';
export type GlassesMotionSource = 'sensors' | 'simulator' | null;
export type GlassesPoseChange = 'heading' | 'step' | 'recenter';
export type GlassesSensorReadiness = 'off' | 'permission' | 'denied' | 'unavailable' | 'paused' | 'waiting' | 'ready' | 'stale' | 'incomplete';
export interface GlassesMotionState {
  status: GlassesMotionStatus;
  source: GlassesMotionSource;
  headingReady: boolean;
  motionReady: boolean;
  headStatus: GlassesSensorReadiness;
  stepStatus: GlassesSensorReadiness;
  readiness: string;
  steps: number;
  message: string;
}
type PermissionAPI = { prototype?: Event; requestPermission?: () => Promise<string> };
export interface GlassesSensorHost {
  isSecureContext: boolean;
  DeviceOrientationEvent?: PermissionAPI;
  DeviceMotionEvent?: PermissionAPI;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export interface GlassesVisibilityHost {
  hidden: boolean;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export interface GlassesMotionOptions {
  onPose?: (pose: WalkingPose, reason: GlassesPoseChange) => void;
  onStatus?: (state: GlassesMotionState) => void;
  host?: GlassesSensorHost;
  visibility?: GlassesVisibilityHost;
  now?: () => number;
  /** Sign of alpha's change during a clockwise/right head turn. Verify while worn. */
  yawSign?: 1 | -1;
}

const SENSOR_FRESH_MS = 1200;
const START_TIMEOUT_MS = 5000;
const PERMISSION_WAIT_MS = 8000;
const wrapDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;
const signedDegrees = (degrees: number) => wrapDegrees(degrees + 180) - 180;
const messages: Record<GlassesMotionStatus, string> = {
  off: 'Head tracking and walking are off.',
  requesting: 'Allow head tracking and walking sensors.',
  waiting: 'Face forward. Waiting for orientation and motion data…',
  live: 'Head turns steer your pet. Rhythmic steps move it forward.',
  stale: 'Head data paused. Tracking resumes when fresh readings return.',
  paused: 'Tracking paused while the app is hidden. Resume to continue.',
  denied: 'Motion permission was not granted. You can use the simulator.',
  unavailable: 'Waiting for head sensor data. You can also use Step forward.',
  simulated: 'Desktop simulator · no physical glasses tracking.',
};

/**
 * Foreground, relative-IMU gameplay; this is not positional tracking or a compass.
 * Call start() directly from an explicit button/Enter activation. It requests the
 * documented DeviceOrientationEvent and DeviceMotionEvent APIs together before
 * yielding the user activation. See docs/meta-capabilities.md for hardware limits.
 *
 * The first alpha is forward at the current avatar yaw. Standard alpha increases
 * counterclockwise, so default yawSign=-1; mounting/sign must be checked on-device.
 * Shared play-protocol/WalkingTracker convention: yaw is radians, forward is
 * (sin(yaw), cos(yaw)) in X/Z, yaw=PI faces -Z, and a right turn decreases yaw.
 * Orientation only changes yaw. Only confirmed acceleration rhythms translate.
 * Distance reuses the phone's deliberately exaggerated approximate step length.
 * Fresh heading and walking availability are independent. A foreground sensor
 * gap freezes that input but retains authorized listeners for automatic recovery;
 * missing accelerometer data must never disable live head steering. Walking only
 * resumes from new rhythmic samples, with no catch-up steps. Hiding pauses both
 * streams until the caller resumes its previously enabled session. Only stop()
 * revokes that intent; suspend() also preserves a permission prompt in progress.
 */
export class GlassesMotion {
  private readonly host: GlassesSensorHost;
  private readonly visibility: GlassesVisibilityHost;
  private readonly now: () => number;
  private readonly walking = new WalkingTracker();
  private readonly detector = new StepDetector();
  private currentStatus: GlassesMotionStatus = 'off';
  private source: GlassesMotionSource = null;
  private yawSign: 1 | -1;
  private baselineAlpha: number | null = null;
  private baselineYaw = Math.PI;
  private lastAlpha: number | null = null;
  private lastHeadingAt = -Infinity;
  private lastMotionAt = -Infinity;
  private lastIncompleteMotionAt = -Infinity;
  private orientationFrame: 'relative' | 'absolute' | null = null;
  private startedAt = 0;
  private stepCount = 0;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private permissionTimer?: ReturnType<typeof setTimeout>;
  private finishStart?: (started: boolean) => void;
  private sensorsAttached = false;
  private visibilityAttached = false;
  private motionAllowed = false;
  private sensorAuthorized = false;
  private motionAttached = false;
  private headPermissionPending = false;
  private motionPermissionPending = false;
  private headDenied = false;
  private motionDenied = false;
  private suspended = false;
  private permissionTimedOut = false;
  private publishedState = '';

  constructor(private readonly options: GlassesMotionOptions = {}) {
    this.host = options.host ?? window;
    this.visibility = options.visibility ?? document;
    this.now = options.now ?? (() => performance.now());
    this.yawSign = options.yawSign ?? -1;
  }

  get pose(): WalkingPose { return { ...this.walking.pose }; }
  get status(): GlassesMotionStatus { this.checkFreshness(); return this.currentStatus; }
  get state(): GlassesMotionState { this.checkFreshness(); return this.snapshot(); }

  /** Synchronize once on join/reconnect or an authoritative teleport, not every frame. */
  syncPose(pose: WalkingPose): void {
    if (![pose.x, pose.z, pose.yaw].every(Number.isFinite)) return;
    this.walking.moveTo(pose.x, pose.z);
    this.setYaw(pose.yaw);
    this.baselineYaw = this.walking.pose.yaw;
    this.baselineAlpha = this.lastAlpha;
    this.detector.reset();
  }

  setWorldLimit(limit: number): void { this.walking.setWorldLimit(limit); }

  /** Change a verified mounting convention without snapping the avatar's pose. */
  setYawSign(sign: 1 | -1): void {
    if (sign !== 1 && sign !== -1) return;
    this.yawSign = sign;
    this.baselineAlpha = this.lastAlpha;
    this.baselineYaw = this.walking.pose.yaw;
    this.detector.reset();
  }

  /** This physical facing becomes forward (-Z), retaining the character's location. */
  recenter(yaw = Math.PI): boolean {
    this.checkFreshness();
    if (!Number.isFinite(yaw) || this.lastAlpha === null || !this.headingFresh()) return false;
    this.baselineAlpha = this.lastAlpha;
    this.setYaw(yaw);
    this.baselineYaw = this.walking.pose.yaw;
    this.detector.reset();
    this.options.onPose?.(this.pose, 'recenter');
    return true;
  }

  async start(): Promise<boolean> {
    this.stop();
    this.source = 'sensors';
    if (this.visibility.hidden) { this.setStatus('paused'); return false; }
    const orientation = this.host.DeviceOrientationEvent;
    const motion = this.host.DeviceMotionEvent;
    if (!this.host.isSecureContext || !orientation) { this.setStatus('unavailable'); return false; }
    const generation = this.generation;
    this.headPermissionPending = true;
    this.motionPermissionPending = !!motion;
    this.attachVisibility();
    this.setStatus('requesting');
    const started = new Promise<boolean>(resolve => { this.finishStart = resolve; });
    this.permissionTimer = setTimeout(() => {
      this.permissionTimer = undefined;
      if (generation !== this.generation || !this.headPermissionPending) return;
      this.permissionTimedOut = true;
      if (!this.suspended && !this.visibility.hidden) this.setStatus('unavailable');
      this.finishStarting(false);
    }, PERMISSION_WAIT_MS);
    // Both APIs are invoked inside the activation. A stalled accelerometer prompt
    // must not hold up granted head tracking; later grants join the same session.
    const request = (api: PermissionAPI | undefined): Promise<string> => {
      if (!api) return Promise.resolve('unavailable');
      try { return (api.requestPermission?.() ?? Promise.resolve('granted')).catch(() => 'denied'); }
      catch { return Promise.resolve('denied'); }
    };
    const permissions = [request(orientation), request(motion)] as const;
    void permissions[1].then(result => {
      if (generation !== this.generation) return;
      this.motionPermissionPending = false;
      this.motionAllowed = result === 'granted';
      this.motionDenied = result === 'denied';
      this.attachMotion();
      this.publishState();
    });
    void permissions[0].then(result => {
      if (generation !== this.generation) return;
      clearTimeout(this.permissionTimer); this.permissionTimer = undefined;
      this.headPermissionPending = false;
      this.sensorAuthorized = result === 'granted';
      this.headDenied = result === 'denied';
      if (this.suspended || this.visibility.hidden) { this.pause('paused'); this.finishStarting(false); return; }
      if (!this.sensorAuthorized) { this.detach(); this.setStatus('denied'); this.finishStarting(false); return; }
      this.beginSensors();
      this.finishStarting(true);
    });
    return started;
  }

  stop(): void {
    this.generation++;
    clearTimeout(this.permissionTimer); this.permissionTimer = undefined;
    this.finishStarting(false);
    this.detach();
    this.resetReadings();
    this.motionAllowed = false;
    this.sensorAuthorized = false;
    this.headPermissionPending = this.motionPermissionPending = false;
    this.headDenied = this.motionDenied = false;
    this.suspended = this.permissionTimedOut = false;
    this.source = null;
    this.setStatus('off');
  }

  /** Pause lifecycle work, including an outstanding permission prompt, until resumed. */
  suspend(): void {
    if (this.currentStatus !== 'off') this.pause('paused');
  }

  /** Resume a suspended, already-authorized session without a permission prompt.
   * The caller owns intent (for example a brief network reconnect); stop() clears
   * this ability. A hidden page never resumes, and stale footfalls are discarded. */
  resume(): boolean {
    if (this.visibility.hidden || this.source === null) return false;
    if (this.source === 'sensors' && this.headPermissionPending) {
      this.suspended = false;
      this.attachVisibility();
      this.setStatus(this.permissionTimedOut ? 'unavailable' : 'requesting');
      return true;
    }
    if (this.source === 'sensors' && this.sensorAuthorized) {
      if (this.sensorsAttached && !this.suspended) { this.checkFreshness(); return true; }
      this.suspended = false;
      this.beginSensors();
      return true;
    }
    if (this.source === 'simulator') {
      if (this.currentStatus === 'simulated') return true;
      this.suspended = false;
      this.detector.reset();
      this.walking.setStepTracking(true);
      this.attachVisibility();
      this.setStatus('simulated');
      return true;
    }
    return false;
  }

  /** Opt-in desktop mode never installs sensor listeners or requests permission. */
  startSimulation(): void {
    this.stop();
    this.source = 'simulator';
    this.resetReadings();
    this.baselineAlpha = this.lastAlpha = 0;
    this.lastHeadingAt = this.now();
    this.attachVisibility();
    this.setStatus(this.visibility.hidden ? 'paused' : 'simulated');
  }

  /** Absolute clockwise degrees within the simulator's initial reference frame. */
  simulateHeading(clockwiseDegrees: number): boolean {
    if (this.status !== 'simulated' || !Number.isFinite(clockwiseDegrees)) return false;
    this.acceptAlpha(clockwiseDegrees / this.yawSign, this.now());
    return true;
  }

  simulateSteps(count = 1): boolean {
    if (this.status !== 'simulated') return false;
    return this.advance(count);
  }

  private onOrientation: EventListener = event => {
    this.checkFreshness();
    if (this.source !== 'sensors' || !this.acceptingSamples()) return;
    const alpha = (event as DeviceOrientationEvent).alpha;
    if (typeof alpha !== 'number' || !Number.isFinite(alpha)) return;
    const now = this.now();
    const frame = event.type === 'deviceorientationabsolute' ? 'absolute' : 'relative';
    if (this.orientationFrame !== null && frame !== this.orientationFrame) {
      if (this.sampleFresh(this.lastHeadingAt, now)) return;
      // A fallback event may use a different zero; switching it must not turn the
      // pet or invent motion. The next delta in the new frame does the steering.
      this.baselineAlpha = wrapDegrees(alpha);
      this.baselineYaw = this.walking.pose.yaw;
      this.detector.reset();
    }
    this.orientationFrame = frame;
    this.acceptAlpha(alpha, now);
  };

  private onMotion: EventListener = event => {
    this.checkFreshness();
    if (this.source !== 'sensors' || !this.acceptingSamples()) return;
    const motion = event as DeviceMotionEvent;
    const vertical = browserVerticalG(motion.acceleration, motion.accelerationIncludingGravity);
    const now = this.now();
    if (vertical === null) {
      if (Number.isFinite(now)) this.lastIncompleteMotionAt = now;
      this.publishState();
      return;
    }
    if (!Number.isFinite(now) || now < this.lastMotionAt) return;
    if (!this.sampleFresh(this.lastMotionAt, now)) this.detector.reset();
    this.lastMotionAt = now;
    this.updateReadiness();
    if (this.currentStatus !== 'live') { this.detector.reset(); return; }
    const steps = this.detector.sample(vertical, now);
    if (steps) this.advance(steps);
  };

  private onVisibility: EventListener = () => {
    if (this.visibility.hidden) this.suspend();
    else this.checkFreshness();
  };

  private acceptAlpha(alpha: number, now: number): void {
    if (!Number.isFinite(now) || now < this.lastHeadingAt) return;
    this.lastAlpha = wrapDegrees(alpha);
    this.lastHeadingAt = now;
    if (this.baselineAlpha === null) this.baselineAlpha = this.lastAlpha;
    const clockwise = this.yawSign * signedDegrees(this.lastAlpha - this.baselineAlpha);
    const previous = this.walking.pose.yaw;
    this.setYaw(this.baselineYaw - clockwise * Math.PI / 180);
    // Resume the UI/network gate before delivering the first returning heading.
    if (this.source === 'sensors') this.updateReadiness();
    if (Math.abs(signedDegrees((this.walking.pose.yaw - previous) * 180 / Math.PI)) > 0.01) {
      this.options.onPose?.(this.pose, 'heading');
    }
  }

  private advance(count: number): boolean {
    if (!this.walking.steps(count)) return false;
    this.stepCount += count;
    this.options.onPose?.(this.pose, 'step');
    this.publishState();
    return true;
  }

  private setYaw(yaw: number): void {
    this.walking.heading(wrapDegrees((Math.PI - yaw) * 180 / Math.PI), 0);
  }

  private acceptingSamples(): boolean {
    return !this.visibility.hidden && (this.currentStatus === 'simulated'
      || this.sensorsAttached && ['waiting', 'live', 'stale', 'unavailable'].includes(this.currentStatus));
  }

  private updateReadiness(): void {
    const now = this.now();
    if (this.sampleFresh(this.lastHeadingAt, now)) this.setStatus('live');
    else if (Number.isFinite(this.lastHeadingAt)) this.setStatus('stale');
    else this.setStatus(now - this.startedAt > START_TIMEOUT_MS ? 'unavailable' : 'waiting');
  }

  private checkFreshness(): void {
    if (!(this.sensorsAttached || this.currentStatus === 'simulated')) return;
    if (this.visibility.hidden) { this.pause('paused'); return; }
    if (this.source === 'simulator') return;
    const now = this.now();
    if (!this.sampleFresh(this.lastHeadingAt, now) || !this.sampleFresh(this.lastMotionAt, now)) this.detector.reset();
    this.updateReadiness();
  }

  private pause(status: 'paused'): void {
    this.suspended = true;
    this.detach();
    this.detector.reset();
    this.walking.setStepTracking(false);
    this.setStatus(status);
  }

  private resetReadings(): void {
    this.detector.reset();
    this.walking.setStepTracking(true);
    this.baselineAlpha = this.lastAlpha = null;
    this.baselineYaw = this.walking.pose.yaw;
    this.lastHeadingAt = this.lastMotionAt = -Infinity;
    this.lastIncompleteMotionAt = -Infinity;
    this.orientationFrame = null;
    this.stepCount = 0;
  }

  private beginSensors(): void {
    this.resetReadings();
    this.startedAt = this.now();
    this.host.addEventListener('deviceorientation', this.onOrientation);
    this.host.addEventListener('deviceorientationabsolute', this.onOrientation);
    this.sensorsAttached = true;
    this.attachMotion();
    this.attachVisibility();
    this.timer = setInterval(() => this.checkFreshness(), 250);
    this.setStatus('waiting');
  }

  private attachVisibility(): void {
    if (this.visibilityAttached) return;
    this.visibility.addEventListener('visibilitychange', this.onVisibility);
    this.visibilityAttached = true;
  }

  private detach(): void {
    if (this.sensorsAttached) {
      this.host.removeEventListener('deviceorientation', this.onOrientation);
      this.host.removeEventListener('deviceorientationabsolute', this.onOrientation);
      this.sensorsAttached = false;
    }
    if (this.motionAttached) this.host.removeEventListener('devicemotion', this.onMotion);
    this.motionAttached = false;
    if (this.visibilityAttached) {
      this.visibility.removeEventListener('visibilitychange', this.onVisibility);
      this.visibilityAttached = false;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private setStatus(status: GlassesMotionStatus): void {
    this.currentStatus = status;
    this.publishState();
  }

  private finishStarting(started: boolean): void {
    const finish = this.finishStart;
    this.finishStart = undefined;
    finish?.(started);
  }

  private attachMotion(): void {
    if (!this.motionAllowed || !this.sensorsAttached || this.motionAttached || this.suspended || this.visibility.hidden) return;
    this.host.addEventListener('devicemotion', this.onMotion);
    this.motionAttached = true;
  }

  private publishState(): void {
    const state = this.snapshot();
    const signature = [state.status, state.source, state.headingReady, state.motionReady, state.headStatus, state.stepStatus, state.steps, state.message].join(':');
    if (signature === this.publishedState) return;
    this.publishedState = signature;
    this.options.onStatus?.(state);
  }

  private sampleFresh(at: number, now = this.now()): boolean {
    return Number.isFinite(at) && now >= at && now - at <= SENSOR_FRESH_MS;
  }

  private headingFresh(): boolean {
    return this.acceptingSamples() && (this.source === 'simulator' || this.sampleFresh(this.lastHeadingAt));
  }

  private snapshot(): GlassesMotionState {
    const headingReady = this.headingFresh();
    const motionReady = this.acceptingSamples() && this.source === 'sensors' && this.sampleFresh(this.lastMotionAt);
    const headStatus: GlassesSensorReadiness = this.source !== 'sensors' ? 'off'
      : this.headDenied ? 'denied' : this.headPermissionPending ? 'permission'
        : !this.sensorAuthorized ? 'unavailable' : this.suspended ? 'paused'
          : headingReady ? 'ready' : Number.isFinite(this.lastHeadingAt) ? 'stale' : 'waiting';
    const stepStatus: GlassesSensorReadiness = this.source !== 'sensors' ? 'off'
      : this.motionDenied ? 'denied' : this.motionPermissionPending ? 'permission'
        : !this.motionAllowed ? 'unavailable' : this.suspended ? 'paused'
          : motionReady ? 'ready' : this.sampleFresh(this.lastIncompleteMotionAt) ? 'incomplete'
            : Number.isFinite(this.lastMotionAt) ? 'stale' : 'waiting';
    const readiness = `Head ${headStatus === 'ready' ? 'live' : headStatus} · steps ${stepStatus === 'incomplete' ? 'no acceleration' : stepStatus} · ${this.stepCount} detected`;
    return {
      status: this.currentStatus,
      source: this.source,
      headingReady,
      motionReady,
      headStatus,
      stepStatus,
      readiness,
      steps: this.stepCount,
      message: this.source === 'sensors' && !['off', 'paused', 'denied'].includes(this.currentStatus)
        ? readiness : messages[this.currentStatus],
    };
  }
}
