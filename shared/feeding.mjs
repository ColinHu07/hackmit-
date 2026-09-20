/** One timeline for the visible bites and their server-owned happiness reward. */
export const TREAT_COOLDOWN_MS = 3_600_000;
export const HAPPINESS_DECAY_MS = 60_000;
export const TREAT_DECAY_MULTIPLIER = 1.5;
export const BERRY_HAPPINESS = 3;
export const FEED_DURATION_MS = 6200;
export const FEED_BITES = Object.freeze([
  Object.freeze({ start: .45, end: .47, share: .28 }),
  Object.freeze({ start: .51, end: .53, share: .32 }),
  Object.freeze({ start: .58, end: .61, share: .4 }),
]);
export function eatenFraction(progress) {
  if (!Number.isFinite(progress)) return 0;
  return FEED_BITES.reduce((total, bite) => {
    const t = Math.max(0, Math.min(1, (progress - bite.start) / (bite.end - bite.start)));
    return total + bite.share * t * t * t * (10 + t * (-15 + t * 6));
  }, 0);
}
