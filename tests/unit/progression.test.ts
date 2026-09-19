import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  BUILDINGS,
  RECIPES,
  RECIPE_IDS,
  RESOURCE_TYPES,
  SITE_TYPES,
  STRUCTURE_GRADES,
  WILDLIFE,
} from '../../src/shared/content';
import type { BuildingKind, RecipeDefinition } from '../../src/shared/content';
import { buildCandidate, validateBuild } from '../../src/shared/building';
import { attack } from '../../src/shared/combat';
import { craftItems, recipeCosts } from '../../src/shared/crafting';
import { armorResistance, wearEquipment } from '../../src/shared/equipment';
import { carryCapacity, inventoryWeight, transact } from '../../src/shared/inventory';
import { blocked, groundHeight, lineOfSight, stepPlayer } from '../../src/shared/physics';
import { commandSchema, snapshotFor } from '../../src/shared/protocol';
import { encodeSave, parseSave, parseState } from '../../src/shared/save';
import { isQuarry, siteLoot } from '../../src/shared/site-generation';
import { restockSites } from '../../src/shared/sites';
import { Simulation } from '../../src/shared/simulation';
import { createBuilding, createState } from '../../src/shared/state';
import { damageStructure, storageTransfer, structureAction } from '../../src/shared/structures';
import { structureSolids } from '../../src/shared/structure-geometry';
import { generateWorld } from '../../src/shared/world';

const world = generateWorld('quiet-frontier');
function fixture() {
  const state = createState(world),
    sim = new Simulation(world, state),
    p = sim.addPlayer('local', 'Ada');
  state.animals = [];
  const add = (kind: BuildingKind, x = 0, z = 89, y = 8, support: string | null = null) => {
    const b = createBuilding({ kind, x, y, z, rotation: 0, support }, `b${state.nextId++}`, p.id);
    state.buildings.push(b);
    return b;
  };
  return { sim, state, p, add };
}

