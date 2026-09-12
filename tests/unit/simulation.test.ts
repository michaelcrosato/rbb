import { beforeEach, describe, expect, it } from 'vitest';
import { BALANCE, BUILDINGS } from '../../src/shared/content';
import { buildCandidate, validateBuild } from '../../src/shared/building';
import { inventoryWeight, transact } from '../../src/shared/inventory';
import { random } from '../../src/shared/math';
import { blocked } from '../../src/shared/physics';
import { commandSchema } from '../../src/shared/protocol';
import { parseState } from '../../src/shared/save';
import { Simulation } from '../../src/shared/simulation';
import { createState, idleInput } from '../../src/shared/state';
import type { PlayerState } from '../../src/shared/state';
import { generateWorld } from '../../src/shared/world';

const world = generateWorld('quiet-frontier');
let sim: Simulation, p: PlayerState;
const advance = (seconds: number) => {
  for (let i = 0; i < Math.ceil(seconds * BALANCE.tickRate); i++) sim.tick();
};
const face = (id: string) => {
  const r = world.resourceMap.get(id)!;
  p.position = { x: r.x, z: r.z + 2.5, y: r.y };
  p.yaw = 0;
  p.input = idleInput();
  p.cooldown = 0;
};
beforeEach(() => {
  sim = new Simulation(world, createState(world));
  p = sim.addPlayer('test', 'Tester');
});

