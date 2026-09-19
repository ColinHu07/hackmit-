import { describe, expect, it } from 'vitest';
import { normalizeDegrees, placeAnchor, projectAnchor } from './PseudoWorldAnchor';

const forward = { yaw: 0, pitch: 0 };
const anchor = placeAnchor(forward);

describe('normalizeDegrees', () => {
  it.each([
    [0, 0],
    [180, -180],
    [-180, -180],
    [181, -179],
    [-181, 179],
    [360, 0],
    [-360, 0],
    [725, 5],
    [-725, -5],
  ])('normalizes %s degrees to %s', (input, expected) => {
    expect(normalizeDegrees(input)).toBe(expected);
  });

  it('safely handles non-finite and extremely large inputs', () => {
    for (const angle of [NaN, Infinity, -Infinity]) {
      expect(normalizeDegrees(angle)).toBe(0);
    }
    expect(normalizeDegrees(Number.MAX_VALUE)).toBeGreaterThanOrEqual(-180);
    expect(normalizeDegrees(Number.MAX_VALUE)).toBeLessThan(180);
  });
});

describe('placeAnchor', () => {
  it('copies the viewing direction without retaining a mutable orientation reference', () => {
    const orientation = { yaw: 370, pitch: 12 };
    const placed = placeAnchor(orientation, 'test-anchor');
    orientation.yaw = 90;
    orientation.pitch = -10;
    expect(placed).toEqual({ id: 'test-anchor', yaw: 10, pitch: 12, confidence: 1 });
    expect(anchor.id).toBe('nova-anchor');
  });

  it('bounds pitch rather than wrapping it', () => {
    expect(placeAnchor({ yaw: 0, pitch: 270 }).pitch).toBe(90);
    expect(placeAnchor({ yaw: 0, pitch: -270 }).pitch).toBe(-90);
  });

  it('disables an anchor placed from an invalid orientation', () => {
    const invalid = placeAnchor({ yaw: NaN, pitch: Infinity });
    expect(invalid.confidence).toBe(0);
    expect(Number.isFinite(invalid.yaw)).toBe(true);
    expect(Number.isFinite(invalid.pitch)).toBe(true);
    expect(projectAnchor(invalid, forward, 60, 40).visible).toBe(false);
  });
});

