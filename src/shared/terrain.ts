import { z } from 'zod';
import { clamp } from './math';
import type { Vec3 } from './state';
import { terrainHeight, WORLD_HALF } from './world';
import type { WorldDefinition } from './world';

/** Metre lattice, positive = air. The seeded surface remains exact outside edits.
 * Storage contains only changed lattice samples, never meshes or generated voxels. */
export const TERRAIN = {
  version: 1,
  minY: -64,
  maxY: 128,
  chunkSize: 16,
  maxSamples: 160_000,
  precision: 256,
} as const;
export interface TerrainState {
  version: 1;
  revision: number;
  samples: Record<string, number>;
}
export const emptyTerrain = (): TerrainState => ({ version: 1, revision: 0, samples: {} });
export const sampleKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const keySchema = z
  .string()
  .max(16)
  .regex(/^-?\d+,-?\d+,-?\d+$/)
  .refine((key) => {
    const [x, y, z] = key.split(',').map(Number);
    return (
      key === sampleKey(x, y, z) &&
      Math.abs(x) < WORLD_HALF &&
      Math.abs(z) < WORLD_HALF &&
      y > TERRAIN.minY &&
      y < TERRAIN.maxY
    );
  });
const valueSchema = z
  .number()
  .finite()
  .min(-256)
  .max(256)
  .refine((n) => Number.isInteger(n * TERRAIN.precision));
export const terrainSchema = z
  .object({
    version: z.literal(TERRAIN.version),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    samples: z
      .record(keySchema, valueSchema)
      .refine((s) => Object.keys(s).length <= TERRAIN.maxSamples),
  })
  .strict();

export const TERRAIN_MODES = ['dig', 'add', 'flatten', 'smooth', 'restore'] as const;
export const brushSchema = z
  .object({
    mode: z.enum(TERRAIN_MODES),
    shape: z.enum(['sphere', 'box']),
    x: z.number().finite().min(-310).max(310),
    y: z
      .number()
      .finite()
      .min(TERRAIN.minY + 2)
      .max(TERRAIN.maxY - 2),
    z: z.number().finite().min(-310).max(310),
    radius: z.number().finite().min(1).max(12),
    strength: z.number().finite().min(0.1).max(1),
    level: z
      .number()
      .finite()
      .min(TERRAIN.minY + 2)
      .max(TERRAIN.maxY - 2),
  })
  .strict();
export type TerrainBrush = z.infer<typeof brushSchema>;
export type TerrainMode = TerrainBrush['mode'];
export type TerrainPatch = Record<string, number | null>;

interface Column {
  min: number;
  max: number;
}
interface TerrainIndex {
  revision: number;
  columns: Map<string, Column>;
  chunks: Set<string>;
}
const indices = new WeakMap<TerrainState, TerrainIndex>();
export function terrainIndex(terrain: TerrainState): TerrainIndex {
  const cached = indices.get(terrain);
  if (cached?.revision === terrain.revision) return cached;
  const index: TerrainIndex = { revision: terrain.revision, columns: new Map(), chunks: new Set() };
  for (const key of Object.keys(terrain.samples)) {
    const [x, y, z] = key.split(',').map(Number);
    for (const dx of [-1, 0])
      for (const dz of [-1, 0]) {
        const columnKey = `${x + dx},${z + dz}`;
        const column = index.columns.get(columnKey);
        if (column) {
          column.min = Math.min(column.min, y - 1);
          column.max = Math.max(column.max, y + 1);
        } else index.columns.set(columnKey, { min: y - 1, max: y + 1 });
        index.chunks.add(
          `${Math.floor((x + dx) / TERRAIN.chunkSize)},${Math.floor((z + dz) / TERRAIN.chunkSize)}`,
        );
      }
  }
  indices.set(terrain, index);
  return index;
}

export function terrainSample(
  terrain: TerrainState,
  world: WorldDefinition,
  x: number,
  y: number,
  z: number,
): number {
  return terrain.samples[sampleKey(x, y, z)] ?? y - terrainHeight(x, z, world.hash);
}

/** Freudenthal tetrahedra, reflected in Z to match the island's X+Z diagonal.
 * Physics interpolation and polygonization MUST use this same decomposition. */
