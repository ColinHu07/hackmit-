import { TREAT_COOLDOWN_MS } from '../../shared/feeding.mjs';

export function cooldownState(remainingMs: number, elapsedMs = 0) {
  const remaining = Number.isFinite(remainingMs) ? Math.max(0, Math.min(TREAT_COOLDOWN_MS, remainingMs - Math.max(0, elapsedMs))) : 0;
  return { remaining, fraction: remaining / TREAT_COOLDOWN_MS, seconds: Math.ceil(remaining / 1000) };
}

export function formatTreatTime(remainingMs: number): string {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  if (seconds >= 3600) return '1h';
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** Render from the server's remaining time, then animate locally between snapshots. */
export class TreatCooldown {
  private deadline = 0;
  private frame = 0;
  private label = '';
  private ring: SVGCircleElement;
  private count: HTMLElement;
  constructor(private readonly root: HTMLElement) {
    this.ring = root.querySelector<SVGCircleElement>('.treat-timer-ring')!;
    this.count = root.querySelector<HTMLElement>('.treat-timer-count')!;
  }
  update(remainingMs: number): void {
    this.deadline = performance.now() + cooldownState(remainingMs).remaining;
    if (!this.frame) this.draw();
  }
  private draw = (): void => {
    this.frame = 0;
    const state = cooldownState(this.deadline - performance.now());
    this.root.hidden = state.remaining <= 0;
    this.ring.style.strokeDashoffset = String(100 * (1 - state.fraction));
    const label = `Next treat ready in ${formatTreatTime(state.remaining)}`;
    if (label !== this.label) {
      this.root.setAttribute('aria-label', label);
      this.count.textContent = formatTreatTime(state.remaining);
      this.label = label;
    }
    if (state.remaining > 0) this.frame = requestAnimationFrame(this.draw);
  };
}
