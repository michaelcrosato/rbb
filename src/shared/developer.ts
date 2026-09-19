import { z } from 'zod';
import { ITEM_IDS, SPECIES_IDS } from './content';
import { setWeather, tuningSchema, WEATHER_IDS } from './environment';
import { carryCapacity, transact } from './inventory';
import { normalizeEquipment } from './equipment';
import { damageStructure } from './structures';
import { groundHeight } from './physics';
import { brushSchema } from './terrain';
import { editTerrain, safeTerrainSpawn } from './earthworks';
import { idleInput } from './state';
import type { GameState, PlayerState, Result } from './state';
import { spawnWildlife } from './wildlife';
import type { WorldDefinition } from './world';

export const developerSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('terrain'), brush: brushSchema }).strict(),
  z
    .object({
      action: z.literal('ground'),
      wetness: z.number().finite().min(0).max(1),
      snowCover: z.number().finite().min(0).max(1),
    })
    .strict(),
  z.object({ action: z.literal('step'), ticks: z.number().int().min(1).max(300) }).strict(),
  z.object({ action: z.literal('configure'), tuning: tuningSchema }).strict(),
  z.object({ action: z.literal('time'), hour: z.number().finite().min(0).max(23.999) }).strict(),
  z
    .object({ action: z.literal('weather'), weather: z.enum(WEATHER_IDS), instant: z.boolean() })
    .strict(),
  z.object({ action: z.literal('heal') }).strict(),
  z.object({ action: z.literal('kit') }).strict(),
  z
    .object({
      action: z.literal('grant'),
      item: z.enum(ITEM_IDS),
      count: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal('teleport'),
      x: z.number().finite().min(-310).max(310),
      z: z.number().finite().min(-310).max(310),
    })
    .strict(),
  z
    .object({
      action: z.literal('flag'),
      flag: z.enum(['invincible', 'flight', 'freeBuild']),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('spawn'),
      species: z.enum(SPECIES_IDS),
      count: z.number().int().min(1).max(10),
    })
    .strict(),
  z.object({ action: z.literal('remove'), id: z.string().min(1).max(64) }).strict(),
  z.object({ action: z.literal('regrow') }).strict(),
]);
export type DeveloperAction = z.infer<typeof developerSchema>;
/** Only called after the simulation's host-controlled capability check. */
export function developerAction(
  state: GameState,
  world: WorldDefinition,
  p: PlayerState,
  action: DeveloperAction,
): Result {
  const ok = (message: string): Result => {
    state.sandbox = true;
    state.tick++;
    return { ok: true, message };
  };
  switch (action.action) {
    case 'terrain': {
      const result = editTerrain(state, world, p, action.brush, true);
      if (result.ok) state.sandbox = true;
      return result;
    }
    case 'ground':
      state.environment.wetness = action.wetness;
      state.environment.snowCover = action.snowCover;
      return ok('Surface state applied.');
    case 'step':
      return { ok: false, message: 'Stepping is handled by the simulation.' };
    case 'configure':
      state.tuning = { ...action.tuning };
      return ok('World tuning applied.');
    case 'time':
      state.environment.hours = Math.floor(state.environment.hours / 24) * 24 + action.hour;
      return ok('Sky time updated.');
    case 'weather':
      setWeather(
        state.environment,
        action.weather,
        action.instant ? 0 : state.tuning.weatherTransition,
      );
      return ok(`Weather: ${action.weather}.`);
    case 'heal':
      p.health = p.hunger = p.thirst = p.stamina = p.oxygen = 100;
      return ok('Vitals restored.');
    case 'kit': {
      // An explicit replacement keeps kits repeatable and under the standard carry limit.
      p.inventory = {
        dirt: 100,
        rock: 1,
        hatchet: 1,
        pickaxe: 1,
        wood: 50,
        stone: 30,
        fiber: 30,
        berries: 10,
        bandage: 5,
      };
      normalizeEquipment(p);
      return ok('Playtest kit loaded. Pack replaced.');
    }
    case 'grant': {
      const result = transact(p.inventory, {}, { [action.item]: action.count }, carryCapacity(p));
      return result.ok ? ok(`Granted ${action.count} ${action.item}.`) : result;
    }
    case 'teleport': {
      p.position = {
        x: action.x,
        z: action.z,
        y: Math.max(-1.2, groundHeight(state, world, action.x, action.z)) + 0.05,
      };
      p.velocityY = 0;
      p.input = idleInput();
      p.grounded = true;
      return ok('Teleported.');
    }
    case 'flag':
      p.dev[action.flag] = action.value;
      if (action.flag === 'flight') {
        p.velocityY = 0;
        if (!action.value) p.position = safeTerrainSpawn(state, world, p.position);
      }
      return ok(`${action.flag}: ${action.value ? 'on' : 'off'}.`);
    case 'spawn': {
      const n = spawnWildlife(
        state,
        world,
        action.species,
        action.count,
        p.position.x,
        p.position.z,
      );
      return n
        ? ok(`Spawned ${n} ${action.species}.`)
        : { ok: false, message: 'No suitable habitat nearby, or wildlife limit reached (96).' };
    }
    case 'remove': {
      if (state.buildings.some((b) => b.id === action.id))
        return damageStructure(state, world, action.id, 1e8)
          ? ok('Structure and attached pieces removed. Stored supplies dropped.')
          : { ok: false, message: 'Collect ground supplies before removing occupied storage.' };
      const before = state.animals.length + state.buildings.length + state.bags.length;
      state.animals = state.animals.filter((a) => a.id !== action.id);
      state.bags = state.bags.filter((b) => b.id !== action.id);
      return before !== state.animals.length + state.buildings.length + state.bags.length
        ? ok('Entity removed. Checkpoint can restore it.')
        : { ok: false, message: 'Entity was not found.' };
    }
    case 'regrow': {
      for (const [id, resource] of Object.entries(state.resources))
        if (
          resource.health <= 0 &&
          !Object.keys(state.sites).some(
            (siteId) => state.sites[siteId].disabled && id.startsWith(`${siteId}-node-`),
          )
        )
          resource.respawnAt = state.time;
      return ok('Regrowth queued. Occupied and built areas stay clear.');
    }
  }
}
