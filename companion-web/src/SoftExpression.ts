import * as THREE from 'three';

/** A gentle worried expression on Nova's own face, keeping her teeth and tail. */
export class SoftExpression {
  private readonly firstTarget: number;
  private readonly rotation = new THREE.Matrix4();
  private readonly parentRotation = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();

  constructor(private readonly mesh: THREE.Mesh) {
    const geometry = mesh.geometry;
    const prepared = geometry.morphAttributes.position?.findIndex(target => target.name === 'sadExpression0') ?? -1;
    if (prepared >= 0) {
      this.firstTarget = prepared;
      if (!mesh.morphTargetInfluences) mesh.updateMorphTargets();
      return;
    }
    const positions = geometry.getAttribute('position');
    const morphs = geometry.morphAttributes.position!;
    const normals = geometry.morphAttributes.normal!;
    this.firstTarget = morphs.length;
    // Nova's anatomical midline is offset by her broad tail in the source scan.
    const offsets = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const side = Math.abs(x + 0.215);
      const front = THREE.MathUtils.smoothstep(z, 0.36, 0.46);
      const eyes = Math.exp(-(((y - 0.65) / 0.085) ** 2))
        * Math.exp(-(((side - 0.155) / 0.12) ** 2));
      // Raise the inner eyes and lower the outer corners into a worried look.
      const brow = THREE.MathUtils.clamp((0.15 - side) * 0.45, -0.035, 0.035) * eyes;
      const mouth = -0.025 * Math.exp(-(((y - 0.43) / 0.055) ** 2))
        * Math.exp(-(((side - 0.13) / 0.055) ** 2));
      offsets[i] = front * (brow + mouth);
    }
    // Three bases rotate the expression with the head and jumping torso.
    for (let axis = 0; axis < 3; axis++) {
      const values = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) values[i * 3 + axis] = offsets[i]!;
      const target = new THREE.Float32BufferAttribute(values, 3);
      target.name = `sadExpression${axis}`;
      morphs.push(target);
      normals.push(new THREE.Float32BufferAttribute(new Float32Array(values.length), 3));
    }
    const previous = [...mesh.morphTargetInfluences!];
    mesh.updateMorphTargets();
    previous.forEach((weight, i) => { mesh.morphTargetInfluences![i] = weight; });
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  set(sadness: number, tilt: number, bow: number, parentPitch = 0): void {
    const amount = Number.isFinite(sadness) ? THREE.MathUtils.clamp(sadness, 0, 1) : 0;
    this.euler.set(THREE.MathUtils.clamp(bow, -0.25, 0.25), 0, THREE.MathUtils.clamp(tilt, -0.25, 0.25));
    this.rotation.makeRotationFromEuler(this.euler);
    this.parentRotation.makeRotationX(parentPitch);
    this.rotation.premultiply(this.parentRotation);
    for (let axis = 0; axis < 3; axis++) {
      this.mesh.morphTargetInfluences![this.firstTarget + axis] = amount * this.rotation.elements[4 + axis]!;
    }
  }
}
