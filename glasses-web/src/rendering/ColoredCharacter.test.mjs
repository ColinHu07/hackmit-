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

it('keeps facial distances unchanged throughout a snuggle, including intermediate angles', async () => {
  const bytes = readFileSync(new URL('../../public/models/nova.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  let mesh;
  gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) mesh = object; });
  const positions = mesh.geometry.getAttribute('position');
  const bounds = new THREE.Box3().setFromBufferAttribute(positions);
  const threshold = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.61;
  const facial = [];
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) > threshold && positions.getZ(i) > 0.3) facial.push(i);
  }
  expect(facial.length).toBeGreaterThan(50);
  const head = new SoftHead(mesh);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const [tilt, bow] of [[0, 0], [0.04, 0.02], [-0.085, 0.055], [0.085, 0.055]]) {
    head.set(tilt, bow);
    for (let j = 0; j < 40; j++) {
      const first = facial[j * 7 % facial.length];
      const second = facial[(j * 19 + 41) % facial.length];
      const restDistance = a.fromBufferAttribute(positions, first).distanceTo(b.fromBufferAttribute(positions, second));
      mesh.getVertexPosition(first, a);
      mesh.getVertexPosition(second, b);
      expect(a.distanceTo(b)).toBeCloseTo(restDistance, 6);
    }
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
});