export const CUBE_CORNERS: Vec3[] = Array.from({ length: 8 }, (_, i) => ({
  x: i & 1,
  y: (i >> 1) & 1,
  z: 1 - ((i >> 2) & 1),
}));
export const TETRAHEDRA = [
  [0, 1, 3, 7],
  [0, 1, 5, 7],
  [0, 2, 3, 7],
  [0, 2, 6, 7],
  [0, 4, 5, 7],
  [0, 4, 6, 7],
];

export function terrainDensity(
  terrain: TerrainState,
  world: WorldDefinition,
  x: number,
  y: number,
  z: number,
): number {
  if (y <= TERRAIN.minY) return -1;
  const gx = Math.floor(x),
    gy = Math.floor(y),
    gz = Math.floor(z);
  const column = terrainIndex(terrain).columns.get(`${gx},${gz}`);
  if (!column || y < column.min || y > column.max) return y - terrainHeight(x, z, world.hash);
  const coordinates = [x - gx, y - gy, 1 - (z - gz)];
  const axes = [0, 1, 2].sort((a, b) => coordinates[b] - coordinates[a]);
  const vertices = [0, 1 << axes[0], (1 << axes[0]) | (1 << axes[1]), 7];
  const weights = [
    1 - coordinates[axes[0]],
    coordinates[axes[0]] - coordinates[axes[1]],
    coordinates[axes[1]] - coordinates[axes[2]],
    coordinates[axes[2]],
  ];
  return vertices.reduce((sum, v, i) => {
    const c = CUBE_CORNERS[v];
    return sum + weights[i] * terrainSample(terrain, world, gx + c.x, gy + c.y, gz + c.z);
  }, 0);
}

/** All solid/air transitions along a vertical line. Handles stacked cave floors. */
export function terrainSurfaces(
  terrain: TerrainState,
  world: WorldDefinition,
  x: number,
  z: number,
): { y: number; floor: boolean }[] {
  const column = terrainIndex(terrain).columns.get(`${Math.floor(x)},${Math.floor(z)}`);
  const base = terrainHeight(x, z, world.hash);
  if (!column) return [{ y: base, floor: true }];
  const surfaces: { y: number; floor: boolean }[] = [];
  // Include one unedited cell on either side. A zero-valued boundary sample
  // needs its neighboring air/solid value to distinguish a floor from a tangent.
  const start = column.min - 1,
    end = column.max + 1;
  if (base <= start || base >= end) surfaces.push({ y: base, floor: true });
  const cuts = [...new Set([0, x - Math.floor(x), 1 - (z - Math.floor(z)), 1])].sort(
    (a, b) => a - b,
  );
  for (let gy = start; gy < end; gy++) {
    for (let i = 1; i < cuts.length; i++) {
      const a = gy + cuts[i - 1],
        b = gy + cuts[i];
      const da = terrainDensity(terrain, world, x, a, z),
        db = terrainDensity(terrain, world, x, b, z);
      if (da <= 0 === db <= 0) continue;
      const y = a + ((b - a) * da) / (da - db);
      if (!surfaces.some((s) => Math.abs(s.y - y) < 1e-7)) surfaces.push({ y, floor: db > 0 });
    }
  }
  return surfaces.sort((a, b) => a.y - b.y);
}
export function terrainFloor(
  terrain: TerrainState,
  world: WorldDefinition,
  x: number,
  z: number,
  below: number = TERRAIN.maxY,
): number {
  if (!terrainIndex(terrain).columns.has(`${Math.floor(x)},${Math.floor(z)}`)) {
    const height = terrainHeight(x, z, world.hash);
    return height <= below + 0.001 ? height : TERRAIN.minY;
  }
  const surfaces = terrainSurfaces(terrain, world, x, z);
  return surfaces.filter((s) => s.floor && s.y <= below + 0.001).at(-1)?.y ?? TERRAIN.minY;
}
export function terrainCeiling(
  terrain: TerrainState,
  world: WorldDefinition,
  x: number,
  z: number,
  above: number,
): number {
  if (!terrainIndex(terrain).columns.has(`${Math.floor(x)},${Math.floor(z)}`)) return Infinity;
  return (
    terrainSurfaces(terrain, world, x, z).find((s) => !s.floor && s.y >= above - 0.001)?.y ??
    Infinity
  );
}
export function terrainBodyClear(
  terrain: TerrainState,
  world: WorldDefinition,
  x: number,
  y: number,
  z: number,
  radius = 0.33,
  height = 1.7,
): boolean {
  const columns = terrainIndex(terrain).columns;
  for (const [dx, dz] of [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
  ]) {
    if (!columns.has(`${Math.floor(x + dx)},${Math.floor(z + dz)}`)) {
      if (y + 0.08 < terrainHeight(x + dx, z + dz, world.hash) - 0.01) return false;
      continue;
    }
    for (let dy = 0.08; dy <= height + 0.001; dy += (height - 0.08) / 4) {
      if (terrainDensity(terrain, world, x + dx, y + dy, z + dz) < -0.01) return false;
    }
  }
  return true;
}

