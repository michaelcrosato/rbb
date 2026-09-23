import { describe, expect, it } from 'vitest';
import {
  celestial,
  createEnvironment,
  DEFAULT_TUNING,
  setWeather,
  stepEnvironment,
  tuningSchema,
  weatherValues,
  WEATHER_IDS,
} from '../../src/shared/environment';
import { BALANCE, SPECIES_IDS, WILDLIFE } from '../../src/shared/content';
import { developerSchema } from '../../src/shared/developer';
import { inventoryWeight } from '../../src/shared/inventory';
import { parseState, encodeSave, parseSave } from '../../src/shared/save';
import { Simulation } from '../../src/shared/simulation';
import { createState } from '../../src/shared/state';
import {
  animalAt,
  habitatValid,
  MAX_ANIMALS,
  spawnWildlife,
  stepWildlife,
} from '../../src/shared/wildlife';
import { generateWorld, terrainHeight } from '../../src/shared/world';

const world = generateWorld('quiet-frontier');
const fixture = (allowed = true) => {
  const sim = new Simulation(world, createState(world), allowed);
  sim.addPlayer('local', 'Tester');
  return sim;
};

describe('celestial lighting and weather', () => {
  it('rises in the east, crosses the southern sky and sets in the west; latitude and season alter the arc', () => {
    const t = { ...DEFAULT_TUNING, latitude: 35, season: 0.25 };
    const dawn = celestial(createEnvironment(6), t),
      noon = celestial(createEnvironment(12), t),
      dusk = celestial(createEnvironment(18), t),
      night = celestial(createEnvironment(0), t);
    expect(dawn.sun.x).toBeCloseTo(1);
    expect(dusk.sun.x).toBeCloseTo(-1);
    expect(dawn.sun.y).toBeCloseTo(0);
    expect(dusk.sun.y).toBeCloseTo(0);
    expect(noon.sun.y).toBeGreaterThan(0.8);
    expect(noon.sun.z).toBeGreaterThan(0);
    expect(night.sunlight).toBe(0);
    expect(night.stars).toBeGreaterThan(0.5);
    expect(noon.stars).toBe(0);
    expect(dawn.twilight).toBeGreaterThan(0.7);
    expect(dusk.twilight).toBeGreaterThan(0.7);
    expect(celestial(createEnvironment(12), { ...t, season: 0.5 }).sun.y).toBeGreaterThan(
      celestial(createEnvironment(12), { ...t, season: 0 }).sun.y,
    );
    for (const c of [dawn, noon, dusk, night])
      expect(Math.hypot(c.sun.x, c.sun.y, c.sun.z)).toBeCloseTo(1);
  });
  it('full moon is opposite the sun, new moon casts no night light, and disc size scales light by area', () => {
    const e = createEnvironment(0),
      t = { ...DEFAULT_TUNING, moonPhase: 0.5 };
    const full = celestial(e, t),
      large = celestial(e, { ...t, moonSize: 2 }),
      newMoon = celestial(e, { ...t, moonPhase: 0 });
    expect(full.moon.y).toBeGreaterThan(0);
    expect(full.illumination).toBeCloseTo(1);
    expect(full.moonlight).toBeGreaterThan(0);
    expect(large.moonlight / full.moonlight).toBeCloseTo(4);
    expect(newMoon.moonlight).toBe(0);
    expect(newMoon.illumination).toBe(0);
    setWeather(e, 'storm', 0);
    expect(celestial(e, t).moonlight).toBeLessThan(full.moonlight * 0.15);
  });
  it('weather blends continuously, persists mid-transition, and replay is deterministic', () => {
    const a = createEnvironment(),
      b = createEnvironment(),
      tuning = { ...DEFAULT_TUNING, weatherPeriod: 30 };
    for (let i = 0; i < 3000; i++) {
      stepEnvironment(a, tuning, world.hash, 0.1);
      stepEnvironment(b, tuning, world.hash, 0.1);
    }
    expect(a).toEqual(b);
    expect(a.weatherSequence).toBeGreaterThan(5);
    const sim = fixture();
    setWeather(sim.state.environment, 'rain', 20);
    for (let i = 0; i < 100; i++) sim.tick(0.1);
    const before = weatherValues(sim.state.environment);
    expect(before.rain).toBeCloseTo(0.35);
    const restored = parseSave(encodeSave(sim.state, 'local')).state;
    expect(weatherValues(restored.environment)).toEqual(before);
    setWeather(sim.state.environment, 'snow', 20);
    expect(weatherValues(sim.state.environment)).toEqual(before);
    for (const weather of WEATHER_IDS) {
      setWeather(a, weather, 0);
      const values = weatherValues(a);
      expect(Object.values(values).every((n) => n >= 0 && n <= 1)).toBe(true);
    }
  });
  it('seeking or freezing the sky leaves survival and respawn clocks monotonic', () => {
    const sim = fixture(),
      originalTime = sim.state.time;
    sim.state.bags.push({
      id: 'bag1',
      owner: '',
      x: 0,
      y: 8,
      z: 86,
      inventory: { wood: 2 },
      expiresAt: originalTime + 500,
    });
    sim.state.nextId = 2;
    sim.command('local', { type: 'dev', request: { action: 'time', hour: 0 } });
    sim.command('local', {
      type: 'dev',
      request: { action: 'configure', tuning: { ...DEFAULT_TUNING, timeScale: 0 } },
    });
    sim.tick(0.1);
    expect(sim.state.time).toBeCloseTo(originalTime + 0.1);
    expect(sim.state.environment.hours).toBe(0);
    expect(sim.state.bags).toHaveLength(1);
  });
});

