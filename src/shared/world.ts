import { clamp, hashString, lerp, noise, random } from './math';
import type { ResourceKind } from './content';

export const WORLD_VERSION = 1;
export const WORLD_SIZE = 640;
export const WORLD_HALF = WORLD_SIZE / 2;
export const TERRAIN_STEP = 4;
export const SEA_LEVEL = 0;
export const DEFAULT_SEED = 'quiet-frontier';
export const SPAWN = { x: 0, z: 86 };

export interface Resource {
  id: string;
  kind: ResourceKind;
  x: number;
  z: number;
  y: number;
  scale: number;
  rotation: number;
}
export interface WorldDefinition {
  seed: string;
  hash: number;
  resources: Resource[];
  resourceMap: Map<string, Resource>;
  cells: Map<string, Resource[]>;
}

/** Heights at grid vertices. Keep versioned: changing this changes every saved world's topology. */
export function vertexHeight(x: number, z: number, seed: number): number {
  const coast = noise(x / 85, z / 85, seed + 7) * 32;
  const radius = Math.hypot(x * 0.92, z * 1.1);
  const falloff = clamp((224 + coast - radius) / 105, 0, 1);
  const rolling = 4 + noise(x / 73, z / 73, seed) * 22 + noise(x / 26, z / 26, seed + 1) * 6;
  const ridge = Math.pow(noise(x / 110, z / 110, seed + 9), 2) * 43;
  let height = -7 + falloff * (rolling + ridge);
  // Reliable, open starter meadow on every seed, blended into the surrounding landscape.
  const spawnDist = Math.hypot(x - SPAWN.x, z - SPAWN.z);
  height = lerp(8, height, clamp((spawnDist - 24) / 34, 0, 1));
  return height;
}

/** Same diagonal and barycentric interpolation as the rendered terrain triangles. */
export function terrainHeight(x: number, z: number, seed: number): number {
  const gx = Math.floor(x / TERRAIN_STEP) * TERRAIN_STEP;
  const gz = Math.floor(z / TERRAIN_STEP) * TERRAIN_STEP;
  const u = (x - gx) / TERRAIN_STEP,
    v = (z - gz) / TERRAIN_STEP;
  const a = vertexHeight(gx, gz, seed),
    b = vertexHeight(gx + TERRAIN_STEP, gz, seed);
  const c = vertexHeight(gx, gz + TERRAIN_STEP, seed),
    d = vertexHeight(gx + TERRAIN_STEP, gz + TERRAIN_STEP, seed);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export function generateWorld(seed: string): WorldDefinition {
  const hash = hashString(seed),
    rng = random(hash);
  const resources: Resource[] = [];
  const add = (id: string, kind: ResourceKind, x: number, z: number, scale = 1) =>
    resources.push({
      id,
      kind,
      x,
      z,
      y: terrainHeight(x, z, hash),
      scale,
      rotation: rng() * Math.PI * 2,
    });
  // The opening loop is reachable without walking blind through an unbalanced seed.
  add('starter-tree', 'tree', -3.5, 79, 1);
  add('starter-tree-2', 'tree', -10, 77, 1.1);
  add('starter-rock', 'rock', 5, 80, 1);
  add('starter-rock-2', 'rock', 9, 75, 1.2);
  add('starter-fiber', 'fiber', -1, 83);
  add('starter-fiber-2', 'fiber', 2.4, 81);
  add('starter-fiber-3', 'fiber', -6, 84);
  add('starter-berries', 'berries', 5, 87);
  add('starter-spring', 'spring', 9, 90);
  for (let i = 0; i < 2600; i++) {
    const x = (rng() - 0.5) * 510,
      z = (rng() - 0.5) * 490;
    const height = terrainHeight(x, z, hash);
    const pick = rng();
    const kind: ResourceKind =
      pick < 0.55 ? 'tree' : pick < 0.74 ? 'rock' : pick < 0.89 ? 'fiber' : 'berries';
    if (height < 2.8 || height > 57 || Math.hypot(x, z - 86) < 17) continue;
    if (resources.some((r) => Math.hypot(x - r.x, z - r.z) < (kind === 'tree' ? 4.2 : 3))) continue;
    add(`r${i}`, kind, x, z, 0.75 + rng() * 0.65);
  }
  const cells = new Map<string, Resource[]>();
  for (const r of resources) {
    const key = `${Math.floor(r.x / 16)},${Math.floor(r.z / 16)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(r);
  }
  return { seed, hash, resources, resourceMap: new Map(resources.map((r) => [r.id, r])), cells };
}

export function nearbyResources(
  world: WorldDefinition,
  x: number,
  z: number,
  range: number,
): Resource[] {
  const found: Resource[] = [];
  for (let cx = Math.floor((x - range) / 16); cx <= Math.floor((x + range) / 16); cx++) {
    for (let cz = Math.floor((z - range) / 16); cz <= Math.floor((z + range) / 16); cz++) {
      for (const r of world.cells.get(`${cx},${cz}`) ?? []) {
        if (Math.hypot(x - r.x, z - r.z) <= range) found.push(r);
      }
    }
  }
  return found;
}

export function biomeAt(x: number, z: number, seed: number): string {
  const height = terrainHeight(x, z, seed);
  if (height < 1) return 'Open water';
  if (height < 5) return 'Tidal coast';
  if (height > 35) return 'Highland ridge';
  if (Math.hypot(x, z - 86) < 40) return 'Haven meadow';
  return 'Pine wilderness';
}
