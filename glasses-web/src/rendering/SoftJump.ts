import * as THREE from 'three';

const CHARACTER_EXTENT = 142;
const CROUCH_DEPTH = 6;
const CROUCH_LEAN = 0.08;
const TUCK_LIFT = 11;
const TUCK_BACK = 8;
const TUCK_ANGLE = 0.28;

/** A small two-bone leg rig expressed as morph bases for the unrigged model.
 * Rotation bases use sin(angle) and cos(angle) - 1, rather than blending a
 * compressed pose. The face/torso and soles therefore retain their shape.
 */
export class SoftJump {
  /** Parent X rotation used to compose the separate rigid head rig. */
  torsoPitch = 0;
  private readonly firstTarget: number;
  private readonly localUnit: number;
  private readonly ankle: THREE.Vector2;
  private readonly knee: THREE.Vector2;
  private readonly hip: THREE.Vector2;
  private readonly shinLength: number;
  private readonly thighLength: number;
  private readonly shinAngle: number;
  private readonly thighAngle: number;
  private readonly normalTargets: number;

  constructor(private readonly mesh: THREE.Mesh) {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const baseNormals = geometry.getAttribute('normal');
    const bounds = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute);
    const size = bounds.getSize(new THREE.Vector3());
    this.localUnit = Math.max(size.x, size.y, size.z) / CHARACTER_EXTENT;
    // The source faces +Z. These sagittal joints are shared by its two short
    // hindlegs, so both feet can brace against the floor during anticipation.
    this.ankle = new THREE.Vector2(bounds.min.y + size.y * 0.07, bounds.min.z + size.z * 0.75);
    this.knee = new THREE.Vector2(bounds.min.y + size.y * 0.19, bounds.min.z + size.z * 0.82);
    this.hip = new THREE.Vector2(bounds.min.y + size.y * 0.34, bounds.min.z + size.z * 0.66);
    this.shinLength = this.ankle.distanceTo(this.knee);
    this.thighLength = this.knee.distanceTo(this.hip);
    this.shinAngle = Math.atan2(this.knee.y - this.ankle.y, this.knee.x - this.ankle.x);
    this.thighAngle = Math.atan2(this.knee.y - this.hip.y, this.knee.x - this.hip.x);