describe('wildlife habitats and behavior', () => {
  it('populates every species deterministically, mostly on land, outside the starter refuge', () => {
    const state = createState(world);
    expect(state).toEqual(createState(world));
    expect(new Set(state.animals.map((a) => a.species))).toEqual(new Set(SPECIES_IDS));
    expect(
      state.animals.filter((a) => WILDLIFE[a.species].habitat === 'land').length,
    ).toBeGreaterThan(state.animals.length * 0.7);
    for (const a of state.animals) {
      expect(habitatValid(world, a.species, a.x, a.z)).toBe(true);
      expect(Math.hypot(a.x, a.z - 86)).toBeGreaterThan(45);
    }
    for (let i = 0; i < 1200; i++) stepWildlife(state, world, [], 0.1, () => {});
    for (const a of state.animals) {
      expect(habitatValid(world, a.species, a.x, a.z)).toBe(true);
      expect(a.y).toBeGreaterThanOrEqual(terrainHeight(a.x, a.z, world.hash));
    }
  });
  it('lets every seeded land animal roam from walkable slopes and trunk overlaps', () => {
    // quiet-frontier's boar1 stands on a walkable slope; seed b seeds rabbit13 inside a rock.
    for (const seed of ['quiet-frontier', 'b']) {
      const seeded = generateWorld(seed);
      const sim = new Simulation(seeded, createState(seeded));
      const start = new Map(sim.state.animals.map((a) => [a.id, { x: a.x, z: a.z }]));
      for (let i = 0; i < 1800; i++) sim.tick();
      for (const a of sim.state.animals.filter((a) => WILDLIFE[a.species].habitat === 'land')) {
        const from = start.get(a.id)!;
        expect(Math.hypot(a.x - from.x, a.z - from.z), `${seed} ${a.id}`).toBeGreaterThan(0.05);
      }
    }
  });
  it('lets wolves roam when wildlife aggression is tuned to zero', () => {
    const sim = fixture();
    sim.state.tuning.wildlifeAggression = 0;
    // 16 m from the survivor: outside the 10 m radius at which passive animals flee people.
    const wolf = animalAt(world, 'wolf', 'wolf', 0, 70);
    sim.state.animals = [wolf];
    for (let i = 0; i < 90; i++) sim.tick();
    expect(wolf.behavior).not.toBe('flee');
    expect(Math.hypot(wolf.x - 0, wolf.z - 70)).toBeGreaterThan(0.5);
  });
  it('prey flee, boars defend territory, invincibility prevents damage and marine spawning needs water', () => {
    const sim = fixture(),
      p = sim.state.players.local;
    sim.state.animals = [
      animalAt(world, 'deer', 'deer', 0, 83),
      animalAt(world, 'boar', 'boar', 0, 85),
    ];
    sim.tick(0.1);
    expect(sim.state.animals[0].behavior).toBe('flee');
    expect(sim.state.animals[0].z).toBeLessThan(83);
    expect(p.health).toBe(88);
    p.dev.invincible = true;
    p.health = 100;
    sim.state.animals[1].cooldown = 0;
    sim.tick(0.1);
    expect(p.health).toBe(100);
    expect(spawnWildlife(sim.state, world, 'dolphin', 2, 0, 86)).toBe(0);
    const sea = createState(world).animals.find((a) => a.species === 'dolphin')!;
    expect(spawnWildlife(sim.state, world, 'dolphin', 2, sea.x, sea.z)).toBe(2);
    while (sim.state.animals.length < MAX_ANIMALS)
      sim.state.animals.push({ ...sea, id: `test${sim.state.animals.length}` });
    expect(spawnWildlife(sim.state, world, 'dolphin', 2, sea.x, sea.z)).toBe(0);
  });
  it('diving consumes air and releasing dive returns a swimmer to the surface', () => {
    const sim = fixture(),
      p = sim.state.players.local;
    const sea = sim.state.animals.find((a) => a.species === 'dolphin')!;
    p.position = { x: sea.x, y: -1.2, z: sea.z };
    p.input.dive = true;
    for (let i = 0; i < 120; i++) sim.tick();
    expect(p.position.y + 1.65).toBeLessThan(0);
    expect(p.oxygen).toBeLessThan(100);
    p.input.dive = false;
    for (let i = 0; i < 450; i++) sim.tick();
    expect(p.position.y).toBeCloseTo(-1.2);
    expect(p.oxygen).toBe(100);
    expect(p.health).toBe(100);
  });
  it('caps fall speed at the bound saves and snapshots accept, even under tuned gravity', () => {
    const sim = fixture(),
      p = sim.state.players.local;
    sim.state.tuning.gravity = 3;
    p.dev.invincible = true;
    p.position.y += 110;
    let fastest = 0;
    for (let i = 0; i < 120; i++) {
      sim.tick();
      fastest = Math.min(fastest, p.velocityY);
      expect(() => parseState(sim.state)).not.toThrow();
    }
    expect(fastest).toBe(-BALANCE.terminalVelocity);
  });
  it('developer flight rises while held, stops on release and descends without affecting ordinary jumps', () => {
    const sim = fixture(),
      p = sim.state.players.local;
    sim.command('local', { type: 'dev', request: { action: 'flag', flag: 'flight', value: true } });
    const startY = p.position.y;
    sim.command('local', { type: 'move', input: { ...p.input, jump: true } });
    for (let i = 0; i < 30; i++) sim.tick();
    expect(p.position.y).toBeGreaterThan(startY + 5);
    const highY = p.position.y;
    sim.command('local', { type: 'move', input: { ...p.input, jump: false } });
    for (let i = 0; i < 30; i++) sim.tick();
    expect(p.position.y).toBe(highY);
    sim.command('local', { type: 'move', input: { ...p.input, dive: true } });
    for (let i = 0; i < 30; i++) sim.tick();
    expect(p.position.y).toBeLessThan(highY - 5);
  });
  it('species supply their own loot and respawn safely away from players', () => {
    const sim = fixture(),
      p = sim.state.players.local;
    p.equipped = 'hatchet';
    p.inventory.hatchet = 1;
    sim.state.animals = [animalAt(world, 'rabbit', 'rabbit', 0, 84)];
    expect(sim.command('local', { type: 'interact', target: 'rabbit' }).ok).toBe(true);
    expect(sim.state.bags[0].inventory).toEqual(WILDLIFE.rabbit.loot);
    sim.state.animals[0].respawnAt = sim.state.time;
    sim.tick(0.1);
    expect(sim.state.animals[0].health).toBe(0);
    p.position.z = 110;
    sim.tick(0.1);
    expect(sim.state.animals[0].health).toBe(WILDLIFE.rabbit.health);
  });
});