describe('gather, craft, survive, build', () => {
  it('plays the core progression loop with real command transactions', () => {
    face('starter-fiber');
    expect(sim.command(p.id, { type: 'interact', target: 'starter-fiber' }).ok).toBe(true);
    for (const id of ['starter-tree', 'starter-rock']) {
      face(id);
      for (let i = 0; i < 6; i++) {
        expect(sim.command(p.id, { type: 'interact', target: id }).ok).toBe(true);
        advance(0.6);
      }
    }
    expect(p.inventory).toMatchObject({ wood: 36, stone: 30, fiber: 6 });
    expect(sim.command(p.id, { type: 'craft', recipe: 'hatchet' }).ok).toBe(true);
    expect(p.inventory).toMatchObject({ hatchet: 1, wood: 24, stone: 22, fiber: 3 });
    expect(p.equipped).toBe('hatchet');
    p.position = { x: 0, y: 8, z: 94 };
    p.cooldown = 0;
    expect(
      sim.command(p.id, { type: 'build', kind: 'foundation', x: 0, z: 100, rotation: 0 }).ok,
    ).toBe(true);
    expect(sim.state.buildings).toHaveLength(1);
    expect(p.inventory.wood).toBeUndefined();
    expect(p.milestones).toMatchObject({ gather: 72, craft: 1, build: 1 });
  });
  it('refuses remote gathering, stale targets, cooldown spam and unowned tools', () => {
    const before = structuredClone(p.inventory);
    expect(sim.command(p.id, { type: 'interact', target: 'starter-tree' }).ok).toBe(false);
    expect(p.inventory).toEqual(before);
    expect(sim.command(p.id, { type: 'equip', item: 'hatchet' }).ok).toBe(false);
    face('starter-tree');
    sim.command(p.id, { type: 'interact', target: 'starter-tree' });
    const after = structuredClone(p.inventory);
    expect(sim.command(p.id, { type: 'interact', target: 'starter-tree' }).ok).toBe(false);
    expect(p.inventory).toEqual(after);
    face('starter-fiber');
    sim.command(p.id, { type: 'interact', target: 'starter-fiber' });
    advance(0.6);
    expect(sim.command(p.id, { type: 'interact', target: 'starter-fiber' }).ok).toBe(false);
  });
  it('applies tool bonuses without overpaying for the final hit', () => {
    p.inventory.hatchet = 1;
    p.equipped = 'hatchet';
    face('starter-tree');
    sim.state.resources['starter-tree'] = { health: 1, respawnAt: 0 };
    sim.command(p.id, { type: 'interact', target: 'starter-tree' });
    expect(p.inventory.wood).toBe(6);
    expect(sim.state.resources['starter-tree'].health).toBe(0);
  });
  it('keeps failed crafting and full-pack gathering atomic', () => {
    p.inventory = { rock: 1, wood: 10 };
    const before = structuredClone(p.inventory);
    expect(sim.command(p.id, { type: 'craft', recipe: 'hatchet' }).ok).toBe(false);
    expect(p.inventory).toEqual(before);
    p.inventory = { wood: 600 };
    face('starter-tree');
    expect(sim.command(p.id, { type: 'interact', target: 'starter-tree' }).ok).toBe(false);
    expect(sim.state.resources['starter-tree']).toBeUndefined();
    expect(transact(p.inventory, { wood: -100 }, {}).ok).toBe(false);
  });
  it('supports multiple craft/use actions while the solo world is paused', () => {
    p.inventory = { fiber: 12, berries: 2 };
    p.hunger = 40;
    expect(sim.command(p.id, { type: 'craft', recipe: 'bandage' }).ok).toBe(true);
    expect(sim.command(p.id, { type: 'craft', recipe: 'bandage' }).ok).toBe(true);
    expect(sim.command(p.id, { type: 'consume', item: 'berries' }).ok).toBe(true);
    expect(sim.command(p.id, { type: 'consume', item: 'berries' }).ok).toBe(true);
    expect(p.hunger).toBe(72);
    expect(p.inventory.bandage).toBe(2);
  });
  it('requires a campfire for cooking and a spring for fresh water', () => {
    p.inventory = { meat: 1, wood: 2 };
    expect(sim.command(p.id, { type: 'craft', recipe: 'cookedMeat' }).ok).toBe(false);
    sim.state.buildings.push({
      id: 'b1',
      kind: 'campfire',
      owner: p.id,
      x: 0,
      z: 89,
      y: 8,
      rotation: 0,
    });
    expect(sim.command(p.id, { type: 'craft', recipe: 'cookedMeat' }).ok).toBe(true);
    face('starter-spring');
    p.thirst = 10;
    sim.command(p.id, { type: 'interact', target: 'starter-spring' });
    expect(p.thirst).toBe(100);
  });
  it('rejects unsupported, flooded, obstructed, duplicate and unaffordable structures', () => {
    p.inventory = { wood: 200, stone: 150, fiber: 50 };
    p.position = { x: 0, z: 95, y: 8 };
    expect(sim.command(p.id, { type: 'build', kind: 'wall', x: 0, z: 100, rotation: 0 }).ok).toBe(
      false,
    );
    expect(
      sim.command(p.id, { type: 'build', kind: 'foundation', x: 0, z: 100, rotation: 0 }).ok,
    ).toBe(true);
    p.cooldown = 0;
    const before = structuredClone(p.inventory);
    expect(
      sim.command(p.id, { type: 'build', kind: 'foundation', x: 0, z: 100, rotation: 0 }).ok,
    ).toBe(false);
    expect(p.inventory).toEqual(before);
    const wall = buildCandidate(sim.state, world, 'wall', 0, 100, 0);
    expect(wall).toMatchObject({ x: 0, z: 98 });
    expect(validateBuild(sim.state, world, p, wall).ok).toBe(true);
    expect(sim.command(p.id, { type: 'build', kind: 'wall', x: 0, z: 100, rotation: 0 }).ok).toBe(
      true,
    );
    p.position = { x: 290, y: -1.2, z: 290 };
    p.cooldown = 0;
    expect(
      sim.command(p.id, { type: 'build', kind: 'campfire', x: 294, z: 290, rotation: 0 }).ok,
    ).toBe(false);
    p.position = { x: -3.5, y: 8, z: 83 };
    expect(
      sim.command(p.id, { type: 'build', kind: 'foundation', x: -4, z: 80, rotation: 0 }).ok,
    ).toBe(false);
  });
  it('drops a recoverable pack once, respawns at the bedroll, and expires old loot', () => {
    p.inventory = { ...BUILDINGS.bedroll.cost, rock: 1, stone: 5 };
    p.position = { x: 0, y: 8, z: 94 };
    expect(sim.command(p.id, { type: 'build', kind: 'bedroll', x: 0, z: 99, rotation: 0 }).ok).toBe(
      true,
    );
    p.position = { x: 0, y: 8, z: 90 };
    p.thirst = 0;
    p.health = 0.01;
    advance(0.1);
    expect(p.health).toBe(0);
    expect(p.deaths).toBe(1);
    expect(sim.state.bags).toHaveLength(1);
    advance(1);
    expect(sim.state.bags).toHaveLength(1);
    expect(sim.command(p.id, { type: 'respawn' }).ok).toBe(true);
    expect(p.position.z).toBe(99);
    expect(p.health).toBe(100);
    p.position = { x: 0, y: 8, z: 92 };
    p.yaw = 0;
    expect(sim.command(p.id, { type: 'interact', target: sim.state.bags[0].id }).ok).toBe(true);
    expect(p.inventory.stone).toBe(5);
    expect(sim.state.bags).toHaveLength(0);
  });
  it('regrows resources after their timer but never through buildings or players', () => {
    face('starter-tree');
    sim.state.resources['starter-tree'] = { health: 0, respawnAt: sim.state.time + 1 };
    advance(2);
    expect(sim.state.resources['starter-tree']).toBeDefined();
    p.position = { x: 0, y: 8, z: 95 };
    advance(1.1);
    expect(sim.state.resources['starter-tree']).toBeUndefined();
  });
});

