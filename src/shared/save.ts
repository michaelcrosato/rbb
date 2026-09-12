import { z } from 'zod';
import { BUILDING_IDS, ITEM_IDS } from './content';
import { inventoryWeight } from './inventory';
import { moveSchema } from './protocol';
import { idleInput } from './state';
import type { GameState } from './state';
import { WORLD_VERSION } from './world';

export const MAX_SAVE_BYTES = 2_000_000;
const finite = z.number().finite();
const positive = finite.min(0).max(1e12);
const id = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
  .refine((s) => s !== 'constructor' && s !== 'prototype');
const stat = finite.min(0).max(100);
const position = z
  .object({
    x: finite.min(-320).max(320),
    y: finite.min(-20).max(160),
    z: finite.min(-320).max(320),
  })
  .strict();
export const inventorySchema = z
  .partialRecord(z.enum(ITEM_IDS), z.number().int().min(1).max(10000))
  .refine((v) => inventoryWeight(v) <= 60.001, 'Inventory exceeds carry capacity');
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
    inventory: inventorySchema,
    equipped: z.enum(ITEM_IDS),
    cooldown: finite.min(0).max(10),
    grounded: z.boolean(),
    milestones: z
      .object({ gather: positive, craft: positive, build: positive, camp: positive })
      .strict(),
    respawn: position,
    deaths: positive.int(),
    input: moveSchema,
  })
  .strict();
export const stateSchema = z
  .object({
    version: z.literal(1),
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
      .refine((p) => Object.keys(p).length <= 512)
      .refine((p) => Object.entries(p).every(([key, v]) => key === v.id)),
    resources: z
      .record(id, z.object({ health: finite.min(0).max(6), respawnAt: positive }).strict())
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
      .max(512),
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
            homeX: position.shape.x,
            homeZ: position.shape.z,
            yaw: finite,
            health: finite.min(0).max(60),
            cooldown: finite.min(0).max(5),
            respawnAt: positive,
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

export interface SaveFile {
  format: 'rbb-save';
  version: 1;
  savedAt: string;
  playerId: string;
  state: GameState;
}
const saveSchema = z
  .object({
    format: z.literal('rbb-save'),
    version: z.literal(1),
    savedAt: z.iso.datetime(),
    playerId: id,
    state: stateSchema,
  })
  .strict()
  .refine((s) => !!s.state.players[s.playerId], 'Save has no local player');

export function parseState(value: unknown): GameState {
  const state = stateSchema.parse(value);
  // Loading must never resume stale held keys, especially across reconnects or tab suspension.
  for (const p of Object.values(state.players)) p.input = idleInput();
  const ids = [...state.buildings.map((b) => b.id), ...state.bags.map((b) => b.id)];
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate entity IDs in save');
  if (ids.some((entityId) => Number(entityId.replace(/^(?:bag|b)/, '')) >= state.nextId))
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
  return { ...parsed.data, state: parseState(parsed.data.state) };
}

export function encodeSave(state: GameState, playerId: string): string {
  return JSON.stringify({
    format: 'rbb-save',
    version: 1,
    savedAt: new Date().toISOString(),
    playerId,
    state,
  } satisfies SaveFile);
}
