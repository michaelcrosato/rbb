import { z } from 'zod';
import { BALANCE, RESOURCE_TYPES } from './content';
import { transact } from './inventory';
import { lineOfSight, groundHeight, blocked } from './physics';
import type { GameState, PlayerState, Result } from './state';
import type { WorldDefinition } from './world';
import { terrainHeight } from './world';
import {
  brushSchema,
  commitTerrainEdit,
  planTerrainEdit,
  TERRAIN,
  terrainBodyClear,
  terrainDensity,
  terrainFloor,
  terrainRaycast,
} from './terrain';
import type { TerrainBrush, TerrainHit, TerrainPatch } from './terrain';

export const earthworkSchema = z
  .object({
    mode: z.enum(['dig', 'add', 'flatten']),
    level: z
      .number()
      .finite()
      .min(TERRAIN.minY + 2)
      .max(TERRAIN.maxY - 2),
  })
  .strict();
export type Earthwork = z.infer<typeof earthworkSchema>;

export function terrainAim(
  state: Pick<GameState, 'terrain'>,
  world: WorldDefinition,
  p: PlayerState,
): TerrainHit | null {
  return terrainRaycast(
    state.terrain,
    world,
    { x: p.position.x, y: p.position.y + BALANCE.eyeHeight, z: p.position.z },
    {
      x: -Math.sin(p.yaw) * Math.cos(p.pitch),
      y: Math.sin(p.pitch),
      z: -Math.cos(p.yaw) * Math.cos(p.pitch),
    },
    BALANCE.terrainReach,
  );
}

/** State copy shares untouched samples. It cannot change the authoritative terrain. */
export function previewTerrain(state: GameState, patch: TerrainPatch): GameState['terrain'] {
  const next = {
    ...state.terrain,
    samples: { ...state.terrain.samples },
    revision: state.terrain.revision + 1,
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next.samples[key];
    else next.samples[key] = value;
  }
  return next;
}

/** One atomic transaction for player and developer tools. No mutation on failure. */
export function editTerrain(
  state: GameState,
  world: WorldDefinition,
  p: PlayerState,
  brush: TerrainBrush,
  developer = false,
): Result {
  const parsed = brushSchema.safeParse(brush);
  if (!parsed.success) return { ok: false, message: 'Invalid terrain brush.' };
  const { patch, mass } = planTerrainEdit(state.terrain, world, parsed.data);
  if (!Object.keys(patch).length)
    return { ok: false, message: 'This brush would not change the terrain.' };
  const next = previewTerrain(state, patch);
  if (Object.keys(next.samples).length > TERRAIN.maxSamples)
    return {
      ok: false,
      message: 'Terrain edit capacity reached. Restore an edited area to free space.',
    };
  // Noclip is explicitly allowed to intersect terrain. All other survivors and
  // wildlife keep their current body space; digging under them permits falling.
  const raised: { player: PlayerState; y: number }[] = [];
  for (const other of Object.values(state.players)) {
    if (other.health <= 0 || other.dev.flight) continue;
    const { x, y, z } = other.position;
    if (Math.hypot(x - brush.x, y - brush.y, z - brush.z) > brush.radius * 2 + 4) continue;
    if (
      terrainBodyClear(state.terrain, world, x, y, z) &&
      !terrainBodyClear(next, world, x, y, z)
    ) {
      const feet = Math.max(
        y,
        ...[
          [0, 0],
          [0.33, 0],
          [-0.33, 0],
          [0, 0.33],
          [0, -0.33],
        ].map(([dx, dz]) => terrainFloor(next, world, x + dx, z + dz, y + 0.65)),
      );
      if (feet > y && feet <= y + 0.65 && !blocked({ ...state, terrain: next }, world, x, z, feet))
        raised.push({ player: other, y: feet });
      else return { ok: false, message: 'A survivor is in the fill area. Move aside first.' };
    }
  }
  for (const animal of state.animals) {
    if (
      animal.health > 0 &&
      Math.hypot(animal.x - brush.x, animal.y - brush.y, animal.z - brush.z) <
        brush.radius * 2 + 3 &&
      terrainBodyClear(state.terrain, world, animal.x, animal.y, animal.z, 0.4, 1) &&
      !terrainBodyClear(next, world, animal.x, animal.y, animal.z, 0.4, 1)
    )
      return { ok: false, message: 'Wildlife is in the fill area.' };
  }
  for (const b of state.buildings) {
    if (Math.hypot(b.x - brush.x, b.z - brush.z) > brush.radius * 2 + 5) continue;
    const width =
      b.kind === 'foundation' ? 1.9 : b.kind === 'wall' ? (b.rotation % 2 ? 0.1 : 1.9) : 0.6;
    const depth = b.kind === 'wall' ? (b.rotation % 2 ? 1.9 : 0.1) : width;
    const height = b.kind === 'wall' ? 3 : b.kind === 'foundation' ? 0.3 : 0.7;
    for (const dx of [-width, 0, width])
      for (const dz of [-depth, 0, depth]) {
        const x = b.x + dx,
          z = b.z + dz;
        for (let y = b.y + 0.1; y < b.y + height; y += 0.25) {
          if (
            terrainDensity(state.terrain, world, x, y, z) >= 0 &&
            terrainDensity(next, world, x, y, z) < -0.01
          )
            return { ok: false, message: 'The fill would bury a structure. Remove it first.' };
        }
        if (
          b.kind !== 'wall' &&
          terrainFloor(next, world, x, z, b.y + 0.1) <
            terrainFloor(state.terrain, world, x, z, b.y + 0.1) - 0.1
        )
          return { ok: false, message: 'This would undermine a structure. Remove it first.' };
      }
  }
  // Finite seeded resources stay anchored. Unearthing roots removes the node;
  // regrowth checks this same support rule, so caves cannot grow floating trees.
  const displaced: string[] = [];
  for (const r of world.resources) {
    // Include box corners and the interpolation border in this broad phase.
    if (Math.abs(r.x - brush.x) > brush.radius + 3 || Math.abs(r.z - brush.z) > brush.radius + 3)
      continue;
    const floor = terrainFloor(next, world, r.x, r.z, r.y + 0.6);
    if (Math.abs(floor - r.y) > 0.6 || terrainDensity(next, world, r.x, r.y + 0.5, r.z) < 0)
      displaced.push(r.id);
  }
  if (!developer) {
    const units = mass * BALANCE.dirtPerVolume;
    const cost = Math.max(0, Math.ceil(-units - 1e-7));
    const gain = Math.max(0, Math.floor(units + 1e-7));
    const transaction = transact(
      p.inventory,
      cost ? { dirt: cost } : {},
      gain ? { dirt: gain } : {},
    );
    if (!transaction.ok)
      return {
        ...transaction,
        message:
          cost && (p.inventory.dirt ?? 0) < cost
            ? `Need ${cost} dirt. Dig ground to collect fill material.`
            : transaction.message,
      };
    p.stamina = Math.max(0, p.stamina - BALANCE.terrainStamina);
    p.cooldown = BALANCE.terrainCooldown;
  }
  commitTerrainEdit(state.terrain, patch);
  for (const { player, y } of raised) {
    player.position.y = y;
    player.velocityY = 0;
  }
  state.tick++;
  for (const id of displaced)
    state.resources[id] = {
      health: 0,
      respawnAt: state.time + RESOURCE_TYPES[world.resourceMap.get(id)!.kind].respawn,
    };
  return {
    ok: true,
    message: `${brush.mode === 'dig' ? 'Terrain excavated' : brush.mode === 'add' ? 'Dirt deposited' : brush.mode === 'flatten' ? 'Ground leveled' : brush.mode === 'smooth' ? 'Terrain smoothed' : 'Seeded terrain restored'}.`,
  };
}