export type Triangle = [Vec3, Vec3, Vec3];
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export function terrainCellTriangles(
  terrain: TerrainState,
  world: WorldDefinition,
  x: number,
  y: number,
  z: number,
  sample = (x: number, y: number, z: number) => terrainSample(terrain, world, x, y, z),
): Triangle[] {
  const p = CUBE_CORNERS.map((c) => ({ x: x + c.x, y: y + c.y, z: z + c.z }));
  const d = p.map((c) => sample(c.x, c.y, c.z));
  if (d.every((n) => n > 0) || d.every((n) => n <= 0)) return [];
  const result: Triangle[] = [];
  const edge = (a: number, b: number): Vec3 => {
    const t = d[a] / (d[a] - d[b]);
    return {
      x: p[a].x + (p[b].x - p[a].x) * t,
      y: p[a].y + (p[b].y - p[a].y) * t,
      z: p[a].z + (p[b].z - p[a].z) * t,
    };
  };
  for (const tet of TETRAHEDRA) {
    const solid = tet.filter((i) => d[i] <= 0),
      air = tet.filter((i) => d[i] > 0);
    if (!solid.length || !air.length) continue;
    const outward = sub(p[air[0]], p[solid[0]]);
    const tri = (a: Vec3, b: Vec3, c: Vec3) => {
      const normal = cross(sub(b, a), sub(c, a));
      if (dot(normal, normal) < 1e-16) return;
      result.push(dot(normal, outward) >= 0 ? [a, b, c] : [a, c, b]);
    };
    if (solid.length === 1) tri(...(air.map((a) => edge(solid[0], a)) as Triangle));
    else if (air.length === 1) tri(...(solid.map((s) => edge(s, air[0])) as Triangle));
    else {
      const a = edge(solid[0], air[0]),
        b = edge(solid[0], air[1]);
      const c = edge(solid[1], air[0]),
        e = edge(solid[1], air[1]);
      tri(a, b, c);
      tri(b, e, c);
    }
  }
  return result;
}

/** Unedited patches retain their original four-metre triangles. Edited patches
 * refine to the metre lattice and polygonize only the affected vertical bands. */
export function terrainChunkTriangles(
  terrain: TerrainState,
  world: WorldDefinition,
  cx: number,
  cz: number,
  size = 64,
): Triangle[] {
  const result: Triangle[] = [];
  const columns = terrainIndex(terrain).columns;
  const heights = new Map<string, number>();
  const height = (x: number, z: number) => {
    const key = `${x},${z}`;
    if (!heights.has(key)) heights.set(key, terrainHeight(x, z, world.hash));
    return heights.get(key)!;
  };
  const sample = (x: number, y: number, z: number) =>
    terrain.samples[sampleKey(x, y, z)] ?? y - height(x, z);
  const surface = (x: number, z: number, step: number) => {
    const a = { x, y: height(x, z), z },
      b = { x: x + step, y: height(x + step, z), z };
    const c = { x, y: height(x, z + step), z: z + step },
      d = { x: x + step, y: height(x + step, z + step), z: z + step };
    result.push([a, c, b], [d, b, c]);
  };
  for (let x = cx; x < cx + size; x += 4)
    for (let z = cz; z < cz + size; z += 4) {
      let edited = false;
      for (let dx = 0; dx < 4 && !edited; dx++)
        for (let dz = 0; dz < 4; dz++) if (columns.has(`${x + dx},${z + dz}`)) edited = true;
      if (!edited) {
        surface(x, z, 4);
        continue;
      }
      for (let dx = 0; dx < 4; dx++)
        for (let dz = 0; dz < 4; dz++) {
          const px = x + dx,
            pz = z + dz,
            column = columns.get(`${px},${pz}`);
          if (!column) {
            surface(px, pz, 1);
            continue;
          }
          const base = [
            height(px, pz),
            height(px + 1, pz),
            height(px, pz + 1),
            height(px + 1, pz + 1),
          ];
          const rows = new Set<number>();
          for (let y = column.min; y < column.max; y++) rows.add(y);
          for (let y = Math.floor(Math.min(...base)) - 1; y <= Math.ceil(Math.max(...base)); y++)
            rows.add(y);
          for (const y of rows)
            result.push(...terrainCellTriangles(terrain, world, px, y, pz, sample));
        }
    }
  return result;
}

