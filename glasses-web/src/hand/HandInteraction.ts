import type { AnchorProjection } from '../anchor/PseudoWorldAnchor';
import type { HandFrame } from './CameraHands';
import { CALIBRATION_TARGETS, cameraToDisplay, fitCameraToDisplay, type Affine, type Point } from './HandCalibration';
import { PettingGesture, type HandResponse } from './PettingGesture';

export class HandInteraction {
  map: Affine | null = null;
  calibrating = false;
  calibrationIndex = 0;
  pointer: Point | null = null;
  response: HandResponse = { near: false, pet: false, reachX: 0, reachY: 0 };
  private calibrationPoints: Point[] = [];
  private samples: { point: Point; at: number; id: string }[] = [];
  private gesture = new PettingGesture();
  private shape = '';
  private currentId = '';
  private lastAt = -Infinity;
  onPet: () => void = () => {};
  get target(): Point | null { return this.calibrating ? CALIBRATION_TARGETS[this.calibrationIndex] ?? null : null; }
  get ready(): boolean { return !!this.map; }
  get isFresh(): boolean { return performance.now() - this.lastAt <= 350; }

  ingest(frame: HandFrame, projection: AnchorProjection, now: number): void {
    const shape = `${frame.streamId}:${frame.width}:${frame.height}`;
    if (this.shape && shape !== this.shape) this.reset();
    this.shape = shape;
    this.lastAt = now;
    const hands = frame.hands.filter(hand => hand.score >= 0.6);
    const hand = hands.find(hand => hand.id === this.currentId) ?? hands[0];
    const point = hand?.points[8];
    if (!hand || !point) { this.clearContact(); return; }
    if (hand.id !== this.currentId) { this.samples = []; this.gesture.reset(); }
    this.currentId = hand.id;
    this.samples.push({ point: { x: point.x, y: point.y }, at: now, id: hand.id });
    this.samples = this.samples.filter(sample => now - sample.at <= 400).slice(-5);
    this.pointer = this.map ? cameraToDisplay(point, this.map) : null;
    if (!this.calibrating && this.pointer) {
      this.response = this.gesture.observe(this.pointer, projection, now, `${frame.streamId}:${hand.id}`);
      if (this.response.pet) this.onPet();
    }
  }

  beginCalibration(): void {
    this.calibrating = true; this.calibrationIndex = 0; this.calibrationPoints = []; this.map = null;
    this.clearContact();
  }
  confirm(now: number): string | null {
    if (!this.calibrating) return 'Start hand alignment first.';
    const recent = this.samples.filter(sample => now - sample.at <= 350);
    if (recent.length < 3) return 'Hold one index fingertip over the + until the camera sees it steadily.';
    const mean = { x: recent.reduce((sum, sample) => sum + sample.point.x, 0) / recent.length, y: recent.reduce((sum, sample) => sum + sample.point.y, 0) / recent.length };
    if (recent.some(sample => Math.hypot(sample.point.x - mean.x, sample.point.y - mean.y) > 0.012)) return 'Keep your fingertip still over the +, then confirm.';
    this.calibrationPoints.push(mean);
    this.samples = [];
    if (this.calibrationIndex < 2) { this.calibrationIndex += 1; return null; }
    const map = fitCameraToDisplay(this.calibrationPoints);
    if (!map) { this.beginCalibration(); return 'Those points overlapped. Try again, moving your fingertip to each +.'; }
    this.map = map; this.calibrating = false;
    this.gesture.reset();
    return null;
  }
  expire(now: number): void { if (now - this.lastAt > 350) this.clearContact(); }
  reset(): void {
    this.map = null; this.calibrating = false; this.calibrationIndex = 0; this.calibrationPoints = [];
    this.shape = ''; this.lastAt = -Infinity; this.clearContact();
  }
  private clearContact(): void {
    this.pointer = null; this.samples = []; this.currentId = ''; this.gesture.reset();
    this.response = { near: false, pet: false, reachX: 0, reachY: 0 };
  }
}
