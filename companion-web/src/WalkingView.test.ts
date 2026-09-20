import { expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { followingCamera, screenMovement, walkingPlayer } from './WalkingView';
import { headingToYaw, WalkingTracker } from './WalkingTracker';
import type { PlayPlayer } from '../../shared/play-protocol';

it('renders detected steps in preview and while disconnected from the server', () => {
  const tracker = new WalkingTracker();
  tracker.setStepTracking(true);
  const stale: PlayPlayer = { id: 'me', name: '', slot: 0, x: 0, z: 0, targetX: 0, targetZ: 0, yaw: Math.PI, connected: true, action: null };
  tracker.steps(2);
  for (const server of [undefined, stale]) {
    const rendered = walkingPlayer(server, tracker.pose, true);
    expect(rendered.z).toBeCloseTo(-0.7);
    expect(rendered.targetZ).toBeCloseTo(-0.7);
    tracker.heading(90, 5);
    const turned = walkingPlayer(server, tracker.pose, true);
    expect(turned.x).toBe(rendered.x);
    expect(turned.z).toBe(rendered.z);
    expect(turned.yaw).toBe(tracker.pose.yaw);
  }
  expect(stale.z).toBe(0);
});

it('uses the same distant position as observers while connected, even after a compass turn', () => {
  const shared: PlayPlayer = { id: 'me', name: '', slot: 0, x: -1.2, z: -10.5, targetX: -1.2, targetZ: -10.5, yaw: Math.PI, connected: true, action: null };
  for (const heading of [0, 45, 90, 180, 270, 359]) {
    // Even a stale local origin or a local target ahead of the server cannot
    // move the connected pet into a different world than the observer sees.
    for (const z of [0, -15]) {
      const rendered = walkingPlayer(shared, { x: 0, z, yaw: headingToYaw(heading) }, false);
      expect(rendered.x).toBe(shared.x); expect(rendered.z).toBe(shared.z);
      expect(rendered.targetX).toBe(shared.targetX); expect(rendered.targetZ).toBe(shared.targetZ);
    }
  }
});

it('keeps server movement intact when only the browser compass is enabled', () => {
  const player: PlayPlayer = { id: 'me', name: '', slot: 0, x: 1, z: 2, targetX: 2, targetZ: 3, yaw: 0, connected: true, action: null };
  expect(walkingPlayer(player, { x: 0, z: 0, yaw: Math.PI }, false))
    .toEqual({ ...player, yaw: Math.PI });
});

it('keeps a moving pet centered and facing screen top through a full turn', () => {
  const camera = new OrthographicCamera(-6, 6, 6, -6, 0.1, 70);
  for (const degrees of [0, 30, 90, 180, 270, 359, 1]) {
    const yaw = headingToYaw(degrees), x = 2.2, z = -1.7;
    camera.position.set(...followingCamera(yaw, x, z));
    camera.lookAt(x, 0, z); camera.updateMatrixWorld();
    const center = new Vector3(x, 0, z).project(camera);
    const forward = new Vector3(x + Math.sin(yaw), 0, z + Math.cos(yaw)).project(camera);
    expect(center.x).toBeCloseTo(0); expect(center.y).toBeCloseTo(0);
    expect(forward.x).toBeCloseTo(0);
    expect(forward.y).toBeGreaterThan(center.y);
    // Controls remain relative to the screen after the camera turns.
    for (const [right, down] of [[1, 0], [0, -1], [-1, 0], [0, 1]]) {
      const [dx, dz] = screenMovement(yaw, right!, down!);
      const point = new Vector3(x + dx, 0, z + dz).project(camera);
      if (right) expect(Math.sign(point.x)).toBe(right);
      else expect(point.x).toBeCloseTo(0);
      if (down) expect(Math.sign(point.y)).toBe(-down);
      else expect(point.y).toBeCloseTo(0);
    }
  }
});

it('keeps the pet centered while pitch changes the camera elevation', () => {
  const camera = new OrthographicCamera(-6, 6, 6, -6, .1, 70);
  for (const pitch of [-.3, 0, .3]) {
    camera.position.set(...followingCamera(1.2, 23, -42, pitch));
    camera.lookAt(23, 0, -42); camera.rotateZ(.2); camera.updateMatrixWorld();
    const center = new Vector3(23, 0, -42).project(camera);
    expect(center.x).toBeCloseTo(0); expect(center.y).toBeCloseTo(0);
    expect(camera.position.distanceTo(new Vector3(23, 0, -42))).toBeCloseTo(Math.hypot(13, 10));
  }
  expect(followingCamera(0, 0, 0, .3)[1]).toBeGreaterThan(followingCamera(0)[1]);
});

it('continues walking from a touch destination without returning to the old origin', () => {
  const tracker = new WalkingTracker(); tracker.setStepTracking(true); tracker.heading(90, 0);
  tracker.steps(2); tracker.moveTo(20, -30); tracker.steps(1);
  expect(tracker.hasHeading).toBe(true);
  expect(tracker.pose.x).toBeCloseTo(20.35); expect(tracker.pose.z).toBeCloseTo(-30);
  tracker.heading(180, 0);
  expect(tracker.pose.x).toBeCloseTo(20.35); expect(tracker.pose.z).toBeCloseTo(-30);
});
