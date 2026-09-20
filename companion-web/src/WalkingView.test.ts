import { expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { followingCamera, screenMovement } from './WalkingView';
import { headingToYaw } from './WalkingTracker';

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
