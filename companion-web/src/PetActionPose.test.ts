import { describe, expect, it } from 'vitest';
import { samplePetAction } from './PetActionPose';

describe('pet action choreography', () => {
  it.each(['feed', 'wave', 'jump', 'play'] as const)('%s begins and ends at rest with finite, continuous poses', kind => {
    expect(samplePetAction(kind, 0)).toEqual(samplePetAction(undefined, 0));
    expect(samplePetAction(kind, 1)).toEqual(samplePetAction(undefined, 0));
    let previous = samplePetAction(kind, 0);
    for (let i = 1; i <= 1000; i++) {
      const pose = samplePetAction(kind, i / 1000);
      for (const key of Object.keys(pose) as (keyof typeof pose)[]) {
        expect(Number.isFinite(pose[key])).toBe(true);
        // Accumulated walking distance need not return to zero: its gait fades out.
        if (key !== 'stride') expect(Math.abs(pose[key] - previous[key])).toBeLessThan(0.15);
      }
      previous = pose;
    }
  });
  it('faces the viewer before approaching, eats before celebrating, and walks home', () => {
    const approach = samplePetAction('feed', 0.25);
    expect(approach.turn).toBeCloseTo(Math.PI);
    expect(approach.approach).toBeGreaterThan(0);
    expect(approach.crouch).toBeGreaterThan(0.7);
    expect(approach.treatScale).toBe(1);
    expect(approach.treatLift).toBe(0);
    expect(samplePetAction('feed', 0.43).treatLift).toBe(1);
    expect(samplePetAction('feed', 0.49).treatScale).toBeCloseTo(0.72);
    expect(samplePetAction('feed', 0.55).treatScale).toBeCloseTo(0.4);
    const happy = samplePetAction('feed', 0.7);
    expect(happy.treatScale).toBe(0);
    expect(happy.joy).toBe(1);
    const home = samplePetAction('feed', 0.93);
    expect(home.turn).toBe(0);
    expect(home.approach).toBeLessThan(happy.approach);
    expect(home.gait).toBeGreaterThan(0);
  });
  it('raises and swings a paw only while facing the viewer', () => {
    expect(samplePetAction('wave', 0.15).wave).toBe(0);
    expect(samplePetAction('wave', 0.4).turn).toBeCloseTo(Math.PI);
    expect(samplePetAction('wave', 0.4).wave).toBeGreaterThan(1.7);
    expect(samplePetAction('wave', 0.5).wave).not.toBe(samplePetAction('wave', 0.4).wave);
    expect(samplePetAction('wave', 0.85).wave).toBe(0);
  });
  it('loads the knees on the ground, tucks in flight, then absorbs impact', () => {
    expect(samplePetAction('jump', 0.14)).toMatchObject({ lift: 0, crouch: 1, tuck: 0 });
    expect(samplePetAction('jump', 0.24)).toMatchObject({ lift: 0, crouch: 0, tuck: 0 });
    expect(samplePetAction('jump', 0.49)).toMatchObject({ lift: 0.65, tuck: 1, crouch: 0 });
    expect(samplePetAction('jump', 0.74)).toMatchObject({ lift: 0, tuck: 0, crouch: 0 });
    expect(samplePetAction('jump', 0.81).crouch).toBeCloseTo(0.9);
  });
  it.each(['feed', 'wave', 'jump', 'play'] as const)('keeps %s motionless under reduced motion', kind => {
    for (const t of [0.1, 0.3, 0.5, 0.8]) {
      expect(samplePetAction(kind, t, true)).toMatchObject({ turn: 0, approach: 0, lift: 0, crouch: 0, tuck: 0, wave: 0, gait: 0, bow: 0 });
    }
  });
});
