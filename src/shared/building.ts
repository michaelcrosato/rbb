import { BALANCE, BUILDINGS, RESOURCE_TYPES } from './content';
import type { BuildingKind } from './content';
import { canAfford } from './inventory';
import { distance2 } from './math';
import { lineOfSight } from './physics';
import { terrainBodyClear, terrainFloor, terrainSurfaces, TERRAIN } from './terrain';
import { resourceIsActive } from './state';
import type { BuildingPlacement, GameState, PlayerState, Result, Vec3 } from './state';
import { nearbyResources, WORLD_HALF } from './world';
import type { WorldDefinition } from './world';
import { isPlatform, isUpper, isWall, structureSolids } from './structure-geometry';
import { bodyIntersects, containsXZ, solidsOverlap } from './spatial';
import { siteSolids } from './site-generation';

export function buildCandidate(
  state: GameState,
  world: WorldDefinition,
  kind: BuildingKind,
  x: number,
  z: number,
  rotation: number,
  referenceY: number = TERRAIN.maxY,
  origin?: Vec3,
): BuildingPlacement {
  const ground = (x: number, z: number) =>
    terrainSurfaces(state.terrain, world, x, z)
      .filter((s) => s.floor)
      .sort((a, b) => Math.abs(a.y - referenceY) - Math.abs(b.y - referenceY))[0]?.y ??
    TERRAIN.minY;
  rotation = ((rotation % 4) + 4) % 4;
  let y = ground(x, z),
    support: string | null = null;
  const platforms = state.buildings
    .filter((b) => isPlatform(b.kind) && b.y <= referenceY + 0.5)
    .sort(
      (a, b) =>
        distance2(a, { x, z }) +
        Math.abs(a.y - referenceY) -
        distance2(b, { x, z }) -
        Math.abs(b.y - referenceY),
    );
  // Inside a room, walls/ceilings belong to the floor underfoot. This also avoids
  // a fixed placement ray overshooting a 4 m platform when viewed from its centre.
  const underfoot = origin
    ? platforms.find(
        (b) =>
          Math.abs(origin.x - b.x) < 1.95 &&
          Math.abs(origin.z - b.z) < 1.95 &&
          Math.abs(origin.y - b.y) < 0.8,
      )
    : undefined;
  const platform = underfoot ?? platforms.find((b) => distance2(b, { x, z }) < 5);
  if (kind === 'door') {
    const frame = state.buildings
      .filter((b) => b.kind === 'doorway' && distance2(b, { x, z }) < 5)
      .sort(
        (a, b) =>
          distance2(a, { x, z }) +
          Math.abs(a.y - referenceY) -
          distance2(b, { x, z }) -
          Math.abs(b.y - referenceY),
      )[0];
    if (frame) {
      x = frame.x;
      y = frame.y;
      z = frame.z;
      rotation = frame.rotation;
      support = frame.id;
    }
  } else if (isWall(kind) && platform) {
    x = platform.x + (rotation === 1 ? 2 : rotation === 3 ? -2 : 0);
    z = platform.z + (rotation === 0 ? -2 : rotation === 2 ? 2 : 0);
    y = platform.y;
    support = platform.id;
  } else if (isUpper(kind) && platform) {
    x = platform.x;
    z = platform.z;
    y = platform.y + 3;
    support = state.buildings.find((b) => isWall(b.kind) && b.support === platform.id)?.id ?? null;
  } else if (kind === 'stairs' && platform) {
    x = platform.x;
    z = platform.z;
    y = platform.y;
    support = platform.id;
  } else if (kind === 'foundation') {
    x = Math.round(x / 4) * 4;
    z = Math.round(z / 4) * 4;
    y = Math.max(...[-2, 2].flatMap((dx) => [-2, 2].map((dz) => ground(x + dx, z + dz)))) + 0.3;
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
    y = ground(x, z);
    const under = platforms.find((b) => Math.abs(x - b.x) < 1.6 && Math.abs(z - b.z) < 1.6);
    if (under) {
      y = under.y;
      support = under.id;
    }
  }
  return { kind, x, y, z, rotation, support };
}

