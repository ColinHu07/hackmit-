import { describe, expect, it } from 'vitest';
import { placeAnchor, projectAnchor, type Orientation } from './PseudoWorldAnchor';
import { relocationStart } from './RelocationBearing';

describe('relocationStart', () => {
  it.each([
    { anchorYaw: 0, headYaw: 12, fov: 60, offset: 54 },
    { anchorYaw: 0, headYaw: -12, fov: 60, offset: -54 },
    { anchorYaw: 179, headYaw: -178, fov: 60, offset: 70 },
    { anchorYaw: -179, headYaw: 178, fov: 60, offset: -70 },
    { anchorYaw: 29.9, headYaw: 0, fov: 60, offset: -34 },
    { anchorYaw: -29.9, headYaw: 0, fov: 60, offset: 34 },
    { anchorYaw: 22, headYaw: 17, fov: 40, offset: 32 * 1.8 },
    { anchorYaw: -22, headYaw: -17, fov: 85, offset: -32 * 0.7 },
  ])('preserves the rendered x position for $anchorYaw°/$headYaw° with $offset px motion', ({ anchorYaw, headYaw, fov, offset }) => {
    const head = { yaw: headYaw, pitch: 5 };
    const anchor = Object.freeze({ ...placeAnchor({ yaw: anchorYaw, pitch: 9 }, 'walking-beaver'), confidence: 0.7 });
    const original = { ...anchor };
    const before = projectAnchor(anchor, head, fov, 60);
    const start = relocationStart(anchor, head, fov, offset);
    const after = projectAnchor(start, head, fov, 60);

    expect(after.x).toBeCloseTo(before.x + offset, 9);
    expect(after.y).toBe(before.y);
    expect(start).toMatchObject({ id: anchor.id, pitch: anchor.pitch, confidence: anchor.confidence });
    expect(anchor).toEqual(original);
  });

  it('keeps a stationary creature at precisely its existing anchor', () => {
    const anchor = placeAnchor({ yaw: 123.456789, pitch: 17 });
    expect(relocationStart(anchor, { yaw: -20, pitch: 3 }, 60, 0)).toEqual(anchor);
  });

  it.each([90, -90, 91, -91, 135, -135, 179, -179, 180])(
    'does not fold a creature at %s° behind the viewer into view',
    (deltaYaw) => {
      const head = { yaw: 175, pitch: 0 };
      const anchor = placeAnchor({ yaw: head.yaw + deltaYaw, pitch: 0 });
      for (const offset of [-1000, -50, 50, 1000]) {
        const start = relocationStart(anchor, head, 60, offset);
        const projection = projectAnchor(start, head, 60, 60);
        expect(projection.visible).toBe(false);
        expect(Math.abs(projection.deltaYaw)).toBeGreaterThanOrEqual(90);
        expect(Number.isFinite(start.yaw)).toBe(true);
      }
    },
  );

  it.each([0, -1, 180, 360, NaN, Infinity, Number.MIN_VALUE])('leaves the anchor unchanged for invalid FOV %s', (fov) => {
    const anchor = placeAnchor({ yaw: 12, pitch: 4 });
    expect(relocationStart(anchor, { yaw: 2, pitch: 0 }, fov, 45)).toEqual(anchor);
  });

  it('ignores non-finite inputs without introducing a different anchor', () => {
    const anchor = placeAnchor({ yaw: 12, pitch: 4 });
    const head: Orientation = { yaw: 2, pitch: 0 };
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(relocationStart(anchor, head, 60, bad)).toEqual(anchor);
      expect(relocationStart(anchor, { ...head, yaw: bad }, 60, 45)).toEqual(anchor);
      expect(relocationStart(anchor, { ...head, pitch: bad }, 60, 45)).toEqual(anchor);
      for (const key of ['yaw', 'pitch', 'confidence'] as const) {
        const invalid = { ...anchor, [key]: bad };
        expect(relocationStart(invalid, head, 60, 45)).toEqual(invalid);
      }
    }
  });

  it('handles very large finite yaw values without overflowing their difference', () => {
    const anchor = { ...placeAnchor({ yaw: 0, pitch: 0 }), yaw: Number.MAX_VALUE };
    const start = relocationStart(anchor, { yaw: -Number.MAX_VALUE, pitch: 0 }, 60, 45);
    expect(Number.isFinite(start.yaw)).toBe(true);
    expect(start.yaw).toBeGreaterThanOrEqual(-180);
    expect(start.yaw).toBeLessThan(180);
  });
});
