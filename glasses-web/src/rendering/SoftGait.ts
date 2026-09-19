import * as THREE from 'three';

// The renderer normalizes the supplied model to a maximum extent of 142 units.
const CHARACTER_EXTENT = 142;
const STRIDE_DISTANCE = 36;
const FOOT_LIFT = 12;

/** Alternating planted steps for Nova's upright, unrigged mesh. */
export class SoftGait {
  private readonly firstTarget: number;

  constructor(private readonly mesh: THREE.Mesh) {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    // Read the undeformed positions: head morph bounds include rotated poses.
    const bounds = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute);
    const size = bounds.getSize(new THREE.Vector3());
    const localUnit = Math.max(size.x, size.y, size.z) / CHARACTER_EXTENT;
    const soleBounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      if (point.y < bounds.min.y + size.y * 0.08 && point.z > bounds.min.z + size.z * 0.65) {
        soleBounds.expandByPoint(point);
      }
    }
    // The asymmetrical tail shifts the full mesh's center away from the feet.
    const centerX = soleBounds.isEmpty()
      ? (bounds.min.x + bounds.max.x) / 2
      : (soleBounds.min.x + soleBounds.max.x) / 2;
    const morphs = geometry.morphAttributes.position ?? [];
    const normals = geometry.morphAttributes.normal ?? [];
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const baseNormals = geometry.getAttribute('normal');
    const relative = geometry.morphTargetsRelative;
    this.firstTarget = morphs.length;

    for (const side of [-1, 1]) {
      for (const [name, dz, dy] of [
        ['Forward', STRIDE_DISTANCE / 4 * localUnit, 0],
        ['Back', -STRIDE_DISTANCE / 4 * localUnit, 0],
        ['Lift', 0, FOOT_LIFT * localUnit],
      ] as const) {
        const target = new Float32Array(positions.count * 3);
        const posed = new Float32Array(positions.count * 3);
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
          // Soles translate intact; deformation blends into the upper legs.
          const lower = 1 - THREE.MathUtils.smoothstep((y - bounds.min.y) / size.y, 0.08, 0.27);
          const lateral = THREE.MathUtils.smoothstep(side * (x - centerX) / size.x, 0, 0.06);
          const front = THREE.MathUtils.smoothstep((z - bounds.min.z) / size.z, 0.45, 0.63);
          const weight = lower * lateral * front;
          posed[i * 3] = x;
          posed[i * 3 + 1] = y + dy * weight;
          posed[i * 3 + 2] = z + dz * weight;
          target[i * 3] = relative ? 0 : x;
          target[i * 3 + 1] = relative ? dy * weight : posed[i * 3 + 1]!;
          target[i * 3 + 2] = relative ? dz * weight : posed[i * 3 + 2]!;
        }
        const attribute = new THREE.Float32BufferAttribute(target, 3);
        attribute.name = `stride${side < 0 ? 'Left' : 'Right'}${name}`;
        morphs.push(attribute);
        const temporary = new THREE.BufferGeometry();
        temporary.setIndex(geometry.index);
        temporary.setAttribute('position', new THREE.Float32BufferAttribute(posed, 3));
        temporary.computeVertexNormals();
        const targetNormals = temporary.getAttribute('normal');
        if (relative) {
          for (let i = 0; i < targetNormals.count; i++) {
            targetNormals.setXYZ(i,
              targetNormals.getX(i) - baseNormals.getX(i),
              targetNormals.getY(i) - baseNormals.getY(i),
              targetNormals.getZ(i) - baseNormals.getZ(i));
          }
        }
        normals.push(targetNormals);
        temporary.dispose();
      }
    }
    geometry.morphAttributes.position = morphs;
    geometry.morphAttributes.normal = normals;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const existingWeights = [...(mesh.morphTargetInfluences ?? [])];
    mesh.updateMorphTargets();
    existingWeights.forEach((weight, i) => { mesh.morphTargetInfluences![i] = weight; });
  }

  /** Distance is actual ground travel; strength fades the gait into its rest pose. */
  set(distance: number, strength: number): void {
    const weights = this.mesh.morphTargetInfluences!;
    const blend = Number.isFinite(strength) ? THREE.MathUtils.clamp(strength, 0, 1) : 0;
    const cycle = Number.isFinite(distance) ? distance / STRIDE_DISTANCE : 0;
    for (let foot = 0; foot < 2; foot++) {
      const phase = THREE.MathUtils.euclideanModulo(cycle + foot * 0.5, 1);
      let stride: number;
      let lift = 0;
      if (phase < 0.5) {
        // Half of each cycle is stance: a planted foot moves backwards exactly
        // as far as the root moves forwards, instead of skating under the body.
        stride = 1 - phase * 4;
      } else {
        const swing = (phase - 0.5) * 2;
        // Match the stance's horizontal speed at lift-off and touchdown. The
        // raised foot swings forwards in between, clearing the ground in an arch.
        const smooth = swing ** 3 * (10 - 15 * swing + 6 * swing ** 2);
        stride = -1 - 2 * swing + 4 * smooth;
        lift = Math.sin(Math.PI * swing) ** 2;
      }
      const target = this.firstTarget + foot * 3;
      weights[target] = Math.max(0, stride) * blend;
      weights[target + 1] = Math.max(0, -stride) * blend;
      weights[target + 2] = lift * blend;
    }
  }
}