export interface TerrainHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
}
/** Exact intersections with the same triangles emitted by the renderer. */
export function terrainRaycast(
  terrain: TerrainState,
  world: WorldDefinition,
  origin: Vec3,
  direction: Vec3,
  range: number,
): TerrainHit | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!length || range <= 0) return null;
  const dir = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  let distance = 0;
  for (let step = 0; step < range * 4 + 8 && distance <= range; step++) {
    const point = {
      x: origin.x + dir.x * (distance + 1e-7),
      y: origin.y + dir.y * (distance + 1e-7),
      z: origin.z + dir.z * (distance + 1e-7),
    };
    const cell = { x: Math.floor(point.x), y: Math.floor(point.y), z: Math.floor(point.z) };
    let nearest: TerrainHit | null = null;
    for (const [a, b, c] of terrainCellTriangles(terrain, world, cell.x, cell.y, cell.z)) {
      const e1 = sub(b, a),
        e2 = sub(c, a),
        h = cross(dir, e2),
        det = dot(e1, h);
      if (det < 1e-9) continue; // Only enter solid, never target a hidden back face.
      const s = sub(origin, a),
        u = dot(s, h) / det;
      if (u < -1e-7 || u > 1 + 1e-7) continue;
      const q = cross(s, e1),
        v = dot(dir, q) / det;
      if (v < -1e-7 || u + v > 1 + 1e-7) continue;
      const t = dot(e2, q) / det;
      if (t < distance - 1e-6 || t > range || (nearest && t >= nearest.distance)) continue;
      const normal = cross(e1, e2),
        n = Math.hypot(normal.x, normal.y, normal.z);
      nearest = {
        distance: t,
        point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
        normal: { x: normal.x / n, y: normal.y / n, z: normal.z / n },
      };
    }
    if (nearest) return nearest;
    let next = Infinity;
    for (const axis of ['x', 'y', 'z'] as const)
      if (Math.abs(dir[axis]) > 1e-10) {
        const boundary = cell[axis] + (dir[axis] > 0 ? 1 : 0);
        next = Math.min(next, (boundary - origin[axis]) / dir[axis]);
      }
    distance = Math.max(distance + 1e-6, next);
  }
  return null;
}

export interface TerrainEdit {
  patch: TerrainPatch;
  mass: number;
}
/** Prepare first; gameplay validates cost, occupancy and support before committing.
 * Mass is a conservative nodal volume proxy. Rounding gains down and costs up
 * prevents cycling brushes from creating free fill material. */
