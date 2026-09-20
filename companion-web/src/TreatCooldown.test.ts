import { expect, it } from 'vitest';
import { cooldownState } from './TreatCooldown';
import { eatenFraction } from '../../shared/feeding.mjs';
import { samplePetAction } from './PetActionPose';

it('drains a hollow ring smoothly between server snapshots and ends at zero', () => {
  expect(cooldownState(15_000)).toEqual({ remaining: 15_000, fraction: 1, seconds: 15 });
  expect(cooldownState(15_000, 7500)).toEqual({ remaining: 7500, fraction: .5, seconds: 8 });
  expect(cooldownState(15_000, 16_000)).toEqual({ remaining: 0, fraction: 0, seconds: 0 });
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