describe('developer boundaries and persistence', () => {
  it('rejects mutations without host capability and rejects invalid parameters without partial changes', () => {
    const sim = fixture(false),
      before = structuredClone(sim.state);
    expect(sim.command('local', { type: 'dev', request: { action: 'kit' } }).ok).toBe(false);
    expect(sim.state).toEqual(before);
    expect(developerSchema.safeParse({ action: 'teleport', x: Infinity, z: 0 }).success).toBe(
      false,
    );
    expect(tuningSchema.safeParse({ ...DEFAULT_TUNING, gravity: 0 }).success).toBe(false);
    expect(tuningSchema.safeParse({ ...DEFAULT_TUNING, gatherYield: 1.5 }).success).toBe(false);
    expect(tuningSchema.safeParse({ ...DEFAULT_TUNING, maxPlayers: 999 }).success).toBe(false);
  });
  it('keeps grants bounded, marks sandboxes, applies tuning and restores all state from a checkpoint', () => {
    const sim = fixture(),
      original = encodeSave(sim.state, 'local');
    expect(sim.command('local', { type: 'dev', request: { action: 'kit' } }).ok).toBe(true);
    expect(inventoryWeight(sim.state.players.local.inventory)).toBeLessThanOrEqual(60);
    expect(sim.state.sandbox).toBe(true);
    expect(
      sim.command('local', {
        type: 'dev',
        request: { action: 'grant', item: 'pickaxe', count: 100 },
      }).ok,
    ).toBe(false);
    const saved = parseSave(encodeSave(sim.state, 'local'));
    expect(saved.state.players.local.inventory.hatchet).toBe(1);
    expect(parseSave(original).state.players.local.inventory).toEqual({ rock: 1, berries: 3 });
    const oldTick = sim.state.tick;
    sim.command('local', { type: 'dev', request: { action: 'step', ticks: 30 } });
    expect(sim.state.tick - oldTick).toBe(30);
  });
  it('migrates v1 saves without changing the island, structures, inventory, boars or timers', () => {
    const sim = fixture(),
      current = JSON.parse(encodeSave(sim.state, 'local'));
    current.version = 1;
    current.state.version = 1;
    delete current.state.terrain;
    delete current.state.sites;
    delete current.state.environment;
    delete current.state.tuning;
    delete current.state.sandbox;
    for (const p of Object.values(current.state.players) as Record<string, unknown>[]) {
      delete p.worn;
      delete p.quickSlots;
      delete p.dev;
      delete p.oxygen;
      delete (p.input as Record<string, unknown>).dive;
    }
    current.state.animals = current.state.animals.filter(
      (a: { species: string }) => a.species === 'boar',
    );
    for (const a of current.state.animals) {
      delete a.species;
      delete a.behavior;
    }
    current.state.resources['starter-tree'] = { health: 0, respawnAt: 1200 };
    const migrated = parseSave(JSON.stringify(current));
    expect(migrated.version).toBe(4);
    expect(migrated.state.version).toBe(4);
    expect(migrated.state.worldVersion).toBe(current.state.worldVersion);
    expect(migrated.state.time).toBe(current.state.time);
    expect(migrated.state.resources).toEqual(current.state.resources);
    expect(
      migrated.state.animals
        .filter((a) => a.species === 'boar')
        .map(({ species: _species, behavior: _behavior, ...a }) => a),
    ).toEqual(current.state.animals);
    expect(migrated.state.players.local.dev.invincible).toBe(false);
    expect(migrated.state.animals.some((a) => a.species === 'dolphin')).toBe(true);
    const corrupt = structuredClone(migrated.state);
    corrupt.animals[1].id = corrupt.animals[0].id;
    expect(() => parseState(corrupt)).toThrow('Duplicate');
  });
});
