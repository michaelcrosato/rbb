import * as THREE from 'three';
import { noise } from '../../shared/math';
import {
  applyTerrainUpdate,
  emptyTerrain,
  terrainChunkTriangles,
  terrainIndex,
  terrainFloor,
} from '../../shared/terrain';
import type { TerrainUpdate } from '../../shared/terrain';
import { WORLD_HALF, terrainHeight } from '../../shared/world';
import type { WorldDefinition } from '../../shared/world';

/** Stable mesh objects retain lighting hooks across edits. Old GPU buffers are
 * released when dirty geometry is replaced. No quality setting changes topology. */
export class EditableTerrain {
  readonly group = new THREE.Group();
  readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
  });
  readonly chunks: { mesh: THREE.Mesh; shore: THREE.LineSegments; x: number; z: number }[] = [];
  private state = emptyTerrain();
  private synchronized = false;
  private readonly shorelineMaterial = new THREE.LineBasicMaterial({
    color: '#e0efe2',
    transparent: true,
    opacity: 0.6,
  });
  get revision(): number {
    return this.synchronized ? this.state.revision : -1;
  }
  height(x: number, z: number, below?: number): number {
    return terrainFloor(this.state, this.world, x, z, below);
  }
  private readonly palette = {
    sand: new THREE.Color('#cfc19a'),
    grass: new THREE.Color('#8d9d68'),
    forest: new THREE.Color('#788d61'),
    rock: new THREE.Color('#9ba6a0'),
    deep: new THREE.Color('#849d8e'),
    earth: new THREE.Color('#90745b'),
  };
  constructor(private world: WorldDefinition) {
    for (let x = -WORLD_HALF; x < WORLD_HALF; x += 64)
      for (let z = -WORLD_HALF; z < WORLD_HALF; z += 64) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        const shore = new THREE.LineSegments(new THREE.BufferGeometry(), this.shorelineMaterial);
        this.chunks.push({ mesh, shore, x, z });
        this.group.add(mesh, shore);
        this.rebuild(this.chunks.at(-1)!);
      }
  }
  update(update?: TerrainUpdate): boolean {
    if (!update || (update.revision === this.state.revision && update.base !== -1)) return false;
    const dirty = new Set<string>();
    const mark = (key: string) => {
      const [x, , z] = key.split(',').map(Number);
      for (const dx of [-1, 0])
        for (const dz of [-1, 0])
          dirty.add(`${Math.floor((x + dx) / 64) * 64},${Math.floor((z + dz) / 64) * 64}`);
    };
    if (update.base === -1) Object.keys(this.state.samples).forEach(mark);
    Object.keys(update.samples).forEach(mark);
    this.state = applyTerrainUpdate(this.state, update);
    this.synchronized = true;
    for (const chunk of this.chunks) if (dirty.has(`${chunk.x},${chunk.z}`)) this.rebuild(chunk);
    return dirty.size > 0;
  }
  get diagnostics() {
    return {
      revision: this.revision,
      samples: Object.keys(this.state.samples).length,
      editedChunks: terrainIndex(this.state).chunks.size,
      triangles: this.chunks.reduce(
        (sum, c) => sum + c.mesh.geometry.getAttribute('position').count / 3,
        0,
      ),
    };
  }
  private rebuild(chunk: (typeof this.chunks)[number]): void {
    chunk.mesh.userData.terrainEdited = [...terrainIndex(this.state).columns.keys()].some((key) => {
      const [x, z] = key.split(',').map(Number);
      return x >= chunk.x && x < chunk.x + 64 && z >= chunk.z && z < chunk.z + 64;
    });
    const positions: number[] = [],
      colors: number[] = [],
      shore: number[] = [];
    const { sand, grass, forest, rock, deep, earth } = this.palette;
    for (const points of terrainChunkTriangles(this.state, this.world, chunk.x, chunk.z)) {
      const h = points.reduce((sum, p) => sum + p.y, 0) / 3;
      const x = points.reduce((sum, p) => sum + p.x, 0) / 3,
        z = points.reduce((sum, p) => sum + p.z, 0) / 3;
      const a = new THREE.Vector3(points[0].x, points[0].y, points[0].z);
      const normal = new THREE.Vector3(points[1].x, points[1].y, points[1].z)
        .sub(a)
        .cross(new THREE.Vector3(points[2].x, points[2].y, points[2].z).sub(a))
        .normalize();
      const variation = noise(x / 7, z / 7, this.world.hash + 44);
      const underground = h < terrainHeight(x, z, this.world.hash) - 0.4;
      const base =
        normal.y < 0.55 || underground
          ? earth
          : h < -0.5
            ? deep
            : h < 3.5
              ? sand
              : h > 32
                ? rock
                : variation > 0.5
                  ? grass
                  : forest;
      const color = base.clone().multiplyScalar(0.93 + variation * 0.14);
      for (const p of points) {
        positions.push(p.x, p.y, p.z);
        colors.push(color.r, color.g, color.b);
      }
      const intersections: number[][] = [];
      for (let i = 0; i < 3; i++) {
        const a = points[i],
          b = points[(i + 1) % 3];
        if (a.y < 0.1 !== b.y < 0.1) {
          const t = (0.1 - a.y) / (b.y - a.y);
          intersections.push([a.x + (b.x - a.x) * t, 0.13, a.z + (b.z - a.z) * t]);
        }
      }
      if (intersections.length === 2) shore.push(...intersections[0], ...intersections[1]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    chunk.mesh.geometry.dispose();
    chunk.mesh.geometry = geometry;
    const shoreGeometry = new THREE.BufferGeometry();
    shoreGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shore, 3));
    chunk.shore.geometry.dispose();
    chunk.shore.geometry = shoreGeometry;
  }
}
