import { createBuilding } from '../../src/shared/state';
import type { Building, BuildingPlacement } from '../../src/shared/state';
import { describe, expect, it } from 'vitest';
import { buildCandidate, validateBuild } from '../../src/shared/building';
import {
  editTerrain,
  playerEarthwork,
  previewTerrain,
  resourceSupported,
  terrainAim,
} from '../../src/shared/earthworks';
import { groundHeight, lineOfSight } from '../../src/shared/physics';
import { commandSchema } from '../../src/shared/protocol';
import { encodeSave, parseSave } from '../../src/shared/save';
import { Simulation } from '../../src/shared/simulation';
import { createState, idleInput } from '../../src/shared/state';
import {
  applyTerrainUpdate,
  commitTerrainEdit,
  emptyTerrain,
  planTerrainEdit,
  terrainBodyClear,
  terrainCeiling,
  terrainChunkTriangles,
  terrainDensity,
  terrainFloor,
  terrainIndex,
  terrainRaycast,
  terrainSchema,
  terrainSurfaces,
  terrainUpdate,
} from '../../src/shared/terrain';
import type { TerrainBrush, TerrainState } from '../../src/shared/terrain';
import { generateWorld, terrainHeight } from '../../src/shared/world';
import { animalAt } from '../../src/shared/wildlife';

const world = generateWorld('quiet-frontier');
const fixture = () => {
  const sim = new Simulation(world, createState(world), true);
  const p = sim.addPlayer('local', 'Earthworker');
  sim.state.animals = [];
  return { sim, p, state: sim.state };
};
const brush = (overrides: Partial<TerrainBrush> = {}): TerrainBrush => ({
  mode: 'dig',
  shape: 'box',
  x: 20,
  y: 4,
  z: 88,
  radius: 2,
  strength: 1,
  level: 2,
  ...overrides,
});
const sculpt = (state: ReturnType<typeof createState>, b: TerrainBrush) => {
  const plan = planTerrainEdit(state.terrain, world, b);
  commitTerrainEdit(state.terrain, plan.patch);
  return plan;
};

const building = (b: BuildingPlacement & Pick<Building, 'id' | 'owner'>): Building =>
  createBuilding(b, b.id, b.owner);