describe('landmarks and quarry progression', () => {
  it('generates six separated dry destinations and six rich deposits at each quarry across seeds', () => {
    for (const seed of [
      'quiet-frontier',
      'save-test',
      ...Array.from({ length: 20 }, (_, i) => `progression-${i}`),
    ]) {
      const generated = generateWorld(seed);
      expect(generated.sites).toHaveLength(6);
      expect(new Set(generated.sites.map((s) => s.id)).size).toBe(6);
      for (const site of generated.sites) {
        expect(site.y).toBeGreaterThan(1);
        for (const other of generated.sites.filter((s) => s.id !== site.id))
          expect(
            Math.hypot(site.x - other.x, site.z - other.z),
            `${seed}: ${site.id} / ${other.id}`,
          ).toBeGreaterThanOrEqual(32);
        if (isQuarry(site))
          expect(
            generated.resources.filter((r) => r.id.startsWith(`${site.id}-node-`)),
            `${seed} ${site.kind}`,
          ).toHaveLength(6);
      }
    }
    expect(generateWorld(world.seed).sites).toEqual(world.sites);
    expect(generateWorld(world.seed).resources).toEqual(world.resources);
  });
  it('shares finite salvage, rejects distance and walls, preserves partial loot and restocks deterministically', () => {
    const { state, sim, p, add } = fixture();
    const site = world.sites.find((s) => s.kind === 'depot')!;
    const before = structuredClone(state.sites[site.id]);
    expect(sim.command(p.id, { type: 'collect', target: site.id }).ok).toBe(false);
    p.position = { x: site.x, y: site.y, z: site.z + 2.5 };
    const wall = add('wall', site.x, site.z + 1.2, site.y);
    expect(sim.command(p.id, { type: 'collect', target: site.id }).ok).toBe(false);
    state.buildings = [];
    expect(wall.kind).toBe('wall');
    expect(
      sim.command(p.id, { type: 'collect', target: site.id, item: 'parts', count: 1 }).ok,
    ).toBe(true);
    expect(p.inventory.parts).toBe(1);
    expect(state.sites[site.id].inventory.parts ?? 0).toBe((before.inventory.parts ?? 0) - 1);
    const persisted = parseSave(encodeSave(state, p.id)).state;
    expect(persisted.sites).toEqual(state.sites);
    const other = sim.addPlayer('other', 'Bea');
    other.position = { ...p.position };
    expect(sim.command(other.id, { type: 'collect', target: site.id }).ok).toBe(true);
    expect(sim.command(p.id, { type: 'collect', target: site.id }).ok).toBe(false);
    const timer = state.sites[site.id].restockAt;
    state.time = timer - 1;
    restockSites(state, world);
    expect(state.sites[site.id].inventory).toEqual({});
    state.time = timer;
    restockSites(state, world);
    expect(state.sites[site.id].inventory).toEqual(siteLoot(world.seed, site, 1));
    expect(state.sites[site.id].cycle).toBe(1);
  });
  it('leaves items when a pack is full and never refills partially searched crates', () => {
    const { state, sim, p } = fixture(),
      site = world.sites.find((s) => s.kind === 'camp')!;
    p.position = { x: site.x, y: site.y, z: site.z + 2.5 };
    p.inventory = { stone: 500 };
    const before = structuredClone(state.sites[site.id]);
    expect(sim.command(p.id, { type: 'collect', target: site.id }).ok).toBe(false);
    expect(state.sites[site.id]).toEqual(before);
    p.inventory = {};
    expect(
      sim.command(p.id, { type: 'collect', target: site.id, item: 'cloth', count: 1 }).ok,
    ).toBe(true);
    const remaining = structuredClone(state.sites[site.id].inventory);
    state.time += SITE_TYPES.camp.restock + 1;
    restockSites(state, world);
    expect(state.sites[site.id].inventory).toEqual(remaining);
  });
  it('extracts a bounded vein faster with iron tools and preserves depletion on reload', () => {
    const { state, sim, p } = fixture();
    const node = world.resources.find((r) => r.kind === 'iron')!;
    p.position = { x: node.x, y: node.y + 0.2, z: node.z + 2.5 };
    p.yaw = 0;
    p.inventory = { ironPickaxe: 1 };
    p.equipped = 'ironPickaxe';
    expect(sim.command(p.id, { type: 'interact', target: node.id }).ok).toBe(true);
    expect(p.inventory.ironOre).toBe(RESOURCE_TYPES.iron.yield * 5);
    expect(state.resources[node.id].health).toBe(RESOURCE_TYPES.iron.health - 5);
    while (state.resources[node.id].health > 0) {
      p.cooldown = 0;
      sim.command(p.id, { type: 'interact', target: node.id });
    }
    expect(p.inventory.ironOre).toBe(RESOURCE_TYPES.iron.yield * RESOURCE_TYPES.iron.health);
    const before = { ...p.inventory };
    p.cooldown = 0;
    expect(sim.command(p.id, { type: 'interact', target: node.id }).ok).toBe(false);
    expect(p.inventory).toEqual(before);
    expect(parseSave(encodeSave(state, p.id)).state.resources).toEqual(state.resources);
    expect(RESOURCE_TYPES.quarryStone.health * RESOURCE_TYPES.quarryStone.yield).toBeGreaterThan(
      RESOURCE_TYPES.rock.health * RESOURCE_TYPES.rock.yield * 5,
    );
  });
  it('keeps distant site and chest inventories private in snapshots', () => {
    const { state, p, add } = fixture();
    const chest = add('storage', 20, 110);
    chest.inventory = { parts: 4 };
    const remote = snapshotFor(state, p.id, false, -1, world);
    expect(Object.values(remote.sites).every((s) => !Object.keys(s.inventory).length)).toBe(true);
    expect(remote.buildings[0].inventory).toEqual({});
    p.position = { x: 20, y: 8, z: 112 };
    expect(snapshotFor(state, p.id, false, -1, world).buildings[0].inventory).toEqual(
      chest.inventory,
    );
  });
});

