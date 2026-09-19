import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let character;

beforeAll(async () => {
  const bytes = readFileSync(new URL('../../public/models/nova.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
  );
  gltf.scene.traverse(object => {
    if (object instanceof THREE.Mesh) character = object;
  });
});

afterAll(() => {
  character?.geometry.dispose();
  for (const material of character ? [character.material].flat() : []) material.dispose();
});

it('retains painted pupils, eye whites, and small catchlights on both eyes', () => {
  const positions = character.geometry.getAttribute('position');
  const colors = character.geometry.getAttribute('color');
  const eyes = [
    { pupil: 0, white: 0, catchlight: 0 },
    { pupil: 0, white: 0, catchlight: 0 },
  ];
  for (let i = 0; i < positions.count; i++) {
    // Bounds isolate the supplied asset's two eyes from the muzzle and teeth.
    if (positions.getY(i) < 0.5 || positions.getZ(i) < 0.3) continue;
    const eye = eyes[positions.getX(i) < -0.25 ? 0 : 1];
    const r = colors.getX(i), g = colors.getY(i), b = colors.getZ(i);
    if (Math.max(r, g, b) < 0.035) eye.pupil++;
    if (r > 0.55 && g > 0.55 && b > 0.35) eye.white++;
    if (Math.min(r, g, b) > 0.8) eye.catchlight++;
  }
  for (const eye of eyes) {
    // Conservative detail floors, not exact vertex counts: position-only
    // simplification previously left ~15 pupil vertices and lost catchlights.
    expect(eye.pupil).toBeGreaterThanOrEqual(40);
    expect(eye.white).toBeGreaterThanOrEqual(200);
    expect(eye.catchlight).toBeGreaterThanOrEqual(8);
  }
});

it('has an opaque, closed surface without missing or reversed triangle edges', () => {
  const geometry = character.geometry;
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  const indices = geometry.getIndex();
  const edges = new Map();
  let degenerateTriangles = 0;
  for (let i = 0; i < indices.count; i += 3) {
    const triangle = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    if (new Set(triangle).size !== 3) degenerateTriangles++;
    for (let corner = 0; corner < 3; corner++) {
      const a = triangle[corner], b = triangle[(corner + 1) % 3];
      const key = Math.min(a, b) * positions.count + Math.max(a, b);
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++;
      edge.direction += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  const invalidEdges = [...edges.values()].filter(edge => edge.count !== 2 || edge.direction !== 0);
  expect(degenerateTriangles).toBe(0);
  expect(invalidEdges).toHaveLength(0);
  expect(character.material.transparent).toBe(false);
  if (colors.itemSize === 4) {
    const translucentVertices = Array.from({ length: colors.count }, (_, i) => colors.getW(i))
      .filter(alpha => alpha !== 1);
    expect(translucentVertices).toHaveLength(0);
  }
});
