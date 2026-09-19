/** The content registry is the single source of truth for balance and presentation metadata.
 * The `satisfies` clauses make a misspelled item ID in a cost, output or loot table a compile error. */
export interface ItemDefinition {
  name: string;
  description: string;
  weight: number;
  icon: string;
  color: string;
}
const item = (
  name: string,
  description: string,
  weight: number,
  icon: string,
  color: string,
): ItemDefinition => ({ name, description, weight, icon, color });
export const ITEMS = {
  ironOre: item(
    'Iron ore',
    'Smelt with charcoal in a furnace to make metal.',
    0.15,
    'stone',
    '#a67c62',
  ),
  sulfurOre: item(
    'Sulfur',
    'A quarry mineral used in ammunition at a workbench.',
    0.1,
    'stone',
    '#d4c473',
  ),
  metal: item(
    'Metal ingot',
    'Smelted iron for stronger tools, equipment and bases.',
    0.2,
    'stone',
    '#abbcc1',
  ),
  charcoal: item(
    'Charcoal',
    'Burn timber in a furnace. Fuel for smelting and ammunition.',
    0.05,
    'rock',
    '#677572',
  ),
  gunpowder: item('Powder', 'A workshop material for cartridges.', 0.03, 'bag', '#8a9382'),
  scrap: item(
    'Salvage scrap',
    'Recovered at landmarks. Recycle it or use it in a workshop.',
    0.1,
    'stone',
    '#aa896b',
  ),
  parts: item(
    'Machine parts',
    'Recovered mechanisms for firearms and advanced equipment.',
    0.25,
    'settings',
    '#bec9c7',
  ),
  cloth: item(
    'Woven cloth',
    'Weave plant fiber for packs, clothing and provisions.',
    0.05,
    'fiber',
    '#d6c6a0',
  ),
  leather: item(
    'Hide',
    'Recovered from land wildlife. Useful for protective equipment.',
    0.1,
    'meat',
    '#b68d63',
  ),
  reinforcedPlate: item(
    'Reinforcement plate',
    'Forge metal and scrap into durable base reinforcement.',
    0.3,
    'wall',
    '#a9bdc1',
  ),
  ironHatchet: item(
    'Iron hatchet',
    'Harvest five hits of timber at once; stronger in close combat.',
    1.8,
    'hatchet',
    '#b6d5dc',
  ),
  ironPickaxe: item(
    'Iron pickaxe',
    'Extract rich veins five hits at a time. Also excavates terrain.',
    2.2,
    'pickaxe',
    '#b6d5dc',
  ),
  spear: item(
    'Hunting spear',
    'A long-reaching melee weapon for wildlife.',
    1.5,
    'spear',
    '#d7bd87',
  ),
  bow: item(
    'Field bow',
    'A quiet ranged hunting weapon. Uses arrows from your pack.',
    1.2,
    'bow',
    '#bf9966',
  ),
  arrow: item(
    'Arrows',
    'Ammunition for the field bow. Crafted in bundles of six.',
    0.04,
    'arrow',
    '#c6d2b1',
  ),
  scrapPistol: item(
    'Salvage pistol',
    'A compact hunting firearm. Uses cartridges from your pack.',
    2,
    'pistol',
    '#b2c5c8',
  ),
  huntingRifle: item(
    'Hunting rifle',
    'A powerful, slower firing weapon for distant wildlife. Uses cartridges.',
    3.5,
    'rifle',
    '#acb9ab',
  ),
  cartridge: item(
    'Cartridges',
    'Workshop ammunition for the pistol and rifle.',
    0.05,
    'ammo',
    '#d4b678',
  ),
  armor: item(
    'Hide vest',
    'Wear to reduce wildlife damage by 35%. Remains part of your pack.',
    3,
    'armor',
    '#b79f74',
  ),
  backpack: item(
    'Trail pack',
    'Wear to carry 90 kg instead of 60 kg. Remains part of your inventory.',
    1.5,
    'bag',
    '#a9bb88',
  ),
  waterskin: item(
    'Filled waterskin',
    'A crafted ration of water. Restores 60 water when used.',
    0.6,
    'bag',
    '#adcae0',
  ),
  ration: item(
    'Trail ration',
    'Wrapped meat and berries. Restores 65 food, 15 water and 12 health.',
    0.35,
    'meat',
    '#cfb27e',
  ),
  dirt: {
    name: 'Excavated dirt',
    description: 'Fill material from digging. Use Terrain tools to deposit it or level ground.',
    weight: 0.1,
    icon: 'stone',
    color: '#b48b60',
  },
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
    description: 'Break deposits and excavate terrain, including cave walls.',
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
  waterskin: { thirst: 60 },
  ration: { hunger: 65, thirst: 15, health: 12 },
};
export const isConsumable = (id: ItemId): boolean => CONSUMABLES[id] !== undefined;

