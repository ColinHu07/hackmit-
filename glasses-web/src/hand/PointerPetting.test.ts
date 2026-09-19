import { describe, expect, it } from 'vitest';
import { PointerPetting } from './PointerPetting';

const target = { x: 300, y: 300, visible: true };
const headPoint = (x: number) => ({ x, y: 252 });

describe('simulator pointer petting', () => {
  it('lets Nova lean toward hover without counting unpressed movement as petting', () => {
    const pointer = new PointerPetting();
    for (let i = 0; i < 7; i++) {
      pointer.move(headPoint(270 + i * 10), 1);
      const response = pointer.update(target, i * 80);
      expect(response.near).toBe(true);
      expect(response.pet).toBe(false);
    }
    expect(pointer.update(target, 600).reachX).toBeGreaterThan(0);
  });

  it('recognizes a held stroke at high refresh rates, once, and never taps on release', () => {
    const pointer = new PointerPetting();
    pointer.begin(headPoint(270), 1);
    let pets = 0;
    for (let at = 0; at <= 480; at += 8) {
      pointer.move(headPoint(270 + at / 8), 1);
      if (pointer.update(target, at).pet) pets += 1;
    }
    expect(pets).toBe(1);
    expect(pointer.finish(headPoint(330), 1, target)).toBe(false);
    expect(pointer.update(target, 500).pet).toBe(false);
  });

  it('keeps tap-to-pet on the body and rejects release-only or empty-space taps', () => {
    const pointer = new PointerPetting();
    expect(pointer.finish(target, 1, target)).toBe(false);
    pointer.begin({ x: 300, y: 340 }, 1);
    expect(pointer.finish({ x: 303, y: 341 }, 1, target)).toBe(true);
    expect(pointer.finish(target, 1, target)).toBe(false);
    pointer.begin({ x: 100, y: 100 }, 1);
    expect(pointer.finish({ x: 100, y: 100 }, 1, target)).toBe(false);
  });

  it('does not turn a drag away and back into a tap or pet a stationary hold', () => {
    const pointer = new PointerPetting();
    pointer.begin(headPoint(300), 1);
    for (let at = 0; at < 1000; at += 60) expect(pointer.update(target, at).pet).toBe(false);
    pointer.move(headPoint(320), 1);
    pointer.move(headPoint(300), 1);
    expect(pointer.finish(headPoint(300), 1, target)).toBe(false);
  });

  it('interrupts contact when Nova leaves view or input is cancelled', () => {
    for (const interrupt of ['out-of-view', 'cancel']) {
      const pointer = new PointerPetting();
      pointer.begin(headPoint(270), 1);
      [0, 80, 160].forEach((at, i) => { pointer.move(headPoint(270 + i * 10), 1); pointer.update(target, at); });
      if (interrupt === 'out-of-view') expect(pointer.update({ ...target, visible: false }, 180).near).toBe(false);
      else pointer.clear();
      expect(pointer.activePointerId).toBeNull();
      expect(pointer.update(target, 240).near).toBe(false);
      expect(pointer.finish(headPoint(310), 1, target)).toBe(false);
    }
  });

  it('ignores another pointer while a stroke is active', () => {
    const pointer = new PointerPetting();
    pointer.begin(headPoint(270), 1);
    expect(pointer.begin(headPoint(300), 2)).toBe(false);
    pointer.move({ x: 0, y: 0 }, 2);
    expect(pointer.finish(headPoint(300), 2, target)).toBe(false);
    expect(pointer.update(target, 0).near).toBe(true);
    expect(pointer.activePointerId).toBe(1);
    expect(pointer.finish(headPoint(270), 1, target)).toBe(true);
  });

  it('moves only on empty floor taps and still pets the body above the floor', () => {
    const pointer = new PointerPetting();
    pointer.begin({ x: 120, y: 390 }, 1);
    expect(pointer.finishAction({ x: 122, y: 390 }, 1, target, 345)).toBe('move');
    expect(pointer.finishAction({ x: 122, y: 390 }, 1, target, 345)).toBeNull();
    pointer.begin({ x: 300, y: 355 }, 1);
    expect(pointer.finishAction({ x: 300, y: 355 }, 1, target, 345)).toBe('pet');
    pointer.begin({ x: 120, y: 200 }, 1);
    expect(pointer.finishAction({ x: 120, y: 200 }, 1, target, 345)).toBeNull();
  });

  it('does not move after a floor drag, cancellation, or an off-canvas release', () => {
    const pointer = new PointerPetting();
    const floor = { x: 120, y: 390 };
    pointer.begin(floor, 1);
    pointer.move({ ...floor, x: 140 }, 1);
    expect(pointer.finishAction(floor, 1, target, 345)).toBeNull();
    pointer.begin(floor, 1);
    pointer.clear();
    expect(pointer.finishAction(floor, 1, target, 345)).toBeNull();
    pointer.begin({ x: 599, y: 390 }, 1);
    expect(pointer.finishAction({ x: 601, y: 390 }, 1, target, 345)).toBeNull();
  });

  it('pets Nova at her current position after she runs and jumps', () => {
    const pointer = new PointerPetting();
    const movingTarget = { ...target, x: 440, y: 240 };
    pointer.begin({ x: 440, y: 220 }, 1);
    expect(pointer.finishAction({ x: 440, y: 220 }, 1, movingTarget, 345)).toBe('pet');
  });
});
