import { describe, expect, it } from 'vitest';
import { moodValue, readMood, rewardMood } from './PetMood';
describe('pet happiness', () => {
  it('decays across app restarts but stays above its gentle floor', () => {
    const state = readMood(null, 0);
    expect(moodValue(readMood(JSON.stringify(state)), 3_600_000)).toBeCloseTo(70 - 4 / 3);
    expect(moodValue(state, 100 * 3_600_000)).toBe(20);
  });
  it('takes 1.5 times the original 30 minutes to lose one point', () => {
    expect(moodValue(readMood(null, 0), 45 * 60_000)).toBe(69);
  });
  it('rewards a completed quest once, including after reconnect/reload', () => {
    const first = rewardMood(readMood(null, 0), 'player:met', 3_600_000);
    expect(first.value).toBeCloseTo(82 - 4 / 3);
    const restored = readMood(JSON.stringify(first));
    expect(rewardMood(restored, 'player:met', 7_200_000)).toBe(restored);
    expect(rewardMood(restored, 'player:dap', 7_200_000).value).toBeCloseTo(94 - 8 / 3);
  });
  it('caps rewards and handles clock rollback without boosting happiness', () => {
    let state = readMood(null, 100);
    for (let i = 0; i < 8; i++) state = rewardMood(state, String(i), 100);
    expect(state.value).toBe(100);
    expect(moodValue(state, 0)).toBe(100);
    expect(rewardMood(state, 'later', 0).updatedAt).toBe(100);
  });
  it('recovers from corrupt storage', () => {
    expect(readMood('{oops', 10).value).toBe(70);
    expect(readMood('{"value":1000}', 10).updatedAt).toBe(10);
  });
});