export function planTerrainEdit(
  terrain: TerrainState,
  world: WorldDefinition,
  brush: TerrainBrush,
): TerrainEdit {
  const patch: TerrainPatch = {};
  let mass = 0;
  const r = brush.radius;
  for (let x = Math.ceil(brush.x - r - 1); x <= Math.floor(brush.x + r + 1); x++)
    for (let z = Math.ceil(brush.z - r - 1); z <= Math.floor(brush.z + r + 1); z++)
      for (let y = Math.ceil(brush.y - r - 1); y <= Math.floor(brush.y + r + 1); y++) {
        if (
          Math.abs(x) >= WORLD_HALF ||
          Math.abs(z) >= WORLD_HALF ||
          y <= TERRAIN.minY ||
          y >= TERRAIN.maxY
        )
          continue;
        const dx = Math.abs(x - brush.x),
          dy = Math.abs(y - brush.y),
          dz = Math.abs(z - brush.z);
        const distance = brush.shape === 'sphere' ? Math.hypot(dx, dy, dz) : Math.max(dx, dy, dz);
        if (distance > r + 1) continue;
        const old = terrainSample(terrain, world, x, y, z),
          base = y - terrainHeight(x, z, world.hash);
        const weight = clamp(r + 1 - distance, 0, 1) * brush.strength;
        let desired: number;
        if (brush.mode === 'dig') desired = Math.max(old, r - distance);
        else if (brush.mode === 'add') desired = Math.min(old, distance - r);
        else if (brush.mode === 'flatten') desired = y - brush.level;
        else if (brush.mode === 'restore') desired = base;
        else
          desired =
            [
              [1, 0, 0],
              [-1, 0, 0],
              [0, 1, 0],
              [0, -1, 0],
              [0, 0, 1],
              [0, 0, -1],
            ].reduce(
              (sum, [ax, ay, az]) => sum + terrainSample(terrain, world, x + ax, y + ay, z + az),
              0,
            ) / 6;
        const next =
          Math.round(clamp(old + (desired - old) * weight, -256, 256) * TERRAIN.precision) /
          TERRAIN.precision;
        if (Math.abs(next - old) < 1 / TERRAIN.precision) continue;
        const key = sampleKey(x, y, z);
        const restore = Math.abs(next - base) <= 1 / TERRAIN.precision;
        if (restore && terrain.samples[key] === undefined) continue;
        patch[key] = restore ? null : next;
        mass += clamp(0.5 - old, 0, 1) - clamp(0.5 - (restore ? base : next), 0, 1);
      }
  return { patch, mass };
}

const histories = new WeakMap<TerrainState, { revision: number; patch: TerrainPatch }[]>();
export function commitTerrainEdit(terrain: TerrainState, patch: TerrainPatch): void {
  if (!Object.keys(patch).length) return;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete terrain.samples[key];
    else terrain.samples[key] = value;
  }
  terrain.revision++;
  const history = histories.get(terrain) ?? [];
  history.push({ revision: terrain.revision, patch });
  if (history.length > 32) history.shift();
  histories.set(terrain, history);
}

export const terrainUpdateSchema = z
  .object({
    revision: terrainSchema.shape.revision,
    base: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
    samples: z
      .record(keySchema, valueSchema.nullable())
      .refine((s) => Object.keys(s).length <= TERRAIN.maxSamples),
  })
  .strict()
  .refine((update) => update.base === -1 || update.revision > update.base);
export type TerrainUpdate = z.infer<typeof terrainUpdateSchema>;
export function terrainUpdate(terrain: TerrainState, since = -1): TerrainUpdate | undefined {
  if (since === terrain.revision) return undefined;
  const history = histories.get(terrain) ?? [];
  if (since >= 0 && history.some((h) => h.revision === since + 1)) {
    const samples = Object.assign(
      {},
      ...history.filter((h) => h.revision > since).map((h) => h.patch),
    );
    if (Object.keys(samples).length <= TERRAIN.maxSamples)
      return { base: since, revision: terrain.revision, samples };
  }
  return { base: -1, revision: terrain.revision, samples: { ...terrain.samples } };
}
export function applyTerrainUpdate(terrain: TerrainState, update: TerrainUpdate): TerrainState {
  if (update.base !== -1 && update.base !== terrain.revision)
    throw new Error('Terrain revision mismatch');
  const next =
    update.base === -1 ? emptyTerrain() : { ...terrain, samples: { ...terrain.samples } };
  for (const [key, value] of Object.entries(update.samples)) {
    if (value === null) delete next.samples[key];
    else next.samples[key] = value;
  }
  if (Object.keys(next.samples).length > TERRAIN.maxSamples)
    throw new Error('Terrain capacity exceeded');
  next.revision = update.revision;
  indices.delete(next);
  if (update.base >= 0) {
    histories.set(next, [
      ...(histories.get(terrain) ?? []).slice(-31),
      { revision: update.revision, patch: update.samples },
    ]);
  }
  return next;
}
