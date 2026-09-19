import { SPECIES_IDS, WILDLIFE, RESOURCE_TYPES } from './content';
import type { Species } from './content';
import { clamp, distance2, random } from './math';
import { groundHeight, lineOfSight } from './physics';
import { terrainBodyClear, terrainFloor, terrainIndex, TERRAIN } from './terrain';
import type { Animal, GameState, PlayerState } from './state';
import { SPAWN, terrainHeight, nearbyResources } from './world';
import type { WorldDefinition } from './world';
import { structureSolids } from './structure-geometry';
import { siteSolids } from './site-generation';
import { bodyIntersects } from './spatial';
import { damageStructure } from './structures';

export const MAX_ANIMALS = 96;
export function habitatValid(
  world: WorldDefinition,
  species: Species,
  x: number,
  z: number,
  state?: GameState,
  below: number = TERRAIN.maxY,
): boolean {
  if (Math.abs(x) > 312 || Math.abs(z) > 312) return false;
  const height = (x: number, z: number) =>
    state ? terrainFloor(state.terrain, world, x, z, below) : terrainHeight(x, z, world.hash);
  const h = height(x, z);
  if (WILDLIFE[species].habitat === 'sea') return h < (species === 'dolphin' ? -4 : -2);
  return h > 1.5 && Math.abs(height(x + 1, z) - h) < 1.2 && Math.abs(height(x, z + 1) - h) < 1.2;
}
export function animalAt(
  world: WorldDefinition,
  species: Species,
  id: string,
  x: number,
  z: number,
): Animal {
  const sea = WILDLIFE[species].habitat === 'sea';
  return {
    id,
    species,
    x,
    z,
    y: sea ? -0.9 : terrainHeight(x, z, world.hash),
    homeX: x,
    homeZ: z,
    yaw: 0,
    health: WILDLIFE[species].health,
    cooldown: 0,
    respawnAt: 0,
    behavior: 'roam',
  };
}
export function populateWildlife(world: WorldDefinition): Animal[] {
  const rng = random(world.hash + 1234),
    animals: Animal[] = [];
  for (const species of SPECIES_IDS) {
    for (let i = 0; i < WILDLIFE[species].count; i++) {
      for (let attempt = 0; attempt < 300; attempt++) {
        let x = (rng() - 0.5) * 580,
          z = (rng() - 0.5) * 580;
        const neighbor = animals.at(-1);
        if (
          (species === 'deer' || species === 'fish') &&
          i % 3 &&
          attempt < 150 &&
          neighbor?.species === species
        ) {
          x = neighbor.homeX + (rng() - 0.5) * 12;
          z = neighbor.homeZ + (rng() - 0.5) * 12;
        }
        if (!habitatValid(world, species, x, z) || distance2({ x, z }, SPAWN) < 45) continue;
        animals.push(animalAt(world, species, `${species}${i}`, x, z));
        break;
      }
    }
  }
  return animals;
}
export function spawnWildlife(
  state: GameState,
  world: WorldDefinition,
  species: Species,
  count: number,
  x: number,
  z: number,
): number {
  const rng = random(world.hash + state.nextId * 997);
  let spawned = 0;
  for (
    let attempt = 0;
    attempt < 160 && spawned < count && state.animals.length < MAX_ANIMALS;
    attempt++
  ) {
    const angle = rng() * Math.PI * 2,
      distance = 5 + rng() * 28;
    const ax = x + Math.sin(angle) * distance,
      az = z + Math.cos(angle) * distance;
    if (
      !habitatValid(world, species, ax, az, state) ||
      state.buildings.some((b) => distance2(b, { x: ax, z: az }) < 4)
    )
      continue;
    const animal = animalAt(world, species, `a${state.nextId++}`, ax, az);
    if (WILDLIFE[species].habitat === 'land') animal.y = terrainFloor(state.terrain, world, ax, az);
    state.animals.push(animal);
    spawned++;
  }
  return spawned;
}

