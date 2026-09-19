import { normalizeDegrees, type Orientation } from '../anchor/PseudoWorldAnchor';

const clampPitch = (pitch: number): number => Math.max(-80, Math.min(80, pitch));

/** Local input only. No assumptions about the axes of a glasses IMU. */
export class SimulatedOrientation {
  private orientation: Orientation = { yaw: 0, pitch: 0 };
  private readonly keys = new Set<string>();

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.clearKeys);
    document.addEventListener('visibilitychange', this.clearKeys);
  }

  get current(): Orientation {
    return { ...this.orientation };
  }

  set(value: Orientation): void {
    if (!Number.isFinite(value.yaw) || !Number.isFinite(value.pitch)) return;
    this.orientation = { yaw: normalizeDegrees(value.yaw), pitch: clampPitch(value.pitch) };
  }

  update(deltaSeconds: number): void {
    const horizontal = Number(this.keys.has('arrowright') || this.keys.has('d'))
      - Number(this.keys.has('arrowleft') || this.keys.has('a'));
    const vertical = Number(this.keys.has('arrowup') || this.keys.has('w'))
      - Number(this.keys.has('arrowdown') || this.keys.has('s'));
    this.set({
      yaw: this.orientation.yaw + horizontal * 45 * deltaSeconds,
      pitch: this.orientation.pitch + vertical * 30 * deltaSeconds,
    });
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isEditingControl(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(key)) {
      event.preventDefault();
      this.keys.add(key);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private clearKeys = (): void => { this.keys.clear(); };

  stopTurning(): void { this.clearKeys(); }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.clearKeys);
    document.removeEventListener('visibilitychange', this.clearKeys);
    this.clearKeys();
  }
}

export function isEditingControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      || target.isContentEditable);
}
