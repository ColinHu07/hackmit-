import { expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { startingCamera } from './WalkingView';
import { headingToYaw } from './WalkingTracker';
it('projects every starting bearing straight toward screen top, then turns right on screen', () => {
  for (const degrees of [0, 30, 90, 180, 270, 359]) {
    const yaw = headingToYaw(degrees);
    const camera = new OrthographicCamera(-6, 6, 6, -6, 0.1, 70);
    camera.position.set(...startingCamera(yaw));
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const center = new Vector3().project(camera);
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).project(camera);
    expect(forward.x - center.x).toBeCloseTo(0);
    expect(forward.y).toBeGreaterThan(center.y);
    const rightYaw = headingToYaw(degrees + 90);
    const turned = new Vector3(Math.sin(rightYaw), 0, Math.cos(rightYaw)).project(camera);
    expect(turned.x).toBeGreaterThan(center.x);
  }
});
