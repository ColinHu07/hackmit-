import * as THREE from 'three';

/** Forepaw hinges for Nova's unrigged mesh, independent of the head and hind legs. */
export class SoftPaws {
  private readonly start: number;
  constructor(private readonly mesh: THREE.Mesh) {
    const geometry = mesh.geometry;
    const prepared = geometry.morphAttributes.position?.findIndex(target => target.name === 'pawwave1') ?? -1;
    if (prepared >= 0) {
      this.start = prepared;
      if (!mesh.morphTargetInfluences) mesh.updateMorphTargets();
      return;
    }
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const bounds = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute);
    const height = bounds.max.y - bounds.min.y;
    const targets = geometry.morphAttributes.position!;
    const normalTargets = geometry.morphAttributes.normal!;
    this.start = targets.length;
    // Nova's tail offsets the bounding-box center. Use the anatomical midline.
    const center = -0.215;
    for (const phase of ['wave', 'hold'] as const) {
      const samples = phase === 'wave' ? 5 : 3;
      for (let sample = 1; sample <= samples; sample++) {
        const angle = phase === 'wave' ? sample * Math.PI / 6 : -sample / 3 * 1.4;
        const delta = new Float32Array(positions.count * 3);
        const posed = new Float32Array(positions.count * 3);
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
          const h = (y - bounds.min.y) / height;
          const side = x > center ? 1 : -1;
          const weight = (phase === 'wave' && side < 0 ? 0 : 1)
            * THREE.MathUtils.smoothstep(side * (x - center), 0.015, 0.055)
            * THREE.MathUtils.smoothstep(y, -0.17, -0.14)
            * (1 - THREE.MathUtils.smoothstep(h, 0.37, 0.49))
            * THREE.MathUtils.smoothstep(z, side > 0 ? 0.38 : 0.34, side > 0 ? 0.425 : 0.38);
          const px = center + side * 0.2, py = bounds.min.y + height * 0.46, pz = 0.36;
          // Rotate through the blend instead of linearly pulling the elbow
          // between endpoints; that preserves volume around the bending joint.
          const sin = Math.sin(angle * weight), cos = Math.cos(angle * weight) - 1;
          const dx = phase === 'wave' ? cos * (x - px) - sin * (y - py) : 0;
          const dy = phase === 'wave' ? sin * (x - px) + cos * (y - py) : cos * (y - py) - sin * (z - pz);
          const dz = phase === 'wave' ? 0 : sin * (y - py) + cos * (z - pz);
          delta.set([dx, dy, dz], i * 3);
          posed.set([x + dx, y + dy, z + dz], i * 3);
        }
        const target = new THREE.Float32BufferAttribute(delta, 3);
        target.name = `paw${phase}${sample}`;
        targets.push(target);
        const surface = new THREE.BufferGeometry();
        surface.setIndex(geometry.index);
        surface.setAttribute('position', new THREE.Float32BufferAttribute(posed, 3));
        surface.computeVertexNormals();
        const sampled = surface.getAttribute('normal');
        // Bake the blended elbow's actual surface normals to avoid dark seams.
        for (let i = 0; i < positions.count; i++) sampled.setXYZ(i,
          sampled.getX(i) - normals.getX(i), sampled.getY(i) - normals.getY(i), sampled.getZ(i) - normals.getZ(i));
        normalTargets.push(sampled);
        surface.dispose();
      }
    }
    const previous = [...mesh.morphTargetInfluences!];
    mesh.updateMorphTargets();
    previous.forEach((weight, i) => { mesh.morphTargetInfluences![i] = weight; });
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  set(wave: number, hold: number): void {
    const weights = this.mesh.morphTargetInfluences!;
    const greeting = Number.isFinite(wave) ? THREE.MathUtils.clamp(wave / (Math.PI / 6), 0, 5) : 0;
    const feeding = Number.isFinite(hold) ? THREE.MathUtils.clamp(hold * 3, 0, 3) : 0;
    for (let i = 1; i <= 5; i++) weights[this.start + i - 1] = Math.max(0, 1 - Math.abs(greeting - i));
    for (let i = 1; i <= 3; i++) weights[this.start + 5 + i - 1] = Math.max(0, 1 - Math.abs(feeding - i));
  }
}
