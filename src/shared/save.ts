import { z } from 'zod';
import {
  BALANCE,
  BUILDING_IDS,
  ITEM_IDS,
  MAX_WEIGHT,
  RESOURCE_TYPES,
  SPECIES_IDS,
  WILDLIFE,
  GRADE_IDS,
  STRUCTURE_GRADES,
  EQUIPMENT,
} from './content';
import type { MilestoneId } from './content';
import { carryCapacity, inventoryWeight } from './inventory';
import { moveSchema } from './movement';
import { createBuilding, idleInput } from './state';
import type { GameState } from './state';
import { WORLD_HALF, WORLD_VERSION, generateWorld } from './world';
import { createEnvironment, DEFAULT_TUNING, environmentSchema, tuningSchema } from './environment';
import { populateWildlife, MAX_ANIMALS } from './wildlife';
import { emptyTerrain, terrainSchema, TERRAIN } from './terrain';
import { siteLoot } from './site-generation';
import { compatibleSites } from './sites';
import type { WorldDefinition } from './world';

// Save validation only reads generated definitions. Keep a small private cache so
// periodic persistence never regenerates thousands of immutable props.
const saveWorlds = new Map<string, WorldDefinition>();
function saveWorld(seed: string): WorldDefinition {
  let world = saveWorlds.get(seed);
  if (!world) {
    if (saveWorlds.size >= 8) saveWorlds.delete(saveWorlds.keys().next().value!);
    world = generateWorld(seed);
    saveWorlds.set(seed, world);
  }
  return world;
}

export const MAX_SAVE_BYTES = 16_000_000;
// Bounds follow the content registry so a balance change cannot silently invalidate saves.
const maxResourceHealth = Math.max(...Object.values(RESOURCE_TYPES).map((r) => r.health));
const maxAnimalHealth = Math.max(...Object.values(WILDLIFE).map((w) => w.health));
const finite = z.number().finite();
const positive = finite.min(0).max(1e12);
const id = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
  .refine((s) => s !== 'constructor' && s !== 'prototype');
const stat = finite.min(0).max(100);
const position = z
  .object({
    x: finite.min(-WORLD_HALF).max(WORLD_HALF),
    y: finite.min(TERRAIN.minY).max(160),
    z: finite.min(-WORLD_HALF).max(WORLD_HALF),
  })
  .strict();
export const inventorySchema = z
  .partialRecord(z.enum(ITEM_IDS), z.number().int().min(1).max(10000))
  .refine((v) => inventoryWeight(v) <= MAX_WEIGHT + 0.001, 'Inventory exceeds carry capacity');
const playerSchema = z
  .object({
    id,
    name: z.string().min(1).max(24),
    position,
    velocityY: finite.min(-100).max(20),
    yaw: finite,
    pitch: finite.min(-1.5).max(1.5),
    health: stat,
    hunger: stat,
    thirst: stat,
    stamina: stat,
    oxygen: stat.default(100),
    inventory: inventorySchema,
    equipped: z.enum(ITEM_IDS),
    cooldown: finite.min(0).max(10),
    grounded: z.boolean(),
    milestones: z
      .object({
        gather: positive,
        craft: positive,
        build: positive,
        camp: positive,
      } satisfies Record<MilestoneId, typeof positive>)
      .strict(),
    respawn: position,
    deaths: positive.int(),
    input: moveSchema,
    dev: z
      .object({ invincible: z.boolean(), flight: z.boolean(), freeBuild: z.boolean() })
      .strict(),
  })
  .strict();
const v3StateSchema = z
  .object({
    version: z.literal(3),
    terrain: terrainSchema,
    environment: environmentSchema,
    tuning: tuningSchema,
    sandbox: z.boolean(),
    worldVersion: z.literal(WORLD_VERSION),
    seed: z
      .string()
      .min(1)
      .max(48)
      .regex(/^[\p{L}\p{N} _-]+$/u),
    tick: positive.int(),
    time: positive,
    nextId: positive.int().min(1),
    players: z
      .record(id, playerSchema)
      .refine((p) => Object.keys(p).length <= BALANCE.maxSurvivors)
      .refine((p) => Object.entries(p).every(([key, v]) => key === v.id)),
    resources: z
      .record(
        id,
        z.object({ health: finite.min(0).max(maxResourceHealth), respawnAt: positive }).strict(),
      )
      .refine((r) => Object.keys(r).length <= 3000),
    buildings: z
      .array(
        z
          .object({
            id,
            kind: z.enum(BUILDING_IDS),
            owner: id,
            x: position.shape.x,
            y: position.shape.y,
            z: position.shape.z,
            rotation: z.number().int().min(0).max(3),
          })
          .strict(),
      )
      .max(BALANCE.maxBuildings),
    bags: z
      .array(
        z
          .object({
            id,
            owner: z.union([id, z.literal('')]),
            x: position.shape.x,
            y: position.shape.y,
            z: position.shape.z,
            inventory: inventorySchema,
            expiresAt: positive,
          })
          .strict(),
      )
      .max(BALANCE.maxBags),
    animals: z
      .array(
        z
          .object({
            id,
            x: position.shape.x,
            y: position.shape.y,
            z: position.shape.z,
            species: z.enum(SPECIES_IDS),
            behavior: z.enum(['roam', 'flee', 'chase']),
            homeX: position.shape.x,
            homeZ: position.shape.z,
            yaw: finite,
            health: finite.min(0).max(maxAnimalHealth),
            cooldown: finite.min(0).max(5),
            respawnAt: positive,
          })
          .strict(),
      )
      .max(MAX_ANIMALS),
  })
  .strict();

