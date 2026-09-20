import { expect, it } from 'vitest';
import { SmoothWalk } from './SmoothWalk';

it('keeps moving between half-second footfalls instead of stopping after each update', () => {
  const walk = new SmoothWalk();
  const speeds: number[] = [];
  for (let frame = 0; frame < 180; frame++) {
    const target = 0.35 * (1 + Math.floor(frame / 30));
    const distance = walk.advance(0, -target, 1 / 60);
    if (frame >= 60) speeds.push(distance * 60);
  }
  expect(Math.min(...speeds)).toBeGreaterThan(0.25);
  expect(Math.max(...speeds)).toBeLessThan(1.1);
  // Footfalls change the target, not the instantaneous rendered position.
  expect(Math.max(...speeds.map((v, i) => i ? Math.abs(v - speeds[i - 1]!) : 0))).toBeLessThan(0.25);
});

it('settles at the last detected position without inventing extra steps', () => {
  const walk = new SmoothWalk();
  for (let i = 0; i < 180; i++) {
    walk.advance(0.7, 0, 1 / 60);
    expect(walk.x).toBeLessThanOrEqual(0.7);
    expect(walk.z).toBe(0);
  }
  expect(walk.x).toBeCloseTo(0.7, 5);
  expect(walk.advance(0.7, 0, 1 / 60)).toBeLessThan(0.00001);
});

it('is frame-rate independent and resets momentum on explicit repositioning', () => {
  const a = new SmoothWalk(), b = new SmoothWalk();
  for (let i = 0; i < 60; i++) a.advance(1, -1, 1 / 60);
  for (let i = 0; i < 30; i++) b.advance(1, -1, 1 / 30);
  expect(a.x).toBeCloseTo(b.x, 8); expect(a.z).toBeCloseTo(b.z, 8);
  a.reset(-2, 2);
  expect(a.advance(-2, 2, 1 / 60)).toBe(0);
});
