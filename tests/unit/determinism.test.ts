import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/shared/content';
import { random } from '../../src/shared/math';
import { parseState } from '../../src/shared/save';
import { Simulation } from '../../src/shared/simulation';
import { createState, idleInput } from '../../src/shared/state';
import type { GameState } from '../../src/shared/state';
import { generateWorld, nearbyResources } from '../../src/shared/world';

const world = generateWorld('determinism');
const fresh = () => {
  const sim = new Simulation(world, createState(world));
  sim.addPlayer('one', 'One');
  sim.addPlayer('two', 'Two');
  return sim;
};
/** JSON is the persistence and wire format, so compare what actually leaves the process. */
const serialized = (state: GameState): GameState => JSON.parse(JSON.stringify(state));

/** A scripted two-survivor session: movement, gathering, crafting, building, eating, combat and death. */
function play(sim: Simulation, ticks: number, seed: number): void {
  const rng = random(seed);
  const recipes = ['hatchet', 'pickaxe', 'bandage', 'cookedMeat'] as const;
  const pieces = ['foundation', 'campfire', 'bedroll', 'wall'] as const;
  for (let i = 0; i < ticks; i++) {
    for (const id of Object.keys(sim.state.players)) {
      const p = sim.state.players[id];
      if (p.health <= 0) {
        sim.command(id, { type: 'respawn' });
        continue;
      }
      if (i % 10 === 0)
        sim.command(id, {
          type: 'move',
          input: {
            forward: rng() > 0.3 ? 1 : 0,
            strafe: rng() * 2 - 1,
            yaw: rng() * Math.PI * 2 - Math.PI,
            pitch: 0,
            sprint: rng() > 0.6,
            jump: rng() > 0.9,
            dive: false,
          },
        });
      if (i % 20 === 5) {
        const { x, z } = p.position;
        const target =
          nearbyResources(world, x, z, BALANCE.interactRange)[0] ??
          sim.state.animals.find((a) => Math.hypot(a.x - x, a.z - z) < BALANCE.interactRange) ??
          sim.state.bags[0];
        if (target) {
          p.yaw = Math.atan2(x - target.x, z - target.z);
          sim.command(id, { type: 'interact', target: target.id });
        }
      }
      if (i % 150 === 7)
        sim.command(id, { type: 'craft', recipe: recipes[Math.floor(rng() * recipes.length)] });
      if (i % 200 === 9)
        sim.command(id, {
          type: 'build',
          kind: pieces[Math.floor(rng() * pieces.length)],
          x: p.position.x + 4,
          z: p.position.z,
          rotation: Math.floor(rng() * 4),
        });
      if (i % 90 === 11) sim.command(id, { type: 'consume', item: 'berries' });
    }
    sim.tick();
  }
}

describe('shared simulation determinism', () => {
  it('replays an identical command sequence to byte-identical state on two instances', () => {
    const a = fresh(),
      b = fresh();
    play(a, 1800, 11);
    play(b, 1800, 11);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    const survivors = Object.values(a.state.players);
    expect(survivors.some((p) => p.milestones.gather > 0)).toBe(true);
    expect(a.state.tick).toBe(1800);
  });
  it('continues exactly the same after a validated snapshot reload', () => {
    const live = fresh();
    play(live, 600, 3);
    // A server restart or solo reload parses the snapshot and clears held input.
    const resumed = new Simulation(world, parseState(serialized(live.state)));
    for (const p of Object.values(live.state.players)) p.input = idleInput();
    play(live, 600, 4);
    play(resumed, 600, 4);
    expect(serialized(resumed.state)).toStrictEqual(serialized(live.state));
  });
});
