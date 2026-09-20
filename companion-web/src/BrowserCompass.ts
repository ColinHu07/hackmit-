interface BearingEvent {
  alpha: number | null;
  absolute: boolean;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

/** Safari supplies a compass heading; relative alpha must never masquerade as north. */
export function browserBearing(event: BearingEvent, screenAngle = 0): number | null {
  let degrees: number;
  if (typeof event.webkitCompassHeading === 'number') {
    if (event.webkitCompassHeading < 0 || (event.webkitCompassAccuracy !== undefined
      && (!Number.isFinite(event.webkitCompassAccuracy) || event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 25))) return null;
    degrees = event.webkitCompassHeading;
  } else if (event.absolute && typeof event.alpha === 'number') {
    degrees = 360 - event.alpha;
  } else return null;
  if (!Number.isFinite(degrees) || !Number.isFinite(screenAngle)) return null;
  return ((degrees + screenAngle) % 360 + 360) % 360;
}

export class BrowserCompass {
  private generation = 0;
  private enabled = false;
  private timeout?: ReturnType<typeof setTimeout>;
  private lastPublished = -Infinity;
  constructor(private readonly heading: (degrees: number) => void, private readonly status: (message: string) => void) {}

  /** Call directly from a tap: iOS requires a gesture for the motion prompt. */
  async start(): Promise<void> {
    this.stop();
    const generation = this.generation;
    const api = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: (absolute?: boolean) => Promise<string>;
    };
    if (!window.isSecureContext || !api) { this.status('No phone compass here · tap the ground to move.'); return; }
    try {
      if (api.requestPermission && await api.requestPermission(true) !== 'granted') {
        this.status('Compass permission is off · tap the ground to move.'); return;
      }
      if (generation !== this.generation) return;
      this.enabled = true;
      document.addEventListener('visibilitychange', this.visibility);
      this.listen();
    } catch { if (generation === this.generation) this.status('Compass unavailable · tap the ground to move.'); }
  }

  stop(): void {
    this.generation++;
    this.enabled = false;
    this.detach();
    document.removeEventListener('visibilitychange', this.visibility);
  }

  private listen(): void {
    if (document.hidden) return;
    this.status('Reading your phone direction…');
    this.lastPublished = -Infinity;
    window.addEventListener('deviceorientation', this.receive);
    window.addEventListener('deviceorientationabsolute', this.receive as EventListener);
    this.timeout = setTimeout(() => this.status('No compass reading yet · tap the ground to move.'), 8000);
  }
  private detach(): void {
    clearTimeout(this.timeout);
    window.removeEventListener('deviceorientation', this.receive);
    window.removeEventListener('deviceorientationabsolute', this.receive as EventListener);
  }
  private visibility = (): void => {
    this.detach();
    if (this.enabled && !document.hidden) this.listen();
  };
  private receive = (event: DeviceOrientationEvent): void => {
    if (!this.enabled || document.hidden) return;
    const angle = window.screen.orientation?.angle ?? window.orientation ?? 0;
    const degrees = browserBearing(event, Number(angle));
    if (degrees === null || performance.now() - this.lastPublished < 100) return;
    clearTimeout(this.timeout);
    this.lastPublished = performance.now();
    this.heading(degrees);
    this.status(`Facing ${Math.round(degrees)}° · view follows you`);
  };
}
