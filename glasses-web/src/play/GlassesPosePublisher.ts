import type { WalkingPose } from '../../../companion-web/src/WalkingTracker';
import type { GlassesPoseChange } from './GlassesMotion';

interface PoseOutput {
  heading(yaw: number): void;
  move(x: number, z: number): void;
}

/**
 * Separate heading from translation and retain the final sample of each burst.
 * RoomClient drops moves less than 60ms apart, so every destination (including
 * manual steps/taps) goes through this single 80ms lane. Turning never enters it.
 */
export class GlassesPosePublisher {
  private pendingHeading: number | null = null;
  private pendingMove: { x: number; z: number } | null = null;
  private headingTimer?: ReturnType<typeof setTimeout>;
  private moveTimer?: ReturnType<typeof setTimeout>;
  private lastHeadingAt = -Infinity;
  private lastMoveAt: number;

  constructor(private readonly output: PoseOutput, private readonly now = () => performance.now()) {
    this.lastMoveAt = this.now();
  }

  publish(pose: WalkingPose, reason: GlassesPoseChange): void {
    if (![pose.x, pose.z, pose.yaw].every(Number.isFinite)) return;
    this.pendingHeading = pose.yaw;
    this.flushHeading();
    if (reason === 'step') this.move(pose.x, pose.z);
  }

  move(x: number, z: number): void {
    if (![x, z].every(Number.isFinite)) return;
    this.pendingMove = { x, z };
    this.flushMove();
  }

  /** Cancel work belonging to a disconnected/hidden session; never replay it. */
  clear(): void {
    this.clearHeading();
    clearTimeout(this.moveTimer);
    this.moveTimer = undefined;
    this.pendingMove = null;
  }

  /** Stopping head tracking releases facing immediately without dropping a final step. */
  clearHeading(): void {
    clearTimeout(this.headingTimer);
    this.headingTimer = undefined;
    this.pendingHeading = null;
  }

  private flushHeading(): void {
    if (this.pendingHeading === null || this.headingTimer !== undefined) return;
    const remaining = this.lastHeadingAt + 100 - this.now();
    if (remaining > 0) {
      this.headingTimer = setTimeout(() => { this.headingTimer = undefined; this.flushHeading(); }, remaining);
      return;
    }
    const heading = this.pendingHeading;
    this.pendingHeading = null;
    this.lastHeadingAt = this.now();
    this.output.heading(heading);
  }

  private flushMove(): void {
    if (this.pendingMove === null || this.moveTimer !== undefined) return;
    const remaining = this.lastMoveAt + 80 - this.now();
    if (remaining > 0) {
      this.moveTimer = setTimeout(() => { this.moveTimer = undefined; this.flushMove(); }, remaining);
      return;
    }
    const destination = this.pendingMove;
    this.pendingMove = null;
    this.lastMoveAt = this.now();
    this.output.move(destination.x, destination.z);
  }
}
