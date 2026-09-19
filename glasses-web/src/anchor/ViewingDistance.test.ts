import { describe, expect, it } from 'vitest';
import { distanceScale, projectionScale } from './ViewingDistance';

describe('perspective viewing distance', () => {
  it('doubles the apparent size at half the distance and restores it on return', () => {
    expect([2, 1, 4, 2].map(distance => distanceScale(distance))).toEqual([1, 2, 0.5, 1]);
    expect(distanceScale(1.5, 3)).toBe(2);
  });

  it('bounds near/far sizes and keeps unknown or invalid distance neutral', () => {
    expect(distanceScale(0.01)).toBe(3);
    expect(distanceScale(1000)).toBe(0.25);
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(distanceScale(invalid)).toBe(1);
      expect(distanceScale(2, invalid)).toBe(1);
      expect(projectionScale(invalid)).toBe(1);
    }
    expect(projectionScale()).toBe(1);
  });
});