    const morphs = geometry.morphAttributes.position ?? [];
    const prepared = morphs.findIndex(target => target.name === 'jumpShinSin');
    const preparedNormals = morphs.findIndex(target => target.name === `jumpCrouchNormals${1 / 3}`);
    if (prepared >= 0 && preparedNormals >= 0) {
      this.firstTarget = prepared;
      this.normalTargets = preparedNormals;
      if (!mesh.morphTargetInfluences) mesh.updateMorphTargets();
      return;
    }
    const basePositions = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      basePositions[i * 3] = positions.getX(i);
      basePositions[i * 3 + 1] = positions.getY(i);
      basePositions[i * 3 + 2] = positions.getZ(i);
    }
    const normals = geometry.morphAttributes.normal ?? [];
    const relative = geometry.morphTargetsRelative;
    this.firstTarget = morphs.length;
    // Imported position-only morphs still require aligned normal slots once
    // this rig adds normals. Their neutral normal is the original surface.
    while (normals.length < morphs.length) {
      normals.push(relative
        ? new THREE.Float32BufferAttribute(new Float32Array(positions.count * 3), 3)
        : new THREE.Float32BufferAttribute(new Float32Array(baseNormals.array), 3));
    }

    const tailWeight = (x: number, z: number) =>
      THREE.MathUtils.smoothstep(x, 0, 0.13) * (1 - THREE.MathUtils.smoothstep(z, -0.38, -0.2));
    const legWeights = (x: number, y: number, z: number) => {
      const h = (y - bounds.min.y) / size.y;
      const ankleBlend = THREE.MathUtils.smoothstep(h, 0.07, 0.16);
      const kneeBlend = THREE.MathUtils.smoothstep(h, 0.12, 0.3);
      const hipBlend = THREE.MathUtils.smoothstep(h, 0.22, 0.42);
      // Keep the knee hinge out of the belly and tail. A broad pelvis blend
      // lets the abdomen settle between the two independently braced haunches.
      const leg = THREE.MathUtils.smoothstep(Math.abs(x + 0.17), 0.14, 0.27)
        * THREE.MathUtils.smoothstep(z, -0.2, 0.05);
      const body = 1 - tailWeight(x, z);
      return [
        body * leg * ankleBlend * (1 - kneeBlend),
        body * leg * kneeBlend * (1 - hipBlend),
        body * (leg * hipBlend + (1 - leg) * THREE.MathUtils.smoothstep(h, 0.07, 0.42)),
      ];
    };
    const tuckWeight = (y: number, z: number) =>
      (1 - THREE.MathUtils.smoothstep((y - bounds.min.y) / size.y, 0.1, 0.31))
      * THREE.MathUtils.smoothstep((z - bounds.min.z) / size.z, 0.45, 0.65);

    const append = (name: string, delta: (x: number, y: number, z: number) => number[]) => {
      const target = new Float32Array(positions.count * 3);
      const normal = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) {
        const [dy, dz] = delta(positions.getX(i), positions.getY(i), positions.getZ(i));
        target[i * 3] = relative ? 0 : positions.getX(i);
        target[i * 3 + 1] = (relative ? 0 : positions.getY(i)) + dy!;
        target[i * 3 + 2] = (relative ? 0 : positions.getZ(i)) + dz!;
        normal[i * 3] = relative ? 0 : baseNormals.getX(i);
        normal[i * 3 + 1] = relative ? 0 : baseNormals.getY(i);
        normal[i * 3 + 2] = relative ? 0 : baseNormals.getZ(i);
      }
      const attribute = new THREE.Float32BufferAttribute(target, 3);
      attribute.name = name;
      morphs.push(attribute);
      normals.push(new THREE.Float32BufferAttribute(normal, 3));
    };
    const rotate = (name: string, pivot: THREE.Vector2, weight: (x: number, y: number, z: number) => number) => {
      append(`${name}Sin`, (x, y, z) => {
        const w = weight(x, y, z);
        return [-(z - pivot.y) * w, (y - pivot.x) * w];
      });
      append(`${name}Cos`, (x, y, z) => {
        const w = weight(x, y, z);
        return [(y - pivot.x) * w, (z - pivot.y) * w];
      });
    };
    rotate('jumpShin', this.ankle, (x, y, z) => legWeights(x, y, z)[0]!);
    rotate('jumpThigh', this.hip, (x, y, z) => legWeights(x, y, z)[1]!);
    rotate('jumpTorso', this.hip, (x, y, z) => legWeights(x, y, z)[2]!);
    append('jumpHipLower', (x, y, z) => {
      const [, thigh, torso] = legWeights(x, y, z);
      return [-CROUCH_DEPTH * this.localUnit * (thigh! + torso!), 0, 0, 0];
    });
    rotate('jumpFootFold', this.ankle, (_x, y, z) => tuckWeight(y, z));
    append('jumpFootLift', (_x, y, z) => [TUCK_LIFT * this.localUnit * tuckWeight(y, z), 0]);
    append('jumpFootBack', (_x, y, z) => [0, -TUCK_BACK * this.localUnit * tuckWeight(y, z)]);
    rotate('jumpTail', new THREE.Vector2(bounds.min.y + size.y * 0.045, -0.34), (x, _y, z) => tailWeight(x, z));

    geometry.morphAttributes.position = morphs;
    geometry.morphAttributes.normal = normals;
    this.normalTargets = morphs.length;
    const existingWeights = [...(mesh.morphTargetInfluences ?? [])];
    mesh.updateMorphTargets();
    // Skinning normals alone omit derivatives of the smooth joint masks and
    // produce visible stripes. Bake the actual deformed surface normals once;
    // lightweight normal-only targets interpolate them during the animation.
    for (let phase = 0; phase < 2; phase++) {
      for (const amount of [1 / 3, 2 / 3, 1]) {
        this.set(phase === 0 ? amount : 0, phase === 1 ? amount : 0);
        const posed = new Float32Array(basePositions);
        for (let target = this.firstTarget; target < this.normalTargets; target++) {
          const weight = mesh.morphTargetInfluences![target]!;
          if (!weight) continue;
          for (let i = 0; i < positions.count; i++) {
            for (let axis = 0; axis < 3; axis++) {
              posed[i * 3 + axis]! += weight * (morphs[target]!.getComponent(i, axis)
                - (relative ? 0 : positions.getComponent(i, axis)));
            }
          }
        }
        const surface = new THREE.BufferGeometry();
        surface.setIndex(geometry.index);
        surface.setAttribute('position', new THREE.Float32BufferAttribute(posed, 3));
        surface.computeVertexNormals();
        const sampledNormals = surface.getAttribute('normal');
        if (relative) {
          for (let i = 0; i < positions.count; i++) {
            sampledNormals.setXYZ(i,
              sampledNormals.getX(i) - baseNormals.getX(i),
              sampledNormals.getY(i) - baseNormals.getY(i),
              sampledNormals.getZ(i) - baseNormals.getZ(i));
          }
        }
        const neutral = relative
          ? new THREE.Float32BufferAttribute(new Float32Array(positions.count * 3), 3)
          : new THREE.Float32BufferAttribute(new Float32Array(basePositions), 3);
        neutral.name = `jump${phase === 0 ? 'Crouch' : 'Tuck'}Normals${amount}`;
        morphs.push(neutral);
        normals.push(sampledNormals);
        surface.dispose();
      }
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    // Signed rotation bases can extend in either direction. Keep a conservative
    // envelope as well as the bounds Three computes for individual targets.
    geometry.boundingBox!.union(bounds.clone().expandByScalar(32 * this.localUnit));
    geometry.boundingBox!.getBoundingSphere(geometry.boundingSphere!);
    mesh.updateMorphTargets();
    this.set(0, 0);
    existingWeights.forEach((weight, i) => { mesh.morphTargetInfluences![i] = weight; });
  }

  set(crouch: number, tuck: number): void {
    const bend = Number.isFinite(crouch) ? THREE.MathUtils.clamp(crouch, 0, 1) : 0;
    const fold = Number.isFinite(tuck) ? THREE.MathUtils.clamp(tuck, 0, 1) : 0;
    this.torsoPitch = CROUCH_LEAN * bend;
    const weights = this.mesh.morphTargetInfluences!;
    // Solve the forward-bending knee as the intersection of fixed-length shin
    // and thigh circles. The ankle stays put while the hip lowers.
    const hipY = this.hip.x - CROUCH_DEPTH * this.localUnit * bend;
    const dy = hipY - this.ankle.x;
    const dz = this.hip.y - this.ankle.y;
    const distance = Math.hypot(dy, dz);
    const along = (this.shinLength ** 2 - this.thighLength ** 2 + distance ** 2) / (2 * distance);
    const across = Math.sqrt(Math.max(0, this.shinLength ** 2 - along ** 2));
    const kneeY = this.ankle.x + along * dy / distance - across * dz / distance;
    const kneeZ = this.ankle.y + along * dz / distance + across * dy / distance;
    const shin = bend === 0 ? 0 : Math.atan2(kneeZ - this.ankle.y, kneeY - this.ankle.x) - this.shinAngle;
    const thigh = bend === 0 ? 0 : Math.atan2(kneeZ - this.hip.y, kneeY - hipY) - this.thighAngle;
    const setRotation = (offset: number, angle: number) => {
      weights[this.firstTarget + offset] = Math.sin(angle);
      weights[this.firstTarget + offset + 1] = Math.cos(angle) - 1;
    };
    setRotation(0, shin);
    setRotation(2, thigh);
    setRotation(4, this.torsoPitch);
    weights[this.firstTarget + 6] = bend;
    setRotation(7, TUCK_ANGLE * fold);
    weights[this.firstTarget + 9] = fold;
    weights[this.firstTarget + 10] = fold;
    setRotation(11, 0.1 * bend);
    for (let phase = 0; phase < 2; phase++) {
      const amount = (phase === 0 ? bend : fold) * 3;
      for (let sample = 1; sample <= 3; sample++) {
        weights[this.normalTargets + phase * 3 + sample - 1] = Math.max(0, 1 - Math.abs(amount - sample));
      }
    }
  }
}
