import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STEP_METERS, STEP_MOVEMENT_GAIN, WALK_SCALE } from '../../../companion-web/src/WalkingTracker';
import { GlassesMotion, type GlassesSensorHost, type GlassesVisibilityHost } from './GlassesMotion';

class SensorHost extends EventTarget implements GlassesSensorHost {
  isSecureContext = true;
  DeviceOrientationEvent: GlassesSensorHost['DeviceOrientationEvent'] = {};
  DeviceMotionEvent: GlassesSensorHost['DeviceMotionEvent'] = {};
  orientation(alpha: number | null): void {
    this.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha, beta: 0, gamma: 0 }));
  }
  motion(verticalG: number): void {
    this.dispatchEvent(Object.assign(new Event('devicemotion'), {
      acceleration: { x: 0, y: 0, z: verticalG * 9.80665 },
      accelerationIncludingGravity: { x: 0, y: 0, z: (verticalG - 1) * 9.80665 },
    }));
  }
}
class VisibilityHost extends EventTarget implements GlassesVisibilityHost {
  hidden = false;
  hide(hidden: boolean): void { this.hidden = hidden; this.dispatchEvent(new Event('visibilitychange')); }
}
function setup() {
  const host = new SensorHost();
  const visibility = new VisibilityHost();
  const onPose = vi.fn(), onStatus = vi.fn();
  let clock = 0;
  const controller = new GlassesMotion({ host, visibility, onPose, onStatus, now: () => clock });
  const at = (now: number) => { clock = now; };
  const walk = (start: number, duration: number, alpha: number | null = 0) => {
    for (let elapsed = 0; elapsed < duration; elapsed += 25) {
      at(start + elapsed);
      if (alpha !== null) host.orientation(alpha);
      host.motion(Math.sin(elapsed / 500 * 2 * Math.PI) * 0.24);
    }
  };
  return { controller, host, visibility, onPose, onStatus, at, walk };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const stepDistance = STEP_METERS * WALK_SCALE * STEP_MOVEMENT_GAIN;

describe('relative head facing and estimated walking', () => {
  it('calibrates first heading to current avatar yaw and crosses 0/360 by the short angle', async () => {
    const t = setup();
    t.controller.syncPose({ x: 3, z: -2, yaw: Math.PI });
    await t.controller.start();
    t.host.orientation(358);
    expect(t.controller.pose).toEqual({ x: 3, z: -2, yaw: Math.PI });
    t.at(20); t.host.orientation(2);
    expect(t.controller.pose.yaw).toBeCloseTo(-Math.PI + 4 * Math.PI / 180);
    expect(t.controller.pose.x).toBe(3); expect(t.controller.pose.z).toBe(-2);
    expect(t.onPose).toHaveBeenLastCalledWith(t.controller.pose, 'heading');
    t.at(40); t.host.orientation(355);
    expect(t.controller.pose.yaw).toBeCloseTo(Math.PI - 3 * Math.PI / 180);
    t.controller.stop();
  });

  it('turns without translating and only rhythmic footfalls move in the facing direction', async () => {
    const t = setup();
    await t.controller.start();
    t.host.orientation(0);
    for (let now = 0; now < 1500; now += 25) {
      t.at(now); t.host.orientation(-now / 1500 * 90); t.host.motion(0);
    }
    expect(t.controller.pose.x).toBe(0); expect(t.controller.pose.z).toBe(0);
    expect(t.controller.state.steps).toBe(0);
    t.walk(1500, 2000, 270);
    expect(t.controller.state.steps).toBe(4);
    expect(t.controller.pose.yaw).toBeCloseTo(Math.PI / 2);
    expect(t.controller.pose.x).toBeCloseTo(4 * stepDistance);
    expect(t.controller.pose.z).toBeCloseTo(0);
    t.controller.stop();
  });

  it('does not translate for a single bump, missing heading, or invalid sensor data', async () => {
    const t = setup();
    await t.controller.start();
    t.walk(0, 1000, null);
    expect(t.controller.state.steps).toBe(0);
    t.host.orientation(null); t.host.orientation(NaN); t.host.orientation(Infinity);
    expect(t.controller.state.headingReady).toBe(false);
    t.walk(1000, 500, 0);
    for (let now = 1500; now < 2500; now += 25) {
      t.at(now); t.host.orientation(0); t.host.motion(0);
    }
    expect(t.controller.pose.x).toBe(0); expect(t.controller.pose.z).toBe(0);
    expect(t.controller.state.steps).toBe(0);
    t.controller.stop();
  });

  it('recenter and a corrected sensor mounting keep location fixed', async () => {
    const t = setup();
    await t.controller.start();
    t.host.orientation(0); t.host.motion(0);
    t.host.orientation(270);
    t.controller.syncPose({ x: 2, z: 3, yaw: Math.PI / 2 });
    expect(t.controller.recenter()).toBe(true);
    expect(t.controller.pose).toEqual({ x: 2, z: 3, yaw: Math.PI });
    t.controller.setYawSign(1);
    t.host.orientation(0);
    expect(t.controller.pose.yaw).toBeCloseTo(Math.PI / 2);
    expect(t.controller.pose.x).toBe(2); expect(t.controller.pose.z).toBe(3);
    t.controller.stop();
  });

  it('shares server bounds and does not replay steps after an authoritative pose sync', async () => {
    const t = setup();
    t.controller.setWorldLimit(1);
    await t.controller.start();
    t.walk(0, 500);
    t.controller.syncPose({ x: 0, z: 0, yaw: Math.PI });
    t.walk(500, 500);
    expect(t.controller.pose.z).toBe(0);
    t.walk(1000, 2000);
    expect(t.controller.pose.z).toBe(-1);
    t.controller.stop();
  });
});

describe('permission and foreground lifecycle', () => {
  it('requests both permissions within the initiating activation and ignores late grants after stop', async () => {
    const t = setup();
    let grantOrientation!: (permission: string) => void;
    let grantMotion!: (permission: string) => void;
    const orientation = vi.fn(() => new Promise<string>(resolve => { grantOrientation = resolve; }));
    const motion = vi.fn(() => new Promise<string>(resolve => { grantMotion = resolve; }));
    t.host.DeviceOrientationEvent = { requestPermission: orientation };
    t.host.DeviceMotionEvent = { requestPermission: motion };
    expect(orientation).not.toHaveBeenCalled(); expect(motion).not.toHaveBeenCalled();
    const starting = t.controller.start();
    expect(orientation).toHaveBeenCalledTimes(1); expect(motion).toHaveBeenCalledTimes(1);
    t.controller.stop();
    grantOrientation('granted'); grantMotion('granted');
    expect(await starting).toBe(false);
    t.host.orientation(0); t.host.motion(0);
    expect(t.controller.status).toBe('off');
    expect(t.onPose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed for denied, insecure, missing, and silent sensors', async () => {
    const denied = setup();
    denied.host.DeviceMotionEvent = { requestPermission: async () => 'denied' };
    expect(await denied.controller.start()).toBe(false);
    denied.walk(0, 2000); expect(denied.controller.status).toBe('denied');
    expect(denied.onPose).not.toHaveBeenCalled();
    const insecure = setup(); insecure.host.isSecureContext = false;
    expect(await insecure.controller.start()).toBe(false);
    expect(insecure.controller.status).toBe('unavailable');
    const missing = setup(); missing.host.DeviceOrientationEvent = undefined;
    expect(await missing.controller.start()).toBe(false);
    const silent = setup(); await silent.controller.start();
    silent.at(5001); vi.advanceTimersByTime(250);
    expect(silent.controller.status).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not revive a pending permission request after backgrounding and returning', async () => {
    const t = setup();
    let grant!: (permission: string) => void;
    t.host.DeviceMotionEvent = { requestPermission: () => new Promise(resolve => { grant = resolve; }) };
    const starting = t.controller.start();
    t.visibility.hide(true); t.controller.suspend();
    t.visibility.hide(false); grant('granted');
    expect(await starting).toBe(false);
    t.walk(0, 2000);
    expect(t.controller.status).toBe('paused');
    expect(t.controller.state.headingReady).toBe(false);
    expect(t.onPose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops on a stale heading even if accelerometer events keep arriving', async () => {
    const t = setup(); await t.controller.start();
    t.host.orientation(0); t.host.motion(0);
    t.walk(25, 1100, null);
    const before = t.controller.pose;
    t.walk(1300, 2000, null);
    expect(t.controller.status).toBe('stale');
    expect(t.controller.pose).toEqual(before);
    t.host.orientation(90); t.host.motion(0.24);
    expect(t.controller.status).toBe('stale');
    expect(t.controller.recenter()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await t.controller.start();
    t.walk(3500, 500);
    expect(t.controller.pose).toEqual(before);
    expect(t.controller.state.steps).toBe(0);
    t.controller.stop();
  });

  it('freezes when hidden, requires explicit resume, and clears pending footfalls', async () => {
    const t = setup(); await t.controller.start(); t.walk(0, 500);
    t.visibility.hide(true);
    expect(t.controller.status).toBe('paused');
    expect(vi.getTimerCount()).toBe(0);
    t.walk(500, 2000);
    t.visibility.hide(false);
    t.host.orientation(90);
    expect(t.controller.status).toBe('paused');
    expect(t.controller.pose).toEqual({ x: 0, z: 0, yaw: Math.PI });
    await t.controller.start(); t.walk(2500, 500);
    expect(t.controller.state.steps).toBe(0);
    t.walk(3000, 500);
    expect(t.controller.state.steps).toBe(2);
    t.controller.stop();
  });

  it('reports a dead motion stream through the watchdog even when head data continues', async () => {
    const t = setup(); await t.controller.start();
    t.host.orientation(0); t.host.motion(0);
    for (let now = 100; now <= 1200; now += 100) {
      t.at(now); t.host.orientation(now / 100);
    }
    t.at(1300); vi.advanceTimersByTime(250);
    expect(t.controller.state).toMatchObject({ status: 'stale', headingReady: false, motionReady: false });
    expect(t.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'stale' }));
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('keeps deterministic desktop movement explicitly separate from physical sensors', () => {
  const t = setup();
  const request = vi.fn();
  t.host.DeviceOrientationEvent = { requestPermission: request };
  expect(t.controller.simulateSteps()).toBe(false);
  t.controller.startSimulation();
  expect(t.controller.state).toMatchObject({ status: 'simulated', source: 'simulator' });
  expect(t.controller.state.message).toContain('no physical glasses');
  expect(request).not.toHaveBeenCalled();
  t.controller.simulateHeading(90);
  expect(t.controller.pose.x).toBe(0); expect(t.controller.pose.z).toBe(0);
  t.controller.simulateSteps(2);
  expect(t.controller.pose.x).toBeCloseTo(2 * stepDistance);
  expect(t.controller.pose.z).toBeCloseTo(0);
  const before = t.controller.pose;
  t.walk(0, 2000);
  expect(t.controller.pose).toEqual(before);
  expect(t.controller.simulateSteps(3)).toBe(false);
  t.visibility.hide(true);
  expect(t.controller.simulateSteps()).toBe(false);
  t.controller.stop();
});
