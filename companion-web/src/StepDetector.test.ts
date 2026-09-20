import { describe, expect, it } from 'vitest';
import { browserVerticalG, StepDetector } from './StepDetector';
import { STEP_METERS, STEP_MOVEMENT_GAIN, WALK_SCALE, WalkingTracker } from './WalkingTracker';

function samples(detector: StepDetector, start: number, length: number, signal: (t: number) => number): { at: number; count: number }[] {
  const results = [];
  for (let t = 0; t < length; t += 25) {
    const count = detector.sample(signal(t), start + t);
    if (count) results.push({ at: start + t, count });
  }
  return results;
}
const walking = (t: number) => Math.sin(t / 500 * 2 * Math.PI) * 0.24;

describe('responsive foreground steps', () => {
  it('confirms the first two footfalls in under one second and follows subsequent steps', () => {
    const result = samples(new StepDetector(), 0, 2000, walking);
    expect(result[0]?.count).toBe(2);
    expect(result[0]!.at).toBeLessThan(1000);
    expect(result.reduce((sum, step) => sum + step.count, 0)).toBe(4);
  });
  it('ignores stationary sensor noise, an isolated bump, and turning without translation', () => {
    expect(samples(new StepDetector(), 0, 5000, t => Math.sin(t) * 0.015)).toEqual([]);
    expect(samples(new StepDetector(), 0, 2500, t => t < 500 ? walking(t) : 0)).toEqual([]);
    for (const gravity of [{ x: 0, y: 0, z: -9.80665 }, { x: 0, y: -9.80665, z: 0 }, { x: 9.80665, y: 0, z: 0 }]) {
      expect(browserVerticalG({ x: 0, y: 0, z: 0 }, gravity)).toBeCloseTo(0);
    }
  });
  it('does not replay the pending footfall after a pause or sensor gap', () => {
    const detector = new StepDetector();
    samples(detector, 0, 500, walking);
    detector.reset();
    expect(samples(detector, 1000, 500, walking)).toEqual([]);
    expect(samples(detector, 5000, 500, walking)).toEqual([]);
    expect(detector.sample(NaN, 5600)).toBe(0);
    expect(detector.sample(0.3, 5200)).toBe(0);
  });
  it('normalizes browser motion in any screen orientation and rejects missing gravity data', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const acceleration = { x: 0, y: 0, z: 0, [axis]: 0.2 * 9.80665 };
      const gravity = { x: 0, y: 0, z: 0, [axis]: -0.8 * 9.80665 };
      expect(browserVerticalG(acceleration, gravity)).toBeCloseTo(0.2);
    }
    expect(browserVerticalG(null, null)).toBeNull();
    expect(browserVerticalG({ x: null, y: 0, z: 0 }, { x: 0, y: 0, z: -9.8 })).toBeNull();
  });
  it('moves with steps even with indoor GPS, never double counts GPS, and supports every facing', () => {
    for (const heading of [0, 90, 180, 270]) {
      const tracker = new WalkingTracker();
      tracker.heading(heading, 5); tracker.setStepTracking(true);
      expect(tracker.steps(2)).toBe(true);
      const distance = 2 * STEP_METERS * WALK_SCALE * STEP_MOVEMENT_GAIN;
      expect(tracker.pose.x).toBeCloseTo(Math.sin(tracker.pose.yaw) * distance);
      expect(tracker.pose.z).toBeCloseTo(Math.cos(tracker.pose.yaw) * distance);
      const before = { ...tracker.pose };
      tracker.location({ latitude: 0, longitude: 0, accuracy: 50, timestamp: 1000 }, 1000);
      tracker.location({ latitude: 0.0001, longitude: 0, accuracy: 2, timestamp: 5000 }, 5000);
      expect(tracker.pose).toEqual(before);
      expect(tracker.steps(0)).toBe(false);
      tracker.heading((heading + 90) % 360, 5);
      expect(tracker.pose.x).toBe(before.x); expect(tracker.pose.z).toBe(before.z);
    }
  });
  it('allows forward walking before compass lock, and cleanly falls back to GPS', () => {
    const tracker = new WalkingTracker();
    tracker.setStepTracking(true); expect(tracker.steps(1)).toBe(true);
    expect(tracker.pose.z).toBeCloseTo(-STEP_METERS * WALK_SCALE * STEP_MOVEMENT_GAIN);
    tracker.setStepTracking(false); expect(tracker.steps(1)).toBe(false);
    const fix = { latitude: 0, longitude: 0, accuracy: 2, timestamp: 1000 };
    expect(tracker.location(fix, 1000).moved).toBe(false);
    expect(tracker.location({ ...fix, latitude: 0.00004, timestamp: 4000 }, 4000).moved).toBe(true);
  });
});
