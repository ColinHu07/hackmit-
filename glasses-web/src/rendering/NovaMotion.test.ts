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
  it('gives each action recognizable motion and keeps scale positive', () => {
    expect(sampleNovaPose(11, reaction('pet')).headTilt).toBeGreaterThan(0.1);
    expect(sampleNovaPose(11, reaction('feed')).headBow).toBeGreaterThan(0.15);
    expect(sampleNovaPose(10.2, reaction('play')).scaleY).toBeLessThan(0.95);
    expect(sampleNovaPose(11.5, reaction('play')).y).toBe(0);
    for (const action of ['pet', 'feed', 'play'] as const) {
      for (let time = 10; time <= 13; time += 0.025) {
        const pose = sampleNovaPose(time, reaction(action), 12, 8);
        expect(Object.values(pose).every(Number.isFinite)).toBe(true);
        expect(Math.min(pose.scaleX, pose.scaleY, pose.scaleZ)).toBeGreaterThan(0.85);
      }
    }
  });
  it('breathes between interactions, with a still pose in reduced-motion mode', () => {
    expect(sampleNovaPose(0.95, null).scaleY).toBeGreaterThan(1);
    for (const action of ['pet', 'feed', 'play'] as const) {
      expect(sampleNovaPose(11, reaction(action), 12, 8, true)).toEqual(sampleNovaPose(0, null, 0, 0, true));
    }
  });
  it('smooths hand approach independently of frame rate and releases lost contact', () => {
    const hand = { near: true, pet: false, reachX: 12, reachY: 8 };
    const a = new NovaMotion(), b = new NovaMotion();
    for (let i = 0; i < 30; i++) a.update(1 / 30, hand);
    for (let i = 0; i < 120; i++) b.update(1 / 120, hand);
    expect(a.sample(1, null, false).x).toBeCloseTo(b.sample(1, null, false).x, 8);
    for (let i = 0; i < 120; i++) a.update(1 / 60);
    expect(a.sample(3, null, false).x).toBe(0);
  });
});

it('soft head morphs move the upper mesh while preserving feet and the source positions', () => {
  const geometry = new BoxGeometry(2, 4, 2, 2, 4, 2);
  const mesh = new Mesh(geometry);
  const original = Array.from(geometry.getAttribute('position').array);
  const head = new SoftHead(mesh);
  head.set(0.25, 0.2);
  expect(mesh.morphTargetInfluences!.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(1);
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
  expect(mesh.morphTargetInfluences).toEqual([0, 0, 0]);
  geometry.dispose();
});
