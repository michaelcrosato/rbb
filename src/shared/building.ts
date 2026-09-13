import { BALANCE, BUILDINGS, RESOURCE_TYPES } from './content';
import type { BuildingKind } from './content';
import { canAfford } from './inventory';
import { distance2 } from './math';
import { wallContains } from './physics';
import { resourceIsActive } from './state';
import type { Building, GameState, PlayerState, Result } from './state';
import { nearbyResources, terrainHeight } from './world';
import type { WorldDefinition } from './world';

export function buildCandidate(
  state: GameState,
  world: WorldDefinition,
  kind: BuildingKind,
  x: number,
  z: number,
  rotation: number,
): Omit<Building, 'id' | 'owner'> {
  let y: number;
  rotation = ((rotation % 4) + 4) % 4;
  if (kind === 'wall') {
    const foundation = state.buildings
      .filter((b) => b.kind === 'foundation')
      .sort((a, b) => distance2(a, { x, z }) - distance2(b, { x, z }))[0];
    if (foundation && distance2(foundation, { x, z }) < 5) {
      x = foundation.x + (rotation === 1 ? 2 : rotation === 3 ? -2 : 0);
      z = foundation.z + (rotation === 0 ? -2 : rotation === 2 ? 2 : 0);
      y = foundation.y;
    } else y = terrainHeight(x, z, world.hash);
  } else if (kind === 'foundation') {
    x = Math.round(x / 4) * 4;
    z = Math.round(z / 4) * 4;
    y =
      Math.max(
        ...[-2, 2].flatMap((dx) => [-2, 2].map((dz) => terrainHeight(x + dx, z + dz, world.hash))),
      ) + 0.3;
    // Adjoining platforms share a height if the terrain allows a small step.
    const neighbor = state.buildings.find(
      (b) =>
        b.kind === 'foundation' &&
        Math.abs(distance2(b, { x, z }) - 4) < 0.1 &&
        Math.abs(b.y - y) < 1,
    );
    if (neighbor) y = Math.max(y - 0.3, neighbor.y);
  } else {
    x = Math.round(x * 2) / 2;
    z = Math.round(z * 2) / 2;
    y = terrainHeight(x, z, world.hash);
    const foundation = state.buildings.find(
      (b) => b.kind === 'foundation' && Math.abs(x - b.x) < 1.6 && Math.abs(z - b.z) < 1.6,
    );
    if (foundation) y = foundation.y;
  }
  return { kind, x, y, z, rotation };
}

export function validateBuild(
  state: GameState,
  world: WorldDefinition,
  p: PlayerState,
  b: Omit<Building, 'id' | 'owner'>,
): Result {
  const fail = (message: string) => ({ ok: false, message });
  if (state.buildings.length >= BALANCE.maxBuildings)
    return fail('This world has reached its building limit.');
  if (distance2(p.position, b) > BALANCE.buildRange || Math.abs(p.position.y - b.y) > 7)
    return fail('Move closer to build.');
  if (b.y < 1 || terrainHeight(b.x, b.z, world.hash) < 0.5) return fail('Find dry ground.');
  if (!p.dev.freeBuild && !canAfford(p.inventory, BUILDINGS[b.kind].cost))
    return fail('You need more materials.');
  if (b.kind === 'wall') {
    if (
      !state.buildings.some(
        (f) =>
          f.kind === 'foundation' &&
          Math.abs(f.y - b.y) < 0.01 &&
          Math.abs(distance2(f, b) - 2) < 0.01,
      )
    )
      return fail('Walls need a nearby foundation.');
  }
  const extent = b.kind === 'foundation' ? 1.95 : b.kind === 'wall' ? 0 : 0.8;
  if (b.kind === 'foundation') {
    const heights = [-2, 2].flatMap((dx) =>
      [-2, 2].map((dz) => terrainHeight(b.x + dx, b.z + dz, world.hash)),
    );
    if (Math.max(...heights) - Math.min(...heights) > 1.7) return fail('The ground is too steep.');
  }
  const overlaps = (x: number, z: number, radius: number) =>
    b.kind === 'wall'
      ? wallContains({ ...b, id: '', owner: '' }, x, z, radius)
      : Math.abs(x - b.x) < extent + radius && Math.abs(z - b.z) < extent + radius;
  for (const other of state.buildings) {
    if (other.kind === 'foundation' && b.kind !== 'foundation') continue;
    if (b.kind === 'foundation' && other.kind === 'wall') continue;
    if (Math.abs(b.x - other.x) < 0.1 && Math.abs(b.z - other.z) < 0.1)
      return fail('There is already a structure here.');
    if (
      b.kind !== 'wall' &&
      other.kind !== 'wall' &&
      overlaps(other.x, other.z, other.kind === 'foundation' ? 1.95 : 0.7)
    )
      return fail('Leave room between structures.');
    if (other.kind === 'wall' && wallContains(other, b.x, b.z, 0.7))
      return fail('A wall blocks this spot.');
  }
  for (const r of nearbyResources(world, b.x, b.z, 5)) {
    if (
      resourceIsActive(state, r.id) &&
      (RESOURCE_TYPES[r.kind].radius > 0 || r.kind === 'spring') &&
      overlaps(r.x, r.z, Math.max(0.9, RESOURCE_TYPES[r.kind].radius * r.scale))
    )
      return fail('Clear the trees or stone first.');
  }
  if (
    Object.values(state.players).some(
      (other) => other.health > 0 && overlaps(other.position.x, other.position.z, 0.45),
    )
  )
    return fail('A survivor is standing here.');
  return { ok: true, message: `Place ${BUILDINGS[b.kind].name.toLowerCase()}` };
}
