import { expect, it } from 'vitest';
import { DeviceView, type DeviceAttitude } from './DeviceView';
import { WalkingTracker } from './WalkingTracker';
const sample = (overrides: Partial<DeviceAttitude> = {}): DeviceAttitude => ({ yaw: 0, gravityX: 0, gravityY: -0.8, gravityZ: -0.6, screenAngle: 0, timestamp: 100, ...overrides });

it('turns without GPS or a compass and crosses the yaw boundary smoothly', () => {
  const view = new DeviceView();
  view.reset(90);
  expect(view.sample(sample({ yaw: Math.PI - 0.1 }))?.degrees).toBe(90);
  const turned = view.sample(sample({ yaw: -Math.PI + 0.1, timestamp: 150 }))!;
  expect(turned.degrees).toBeCloseTo(90 - 0.2 * 180 / Math.PI);
  const tracker = new WalkingTracker(); tracker.moveTo(3, -12);
  tracker.heading(turned.degrees, 0);
  expect(tracker.pose.x).toBe(3); expect(tracker.pose.z).toBe(-12);
});

it('calibrates neutral tilt, responds to pitch and roll, and bounds the camera', () => {
  const view = new DeviceView();
  expect(view.sample(sample())).toEqual({ degrees: 0, pitch: 0, roll: 0 });
  const tilted = view.sample(sample({ gravityX: .3, gravityY: -.6, gravityZ: -Math.sqrt(.55), timestamp: 150 }))!;
  expect(tilted.pitch).toBeLessThan(0); expect(tilted.roll).toBeGreaterThan(0);
  expect(Math.abs(tilted.pitch)).toBeLessThanOrEqual(.3); expect(Math.abs(tilted.roll)).toBeLessThanOrEqual(.2);
});

it('recenters when the iPad rotates between portrait and landscape or resumes', () => {
  const view = new DeviceView(); view.sample(sample());
  const rotated = view.sample(sample({ screenAngle: 90, yaw: 1.5, timestamp: 150 }))!;
  expect(rotated).toEqual({ degrees: 0, pitch: 0, roll: 0 });
  expect(view.sample(sample({ screenAngle: 90, yaw: 2, timestamp: 2000 }))).toEqual({ degrees: 0, pitch: 0, roll: 0 });
  view.reset(135);
  expect(view.sample(sample())).toEqual({ degrees: 135, pitch: 0, roll: 0 });
});

it('rejects invalid or stale motion samples without poisoning the next sample', () => {
  const view = new DeviceView(); view.sample(sample());
  expect(view.sample(sample())).toBeNull();
  expect(view.sample(sample({ yaw: NaN, timestamp: 150 }))).toBeNull();
  expect(view.sample(sample({ gravityZ: 10, timestamp: 150 }))).toBeNull();
  expect(view.sample(sample({ yaw: -.1, timestamp: 150 }))?.degrees).toBeCloseTo(.1 * 180 / Math.PI);
});

it('accepts a compass correction while retaining relative gyro turning', () => {
  const view = new DeviceView(); view.sample(sample()); view.alignHeading(180);
  expect(view.sample(sample({ yaw: -.1, timestamp: 150 }))?.degrees).toBeCloseTo(180 + .1 * 180 / Math.PI);
});
