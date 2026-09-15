/** The content registry is the single source of truth for balance and presentation metadata.
 * The `satisfies` clauses make a misspelled item ID in a cost, output or loot table a compile error. */
export interface ItemDefinition {
  name: string;
  description: string;
  weight: number;
  icon: string;
  color: string;
}
export const ITEMS = {
  rock: {
    name: 'River stone',
    description: 'Your first tool. Slow, but dependable.',
    weight: 1,
    icon: 'rock',
    color: '#b7c6cc',
  },
  wood: {
    name: 'Wood',
    description: 'Timber for tools and a place to call home.',
    weight: 0.1,
    icon: 'wood',
    color: '#c79560',
  },
  stone: {
    name: 'Stone',
    description: 'Useful for tools and a steady foundation.',
    weight: 0.12,
    icon: 'stone',
    color: '#a8b8c0',
  },
  fiber: {
    name: 'Plant fiber',
    description: 'Strong, flexible strands from wild flax.',
    weight: 0.02,
    icon: 'fiber',
    color: '#b3ca80',
  },
  berries: {
    name: 'Wild berries',
    description: 'Eat to restore 16 food and 10 water.',
    weight: 0.1,
    icon: 'berries',
    color: '#dd957d',
  },
  meat: {
    name: 'Raw meat',
    description: 'Cook at a nearby campfire before eating.',
    weight: 0.3,
    icon: 'meat',
    color: '#c98170',
  },
  cookedMeat: {
    name: 'Roasted meat',
    description: 'A warm meal. Restores 40 food and 8 health.',
    weight: 0.25,
    icon: 'meat',
    color: '#bf9568',
  },
  hatchet: {
    name: 'Stone hatchet',
    description: 'Gather timber faster. Also useful against boars.',
    weight: 1.5,
    icon: 'hatchet',
    color: '#d8e6cd',
  },
  pickaxe: {
    name: 'Stone pickaxe',
    description: 'Break mineral deposits efficiently.',
    weight: 2,
    icon: 'pickaxe',
    color: '#c9d9df',
  },
  bandage: {
    name: 'Field bandage',
    description: 'Use to restore 30 health.',
    weight: 0.1,
    icon: 'bandage',
    color: '#f2eacb',
  },
} as const satisfies Record<string, ItemDefinition>;
export type ItemId = keyof typeof ITEMS;
export type Inventory = Partial<Record<ItemId, number>>;
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const MAX_WEIGHT = 60;

/** Vitals restored by the `consume` command. Keep these in step with the item descriptions. */
export interface ConsumableEffect {
  hunger?: number;
  thirst?: number;
  health?: number;
}
export const CONSUMABLES: Partial<Record<ItemId, ConsumableEffect>> = {
  berries: { hunger: 16, thirst: 10 },
  cookedMeat: { hunger: 40, health: 8 },
  bandage: { health: 30 },
};
export const isConsumable = (id: ItemId): boolean => CONSUMABLES[id] !== undefined;

export interface RecipeDefinition {
  name: string;
  cost: Inventory;
  output: Inventory;
  description: string;
  /** Building that must stand within 5 m of the crafter. */
  station?: BuildingKind;
}
export const RECIPES = {
  hatchet: {
    name: 'Stone hatchet',
    cost: { wood: 12, stone: 8, fiber: 3 },
    output: { hatchet: 1 },
    description: 'A better edge. Gather wood three times faster.',
  },
  pickaxe: {
    name: 'Stone pickaxe',
    cost: { wood: 10, stone: 12, fiber: 3 },
    output: { pickaxe: 1 },
    description: 'Make short work of stone deposits.',
  },
  bandage: {
    name: 'Field bandage',
    cost: { fiber: 6 },
    output: { bandage: 1 },
    description: 'Restore 30 health in the field.',
  },
  cookedMeat: {
    name: 'Roasted meat',
    cost: { meat: 1, wood: 2 },
    output: { cookedMeat: 1 },
    description: 'Requires a campfire within 5 metres.',
    station: 'campfire',
  },
} as const satisfies Record<string, RecipeDefinition>;
export type RecipeId = keyof typeof RECIPES;
export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];

export interface BuildingDefinition {
  name: string;
  cost: Inventory;
  description: string;
  icon: string;
}
export const BUILDINGS = {
  foundation: {
    name: 'Timber foundation',
    cost: { wood: 24, stone: 12 },
    description: 'A 4 × 4 m platform. Start your shelter here.',
    icon: 'foundation',
  },
  wall: {
    name: 'Timber wall',
    cost: { wood: 16, fiber: 4 },
    description: 'Snaps to a foundation edge. Rotate with R.',
    icon: 'wall',
  },
  campfire: {
    name: 'Campfire',
    cost: { wood: 12, stone: 8 },
    description: 'Cook nearby and recover beside its warmth.',
    icon: 'fire',
  },
  bedroll: {
    name: 'Bedroll',
    cost: { fiber: 18, wood: 6 },
    description: 'Your new respawn point. Place on dry ground.',
    icon: 'bed',
  },
} as const satisfies Record<string, BuildingDefinition>;
export type BuildingKind = keyof typeof BUILDINGS;
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingKind[];

