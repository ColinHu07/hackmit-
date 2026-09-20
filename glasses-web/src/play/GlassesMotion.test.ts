import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STEP_METERS, STEP_MOVEMENT_GAIN, WALK_SCALE } from '../../../companion-web/src/WalkingTracker';
import { GlassesMotion, type GlassesSensorHost, type GlassesVisibilityHost } from './GlassesMotion';

class SensorHost extends EventTarget implements GlassesSensorHost {
  isSecureContext = true;
  DeviceOrientationEvent: GlassesSensorHost['DeviceOrientationEvent'] = {};
  DeviceMotionEvent: GlassesSensorHost['DeviceMotionEvent'] = {};
  orientation(alpha: number | null, type = 'deviceorientation'): void {
    this.dispatchEvent(Object.assign(new Event(type), { alpha, beta: 0, gamma: 0 }));
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

describe('automatic sensor startup', () => {
  it('starts heading and rhythmic walking immediately when no gesture permission API exists', () => {
    const t = setup();
    expect(t.controller.startWithoutPrompt()).toBe(true);
    expect(t.controller.state).toMatchObject({ status: 'waiting', source: 'sensors', needsPermissionGesture: false });
    t.host.orientation(200); t.at(100); t.host.orientation(290);
    expect(t.controller.pose.yaw).toBeCloseTo(Math.PI / 2);
    t.walk(200, 1000, 290);
    expect(t.controller.state).toMatchObject({ status: 'live', headingReady: true, motionReady: true, steps: 2 });
    expect(t.controller.pose.x).toBeCloseTo(2 * stepDistance);
    t.controller.stop();
  });

  it('does not reset live sensor listeners, heading calibration, or stride on another automatic start', () => {
    const t = setup();
    const attach = vi.spyOn(t.host, 'addEventListener');
    t.controller.startWithoutPrompt(); t.walk(0, 500);
    expect(t.controller.startWithoutPrompt()).toBe(true);
    t.walk(500, 500);
    expect(t.controller.state.steps).toBe(2);
    expect(attach.mock.calls.map(([event]) => event)).toEqual(['deviceorientation', 'deviceorientationabsolute', 'devicemotion']);
    expect(vi.getTimerCount()).toBe(1);
    t.controller.stop();
  });

  it('exposes a gesture requirement without invoking either permission prompt on automatic entry', async () => {
    const t = setup();
    const head = vi.fn(async () => 'granted'), motion = vi.fn(async () => 'granted');
    t.host.DeviceOrientationEvent = { requestPermission: head };
    t.host.DeviceMotionEvent = { requestPermission: motion };
    expect(t.controller.startWithoutPrompt()).toBe(false);
    expect(t.controller.startWithoutPrompt()).toBe(false);
    expect(t.controller.needsPermissionGesture).toBe(true);
    expect(t.controller.state).toMatchObject({ status: 'permission', headStatus: 'permission', stepStatus: 'permission', needsPermissionGesture: true });
    t.walk(0, 1000);
    expect(t.controller.state.steps).toBe(0);
    expect(head).not.toHaveBeenCalled(); expect(motion).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    // The application's trusted gesture handler is the only caller of start().
    const starting = t.controller.start();
    expect(head).toHaveBeenCalledOnce(); expect(motion).toHaveBeenCalledOnce();
    expect(await starting).toBe(true);
    expect(t.controller.needsPermissionGesture).toBe(false);
    t.walk(1000, 1000);
    expect(t.controller.state.steps).toBe(2);
    t.controller.stop();
  });

  it('auto-starts head steering while a separate walking permission awaits a gesture', async () => {
    const t = setup();
    const motion = vi.fn(async () => 'granted');
    t.host.DeviceMotionEvent = { requestPermission: motion };
    expect(t.controller.startWithoutPrompt()).toBe(true);
    t.host.orientation(0); t.at(100); t.host.orientation(90);
    expect(t.controller.state).toMatchObject({ status: 'live', headingReady: true, motionReady: false, stepStatus: 'permission', needsPermissionGesture: true });
    expect(t.controller.pose.yaw).toBeCloseTo(Math.PI / 2);
    t.walk(200, 1000, 90);
    expect(t.controller.state.steps).toBe(0);
    expect(motion).not.toHaveBeenCalled();
    await t.controller.start();
    t.walk(1200, 1000, 90);
    expect(t.controller.state).toMatchObject({ status: 'live', motionReady: true, needsPermissionGesture: false, steps: 2 });
    expect(motion).toHaveBeenCalledOnce();
    t.controller.stop();
  });

  it('never starts hidden tracking, then resumes without a prompt or old footfalls', () => {
    const t = setup();
    const attach = vi.spyOn(t.host, 'addEventListener');
    t.visibility.hide(true);
    expect(t.controller.startWithoutPrompt()).toBe(false);
    expect(t.controller.state.status).toBe('paused');
    expect(attach).not.toHaveBeenCalled();
    t.walk(0, 1000);
    expect(t.controller.state.steps).toBe(0);
    t.visibility.hide(false);
    expect(t.controller.resume()).toBe(true);
    t.walk(1000, 500);
    expect(t.controller.state.steps).toBe(0);
    t.walk(1500, 500);
    expect(t.controller.state.steps).toBe(2);
    t.controller.stop();
  });

  it('keeps gated sensors waiting for activation across background and foreground', () => {
    const t = setup();
    const head = vi.fn(async () => 'granted');
    t.host.DeviceOrientationEvent = { requestPermission: head };
    t.controller.startWithoutPrompt();
    t.visibility.hide(true);
    expect(t.controller.state).toMatchObject({ status: 'paused', needsPermissionGesture: true });
    t.visibility.hide(false);
    expect(t.controller.resume()).toBe(false);
    expect(t.controller.state).toMatchObject({ status: 'permission', needsPermissionGesture: true });
    expect(head).not.toHaveBeenCalled();
    t.controller.stop();
    expect(t.controller.needsPermissionGesture).toBe(false);
    expect(t.controller.resume()).toBe(false);
  });

  it('reuses an explicit grant for automatic foreground recovery and never re-prompts denial', async () => {
    const granted = setup();
    const head = vi.fn(async () => 'granted');
    granted.host.DeviceOrientationEvent = { requestPermission: head };
    await granted.controller.start();
    granted.controller.suspend();
    expect(granted.controller.startWithoutPrompt()).toBe(true);
    expect(head).toHaveBeenCalledOnce();
    expect(granted.controller.needsPermissionGesture).toBe(false);
    granted.controller.stop();
    const denied = setup();
    const refuse = vi.fn(async () => 'denied');
    denied.host.DeviceOrientationEvent = { requestPermission: refuse };
    await denied.controller.start();
    expect(denied.controller.startWithoutPrompt()).toBe(false);
    expect(denied.controller.state).toMatchObject({ status: 'denied', needsPermissionGesture: false });
    expect(refuse).toHaveBeenCalledOnce();
    denied.controller.stop();
  });

  it('reports unsupported contexts without requesting permissions or inventing movement', () => {
    for (const secure of [true, false]) {
      const t = setup();
      const permission = vi.fn();
      t.host.isSecureContext = secure;
      t.host.DeviceOrientationEvent = secure ? undefined : { requestPermission: permission };
      expect(t.controller.startWithoutPrompt()).toBe(false);
      expect(t.controller.state).toMatchObject({ status: 'unavailable', needsPermissionGesture: false });
      t.walk(0, 1000);
      expect(t.controller.state.steps).toBe(0);
      expect(permission).not.toHaveBeenCalled();
      t.controller.stop();
    }
  });
});

describe('relative head facing and estimated walking', () => {
  it('calibrates first heading to current avatar yaw and crosses 0/360 by the short angle', async () => {
    const t = setup();
    t.controller.syncPose({ x: 3, z: -2, yaw: Math.PI });
    await t.controller.start();
    t.host.orientation(358);
    expect(t.controller.pose).toEqual({ x: 3, z: -2, yaw: Math.PI });
    t.at(20); t.host.orientation(2);
    expect(t.controller.pose.yaw).toBeCloseTo(Math.PI - 4 * Math.PI / 180);
    expect(t.controller.pose.x).toBe(3); expect(t.controller.pose.z).toBe(-2);
    expect(t.onPose).toHaveBeenLastCalledWith(t.controller.pose, 'heading');
    t.at(40); t.host.orientation(355);
    expect(t.controller.pose.yaw).toBeCloseTo(-Math.PI + 3 * Math.PI / 180);
    t.controller.stop();
  });

  it.each([
    { direction: 'right', alphaDelta: 90, yaw: Math.PI / 2, xSign: 1 },
    { direction: 'left', alphaDelta: -90, yaw: -Math.PI / 2, xSign: -1 },
  ])('uses the calibrated Meta $direction turn by default and walks in that direction', async ({ alphaDelta, yaw, xSign }) => {
    const t = setup();
    await t.controller.start();
    t.host.orientation(200);
    for (let now = 0; now < 1500; now += 25) {
      t.at(now); t.host.orientation(200 + now / 1500 * alphaDelta); t.host.motion(0);
    }
    expect(t.controller.pose.x).toBe(0); expect(t.controller.pose.z).toBe(0);
    expect(t.controller.state.steps).toBe(0);
    t.walk(1500, 2000, 200 + alphaDelta);
    expect(t.controller.state.steps).toBe(4);
    expect(t.controller.pose.yaw).toBeCloseTo(yaw);
    expect(t.controller.pose.x).toBeCloseTo(xSign * 4 * stepDistance);
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
    t.controller.setYawSign(-1);
    t.host.orientation(180);
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

  it('fails closed for denied or missing orientation, and recovers from delayed sensor startup', async () => {
    const denied = setup();
    denied.host.DeviceOrientationEvent = { requestPermission: async () => 'denied' };
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
    expect(silent.controller.state.headingReady).toBe(false);
    silent.host.orientation(null);
    expect(silent.controller.status).toBe('unavailable');
    silent.host.orientation(0);
    expect(silent.controller.state).toMatchObject({ status: 'live', headingReady: true, motionReady: false });
    expect(silent.controller.pose).toEqual({ x: 0, z: 0, yaw: Math.PI });
    silent.controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps head steering available when walking permission or API is unavailable', async () => {
    for (const motion of [undefined, { requestPermission: async () => 'denied' },
      { requestPermission: async () => { throw new Error('motion unsupported'); } }]) {
      const t = setup();
      t.host.DeviceMotionEvent = motion;
      expect(await t.controller.start()).toBe(true);
      t.host.orientation(0);
      t.at(100); t.host.orientation(90);
      expect(t.controller.state).toMatchObject({ status: 'live', headingReady: true, motionReady: false });
      expect(t.controller.state.message).toContain(motion ? 'steps denied' : 'steps unavailable');
      expect(t.controller.pose.yaw).toBeCloseTo(Math.PI / 2);
      t.walk(200, 2000, 90);
      expect(t.controller.pose.x).toBe(0); expect(t.controller.pose.z).toBe(0);
      expect(t.controller.state.steps).toBe(0);
      t.controller.stop();
    }
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

  it('freezes walking on stale heading and recovers without replaying old footfalls', async () => {
    const t = setup(); await t.controller.start();
    t.host.orientation(0); t.host.motion(0);
    t.walk(25, 1100, null);
    const before = t.controller.pose;
    t.walk(1300, 2000, null);
    expect(t.controller.status).toBe('stale');
    expect(t.controller.pose).toEqual(before);
    expect(t.controller.recenter()).toBe(false);
    const stepsBefore = t.controller.state.steps;
    const callbackStates: string[] = [];
    t.onPose.mockImplementation(() => { callbackStates.push(t.controller.status); });
    t.host.orientation(90); t.host.motion(0.24);
    expect(t.controller.status).toBe('live');
    expect(callbackStates).toEqual(['live']);
    t.walk(3500, 500, 90);
    expect(t.controller.pose.x).toBe(before.x); expect(t.controller.pose.z).toBe(before.z);
    expect(t.controller.state.steps).toBe(stepsBefore);
    t.walk(4000, 500, 90);
    expect(t.controller.state.steps).toBe(stepsBefore + 2);
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

  it('keeps head steering live through accelerometer gaps and resumes only new rhythmic steps', async () => {
    const t = setup(); await t.controller.start();
    t.host.orientation(0); t.host.motion(0);
    for (let now = 100; now <= 1200; now += 100) {
      t.at(now); t.host.orientation(now / 100);
    }
    t.at(1300); vi.advanceTimersByTime(250);
    expect(t.controller.state).toMatchObject({ status: 'live', headingReady: true, motionReady: false });
    expect(t.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'live', motionReady: false }));
    for (let now = 1400; now <= 20_000; now += 100) { t.at(now); t.host.orientation(now / 100); }
    expect(t.controller.state).toMatchObject({ status: 'live', headingReady: true, motionReady: false });
    expect(t.controller.pose.x).toBe(0); expect(t.controller.pose.z).toBe(0);
    expect(t.controller.pose.yaw).not.toBe(Math.PI);
    t.walk(20_100, 500, 200);
    expect(t.controller.state.steps).toBe(0);
    t.walk(20_600, 500, 200);
    expect(t.controller.state.steps).toBe(2);
    expect(t.controller.state.motionReady).toBe(true);
    t.controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resumes a suspended grant without new permission requests or hidden steps', async () => {
    const t = setup();
    const orientation = vi.fn(async () => 'granted'), motion = vi.fn(async () => 'granted');
    t.host.DeviceOrientationEvent = { requestPermission: orientation };
    t.host.DeviceMotionEvent = { requestPermission: motion };
    expect(t.controller.resume()).toBe(false);
    await t.controller.start(); t.walk(0, 500);
    t.controller.suspend();
    t.visibility.hide(true);
    expect(t.controller.resume()).toBe(false);
    t.walk(500, 2000);
    expect(t.controller.pose).toEqual({ x: 0, z: 0, yaw: Math.PI });
    t.visibility.hide(false);
    expect(t.controller.status).toBe('paused');
    t.controller.syncPose({ x: 3, z: 4, yaw: Math.PI / 2 });
    expect(t.controller.resume()).toBe(true);
    t.walk(2500, 500);
    expect(t.controller.pose).toEqual({ x: 3, z: 4, yaw: Math.PI / 2 });
    expect(t.controller.state.steps).toBe(0);
    t.walk(3000, 500);
    expect(t.controller.state.steps).toBe(2);
    expect(t.controller.pose.x).toBeCloseTo(3 + 2 * stepDistance);
    expect(orientation).toHaveBeenCalledTimes(1); expect(motion).toHaveBeenCalledTimes(1);
    t.controller.stop();
    expect(t.controller.resume()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts granted head steering even if motion permission is stalled, then attaches a late motion grant', async () => {
    const t = setup();
    let grant!: (permission: string) => void;
    const request = vi.fn(() => new Promise<string>(resolve => { grant = resolve; }));
    t.host.DeviceMotionEvent = { requestPermission: request };
    expect(await t.controller.start()).toBe(true);
    t.host.orientation(0); t.at(100); t.host.orientation(90);
    expect(t.controller.state).toMatchObject({ status: 'live', headStatus: 'ready', stepStatus: 'permission' });
    expect(t.controller.pose.yaw).toBeCloseTo(Math.PI / 2);
    t.walk(200, 1000, 90);
    expect(t.controller.state.steps).toBe(0);
    grant('granted'); await vi.advanceTimersByTimeAsync(0);
    t.walk(1200, 1000, 90);
    expect(t.controller.state).toMatchObject({ status: 'live', motionReady: true, steps: 2 });
    expect(t.controller.state.message).toBe('Head live · steps ready · 2 detected');
    expect(request).toHaveBeenCalledTimes(1);
    t.controller.stop();
  });

  it('settles a stalled head start after eight seconds and accepts its eventual authorized response', async () => {
    const t = setup();
    let grant!: (permission: string) => void;
    const request = vi.fn(() => new Promise<string>(resolve => { grant = resolve; }));
    t.host.DeviceOrientationEvent = { requestPermission: request };
    const starting = t.controller.start();
    t.at(8000); await vi.advanceTimersByTimeAsync(8000);
    expect(await starting).toBe(false);
    expect(t.controller.state).toMatchObject({ status: 'unavailable', headStatus: 'permission' });
    expect(t.controller.state.readiness).toContain('Head permission');
    expect(t.controller.resume()).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    t.walk(8000, 500);
    expect(t.controller.state.steps).toBe(0);
    grant('granted'); await vi.advanceTimersByTimeAsync(0);
    t.walk(8500, 500);
    expect(t.controller.state).toMatchObject({ status: 'live', steps: 0 });
    t.walk(9000, 500);
    expect(t.controller.state.steps).toBe(2);
    t.controller.stop();
  });

  it('preserves grants returned while a camera screen is foreground and resumes only on caller request', async () => {
    const t = setup();
    let grantHead!: (permission: string) => void, grantMotion!: (permission: string) => void;
    const head = vi.fn(() => new Promise<string>(resolve => { grantHead = resolve; }));
    const motion = vi.fn(() => new Promise<string>(resolve => { grantMotion = resolve; }));
    t.host.DeviceOrientationEvent = { requestPermission: head };
    t.host.DeviceMotionEvent = { requestPermission: motion };
    const starting = t.controller.start();
    t.visibility.hide(true); t.controller.suspend(); t.controller.suspend();
    grantHead('granted'); grantMotion('granted');
    expect(await starting).toBe(false);
    t.walk(0, 2000);
    expect(t.controller.pose).toEqual({ x: 0, z: 0, yaw: Math.PI });
    expect(t.controller.state).toMatchObject({ status: 'paused', headingReady: false, motionReady: false });
    expect(t.controller.resume()).toBe(false);
    t.visibility.hide(false);
    expect(t.controller.status).toBe('paused');
    expect(t.controller.resume()).toBe(true);
    t.walk(2000, 500);
    expect(t.controller.state.steps).toBe(0);
    t.walk(2500, 500);
    expect(t.controller.state.steps).toBe(2);
    expect(head).toHaveBeenCalledTimes(1); expect(motion).toHaveBeenCalledTimes(1);
    t.controller.stop();
    t.visibility.hide(true); t.visibility.hide(false);
    expect(t.controller.resume()).toBe(false);
    const stopped = t.controller.pose;
    t.walk(3000, 2000);
    expect(t.controller.pose).toEqual(stopped);
  });

  it('can request foreground recovery before the original permission response arrives', async () => {
    const t = setup();
    let grant!: (permission: string) => void;
    const request = vi.fn(() => new Promise<string>(resolve => { grant = resolve; }));
    t.host.DeviceOrientationEvent = { requestPermission: request };
    const starting = t.controller.start();
    t.visibility.hide(true); t.controller.suspend();
    t.visibility.hide(false);
    expect(t.controller.resume()).toBe(true);
    expect(t.controller.status).toBe('requesting');
    grant('granted');
    expect(await starting).toBe(true);
    t.walk(0, 500);
    expect(t.controller.resume()).toBe(true);
    t.walk(500, 500);
    expect(t.controller.state.steps, 'idempotent foreground recovery does not reset a live step rhythm').toBe(2);
    expect(request).toHaveBeenCalledTimes(1);
    t.controller.stop();
  });

  it('an explicit Pause after a permission timeout blocks the old late grant', async () => {
    const t = setup();
    let grant!: (permission: string) => void;
    t.host.DeviceOrientationEvent = { requestPermission: () => new Promise(resolve => { grant = resolve; }) };
    const starting = t.controller.start();
    t.at(8000); await vi.advanceTimersByTimeAsync(8000);
    expect(await starting).toBe(false);
    t.controller.stop();
    grant('granted'); await vi.advanceTimersByTimeAsync(0);
    expect(t.controller.resume()).toBe(false);
    t.walk(8000, 2000);
    expect(t.controller.status).toBe('off');
    expect(t.onPose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('supports absolute-only orientation events without mixing different sensor reference frames', async () => {
    const t = setup(); await t.controller.start();
    t.host.orientation(220, 'deviceorientationabsolute');
    t.at(100); t.host.orientation(230, 'deviceorientationabsolute');
    const before = t.controller.pose;
    expect(before.yaw).toBeCloseTo(Math.PI - 10 * Math.PI / 180);
    t.host.orientation(20);
    expect(t.controller.pose).toEqual(before);
    t.at(1400); t.host.orientation(80);
    expect(t.controller.pose, 'fallback switches origins without rotating the pet').toEqual(before);
    t.at(1500); t.host.orientation(90);
    expect(t.controller.pose.yaw).toBeCloseTo(Math.PI - 20 * Math.PI / 180);
    expect(t.controller.pose.x).toBe(0); expect(t.controller.pose.z).toBe(0);
    expect(t.controller.state.steps).toBe(0);
    t.controller.stop();
  });

  it('reports incomplete motion data rather than inventing steps from gravity or head rotation', async () => {
    const t = setup(); await t.controller.start();
    for (let now = 0; now < 2000; now += 100) {
      t.at(now); t.host.orientation(now / 100);
      t.host.dispatchEvent(Object.assign(new Event('devicemotion'), {
        acceleration: null, accelerationIncludingGravity: { x: 0, y: 0, z: -9.80665 },
      }));
    }
    expect(t.controller.state).toMatchObject({ status: 'live', headStatus: 'ready', stepStatus: 'incomplete', motionReady: false, steps: 0 });
    expect(t.controller.state.message).toBe('Head live · steps no acceleration · 0 detected');
    expect(t.controller.pose.x).toBe(0); expect(t.controller.pose.z).toBe(0);
    t.walk(2000, 1000, 19);
    expect(t.controller.state).toMatchObject({ stepStatus: 'ready', steps: 2 });
    t.controller.stop();
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
