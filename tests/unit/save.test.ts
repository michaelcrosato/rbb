import { describe, expect, it } from 'vitest';
import { SaveStore } from '../../src/client/persistence';
import { encodeSave, parseSave } from '../../src/shared/save';
import { Simulation } from '../../src/shared/simulation';
import { createState } from '../../src/shared/state';
import { generateWorld } from '../../src/shared/world';

const world = generateWorld('save-test');
const fixture = () => {
  const sim = new Simulation(world, createState(world));
  sim.addPlayer('local', 'Tester');
  return sim.state;
};
const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
};

describe('versioned saves and recovery', () => {
  it('round trips inventory, terrain seed, mutations, and milestones; clears held input', () => {
    const state = fixture();
    state.players.local.inventory.wood = 12;
    state.players.local.input.forward = 1;
    state.players.local.milestones.gather = 12;
    state.resources['starter-tree'] = { health: 4, respawnAt: 0 };
    const parsed = parseSave(encodeSave(state, 'local'));
    expect(parsed.state.seed).toBe('save-test');
    expect(parsed.state.resources).toEqual(state.resources);
    expect(parsed.state.players.local.inventory.wood).toBe(12);
    expect(parsed.state.players.local.input.forward).toBe(0);
  });
  it('rejects invalid versions, counts, unknown content, missing players, huge files and invalid JSON', () => {
    for (const mutate of [
      (s: ReturnType<typeof fixture>) => {
        s.version = 99 as 4;
      },
      (s: ReturnType<typeof fixture>) => {
        s.players.local.inventory.wood = -1;
      },
      (s: ReturnType<typeof fixture>) => {
        s.worldVersion = 999;
      },
      (s: ReturnType<typeof fixture>) => {
        delete s.players.local;
      },
      (s: ReturnType<typeof fixture>) => {
        s.players.local.position.x = Infinity;
      },
    ]) {
      const state = fixture();
      mutate(state);
      expect(() => parseSave(encodeSave(state, 'local'))).toThrow();
    }
    expect(() => parseSave('x'.repeat(16_000_001))).toThrow();
    expect(() => parseSave('{bad')).toThrow();
    const raw = encodeSave(fixture(), 'local').replace('"rock":1', '"adminWeapon":1');
    expect(() => parseSave(raw)).toThrow();
  });
  it('recovers the last healthy backup without destroying it', () => {
    const storage = memory(),
      store = new SaveStore(storage),
      state = fixture();
    store.save(state, 'local');
    state.players.local.inventory.wood = 12;
    store.save(state, 'local');
    storage.data.set('rbb.save.v1', '{corrupt');
    expect(store.load().warning).toContain('recovered');
    expect(store.load().save?.state.players.local.inventory.wood).toBeUndefined();
    store.save(state, 'local');
    expect(
      parseSave(storage.data.get('rbb.save.backup.v1')!).state.players.local.inventory.wood,
    ).toBeUndefined();
  });
  it('leaves a valid save untouched after a failed import and reports storage failure', () => {
    const storage = memory(),
      store = new SaveStore(storage);
    store.save(fixture(), 'local');
    const before = storage.data.get('rbb.save.v1');
    expect(() => store.import('{"format":"not-rbb"}')).toThrow();
    expect(storage.data.get('rbb.save.v1')).toBe(before);
    const broken = new SaveStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(broken.load().warning).toContain('unavailable');
    expect(() => broken.save(fixture(), 'local')).toThrow();
  });
});