describe('volumetric terrain foundation', () => {
  it('retains the seeded triangle surface, including negative coordinates and cell diagonals', () => {
    const terrain = emptyTerrain();
    for (const [x, z] of [
      [0.25, 84.75],
      [-64.4, 17.2],
      [65.1, -39.8],
      [65.8, -37.4],
    ]) {
      const height = terrainHeight(x, z, world.hash);
      expect(terrainFloor(terrain, world, x, z)).toBe(height);
      expect(terrainCeiling(terrain, world, x, z, height + 2)).toBe(Infinity);
      const hit = terrainRaycast(terrain, world, { x, y: height + 4, z }, { x: 0, y: -1, z: 0 }, 8);
      expect(hit?.point.y).toBeCloseTo(height, 8);
    }
  });
  it('carves a cavity with separate floor, ceiling and undisturbed ground above it', () => {
    const { state } = fixture();
    sculpt(state, brush());
    expect(terrainSurfaces(state.terrain, world, 20.2, 88.3).map((s) => [s.y, s.floor])).toEqual([
      [2, true],
      [6, false],
      [terrainHeight(20.2, 88.3, world.hash), true],
    ]);
    expect(terrainFloor(state.terrain, world, 20.2, 88.3, 4)).toBe(2);
    expect(terrainCeiling(state.terrain, world, 20.2, 88.3, 4)).toBe(6);
    expect(terrainDensity(state.terrain, world, 20.2, 4, 88.3)).toBeGreaterThan(0);
    expect(terrainDensity(state.terrain, world, 20.2, 7, 88.3)).toBeLessThan(0);
    const roof = terrainRaycast(
      state.terrain,
      world,
      { x: 20.2, y: 4, z: 88.3 },
      { x: 0, y: 1, z: 0 },
      4,
    );
    expect(roof?.point.y).toBe(6);
    expect(roof?.normal.y).toBe(-1);
  });
  it('emits outward-facing triangles that agree with the collision field at cave and chunk seams', () => {
    const { state } = fixture();
    sculpt(state, brush({ x: 0, y: 4, z: 64, radius: 3, shape: 'sphere' }));
    let subterranean = 0;
    for (const [cx, cz] of [
      [-4, 60],
      [0, 60],
      [-4, 64],
      [0, 64],
    ]) {
      for (const [a, b, c] of terrainChunkTriangles(state.terrain, world, cx, cz, 4)) {
        const x = (a.x + b.x + c.x) / 3,
          y = (a.y + b.y + c.y) / 3,
          z = (a.z + b.z + c.z) / 3;
        expect(terrainDensity(state.terrain, world, x, y, z)).toBeCloseTo(0, 7);
        const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
          ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const n = {
          x: ab.y * ac.z - ab.z * ac.y,
          y: ab.z * ac.x - ab.x * ac.z,
          z: ab.x * ac.y - ab.y * ac.x,
        };
        const length = Math.hypot(n.x, n.y, n.z);
        expect(length).toBeGreaterThan(0);
        expect(
          terrainDensity(
            state.terrain,
            world,
            x + (n.x / length) * 0.001,
            y + (n.y / length) * 0.001,
            z + (n.z / length) * 0.001,
          ),
          JSON.stringify({ a, b, c, n }),
        ).toBeGreaterThanOrEqual(-1e-6);
        if (y < terrainHeight(x, z, world.hash) - 0.1) subterranean++;
      }
    }
    expect(subterranean).toBeGreaterThan(20);
  });
  it('walks on a cave floor, collides with walls and stops jumps at a low ceiling', () => {
    const { sim, state, p } = fixture();
    sculpt(state, brush({ y: 3.25, radius: 1.25 }));
    p.position = { x: 20, y: 2, z: 88 };
    p.input = { ...idleInput(), forward: 1, jump: true };
    let highest = p.position.y;
    for (let i = 0; i < 90; i++) {
      sim.tick();
      highest = Math.max(highest, p.position.y);
    }
    expect(highest).toBeLessThanOrEqual(2.81);
    expect(p.position.z).toBeGreaterThan(86.7);
    expect(p.position.y).toBeCloseTo(2, 3);
    expect(terrainBodyClear(state.terrain, world, p.position.x, p.position.y, p.position.z)).toBe(
      true,
    );
  });
  it('keeps collision at zero-valued surface boundaries when approaching a pit', () => {
    const { state, sim, p } = fixture();
    sculpt(state, brush({ shape: 'sphere', x: 0, y: 7.55, z: 90.15, radius: 1.5 }));
    for (let z = 86; z <= 94; z += 0.125) {
      const hit = terrainRaycast(
        state.terrain,
        world,
        { x: 0, y: 12, z },
        { x: 0, y: -1, z: 0 },
        10,
      );
      expect(terrainFloor(state.terrain, world, 0, z)).toBeCloseTo(hit!.point.y, 8);
    }
    p.position = { x: 0, y: 8, z: 86 };
    p.input = { ...idleInput(), yaw: Math.PI, forward: 1 };
    for (let i = 0; i < 24; i++) sim.tick();
    expect(p.position.z).toBeGreaterThan(89);
    expect(p.position.y).toBeGreaterThan(6);
    expect(p.position.y).toBeLessThan(8);
  });
  it('falls into excavated ground instead of snapping back to the original surface', () => {
    const { sim, state, p } = fixture();
    p.position = { x: 20, y: 8, z: 88 };
    expect(editTerrain(state, world, p, brush({ y: 7, radius: 2 }), true).ok).toBe(true);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(p.position.y).toBe(5);
    expect(p.grounded).toBe(true);
  });
  it('supports buildings inside a cave and blocks interactions through solid roofs and walls', () => {
    const { state, p } = fixture();
    sculpt(state, brush({ radius: 4, y: 6, level: 2 }));
    // Add a solid roof over the excavated chamber without filling it.
    sculpt(state, brush({ mode: 'add', radius: 4, y: 12 }));
    sculpt(state, brush({ radius: 3, y: 5 }));
    p.position = { x: 20, y: 2, z: 90.5 };
    p.dev.freeBuild = true;
    const bed = buildCandidate(state, world, 'bedroll', 20, 88, 0, p.position.y + 0.65);
    expect(bed.y).toBe(2);
    expect(validateBuild(state, world, p, bed).ok).toBe(true);
    expect(groundHeight(state, world, 20, 88, p.position.y + 0.65)).toBe(2);
    expect(lineOfSight(state, p, 20, 17, 88, world)).toBe(false);
    state.buildings.push(building({ ...bed, id: 'b1', owner: p.id }));
    state.nextId = 2;
    const before = structuredClone(state);
    expect(editTerrain(state, world, p, brush({ y: 2 }), true).message).toContain('undermine');
    expect(state).toEqual(before);
  });
  it('keeps cave respawns and dropped supplies on their foundation', () => {
    const { sim, state, p } = fixture();
    sculpt(state, brush());
    state.buildings.push(
      building({
        id: 'platform',
        kind: 'foundation',
        x: 20,
        y: 2.3,
        z: 88,
        rotation: 0,
        owner: p.id,
      }),
    );
    p.respawn = { x: 20, y: 2.3, z: 88 };
    p.health = 0;
    expect(sim.command(p.id, { type: 'respawn' }).ok).toBe(true);
    expect(p.position).toEqual(p.respawn);
    state.bags.push({
      id: 'supplies',
      owner: p.id,
      x: 20,
      y: 2.3,
      z: 88,
      inventory: { wood: 1 },
      expiresAt: state.time + 100,
    });
    for (let i = 0; i < 30; i++) sim.tick();
    expect(p.position.y).toBe(2.3);
    expect(state.bags[0].y).toBe(2.3);
  });
  it('removes unsupported resource nodes and permits regrowth only after restoring their ground', () => {
    const { sim, state, p } = fixture();
    const tree = world.resourceMap.get('starter-tree')!;
    const excavation = brush({ x: tree.x, y: tree.y - 0.5, z: tree.z, radius: 2 });
    expect(editTerrain(state, world, p, excavation, true).ok).toBe(true);
    expect(resourceSupported(state, world, tree)).toBe(false);
    expect(state.resources[tree.id].health).toBe(0);
    state.time = state.resources[tree.id].respawnAt + 1;
    for (let i = 0; i < 30; i++) sim.tick();
    expect(state.resources[tree.id].health).toBe(0);
    expect(
      editTerrain(state, world, p, { ...excavation, mode: 'restore', radius: 4 }, true).ok,
    ).toBe(true);
    for (let i = 0; i < 30; i++) sim.tick();
    expect(resourceSupported(state, world, tree)).toBe(true);
    expect(state.resources[tree.id]).toBeUndefined();
  });
  it('displaces resource roots near the corners of a large box brush', () => {
    const { state, p } = fixture();
    const tree = world.resourceMap.get('starter-tree')!;
    const excavation = brush({ x: tree.x - 11, y: tree.y - 10, z: tree.z - 11, radius: 12 });
    expect(editTerrain(state, world, p, excavation, true).ok).toBe(true);
    expect(resourceSupported(state, world, tree)).toBe(false);
    expect(state.resources[tree.id]?.health).toBe(0);
  });
  it('waits to respawn land wildlife when its home has been excavated below sea level', () => {
    const { sim, state } = fixture();
    const animal = animalAt(world, 'rabbit', 'rabbit', 20, 88);
    animal.health = 0;
    animal.respawnAt = 0;
    state.animals = [animal];
    sculpt(state, brush({ y: 3, radius: 6 }));
    sim.tick();
    expect(animal.health).toBe(0);
    sculpt(state, brush({ mode: 'restore', y: 3, radius: 7 }));
    sim.tick();
    expect(animal.health).toBeGreaterThan(0);
    expect(animal.y).toBe(terrainHeight(animal.x, animal.z, world.hash));
  });
  it('validates tools, aim, dirt costs, cooldowns, leveling height and occupancy atomically', () => {
    const { state, p } = fixture();
    p.position = { x: 20, y: 8, z: 88 };
    p.pitch = -0.4;
    expect(playerEarthwork(state, world, p, { mode: 'dig', level: 8 }).ok).toBe(false);
    p.inventory.pickaxe = 1;
    p.equipped = 'pickaxe';
    expect(terrainAim(state, world, p)).not.toBeNull();
    const before = structuredClone(state);
    expect(playerEarthwork(state, world, p, { mode: 'add', level: 8 }).message).toContain('dirt');
    expect(state).toEqual(before);
    expect(playerEarthwork(state, world, p, { mode: 'flatten', level: 100 }).ok).toBe(false);
    expect(playerEarthwork(state, world, p, { mode: 'dig', level: 8 }).ok).toBe(true);
    expect(p.inventory.dirt).toBeGreaterThan(0);
    const after = structuredClone(state);
    expect(playerEarthwork(state, world, p, { mode: 'dig', level: 8 }).ok).toBe(false);
    expect(state).toEqual(after);
    expect(
      editTerrain(state, world, p, brush({ x: 20, y: 9, z: 88, mode: 'add' }), true).message,
    ).toContain('survivor');
    expect(
      commandSchema.safeParse({
        type: 'terrain',
        request: { mode: 'dig', level: 8, x: 100, reward: 100 },
      }).success,
    ).toBe(false);
  });
  it('rejects fill that would lift a survivor into an overhead foundation', () => {
    const { state, p } = fixture();
    sculpt(state, brush());
    p.position = { x: 20, y: 2, z: 88 };
    state.buildings.push(
      building({
        id: 'overhead',
        kind: 'foundation',
        x: 20,
        y: 4,
        z: 88,
        rotation: 0,
        owner: p.id,
      }),
    );
    const before = structuredClone(state);
    const fill = brush({ mode: 'flatten', y: 2, level: 2.5, radius: 1.5 });
    expect(editTerrain(state, world, p, fill, true).message).toContain('survivor');
    expect(state).toEqual(before);
  });
  it('does not manufacture dirt by cycling excavation and filling', () => {
    const { state, p } = fixture();
    p.inventory = { dirt: 400 };
    for (let i = 0; i < 3; i++) {
      expect(editTerrain(state, world, p, brush({ y: 8, radius: 1.5 }), false).ok).toBe(true);
      expect(
        editTerrain(state, world, p, brush({ mode: 'flatten', y: 8, radius: 1.5, level: 8 }), false)
          .ok,
      ).toBe(true);
      expect(p.inventory.dirt).toBeLessThanOrEqual(400);
    }
  });
  it('uses a newly received look direction for excavation before the next simulation tick', () => {
    const { sim, p, state } = fixture();
    p.position = { x: 20, y: 8, z: 88 };
    p.inventory.pickaxe = 1;
    p.equipped = 'pickaxe';
    expect(sim.command(p.id, { type: 'terrain', request: { mode: 'dig', level: 8 } }).ok).toBe(
      false,
    );
    sim.command(p.id, { type: 'move', input: { ...idleInput(), pitch: -0.4 } });
    expect(sim.command(p.id, { type: 'terrain', request: { mode: 'dig', level: 8 } }).ok).toBe(
      true,
    );
    expect(state.terrain.revision).toBe(1);
  });
  it('levels cut and fill to a plane, smooths a mound and restores sparse storage', () => {
    const { state } = fixture();
    sculpt(state, brush({ mode: 'add', shape: 'sphere', y: 8, radius: 3 }));
    expect(terrainFloor(state.terrain, world, 20, 88)).toBe(11);
    expect(terrainSurfaces(state.terrain, world, 20, 88)).toEqual([{ y: 11, floor: true }]);
    sculpt(state, brush({ mode: 'smooth', shape: 'sphere', y: 10, radius: 3 }));
    expect(terrainFloor(state.terrain, world, 20, 88)).toBeLessThan(11);
    sculpt(state, brush({ mode: 'flatten', y: 9, level: 9, radius: 4 }));
    for (const dx of [-1, 0, 1]) expect(terrainFloor(state.terrain, world, 20 + dx, 88)).toBe(9);
    sculpt(state, brush({ mode: 'restore', y: 8, radius: 8 }));
    expect(state.terrain.samples).toEqual({});
    expect(terrainFloor(state.terrain, world, 20, 88)).toBe(8);
  });
  it('round-trips caves and fill; migrates v2 without moving the seeded world', () => {
    const { state } = fixture();
    sculpt(state, brush());
    const saved = parseSave(encodeSave(state, 'local'));
    expect(saved.state.terrain).toEqual(state.terrain);
    expect(terrainCeiling(saved.state.terrain, world, 20, 88, 4)).toBe(6);
    const v2 = JSON.parse(encodeSave(state, 'local'));
    v2.version = v2.state.version = 2;
    delete v2.state.terrain;
    delete v2.state.sites;
    for (const player of Object.values(v2.state.players) as Record<string, unknown>[]) {
      delete player.worn;
      delete player.quickSlots;
    }
    const migrated = parseSave(JSON.stringify(v2));
    expect(migrated.state.terrain).toEqual(emptyTerrain());
    expect(migrated.state.worldVersion).toBe(state.worldVersion);
    expect(migrated.state.players).toEqual(state.players);
    for (const samples of [
      { '0,-65,0': 1 },
      { '320,0,0': 1 },
      { '-0,2,0': 1 },
      { '0,2,0': Infinity },
      { '0,2,0': 0.00001 },
      { __proto__: 1 },
    ]) {
      if (Object.keys(samples).length)
        expect(terrainSchema.safeParse({ ...emptyTerrain(), samples }).success).toBe(false);
    }
  });
  it('replicates revision patches and deletions, omits unchanged terrain and rejects stale deltas', () => {
    const { state } = fixture();
    let remote = applyTerrainUpdate(emptyTerrain(), terrainUpdate(state.terrain)!);
    sculpt(state, brush());
    const patch = terrainUpdate(state.terrain, remote.revision)!;
    expect(patch.base).toBe(0);
    remote = applyTerrainUpdate(remote, patch);
    expect(remote).toEqual(state.terrain);
    expect(terrainUpdate(state.terrain, remote.revision)).toBeUndefined();
    expect(() => applyTerrainUpdate(remote, patch)).toThrow('revision');
    sculpt(state, brush({ mode: 'restore', radius: 5 }));
    const restore = terrainUpdate(state.terrain, remote.revision)!;
    expect(Object.values(restore.samples)).toContain(null);
    expect(applyTerrainUpdate(remote, restore)).toEqual(state.terrain);
  });
  it('serves a delta to a renderer behind a client that received several revisions at once', () => {
    const { state } = fixture();
    const renderer = applyTerrainUpdate(emptyTerrain(), terrainUpdate(state.terrain)!);
    sculpt(state, brush());
    sculpt(state, brush({ mode: 'add', x: 24, y: 9 }));
    // One snapshot carries revisions 1 and 2 into the client's session state.
    const session = applyTerrainUpdate(renderer, terrainUpdate(state.terrain, renderer.revision)!);
    const update = terrainUpdate(session, renderer.revision)!;
    expect(update.base).toBe(renderer.revision);
    expect(applyTerrainUpdate(renderer, update)).toEqual(state.terrain);
    sculpt(state, brush({ mode: 'dig', shape: 'sphere', x: 17, z: 93, radius: 3 }));
    const later = applyTerrainUpdate(session, terrainUpdate(state.terrain, session.revision)!);
    expect(terrainUpdate(later, renderer.revision)!.base).toBe(renderer.revision);
    expect(applyTerrainUpdate(renderer, terrainUpdate(later, renderer.revision)!)).toEqual(
      state.terrain,
    );
    // A revision inside a merged span has no exact patch chain, so it gets a baseline.
    expect(terrainUpdate(later, 1)!.base).toBe(-1);
  });
  it('extends the column index per edit to exactly what a full rebuild derives', () => {
    const { state } = fixture();
    const view = (terrain: TerrainState) => {
      const index = terrainIndex(terrain);
      return { columns: [...index.columns].sort(), chunks: [...index.chunks].sort() };
    };
    const rebuilt = (terrain: TerrainState) =>
      view({ ...terrain, samples: { ...terrain.samples } });
    let remote = applyTerrainUpdate(emptyTerrain(), terrainUpdate(state.terrain)!);
    for (const b of [
      brush(),
      brush({ mode: 'add', x: 24, y: 9 }),
      brush({ mode: 'dig', shape: 'sphere', x: 17, z: 93, radius: 3 }),
      brush({ mode: 'restore', radius: 5 }),
      brush({ mode: 'add', x: 21, y: 8, z: 85 }),
    ]) {
      view(state.terrain);
      const { patch } = planTerrainEdit(state.terrain, world, b);
      const preview = previewTerrain(state, patch);
      expect(view(preview)).toEqual(rebuilt(preview));
      commitTerrainEdit(state.terrain, patch);
      expect(view(state.terrain)).toEqual(rebuilt(state.terrain));
      view(remote);
      remote = applyTerrainUpdate(remote, terrainUpdate(state.terrain, remote.revision)!);
      expect(view(remote)).toEqual(rebuilt(remote));
    }
    expect(remote).toEqual(state.terrain);
  });
});
