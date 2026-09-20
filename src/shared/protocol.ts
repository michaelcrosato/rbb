import { z } from 'zod';
import { developerSchema } from './developer';
import { earthworkSchema } from './earthworks';
import { terrainUpdate, terrainUpdateSchema } from './terrain';
import { stateSchema } from './save';
import { moveSchema } from './movement';
import { BALANCE, BUILDING_IDS, ITEM_IDS, RECIPE_IDS } from './content';
import type { GameState } from './state';
import { WORLD_HALF, generateWorld } from './world';
import type { WorldDefinition } from './world';
import { PROTOCOL_VERSION } from './protocol-version';

export { PROTOCOL_VERSION } from './protocol-version';
export { moveSchema } from './movement';
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
  z.object({ type: z.literal('ping'), at: z.number().finite().min(0) }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
const playerFields = stateSchema.shape.players.valueType.shape;
const publicPlayerSchema = z
  .object({
    id: playerFields.id,
    name: playerFields.name,
    position: playerFields.position,
    yaw: playerFields.yaw,
    health: playerFields.health,
    equipped: playerFields.equipped,
    worn: playerFields.worn,
  })
  .strict();
export const snapshotSchema = z
  .object({
    terrain: terrainUpdateSchema.optional(),
    environment: stateSchema.shape.environment,
    tuning: stateSchema.shape.tuning,
    sandbox: z.boolean(),
    devAllowed: z.boolean(),
    tick: stateSchema.shape.tick,
    time: stateSchema.shape.time,
    seed: stateSchema.shape.seed,
    self: stateSchema.shape.players.valueType,
    players: z.array(publicPlayerSchema).max(BALANCE.maxPlayers - 1),
    resources: stateSchema.shape.resources,
    buildings: stateSchema.shape.buildings,
    bags: stateSchema.shape.bags,
    animals: stateSchema.shape.animals,
    sites: stateSchema.shape.sites,
  })
  .strict()
  .refine(
    (s) => new Set([s.self.id, ...s.players.map((p) => p.id)]).size === s.players.length + 1,
    'Duplicate survivor identity',
  );
const messageText = z.string().max(2048);
export const serverMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('welcome'),
      protocol: z.literal(PROTOCOL_VERSION),
      playerId: playerFields.id,
      token: z.string().regex(/^[a-f0-9]{64}$/),
      snapshot: snapshotSchema,
    })
    .strict()
    .refine((m) => m.playerId === m.snapshot.self.id, 'Survivor identity mismatch')
    .refine((m) => m.snapshot.terrain?.base === -1, 'Welcome requires a terrain baseline'),
  z.object({ type: z.literal('snapshot'), snapshot: snapshotSchema }).strict(),
  z
    .object({
      type: z.literal('result'),
      seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      result: z.object({ ok: z.boolean(), message: messageText }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('events'),
      events: z
        .array(
          z
            .object({
              type: z.enum(['gather', 'craft', 'build', 'damage', 'death', 'consume', 'loot']),
              playerId: playerFields.id,
              message: messageText,
              x: playerFields.position.shape.x.optional(),
              z: playerFields.position.shape.z.optional(),
            })
            .strict(),
        )
        .max(256),
    })
    .strict(),
  z.object({ type: z.literal('error'), message: messageText }).strict(),
  z.object({ type: z.literal('pong'), at: z.number().finite().min(0) }).strict(),
]);
export type PublicPlayer = z.infer<typeof publicPlayerSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

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
