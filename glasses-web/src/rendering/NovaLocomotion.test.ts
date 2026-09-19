import { describe, expect, it } from 'vitest';
import { NovaLocomotion, NOVA_LOCOMOTION_SETTINGS as settings } from './NovaLocomotion';

const advance = (body: NovaLocomotion, seconds: number, fps = 120): void => {
  for (let frame = 0; frame < Math.round(seconds * fps); frame++) body.update(1 / fps);
};

describe('character stage physics', () => {
  it('accelerates gradually, caps speed, brakes before a target, and settles', () => {
    const body = new NovaLocomotion();
    body.moveTo(140);
    const first = body.update(settings.fixedStep);
    expect(first.velocityX).toBeCloseTo(settings.acceleration * settings.fixedStep, 8);
    let fastest = 0;
    let slowedDown = false;
    for (let i = 0; i < 360; i++) {
      const previous = body.state;
      const next = body.update(settings.fixedStep);
      fastest = Math.max(fastest, next.velocityX);
      if (next.x > 100 && next.velocityX < previous.velocityX) slowedDown = true;
      expect(Math.abs(next.velocityX)).toBeLessThanOrEqual(settings.maxSpeed);
      expect(Math.abs(next.velocityX - previous.velocityX)).toBeLessThanOrEqual(settings.braking * settings.fixedStep + 1e-8);
    }
    expect(fastest).toBe(settings.maxSpeed);
    expect(slowedDown).toBe(true);
    expect(body.state).toMatchObject({ x: 140, velocityX: 0, moving: false, running: false, targetX: null });
  });

  it.each([30, 60, 120])('has the same trajectory at %i frames per second', fps => {
    const body = new NovaLocomotion();
    const reference = new NovaLocomotion();
    body.runAround();
    reference.runAround();
    advance(body, 0.4, fps);
    advance(reference, 0.4);
    body.jump();
    reference.jump();
    for (let segment = 0; segment < 12; segment++) {
      advance(body, 0.2, fps);
      advance(reference, 0.2);
      expect(body.state).toEqual(reference.state);
    }
  });

  it('uses a ballistic arc, cannot jump again in the air, and resolves the floor', () => {
    const body = new NovaLocomotion();
    expect(body.jump()).toBe(true);
    expect(body.jump()).toBe(false);
    advance(body, 0.25);
    expect(body.state.height).toBeCloseTo(settings.jumpSpeed * 0.25 - 0.5 * settings.gravity * 0.25 ** 2, 8);
    expect(body.state.velocityY).toBeCloseTo(settings.jumpSpeed - settings.gravity * 0.25, 8);
    let apex = body.state.height;
    let landed = false;
    for (let frame = 0; frame < 120; frame++) {
      const state = body.update(settings.fixedStep);
      expect(state.height).toBeGreaterThanOrEqual(0);
      apex = Math.max(apex, state.height);
      if (state.grounded && !landed) {
        landed = true;
        expect(state.velocityY).toBe(0);
        expect(state.landing).toBe(1);
      }
    }
    expect(apex).toBeCloseTo(settings.jumpSpeed ** 2 / (2 * settings.gravity), 1);
    expect(landed).toBe(true);
    expect(body.state.height).toBe(0);
    expect(body.state.landing).toBeLessThan(0.01);
    expect(body.jump()).toBe(true);
  });

  it('retains horizontal momentum in flight and brakes after landing', () => {
    const body = new NovaLocomotion();
    body.moveTo(140);
    advance(body, 0.3);
    const takeoff = body.state;
    body.jump();
    body.stop();
    advance(body, 0.2);
    expect(body.state.velocityX).toBe(takeoff.velocityX);
    expect(body.state.x).toBeCloseTo(takeoff.x + takeoff.velocityX * 0.2, 8);
    advance(body, 1);
    expect(body.state).toMatchObject({ grounded: true, velocityX: 0, velocityY: 0, running: false });
  });

  it.each([-1, 1])('respects the %i stage edge without tunnelling or jitter', direction => {
    const body = new NovaLocomotion();
    body.moveTo(direction * 10000);
    advance(body, 0.4);
    body.jump();
    for (let frame = 0; frame < 40; frame++) {
      const state = body.update(frame === 0 ? 5 : 0.1);
      expect(state.x).toBeGreaterThanOrEqual(settings.stageMinX);
      expect(state.x).toBeLessThanOrEqual(settings.stageMaxX);
      expect(state.height).toBeGreaterThanOrEqual(0);
    }
    expect(body.state).toMatchObject({ x: direction * 145, velocityX: 0, velocityY: 0, grounded: true, targetX: null });
    const settled = body.state;
    advance(body, 1);
    expect(body.state).toEqual(settled);
  });

  it('runs both directions and returns home within six seconds', () => {
    const body = new NovaLocomotion();
    body.runAround();
    let minX = 0;
    let maxX = 0;
    let hops = 0;
    let distance = 0;
    const directions = new Set<number>();
    for (let frame = 0; frame < 720; frame++) {
      const previous = body.state;
      const state = body.update(settings.fixedStep);
      minX = Math.min(minX, state.x);
      maxX = Math.max(maxX, state.x);
      if (state.moving) directions.add(state.facing);
      if (previous.grounded && state.grounded) {
        expect(Math.abs(state.velocityX - previous.velocityX)).toBeLessThanOrEqual(settings.braking * settings.fixedStep + 1e-8);
      }
      distance += Math.abs(state.x - previous.x);
      if (previous.grounded && !state.grounded) {
        hops++;
        expect(Math.abs(state.velocityX)).toBeGreaterThanOrEqual(settings.autoHopSpeed);
      }
    }
    expect(minX).toBeLessThan(-110);
    expect(maxX).toBeGreaterThan(110);
    expect(directions).toEqual(new Set([-1, 1]));
    expect(body.state).toMatchObject({ x: 0, velocityX: 0, grounded: true, running: false, targetX: null });
    expect(hops).toBe(2);
    expect(distance).toBeGreaterThan(580);
    expect(body.state.strideDistance).toBeLessThan(distance - 100);
  });

  it('stops with braking and can cancel an automatic route', () => {
    const body = new NovaLocomotion();
    body.runAround();
    advance(body, 0.15);
    const before = body.state;
    body.stop();
    expect(body.state.velocityX).toBe(before.velocityX);
    const braking = body.update(settings.fixedStep);
    expect(braking.velocityX).toBeLessThan(before.velocityX);
    expect(braking.velocityX).toBeGreaterThan(0);
    advance(body, 1);
    expect(body.state).toMatchObject({ velocityX: 0, running: false, targetX: null });
    expect(body.state.x).toBeGreaterThan(before.x);
    expect(body.state.x).toBeLessThan(115);
  });

  it('pauses hidden motion, bounds stall catch-up, ignores invalid time, and resets', () => {
    const body = new NovaLocomotion();
    const reference = new NovaLocomotion();
    body.runAround();
    reference.runAround();
    const initial = body.state;
    body.update(10, false);
    for (const delta of [NaN, Infinity, -1, 0]) body.update(delta);
    expect(body.state).toEqual(initial);
    body.update(10);
    reference.update(settings.maxFrameDelta);
    expect(body.state).toEqual(reference.state);
    body.moveTo(NaN);
    expect(body.state).toEqual(reference.state);
    body.reset();
    expect(body.state).toEqual(new NovaLocomotion().state);
  });
});
