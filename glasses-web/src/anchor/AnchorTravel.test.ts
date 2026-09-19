import { describe, expect, it } from 'vitest';
import { AnchorTravel } from './AnchorTravel';
import { normalizeDegrees, placeAnchor, projectAnchor } from './PseudoWorldAnchor';

const origin = placeAnchor({ yaw: 0, pitch: 0 });

describe('AnchorTravel', () => {
  it('starts a move at the current position and takes a small first step', () => {
    const travel = new AnchorTravel(origin);
    const destination = placeAnchor({ yaw: 40, pitch: 10 });
    travel.request(origin, destination);
    expect(travel.currentAnchor).toEqual(origin);
    expect(travel.update(0)).toMatchObject({ anchor: origin, speed: 0, distanceDelta: 0, travelling: true });
    const firstFrame = travel.update(1 / 60);
    expect(firstFrame.anchor!.yaw).toBeGreaterThan(0);
    expect(firstFrame.anchor!.yaw).toBeLessThan(0.01);
    expect(firstFrame.anchor!.pitch).toBeLessThan(0.01);
  });

  it('eases into and out of a run, bounds speed, and arrives exactly once', () => {
    const travel = new AnchorTravel(origin);
    const destination = placeAnchor({ yaw: 40, pitch: 10 });
    travel.request(origin, destination);
    let frame = travel.update(1 / 60);
    const startingSpeed = frame.speed;
    let previous = origin;
    let distance = frame.distanceDelta;
    let peakSpeed = 0;
    let lastMovingSpeed = 0;
    for (let i = 0; i < 200; i++) {
      frame = travel.update(1 / 60);
      distance += frame.distanceDelta;
      peakSpeed = Math.max(peakSpeed, frame.speed);
      if (frame.travelling) lastMovingSpeed = frame.speed;
      expect(frame.speed).toBeLessThanOrEqual(24);
      expect(frame.anchor!.yaw).toBeGreaterThanOrEqual(previous.yaw);
      expect(frame.anchor!.pitch).toBeGreaterThanOrEqual(previous.pitch);
      expect(Math.hypot(frame.yawVelocity, frame.pitchVelocity)).toBeCloseTo(frame.speed);
      previous = frame.anchor!;
    }
    expect(peakSpeed).toBeGreaterThan(startingSpeed);
    expect(lastMovingSpeed).toBeLessThan(1);
    expect(distance).toBeCloseTo(Math.hypot(40, 10));
    expect(frame).toMatchObject({ anchor: destination, travelling: false, speed: 0, distanceDelta: 0 });
    expect(travel.update(10).anchor).toEqual(destination);
  });

  it.each([[179, -179, 1], [-179, 179, -1]])(
    'takes the short path across yaw wrap from %s to %s', (fromYaw, toYaw, direction) => {
      const from = placeAnchor({ yaw: fromYaw, pitch: 0 });
      const target = placeAnchor({ yaw: toYaw, pitch: 0 });
      const travel = new AnchorTravel(from);
      travel.request(from, target);
      const halfway = travel.update(0.2);
      expect(normalizeDegrees(halfway.anchor!.yaw - fromYaw)).toBeCloseTo(direction);
      expect(Math.sign(halfway.yawVelocity)).toBe(direction);
      expect(travel.update(0.2)).toMatchObject({ anchor: target, travelling: false });
    },
  );

  it('retargets from the current pose without snapping to either destination', () => {
    const travel = new AnchorTravel(origin);
    travel.request(origin, placeAnchor({ yaw: 40, pitch: 10 }));
    const previous = travel.update(0.8).anchor!;
    const destination = placeAnchor({ yaw: -20, pitch: -10 });
    travel.request(previous, destination);
    expect(travel.currentAnchor).toEqual(previous);
    const next = travel.update(1 / 60).anchor!;
    expect(Math.abs(next.yaw - previous.yaw)).toBeLessThan(0.01);
    expect(next.yaw).toBeLessThan(previous.yaw);
    expect(travel.update(10).anchor).toEqual(destination);
  });

  it('continues moving when the viewer looks away', () => {
    const travel = new AnchorTravel(origin);
    const destination = placeAnchor({ yaw: 30, pitch: 0 });
    travel.request(origin, destination);
    const hidden = travel.update(0.6).anchor!;
    expect(projectAnchor(hidden, { yaw: 130, pitch: 0 }, 60, 40).visible).toBe(false);
    const arrived = travel.update(2).anchor!;
    expect(arrived).toEqual(destination);
    expect(projectAnchor(arrived, destination, 60, 40).visible).toBe(true);
  });

  it('uses elapsed seconds so rendering cadence does not affect the path or gait distance', () => {
    const states = [30, 60, 144].map((fps) => {
      const travel = new AnchorTravel(origin);
      travel.request(origin, placeAnchor({ yaw: 40, pitch: -10 }));
      let distance = 0;
      let frame = travel.update(0);
      for (let i = 0; i < fps; i++) {
        frame = travel.update(1 / fps);
        distance += frame.distanceDelta;
      }
      return { ...frame, distance };
    });
    const baseline = states[0]!;
    for (const frame of states.slice(1)) {
      expect(frame.anchor!.yaw).toBeCloseTo(baseline.anchor!.yaw, 10);
      expect(frame.anchor!.pitch).toBeCloseTo(baseline.anchor!.pitch, 10);
      expect(frame.speed).toBeCloseTo(baseline.speed, 10);
      expect(frame.distance).toBeCloseTo(baseline.distance, 10);
    }
  });

  it('accepts a slower angular speed for a calibrated small field of view', () => {
    const travel = new AnchorTravel(origin);
    const destination = placeAnchor({ yaw: 12, pitch: 0 });
    travel.request(origin, destination, 6);
    const halfway = travel.update(1.5);
    expect(halfway.anchor!.yaw).toBeCloseTo(6);
    expect(halfway.speed).toBeCloseTo(6);
    expect(travel.update(1.5)).toMatchObject({ anchor: destination, travelling: false });
  });

  it.each([NaN, Infinity, -10, 0])('falls back to the default speed for invalid speed %s', (speed) => {
    const travel = new AnchorTravel(origin);
    travel.request(origin, placeAnchor({ yaw: 48, pitch: 0 }), speed);
    expect(travel.update(1.5)).toMatchObject({ speed: 24, travelling: true });
    expect(travel.currentAnchor!.yaw).toBeCloseTo(24);
  });

  it('keeps the current pose when the page supplies no elapsed active time', () => {
    const travel = new AnchorTravel(origin);
    travel.request(origin, placeAnchor({ yaw: 20, pitch: 0 }));
    const before = travel.update(0.5);
    expect(travel.update(0)).toEqual({ ...before, distanceDelta: 0 });
    expect(travel.update(0.1).anchor!.yaw).toBeGreaterThan(before.anchor!.yaw);
  });

  it('reset cancels a run and can clear the anchor for a new placement', () => {
    const travel = new AnchorTravel(origin);
    travel.request(origin, placeAnchor({ yaw: 20, pitch: 0 }));
    travel.update(0.5);
    const placed = placeAnchor({ yaw: -40, pitch: -12 });
    travel.reset(placed);
    expect(travel.update(10)).toMatchObject({ anchor: placed, travelling: false, speed: 0 });
    travel.reset();
    expect(travel.update(10)).toMatchObject({ anchor: null, travelling: false, speed: 0 });
  });

  it('treats a move to the same bearing as already arrived', () => {
    const travel = new AnchorTravel(origin);
    travel.request(origin, { ...origin, yaw: 360 });
    expect(travel.update(1)).toMatchObject({ anchor: origin, travelling: false, speed: 0 });
  });

  it('ignores invalid move requests and invalid time steps without losing the current run', () => {
    const travel = new AnchorTravel(origin);
    const destination = placeAnchor({ yaw: 20, pitch: 5 });
    travel.request(origin, destination);
    const before = travel.update(0.3);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      travel.request(before.anchor!, { ...destination, yaw: invalid });
      travel.request({ ...origin, pitch: invalid }, destination);
      expect(travel.update(invalid)).toEqual({ ...before, distanceDelta: 0 });
    }
    expect(travel.update(-1)).toEqual({ ...before, distanceDelta: 0 });
    expect(travel.update(5).anchor).toEqual(destination);
  });

  it('does not retain mutable input anchors or expose its internal anchor', () => {
    const from = { ...origin };
    const to = placeAnchor({ yaw: 20, pitch: 5 });
    const travel = new AnchorTravel(from);
    travel.request(from, to);
    from.yaw = -100;
    to.yaw = 150;
    travel.currentAnchor!.yaw = 90;
    travel.update(0.1).anchor!.yaw = 80;
    expect(travel.update(5).anchor).toEqual(placeAnchor({ yaw: 20, pitch: 5 }));
  });
});
