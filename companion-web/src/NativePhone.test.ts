import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeLocation, nativeFix } from './NativePhone';
import type { NativeEvent } from './NativePhone';
const postMessage = vi.fn();
let events: EventTarget;
const emit = (detail: NativeEvent) => events.dispatchEvent(new CustomEvent('bondimals-native', { detail }));
beforeEach(() => {
  events = new EventTarget();
  vi.stubGlobal('window', Object.assign(events, { bondimalsNative: { version: 1 }, webkit: { messageHandlers: { bondimals: { postMessage } } } }));
  vi.useFakeTimers(); vi.setSystemTime(50_000); postMessage.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const callbacks = () => ({ fix: vi.fn(), status: vi.fn(), unavailable: vi.fn(), paused: vi.fn() });
const location: NativeEvent = { type: 'location', latitude: 42, longitude: -71, accuracy: 5, timestamp: 50_000 };
describe('native location bridge', () => {
  it('starts only when requested and stops receiving fixes on stop', () => {
    const c = callbacks(), tracker = new NativeLocation(c);
    expect(postMessage).not.toHaveBeenCalled(); tracker.start();
    expect(postMessage).toHaveBeenLastCalledWith({ command: 'startLocation', purpose: 'discovery' });
    emit(location); expect(c.fix).toHaveBeenCalledTimes(1);
    tracker.stop(); emit(location); expect(c.fix).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenLastCalledWith({ command: 'stopLocation', purpose: 'discovery' });
  });
  it('cleans up on background and requires explicit start to resume', () => {
    const c = callbacks(), tracker = new NativeLocation(c); tracker.start();
    emit({ type: 'paused' }); emit(location);
    expect(c.paused).toHaveBeenCalledOnce(); expect(c.fix).not.toHaveBeenCalled();
    tracker.start(); emit(location); expect(c.fix).toHaveBeenCalledOnce(); tracker.stop();
  });
  it('stops discovery after native permission denial', () => {
    const c = callbacks(), tracker = new NativeLocation(c); tracker.start();
    emit({ type: 'unavailable', message: 'Location is off' }); emit(location);
    expect(c.unavailable).toHaveBeenCalledWith('Location is off'); expect(c.fix).not.toHaveBeenCalled();
  });
  it('rejects invalid coordinates, old/future fixes, and negative accuracy', () => {
    for (const change of [{latitude: 91}, {longitude: Infinity}, {accuracy:-1}, {timestamp: 1}, {timestamp: 100_000}]) {
      expect(nativeFix({ ...location, ...change })).toBeNull();
    }
    expect(nativeFix(location)).toMatchObject({ latitude: 42, accuracy: 5 });
  });
});