export function playerEarthwork(
  state: GameState,
  world: WorldDefinition,
  p: PlayerState,
  request: Earthwork,
): Result {
  const parsed = earthworkSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: 'Invalid terrain action.' };
  if (p.cooldown > 0) return { ok: false, message: 'Wait a moment.' };
  if (p.stamina < BALANCE.terrainStamina) return { ok: false, message: 'Rest to recover stamina.' };
  if (request.mode !== 'add' && (p.equipped !== 'pickaxe' || !p.inventory.pickaxe))
    return { ok: false, message: 'Equip a stone pickaxe to dig or flatten terrain.' };
  const hit = terrainAim(state, world, p);
  if (!hit || !lineOfSight(state, p, hit.point.x, hit.point.y, hit.point.z, world))
    return { ok: false, message: 'Aim at visible ground within 5 metres.' };
  if (request.mode === 'flatten' && Math.abs(hit.point.y - request.level) > BALANCE.terrainRadius)
    return { ok: false, message: 'Work closer to the chosen height, or sample a new level.' };
  const offset = request.mode === 'add' ? 0.65 : request.mode === 'dig' ? -0.45 : 0;
  return editTerrain(state, world, p, {
    mode: request.mode,
    shape: 'sphere',
    radius: BALANCE.terrainRadius,
    strength: 1,
    x: hit.point.x + hit.normal.x * offset,
    y: hit.point.y + hit.normal.y * offset,
    z: hit.point.z + hit.normal.z * offset,
    level: request.level,
  });
}

export function resourceSupported(
  state: GameState,
  world: WorldDefinition,
  r: { x: number; y: number; z: number },
): boolean {
  return (
    Math.abs(terrainFloor(state.terrain, world, r.x, r.z, r.y + 0.6) - r.y) < 0.6 &&
    terrainDensity(state.terrain, world, r.x, r.y + 0.5, r.z) >= 0
  );
}

/** Respawn is a placement operation too; old bedroll coordinates may be buried. */
export function safeTerrainSpawn(
  state: GameState,
  world: WorldDefinition,
  position: PlayerState['position'],
): PlayerState['position'] {
  for (const [dx, dz] of [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ]) {
    const x = position.x + dx,
      z = position.z + dz;
    const near = groundHeight(state, world, x, z, position.y + 0.65);
    if (near >= -1.2 && !blocked(state, world, x, z, near)) return { x, y: near, z };
    const top = groundHeight(state, world, x, z);
    if (!blocked(state, world, x, z, Math.max(top, -1.2))) return { x, y: Math.max(top, -1.2), z };
  }
  return {
    x: 0,
    y: Math.max(terrainFloor(state.terrain, world, 0, 86), terrainHeight(0, 86, world.hash)),
    z: 86,
  };
}