export function validateBuild(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  building: BuildingPlacement,
): Result {
  const fail = (message: string): Result => ({ ok: false, message });
  const b = building;
  if (state.buildings.length >= BALANCE.maxBuildings)
    return fail('This world has reached its building limit.');
  if (
    Math.abs(b.x) > WORLD_HALF - 3 ||
    Math.abs(b.z) > WORLD_HALF - 3 ||
    distance2(player.position, b) > BALANCE.buildRange ||
    Math.abs(player.position.y - b.y) > 7
  )
    return fail('Move closer to build.');
  if (b.y < 1 || terrainFloor(state.terrain, world, b.x, b.z, b.y + 0.1) < 0.5)
    return fail('Find dry ground.');
  if (
    !lineOfSight(
      state,
      player,
      b.x,
      b.y + (isWall(b.kind) ? 1.5 : 0.5),
      b.z,
      world,
      b.kind === 'door' ? (b.support ?? undefined) : undefined,
    )
  )
    return fail('Terrain or a structure blocks this spot.');
  if (!player.dev.freeBuild && !canAfford(player.inventory, BUILDINGS[b.kind].cost))
    return fail('You need more materials.');
  const support = state.buildings.find((s) => s.id === b.support);
  if ((isWall(b.kind) || b.kind === 'stairs') && (!support || !isPlatform(support.kind)))
    return fail('Walls and stairs need a nearby foundation or upper floor.');
  if (isUpper(b.kind) && (!support || !isWall(support.kind)))
    return fail('Build a supporting wall on the storey below first.');
  if (b.kind === 'door' && support?.kind !== 'doorway') return fail('Doors need an empty doorway.');
  let root = support,
    depth = 0;
  while (root?.support && depth++ < BALANCE.maxBuildings)
    root = state.buildings.find((s) => s.id === root!.support);
  // The last usable floor still needs a roof one storey above it.
  const maximumHeight = (BALANCE.maxStoreys - (b.kind === 'roof' ? 0 : 1)) * 3;
  if (root && b.y - root.y > maximumHeight + 0.01)
    return fail(`Build up to ${BALANCE.maxStoreys} storeys above a foundation.`);
  if (b.kind === 'foundation') {
    const heights = [-2, 2].flatMap((dx) =>
      [-2, 2].map((dz) => terrainFloor(state.terrain, world, b.x + dx, b.z + dz, b.y + 0.1)),
    );
    if (Math.max(...heights) - Math.min(...heights) > 1.7) return fail('The ground is too steep.');
  }
  const solids = structureSolids(b);
  for (const solid of solids) {
    for (const dx of [-solid.width / 2 + 0.03, 0, solid.width / 2 - 0.03])
      for (const dz of [-solid.depth / 2 + 0.03, 0, solid.depth / 2 - 0.03])
        if (
          !terrainBodyClear(
            state.terrain,
            world,
            solid.x + dx,
            Math.max(b.y, solid.y - solid.height / 2),
            solid.z + dz,
            0,
            Math.max(0.1, solid.y + solid.height / 2 - Math.max(b.y, solid.y - solid.height / 2)),
          )
        )
          return fail('Excavate more room for this structure.');
    for (const other of state.buildings) {
      // Edge pieces join at their corners; doorway frames surround their door.
      if (
        other.id === b.support ||
        (isWall(b.kind) && isWall(other.kind) && distance2(b, other) > 0.5)
      )
        continue;
      // Ceiling slabs join all wall tops around their room, not only the one
      // recorded as their structural parent. The reverse permits infill walls.
      if (
        Math.abs(distance2(b, other) - 2) < 0.01 &&
        ((isUpper(b.kind) && isWall(other.kind) && Math.abs(b.y - other.y - 3) < 0.01) ||
          (isWall(b.kind) && isUpper(other.kind) && Math.abs(other.y - b.y - 3) < 0.01))
      )
        continue;
      if (
        ((b.kind === 'stairs' &&
          other.kind === 'stairwell' &&
          Math.abs(other.y - b.y - 3) < 0.01) ||
          (b.kind === 'stairwell' &&
            other.kind === 'stairs' &&
            Math.abs(b.y - other.y - 3) < 0.01)) &&
        b.rotation === other.rotation &&
        distance2(b, other) < 0.01
      )
        continue;
      if (structureSolids(other).some((s) => solidsOverlap(solid, s)))
        return fail('There is already a structure here. Leave room between pieces.');
    }
    if (
      world.sites.some(
        (site) =>
          !state.sites[site.id]?.disabled && siteSolids(site).some((s) => solidsOverlap(solid, s)),
      )
    )
      return fail('Leave room around the landmark.');
    for (const r of nearbyResources(world, solid.x, solid.z, 5)) {
      const radius = Math.max(r.kind === 'spring' ? 1 : 0, RESOURCE_TYPES[r.kind].radius * r.scale);
      if (
        radius &&
        resourceIsActive(state, r.id) &&
        r.y < solid.y + solid.height / 2 &&
        r.y + (r.kind === 'tree' ? 8 : 2) > solid.y - solid.height / 2 &&
        containsXZ(solid, r.x, r.z, radius)
      )
        return fail('Clear the trees or stone first.');
    }
    if (
      Object.values(state.players).some(
        (p) =>
          p.health > 0 && bodyIntersects(solid, p.position.x, p.position.y, p.position.z, 0.45),
      )
    )
      return fail('A survivor is standing here.');
    if (state.animals.some((a) => a.health > 0 && bodyIntersects(solid, a.x, a.y, a.z, 0.45, 1)))
      return fail('Wildlife is standing here.');
    if (state.bags.some((bag) => bodyIntersects(solid, bag.x, bag.y, bag.z, 0.25, 0.4)))
      return fail('Collect the ground supplies first.');
  }
  return { ok: true, message: `Place ${BUILDINGS[b.kind].name.toLowerCase()}` };
}
