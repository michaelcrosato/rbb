import { z } from 'zod';
import {
  BALANCE,
  BUILDING_IDS,
  ITEM_IDS,
  MAX_WEIGHT,
  RESOURCE_TYPES,
  SPECIES_IDS,
  WILDLIFE,
} from './content';
import type { MilestoneId } from './content';
import { inventoryWeight } from './inventory';
import { moveSchema } from './protocol';
import { idleInput } from './state';
import type { GameState } from './state';
import { WORLD_HALF, WORLD_VERSION, generateWorld } from './world';
import { createEnvironment, DEFAULT_TUNING, environmentSchema, tuningSchema } from './environment';
import { populateWildlife, MAX_ANIMALS } from './wildlife';

export const MAX_SAVE_BYTES = 2_000_000;
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
    y: finite.min(-20).max(160),
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
export const stateSchema = z
  .object({
    version: z.literal(2),
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
      .max(2048),
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

const legacyStateSchema = stateSchema
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
        stateSchema.shape.animals.element
          .omit({ species: true, behavior: true })
          .extend({ health: finite.min(0).max(60) }),
      )
      .max(64),
  })
  .strict();

export interface SaveFile {
  format: 'rbb-save';
  version: 2;
  savedAt: string;
  playerId: string;
  state: GameState;
}
const saveSchema = z
  .object({
    format: z.literal('rbb-save'),
    version: z.union([z.literal(1), z.literal(2)]),
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
  const state = stateSchema.parse(migrated);
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
    throw new Error('Save is larger than 2 MB.');
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
  return { ...parsed.data, version: 2, state };
}

export function encodeSave(state: GameState, playerId: string): string {
  return JSON.stringify({
    format: 'rbb-save',
    version: 2,
    // Envelope metadata only; the simulation never reads the wall clock.
    // eslint-disable-next-line no-restricted-syntax
    savedAt: new Date().toISOString(),
    playerId,
    state,
  } satisfies SaveFile);
}
