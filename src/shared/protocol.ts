import { z } from 'zod';
import { developerSchema } from './developer';
import { earthworkSchema } from './earthworks';
import { terrainUpdate } from './terrain';
import type { TerrainUpdate } from './terrain';
import { BALANCE, BUILDING_IDS, ITEM_IDS, RECIPE_IDS } from './content';
import type { GameEvent, GameState, PlayerState, Result } from './state';
import { WORLD_HALF, generateWorld } from './world';
import type { WorldDefinition } from './world';

export const PROTOCOL_VERSION = 4;
export const moveSchema = z
  .object({
    forward: z.number().finite().min(-1).max(1),
    strafe: z.number().finite().min(-1).max(1),
    yaw: z
      .number()
      .finite()
      .min(-Math.PI * 2)
      .max(Math.PI * 2),
    pitch: z.number().finite().min(-1.5).max(1.5),
    sprint: z.boolean(),
    jump: z.boolean(),
    dive: z.boolean().default(false),
  })
  .strict();
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('terrain'), request: earthworkSchema }).strict(),
  z.object({ type: z.literal('dev'), request: developerSchema }).strict(),
  z.object({ type: z.literal('move'), input: moveSchema }).strict(),
  z.object({ type: z.literal('equip'), item: z.enum(ITEM_IDS) }).strict(),
  z.object({ type: z.literal('wear'), item: z.enum(ITEM_IDS) }).strict(),
  z
    .object({
      type: z.literal('quick-slot'),
      item: z.enum(ITEM_IDS),
      slot: z.number().int().min(0).max(4),
    })
    .strict(),
  z.object({ type: z.literal('attack') }).strict(),
  z
    .object({
      type: z.literal('structure'),
      target: z.string().min(1).max(64),
      action: z.enum(['upgrade', 'repair', 'door', 'dismantle']),
    })
    .strict(),
  z
    .object({
      type: z.literal('storage'),
      target: z.string().min(1).max(64),
      direction: z.enum(['deposit', 'take']),
      item: z.enum(ITEM_IDS),
      count: z.number().int().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal('drop'),
      item: z.enum(ITEM_IDS),
      count: z.number().int().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal('collect'),
      target: z.string().min(1).max(64),
      item: z.enum(ITEM_IDS).optional(),
      count: z.number().int().min(1).max(10000).optional(),
    })
    .strict()
    .refine((request) => request.count === undefined || request.item !== undefined),
  z.object({ type: z.literal('interact'), target: z.string().min(1).max(64) }).strict(),
  z
    .object({
      type: z.literal('craft'),
      recipe: z.enum(RECIPE_IDS),
      count: z.number().int().min(1).max(BALANCE.craftBatchLimit).optional(),
    })
    .strict(),
  z.object({ type: z.literal('consume'), item: z.enum(ITEM_IDS) }).strict(),
  z
    .object({
      type: z.literal('build'),
      kind: z.enum(BUILDING_IDS),
      x: z.number().finite().min(-WORLD_HALF).max(WORLD_HALF),
      z: z.number().finite().min(-WORLD_HALF).max(WORLD_HALF),
      rotation: z.number().int().min(0).max(3),
    })
    .strict(),
  z.object({ type: z.literal('respawn') }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const clientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('hello'),
      protocol: z.literal(PROTOCOL_VERSION),
      name: z
        .string()
        .trim()
        .min(1)
        .max(24)
        .regex(/^[\p{L}\p{N} _-]+$/u),
      token: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('command'),
      seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      command: commandSchema,
    })
    .strict(),
  z.object({ type: z.literal('ping'), at: z.number().finite() }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type PublicPlayer = Pick<
  PlayerState,
  'id' | 'name' | 'position' | 'yaw' | 'health' | 'equipped' | 'worn'
>;
export interface Snapshot {
  terrain?: TerrainUpdate;
  environment: GameState['environment'];
  tuning: GameState['tuning'];
  sandbox: boolean;
  devAllowed: boolean;
  tick: number;
  time: number;
  seed: string;
  self: PlayerState;
  players: PublicPlayer[];
  resources: GameState['resources'];
  buildings: GameState['buildings'];
  bags: GameState['bags'];
  animals: GameState['animals'];
  sites: GameState['sites'];
}
export type ServerMessage =
  | { type: 'welcome'; protocol: number; playerId: string; token: string; snapshot: Snapshot }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'result'; seq: number; result: Result }
  | { type: 'events'; events: GameEvent[] }
  | { type: 'error'; message: string }
  | { type: 'pong'; at: number };

export function snapshotFor(
  state: GameState,
  id: string,
  devAllowed = false,
  terrainSince = -1,
  world: WorldDefinition = generateWorld(state.seed),
): Snapshot {
  const nearby = (b: { x: number; y: number; z: number }) =>
    Math.hypot(b.x - state.players[id].position.x, b.z - state.players[id].position.z) <=
      BALANCE.interactRange && Math.abs(b.y - state.players[id].position.y) <= 3;
  return {
    terrain: terrainUpdate(state.terrain, terrainSince),
    environment: state.environment,
    tuning: state.tuning,
    sandbox: state.sandbox,
    devAllowed,
    tick: state.tick,
    time: state.time,
    seed: state.seed,
    self: state.players[id],
    players: Object.values(state.players)
      .filter((p) => p.id !== id)
      .map(({ id, name, position, yaw, health, equipped, worn }) => ({
        id,
        name,
        position,
        yaw,
        health,
        equipped,
        worn,
      })),
    resources: state.resources,
    buildings: state.buildings.map((b) =>
      b.kind === 'storage' && !nearby(b) ? { ...b, inventory: {} } : b,
    ),
    sites: Object.fromEntries(
      world.sites.map((site) => [
        site.id,
        { ...state.sites[site.id], inventory: nearby(site) ? state.sites[site.id].inventory : {} },
      ]),
    ),
    // Other players' dropped inventory is revealed only at interaction range.
    bags: state.bags.map((b) => ({
      ...b,
      inventory:
        b.owner === id ||
        (Math.hypot(b.x - state.players[id].position.x, b.z - state.players[id].position.z) <=
          BALANCE.interactRange &&
          Math.abs(b.y - state.players[id].position.y) <= 3)
          ? b.inventory
          : {},
    })),
    animals: state.animals,
  };
}
