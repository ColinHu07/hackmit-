import { expect, it } from 'vitest';
import { cooldownState, formatTreatTime } from './TreatCooldown';
import { eatenFraction } from '../../shared/feeding.mjs';
import { samplePetAction } from './PetActionPose';

it('drains a hollow ring smoothly between server snapshots and ends at zero', () => {
  expect(cooldownState(3_600_000)).toEqual({ remaining: 3_600_000, fraction: 1, seconds: 3600 });
  expect(cooldownState(3_600_000, 1_800_000)).toEqual({ remaining: 1_800_000, fraction: .5, seconds: 1800 });
  expect(cooldownState(3_600_000, 3_600_001)).toEqual({ remaining: 0, fraction: 0, seconds: 0 });
  expect(cooldownState(NaN).remaining).toBe(0);
});
it('the three happiness increases follow the exact fruit bites', () => {
  for (const t of [.4, .45, .46, .49, .52, .55, .595, .61, .7]) {
    expect(samplePetAction('feed', t).treatScale + eatenFraction(t)).toBeCloseTo(1);
  }
  expect(eatenFraction(.4)).toBe(0);
  expect(eatenFraction(.49)).toBeCloseTo(.28);
  expect(eatenFraction(.55)).toBeCloseTo(.6);
  expect(eatenFraction(.61)).toBe(1);
});


it('formats the hour countdown without overflowing the scene timer', () => {
  expect(formatTreatTime(3_600_000)).toBe('1h');
  expect(formatTreatTime(3_599_000)).toBe('59m 59s');
  expect(formatTreatTime(60_000)).toBe('1m 00s');
  expect(formatTreatTime(999)).toBe('1s');
  expect(formatTreatTime(0)).toBe('0s');
});
