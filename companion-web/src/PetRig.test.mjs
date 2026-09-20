import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SoftHead } from '../../glasses-web/src/rendering/SoftHead';
import { SoftGait } from '../../glasses-web/src/rendering/SoftGait';
import { SoftJump } from '../../glasses-web/src/rendering/SoftJump';
import { GroundContact } from '../../glasses-web/src/rendering/GroundContact';
import { SoftPaws } from './SoftPaws';
import { samplePetAction } from './PetActionPose';

it('composes the phone rigs without moving the face during a wave or sinking the feet during a jump', async () => {
  const bytes = readFileSync(new URL('../../glasses-web/public/models/nova.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const bounds = new THREE.Box3().setFromObject(scene);
  const scale = 1.5 / Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
  const center = bounds.getCenter(new THREE.Vector3());
  const body = new THREE.Group(), normalized = new THREE.Group();
  normalized.scale.setScalar(scale);
  normalized.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  normalized.add(scene); body.add(normalized);
  let mesh;
  scene.traverse(o => { if (o.isMesh) mesh = o; });
  const positions = mesh.geometry.getAttribute('position');
  const head = new SoftHead(mesh), gait = new SoftGait(mesh), jump = new SoftJump(mesh), paws = new SoftPaws(mesh);
  const ground = new GroundContact(body, 0, 0.27);
  const point = new THREE.Vector3();
  paws.set(2.5, 0);
  let movedPaw = 0;
  for (let i = 0; i < positions.count; i++) {
    mesh.getVertexPosition(i, point);
    if (positions.getY(i) > 0.32) {
      expect(point.distanceTo(new THREE.Vector3().fromBufferAttribute(positions, i))).toBeLessThan(1e-6);
    }
    if (positions.getY(i) > -0.13 && positions.getY(i) < -0.02 && positions.getX(i) > -0.14 && positions.getZ(i) > 0.43) {
      movedPaw = Math.max(movedPaw, point.distanceTo(new THREE.Vector3().fromBufferAttribute(positions, i)));
    }
  }
  expect(movedPaw).toBeGreaterThan(0.2);
  paws.set(0, 0);
  for (const t of [0, 0.14, 0.24, 0.49, 0.74, 0.81, 1]) {
    const pose = samplePetAction('jump', t);
    jump.set(pose.crouch, 0); head.set(pose.tilt, pose.bow, jump.torsoPitch); gait.set(0, 0);
    body.rotation.set(pose.pitch, 0, 0);
    body.position.y = pose.lift - ground.lowestY();
    jump.set(pose.crouch, pose.tuck);
    body.updateWorldMatrix(true, true);
    let lowest = Infinity;
    for (let i = 0; i < positions.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      lowest = Math.min(lowest, point.y);
    }
    expect(lowest).toBeGreaterThanOrEqual(pose.lift - 1e-6);
    if (!pose.tuck) expect(lowest).toBeCloseTo(pose.lift, 5);
    expect(mesh.morphTargetInfluences.every(Number.isFinite)).toBe(true);
  }
  expect(mesh.morphTargetInfluences.every(weight => weight === 0)).toBe(true);
  mesh.geometry.dispose(); mesh.material.dispose();
});
