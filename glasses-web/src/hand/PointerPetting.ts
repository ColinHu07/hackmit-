import type { Point } from './HandCalibration';
import { PettingGesture, type HandResponse, type PetTarget } from './PettingGesture';

const inactive = (): HandResponse => ({ near: false, pet: false, reachX: 0, reachY: 0 });

/** Adapt mouse, pen, and touch to the same head contact used by the glasses camera. */
export class PointerPetting {
  private gesture = new PettingGesture();
  private point: Point | null = null;
  private start: Point | null = null;
  private pointerId: number | null = null;
  private dragged = false;
  private lastSampleAt = -Infinity;
  private response = inactive();

  get activePointerId(): number | null { return this.pointerId; }

  begin(point: Point, id: number): boolean {
    if (this.pointerId !== null) return false;
    this.gesture.reset();
    this.lastSampleAt = -Infinity;
    this.pointerId = id;
    this.point = { ...point };
    this.start = { ...point };
    this.dragged = false;
    return true;
  }

  move(point: Point, id: number): void {
    if (this.pointerId !== null && this.pointerId !== id) return;
    this.point = { ...point };
    if (this.start && Math.hypot(point.x - this.start.x, point.y - this.start.y) > 6) this.dragged = true;
  }

  /** Return a tap once; a stroke never becomes a second pet on release. */
  finish(point: Point, id: number, target: PetTarget): boolean {
    return this.finishAction(point, id, target) === 'pet';
  }

  /** Empty floor taps move Nova; body taps and held strokes keep their pet behavior. */
  finishAction(point: Point, id: number, target: PetTarget, groundY?: number): 'pet' | 'move' | null {
    if (id !== this.pointerId) return null;
    this.move(point, id);
    const hit = (sample: Point): 'pet' | 'move' | null => {
      if (Math.hypot(sample.x - target.x, sample.y - target.y) < 100) return 'pet';
      if (groundY !== undefined && sample.y >= groundY && sample.y <= 600
        && sample.x >= 0 && sample.x <= 600) return 'move';
      return null;
    };
    const action = !this.dragged && target.visible && this.start && hit(this.start) === hit(point)
      ? hit(point) : null;
    this.pointerId = null;
    this.start = null;
    this.gesture.reset();
    this.lastSampleAt = -Infinity;
    return action;
  }

  update(target: PetTarget, at: number): HandResponse {
    if (!target.visible || !this.point) { this.clear(); return inactive(); }
    if (this.pointerId === null) {
      // Hover can invite Nova to lean closer, but only a held stroke pets her.
      this.gesture.reset();
      this.response = this.gesture.observe(this.point, target, at, 'pointer-hover');
      this.gesture.reset();
    } else if (at - this.lastSampleAt >= 50) {
      // High-rate pointer/RAF samples otherwise look like subpixel camera jitter.
      this.response = this.gesture.observe(this.point, target, at, `pointer-${this.pointerId}`);
      this.lastSampleAt = at;
    }
    const response = { ...this.response };
    this.response.pet = false;
    return response;
  }

  clear(): void {
    this.point = null;
    this.start = null;
    this.pointerId = null;
    this.dragged = false;
    this.lastSampleAt = -Infinity;
    this.response = inactive();
    this.gesture.reset();
  }
}
