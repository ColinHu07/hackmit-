import type { LocationFix } from './LocationDiscovery';

interface Callbacks {
  fix: (fix: LocationFix) => void;
  status: (message: string) => void;
  unavailable: (message: string) => void;
  paused: () => void;
}

/** Explicit Vite-development fixture: two real clients, fictional sensor fixes.
 * This class never requests device location. Production cannot select it.
 * Background fixture tabs represent separate foreground phones in browser QA.
 */
export class DevelopmentLocation {
  private timer: ReturnType<typeof setInterval> | undefined;
  private distant = false;
  private active = false;
  constructor(private readonly callbacks: Callbacks, private readonly second: boolean) {
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    const label = document.createElement('span');
    label.textContent = 'SIMULATED LOCATION · Development demo. No device location used.';
    const button = document.createElement('button');
    button.textContent = 'Simulate walking away';
    button.addEventListener('click', () => {
      this.distant = !this.distant;
      button.textContent = this.distant ? 'Simulate coming back' : 'Simulate walking away';
      this.emit();
    });
    banner.append(label, button);
    document.getElementById('app')!.prepend(banner);
  }
  start(): void {
    this.stop();
    this.active = true;
    this.callbacks.status('Development demo: using a fictional location.');
    this.emit();
    this.timer = setInterval(() => this.emit(), 5000);
  }
  stop(): void { this.active = false; clearInterval(this.timer); }
  private emit(): void {
    if (!this.active) return;
    this.callbacks.fix({
      latitude: 0,
      longitude: (this.second ? 0.000045 : 0) + (this.distant ? (this.second ? 0.0003 : -0.0003) : 0),
      accuracy: 2,
      timestamp: Date.now(),
    });
  }
}
