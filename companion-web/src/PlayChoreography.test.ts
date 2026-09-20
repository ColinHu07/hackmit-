import { describe, expect, it } from 'vitest';
import { advancePetStage, makePlayDance, PET_CLEARANCE, samplePlayDance, spacePets, type StagePoint } from './PlayChoreography';

const point = (slot: number, x = 0, z = 0): StagePoint => ({ id: `pet-${slot}`, slot, x, z });
function clear(points: StagePoint[]) {
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.z - points[j]!.z)).toBeGreaterThanOrEqual(PET_CLEARANCE - 0.0001);
  }
}

describe('shared play choreography', () => {
  it.each([2, 3, 4])('keeps %i pets separated throughout arrival, circling, dancing and return', count => {
    const dance = makePlayDance(Array.from({ length: count }, (_, i) => point(i)));
    let previous = samplePlayDance(dance, 0).sort((a, b) => a.slot - b.slot);
    for (let frame = 1; frame <= 540; frame++) {
      const positions = samplePlayDance(dance, frame / 540).sort((a, b) => a.slot - b.slot);
      clear(positions);
      for (let i = 0; i < count; i++) {
        // Nine-second sequence at 60Hz: bounded movement, no slot teleportation.
        expect(Math.hypot(positions[i]!.x - previous[i]!.x, positions[i]!.z - previous[i]!.z)).toBeLessThan(0.085);
      }
      previous = positions;
    }
    expect(samplePlayDance(dance, 1)).toEqual(samplePlayDance(dance, 0));
  });
  it('does not swap or teleport pets when their walking targets cross', () => {
    let previous = [point(0, -2), point(1, 2)];
    for (let frame = 0; frame < 240; frame++) {
      const current = advancePetStage([point(0, 2), point(1, -2)], previous, 1 / 60);
      clear(current);
      expect(current[0]!.x).toBeLessThan(current[1]!.x);
      current.forEach((p, i) => expect(Math.hypot(p.x - previous[i]!.x, p.z - previous[i]!.z)).toBeLessThan(0.07));
      previous = current;
    }
  });
  it('is independent of snapshot order and never mutates shared positions', () => {
    const points = [point(0, 0.1, -0.2), point(1, 0.12, 0.3), point(2, -0.4, 0.2), point(3, 0.5, 0.1)];
    const original = structuredClone(points);
    const forward = makePlayDance(points), reverse = makePlayDance([...points].reverse());
    for (const t of [0, 0.1, 0.3, 0.5, 0.8, 1]) expect(samplePlayDance(forward, t)).toEqual(samplePlayDance(reverse, t));
    expect(points).toEqual(original);
  });
  it('separates spectators and coincident pets without NaN or drifting the group center', () => {
    const points = Array.from({ length: 4 }, (_, i) => point(i, 8, -12));
    const separated = spacePets(points);
    clear(separated);
    expect(separated.reduce((sum, p) => sum + p.x, 0) / 4).toBeCloseTo(8);
    expect(separated.reduce((sum, p) => sum + p.z, 0) / 4).toBeCloseTo(-12);
    expect(spacePets(separated)).toEqual(separated);
  });
  it('keeps reduced-motion pets stationary in safe positions', () => {
    const dance = makePlayDance([point(0), point(1)]);
    for (const t of [0, 0.1, 0.5, 0.8, 1]) {
      expect(samplePlayDance(dance, t, true)).toEqual(samplePlayDance(dance, 0));
      clear(samplePlayDance(dance, t, true));
    }
  });
  it('finishes exactly where each pet started, even for uneven groups', () => {
    for (let layout = 0; layout < 20; layout++) {
      const points = Array.from({ length: 4 }, (_, i) => point(i, Math.sin(layout * 7 + i) * 0.6, Math.cos(layout * 3 + i) * 0.6));
      const dance = makePlayDance(points);
      for (let frame = 0; frame <= 100; frame++) clear(samplePlayDance(dance, frame / 100));
      const start = samplePlayDance(dance, 0), end = samplePlayDance(dance, 0.99999);
      end.forEach(p => {
        const initial = start.find(a => a.id === p.id)!;
        expect(Math.hypot(p.x - initial.x, p.z - initial.z)).toBeLessThan(1e-6);
      });
    }
  });
});
