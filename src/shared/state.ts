import type { BuildingKind, Inventory, ItemId, MilestoneId } from './content';
import { RESOURCE_TYPES } from './content';
import { random } from './math';
import { SPAWN, terrainHeight, WORLD_VERSION } from './world';
import type { WorldDefinition } from './world';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface MoveInput {
  forward: number;
  strafe: number;
  yaw: number;
  pitch: number;
  sprint: boolean;
  jump: boolean;
}
export const idleInput = (): MoveInput => ({
  forward: 0,
  strafe: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  jump: false,
});
export interface PlayerState {
  id: string;
  name: string;
  position: Vec3;
  velocityY: number;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  thirst: number;
  stamina: number;
  inventory: Inventory;
  equipped: ItemId;
  cooldown: number;
  grounded: boolean;
  milestones: Record<MilestoneId, number>;
  respawn: Vec3;
  deaths: number;
  input: MoveInput;
}
export interface ResourceState {
  health: number;
  respawnAt: number;
}
export interface Building {
  id: string;
  kind: BuildingKind;
  owner: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
}
export interface LootBag {
  id: string;
  owner: string;
  x: number;
  y: number;
  z: number;
  inventory: Inventory;
  expiresAt: number;
}
export interface Animal {
  id: string;
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeZ: number;
  yaw: number;
  health: number;
  cooldown: number;
  respawnAt: number;
}
export interface GameState {
  version: 1;
  worldVersion: number;
  seed: string;
  tick: number;
  time: number;
  nextId: number;
  players: Record<string, PlayerState>;
  resources: Record<string, ResourceState>;
  buildings: Building[];
  bags: LootBag[];
  animals: Animal[];
}
export interface GameEvent {
  type: 'gather' | 'craft' | 'build' | 'damage' | 'death' | 'consume' | 'loot';
  playerId: string;
  message: string;
  x?: number;
  z?: number;
}
export interface Result {
  ok: boolean;
  message: string;
}

export function createPlayer(id: string, name: string, world: WorldDefinition): PlayerState {
  const position = { ...SPAWN, y: terrainHeight(SPAWN.x, SPAWN.z, world.hash) };
  return {
    id,
    name,
    position,
    velocityY: 0,
    yaw: 0,
    pitch: 0,
    health: 100,
    hunger: 90,
    thirst: 90,
    stamina: 100,
    inventory: { rock: 1, berries: 3 },
    equipped: 'rock',
    cooldown: 0,
    grounded: true,
    milestones: { gather: 0, craft: 0, build: 0, camp: 0 },
    respawn: { ...position },
    deaths: 0,
    input: idleInput(),
  };
}

export function createState(world: WorldDefinition): GameState {
  const rng = random(world.hash + 1234);
  const animals: Animal[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = rng() * Math.PI * 2,
      radius = 60 + rng() * 95;
    const x = Math.sin(angle) * radius,
      z = Math.cos(angle) * radius;
    if (terrainHeight(x, z, world.hash) < 3 || Math.hypot(x, z - 86) < 45) continue;
    animals.push({
      id: `boar${i}`,
      x,
      z,
      y: terrainHeight(x, z, world.hash),
      homeX: x,
      homeZ: z,
      yaw: angle,
      health: 60,
      cooldown: 0,
      respawnAt: 0,
    });
  }
  return {
    version: 1,
    worldVersion: WORLD_VERSION,
    seed: world.seed,
    tick: 0,
    time: 300,
    nextId: 1,
    players: {},
    resources: {},
    buildings: [],
    bags: [],
    animals,
  };
}

export function resourceIsActive(state: GameState, id: string): boolean {
  return !state.resources[id] || state.resources[id].health > 0;
}

export function resourceHealth(state: GameState, world: WorldDefinition, id: string): number {
  return state.resources[id]?.health ?? RESOURCE_TYPES[world.resourceMap.get(id)!.kind].health;
}
