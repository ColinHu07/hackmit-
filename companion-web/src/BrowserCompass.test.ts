import { afterEach, expect, it, vi } from 'vitest';
import { browserBearing, BrowserCompass } from './BrowserCompass';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('reads real compass bearings, compensates screen rotation, and rejects relative or inaccurate headings', () => {
  expect(browserBearing({ alpha: 40, absolute: false })).toBeNull();
  expect(browserBearing({ alpha: null, absolute: true })).toBeNull();
  expect(browserBearing({ alpha: 270, absolute: true })).toBe(90);
  expect(browserBearing({ alpha: 0, absolute: true }, 90)).toBe(90);
  expect(browserBearing({ alpha: null, absolute: false, webkitCompassHeading: 355 }, 90)).toBe(85);
  expect(browserBearing({ alpha: null, absolute: false, webkitCompassHeading: 10, webkitCompassAccuracy: 50 })).toBeNull();
  expect(browserBearing({ alpha: null, absolute: false, webkitCompassHeading: -1 })).toBeNull();
  expect(browserBearing({ alpha: NaN, absolute: true })).toBeNull();
});
it('requests permission on start, publishes only foreground headings, and cleans up', async () => {
  vi.useFakeTimers();
  const target = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const permission = vi.fn().mockResolvedValue('granted');
  vi.stubGlobal('window', Object.assign(target, { isSecureContext: true, DeviceOrientationEvent: { requestPermission: permission }, screen: { orientation: { angle: 0 } } }));
  vi.stubGlobal('document', doc);
  const heading = vi.fn(), status = vi.fn();
  const compass = new BrowserCompass(heading, status);
  const emit = () => target.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 270, absolute: true }));
  expect(permission).not.toHaveBeenCalled();
  await compass.start();
  expect(permission).toHaveBeenCalledWith(true);
  emit(); expect(heading).toHaveBeenLastCalledWith(90);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  emit(); expect(heading).toHaveBeenCalledTimes(1);
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
  emit(); expect(heading).toHaveBeenCalledTimes(2);
  compass.stop(); emit(); expect(heading).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it('does not attach after denial or a permission request cancelled by stop', async () => {
  const add = vi.fn();
  const permission = vi.fn().mockResolvedValue('denied');
  vi.stubGlobal('window', { isSecureContext: true, DeviceOrientationEvent: { requestPermission: permission }, addEventListener: add, removeEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: add, removeEventListener: vi.fn() });
  const compass = new BrowserCompass(vi.fn(), vi.fn());
  await compass.start(); expect(add).not.toHaveBeenCalled();
  permission.mockResolvedValue('granted');
  const pending = compass.start(); compass.stop(); await pending;
  expect(add).not.toHaveBeenCalled();
});