describe('movement, combat and bounded simulation', () => {
  it('moves at a fixed speed, normalizes diagonal motion, and retains jump edges between ticks', () => {
    p.position = { x: 0, y: 8, z: 94 };
    sim.command(p.id, { type: 'move', input: { ...idleInput(), forward: -1, strafe: 1 } });
    advance(1);
    expect(Math.hypot(p.position.x, p.position.z - 94)).toBeCloseTo(BALANCE.walkSpeed, 3);
    sim.command(p.id, { type: 'move', input: { ...idleInput(), jump: true } });
    sim.command(p.id, { type: 'move', input: idleInput() });
    sim.tick();
    expect(p.position.y).toBeGreaterThan(8);
    expect(p.grounded).toBe(false);
  });
  it('collides with trunks, rocks and constructed walls', () => {
    expect(blocked(sim.state, world, -3.5, 79, 8)).toBe(true);
    expect(blocked(sim.state, world, 5, 80, 8)).toBe(true);
    sim.state.buildings.push({
      id: 'b1',
      kind: 'wall',
      owner: p.id,
      x: 0,
      z: 92,
      y: 8,
      rotation: 0,
    });
    p.position = { x: 0, y: 8, z: 94 };
    sim.command(p.id, { type: 'move', input: { ...idleInput(), forward: 1 } });
    advance(2);
    expect(p.position.z).toBeGreaterThan(92.4);
  });
  it('boars attack active players, can be killed, and leave supplies', () => {
    const animal = sim.state.animals[0];
    p.position = { x: animal.x, y: animal.y, z: animal.z + 1.6 };
    p.inventory.hatchet = 1;
    p.equipped = 'hatchet';
    advance(0.1);
    expect(p.health).toBeLessThan(100);
    expect(sim.command(p.id, { type: 'interact', target: animal.id }).ok).toBe(true);
    advance(0.7);
    expect(sim.command(p.id, { type: 'interact', target: animal.id }).ok).toBe(true);
    expect(animal.health).toBe(0);
    expect(sim.state.bags[0].inventory.meat).toBe(3);
  });
  it('never simulates disconnected survivors', () => {
    p.thirst = 0;
    const before = structuredClone(p);
    advance(0.1);
    const health = p.health;
    for (let i = 0; i < 300; i++) sim.tick(1 / 30, new Set());
    expect(p.health).toBe(health);
    expect(p.position).toEqual(before.position);
  });
  it('rejects malformed external commands and non-fixed time steps', () => {
    for (const value of [
      { type: 'move', input: { ...idleInput(), forward: 99 } },
      { type: 'move', input: { ...idleInput(), yaw: NaN } },
      { type: 'build', kind: 'castle', x: 0, z: 0, rotation: 0 },
      { type: 'craft', recipe: 'hatchet', inventory: { wood: 99999 } },
    ])
      expect(commandSchema.safeParse(value).success).toBe(false);
    expect(() => sim.tick(Infinity)).toThrow();
    expect(() => sim.tick(1)).toThrow();
  });
  it('survives 10 world minutes of adversarial legal input and serializes valid state', () => {
    const rng = random(420);
    for (let i = 0; i < 18000; i++) {
      if (p.health <= 0) sim.command(p.id, { type: 'respawn' });
      if (i % 15 === 0)
        sim.command(p.id, {
          type: 'move',
          input: {
            forward: rng() * 2 - 1,
            strafe: rng() * 2 - 1,
            yaw: rng() * 6.2 - 3.1,
            pitch: 0,
            sprint: rng() > 0.5,
            jump: rng() > 0.8,
          },
        });
      sim.tick();
      if (i % 300 === 0) {
        expect(inventoryWeight(p.inventory)).toBeLessThanOrEqual(60);
        expect(() => parseState(structuredClone(sim.state))).not.toThrow();
      }
    }
    expect(Number.isFinite(p.position.y)).toBe(true);
    expect(sim.events.length).toBeLessThanOrEqual(200);
  });
});
