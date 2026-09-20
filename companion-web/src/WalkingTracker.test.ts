import { describe, expect, it } from 'vitest';
import { WalkingTracker, headingToYaw, localMeters } from './WalkingTracker';
import type { LocationFix } from './LocationDiscovery';
const fix = (north: number, east: number, timestamp = 1000, accuracy = 2): LocationFix => ({
  latitude: north / 111194.9266, longitude: east / 111194.9266, accuracy, timestamp,
});
describe('native walking in a north-aligned meadow', () => {
  it('maps north/south to negative/positive Z and east/west to X', () => {
    for (const [north, east, x, z] of [[5, 0, 0, -1], [-5, 0, 0, 1], [0, 5, 1, 0], [0, -5, -1, 0]]) {
      const tracker = new WalkingTracker();
      tracker.location(fix(0, 0), 1000);
      expect(tracker.location(fix(north!, east!, 4000), 4000).moved).toBe(true);
      expect(tracker.pose.x).toBeCloseTo(x!); expect(tracker.pose.z).toBeCloseTo(z!);
    }
  });
  it('turning toward north/east changes facing without translation', () => {
    const tracker = new WalkingTracker(); tracker.reset(1, -1);
    expect(tracker.heading(0, 5)).toBe(true); expect(tracker.pose.yaw).toBeCloseTo(Math.PI);
    tracker.heading(90, 5); expect(tracker.pose).toEqual({ x: 1, z: -1, yaw: Math.PI / 2 });
    expect(headingToYaw(180)).toBe(0);
    expect(tracker.heading(90, -1)).toBe(false); expect(tracker.heading(90, 50)).toBe(false);
  });
  it('does not walk from stationary jitter, stale fixes, or poor GPS', () => {
    const tracker = new WalkingTracker(); tracker.location(fix(0, 0), 1000);
    expect(tracker.location(fix(1, 0, 2000), 2000).moved).toBe(false);
    expect(tracker.location(fix(10, 0, 3000, 30), 3000).moved).toBe(false);
    expect(tracker.location(fix(10, 0, 4000), 4000).moved).toBe(false); // New baseline after poor accuracy.
    expect(tracker.location(fix(20, 0, 5000), 30000).moved).toBe(false);
    expect(tracker.pose.z).toBe(0);
  });
  it('rejects impossible jumps and reanchors without a teleport', () => {
    const tracker = new WalkingTracker(); tracker.location(fix(0, 0), 1000);
    expect(tracker.location(fix(100, 0, 2000), 2000).moved).toBe(false);
    tracker.location(fix(100, 0, 3000), 3000);
    expect(tracker.pose.z).toBe(0);
    expect(tracker.location(fix(103, 0, 5000), 5000).moved).toBe(true);
    expect(tracker.pose.z).toBeCloseTo(-0.6);
  });
  it('continues beyond the old meadow edge without resetting either coordinate', () => {
    const tracker = new WalkingTracker(); tracker.reset(2.8, 0);
    tracker.location(fix(0, 0), 1000);
    const edge = tracker.location(fix(0, 5, 4000), 4000);
    expect(edge.moved).toBe(true); expect(tracker.pose.x).toBeCloseTo(3.8);
    tracker.location(fix(0, 10, 7000), 7000); expect(tracker.pose.x).toBeCloseTo(4.8);
    tracker.location(fix(0, 100, 30000), 30000); expect(tracker.pose.x).toBeCloseTo(4.8);
    tracker.reset(); tracker.location(fix(0, 100, 31000), 31000);
    expect(tracker.pose.x).toBe(0);
  });
  it('walks out of view then turns without jumping back toward another player', () => {
    const tracker = new WalkingTracker();
    tracker.reset(-1.2, 0); tracker.setStepTracking(true); tracker.heading(0, 5);
    for (let step = 0; step < 30; step++) {
      tracker.steps(1);
      expect(tracker.pose.z).toBeCloseTo(-0.35 * (step + 1));
    }
    const before = { ...tracker.pose };
    for (const heading of [90, 180, 270, 359, 0]) {
      tracker.heading(heading, 5);
      expect(tracker.pose.x).toBeCloseTo(before.x);
      expect(tracker.pose.z).toBeCloseTo(before.z);
    }
    tracker.heading(90, 5); tracker.steps(2);
    expect(tracker.pose.x).toBeCloseTo(before.x + 0.7);
    expect(tracker.pose.z).toBeCloseTo(before.z);
  });
  it('stops at an older server boundary without teleporting and can walk back from it', () => {
    const tracker = new WalkingTracker();
    tracker.setWorldLimit(3); tracker.reset(2.8, 1.4);
    tracker.setStepTracking(true); tracker.heading(90, 5); tracker.steps(2);
    expect(tracker.pose.x).toBe(3); expect(tracker.pose.z).toBeCloseTo(1.4);
    tracker.heading(270, 5); tracker.steps(1);
    expect(tracker.pose.x).toBeCloseTo(2.65); expect(tracker.pose.z).toBeCloseTo(1.4);
  });
  it('handles longitude wrap and longitude scale at high latitude', () => {
    const from = { latitude: 60, longitude: 179.99999, accuracy: 1, timestamp: 0 };
    const delta = localMeters(from, { ...from, longitude: -179.99999 });
    expect(delta.east).toBeCloseTo(1.11, 1); expect(delta.north).toBe(0);
  });
});

it('waits for a valid initial compass bearing and supports starting in every direction', () => {
  for (const [degrees, yaw] of [[0, Math.PI], [90, Math.PI / 2], [180, 0], [270, -Math.PI / 2]]) {
    const tracker = new WalkingTracker();
    expect(tracker.hasHeading).toBe(false);
    expect(tracker.heading(degrees!, 50)).toBe(false);
    expect(tracker.hasHeading).toBe(false);
    tracker.heading(degrees!, 5);
    expect(tracker.hasHeading).toBe(true);
    expect(tracker.pose.yaw).toBeCloseTo(yaw!);
    tracker.reset();
    expect(tracker.hasHeading).toBe(false);
  }
});
