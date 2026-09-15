import { z } from 'zod';
import { developerSchema } from './developer';
import { BUILDING_IDS, ITEM_IDS, RECIPE_IDS } from './content';
import type { GameEvent, GameState, PlayerState, Result } from './state';
import { WORLD_HALF } from './world';

export const PROTOCOL_VERSION = 2;
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
  z.object({ type: z.literal('dev'), request: developerSchema }).strict(),
  z.object({ type: z.literal('move'), input: moveSchema }).strict(),
  z.object({ type: z.literal('equip'), item: z.enum(ITEM_IDS) }).strict(),
  z.object({ type: z.literal('interact'), target: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal('craft'), recipe: z.enum(RECIPE_IDS) }).strict(),
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
  'id' | 'name' | 'position' | 'yaw' | 'health' | 'equipped'
>;
export interface Snapshot {
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
}
export type ServerMessage =
  | { type: 'welcome'; protocol: number; playerId: string; token: string; snapshot: Snapshot }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'result'; seq: number; result: Result }
  | { type: 'events'; events: GameEvent[] }
  | { type: 'error'; message: string }
  | { type: 'pong'; at: number };

export function snapshotFor(state: GameState, id: string, devAllowed = false): Snapshot {
  return {
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
      .map(({ id, name, position, yaw, health, equipped }) => ({
        id,
        name,
        position,
        yaw,
        health,
        equipped,
      })),
    resources: state.resources,
    buildings: state.buildings,
    // Other players' dropped inventory is revealed only at interaction range.
    bags: state.bags.map((b) => ({ ...b, inventory: b.owner === id ? b.inventory : {} })),
    animals: state.animals,
  };
}
