import * as THREE from 'three';

/** Small alternating foot swings for Nova's single, unrigged mesh. */
export class SoftGait {
  private readonly firstTarget: number;
  constructor(private readonly mesh: THREE.Mesh) {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    // Read the undeformed bounds: existing head morphs must not change leg masks.
    const bounds = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute);
    const height = bounds.max.y - bounds.min.y;
    const width = bounds.max.x - bounds.min.x;
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const morphs = geometry.morphAttributes.position ?? [];
    const normals = geometry.morphAttributes.normal ?? [];
    this.firstTarget = morphs.length;
    for (const side of [-1, 1]) {
      for (const direction of [1, -1]) {
        const target = new Float32Array(positions.count * 3);
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
          const lower = 1 - THREE.MathUtils.smoothstep((y - bounds.min.y) / height, 0.08, 0.3);
          const lateral = THREE.MathUtils.smoothstep(side * (x - centerX) / width, 0.025, 0.16);
          const weight = lower * lateral;
          target[i * 3] = x;
          target[i * 3 + 1] = y + (direction > 0 ? height * 0.045 * weight : 0);
          target[i * 3 + 2] = z + direction * height * 0.075 * weight;
        }
        const attribute = new THREE.Float32BufferAttribute(target, 3);
        attribute.name = `stride${side < 0 ? 'Left' : 'Right'}${direction > 0 ? 'Forward' : 'Back'}`;
        morphs.push(attribute);
        const temporary = new THREE.BufferGeometry();
        temporary.setIndex(geometry.index);
        temporary.setAttribute('position', attribute);
        temporary.computeVertexNormals();
        normals.push(temporary.getAttribute('normal'));
        temporary.dispose();
      }
    }
    geometry.morphAttributes.position = morphs;
    geometry.morphAttributes.normal = normals;
    geometry.morphTargetsRelative = false;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.updateMorphTargets();
  }

  set(distance: number, strength: number): void {
    const weights = this.mesh.morphTargetInfluences!;
    const swing = Math.sin(distance / 46 * Math.PI * 2) * THREE.MathUtils.clamp(strength, 0, 1);
    weights[this.firstTarget] = Math.max(0, swing);
    weights[this.firstTarget + 1] = Math.max(0, -swing);
    weights[this.firstTarget + 2] = Math.max(0, -swing);
    weights[this.firstTarget + 3] = Math.max(0, swing);
  }
}
