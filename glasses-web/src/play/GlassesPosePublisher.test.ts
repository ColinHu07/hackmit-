import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GlassesPosePublisher } from './GlassesPosePublisher';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup() {
  const heading = vi.fn(), move = vi.fn();
  return { heading, move, publisher: new GlassesPosePublisher({ heading, move }, () => Date.now()) };
}

it('publishes rotation and recenter as heading only, never a stale position', () => {
  const t = setup();
  t.publisher.publish({ x: -200, z: -200, yaw: 1 }, 'heading');
  vi.advanceTimersByTime(30);
  t.publisher.publish({ x: -200, z: -200, yaw: 2 }, 'recenter');
  vi.advanceTimersByTime(200);
  expect(t.heading.mock.calls).toEqual([[1], [2]]);
  expect(t.move).not.toHaveBeenCalled();
});

it('delivers the last rapid step even if no later sensor event arrives', () => {
  const t = setup();
  vi.advanceTimersByTime(100);
  t.publisher.publish({ x: 0, z: -0.35, yaw: Math.PI }, 'step');
  vi.advanceTimersByTime(25);
  t.publisher.publish({ x: 0, z: -0.70, yaw: Math.PI }, 'step');
  vi.advanceTimersByTime(25);
  t.publisher.publish({ x: 0, z: -1.05, yaw: Math.PI }, 'step');
  expect(t.move.mock.calls).toEqual([[0, -0.35]]);
  vi.advanceTimersByTime(30);
  expect(t.move.mock.calls).toEqual([[0, -0.35], [0, -1.05]]);
  vi.advanceTimersByTime(1000);
  expect(t.move).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps a pending step destination when only heading changes before its send', () => {
  const t = setup();
  t.publisher.publish({ x: 0, z: -1, yaw: Math.PI }, 'step');
  vi.advanceTimersByTime(20);
  t.publisher.publish({ x: 99, z: 99, yaw: Math.PI / 2 }, 'heading');
  vi.advanceTimersByTime(100);
  expect(t.move.mock.calls).toEqual([[0, -1]]);
  expect(t.heading).toHaveBeenLastCalledWith(Math.PI / 2);
});

it('shares a transport-safe move cadence across walking, manual steps, and taps', () => {
  const times: number[] = [];
  const destinations: number[] = [];
  const t = new GlassesPosePublisher({ heading: () => {}, move: x => { times.push(Date.now()); destinations.push(x); } }, () => Date.now());
  t.move(1, 0);
  vi.advanceTimersByTime(90);
  t.publish({ x: 2, z: 0, yaw: 0 }, 'step');
  vi.advanceTimersByTime(10);
  t.move(3, 0);
  vi.advanceTimersByTime(500);
  expect(destinations).toEqual([1, 3]);
  expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(80);
});

it('clears queued commands on disconnect and accepts a new session without replay', () => {
  const t = setup();
  t.publisher.publish({ x: 3, z: 4, yaw: 1 }, 'step');
  t.publisher.publish({ x: 4, z: 5, yaw: 2 }, 'step');
  t.publisher.clear();
  vi.advanceTimersByTime(200);
  expect(t.move).not.toHaveBeenCalled();
  expect(t.heading.mock.calls).toEqual([[1]]);
  t.publisher.publish({ x: 30, z: 40, yaw: 3 }, 'step');
  expect(t.move.mock.calls).toEqual([[30, 40]]);
  expect(t.heading).toHaveBeenLastCalledWith(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('releases pending head steering on pause while retaining the final completed step', () => {
  const t = setup();
  t.publisher.publish({ x: 0, z: -0.35, yaw: 1 }, 'step');
  t.publisher.publish({ x: 0, z: -0.7, yaw: 2 }, 'step');
  t.publisher.clearHeading();
  vi.advanceTimersByTime(200);
  expect(t.heading.mock.calls).toEqual([[1]]);
  expect(t.move.mock.calls).toEqual([[0, -0.7]]);
});