export interface RecipeDefinition {
  name: string;
  cost: Inventory;
  output: Inventory;
  description: string;
  /** Building that must stand within 5 m of the crafter. */
  station?: BuildingKind;
  category?: 'Materials' | 'Tools' | 'Weapons' | 'Equipment' | 'Provisions';
}
export const RECIPES = {
  cloth: {
    name: 'Woven cloth',
    cost: { fiber: 8 },
    output: { cloth: 2 },
    description: 'Weave flexible supplies for equipment.',
    category: 'Materials',
  },
  charcoal: {
    name: 'Charcoal',
    cost: { wood: 8 },
    output: { charcoal: 4 },
    description: 'Convert timber into furnace fuel.',
    station: 'furnace',
    category: 'Materials',
  },
  metal: {
    name: 'Smelt iron',
    cost: { ironOre: 4, charcoal: 2 },
    output: { metal: 2 },
    description: 'Process ore into metal ingots.',
    station: 'furnace',
    category: 'Materials',
  },
  recycleMetal: {
    name: 'Recycle scrap',
    cost: { scrap: 4, charcoal: 1 },
    output: { metal: 2 },
    description: 'Salvage an alternative source of metal.',
    station: 'furnace',
    category: 'Materials',
  },
  gunpowder: {
    name: 'Powder',
    cost: { sulfurOre: 2, charcoal: 3 },
    output: { gunpowder: 4 },
    description: 'A material for workshop ammunition.',
    station: 'workbench',
    category: 'Materials',
  },
  reinforcedPlate: {
    name: 'Reinforcement plates',
    cost: { metal: 4, scrap: 2 },
    output: { reinforcedPlate: 2 },
    description: 'Upgrade stone structures to reinforced metal.',
    station: 'workbench',
    category: 'Materials',
  },
  parts: {
    name: 'Machine parts',
    cost: { metal: 6, scrap: 8 },
    output: { parts: 1 },
    description: 'Turn salvaged metal into mechanisms.',
    station: 'workbench',
    category: 'Materials',
  },
  ironHatchet: {
    name: 'Iron hatchet',
    cost: { wood: 12, metal: 6, cloth: 2 },
    output: { ironHatchet: 1 },
    description: 'Harvest five hits of timber at a time.',
    station: 'workbench',
    category: 'Tools',
  },
  ironPickaxe: {
    name: 'Iron pickaxe',
    cost: { wood: 12, metal: 8, cloth: 2 },
    output: { ironPickaxe: 1 },
    description: 'Harvest five hits from mineral veins at a time.',
    station: 'workbench',
    category: 'Tools',
  },
  spear: {
    name: 'Hunting spear',
    cost: { wood: 16, stone: 8, fiber: 4 },
    output: { spear: 1 },
    description: 'A longer reach for hunting wildlife.',
    category: 'Weapons',
  },
  bow: {
    name: 'Field bow',
    cost: { wood: 20, fiber: 16, cloth: 2 },
    output: { bow: 1 },
    description: 'Hunt at range with arrows.',
    category: 'Weapons',
  },
  arrow: {
    name: 'Arrows ×6',
    cost: { wood: 4, stone: 3, fiber: 2 },
    output: { arrow: 6 },
    description: 'Ammunition for the field bow.',
    category: 'Weapons',
  },
  scrapPistol: {
    name: 'Salvage pistol',
    cost: { metal: 12, scrap: 12, parts: 2, wood: 6 },
    output: { scrapPistol: 1 },
    description: 'A compact firearm for wildlife hunting.',
    station: 'workbench',
    category: 'Weapons',
  },
  huntingRifle: {
    name: 'Hunting rifle',
    cost: { metal: 20, reinforcedPlate: 4, parts: 4, wood: 16 },
    output: { huntingRifle: 1 },
    description: 'Longer range, greater power and a slower shot.',
    station: 'workbench',
    category: 'Weapons',
  },
  cartridge: {
    name: 'Cartridges ×6',
    cost: { metal: 2, gunpowder: 3 },
    output: { cartridge: 6 },
    description: 'Ammunition shared by both firearms.',
    station: 'workbench',
    category: 'Weapons',
  },
  armor: {
    name: 'Hide vest',
    cost: { leather: 8, cloth: 6, fiber: 10 },
    output: { armor: 1 },
    description: 'Wear to reduce wildlife damage by 35%.',
    station: 'workbench',
    category: 'Equipment',
  },
  backpack: {
    name: 'Trail pack',
    cost: { cloth: 8, leather: 4, fiber: 10 },
    output: { backpack: 1 },
    description: 'Wear to increase carrying capacity to 90 kg.',
    category: 'Equipment',
  },
  waterskin: {
    name: 'Filled waterskin',
    cost: { leather: 2, fiber: 4, berries: 3 },
    output: { waterskin: 1 },
    description: 'Store berry water for a long expedition. Restores 60 water.',
    category: 'Provisions',
  },
  ration: {
    name: 'Trail ration',
    cost: { cookedMeat: 1, berries: 3, cloth: 1 },
    output: { ration: 1 },
    description: 'A sustaining meal for the road.',
    station: 'campfire',
    category: 'Provisions',
  },
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
    description: 'Gather stone faster, excavate terrain and level ground.',
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
  category?: 'Shelter' | 'Camp';
}
export const BUILDINGS = {
  doorway: {
    name: 'Doorway',
    cost: { wood: 14, fiber: 4 },
    description: 'A foundation-edge frame with an open passage.',
    icon: 'wall',
    category: 'Shelter',
  },
  door: {
    name: 'Timber door',
    cost: { wood: 12, scrap: 2 },
    description: 'Fits an empty doorway. Aim and use to open or close.',
    icon: 'wall',
    category: 'Shelter',
  },
  window: {
    name: 'Window wall',
    cost: { wood: 14, fiber: 4 },
    description: 'A foundation-edge wall with a lookout opening.',
    icon: 'wall',
    category: 'Shelter',
  },
  floor: {
    name: 'Upper floor',
    cost: { wood: 20, fiber: 6 },
    description: 'A 4 × 4 m ceiling, supported by a wall on the storey below.',
    icon: 'foundation',
    category: 'Shelter',
  },
  stairwell: {
    name: 'Stairwell floor',
    cost: { wood: 18, fiber: 6 },
    description:
      'An upper floor with a central stair opening and a north landing. Rotate with the stairs.',
    icon: 'foundation',
    category: 'Shelter',
  },
  roof: {
    name: 'Shelter roof',
    cost: { wood: 18, fiber: 10 },
    description: 'A solid roof with raised edges over a supported room.',
    icon: 'foundation',
    category: 'Shelter',
  },
  stairs: {
    name: 'Timber stairs',
    cost: { wood: 20, fiber: 4 },
    description:
      'Climb 3 metres from a foundation or upper floor. Rotate for the ascent direction.',
    icon: 'foundation',
    category: 'Shelter',
  },
  fence: {
    name: 'Palisade fence',
    cost: { wood: 12, fiber: 2 },
    description: 'A freestanding 4 metre barrier for the edge of camp.',
    icon: 'wall',
    category: 'Shelter',
  },
  storage: {
    name: 'Supply chest',
    cost: { wood: 20, scrap: 4 },
    description: 'Shared storage for up to 240 kg. Aim and use to transfer supplies.',
    icon: 'bag',
    category: 'Camp',
  },
  workbench: {
    name: 'Workbench',
    cost: { wood: 28, stone: 12, scrap: 6 },
    description: 'Craft advanced tools, equipment, firearms and reinforcement within 5 metres.',
    icon: 'hatchet',
    category: 'Camp',
  },
  furnace: {
    name: 'Stone furnace',
    cost: { stone: 40, wood: 16 },
    description: 'Process charcoal and metal within 5 metres.',
    icon: 'fire',
    category: 'Camp',
  },
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
  quarryStone: {
    name: 'Rich stone vein',
    health: 36,
    item: 'stone',
    yield: 8,
    radius: 1.2,
    tool: 'pickaxe',
    respawn: 900,
  },
  iron: {
    name: 'Iron vein',
    health: 24,
    item: 'ironOre',
    yield: 4,
    radius: 1.1,
    tool: 'pickaxe',
    respawn: 1200,
  },
  sulfur: {
    name: 'Sulfur vein',
    health: 18,
    item: 'sulfurOre',
    yield: 3,
    radius: 1,
    tool: 'pickaxe',
    respawn: 1200,
  },
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

export const TOOLS: Partial<Record<ItemId, { family: 'hatchet' | 'pickaxe'; hits: number }>> = {
  hatchet: { family: 'hatchet', hits: 3 },
  pickaxe: { family: 'pickaxe', hits: 3 },
  ironHatchet: { family: 'hatchet', hits: 5 },
  ironPickaxe: { family: 'pickaxe', hits: 5 },
};
export interface WeaponDefinition {
  damage: number;
  range: number;
  cooldown: number;
  ammo?: ItemId;
}
export const WEAPONS: Partial<Record<ItemId, WeaponDefinition>> = {
  rock: { damage: 15, range: 3.8, cooldown: 0.6 },
  hatchet: { damage: 30, range: 3.8, cooldown: 0.6 },
  pickaxe: { damage: 15, range: 3.8, cooldown: 0.6 },
  ironHatchet: { damage: 36, range: 3.8, cooldown: 0.6 },
  ironPickaxe: { damage: 26, range: 3.8, cooldown: 0.8 },
  spear: { damage: 32, range: 5, cooldown: 0.75 },
  bow: { damage: 36, range: 35, cooldown: 0.9, ammo: 'arrow' },
  scrapPistol: { damage: 32, range: 28, cooldown: 0.5, ammo: 'cartridge' },
  huntingRifle: { damage: 75, range: 65, cooldown: 1.4, ammo: 'cartridge' },
};
export const EQUIPMENT: Partial<
  Record<ItemId, { slot: 'armor' | 'backpack'; capacity?: number; resistance?: number }>
> = {
  armor: { slot: 'armor', resistance: 0.35 },
  backpack: { slot: 'backpack', capacity: 30 },
};
export const STRUCTURE_GRADES = {
  timber: {
    name: 'Timber',
    health: 180,
    resistance: 0,
    cost: {},
    repair: { wood: 4 },
    color: '#98724c',
  },
  stone: {
    name: 'Stone',
    health: 450,
    resistance: 0.2,
    cost: { stone: 36, wood: 4 },
    repair: { stone: 5 },
    color: '#a7b4af',
  },
  metal: {
    name: 'Reinforced metal',
    health: 900,
    resistance: 0.45,
    cost: { reinforcedPlate: 6, metal: 6 },
    repair: { metal: 3 },
    color: '#829ea4',
  },
} as const satisfies Record<
  string,
  {
    name: string;
    health: number;
    resistance: number;
    cost: Inventory;
    repair: Inventory;
    color: string;
  }
>;
export type StructureGrade = keyof typeof STRUCTURE_GRADES;
export const GRADE_IDS = Object.keys(STRUCTURE_GRADES) as StructureGrade[];
export const SITE_TYPES = {
  camp: {
    name: 'Wayfarer camp',
    description: 'Cloth, provisions and trail supplies.',
    color: '#cfbb83',
    restock: 1200,
    loot: { cloth: [3, 6], berries: [5, 10], leather: [2, 4], bandage: [1, 2], scrap: [4, 8] },
  },
  depot: {
    name: 'Abandoned depot',
    description: 'Salvage scrap, machine parts and workshop materials.',
    color: '#d2926e',
    restock: 1800,
    loot: { scrap: [12, 22], parts: [1, 3], metal: [3, 6], cloth: [1, 3] },
  },
  lookout: {
    name: 'Old lookout',
    description: 'Hunting provisions and recovered equipment.',
    color: '#a8c3cf',
    restock: 1800,
    loot: {
      scrap: [6, 12],
      parts: [1, 2],
      arrow: [6, 12],
      cartridge: [3, 6],
      leather: [2, 4],
      bandage: [1, 3],
    },
  },
  stoneQuarry: {
    name: 'Stone quarry',
    description: 'Rich stone and iron for an expanding camp.',
    color: '#c4c8b8',
    restock: 0,
    loot: {},
  },
  ironQuarry: {
    name: 'Iron quarry',
    description: 'Abundant ore for furnaces and strong tools.',
    color: '#bc9173',
    restock: 0,
    loot: {},
  },
  sulfurQuarry: {
    name: 'Sulfur quarry',
    description: 'Sulfur and stone for workshop supplies.',
    color: '#d4c572',
    restock: 0,
    loot: {},
  },
} as const satisfies Record<
  string,
  {
    name: string;
    description: string;
    color: string;
    restock: number;
    loot: Partial<Record<ItemId, readonly [number, number]>>;
  }
>;
export type SiteKind = keyof typeof SITE_TYPES;
export const SITE_IDS = Object.keys(SITE_TYPES) as SiteKind[];

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
  terrainReach: 5,
  eyeHeight: 1.65,
  terrainRadius: 1.5,
  terrainCooldown: 0.6,
  terrainStamina: 4,
  dirtPerVolume: 10,
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
  maxPlayers: 4,
  maxSurvivors: 512,
  maxBags: 2048,
  droppedItemLifetime: 900,
  dropDistance: 1.25,
  storageCapacity: 240,
  craftBatchLimit: 20,
  maxStoreys: 4,
  repairFraction: 0.25,
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
    loot: { meat: 3, fiber: 2, leather: 3 },
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
    loot: { meat: 4, fiber: 3, leather: 4 },
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
    loot: { meat: 2, fiber: 3, leather: 3 },
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
    loot: { meat: 1, fiber: 2, leather: 2 },
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
