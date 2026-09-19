import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationDiscovery } from './LocationDiscovery';

interface Request { success: PositionCallback; error: PositionErrorCallback | null | undefined; options: PositionOptions | undefined }
let watches: Request[];
let refreshes: Request[];
let visibility: string;
let visibilityChange: (() => void) | null;
let geolocation: {
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
  getCurrentPosition: ReturnType<typeof vi.fn>;
};

function position(timestamp = Date.now(), latitude = 42, accuracy = 4): GeolocationPosition {
  return {
    timestamp, coords: { latitude, longitude: -71, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  } as GeolocationPosition;
}
function error(code: number): GeolocationPositionError {
  return { code, message: 'Test error', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
}
function setup() {
  const callbacks = { fix: vi.fn(), status: vi.fn(), unavailable: vi.fn(), paused: vi.fn() };
  const discovery = new LocationDiscovery(callbacks);
  return { discovery, callbacks };
}
function hidden(): void { visibility = 'hidden'; visibilityChange?.(); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T15:00:00Z'));
  watches = [];
  refreshes = [];
  visibility = 'visible';
  visibilityChange = null;
  geolocation = {
    watchPosition: vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null, options?: PositionOptions) => {
      watches.push({ success, error: failure, options });
      return watches.length;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null, options?: PositionOptions) => {
      refreshes.push({ success, error: failure, options });
    }),
  };
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', { geolocation });
  vi.stubGlobal('document', {
    get visibilityState() { return visibility; },
    addEventListener: vi.fn((_name: string, listener: () => void) => { visibilityChange = listener; }),
    removeEventListener: vi.fn((_name: string, listener: () => void) => {
      if (visibilityChange === listener) visibilityChange = null;
    }),
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('LocationDiscovery foreground permission lifecycle', () => {
  it('does not request location before explicit start and requests fresh high accuracy fixes', () => {
    const { discovery, callbacks } = setup();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    discovery.start();
    expect(watches[0]?.options).toEqual({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
    watches[0]!.success(position());
    expect(callbacks.fix).toHaveBeenCalledWith({ latitude: 42, longitude: -71, accuracy: 4, timestamp: Date.now() });
  });

  it('refreshes stationary location every 10 seconds without overlapping requests', () => {
    const { discovery, callbacks } = setup();
    discovery.start();
    watches[0]!.success(position());
    vi.advanceTimersByTime(10_000);
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.options).toEqual({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
    vi.advanceTimersByTime(10_000);
    expect(refreshes).toHaveLength(1);
    refreshes[0]!.success(position());
    expect(callbacks.fix).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(refreshes).toHaveLength(2);
  });

  it('stops all foreground tracking on background and never resumes automatically', () => {
    const { discovery, callbacks } = setup();
    discovery.start();
    vi.advanceTimersByTime(10_000);
    hidden();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(1);
    expect(callbacks.paused).toHaveBeenCalledTimes(1);
    expect(callbacks.status).toHaveBeenLastCalledWith('Location paused. Tap Resume nearby.');
    watches[0]!.success(position());
    refreshes[0]!.success(position());
    visibility = 'visible';
    visibilityChange?.();
    vi.advanceTimersByTime(60_000);
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(refreshes).toHaveLength(1);
    expect(callbacks.fix).not.toHaveBeenCalled();
    discovery.start();
    watches[1]!.success(position());
    expect(callbacks.fix).toHaveBeenCalledTimes(1);
  });

  it('checks visibility again before delivering a location even if no visibility event arrived', () => {
    const { discovery, callbacks } = setup();
    discovery.start();
    visibility = 'hidden';
    watches[0]!.success(position());
    expect(callbacks.fix).not.toHaveBeenCalled();
    expect(callbacks.paused).toHaveBeenCalledTimes(1);
    expect(geolocation.clearWatch).toHaveBeenCalledWith(1);
  });

  it('ignores callbacks from stopped or superseded tracking sessions', () => {
    const { discovery, callbacks } = setup();
    discovery.start();
    vi.advanceTimersByTime(10_000);
    discovery.stop();
    discovery.start();
    watches[0]!.success(position());
    watches[0]!.error?.(error(1));
    refreshes[0]!.success(position());
    refreshes[0]!.error?.(error(1));
    expect(callbacks.fix).not.toHaveBeenCalled();
    expect(callbacks.unavailable).not.toHaveBeenCalled();
    watches[1]!.success(position());
    expect(callbacks.fix).toHaveBeenCalledTimes(1);
    discovery.stop();
    watches[1]!.success(position());
    vi.advanceTimersByTime(30_000);
    expect(callbacks.fix).toHaveBeenCalledTimes(1);
    expect(refreshes).toHaveLength(1);
  });

  it('stops and explains permission denial instead of repeatedly requesting access', () => {
    const { discovery, callbacks } = setup();
    discovery.start();
    watches[0]!.error?.(error(1));
    expect(callbacks.unavailable).toHaveBeenCalledWith(expect.stringContaining('browser settings'));
    expect(geolocation.clearWatch).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(60_000);
    expect(refreshes).toHaveLength(0);
    watches[0]!.success(position());
    expect(callbacks.fix).not.toHaveBeenCalled();
  });

  it.each([2, 3])('allows transient error %s to recover on a fresh estimate', code => {
    const { discovery, callbacks } = setup();
    discovery.start();
    watches[0]!.error?.(error(code));
    expect(callbacks.unavailable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    refreshes[0]!.success(position());
    expect(callbacks.fix).toHaveBeenCalledTimes(1);
  });

  it('drops invalid, stale, future, duplicate, and out-of-order estimates', () => {
    const { discovery, callbacks } = setup();
    discovery.start();
    const watch = watches[0]!;
    for (const invalid of [
      position(Date.now(), NaN), position(Date.now(), 91), position(Date.now(), 42, -1),
      position(Date.now() - 20_001), position(Date.now() + 5001), position(NaN),
    ]) watch.success(invalid);
    expect(callbacks.fix).not.toHaveBeenCalled();
    watch.success(position());
    watch.success(position());
    watch.success(position(Date.now() - 1000));
    expect(callbacks.fix).toHaveBeenCalledTimes(1);
  });

  it.each(['insecure', 'unsupported', 'background'] as const)('does not start tracking when %s', situation => {
    const { discovery, callbacks } = setup();
    if (situation === 'insecure') vi.stubGlobal('window', { isSecureContext: false });
    if (situation === 'unsupported') vi.stubGlobal('navigator', {});
    if (situation === 'background') visibility = 'hidden';
    discovery.start();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    if (situation === 'background') expect(callbacks.paused).toHaveBeenCalled();
    else expect(callbacks.unavailable).toHaveBeenCalled();
  });

  it('cleans up a synchronously denied watch without leaving a refresh timer', () => {
    geolocation.watchPosition.mockImplementation((_success: PositionCallback, failure: PositionErrorCallback) => {
      failure(error(1));
      return 123;
    });
    const { discovery, callbacks } = setup();
    discovery.start();
    expect(callbacks.unavailable).toHaveBeenCalledTimes(1);
    expect(geolocation.clearWatch).toHaveBeenCalledWith(123);
    vi.advanceTimersByTime(60_000);
    expect(refreshes).toHaveLength(0);
  });
});
