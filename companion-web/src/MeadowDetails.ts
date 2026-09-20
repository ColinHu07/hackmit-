import * as THREE from 'three';

/** Seeded little habitats, shared across devices. Instancing keeps the whole
 * meadow to a handful of draw calls rather than a mesh per flower petal. */
export function meadowDetails(): { plants: THREE.Group; flowers: THREE.Group } {
  const plants = new THREE.Group(), flowers = new THREE.Group();
  let seed = 7419;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const transform = new THREE.Object3D();
  type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number; color: number };
  const petals: Item[] = [], centers: Item[] = [], stems: Item[] = [], grasses: Item[] = [], rocks: Item[] = [], caps: Item[] = [], bushes: Item[] = [];
  const add = (list: Item[], x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, yaw = random() * Math.PI * 2) => list.push({ x, y, z, sx, sy, sz, yaw, color });
  const palette = [0xffd677, 0xf5a8bc, 0xc3a8ea, 0xfff2d1, 0xea927f];
  const patches = [[-1.8, -1.5], [1.8, -1.9], [2.6, 1.1], [-2.4, 2.2], [0.2, 3.8], [-3.8, -3.7], [4.5, -3], [-5, 0.3], [5.7, 2.5], [-4.2, 5.2], [3, 5.4], [0, -5.2], [-7, -6], [7, -5], [-7, 6], [7, 7]];
  for (let patch = 0; patch < patches.length; patch++) {
    const [cx, cz] = patches[patch]!;
    for (let i = 0; i < 14; i++) {
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 0.85;
      const x = cx! + Math.cos(angle) * radius, z = cz! + Math.sin(angle) * radius;
      const height = 0.16 + random() * 0.19, size = 0.8 + random() * 0.6;
      add(stems, x, height / 2, z, 0.012, height, 0.012, 0x67864b);
      add(centers, x, height + 0.018, z, 0.037 * size, 0.025, 0.037 * size, 0xe5ad42);
      const color = palette[(patch + (i % 5 === 0 ? 1 : 0)) % palette.length]!;
      for (let p = 0; p < 5; p++) {
        const a = p * Math.PI * 2 / 5;
        add(petals, x + Math.cos(a) * 0.065 * size, height, z + Math.sin(a) * 0.065 * size, 0.055 * size, 0.022, 0.04 * size, color, -a);
      }
    }
  }
  // Loose grass clumps and low shrubs replace the old square perimeter.
  for (let i = 0; i < 280; i++) {
    const x = (random() - 0.5) * 19, z = (random() - 0.5) * 19;
    if (Math.hypot(x, z) < 0.9) continue;
    for (let blade = 0; blade < 3; blade++) {
      const height = 0.12 + random() * 0.22;
      add(grasses, x + (blade - 1) * 0.06, height / 2, z + random() * 0.08, 0.045, height, 0.035, i % 2 ? 0x769651 : 0x547e49);
    }
    if (i % 9 === 0) {
      const size = 0.12 + random() * 0.2;
      add(rocks, x, size * 0.3, z, size, size * 0.55, size * 0.8, i % 2 ? 0xa4ac8b : 0xd7cfb3);
    }
    if (i % 15 === 0) {
      add(stems, x + 0.16, 0.07, z, 0.028, 0.14, 0.028, 0xf2dfb8);
      add(caps, x + 0.16, 0.15, z, 0.11, 0.06, 0.11, i % 2 ? 0xce785d : 0xc5a171);
    }
    if (i % 20 === 0 && Math.hypot(x, z) > 3.5) {
      for (let b = 0; b < 3; b++) add(bushes, x + b * 0.18, 0.12, z + b * 0.1, 0.3, 0.24 + random() * 0.15, 0.3, b % 2 ? 0x71974f : 0x86a765);
    }
  }
  const batch = (items: Item[], geometry: THREE.BufferGeometry, parent: THREE.Group) => {
    const material = new THREE.MeshStandardMaterial({ roughness: 1 });
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((item, i) => {
      transform.position.set(item.x, item.y, item.z);
      transform.rotation.set(0, item.yaw, 0);
      transform.scale.set(item.sx, item.sy, item.sz); transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix); mesh.setColorAt(i, new THREE.Color(item.color));
    });
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
  };
  const rounded = new THREE.SphereGeometry(1, 7, 5);
  batch(petals, rounded, flowers); batch(centers, rounded, flowers);
  batch(stems, new THREE.CylinderGeometry(1, 1, 1, 5), plants);
  batch(grasses, new THREE.ConeGeometry(1, 1, 3), plants);
  batch(rocks, new THREE.DodecahedronGeometry(1), plants);
  batch(caps, rounded, plants); batch(bushes, new THREE.IcosahedronGeometry(1, 1), plants);
  return { plants, flowers };
}