describe('crafting, equipment and ranged hunting', () => {
  it.each(RECIPE_IDS)('crafts %s in batches with exact authoritative costs', (id) => {
    const { state, p, add } = fixture();
    const recipe: RecipeDefinition = RECIPES[id],
      batch = recipeCosts(recipe, 2);
    p.inventory = { ...batch.cost };
    if (recipe.station) {
      const before = structuredClone(p.inventory);
      expect(craftItems(state, world, p, id, 2).ok).toBe(false);
      expect(p.inventory).toEqual(before);
      add(recipe.station);
    }
    expect(craftItems(state, world, p, id, 2)).toMatchObject({ ok: true });
    expect(p.inventory).toEqual(batch.output);
  });
  it('rejects invalid batches and overweight output atomically', () => {
    const { state, p } = fixture();
    p.inventory = { stone: 480, cloth: 8, leather: 4, fiber: 10, rock: 1 };
    const before = { ...p.inventory };
    expect(inventoryWeight(before)).toBeLessThan(60);
    for (const count of [0, -1, 21, Infinity, 1.5, 1]) {
      expect(craftItems(state, world, p, 'backpack', count).ok).toBe(false);
      expect(p.inventory).toEqual(before);
    }
  });
  it('requires reachable stations, including vertical separation and intervening walls', () => {
    const { state, p, add } = fixture();
    p.inventory = { ...RECIPES.metal.cost };
    const furnace = add('furnace');
    add('wall', 0, 87.5);
    expect(craftItems(state, world, p, 'metal').ok).toBe(false);
    state.buildings = [furnace];
    furnace.y += 5;
    expect(craftItems(state, world, p, 'metal').ok).toBe(false);
  });
  it('applies worn capacity and armor, and prevents removing a needed pack by drop or deposit', () => {
    const { sim, state, p, add } = fixture();
    p.inventory = { backpack: 1, armor: 1, wood: 500 };
    expect(wearEquipment(p, 'backpack').ok).toBe(true);
    expect(carryCapacity(p)).toBe(90);
    expect(transact(p.inventory, {}, { wood: 200 }, carryCapacity(p)).ok).toBe(true);
    expect(wearEquipment(p, 'armor').ok).toBe(true);
    expect(armorResistance(p)).toBe(0.35);
    const chest = add('storage');
    const before = structuredClone(p);
    expect(wearEquipment(p, 'backpack').ok).toBe(false);
    expect(sim.command(p.id, { type: 'drop', item: 'backpack', count: 1 }).ok).toBe(false);
    expect(storageTransfer(state, world, p, chest.id, 'deposit', 'backpack', 1).ok).toBe(false);
    expect(p).toEqual(before);
    expect(storageTransfer(state, world, p, chest.id, 'deposit', 'wood', 300).ok).toBe(true);
    expect(wearEquipment(p, 'backpack').ok).toBe(true);
    expect(carryCapacity(p)).toBe(60);
  });
  it('spends one round per shot, honors cooldowns, resolves aim and obstruction, and drops species loot once', () => {
    const { state, p, add } = fixture();
    p.inventory = { huntingRifle: 1, cartridge: 3 };
    p.equipped = 'huntingRifle';
    const animal = {
      id: 'wild-test',
      species: 'boar' as const,
      behavior: 'roam' as const,
      x: 0,
      y: 8,
      z: 72,
      homeX: 0,
      homeZ: 72,
      yaw: 0,
      health: 60,
      cooldown: 0,
      respawnAt: 0,
    };
    state.animals.push(animal);
    p.pitch = Math.atan2(8.6 - 9.65, 14);
    const wall = add('wall', 0, 80);
    expect(attack(state, world, p).ok).toBe(true);
    expect(animal.health).toBe(60);
    expect(p.inventory.cartridge).toBe(2);
    expect(attack(state, world, p).ok).toBe(false);
    expect(p.inventory.cartridge).toBe(2);
    state.buildings = [];
    expect(wall.kind).toBe('wall');
    p.cooldown = 0;
    expect(attack(state, world, p).ok).toBe(true);
    expect(animal.health).toBe(0);
    expect(p.inventory.cartridge).toBe(1);
    expect(state.bags).toHaveLength(1);
    expect(state.bags[0].inventory).toEqual(WILDLIFE.boar.loot);
    p.cooldown = 0;
    attack(state, world, p);
    expect(state.bags).toHaveLength(1);
    expect(p.inventory.cartridge).toBeUndefined();
    p.cooldown = 0;
    expect(attack(state, world, p).ok).toBe(false);
    expect(parseState(state).bags).toEqual(state.bags);
  });
  it('does not grant the effects of an unowned weapon and rejects client-supplied hits', () => {
    const { state, p } = fixture();
    p.equipped = 'huntingRifle';
    expect(attack(state, world, p).ok).toBe(false);
    for (const request of [
      { type: 'attack', damage: 999 },
      { type: 'attack', target: 'wild-test' },
      { type: 'craft', recipe: 'metal', count: 21 },
      { type: 'storage', target: 'b1', direction: 'take', item: 'metal', count: -1 },
    ])
      expect(commandSchema.safeParse(request).success).toBe(false);
  });
});