export interface ResourceDefinition {
  name: string;
  /** Hits before the node is exhausted; a matching tool lands three hits at once. */
  health: number;
  item: ItemId;
  yield: number;
  /** Collision radius in metres; zero for walk-through plants. */
  radius: number;
  tool: ItemId;
  /** World seconds before an exhausted node regrows. */
  respawn: number;
}
export const RESOURCE_TYPES = {
  tree: {
    name: 'Coastal pine',
    health: 6,
    item: 'wood',
    yield: 6,
    radius: 0.6,
    tool: 'hatchet',
    respawn: 600,
  },
  rock: {
    name: 'Stone deposit',
    health: 6,
    item: 'stone',
    yield: 5,
    radius: 1.1,
    tool: 'pickaxe',
    respawn: 600,
  },
  fiber: {
    name: 'Wild flax',
    health: 1,
    item: 'fiber',
    yield: 6,
    radius: 0,
    tool: 'rock',
    respawn: 180,
  },
  berries: {
    name: 'Berry bush',
    health: 1,
    item: 'berries',
    yield: 3,
    radius: 0,
    tool: 'rock',
    respawn: 240,
  },
  spring: {
    name: 'Freshwater spring',
    health: 1,
    item: 'berries',
    yield: 0,
    radius: 0,
    tool: 'rock',
    respawn: 0,
  },
} as const satisfies Record<string, ResourceDefinition>;
export type ResourceKind = keyof typeof RESOURCE_TYPES;

export const MILESTONES = [
  {
    id: 'gather',
    label: 'Gather your first materials',
    description: 'Approach a tree or stone and use your river stone.',
    target: 18,
  },
  {
    id: 'craft',
    label: 'Craft a better tool',
    description: 'Open your pack and craft a stone hatchet.',
    target: 1,
  },
  {
    id: 'build',
    label: 'Make a place of your own',
    description: 'Build a timber foundation or a campfire.',
    target: 1,
  },
  {
    id: 'camp',
    label: 'Set down roots',
    description: 'Place a bedroll to set your respawn point.',
    target: 1,
  },
] as const;
export type MilestoneId = (typeof MILESTONES)[number]['id'];

export const BALANCE = {
  tickRate: 30,
  walkSpeed: 5,
  sprintSpeed: 8,
  swimSpeed: 2.6,
  gravity: 22,
  jumpSpeed: 7.2,
  interactRange: 3.8,
  buildRange: 8,
  daySeconds: 1200,
  maxBuildings: 512,
  maxPlayers: 16,
  maxSurvivors: 512,
} as const;

export const SPECIES_IDS = [
  'boar',
  'deer',
  'wolf',
  'fox',
  'rabbit',
  'fish',
  'turtle',
  'dolphin',
] as const;
export type Species = (typeof SPECIES_IDS)[number];
export interface SpeciesDefinition {
  name: string;
  habitat: 'land' | 'sea';
  behavior: 'territorial' | 'predator' | 'flee' | 'school';
  health: number;
  speed: number;
  damage: number;
  count: number;
  radius: number;
  loot: Inventory;
}
export const WILDLIFE: Record<Species, SpeciesDefinition> = {
  boar: {
    name: 'Wild boar',
    habitat: 'land',
    behavior: 'territorial',
    health: 60,
    speed: 3.5,
    damage: 12,
    count: 8,
    radius: 0.65,
    loot: { meat: 3, fiber: 2 },
  },
  deer: {
    name: 'Fallow deer',
    habitat: 'land',
    behavior: 'flee',
    health: 45,
    speed: 6,
    damage: 0,
    count: 10,
    radius: 0.7,
    loot: { meat: 4, fiber: 3 },
  },
  wolf: {
    name: 'Grey wolf',
    habitat: 'land',
    behavior: 'predator',
    health: 75,
    speed: 4.6,
    damage: 16,
    count: 4,
    radius: 0.6,
    loot: { meat: 2, fiber: 3 },
  },
  fox: {
    name: 'Red fox',
    habitat: 'land',
    behavior: 'flee',
    health: 25,
    speed: 4.5,
    damage: 0,
    count: 6,
    radius: 0.4,
    loot: { meat: 1, fiber: 2 },
  },
  rabbit: {
    name: 'Meadow rabbit',
    habitat: 'land',
    behavior: 'flee',
    health: 15,
    speed: 3.8,
    damage: 0,
    count: 14,
    radius: 0.25,
    loot: { meat: 1, fiber: 1 },
  },
  fish: {
    name: 'Reef fish',
    habitat: 'sea',
    behavior: 'school',
    health: 10,
    speed: 1.8,
    damage: 0,
    count: 8,
    radius: 0.25,
    loot: { meat: 1 },
  },
  turtle: {
    name: 'Sea turtle',
    habitat: 'sea',
    behavior: 'school',
    health: 40,
    speed: 0.8,
    damage: 0,
    count: 3,
    radius: 0.6,
    loot: { meat: 2 },
  },
  dolphin: {
    name: 'Coastal dolphin',
    habitat: 'sea',
    behavior: 'school',
    health: 80,
    speed: 3.4,
    damage: 0,
    count: 3,
    radius: 0.9,
    loot: { meat: 3 },
  },
};
