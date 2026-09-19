import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SoftHead } from './SoftHead';
import { SoftGait } from './SoftGait';
import { GroundContact } from './GroundContact';

it('preserves the supplied palette while foot motion and body tilt stay above the floor', async () => {
  const bytes = readFileSync(new URL('../../public/models/nova.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const body = new THREE.Group();
  const normalized = new THREE.Group();
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const factor = 142 / Math.max(size.x, size.y, size.z);
  const footY = -size.y * factor / 2;
  normalized.scale.setScalar(factor);
  normalized.position.copy(bounds.getCenter(new THREE.Vector3())).multiplyScalar(-factor);
  normalized.add(gltf.scene);
  body.add(normalized);
  let mesh;
  gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) mesh = object; });
  expect(mesh).toBeDefined();
  const character = mesh;
  character.geometry.computeVertexNormals();
  const colors = character.geometry.getAttribute('color');
  expect(colors.count).toBe(character.geometry.getAttribute('position').count);
  expect(character.material.vertexColors).toBe(true);
  const originalColors = Array.from(colors.array);
  const head = new SoftHead(character);
  const gait = new SoftGait(character);
  const ground = new GroundContact(body, footY);
  const point = new THREE.Vector3();
  for (const distance of [0, 6, 17, 30, 42]) {
    head.set(0.2, 0.12);
    gait.set(distance, 1);
    body.rotation.set(0.055, distance / 46 * Math.PI, 0.06);
    body.scale.set(1.05, 0.92, 1);
    for (const height of [0, 30]) {
      body.position.y = footY + height - ground.lowestY();
      body.updateWorldMatrix(true, true);
      let lowest = Infinity;
      // Check every rendered vertex, not just the contact solver's candidate subset.
      for (let i = 0; i < colors.count; i++) {
        character.getVertexPosition(i, point).applyMatrix4(character.matrixWorld);
        lowest = Math.min(lowest, point.y);
      }
      expect(lowest).toBeCloseTo(footY + height, 5);
    }
  }
  expect(Array.from(colors.array)).toEqual(originalColors);
  head.set(0, 0);
  gait.set(0, 0);
  expect(character.morphTargetInfluences.every(weight => weight === 0)).toBe(true);
  character.geometry.dispose();
  character.material.dispose();
});
