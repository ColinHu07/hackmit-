/** Distances use the same local scene units as the character and its stage. */
export const NOVA_LOCOMOTION_SETTINGS = Object.freeze({
  fixedStep: 1 / 120,
  maxFrameDelta: 0.25,
  stageMinX: -145,
  stageMaxX: 145,
  maxSpeed: 190,
  acceleration: 520,
  braking: 640,
  gravity: 720,
  jumpSpeed: 250,
  anticipationDuration: 0.18,
  landingDuration: 0.32,
  landingDecay: 12,
  arrivalDistance: 0.25,
});

export type NovaJumpPhase = 'idle' | 'anticipation' | 'airborne' | 'landing';

export interface NovaLocomotionState {
  x: number;
  height: number;
  velocityX: number;
  velocityY: number;
  grounded: boolean;
  /** The contact-aware timeline used to bend, extend, and settle the pose. */
  jumpPhase: NovaJumpPhase;
  /** Seconds elapsed in the current jump phase; remains zero while idle. */
  jumpPhaseTime: number;
  moving: boolean;
  facing: -1 | 1;
  /** Ground distance travelled, suitable for a speed-matched running cycle. */
  strideDistance: number;
  /** A landing impulse that decays from 1 to 0 for a brief settling response. */
  landing: number;
  running: boolean;
  targetX: number | null;
}

const settings = NOVA_LOCOMOTION_SETTINGS;
const clampX = (x: number): number => Math.max(settings.stageMinX, Math.min(settings.stageMaxX, x));
const approach = (value: number, target: number, amount: number): number =>
  value + Math.max(-amount, Math.min(amount, target - value));

/**
 * Small stage physics: acceleration and braking on the ground, ballistic jumps,
 * and non-bouncing contact with the floor and stage edges. A bounded 120 Hz
 * accumulator makes the trajectory independent of ordinary rendering rates.
 * Excess time after a stalled frame is discarded to avoid a visible teleport.
 */
export class NovaLocomotion {
  private x = 0;
  private height = 0;
  private velocityX = 0;
  private velocityY = 0;
  private grounded = true;
  private jumpPhase: NovaJumpPhase = 'idle';
  private jumpPhaseTime = 0;
  private facing: -1 | 1 = 1;
  private strideDistance = 0;
  private landing = 0;
  private targetX: number | null = null;
  private route: number[] = [];
  private accumulator = 0;

  get state(): Readonly<NovaLocomotionState> {
    return {
      x: this.x, height: this.height,
      velocityX: this.velocityX, velocityY: this.velocityY,
      grounded: this.grounded, moving: Math.abs(this.velocityX) > 1,
      jumpPhase: this.jumpPhase, jumpPhaseTime: this.jumpPhaseTime,
      facing: this.facing, strideDistance: this.strideDistance,
      landing: this.landing,
      running: this.targetX !== null || Math.abs(this.velocityX) > 1,
      targetX: this.targetX,
    };
  }

  moveTo(x: number): void {
    if (!Number.isFinite(x)) return;
    this.route = [];
    this.targetX = clampX(x);
  }

  jump(): boolean {
    if (this.jumpPhase !== 'idle') return false;
    this.jumpPhase = 'anticipation';
    this.jumpPhaseTime = 0;
    this.landing = 0;
    return true;
  }

  /** A grounded run, braking before each turn and returning home. Jump is explicit. */
  runAround(): void {
    const direction = this.x > 60 ? -1 : 1;
    this.route = [direction * 115, -direction * 115, direction * 65, 0];
    this.targetX = this.route.shift() ?? null;
  }

  stop(): void {
    this.route = [];
    this.targetX = null;
  }

  /** Transfer this horizontal offset to an outer anchor without cancelling a jump. */
  rebaseHorizontal(): number {
    const offset = this.x;
    this.x = this.velocityX = 0;
    this.stop();
    return offset;
  }

