import { afterEach, expect, it, vi } from 'vitest';
import { BrowserWalking } from './BrowserWalking';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(permission = 'granted') {
  vi.useFakeTimers();
  const events = new EventTarget();
  const request = vi.fn().mockResolvedValue(permission);
  const doc = { hidden: false };
  vi.stubGlobal('window', Object.assign(events, { isSecureContext: true, DeviceMotionEvent: { requestPermission: request } }));
  vi.stubGlobal('document', doc);
  const sample = vi.fn(), unavailable = vi.fn();
  const walking = new BrowserWalking(sample, unavailable);
  const emit = () => events.dispatchEvent(Object.assign(new Event('devicemotion'), { acceleration: { x: 0, y: 0, z: 1.96133 }, accelerationIncludingGravity: { x: 0, y: 0, z: -7.84532 } }));
  return { request, doc, sample, unavailable, walking, emit };
}
it('requests motion only when started, pauses while hidden, and stops cleanly', async () => {
  const t = setup();
  expect(t.request).not.toHaveBeenCalled();
  expect(await t.walking.start()).toBe(true);
  t.emit(); expect(t.sample).toHaveBeenCalledTimes(1);
  t.doc.hidden = true; t.emit(); expect(t.sample).toHaveBeenCalledTimes(1);
  t.doc.hidden = false; t.emit(); expect(t.sample).toHaveBeenCalledTimes(2);
  t.walking.stop(); t.emit(); expect(t.sample).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it('keeps manual movement available after denial or absent sensor data', async () => {
  const denied = setup('denied');
  expect(await denied.walking.start()).toBe(false);
  denied.emit(); expect(denied.sample).not.toHaveBeenCalled();
  expect(denied.unavailable).toHaveBeenCalled();
  const silent = setup();
  await silent.walking.start(); vi.advanceTimersByTime(8000);
  expect(silent.unavailable).toHaveBeenCalledWith(expect.stringContaining('No walking sensor data'));
  silent.emit(); expect(silent.sample).not.toHaveBeenCalled();
});
