export const TREAT_COOLDOWN_MS: number;
export const FEED_DURATION_MS: number;
export const FEED_BITES: readonly { readonly start: number; readonly end: number; readonly share: number }[];
export function eatenFraction(progress: number): number;
