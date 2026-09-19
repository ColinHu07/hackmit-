import type { Point } from './HandCalibration';
export interface PetTarget extends Point { visible: boolean }
export interface HandResponse { near: boolean; pet: boolean; reachX: number; reachY: number }
const inactive: HandResponse = { near: false, pet: false, reachX: 0, reachY: 0 };

/** Require a real stroke through the head region, not merely a hand dwelling there. */
export class PettingGesture {
  private previous: { point: Point; target: Point; at: number; id: string } | null = null;
  private start: Point | null = null;
  private since = 0;
  private samples = 0;
  private distance = 0;
  private lastPet = -Infinity;
  reset(): void { this.previous = null; this.start = null; this.samples = 0; this.distance = 0; }
  observe(point: Point | null, target: PetTarget, at: number, id: string): HandResponse {
    if (!point || !target.visible || ![point.x, point.y, target.x, target.y, at].every(Number.isFinite)) { this.reset(); return { ...inactive }; }
    const head = { x: target.x, y: target.y - 48 };
    const dx = point.x - head.x, dy = point.y - head.y;
    const near = Math.hypot(dx / 95, dy / 65) <= 1;
    if (!near) { this.reset(); return { ...inactive }; }
    const response = { near: true, pet: false, reachX: Math.max(-12, Math.min(12, dx * 0.18)), reachY: Math.max(-6, Math.min(8, -dy * 0.12)) };
    const inside = Math.hypot(dx / 64, dy / 34) <= 1;
    if (!inside) { this.reset(); return response; }
    const prev = this.previous;
    const movement = prev ? Math.hypot(point.x - prev.point.x, point.y - prev.point.y) : 0;
    const gap = prev ? at - prev.at : Infinity;
    const headMovement = prev ? Math.hypot(target.x - prev.target.x, target.y - prev.target.y) : 0;
    // Losing a hand, identity swaps, fast head turns, and inference gaps break contact.
    if (!prev || prev.id !== id || gap <= 0 || gap > 250 || movement / gap > 0.8 || headMovement > 6 || at - this.since > 1200) {
      this.start = { ...point }; this.since = at; this.samples = 0; this.distance = 0;
    } else {
      this.distance += Math.max(0, movement - 1.5); // absorb small landmark jitter
      this.samples += 1;
    }
    this.previous = { point: { ...point }, target: { ...target }, at, id };
    const displacement = this.start ? Math.hypot(point.x - this.start.x, point.y - this.start.y) : 0;
    if (this.samples >= 3 && at - this.since >= 180 && this.distance >= 28 && displacement >= 24 && at - this.lastPet >= 2400) {
      this.lastPet = at;
      response.pet = true;
      this.reset();
    }
    return response;
  }
}
