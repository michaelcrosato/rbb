import type { BuildingKind, Inventory, ItemId, MilestoneId, StructureGrade } from './content';
import { RESOURCE_TYPES, STRUCTURE_GRADES } from './content';
import { createEnvironment, DEFAULT_TUNING } from './environment';
import type { Environment, Tuning } from './environment';
import type { Species } from './content';
import { populateWildlife } from './wildlife';
import { SPAWN, terrainHeight, WORLD_VERSION } from './world';
import type { WorldDefinition } from './world';
import { emptyTerrain } from './terrain';
import type { TerrainState } from './terrain';
import { siteLoot } from './site-generation';

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
  dive: boolean;
}
export const idleInput = (): MoveInput => ({
  forward: 0,
  strafe: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  jump: false,
  dive: false,
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
  oxygen: number;
  inventory: Inventory;
  equipped: ItemId;
  worn: { armor: ItemId | null; backpack: ItemId | null };
  quickSlots: ItemId[];
  cooldown: number;
  grounded: boolean;
  milestones: Record<MilestoneId, number>;
  respawn: Vec3;
  deaths: number;
  input: MoveInput;
  dev: { invincible: boolean; flight: boolean; freeBuild: boolean };
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
  grade: StructureGrade;
  health: number;
  open: boolean;
  inventory: Inventory;
  support: string | null;
}
export type BuildingPlacement = Pick<Building, 'kind' | 'x' | 'y' | 'z' | 'rotation'> & {
  support?: string | null;
};
export function createBuilding(placement: BuildingPlacement, id: string, owner: string): Building {
  return {
    ...placement,
    id,
    owner,
    grade: 'timber',
    health: STRUCTURE_GRADES.timber.health,
    open: false,
    inventory: {},
    support: placement.support ?? null,
  };
}
export interface SiteState {
  inventory: Inventory;
  cycle: number;
  restockAt: number;
  disabled: boolean;
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
  species: Species;
  behavior: 'roam' | 'flee' | 'chase';
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
  version: 4;
  terrain: TerrainState;
  environment: Environment;
  tuning: Tuning;
  sandbox: boolean;
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
  sites: Record<string, SiteState>;
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
    oxygen: 100,
    inventory: { rock: 1, berries: 3 },
    equipped: 'rock',
    worn: { armor: null, backpack: null },
    quickSlots: ['rock', 'hatchet', 'pickaxe', 'berries', 'bandage'],
    cooldown: 0,
    grounded: true,
    milestones: { gather: 0, craft: 0, build: 0, camp: 0 },
    respawn: { ...position },
    deaths: 0,
    input: idleInput(),
    dev: { invincible: false, flight: false, freeBuild: false },
  };
}

export function createState(world: WorldDefinition): GameState {
  return {
    version: 4,
    terrain: emptyTerrain(),
    environment: createEnvironment(),
    tuning: { ...DEFAULT_TUNING },
    sandbox: false,
    worldVersion: WORLD_VERSION,
    seed: world.seed,
    tick: 0,
    time: 300,
    nextId: 1,
    players: {},
    resources: {},
    buildings: [],
    bags: [],
    animals: populateWildlife(world),
    sites: Object.fromEntries(
      world.sites.map((site) => [
        site.id,
        { inventory: siteLoot(world.seed, site, 0), cycle: 0, restockAt: 0, disabled: false },
      ]),
    ),
  };
}

export function resourceIsActive(state: GameState, id: string): boolean {
  return !state.resources[id] || state.resources[id].health > 0;
}

export function resourceHealth(state: GameState, world: WorldDefinition, id: string): number {
  return state.resources[id]?.health ?? RESOURCE_TYPES[world.resourceMap.get(id)!.kind].health;
}
