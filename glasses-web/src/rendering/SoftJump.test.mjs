import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SoftJump } from './SoftJump';
import { SoftHead } from './SoftHead';
import { SoftGait } from './SoftGait';

let mesh;
let positions;
let bounds;
let size;
let scale;

beforeEach(async () => {
  const bytes = readFileSync(new URL('../../public/models/nova.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) mesh = object; });
  positions = mesh.geometry.getAttribute('position');
  bounds = new THREE.Box3().setFromBufferAttribute(positions);
  size = bounds.getSize(new THREE.Vector3());
  scale = 142 / Math.max(size.x, size.y, size.z);
});

const rest = i => new THREE.Vector3().fromBufferAttribute(positions, i);
const posed = i => mesh.getVertexPosition(i, new THREE.Vector3());
const displacement = i => posed(i).sub(rest(i)).multiplyScalar(scale);
const indicesWhere = predicate => Array.from({ length: positions.count }, (_, i) => i).filter(i => predicate(rest(i)));

it('bends into a crouch with both soles planted and no rear surface below the floor', () => {
  const jump = new SoftJump(mesh);
  const soles = indicesWhere(p => p.y < bounds.min.y + size.y * 0.065 && p.z > 0.1);
  const hip = indicesWhere(p => p.y > bounds.min.y + size.y * 0.43 && p.y < bounds.min.y + size.y * 0.48 && p.z > 0.12);
  expect(soles.length).toBeGreaterThan(100);
  for (const bend of [0, 0.2, 0.5, 0.8, 1]) {
    jump.set(bend, 0);
    for (const i of soles) expect(displacement(i).length()).toBeCloseTo(0, 5);
    let lowest = Infinity;
    for (let i = 0; i < positions.count; i++) lowest = Math.min(lowest, posed(i).y);
    expect((lowest - bounds.min.y) * scale).toBeGreaterThanOrEqual(-0.001);
  }
  const hipDrop = hip.reduce((sum, i) => sum + displacement(i).y, 0) / hip.length;
  expect(hipDrop).toBeLessThan(-5);
  expect(hipDrop).toBeGreaterThan(-9);
  expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
});

it('preserves face and torso distances at every intermediate crouch amount', () => {
  const jump = new SoftJump(mesh);
  const torso = indicesWhere(p => p.y > bounds.min.y + size.y * 0.43 && p.z > -0.2).filter((_, i) => i % 179 === 0);
  for (const bend of [0.05, 0.35, 0.7, 1]) {
    jump.set(bend, 0);
    for (let n = 1; n < torso.length; n++) {
      const a = torso[n - 1], b = torso[n];
      expect(Math.abs(posed(a).distanceTo(posed(b)) - rest(a).distanceTo(rest(b))) * scale).toBeLessThan(0.0001);
    }
  }
});

it('folds both feet up and back in flight without changing the face or tail', () => {
  const jump = new SoftJump(mesh);
  jump.set(0, 1);
  const soles = indicesWhere(p => p.y < bounds.min.y + size.y * 0.065 && p.z > 0.12);
  for (const i of soles) {
    const delta = displacement(i);
    expect(delta.y).toBeGreaterThan(5);
    expect(delta.y).toBeLessThan(16);
    expect(delta.z).toBeLessThan(-5);
    expect(delta.z).toBeGreaterThan(-14);
  }
  for (const i of indicesWhere(p => p.y > 0 || p.z < -0.2)) {
    expect(displacement(i).length()).toBe(0);
  }
  // A tucked foot is moved as a rigid piece, not scaled into a smaller foot.
  for (let n = 1; n < soles.length; n += 13) {
    const a = soles[n - 1], b = soles[n];
    expect(Math.abs(posed(a).distanceTo(posed(b)) - rest(a).distanceTo(rest(b))) * scale).toBeLessThan(0.0001);
  }
});

it('keeps the rear tail rigid in the crouch and combines safely with a running step', () => {
  const gait = new SoftGait(mesh);
  const jump = new SoftJump(mesh);
  const tail = indicesWhere(p => p.x > 0.13 && p.z < -0.38).filter((_, i) => i % 31 === 0);
  jump.set(1, 0);
  for (let n = 1; n < tail.length; n++) {
    const a = tail[n - 1], b = tail[n];
    expect(Math.abs(posed(a).distanceTo(posed(b)) - rest(a).distanceTo(rest(b))) * scale).toBeLessThan(0.0001);
  }
  for (const step of [0, 9, 18, 27]) {
    gait.set(step, 1);
    let lowest = Infinity;
    for (let i = 0; i < positions.count; i++) lowest = Math.min(lowest, posed(i).y);
    expect((lowest - bounds.min.y) * scale).toBeGreaterThanOrEqual(-0.001);
  }
});

it('uses normals from the bent surface including joint blending gradients', () => {
  const jump = new SoftJump(mesh);
  for (const [crouch, tuck] of [[1, 0], [0, 1]]) {
    jump.set(crouch, tuck);
    const actual = new THREE.BufferGeometry();
    actual.setIndex(mesh.geometry.index);
    const posedPositions = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) posed(i).toArray(posedPositions, i * 3);
    actual.setAttribute('position', new THREE.Float32BufferAttribute(posedPositions, 3));
    actual.computeVertexNormals();
    const expected = actual.getAttribute('normal');
    const base = mesh.geometry.getAttribute('normal');
    for (let i = 0; i < positions.count; i += 13) {
      const normal = new THREE.Vector3().fromBufferAttribute(base, i);
      mesh.geometry.morphAttributes.normal.forEach((target, n) => {
        normal.addScaledVector(new THREE.Vector3().fromBufferAttribute(target, i)
          .sub(new THREE.Vector3().fromBufferAttribute(base, i)), mesh.morphTargetInfluences[n]);
      });
      expect(normal.normalize().dot(new THREE.Vector3().fromBufferAttribute(expected, i))).toBeGreaterThan(0.9999);
    }
    actual.dispose();
  }
});

it('preserves existing relative rigs, composed head shape, and every supplied color', () => {
  const colors = mesh.geometry.getAttribute('color');
  const originalColors = Array.from(colors.array);
  const head = new SoftHead(mesh);
  const gait = new SoftGait(mesh);
  head.set(0.15, 0.1);
  gait.set(9, 0.4);
  const priorWeights = [...mesh.morphTargetInfluences];
  const jump = new SoftJump(mesh);
  expect(mesh.morphTargetInfluences.slice(0, priorWeights.length)).toEqual(priorWeights);
  expect(mesh.geometry.morphTargetsRelative).toBe(true);
  expect(Array.from(colors.array)).toEqual(originalColors);
  expect(mesh.geometry.morphAttributes.normal.length).toBe(mesh.geometry.morphAttributes.position.length);
  const face = indicesWhere(p => p.y > bounds.min.y + size.y * 0.61).filter((_, i) => i % 177 === 0);
  for (const bend of [0.2, 0.6, 1]) {
    jump.set(bend, 0);
    head.set(0.15, 0.1, jump.torsoPitch);
    for (let n = 1; n < face.length; n++) {
      const a = face[n - 1], b = face[n];
      expect(Math.abs(posed(a).distanceTo(posed(b)) - rest(a).distanceTo(rest(b))) * scale).toBeLessThan(0.0001);
    }
  }
  jump.set(0, 0);
  expect(mesh.morphTargetInfluences.slice(9, priorWeights.length)).toEqual(priorWeights.slice(9));
});

it('also supports absolute morph targets without changing their prior influence', () => {
  const existing = positions.clone();
  existing.name = 'existing';
  existing.setXYZ(0, existing.getX(0) + 0.01, existing.getY(0), existing.getZ(0));
  mesh.geometry.morphAttributes.position = [existing];
  mesh.geometry.morphTargetsRelative = false;
  mesh.updateMorphTargets();
  mesh.morphTargetInfluences[0] = 0.4;
  const before = posed(0);
  const jump = new SoftJump(mesh);
  expect(mesh.geometry.morphTargetsRelative).toBe(false);
  expect(mesh.morphTargetInfluences[0]).toBe(0.4);
  jump.set(0, 0);
  expect(posed(0).distanceTo(before)).toBeCloseTo(0, 8);
  jump.set(1, 0);
  const face = indicesWhere(p => p.y > 0.4 && p.x > 0).slice(0, 2);
  expect(Math.abs(posed(face[0]).distanceTo(posed(face[1])) - rest(face[0]).distanceTo(rest(face[1]))) * scale).toBeLessThan(0.0001);
  expect(mesh.geometry.morphAttributes.normal.length).toBe(mesh.geometry.morphAttributes.position.length);
});

it('has finite normal bases, bounds every pose, and returns exactly to rest', () => {
  const jump = new SoftJump(mesh);
  for (const normals of mesh.geometry.morphAttributes.normal) expect(normals.array.every(Number.isFinite)).toBe(true);
  for (const [crouch, tuck] of [[1, 0], [0, 1], [0.5, 0.5]]) {
    jump.set(crouch, tuck);
    for (let i = 0; i < positions.count; i++) expect(mesh.geometry.boundingBox.containsPoint(posed(i))).toBe(true);
  }
  jump.set(NaN, Infinity);
  expect(mesh.morphTargetInfluences.every(weight => weight === 0)).toBe(true);
  jump.set(-1, -1);
  expect(mesh.morphTargetInfluences.every(weight => weight === 0)).toBe(true);
});
