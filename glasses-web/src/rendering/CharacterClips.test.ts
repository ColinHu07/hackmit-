import { AnimationClip, NumberKeyframeTrack, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { Reaction } from '../interaction/CreatureSession';
import { CharacterClips } from './CharacterClips';

const clip = (name: string, values = [0, 10], duration = 1): AnimationClip =>
  new AnimationClip(name, duration, [new NumberKeyframeTrack('.position[x]', [0, duration], values)]);
const pet = (startedAt = 0, duration = 2): Reaction => ({ action: 'pet', startedAt, duration });

describe('CharacterClips', () => {
  it('recognizes authored names case-insensitively and loops idle', () => {
    const root = new Object3D();
    const clips = new CharacterClips(root, [clip(' IDLE '), clip('pEt'), clip('FEED'), clip('Play')]);
    expect(clips.hasReaction('pet')).toBe(true);
    expect(clips.hasReaction('feed')).toBe(true);
    expect(clips.hasReaction('play')).toBe(true);
    expect(clips.update(0.5, null, false)).toBe(true);
    expect(root.position.x).toBeCloseTo(5);
    clips.update(1, null, false);
    expect(root.position.x).toBeCloseTo(5);
    clips.dispose();
  });

  it('fits a one-shot to the session duration and returns to idle without replaying the same reaction', () => {
    const root = new Object3D();
    const clips = new CharacterClips(root, [clip('Idle', [2, 2]), clip('Pet')]);
    clips.update(0.3, null, false);
    clips.update(1, pet(), false);
    expect(root.position.x).toBeCloseTo(5);
    // A reconstructed Reaction object still identifies the same event.
    clips.update(0.5, pet(), false);
    expect(root.position.x).toBeCloseTo(7.5);
    clips.update(0.5, pet(), false);
    expect(root.position.x).toBeCloseTo(10);
    clips.update(0.3, pet(), false);
    expect(root.position.x).toBeCloseTo(2);
    clips.update(0.5, pet(), false);
    expect(root.position.x).toBeCloseTo(2);
    clips.dispose();
  });

  it('restarts for a new reaction identity and switches to a different action', () => {
    const root = new Object3D();
    const clips = new CharacterClips(root, [clip('Pet'), clip('Feed', [0, 20])]);
    clips.update(1, pet(), false);
    expect(root.position.x).toBeCloseTo(5);
    clips.update(0.5, pet(3), false);
    expect(root.position.x).toBeCloseTo(2.5);
    clips.update(0.5, { action: 'feed', startedAt: 3, duration: 2 }, false);
    expect(root.position.x).toBeCloseTo(5);
    clips.dispose();
  });

  it('keeps idle moving for a missing reaction and fades a completed clip back to rest', () => {
    const root = new Object3D();
    const clips = new CharacterClips(root, [clip('Idle')]);
    clips.update(0.3, null, false);
    expect(clips.hasReaction('pet')).toBe(false);
    clips.update(0.2, pet(), false);
    expect(root.position.x).toBeCloseTo(5);
    clips.dispose();

    const onlyPet = new CharacterClips(root, [clip('Pet', [10, 10])]);
    onlyPet.update(0.3, pet(), false);
    expect(root.position.x).toBeCloseTo(10);
    expect(onlyPet.update(0.09, null, false)).toBe(true);
    expect(root.position.x).toBeCloseTo(5);
    expect(onlyPet.update(0.1, null, false)).toBe(false);
    expect(root.position.x).toBeCloseTo(0);
    onlyPet.dispose();
  });

  it('restores the neutral pose under reduced motion and releases bindings on disposal', () => {
    const root = new Object3D();
    const clips = new CharacterClips(root, [clip('Idle'), clip('Pet')]);
    expect(clips.update(0.5, null, true)).toBe(false);
    expect(root.position.x).toBe(0);
    clips.update(0.5, null, false);
    expect(root.position.x).toBeCloseTo(5);
    expect(clips.update(10, null, true)).toBe(false);
    expect(root.position.x).toBeCloseTo(0);
    clips.update(0.5, null, false);
    expect(root.position.x).toBeCloseTo(5);
    clips.dispose();
    clips.dispose();
    expect(root.position.x).toBeCloseTo(0);
    expect(clips.hasReaction('pet')).toBe(false);
    expect(clips.update(0.5, pet(), false)).toBe(false);
    expect(root.position.x).toBeCloseTo(0);
  });

  it('clears interrupted fades and resumes idle without replaying reactions seen under reduced motion', () => {
    const root = new Object3D();
    const clips = new CharacterClips(root, [clip('Idle', [2, 2]), clip('Pet')]);
    clips.update(0.5, null, false);
    // Switch preference while Idle is still fading into Pet.
    clips.update(0.05, pet(), false);
    expect(clips.update(0.1, pet(), true)).toBe(false);
    expect(root.position.x).toBeCloseTo(0);
    clips.update(0.5, pet(), false);
    expect(root.position.x).toBeCloseTo(2);
    // A new reaction received while disabled is consumed without playing later.
    clips.update(0.1, pet(3), true);
    clips.update(0.5, pet(3), true);
    expect(root.position.x).toBeCloseTo(0);
    clips.update(0.5, pet(3), false);
    expect(root.position.x).toBeCloseTo(2);
    clips.update(0.5, pet(4), false);
    expect(root.position.x).toBeCloseTo(2.5);
    clips.dispose();
  });

  it('ignores empty and unrecognized clips, preserving the original pose', () => {
    const root = new Object3D();
    root.position.x = 7;
    for (const source of [[], [clip('ArmatureAction')], [new AnimationClip('Idle', 1, [])]]) {
      const clips = new CharacterClips(root, source);
      expect(clips.update(1, pet(), false)).toBe(false);
      expect(clips.hasReaction('pet')).toBe(false);
      expect(root.position.x).toBe(7);
      clips.dispose();
    }
  });
});