const rawInventory = z.partialRecord(z.enum(ITEM_IDS), z.number().int().min(1).max(10000));
const containerInventory = rawInventory.refine(
  (v) => inventoryWeight(v) <= BALANCE.storageCapacity + 0.001,
  'Container exceeds capacity',
);
const currentPlayerSchema = playerSchema
  .extend({
    inventory: rawInventory,
    worn: z
      .object({ armor: z.enum(ITEM_IDS).nullable(), backpack: z.enum(ITEM_IDS).nullable() })
      .strict(),
    quickSlots: z.array(z.enum(ITEM_IDS)).length(5),
  })
  .refine(
    (p) =>
      inventoryWeight(p.inventory) <= carryCapacity(p) + 0.001 &&
      (['armor', 'backpack'] as const).every(
        (slot) =>
          p.worn[slot] === null ||
          (p.inventory[p.worn[slot]!] && EQUIPMENT[p.worn[slot]!]?.slot === slot),
      ),
    'Invalid equipped inventory',
  );
export const stateSchema = v3StateSchema.extend({
  version: z.literal(4),
  players: z
    .record(id, currentPlayerSchema)
    .refine(
      (p) =>
        Object.keys(p).length <= BALANCE.maxSurvivors &&
        Object.entries(p).every(([key, p]) => key === p.id),
    ),
  buildings: z
    .array(
      v3StateSchema.shape.buildings.element
        .extend({
          grade: z.enum(GRADE_IDS),
          health: finite.min(0.001).max(STRUCTURE_GRADES.metal.health),
          open: z.boolean(),
          inventory: containerInventory,
          support: id.nullable(),
        })
        .refine(
          (b) =>
            b.health <= STRUCTURE_GRADES[b.grade].health &&
            (b.kind === 'storage' || Object.keys(b.inventory).length === 0) &&
            (b.kind === 'door' || !b.open),
        ),
    )
    .max(BALANCE.maxBuildings),
  bags: z
    .array(v3StateSchema.shape.bags.element.extend({ inventory: containerInventory }))
    .max(BALANCE.maxBags),
  sites: z
    .record(
      id,
      z
        .object({
          inventory: containerInventory,
          cycle: positive.int(),
          restockAt: positive,
          disabled: z.boolean(),
        })
        .strict(),
    )
    .refine((s) => Object.keys(s).length <= 6),
});

const v2StateSchema = v3StateSchema
  .omit({ terrain: true })
  .extend({ version: z.literal(2) })
  .strict();
const legacyStateSchema = v2StateSchema
  .omit({ environment: true, tuning: true, sandbox: true })
  .extend({
    version: z.literal(1),
    players: z
      .record(id, playerSchema.omit({ dev: true, oxygen: true }))
      .refine(
        (p) =>
          Object.keys(p).length <= 512 &&
          Object.entries(p).every(([key, value]) => key === value.id),
      ),
    animals: z
      .array(
        v3StateSchema.shape.animals.element
          .omit({ species: true, behavior: true })
          .extend({ health: finite.min(0).max(60) }),
      )
      .max(64),
  })
  .strict();

export interface SaveFile {
  format: 'rbb-save';
  version: 4;
  savedAt: string;
  playerId: string;
  state: GameState;
}
const saveSchema = z
  .object({
    format: z.literal('rbb-save'),
    version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    savedAt: z.iso.datetime(),
    playerId: id,
    state: z.unknown(),
  })
  .strict();