  reset(): void {
    this.x = this.height = this.velocityX = this.velocityY = 0;
    this.strideDistance = this.landing = this.accumulator = 0;
    this.grounded = true;
    this.jumpPhase = 'idle';
    this.jumpPhaseTime = 0;
    this.facing = 1;
    this.stop();
  }

  update(deltaSeconds: number, enabled = true): Readonly<NovaLocomotionState> {
    if (!enabled) {
      this.accumulator = 0;
      return this.state;
    }
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return this.state;
    this.accumulator += Math.min(deltaSeconds, settings.maxFrameDelta);
    while (this.accumulator + 1e-10 >= settings.fixedStep) {
      this.step(settings.fixedStep);
      this.accumulator = Math.max(0, this.accumulator - settings.fixedStep);
    }
    return this.state;
  }

  private step(delta: number): void {
    this.landing *= Math.exp(-settings.landingDecay * delta);
    if (this.landing < 0.0001) this.landing = 0;

    // Keep momentum through loading and flight. A changed target takes effect
    // after landing, rather than snapping a running jump to a stationary crouch.
    const startX = this.x;
    if (this.grounded && this.jumpPhase !== 'anticipation') {
      let desiredVelocity = 0;
      if (this.targetX !== null) {
        const distance = this.targetX - this.x;
        const arrivalSpeed = settings.braking * delta;
        let arrived = false;
        if (Math.abs(distance) <= settings.arrivalDistance && Math.abs(this.velocityX) <= arrivalSpeed) {
          this.x = this.targetX;
          this.velocityX = 0;
          this.targetX = this.route.shift() ?? null;
          arrived = true;
        }
        if (this.targetX !== null && !arrived) {
          const remaining = this.targetX - this.x;
          // Stopping distance v² / (2a) limits approach speed before a turn.
          const approachSpeed = Math.sqrt(2 * settings.braking * Math.abs(remaining));
          desiredVelocity = Math.sign(remaining) * Math.min(settings.maxSpeed, approachSpeed);
        }
      }
      const braking = desiredVelocity * this.velocityX < 0 || Math.abs(desiredVelocity) < Math.abs(this.velocityX);
      const nextVelocity = approach(this.velocityX, desiredVelocity, (braking ? settings.braking : settings.acceleration) * delta);
      this.x += (this.velocityX + nextVelocity) * 0.5 * delta;
      this.velocityX = nextVelocity;
    } else {
      this.x += this.velocityX * delta;
    }

    // Resolve edge contact even during flight, with no rebound or repeated pushing.
    if (this.x < settings.stageMinX || this.x > settings.stageMaxX) {
      this.x = clampX(this.x);
      this.velocityX = 0;
    }
    if (Math.abs(this.velocityX) > 1) this.facing = this.velocityX < 0 ? -1 : 1;
    if (this.grounded) this.strideDistance += Math.abs(this.x - startX);

    if (this.jumpPhase === 'anticipation') {
      this.jumpPhaseTime += delta;
      if (this.jumpPhaseTime + 1e-10 >= settings.anticipationDuration) {
        // Start the arc at a step boundary with an unambiguous zero-time pose.
        this.jumpPhase = 'airborne';
        this.jumpPhaseTime = 0;
        this.grounded = false;
        this.velocityY = settings.jumpSpeed;
      }
    } else if (this.jumpPhase === 'airborne') {
      this.jumpPhaseTime += delta;
      // Exact constant-acceleration integration, followed by an inelastic floor collision.
      this.height += this.velocityY * delta - 0.5 * settings.gravity * delta * delta;
      this.velocityY -= settings.gravity * delta;
      if (this.height <= 0) {
        this.height = this.velocityY = 0;
        this.grounded = true;
        this.landing = 1;
        this.jumpPhase = 'landing';
        this.jumpPhaseTime = 0;
      }
    } else if (this.jumpPhase === 'landing') {
      this.jumpPhaseTime += delta;
      if (this.jumpPhaseTime + 1e-10 >= settings.landingDuration) {
        this.jumpPhase = 'idle';
        this.jumpPhaseTime = 0;
      }
    }
  }
}
