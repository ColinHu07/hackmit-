/** Device-local happiness. Quest IDs prevent snapshot/reconnect reward duplication. */
export interface MoodState { value: number; updatedAt: number; rewarded: string[] }
export function readMood(raw: string | null, now = Date.now()): MoodState {
  try {
    const state = JSON.parse(raw ?? 'null');
    if (state && Number.isFinite(state.value) && state.value >= 0 && state.value <= 100
      && Number.isFinite(state.updatedAt) && Array.isArray(state.rewarded)
      && state.rewarded.every((id: unknown) => typeof id === 'string')) return state;
  } catch { /* Start fresh if local storage is unavailable or damaged. */ }
  return { value: 70, updatedAt: now, rewarded: [] };
}
export function moodValue(state: MoodState, now = Date.now()): number {
  return Math.max(20, state.value - Math.max(0, now - state.updatedAt) / (30 * 60_000 * 1.5));
}
export function rewardMood(state: MoodState, id: string, now = Date.now()): MoodState {
  if (state.rewarded.includes(id)) return state;
  return { value: Math.min(100, moodValue(state, now) + 12), updatedAt: Math.max(now, state.updatedAt), rewarded: [...state.rewarded, id] };
}
