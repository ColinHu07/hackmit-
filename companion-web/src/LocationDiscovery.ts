import { NEARBY_LOCATION_FRESH_MS } from '../../shared/nearby-protocol';

export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

interface Callbacks {
  fix: (fix: LocationFix) => void;
  status: (message: string) => void;
  unavailable: (message: string) => void;
  paused: () => void;
}

const OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 };

/** Location is held only in memory, during an explicitly started foreground session. */
export class LocationDiscovery {
  private generation = 0;
  private active = false;
  private watch: number | undefined;
  private refresh: ReturnType<typeof setInterval> | undefined;
  private geolocation: Geolocation | null = null;
  private lastTimestamp = -Infinity;

  constructor(private readonly callbacks: Callbacks) {}

  start(): void {
    this.stop();
    if (!window.isSecureContext) {
      this.callbacks.unavailable('Location needs HTTPS on your phone. Open the secure app address.');
      return;
    }
    if (!navigator.geolocation) {
      this.callbacks.unavailable('This browser cannot share location. Try Safari or Chrome on your phone.');
      return;
    }
    if (document.visibilityState === 'hidden') {
      this.callbacks.paused();
      this.callbacks.status('Location paused. Tap Resume nearby.');
      return;
    }

    const generation = this.generation;
    const current = () => this.active && generation === this.generation;
    const geolocation = navigator.geolocation;
    this.geolocation = geolocation;
    this.active = true;
    this.callbacks.status('Finding your location…');
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    const receive = (position: GeolocationPosition) => {
      if (!current()) return;
      if (document.visibilityState === 'hidden') { this.onVisibilityChange(); return; }
      const fix = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      };
      if (!Object.values(fix).every(Number.isFinite)
        || Math.abs(fix.latitude) > 90 || Math.abs(fix.longitude) > 180 || fix.accuracy < 0) {
        this.callbacks.status('Waiting for a usable location estimate…');
        return;
      }
      const age = Date.now() - fix.timestamp;
      if (age > NEARBY_LOCATION_FRESH_MS || age < -5_000) {
        this.callbacks.status('That location is out of date. Waiting for a fresh estimate…');
        return;
      }
      if (fix.timestamp <= this.lastTimestamp) return;
      this.lastTimestamp = fix.timestamp;
      this.callbacks.fix(fix);
    };
    const failed = (error: GeolocationPositionError) => {
      if (!current()) return;
      if (error.code === 1) {
        this.stop();
        this.callbacks.unavailable('Location access is off. Allow location for this site in your browser settings, then try again.');
      } else {
        this.callbacks.status(error.code === 3
          ? 'Location is taking a moment. Keep the app open while we try again…'
          : 'Your location is unavailable right now. Waiting for a fresh estimate…');
      }
    };

    try {
      const watch = geolocation.watchPosition(receive, failed, OPTIONS);
      // A provider can deliver a callback synchronously, including denial.
      if (!current()) { geolocation.clearWatch(watch); return; }
      this.watch = watch;
      let refreshPending = false;
      this.refresh = setInterval(() => {
        if (!current() || refreshPending) return;
        if (document.visibilityState === 'hidden') { this.onVisibilityChange(); return; }
        refreshPending = true;
        try {
          geolocation.getCurrentPosition(
            position => { refreshPending = false; receive(position); },
            error => { refreshPending = false; failed(error); },
            OPTIONS,
          );
        } catch {
          refreshPending = false;
          if (current()) this.callbacks.status('Could not refresh your location. Waiting for the next estimate…');
        }
      }, 10_000);
    } catch {
      this.stop();
      this.callbacks.unavailable('Could not start location sharing. Check this site’s location permission and try again.');
    }
  }

  private readonly onVisibilityChange = (): void => {
    if (!this.active || document.visibilityState !== 'hidden') return;
    this.stop();
    this.callbacks.paused();
    this.callbacks.status('Location paused. Tap Resume nearby.');
  };

  stop(): void {
    this.active = false;
    this.generation += 1;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    clearInterval(this.refresh);
    this.refresh = undefined;
    if (this.watch !== undefined) this.geolocation?.clearWatch(this.watch);
    this.watch = undefined;
    this.geolocation = null;
    this.lastTimestamp = -Infinity;
  }
}
