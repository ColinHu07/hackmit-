import { describe, expect, it } from 'vitest';
import { HeadOrientation, OrientationTracker, measuredFov, type SensorHost } from './HeadOrientation';
import { placeAnchor, projectAnchor } from '../anchor/PseudoWorldAnchor';

function calibrated(sign = 1) {
  const tracker = new OrientationTracker();
  tracker.accept({ alpha: 358, beta: 20 }, 0);
  tracker.accept({ alpha: 358 + 15 * sign, beta: 20 }, 10);
  expect(tracker.confirm(10)).toBeNull();
  tracker.accept({ alpha: 358, beta: 30 }, 20);
  expect(tracker.confirm(20)).toBeNull();
  expect(tracker.confirm(20)).toBeNull();
  return tracker;
}

describe('calibrated head directions', () => {
  for (const sign of [1, -1]) it(`preserves the anchor through right turn, loss, and return (sensor sign ${sign})`, () => {
    const tracker = calibrated(sign);
    const anchor = placeAnchor(tracker.current);
    const saved = { ...anchor };
    tracker.accept({ alpha: 358 + 10 * sign, beta: 30 }, 30);
    expect(projectAnchor(anchor, tracker.current, 60, 60).x).toBeLessThan(300);
    tracker.accept({ alpha: 358 + 80 * sign, beta: 30 }, 40);
    expect(projectAnchor(anchor, tracker.current, 60, 60).visible).toBe(false);
    tracker.accept({ alpha: 358, beta: 30 }, 50);
    expect(projectAnchor(anchor, tracker.current, 60, 60)).toMatchObject({ visible: true, x: 300, y: 300 });
    expect(anchor).toEqual(saved);
  });
  it('calibrates reversed pitch and moves down when looking up', () => {
    const tracker = new OrientationTracker();
    tracker.accept({ alpha: 0, beta: 0 }, 0);
    tracker.accept({ alpha: 15, beta: 0 }, 1);
    tracker.confirm(1);
    tracker.accept({ alpha: 0, beta: -10 }, 2);
    tracker.confirm(2);
    tracker.confirm(2);
    const anchor = placeAnchor(tracker.current);
    tracker.accept({ alpha: 0, beta: -20 }, 3);
    expect(projectAnchor(anchor, tracker.current, 60, 60).y).toBeGreaterThan(300);
  });
  it('measures the field of view from safe-zone markers', () => {
    expect(measuredFov(7)).toBeCloseTo(14.78, 1);
    const tracker = calibrated();
    expect(tracker.horizontalFov).toBeCloseTo(measuredFov(15));
    expect(tracker.verticalFov).toBeCloseTo(measuredFov(10));
    expect(projectAnchor(placeAnchor({ yaw: 0, pitch: 0 }), { yaw: 15, pitch: 0 }, tracker.horizontalFov, tracker.verticalFov).x).toBeCloseTo(16);
  });
  it('does not treat null or nonfinite data as a valid heading', () => {
    const tracker = new OrientationTracker();
    for (const alpha of [null, NaN, Infinity]) expect(tracker.accept({ alpha, beta: 0 }, 0)).toBe(false);
    expect(tracker.isFresh(0)).toBe(false);
    expect(tracker.confirm(0)).toContain('fresh');
  });
  it('requires meaningful calibration movement and fresh samples', () => {
    const tracker = new OrientationTracker();
    tracker.accept({ alpha: 0, beta: 0 }, 0);
    expect(tracker.confirm(0)).toContain('Turn right');
    expect(tracker.step).toBe('right');
    expect(tracker.confirm(2000)).toContain('fresh');
    expect(tracker.isFresh(1200)).toBe(true);
    expect(tracker.isFresh(1201)).toBe(false);
  });
  it('handles calibration across alpha and beta wrap boundaries', () => {
    const tracker = new OrientationTracker();
    tracker.accept({ alpha: 355, beta: 175 }, 0);
    tracker.accept({ alpha: 10, beta: 175 }, 1);
    expect(tracker.confirm(1)).toBeNull();
    tracker.accept({ alpha: 355, beta: -175 }, 2);
    expect(tracker.confirm(2)).toBeNull();
    expect(tracker.current).toEqual({ yaw: 0, pitch: 0 });
  });
});

class FakeHost extends EventTarget implements SensorHost {
  DeviceOrientationEvent: SensorHost['DeviceOrientationEvent'] = {};
  sample(alpha: number | null, beta: number | null) {
    this.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha, beta }));
  }
}
describe('sensor permissions and lifecycle', () => {
  it('starts only on request, detects loss, and removes listeners on stop', async () => {
    const host = new FakeHost();
    let now = 0;
    const head = new HeadOrientation(host, () => now);
    host.sample(10, 10);
    expect(head.status).toBe('off');
    await head.start();
    expect(head.status).toBe('waiting');
    host.sample(null, null);
    expect(head.status).toBe('waiting');
    host.sample(10, 10);
    expect(head.status).toBe('live');
    now = 1201;
    expect(head.status).toBe('stale');
    host.sample(20, 20);
    expect(head.status).toBe('stale');
    head.stop();
    host.sample(20, 20);
    expect(head.status).toBe('off');
  });
  it('never listens after denial or a thrown permission error', async () => {
    for (const requestPermission of [async () => 'denied', async () => { throw new Error('denied'); }]) {
      const host = new FakeHost();
      host.DeviceOrientationEvent = { requestPermission };
      const head = new HeadOrientation(host, () => 0);
      await head.start();
      host.sample(0, 0);
      expect(head.status).toBe('denied');
    }
  });
  it('ignores a pending permission response after leaving the page', async () => {
    const host = new FakeHost();
    let grant!: (status: string) => void;
    host.DeviceOrientationEvent = { requestPermission: () => new Promise(resolve => { grant = resolve; }) };
    const head = new HeadOrientation(host, () => 0);
    const starting = head.start();
    head.stop();
    grant('granted');
    await starting;
    host.sample(0, 0);
    expect(head.status).toBe('off');
  });
  it('reports missing sensor API and a stream that sends no data', async () => {
    const host = new FakeHost();
    let now = 0;
    const head = new HeadOrientation(host, () => now);
    host.DeviceOrientationEvent = undefined;
    await head.start();
    expect(head.status).toBe('unavailable');
    host.DeviceOrientationEvent = {};
    await head.start();
    now = 5001;
    expect(head.status).toBe('unavailable');
  });
});
