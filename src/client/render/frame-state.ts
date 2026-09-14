import * as THREE from 'three';

export function halton(index: number, base: number): number {
  let value = 0,
    fraction = 1;
  while (index > 0) {
    fraction /= base;
    value += fraction * (index % base);
    index = Math.floor(index / base);
  }
  return value;
}

/** One owner for camera history. Seeking, resizing and changing the graph invalidate it. */
export class FrameState {
  readonly previousViewProjection = new THREE.Matrix4();
  readonly viewProjection = new THREE.Matrix4();
  readonly inverseViewProjection = new THREE.Matrix4();
  readonly previousPosition = new THREE.Vector3();
  readonly previousRotation = new THREE.Quaternion();
  readonly jitter = new THREE.Vector2();
  readonly previousJitter = new THREE.Vector2();
  private projection = new THREE.Matrix4();
  private frame = 0;
  valid = false;
  cut = true;
  previousTime = 0;
  time = 0;
  resetReason = 'initial frame';
  reset(reason: string): void {
    this.valid = false;
    this.frame = 0;
    this.resetReason = reason;
  }
  begin(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    temporal: boolean,
    time: number,
  ): void {
    this.cut =
      !this.valid ||
      camera.position.distanceTo(this.previousPosition) > 8 ||
      camera.quaternion.angleTo(this.previousRotation) > 0.65;
    if (this.cut && this.valid) this.resetReason = 'camera cut';
    this.projection.copy(camera.projectionMatrix);
    this.jitter.set(0, 0);
    if (temporal) {
      const sample = (this.frame % 16) + 1;
      this.jitter.set(halton(sample, 2) - 0.5, halton(sample, 3) - 0.5);
      camera.projectionMatrix.elements[8] += (this.jitter.x * 2) / width;
      camera.projectionMatrix.elements[9] += (this.jitter.y * 2) / height;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.inverseViewProjection.copy(this.viewProjection).invert();
    if (this.cut) {
      this.previousViewProjection.copy(this.viewProjection);
      this.previousJitter.copy(this.jitter);
      this.previousTime = time;
    }
    this.time = time;
  }
  end(camera: THREE.PerspectiveCamera): void {
    this.previousPosition.copy(camera.position);
    this.previousRotation.copy(camera.quaternion);
    this.previousViewProjection.copy(this.viewProjection);
    this.previousTime = this.time;
    this.previousJitter.copy(this.jitter);
    this.valid = true;
    this.frame++;
    camera.projectionMatrix.copy(this.projection);
    camera.projectionMatrixInverse.copy(this.projection).invert();
  }
}