export function stepWildlife(
  state: GameState,
  world: WorldDefinition,
  players: PlayerState[],
  dt: number,
  hurt: (p: PlayerState, damage: number, name: string) => void,
): void {
  for (const animal of state.animals) {
    const def = WILDLIFE[animal.species],
      sea = def.habitat === 'sea';
    if (animal.health <= 0) {
      if (
        animal.respawnAt > state.time ||
        !habitatValid(world, animal.species, animal.homeX, animal.homeZ, state) ||
        state.buildings.some((b) => distance2(b, { x: animal.homeX, z: animal.homeZ }) < 4) ||
        players.some((p) => distance2(p.position, { x: animal.homeX, z: animal.homeZ }) < 12)
      )
        continue;
      animal.health = def.health;
      animal.x = animal.homeX;
      animal.z = animal.homeZ;
      animal.y = terrainFloor(state.terrain, world, animal.x, animal.z);
    }
    animal.cooldown = Math.max(0, animal.cooldown - dt);
    const aggressive = def.damage > 0 && state.tuning.wildlifeAggression > 0;
    const alert = aggressive ? 12 * state.tuning.wildlifeAggression : 10;
    const threats = players.filter(
      (p) =>
        p.health > 0 &&
        distance2(p.position, animal) < alert &&
        Math.abs(p.position.y - animal.y) < 5,
    );
    const target = threats.sort(
      (a, b) => distance2(a.position, animal) - distance2(b.position, animal),
    )[0];
    // Predators also make nearby prey flee. Hunting players remains territorial and bounded.
    const predator =
      !sea && !aggressive
        ? state.animals.find(
            (a) => a.species === 'wolf' && a.health > 0 && distance2(a, animal) < 8,
          )
        : undefined;
    const threat = target?.position ?? predator;
    const chase =
      aggressive && target && distance2(target.position, { x: animal.homeX, z: animal.homeZ }) < 32;
    const flee = !!threat && !aggressive && !sea;
    const angle = state.time * (sea ? 0.09 : 0.12) + animal.homeX * 0.13;
    const roamRadius = sea ? 14 : 6;
    let tx = animal.homeX + Math.sin(angle) * roamRadius,
      tz = animal.homeZ + Math.cos(angle) * roamRadius;
    if (chase) {
      tx = target.position.x;
      tz = target.position.z;
    }
    if (flee) {
      tx = animal.x + (animal.x - threat.x) * 2;
      tz = animal.z + (animal.z - threat.z) * 2;
    }
    const dist = Math.hypot(tx - animal.x, tz - animal.z);
    animal.behavior = chase ? 'chase' : flee ? 'flee' : 'roam';
    if (dist > (chase ? 1.5 : 0.4)) {
      animal.yaw = Math.atan2(tx - animal.x, tz - animal.z);
      const speed = def.speed * (chase || flee || sea ? 1 : 0.23) * state.tuning.wildlifeSpeed;
      const stride = Math.min(dist, speed * dt);
      // Try a tangent when a shoreline, steep slope or structure blocks the desired direction.
      for (const offset of [0, Math.PI / 2, -Math.PI / 2]) {
        const x = animal.x + Math.sin(animal.yaw + offset) * stride,
          z = animal.z + Math.cos(animal.yaw + offset) * stride;
        const terrain = terrainFloor(
          state.terrain,
          world,
          x,
          z,
          sea ? TERRAIN.maxY : animal.y + 0.65,
        );
        if (
          !habitatValid(world, animal.species, x, z, state, sea ? TERRAIN.maxY : animal.y + 0.65) ||
          (!sea &&
            (Math.abs(terrain - animal.y) > 1.5 ||
              (terrainIndex(state.terrain).columns.has(`${Math.floor(x)},${Math.floor(z)}`) &&
                !terrainBodyClear(state.terrain, world, x, terrain, z, def.radius * 0.5, 1.2)) ||
              groundHeight(state, world, x, z, animal.y + 0.65) - terrain > 0.2 ||
              state.buildings.some(
                (b) =>
                  Math.hypot(b.x - x, b.z - z) < 4 &&
                  structureSolids(b).some((s) =>
                    bodyIntersects(s, x, terrain, z, def.radius * 0.5, 1.2),
                  ),
              ) ||
              world.sites.some(
                (site) =>
                  Math.abs(site.x - x) < 4 &&
                  Math.abs(site.z - z) < 4 &&
                  !state.sites[site.id]?.disabled &&
                  siteSolids(site).some((s) =>
                    bodyIntersects(s, x, terrain, z, def.radius * 0.5, 1.2),
                  ),
              )))
        )
          continue;
        if (
          !sea &&
          nearbyResources(world, x, z, 3).some(
            (r) =>
              RESOURCE_TYPES[r.kind].radius > 0 &&
              (!state.resources[r.id] || state.resources[r.id].health > 0) &&
              Math.abs(r.y - animal.y) < 2 &&
              distance2(r, { x, z }) < RESOURCE_TYPES[r.kind].radius * r.scale + def.radius * 0.5,
          )
        )
          continue;
        animal.x = x;
        animal.z = z;
        animal.yaw += offset;
        break;
      }
    }
    const ground = terrainFloor(
      state.terrain,
      world,
      animal.x,
      animal.z,
      sea ? TERRAIN.maxY : animal.y + 0.65,
    );
    animal.y = sea
      ? clamp(
          -1.1 +
            Math.sin(state.time * 0.7 + animal.homeX) *
              (animal.species === 'dolphin' ? 1.45 : 0.35),
          ground + 0.7,
          animal.species === 'dolphin' ? 0.35 : -0.5,
        )
      : ground;
    if (
      chase &&
      dist < 2 &&
      Math.abs(target.position.y - animal.y) < 1.8 &&
      animal.cooldown <= 0 &&
      lineOfSight(state, target, animal.x, animal.y + 0.5, animal.z, world)
    ) {
      hurt(target, def.damage * state.tuning.damage, def.name);
      animal.cooldown = 1.4;
    } else if (chase && animal.cooldown <= 0 && !sea) {
      const obstruction = state.buildings.find(
        (b) =>
          Math.hypot(b.x - animal.x, b.z - animal.z) < 4 &&
          structureSolids(b).some((s) =>
            bodyIntersects(
              s,
              animal.x + Math.sin(animal.yaw) * 0.7,
              animal.y,
              animal.z + Math.cos(animal.yaw) * 0.7,
              def.radius,
              1.2,
            ),
          ),
      );
      if (
        obstruction &&
        damageStructure(state, world, obstruction.id, def.damage * state.tuning.damage)
      )
        animal.cooldown = 1.4;
    }
  }
}
