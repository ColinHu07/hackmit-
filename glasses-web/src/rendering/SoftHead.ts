import * as THREE from 'three';

const MAX_ANGLE = 0.3;

/** Gentle upper-body bends for the supplied upright, unrigged mesh.
 * Generated once, then blended on the GPU; the original GLB stays untouched.
 * Never add these to a skinned or artist-authored morph-target mesh.
 */
export class SoftHead {
  constructor(private readonly mesh: THREE.Mesh) {
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const height = bounds.max.y - bounds.min.y;
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerZ = (bounds.min.z + bounds.max.z) / 2;
    const pivotY = bounds.min.y + height * 0.53;
    const positions = geometry.getAttribute('position');
    const morphs: THREE.BufferAttribute[] = [];
    const normals: THREE.BufferAttribute[] = [];
    for (const [name, axis, angle] of [['nuzzleLeft', 'z', MAX_ANGLE], ['nuzzleRight', 'z', -MAX_ANGLE], ['nibble', 'x', MAX_ANGLE]] as const) {
      const target = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const t = THREE.MathUtils.clamp((y - (bounds.min.y + height * 0.45)) / (height * 0.3), 0, 1);
        const radians = angle * t * t * (3 - 2 * t);
        const c = Math.cos(radians), s = Math.sin(radians);
        const dy = y - pivotY;
        target[i * 3] = axis === 'z' ? centerX + (x - centerX) * c - dy * s : x;
        target[i * 3 + 1] = pivotY + dy * c + (axis === 'z' ? (x - centerX) * s : -(z - centerZ) * s);
        target[i * 3 + 2] = axis === 'x' ? centerZ + dy * s + (z - centerZ) * c : z;
      }
      const attribute = new THREE.Float32BufferAttribute(target, 3);
      attribute.name = name;
      morphs.push(attribute);
      const temporary = new THREE.BufferGeometry();
      temporary.setIndex(geometry.index);
      temporary.setAttribute('position', attribute);
      temporary.computeVertexNormals();
      normals.push(temporary.getAttribute('normal') as THREE.BufferAttribute);
      temporary.dispose();
    }
    geometry.morphTargetsRelative = false;
    geometry.morphAttributes.position = morphs;
    geometry.morphAttributes.normal = normals;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.updateMorphTargets();
  }

  set(tilt: number, bow: number): void {
    const weights = this.mesh.morphTargetInfluences!;
    // Sum <= 1 keeps combined head bends within the generated shape envelope.
    const tiltWeight = THREE.MathUtils.clamp(tilt / MAX_ANGLE, -1, 1);
    const bowWeight = THREE.MathUtils.clamp(bow / MAX_ANGLE, 0, 1);
    const total = Math.max(1, Math.abs(tiltWeight) + bowWeight);
    weights[0] = Math.max(0, tiltWeight) / total;
    weights[1] = Math.max(0, -tiltWeight) / total;
    weights[2] = bowWeight / total;
  }
}
