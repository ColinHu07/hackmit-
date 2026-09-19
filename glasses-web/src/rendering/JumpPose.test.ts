import { describe, expect, it } from 'vitest';
import { NovaLocomotion, NOVA_LOCOMOTION_SETTINGS as settings, type NovaJumpPhase } from './NovaLocomotion';
import { sampleJumpPose } from './JumpPose';

const sample = (jumpPhase: NovaJumpPhase, jumpPhaseTime: number) => sampleJumpPose({ jumpPhase, jumpPhaseTime });

describe('jump body choreography', () => {
  it('loads the legs before takeoff and extends them before leaving the floor', () => {
    expect(sample('anticipation', 0).crouch).toBe(0);
    expect(sample('anticipation', settings.anticipationDuration * 0.6).crouch).toBeCloseTo(1);
    expect(sample('anticipation', settings.anticipationDuration).crouch).toBeCloseTo(0);
    expect(sample('anticipation', settings.anticipationDuration).gait).toBe(1);
    expect(sample('anticipation', settings.anticipationDuration)).toEqual(sample('airborne', 0));
  });

  it('tucks in flight and reaches for the floor before impact', () => {
    const flight = 2 * settings.jumpSpeed / settings.gravity;
    expect(sample('airborne', 0).tuck).toBe(0);
    expect(sample('airborne', flight * 0.45).tuck).toBeCloseTo(1);
    expect(sample('airborne', flight * 0.9).tuck).toBeCloseTo(0);
    const beforeContact = sample('airborne', flight);
    const atContact = sample('landing', 0);
    for (const key of Object.keys(beforeContact) as (keyof typeof beforeContact)[]) {
      expect(beforeContact[key]).toBeCloseTo(atContact[key], 10);
    }
    expect(sample('airborne', flight * 0.2).pitch).toBeLessThan(0);
    expect(sample('airborne', flight * 0.7).pitch).toBeGreaterThan(0);
  });

  it('absorbs contact after landing, with a later head nod and a smooth recovery', () => {
    const duration = settings.landingDuration;
    expect(sample('landing', 0).crouch).toBe(0);
    expect(sample('landing', duration * 0.28).crouch).toBeCloseTo(0.85);
    expect(sample('landing', duration * 0.4).headBow).toBeGreaterThan(sample('landing', duration * 0.28).headBow);
    expect(sample('landing', duration)).toEqual(sample('idle', 0));
  });

  it('keeps consecutive physics poses continuous across takeoff and impact', () => {
    const body = new NovaLocomotion();
    body.jump();
    let previous = sampleJumpPose(body.state);
    const phases = new Set<NovaJumpPhase>();
    for (let i = 0; i < 180; i++) {
      const state = body.update(settings.fixedStep);
      const pose = sampleJumpPose(state);
      phases.add(state.jumpPhase);
      expect(Math.abs(pose.crouch - previous.crouch)).toBeLessThan(0.23);
      expect(Math.abs(pose.tuck - previous.tuck)).toBeLessThan(0.09);
      expect(Math.abs(pose.pitch - previous.pitch)).toBeLessThan(0.015);
      expect(Math.abs(pose.headBow - previous.headBow)).toBeLessThan(0.01);
      expect(pose.crouch).toBeGreaterThanOrEqual(0);
      expect(pose.crouch).toBeLessThanOrEqual(1);
      expect(pose.tuck).toBeGreaterThanOrEqual(0);
      expect(pose.tuck).toBeLessThanOrEqual(1);
      previous = pose;
    }
    expect(phases).toEqual(new Set(['anticipation', 'airborne', 'landing', 'idle']));
    expect(previous).toEqual(sample('idle', 0));
  });

  it('uses the rest pose for reduced motion and handles invalid phase times', () => {
    for (const jumpPhase of ['anticipation', 'airborne', 'landing'] as const) {
      expect(sampleJumpPose({ jumpPhase, jumpPhaseTime: 0.1 }, true)).toEqual(sample('idle', 0));
      for (const jumpPhaseTime of [-1, NaN, Infinity]) {
        expect(Object.values(sample(jumpPhase, jumpPhaseTime)).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('keeps running feet active on the ground and restores their pose before contact', () => {
    const flight = 2 * settings.jumpSpeed / settings.gravity;
    for (let fraction = 0; fraction <= 1; fraction += 0.1) {
      expect(sample('anticipation', fraction * settings.anticipationDuration).gait).toBe(1);
      expect(sample('landing', fraction * settings.landingDuration).gait).toBe(1);
    }
    expect(sample('airborne', 0).gait).toBe(1);
    expect(sample('airborne', flight * 0.5).gait).toBe(0);
    expect(sample('airborne', flight * 0.95).gait).toBeCloseTo(1);
  });
});
