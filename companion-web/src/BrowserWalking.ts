import { browserVerticalG } from './StepDetector';

/** Motion access is requested only from the user's Enable walking tap. */
export class BrowserWalking {
  private generation = 0;
  private timeout?: ReturnType<typeof setTimeout>;
  constructor(private readonly sample: (verticalG: number, timestamp: number) => void, private readonly unavailable: (message: string) => void) {}
  async start(): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    const api = window.DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> };
    if (!window.isSecureContext || !api) { this.unavailable('Walking sensors unavailable · tap the ground to move.'); return false; }
    try {
      if (api.requestPermission && await api.requestPermission() !== 'granted') {
        this.unavailable('Allow motion to walk with your pet. You can still tap to move.'); return false;
      }
      if (generation !== this.generation) return false;
      window.addEventListener('devicemotion', this.receive);
      this.timeout = setTimeout(() => { this.stop(); this.unavailable('No walking sensor data · tap the ground to move.'); }, 8000);
      return true;
    } catch { this.unavailable('Walking sensors unavailable · tap the ground to move.'); return false; }
  }
  stop(): void {
    this.generation++;
    clearTimeout(this.timeout);
    window.removeEventListener('devicemotion', this.receive);
  }
  private receive = (event: DeviceMotionEvent): void => {
    if (document.hidden) return;
    const vertical = browserVerticalG(event.acceleration, event.accelerationIncludingGravity);
    if (vertical === null) return;
    clearTimeout(this.timeout);
    this.sample(vertical, event.timeStamp);
  };
}
