import * as THREE from 'three';

/** Rigid head rotation, with blending confined to the neck.
 * The nine relative targets are the components of (R - I) * (point - pivot).
 * Unlike interpolating several bent head shapes, this preserves facial distances
 * exactly wherever the head weight is 1, including at intermediate angles.
 */
export class SoftHead {
  private readonly rotation = new THREE.Matrix4();
  private readonly parentRotation = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly firstTarget: number;

  constructor(private readonly mesh: THREE.Mesh) {
    const geometry = mesh.geometry;
    const prepared = geometry.morphAttributes.position?.findIndex(target => target.name === 'headRotation00') ?? -1;
    if (prepared >= 0) {
      this.firstTarget = prepared;
      if (!mesh.morphTargetInfluences) mesh.updateMorphTargets();
      return;
    }
    const positions = geometry.getAttribute('position');
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const sourceNormals = geometry.getAttribute('normal');
    const bounds = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute);
    const height = bounds.max.y - bounds.min.y;
    const headBounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      if (point.y >= bounds.min.y + height * 0.6) headBounds.expandByPoint(point);
    }
    const pivot = headBounds.isEmpty() ? bounds.getCenter(new THREE.Vector3()) : headBounds.getCenter(new THREE.Vector3());
    pivot.y = bounds.min.y + height * 0.54;
    const morphs = geometry.morphAttributes.position ?? [];
    const normals = geometry.morphAttributes.normal ?? [];
    this.firstTarget = morphs.length;
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        const target = new Float32Array(positions.count * 3);
        const targetNormals = new Float32Array(positions.count * 3);
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i);
          const weight = THREE.MathUtils.smoothstep((point.y - bounds.min.y) / height, 0.46, 0.6);
          target[i * 3 + row] = (point.getComponent(column) - pivot.getComponent(column)) * weight;
          targetNormals[i * 3 + row] = sourceNormals.getComponent(i, column) * weight;
        }
        const attribute = new THREE.Float32BufferAttribute(target, 3);
        attribute.name = `headRotation${row}${column}`;
        morphs.push(attribute);
        normals.push(new THREE.Float32BufferAttribute(targetNormals, 3));
      }
    }
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = morphs;
    geometry.morphAttributes.normal = normals;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.updateMorphTargets();
  }

  set(tilt: number, bow: number, parentPitch = 0): void {
    this.euler.set(THREE.MathUtils.clamp(bow, -0.25, 0.25), 0, THREE.MathUtils.clamp(tilt, -0.25, 0.25));
    this.rotation.makeRotationFromEuler(this.euler);
    // SoftJump already contributes the torso rotation. Rotate only this head
    // delta by it, so the two morph layers compose as Rtorso * Rhead rather
    // than adding rotations and subtly changing the shape of the face.
    this.rotation.elements[0]! -= 1;
    this.rotation.elements[5]! -= 1;
    this.rotation.elements[10]! -= 1;
    this.parentRotation.makeRotationX(Number.isFinite(parentPitch) ? parentPitch : 0);
    this.rotation.premultiply(this.parentRotation);
    const weights = this.mesh.morphTargetInfluences!;
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        weights[this.firstTarget + row * 3 + column] = this.rotation.elements[column * 4 + row]!;
      }
    }
  }
}
