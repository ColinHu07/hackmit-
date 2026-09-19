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
  autoHopSpeed: 100,
  landingDecay: 12,
  arrivalDistance: 0.25,
});

export interface NovaLocomotionState {
  x: number;
  height: number;
  velocityX: number;
  velocityY: number;
  grounded: boolean;
  moving: boolean;
  facing: -1 | 1;
  /** Ground distance travelled, suitable for a speed-matched running cycle. */
  strideDistance: number;
  /** A landing impulse that decays from 1 to 0 for a brief squash pose. */
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
  private facing: -1 | 1 = 1;
  private strideDistance = 0;
  private landing = 0;
  private targetX: number | null = null;
  private route: number[] = [];
  private hopsRemaining = 0;
  private canHopOnLeg = false;
  private accumulator = 0;

  get state(): Readonly<NovaLocomotionState> {
    return {
      x: this.x, height: this.height,
      velocityX: this.velocityX, velocityY: this.velocityY,
      grounded: this.grounded, moving: Math.abs(this.velocityX) > 1,
      facing: this.facing, strideDistance: this.strideDistance,
      landing: this.landing,
      running: this.targetX !== null || Math.abs(this.velocityX) > 1,
      targetX: this.targetX,
    };
  }

  moveTo(x: number): void {
    if (!Number.isFinite(x)) return;
    this.route = [];
    this.hopsRemaining = 0;
    this.canHopOnLeg = false;
    this.targetX = clampX(x);
  }

  jump(): boolean {
    if (!this.grounded) return false;
    this.grounded = false;
    this.velocityY = settings.jumpSpeed;
    this.landing = 0;
    return true;
  }

  /** A roughly five-second run, braking before each turn and returning home. */
  runAround(): void {
    const direction = this.x > 60 ? -1 : 1;
    this.route = [direction * 115, -direction * 115, direction * 65, 0];
    this.hopsRemaining = 2;
    this.canHopOnLeg = true;
    this.targetX = this.route.shift() ?? null;
  }

  stop(): void {
    this.route = [];
    this.hopsRemaining = 0;
    this.canHopOnLeg = false;
    this.targetX = null;
  }

  reset(): void {
    this.x = this.height = this.velocityX = this.velocityY = 0;
    this.strideDistance = this.landing = this.accumulator = 0;
    this.grounded = true;
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

    // Airborne characters retain momentum; a changed target takes effect on landing.
    const startX = this.x;
    if (this.grounded) {
      let desiredVelocity = 0;
      if (this.targetX !== null) {
        const distance = this.targetX - this.x;
        const arrivalSpeed = settings.braking * delta;
        let arrived = false;
        if (Math.abs(distance) <= settings.arrivalDistance && Math.abs(this.velocityX) <= arrivalSpeed) {
          this.x = this.targetX;
          this.velocityX = 0;
          this.targetX = this.route.shift() ?? null;
          this.canHopOnLeg = this.targetX !== null;
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

    if (this.grounded && this.canHopOnLeg && this.hopsRemaining > 0 && this.targetX !== null) {
      const speed = Math.abs(this.velocityX);
      const remaining = this.targetX - this.x;
      const flightDistance = speed * (2 * settings.jumpSpeed / settings.gravity);
      const stoppingDistance = speed * speed / (2 * settings.braking);
      // Launch only after building momentum, with enough runway to land and brake.
      if (speed >= settings.autoHopSpeed && remaining * this.velocityX > 0
        && Math.abs(remaining) > flightDistance + stoppingDistance + 5) {
        this.jump();
        this.hopsRemaining--;
        this.canHopOnLeg = false;
      }
    }

    if (!this.grounded) {
      // Exact constant-acceleration integration, followed by an inelastic floor collision.
      this.height += this.velocityY * delta - 0.5 * settings.gravity * delta * delta;
      this.velocityY -= settings.gravity * delta;
      if (this.height <= 0) {
        this.height = this.velocityY = 0;
        this.grounded = true;
        this.landing = 1;
      }
    }
  }
}