describe('projectAnchor', () => {
  it('centers an anchor when the head faces its stored direction', () => {
    const orientation = { yaw: 42, pitch: 13 };
    expect(projectAnchor(placeAnchor(orientation), orientation, 60, 40)).toEqual({
      visible: true,
      x: 300,
      y: 300,
      deltaYaw: 0,
      deltaPitch: 0,
      confidence: 1,
    });
  });

  it('moves the anchor left when the head turns right and right when it turns left', () => {
    const rightTurn = projectAnchor(anchor, { yaw: 10, pitch: 0 }, 60, 40);
    const leftTurn = projectAnchor(anchor, { yaw: -10, pitch: 0 }, 60, 40);
    expect(rightTurn.deltaYaw).toBe(-10);
    expect(rightTurn.x).toBeLessThan(300);
    expect(leftTurn.deltaYaw).toBe(10);
    expect(leftTurn.x).toBeGreaterThan(300);
    expect(rightTurn.x + leftTurn.x).toBeCloseTo(600);
  });

  it('moves the anchor down when looking up and up when looking down', () => {
    expect(projectAnchor(anchor, { yaw: 0, pitch: 10 }, 60, 40).y).toBeGreaterThan(300);
    expect(projectAnchor(anchor, { yaw: 0, pitch: -10 }, 60, 40).y).toBeLessThan(300);
  });

  it('uses perspective tangent mapping and honors a custom viewport', () => {
    const result = projectAnchor(placeAnchor({ yaw: 15, pitch: 10 }), forward, 60, 40, 800);
    expect(result.x).toBeCloseTo(400 + (Math.tan(Math.PI / 12) / Math.tan(Math.PI / 6)) * 400);
    expect(result.y).toBeCloseTo(400 - (Math.tan(Math.PI / 18) / Math.tan(Math.PI / 9)) * 400);
  });

  it('hides out of view and returns to the same position without moving the stored anchor', () => {
    const placed = Object.freeze(placeAnchor({ yaw: 12, pitch: 4 }));
    const before = projectAnchor(placed, forward, 60, 40);
    const away = projectAnchor(placed, { yaw: 110, pitch: 0 }, 60, 40);
    const returned = projectAnchor(placed, forward, 60, 40);
    expect(away.visible).toBe(false);
    expect(away.confidence).toBe(0);
    expect(returned).toEqual(before);
    expect(placed).toEqual({ id: 'nova-anchor', yaw: 12, pitch: 4, confidence: 1 });
  });

  it.each([
    [179, -179, -2],
    [-179, 179, 2],
    [359, 1, -2],
    [1, 359, 2],
    [720, -720, 0],
  ])('takes the shortest yaw difference for anchor %s and head %s', (anchorYaw, headYaw, expected) => {
    const result = projectAnchor(placeAnchor({ yaw: anchorYaw, pitch: 0 }), { yaw: headYaw, pitch: 0 }, 60, 40);
    expect(result.deltaYaw).toBe(expected);
    expect(result.visible).toBe(true);
  });

  it('does not wrap pitch differences across the poles', () => {
    const result = projectAnchor(placeAnchor({ yaw: 0, pitch: 90 }), { yaw: 0, pitch: -90 }, 60, 40);
    expect(result.deltaPitch).toBe(180);
    expect(result.visible).toBe(false);
    expect(result.y).toBeLessThan(0);
  });

  it.each([
    [30, 0, 600, 300],
    [-30, 0, 0, 300],
    [0, 20, 300, 0],
    [0, -20, 300, 600],
    [30, 20, 600, 0],
  ])('includes the rectangular FOV boundary at yaw %s, pitch %s', (yaw, pitch, x, y) => {
    const result = projectAnchor(placeAnchor({ yaw, pitch }), forward, 60, 40);
    expect(result.visible).toBe(true);
    expect(result.x).toBeCloseTo(x);
    expect(result.y).toBeCloseTo(y);
  });

  it.each([[30.001, 0], [-30.001, 0], [0, 20.001], [0, -20.001]])(
    'hides immediately outside the FOV at yaw %s, pitch %s',
    (yaw, pitch) => {
      const result = projectAnchor(placeAnchor({ yaw, pitch }), forward, 60, 40);
      expect(result.visible).toBe(false);
      expect(result.confidence).toBe(0);
    },
  );

  it.each([90, -90, 180, -180])('keeps offscreen coordinates finite at yaw %s', (yaw) => {
    const result = projectAnchor(placeAnchor({ yaw, pitch: 0 }), forward, 60, 40);
    expect(result.visible).toBe(false);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
    expect(Math.abs(result.x - 300)).toBeLessThanOrEqual(1200);
  });

  it('preserves valid confidence and disables zero-confidence anchors', () => {
    expect(projectAnchor({ ...anchor, confidence: 0.6 }, forward, 60, 40).confidence).toBe(0.6);
    expect(projectAnchor({ ...anchor, confidence: 2 }, forward, 60, 40).confidence).toBe(1);
    expect(projectAnchor({ ...anchor, confidence: 0 }, forward, 60, 40).visible).toBe(false);
    expect(projectAnchor({ ...anchor, confidence: -1 }, forward, 60, 40).confidence).toBe(0);
  });

  it.each([0, -1, 180, 360, NaN, Infinity, Number.MIN_VALUE])('rejects invalid FOV %s safely', (fov) => {
    for (const result of [
      projectAnchor(anchor, forward, fov, 40),
      projectAnchor(anchor, forward, 60, fov),
    ]) {
      expect(result).toMatchObject({ visible: false, confidence: 0, x: 300, y: 300 });
    }
  });

  it.each([0, -10, NaN, Infinity])('rejects invalid viewport %s safely', (viewport) => {
    expect(projectAnchor(anchor, forward, 60, 40, viewport)).toMatchObject({
      visible: false, confidence: 0, x: 300, y: 300,
    });
  });

  it('rejects invalid anchor and head values with finite projections', () => {
    const invalidInputs = [
      projectAnchor({ ...anchor, yaw: Infinity }, forward, 60, 40),
      projectAnchor({ ...anchor, pitch: NaN }, forward, 60, 40),
      projectAnchor({ ...anchor, pitch: 91 }, forward, 60, 40),
      projectAnchor({ ...anchor, confidence: NaN }, forward, 60, 40),
      projectAnchor(anchor, { yaw: NaN, pitch: 0 }, 60, 40),
      projectAnchor(anchor, { yaw: 0, pitch: -91 }, 60, 40),
    ];
    for (const result of invalidInputs) {
      expect(result.visible).toBe(false);
      expect(result.confidence).toBe(0);
      expect([result.x, result.y, result.deltaYaw, result.deltaPitch].every(Number.isFinite)).toBe(true);
    }
  });

  it('does not overflow for extremely large finite yaw and viewport values', () => {
    const result = projectAnchor(
      { ...anchor, yaw: Number.MAX_VALUE },
      { yaw: -Number.MAX_VALUE, pitch: 0 },
      60,
      40,
      Number.MAX_VALUE,
    );
    expect([result.x, result.y, result.deltaYaw, result.deltaPitch].every(Number.isFinite)).toBe(true);
  });
});
