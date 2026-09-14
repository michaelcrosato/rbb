import * as THREE from 'three';
import type { FrameBuffers } from './buffers';
import type { GraphicsSettings } from './settings';

export interface RenderChunk {
  object: THREE.Object3D;
  center: THREE.Vector3;
  radius: number;
}
interface Record {
  chunk: RenderChunk;
  bounds: THREE.Box3;
  lastUsed: number;
  resident: boolean;
  evicted: boolean;
  misses: number;
  hidden: boolean;
  before?: THREE.Mesh['onBeforeRender'];
  after?: THREE.Mesh['onAfterRender'];
  shadow?: THREE.Mesh['onAfterShadow'];
  range?: { start: number; count: number };
}

/** Visibility only: canonical objects, collision data and CPU geometry are never removed. */
export class ChunkVisibility {
  private records: Record[] = [];
  private pending: { query: WebGLQuery; record: Record; generation: number }[] = [];
  private scene = new THREE.Scene();
  private box = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }),
  );
  private frustum = new THREE.Frustum();
  private viewProjection = new THREE.Matrix4();
  private position = new THREE.Vector3(Infinity, Infinity, Infinity);
  private rotation = new THREE.Quaternion();
  private generation = 0;
  private cursor = 0;
  private time = 0;
  private streaming = false;
  private enabled = false;
  private distance = 320;
  private evictions = 0;
  private reloads = 0;
  private queries = 0;
  private geometryUse = new Map<THREE.BufferGeometry, Record[]>();
  private gl: WebGL2RenderingContext;
  private viewCamera?: THREE.Camera;
  get stats() {
    return {
      chunks: this.records.length,
      residentChunks: this.records.filter((record) => record.resident).length,
      occluded: this.records.filter((record) => record.hidden).length,
      pendingQueries: this.pending.length,
      queries: this.queries,
      evictions: this.evictions,
      reloads: this.reloads,
    };
  }
  constructor(private renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.scene.add(this.box);
  }
  configure(settings: GraphicsSettings, chunks: RenderChunk[]): void {
    this.reset();
    this.enabled = settings.gpuOcclusion;
    this.streaming = settings.chunkStreaming;
    this.distance = settings.streamingDistance;
    if (!this.enabled && !this.streaming) return;
    this.records = chunks.map((chunk) => ({
      chunk,
      bounds: new THREE.Box3().setFromObject(chunk.object).expandByScalar(4),
      lastUsed: this.time,
      resident: true,
      evicted: false,
      misses: 0,
      hidden: false,
    }));
    for (const record of this.records) {
      const object = record.chunk.object;
      if (!(object instanceof THREE.Mesh)) continue;
      const users = this.geometryUse.get(object.geometry) ?? [];
      users.push(record);
      this.geometryUse.set(object.geometry, users);
      const used = () => {
        if (!this.streaming) return;
        record.lastUsed = this.time;
        if (!record.resident && record.evicted) this.reloads++;
        record.resident = true;
        record.evicted = false;
      };
      record.after = object.onAfterRender;
      record.shadow = object.onAfterShadow;
      record.before = object.onBeforeRender;
      object.onBeforeRender = (...args) => {
        record.before!.apply(object, args);
        // Suppress only this camera's color/depth draw. A hidden chunk can still
        // cast a visible shadow or appear in the water/probe cameras.
        if (this.enabled && record.hidden && args[2] === this.viewCamera) {
          record.range = { ...object.geometry.drawRange };
          object.geometry.setDrawRange(0, 0);
        }
      };
      object.onAfterRender = (...args) => {
        if (record.range) {
          object.geometry.setDrawRange(record.range.start, record.range.count);
          record.range = undefined;
        }
        record.after!.apply(object, args);
        used();
      };
      object.onAfterShadow = (...args) => {
        record.shadow!.apply(object, args);
        used();
      };
    }
  }
  before(camera: THREE.PerspectiveCamera, dt: number, cut: boolean): void {
    this.viewCamera = camera;
    this.time += dt;
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    // Reveal immediately while walking or turning. Only a stable viewpoint consumes delayed results.
    if (
      cut ||
      camera.position.distanceTo(this.position) > 0.02 ||
      camera.quaternion.angleTo(this.rotation) > 0.002
    ) {
      this.generation++;
      this.records.forEach((record) => {
        record.hidden = false;
        record.misses = 0;
      });
    }
    this.position.copy(camera.position);
    this.rotation.copy(camera.quaternion);
    const { gl } = this;
    this.pending = this.pending.filter((item) => {
      if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) return true;
      const visible = !!gl.getQueryParameter(item.query, gl.QUERY_RESULT);
      gl.deleteQuery(item.query);
      if (item.generation === this.generation) {
        item.record.misses = visible ? 0 : item.record.misses + 1;
        item.record.hidden = item.record.misses >= 2;
      }
      return false;
    });
    if (this.enabled)
      for (const record of this.records) {
        if (record.bounds.distanceToPoint(camera.position) < 24) {
          record.hidden = false;
          continue;
        }
      }
  }
  after(camera: THREE.PerspectiveCamera, buffers?: FrameBuffers): void {
    if (this.enabled && buffers) this.issue(camera, buffers);
    if (!this.streaming) return;
    let budget = 4;
    const eligible = (record: Record) =>
      this.time - record.lastUsed > 10 &&
      record.chunk.center.distanceTo(camera.position) > this.distance + record.chunk.radius;
    for (const record of this.records) {
      if (budget <= 0) break;
      if (!record.resident || !eligible(record)) continue;
      const object = record.chunk.object;
      if (!(object instanceof THREE.Mesh)) continue;
      if (object instanceof THREE.InstancedMesh) object.dispose();
      const users = this.geometryUse.get(object.geometry)!;
      if (users.every(eligible)) object.geometry.dispose();
      record.resident = false;
      record.evicted = true;
      this.evictions++;
      budget--;
    }
  }
  private issue(camera: THREE.PerspectiveCamera, buffers: FrameBuffers): void {
    const { renderer, gl } = this,
      target = renderer.getRenderTarget(),
      autoClear = renderer.autoClear,
      shadow = renderer.shadowMap.autoUpdate;
    const queued = new Set(this.pending.map((item) => item.record));
    let budget = 12;
    try {
      renderer.setRenderTarget(buffers.target);
      renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false;
      for (let i = 0; i < this.records.length && budget > 0 && this.pending.length < 48; i++) {
        const record = this.records[this.cursor++ % this.records.length];
        if (
          queued.has(record) ||
          !this.frustum.intersectsBox(record.bounds) ||
          record.bounds.distanceToPoint(camera.position) < 24
        )
          continue;
        record.bounds.getCenter(this.box.position);
        record.bounds.getSize(this.box.scale);
        this.box.updateMatrixWorld();
        const query = gl.createQuery();
        if (!query) break;
        gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, query);
        try {
          renderer.render(this.scene, camera);
        } finally {
          gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
        }
        this.pending.push({ query, record, generation: this.generation });
        this.queries++;
        budget--;
      }
    } finally {
      renderer.setRenderTarget(target);
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadow;
    }
  }
  reset(): void {
    this.pending.forEach((item) => this.gl.deleteQuery(item.query));
    this.pending = [];
    for (const record of this.records) {
      const object = record.chunk.object;
      if (object instanceof THREE.Mesh) {
        if (record.range) object.geometry.setDrawRange(record.range.start, record.range.count);
        if (record.before) object.onBeforeRender = record.before;
        if (record.after) object.onAfterRender = record.after;
        if (record.shadow) object.onAfterShadow = record.shadow;
      }
      if (record.hidden) object.visible = true;
    }
    this.records = [];
    this.geometryUse.clear();
    this.position.set(Infinity, Infinity, Infinity);
    this.generation++;
  }
  contextLost(): void {
    this.reset();
    this.box.geometry.dispose();
    this.box.material.dispose();
  }
  dispose(): void {
    this.reset();
    this.box.geometry.dispose();
    this.box.material.dispose();
  }
}
