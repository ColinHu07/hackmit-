import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SoftGait } from './SoftGait';
import { SoftHead } from './SoftHead';

let mesh;
let positions;
let scale;
let feet;

beforeEach(async () => {
  const bytes = readFileSync(new URL('../../public/models/nova.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) mesh = object; });
  positions = mesh.geometry.getAttribute('position');
  const bounds = new THREE.Box3().setFromBufferAttribute(positions);
  const size = bounds.getSize(new THREE.Vector3());
  scale = 142 / Math.max(size.x, size.y, size.z);
  feet = [-1, 1].map(side => {
    let lowest = Infinity;
    let index = -1;
    for (let i = 0; i < positions.count; i++) {
      if (side * (positions.getX(i) + 0.17) > 0.12 && positions.getZ(i) > 0.12 && positions.getY(i) < lowest) {
        lowest = positions.getY(i);
        index = i;
      }
    }
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  });
});

function displacement(index) {
  return mesh.getVertexPosition(index, new THREE.Vector3())
    .sub(new THREE.Vector3().fromBufferAttribute(positions, index)).multiplyScalar(scale);
}

it('raises each whole sole by 12 scene units while the opposite foot stays planted', () => {
  const gait = new SoftGait(mesh);
  for (const [distance, liftedFoot] of [[9, 1], [27, 0]]) {
    gait.set(distance, 1);
    expect(displacement(feet[liftedFoot]).y).toBeCloseTo(12, 4);
    expect(displacement(feet[1 - liftedFoot]).y).toBe(0);
    const side = liftedFoot === 0 ? -1 : 1;
    let checked = 0;
    for (let i = 0; i < positions.count; i++) {
      // Check the visible sole across its full width, not one favorable point.
      if (side * (positions.getX(i) + 0.17) > 0.12 && positions.getY(i) < -0.4 && positions.getZ(i) > 0.1) {
        expect(displacement(i).y).toBeCloseTo(12, 4);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }
});

it('keeps at least one foot planted throughout the cycle, with no negative clearance', () => {
  const gait = new SoftGait(mesh);
  for (let distance = 0; distance <= 72; distance += 0.3) {
    gait.set(distance, 1);
    const heights = feet.map(index => displacement(index).y);
    expect(Math.min(...heights)).toBeCloseTo(0, 5);
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...heights)).toBeLessThanOrEqual(12.0001);
  }
});

it('cancels root travel during each foot stance so planted soles do not slide', () => {
  const gait = new SoftGait(mesh);
  for (const [foot, start] of [[0, 1], [1, 19]]) {
    gait.set(start, 1);
    const initialWorldZ = displacement(feet[foot]).z + start;
    for (let travel = 0.5; travel < 16; travel += 0.5) {
      gait.set(start + travel, 1);
      expect(displacement(feet[foot]).z + start + travel).toBeCloseTo(initialWorldZ, 4);
      expect(displacement(feet[foot]).y).toBe(0);
    }
  }
});

it('does not deform the head or rear tail when the feet move', () => {
  const gait = new SoftGait(mesh);
  gait.set(24, 1);
  let checked = 0;
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) > 0 || positions.getZ(i) < -0.2) {
      expect(displacement(i).length()).toBeCloseTo(0, 7);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(1000);
});

it('appends compatible relative morphs while preserving head pose and supplied colors', () => {
  const colors = mesh.geometry.getAttribute('color');
  const originalColors = Array.from(colors.array);
  const head = new SoftHead(mesh);
  head.set(0.15, 0.1);
  const priorWeights = [...mesh.morphTargetInfluences];
  const headIndex = Array.from({ length: positions.count }, (_, i) => i).find(i => positions.getY(i) > 0.7);
  const before = mesh.getVertexPosition(headIndex, new THREE.Vector3());
  const relative = mesh.geometry.morphTargetsRelative;
  const gait = new SoftGait(mesh);
  gait.set(9, 1);
  expect(mesh.geometry.morphTargetsRelative).toBe(relative);
  expect(mesh.morphTargetInfluences.slice(0, priorWeights.length)).toEqual(priorWeights);
  expect(mesh.getVertexPosition(headIndex, new THREE.Vector3()).distanceTo(before)).toBeCloseTo(0, 7);
  expect(displacement(feet[1]).y).toBeCloseTo(12, 4);
  expect(Array.from(colors.array)).toEqual(originalColors);
  expect(mesh.geometry.morphAttributes.normal.length).toBe(mesh.geometry.morphAttributes.position.length);
  head.set(0, 0);
  gait.set(9, 0);
  expect(mesh.morphTargetInfluences.every(weight => weight === 0)).toBe(true);
});

it('is continuous at touchdown, handles invalid input, and returns exactly to rest', () => {
  const gait = new SoftGait(mesh);
  for (const contact of [0, 18, 36]) {
    gait.set(contact - 0.001, 1);
    const before = feet.map(index => displacement(index));
    gait.set(contact + 0.001, 1);
    feet.forEach((index, foot) => expect(displacement(index).distanceTo(before[foot])).toBeLessThan(0.003));
  }
  for (const strength of [0, -1, NaN]) {
    gait.set(9, strength);
    feet.forEach(index => expect(displacement(index).length()).toBe(0));
  }
  gait.set(NaN, 1);
  expect(mesh.morphTargetInfluences.every(Number.isFinite)).toBe(true);
});
