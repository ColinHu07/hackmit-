import * as THREE from 'three';

/** Measures the posed soles so tilting, breathing, and foot swings cannot sink them. */
export class GroundContact {
  private readonly support: { mesh: THREE.Mesh; indices: number[] }[] = [];
  private readonly point = new THREE.Vector3();
  private readonly bodyMatrix = new THREE.Matrix4();
  private readonly inverseBody = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();

  constructor(private readonly body: THREE.Object3D, private readonly footY: number) {
    body.updateWorldMatrix(true, true);
    this.inverseBody.copy(body.matrixWorld).invert();
    body.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      this.local.multiplyMatrices(this.inverseBody, object.matrixWorld);
      const indices: number[] = [];
      const positions = object.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        this.point.fromBufferAttribute(positions, i).applyMatrix4(this.local);
        if (this.point.y <= footY + 26) indices.push(i);
      }
      this.support.push({ mesh: object, indices });
    });
  }

  /** Y position of the lowest posed support point, excluding body translation. */
  lowestY(): number {
    this.body.updateWorldMatrix(true, true);
    this.inverseBody.copy(this.body.matrixWorld).invert();
    this.bodyMatrix.makeRotationFromQuaternion(this.body.quaternion).scale(this.body.scale);
    let lowest = Infinity;
    for (const { mesh, indices } of this.support) {
      this.local.multiplyMatrices(this.inverseBody, mesh.matrixWorld);
      for (const index of indices) {
        mesh.getVertexPosition(index, this.point);
        this.point.applyMatrix4(this.local).applyMatrix4(this.bodyMatrix);
        lowest = Math.min(lowest, this.point.y);
      }
    }
    return Number.isFinite(lowest) ? lowest : this.footY * this.body.scale.y;
  }
}