describe('supported shelters and reinforcement', () => {
  it('snaps walls, floors and stairs to real support, and rejects unsupported upper pieces', () => {
    const { state, p, add } = fixture();
    p.position = { x: 0, y: 8, z: 95 };
    p.dev.freeBuild = true;
    expect(
      validateBuild(state, world, p, buildCandidate(state, world, 'floor', 0, 100, 0, 8.65)).ok,
    ).toBe(false);
    const base = add('foundation', 0, 100, 8.3);
    const wall = buildCandidate(state, world, 'wall', 0, 100, 0, 8.65);
    expect(wall).toMatchObject({ x: 0, y: 8.3, z: 98, support: base.id });
    expect(validateBuild(state, world, p, wall).ok).toBe(true);
    const support = createBuilding(wall, `b${state.nextId++}`, p.id);
    state.buildings.push(support);
    const floor = buildCandidate(state, world, 'floor', 0, 100, 0, 8.65);
    expect(floor).toMatchObject({ y: 11.3, support: support.id });
    const secondWall = add('window', 2, 100, 8.3, base.id);
    secondWall.rotation = 1;
    p.position = { x: 0, y: 8.3, z: 100 };
    expect(validateBuild(state, world, p, floor).ok).toBe(true);
    expect(validateBuild(state, world, p, { ...floor, kind: 'roof' }).ok).toBe(true);
    expect(buildCandidate(state, world, 'stairs', 0, 100, 0, 8.65)).toMatchObject({
      y: 8.3,
      support: base.id,
    });
  });
  it('permits a roof over the fourth storey while rejecting a fifth usable floor', () => {
    const { state, p, add } = fixture();
    p.inventory = { wood: 100, fiber: 50 };
    let platform = add('foundation', 0, 100, 8.3);
    for (let level = 0; level < BALANCE.maxStoreys; level++) {
      const wall = add('wall', 0, 98, platform.y, platform.id);
      if (level < BALANCE.maxStoreys - 1) platform = add('floor', 0, 100, platform.y + 3, wall.id);
    }
    p.position = { x: platform.x, y: platform.y, z: platform.z };
    const roof = buildCandidate(state, world, 'roof', 0, 100, 0, platform.y, p.position);
    expect(roof.y).toBeCloseTo(20.3);
    expect(validateBuild(state, world, p, roof)).toMatchObject({ ok: true });
    expect(validateBuild(state, world, p, { ...roof, kind: 'floor' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('4 storeys'),
    });
  });
  it.each([0, 1, 2, 3])(
    'opens and closes doors with matching collision and sight in rotation %s',
    (rotation) => {
      const { state, p, add } = fixture();
      const frame = add('doorway', 0, 100, 8.3),
        door = add('door', 0, 100, 8.3, frame.id);
      frame.rotation = door.rotation = rotation;
      const dx = Math.sin((rotation * Math.PI) / 2),
        dz = Math.cos((rotation * Math.PI) / 2);
      p.position = { x: dx * 1.8, y: 8.3, z: 100 + dz * 1.8 };
      expect(blocked(state, world, 0, 100, 8.3)).toBe(true);
      expect(lineOfSight(state, p, -dx * 2, 9.6, 100 - dz * 2, world)).toBe(false);
      expect(structureAction(state, world, p, door.id, 'door').ok).toBe(true);
      expect(blocked(state, world, 0, 100, 8.3)).toBe(false);
      expect(lineOfSight(state, p, -dx * 2, 9.6, 100 - dz * 2, world)).toBe(true);
      p.position = { x: 0, y: 8.3, z: 100 };
      expect(structureAction(state, world, p, door.id, 'door').ok).toBe(false);
      expect(door.open).toBe(true);
    },
  );
  it('lets players climb real stairs through a stairwell while solid floors block the opening', () => {
    const { state, p, add } = fixture();
    const base = add('foundation', 0, 100, 8.3),
      stairs = add('stairs', 0, 100, 8.3, base.id);
    add('stairwell', 0, 100, 11.3, stairs.id);
    p.position = { x: 0, y: 8.3, z: 101.9 };
    p.input.forward = 1;
    p.input.yaw = 0;
    for (let i = 0; i < 21; i++) stepPlayer(state, world, p, 1 / 30);
    expect(p.position.y).toBeGreaterThan(10.8);
    expect(p.position.z).toBeLessThan(98.8);
    expect(groundHeight(state, world, 1.5, 100, 12)).toBe(11.3);
    expect(
      structureSolids(
        createBuilding({ kind: 'window', x: 0, y: 8.3, z: 100, rotation: 0 }, 'window-test', p.id),
      ),
    ).toHaveLength(4);
  });
  it('upgrades and repairs atomically, preserves identity, and applies resistance to real damage', () => {
    const { state, p, add } = fixture();
    p.position = { x: 0, y: 8, z: 95 };
    const wall = add('wall', 0, 98);
    wall.health = 90;
    const original = structuredClone(wall);
    expect(structureAction(state, world, p, wall.id, 'upgrade').ok).toBe(false);
    expect(wall).toEqual(original);
    p.inventory = { stone: 50, wood: 4, reinforcedPlate: 6, metal: 12 };
    expect(structureAction(state, world, p, wall.id, 'upgrade').ok).toBe(true);
    expect(wall.grade).toBe('stone');
    expect(wall.health).toBe(225);
    expect(wall.id).toBe(original.id);
    expect(structureAction(state, world, p, wall.id, 'repair').ok).toBe(true);
    expect(wall.health).toBe(337.5);
    expect(structureAction(state, world, p, wall.id, 'upgrade').ok).toBe(true);
    const health = wall.health;
    damageStructure(state, world, wall.id, 100);
    expect(wall.health).toBeCloseTo(health - 55);
    expect(wall.grade).toBe('metal');
    expect(parseState(state).buildings[0]).toEqual(wall);
  });
  it('preserves chest contents through collapse and refuses voluntary removal of occupied supports', () => {
    const { state, p, add } = fixture();
    p.position = { x: 0, y: 8, z: 95 };
    const base = add('foundation', 0, 98, 8.3),
      chest = add('storage', 0, 98, 8.3, base.id);
    chest.inventory = { wood: 1200, stone: 100 };
    expect(structureAction(state, world, p, base.id, 'dismantle').ok).toBe(false);
    expect(damageStructure(state, world, base.id, 1000)).toBe(true);
    expect(state.buildings).toHaveLength(0);
    expect(state.bags).toHaveLength(1);
    expect(state.bags[0].inventory).toEqual(chest.inventory);
    expect(parseState(state).bags[0].inventory.wood).toBe(1200);
  });
  it('conserves storage stacks across two survivors and rejects remote withdrawals', () => {
    const { state, sim, p, add } = fixture();
    const chest = add('storage');
    p.inventory = { wood: 100 };
    expect(storageTransfer(state, world, p, chest.id, 'deposit', 'wood', 60).ok).toBe(true);
    const other = sim.addPlayer('other', 'Bea');
    other.position.x = 30;
    expect(storageTransfer(state, world, other, chest.id, 'take', 'wood', 60).ok).toBe(false);
    other.position = { ...p.position };
    expect(storageTransfer(state, world, other, chest.id, 'take', 'wood', 60).ok).toBe(true);
    expect(storageTransfer(state, world, p, chest.id, 'take', 'wood', 60).ok).toBe(false);
    expect((p.inventory.wood ?? 0) + (other.inventory.wood ?? 0)).toBe(100);
  });
});

describe('version four durability', () => {
  it('migrates v3 camps and suppresses conflicting new sites without moving old terrain or resources', () => {
    const { state, p, add } = fixture();
    const site = world.sites[0];
    add('foundation', site.x, site.z, site.y + 0.3);
    const legacy = JSON.parse(encodeSave(state, p.id));
    legacy.version = legacy.state.version = 3;
    delete legacy.state.sites;
    for (const player of Object.values(legacy.state.players) as Record<string, unknown>[]) {
      delete player.worn;
      delete player.quickSlots;
    }
    for (const building of legacy.state.buildings) {
      delete building.grade;
      delete building.health;
      delete building.open;
      delete building.inventory;
      delete building.support;
    }
    const restored = parseSave(JSON.stringify(legacy));
    expect(restored.version).toBe(4);
    expect(restored.state.sites[site.id].disabled).toBe(true);
    expect(restored.state.buildings[0]).toMatchObject({
      ...legacy.state.buildings[0],
      grade: 'timber',
      health: STRUCTURE_GRADES.timber.health,
    });
    expect(restored.state.terrain).toEqual(state.terrain);
    expect(restored.state.players.local.inventory).toEqual(p.inventory);
    expect(restored.state.players.local.quickSlots).toHaveLength(5);
  });
  it('rejects forged gear, health, container capacity, missing or cyclic supports', () => {
    const { state, add } = fixture();
    const b = add('storage');
    for (const change of [
      (copy: typeof state) => {
        copy.players.local.worn.backpack = 'backpack';
      },
      (copy: typeof state) => {
        copy.buildings[0].health = 901;
      },
      (copy: typeof state) => {
        copy.buildings[0].inventory.stone = 3000;
      },
      (copy: typeof state) => {
        copy.buildings[0].support = 'absent';
      },
      (copy: typeof state) => {
        copy.buildings[0].support = b.id;
      },
    ]) {
      const copy = structuredClone(state);
      change(copy);
      expect(() => parseState(copy)).toThrow();
    }
  });
  it('keeps a dead survivor inventory when the bag pool is full instead of destroying it', () => {
    const { state, sim, p } = fixture();
    state.bags = Array.from({ length: BALANCE.maxBags }, (_, i) => ({
      id: `bag${i + 1}`,
      owner: '',
      x: 0,
      y: 8,
      z: 110,
      inventory: { wood: 1 },
      expiresAt: 5000,
    }));
    state.nextId = BALANCE.maxBags + 1;
    p.inventory = { rock: 1, parts: 2 };
    const before = { ...p.inventory };
    p.health = 0.001;
    p.thirst = 0;
    sim.tick();
    expect(p.health).toBe(0);
    expect(p.inventory).toEqual(before);
    expect(sim.command(p.id, { type: 'respawn' }).ok).toBe(true);
    expect(p.inventory).toEqual(before);
  });
  it('every new building is affordable from registered resources and has nonempty shared geometry', () => {
    for (const [kind, definition] of Object.entries(BUILDINGS)) {
      expect(inventoryWeight(definition.cost)).toBeGreaterThan(0);
      expect(
        structureSolids(
          createBuilding(
            { kind: kind as BuildingKind, x: 0, y: 8, z: 0, rotation: 0 },
            'piece',
            'local',
          ),
        ).length,
      ).toBeGreaterThan(0);
    }
  });
});