export function parseState(value: unknown): GameState {
  const legacy =
    typeof value === 'object' && value !== null && 'version' in value && value.version === 1
      ? legacyStateSchema.parse(value)
      : null;
  const migrated = legacy
    ? {
        ...legacy,
        version: 2,
        environment: createEnvironment((legacy.time / 1200) * 24 + 6),
        tuning: { ...DEFAULT_TUNING },
        sandbox: false,
        players: Object.fromEntries(
          Object.entries(legacy.players).map(([key, p]) => [
            key,
            { ...p, dev: { invincible: false, flight: false, freeBuild: false }, oxygen: 100 },
          ]),
        ),
        animals: [
          ...legacy.animals.map((a) => ({ ...a, species: 'boar', behavior: 'roam' })),
          ...populateWildlife(generateWorld(legacy.seed))
            .filter((a) => a.species !== 'boar' && !legacy.animals.some((old) => old.id === a.id))
            .slice(0, MAX_ANIMALS - legacy.animals.length),
        ],
      }
    : value;
  const v2 =
    typeof migrated === 'object' &&
    migrated !== null &&
    'version' in migrated &&
    migrated.version === 2
      ? v2StateSchema.parse(migrated)
      : null;
  const v3Input = v2 ? { ...v2, version: 3, terrain: emptyTerrain() } : migrated;
  const v3 =
    v3Input && typeof v3Input === 'object' && 'version' in v3Input && v3Input.version === 3
      ? v3StateSchema.parse(v3Input)
      : null;
  const world = saveWorld(
    v3StateSchema.shape.seed.parse((v3 ?? (v3Input as { seed?: string }))?.seed),
  );
  const state = stateSchema.parse(
    v3
      ? {
          ...v3,
          version: 4,
          players: Object.fromEntries(
            Object.entries(v3.players).map(([id, p]) => [
              id,
              {
                ...p,
                worn: { armor: null, backpack: null },
                quickSlots: ['rock', 'hatchet', 'pickaxe', 'berries', 'bandage'],
              },
            ]),
          ),
          buildings: v3.buildings.map((b) =>
            createBuilding(
              {
                ...b,
                support:
                  b.kind === 'wall'
                    ? v3.buildings.find(
                        (f) =>
                          f.kind === 'foundation' &&
                          Math.abs(f.y - b.y) < 0.01 &&
                          Math.abs(Math.hypot(f.x - b.x, f.z - b.z) - 2) < 0.01,
                      )?.id
                    : null,
              },
              b.id,
              b.owner,
            ),
          ),
          sites: Object.fromEntries(
            world.sites.map((site) => [
              site.id,
              { inventory: siteLoot(world.seed, site, 0), cycle: 0, restockAt: 0, disabled: false },
            ]),
          ),
        }
      : v3Input,
  );
  if (v3) compatibleSites(state, world);
  if (
    Object.keys(state.sites).length !== world.sites.length ||
    world.sites.some((site) => !state.sites[site.id])
  )
    throw new Error('Invalid landmark state');
  for (const building of state.buildings) {
    const chain = new Set([building.id]);
    let support = building.support;
    while (support) {
      if (chain.has(support)) throw new Error('Cyclic building support');
      chain.add(support);
      const parent = state.buildings.find((b) => b.id === support);
      if (!parent) throw new Error('Missing building support');
      support = parent.support;
    }
  }
  // Loading must never resume stale held keys, especially across reconnects or tab suspension.
  for (const p of Object.values(state.players)) p.input = idleInput();
  const ids = [
    ...state.buildings.map((b) => b.id),
    ...state.bags.map((b) => b.id),
    ...state.animals.map((a) => a.id),
  ];
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate entity IDs in save');
  if (ids.some((entityId) => Number(entityId.replace(/^(?:bag|b|a)/, '')) >= state.nextId))
    throw new Error('Invalid entity sequence in save');
  return state;
}

export function parseSave(text: string): SaveFile {
  if (new TextEncoder().encode(text).length > MAX_SAVE_BYTES)
    throw new Error('Save is larger than 16 MB.');
  const parsed = saveSchema.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new Error(
      'This save is damaged or uses an unsupported version. Your current expedition was not changed.',
    );
  const rawState = parsed.data.state;
  if (
    !rawState ||
    typeof rawState !== 'object' ||
    !('version' in rawState) ||
    rawState.version !== parsed.data.version
  )
    throw new Error('Save envelope and state versions disagree.');
  const state = parseState(rawState);
  if (!state.players[parsed.data.playerId]) throw new Error('Save has no local player.');
  return { ...parsed.data, version: 4, state };
}

export function encodeSave(state: GameState, playerId: string): string {
  return JSON.stringify({
    format: 'rbb-save',
    version: 4,
    // Envelope metadata only; the simulation never reads the wall clock.
    // eslint-disable-next-line no-restricted-syntax
    savedAt: new Date().toISOString(),
    playerId,
    state,
  } satisfies SaveFile);
}
