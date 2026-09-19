import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, Vector3 } from 'three';
import type { CreatureAction, Reaction } from '../interaction/CreatureSession';
import { NovaMotion, sampleNovaPose } from './NovaMotion';
import { SoftHead } from './SoftHead';

const reaction = (action: CreatureAction): Reaction => ({ action, startedAt: 10, duration: 3 });

describe('procedural character motion', () => {
  it.each(['pet', 'feed', 'play'] as const)('%s eases in and settles to idle without a pose jump', action => {
    const r = reaction(action);
    for (const time of [10, 10.00001, 12.99999, 13, 14]) {
      const pose = sampleNovaPose(time, r);
      const idle = sampleNovaPose(time, null);
      for (const key of Object.keys(pose) as (keyof typeof pose)[]) {
        if (key === 'yaw') expect(Math.sin(pose.yaw - idle.yaw)).toBeCloseTo(0, 3);
        else expect(pose[key]).toBeCloseTo(idle[key], 3);
      }
    }
  });
  it('gives each action recognizable motion without changing body proportions', () => {
    expect(sampleNovaPose(11, reaction('pet')).headTilt).toBeGreaterThan(0.01);
    expect(sampleNovaPose(11, reaction('feed')).headBow).toBeGreaterThan(0.09);
    expect(sampleNovaPose(11, reaction('play')).pitch).toBeLessThan(sampleNovaPose(11, null).pitch);
    expect(sampleNovaPose(11.5, reaction('play')).y).toBe(0);
    for (const action of [null, 'pet', 'feed', 'play'] as const) {
      for (let time = 9; time <= 14; time += 0.025) {
        const pose = sampleNovaPose(time, action && reaction(action), 12, 8);
        expect(Object.values(pose).every(Number.isFinite)).toBe(true);
        expect([pose.scaleX, pose.scaleY, pose.scaleZ]).toEqual([1, 1, 1]);
        expect(pose.y).toBe(0);
      }
    }
  });
  it('snuggles toward either side of the touch while keeping the head bend gentle', () => {
    expect(sampleNovaPose(11, reaction('pet'), -12).headTilt).toBeGreaterThan(0);
    expect(sampleNovaPose(11, reaction('pet'), 12).headTilt).toBeLessThan(0);
    for (const reachX of [-12, 0, 12]) {
      for (const reachY of [-6, 0, 8]) {
        for (let time = 10; time <= 13; time += 0.025) {
          const pose = sampleNovaPose(time, reaction('pet'), reachX, reachY);
          expect(Math.abs(pose.headTilt)).toBeLessThan(0.09);
          expect(Math.abs(pose.headBow)).toBeLessThan(0.06);
        }
      }
    }
    const leftOfCenter = sampleNovaPose(11, reaction('pet'), -0.0001);
    const rightOfCenter = sampleNovaPose(11, reaction('pet'), 0.0001);
    expect(leftOfCenter.headTilt).toBeCloseTo(rightOfCenter.headTilt, 4);
  });
  it('breathes between interactions, with a still pose in reduced-motion mode', () => {
    expect(sampleNovaPose(0.95, null).pitch).toBeGreaterThan(0);
    expect(sampleNovaPose(0.95, null).scaleY).toBe(1);
    for (const action of ['pet', 'feed', 'play'] as const) {
      expect(sampleNovaPose(11, reaction(action), 12, 8, true)).toEqual(sampleNovaPose(0, null, 0, 0, true));
    }
  });
  it('accelerates into touch and settles without overshooting a stationary hand', () => {
    const hand = { near: true, pet: false, reachX: 12, reachY: 8 };
    const motion = new NovaMotion();
    motion.update(1 / 60, hand);
    const first = motion.sample(0, null, false).x;
    motion.update(1 / 60, hand);
    const second = motion.sample(0, null, false).x;
    expect(first).toBeGreaterThan(0);
    expect(second - first).toBeGreaterThan(first);
    let previous = second;
    for (let i = 0; i < 120; i++) {
      motion.update(1 / 60, hand);
      const x = motion.sample(0, null, false).x;
      expect(x).toBeGreaterThanOrEqual(previous);
      expect(x).toBeLessThanOrEqual(1.8);
      previous = x;
    }
    expect(previous).toBeCloseTo(1.8, 8);
    for (let i = 0; i < 120; i++) motion.update(1 / 60);
    expect(motion.sample(0, null, false).x).toBeCloseTo(0, 8);
  });
  it('has the same spring response across frame rates, including touch reversal and release', () => {
    const poses = [15, 30, 60, 120].map(fps => {
      const motion = new NovaMotion();
      for (const [seconds, reachX, reachY] of [[0.6, 12, 8], [0.4, -12, -6], [1, 0, 0]] as const) {
        for (let frame = 0; frame < Math.round(seconds * fps); frame++) {
          motion.update(1 / fps, { near: reachX !== 0, pet: false, reachX, reachY });
        }
      }
      return motion.sample(2, reaction('pet'), false);
    });
    for (const pose of poses.slice(1)) {
      for (const key of Object.keys(pose) as (keyof typeof pose)[]) {
        expect(pose[key]).toBeCloseTo(poses[0]![key], 10);
      }
    }
  });
  it('handles long frame gaps and ignores invalid timing or contact data', () => {
    const motion = new NovaMotion();
    const hand = { near: true, pet: false, reachX: 12, reachY: 8 };
    motion.update(0.1, hand);
    const before = motion.sample(0, null, false);
    for (const delta of [-1, 0, Infinity, NaN]) motion.update(delta, hand);
    expect(motion.sample(0, null, false)).toEqual(before);
    motion.update(120, hand);
    expect(motion.sample(0, null, false).x).toBeCloseTo(1.8, 10);
    motion.update(Number.MAX_VALUE, { ...hand, reachX: NaN, reachY: Infinity });
    expect(motion.sample(0, null, false)).toEqual(sampleNovaPose(0, null));
  });
});

it('soft head morphs move the upper mesh while preserving feet and the source positions', () => {
  const geometry = new BoxGeometry(2, 4, 2, 2, 4, 2);
  const mesh = new Mesh(geometry);
  const original = Array.from(geometry.getAttribute('position').array);
  const head = new SoftHead(mesh);
  head.set(0.25, 0.2);
  let moved = 0;
  const point = new Vector3();
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    mesh.getVertexPosition(i, point);
    expect(point.toArray().every(Number.isFinite)).toBe(true);
    if (positions.getY(i) < -1) expect(point.distanceTo(new Vector3().fromBufferAttribute(positions, i))).toBeCloseTo(0, 8);
    else if (point.distanceTo(new Vector3().fromBufferAttribute(positions, i)) > 0.01) moved++;
  }
  expect(moved).toBeGreaterThan(0);
  expect(Array.from(positions.array)).toEqual(original);
  expect(geometry.morphAttributes.normal!.every(normal => Array.from(normal.array).every(Number.isFinite))).toBe(true);
  head.set(0, 0);
  expect(mesh.morphTargetInfluences!.every(value => value === 0)).toBe(true);
  geometry.dispose();
});
