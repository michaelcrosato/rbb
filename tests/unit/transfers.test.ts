import { describe, expect, it } from 'vitest';
import { transferInventory } from '../../src/shared/inventory';
import type { Inventory } from '../../src/shared/content';
import { createPlayer, createState } from '../../src/shared/state';
import { collectBag, dropItems } from '../../src/shared/transfers';
import { generateWorld } from '../../src/shared/world';

const world = generateWorld('quiet-frontier');

describe('conserved inventory transfers', () => {
  it('moves a selected quantity atomically and removes empty stacks', () => {
    const source: Inventory = { wood: 10, fiber: 5 };
    const destination: Inventory = { wood: 2 };
    expect(transferInventory(source, destination, { wood: 4, fiber: 5 }).ok).toBe(true);
    expect(source).toEqual({ wood: 6 });
    expect(destination).toEqual({ wood: 6, fiber: 5 });
  });

  it('rejects unavailable, malformed, self and overweight transfers without either-side mutation', () => {
    for (const requested of [
      { wood: 11 },
      { wood: -1 },
      { wood: 0 },
      { wood: 1.5 },
      { wood: NaN },
    ]) {
      const source = { wood: 10 };
      const destination = { stone: 500 };
      expect(transferInventory(source, destination, requested).ok).toBe(false);
      expect(source).toEqual({ wood: 10 });
      expect(destination).toEqual({ stone: 500 });
    }
    const same = { wood: 3 };
    expect(transferInventory(same, same, { wood: 1 }).ok).toBe(false);
    const source = { wood: 10 };
    const destination = { stone: 500 };
    expect(transferInventory(source, destination, { wood: 1 }).ok).toBe(false);
    expect(source).toEqual({ wood: 10 });
    expect(destination).toEqual({ stone: 500 });
  });

  it('takes only what fits while leaving every uncollected item in the source', () => {
    const source = { wood: 30, fiber: 20 };
    const destination: Inventory = { wood: 590 };
    const result = transferInventory(source, destination, source, { partial: true });
    expect(result.ok).toBe(true);
    expect(destination).toEqual({ wood: 600 });
    expect(source).toEqual({ wood: 20, fiber: 20 });
    expect(transferInventory(source, destination, { wood: 1 }, { partial: true }).ok).toBe(false);
  });
});

describe('ground supplies', () => {
  it('lets another survivor collect a split stack exactly once', () => {
    const state = createState(world);
    const a = createPlayer('a', 'A', world);
    const b = createPlayer('b', 'B', world);
    state.players = { a, b };
    a.inventory = { wood: 20 };
    b.inventory = {};
    expect(dropItems(state, world, a, 'wood', 7).ok).toBe(true);
    expect(a.inventory).toEqual({ wood: 13 });
    const bag = state.bags[0];
    expect(bag.inventory).toEqual({ wood: 7 });
    expect(collectBag(state, world, b, bag, 'wood', 3).ok).toBe(true);
    expect(b.inventory).toEqual({ wood: 3 });
    expect(bag.inventory).toEqual({ wood: 4 });
    expect(collectBag(state, world, a, bag).ok).toBe(true);
    expect(a.inventory).toEqual({ wood: 17 });
    expect(state.bags).toEqual([]);
    expect(collectBag(state, world, b, bag).ok).toBe(false);
    expect(b.inventory).toEqual({ wood: 3 });
  });

  it('rejects distant or expired collection and invalid drops without spending items', () => {
    const state = createState(world);
    const player = createPlayer('p', 'Player', world);
    state.players.p = player;
    player.inventory = { stone: 10 };
    expect(dropItems(state, world, player, 'stone', 11).ok).toBe(false);
    expect(state.bags).toEqual([]);
    expect(player.inventory).toEqual({ stone: 10 });
    expect(dropItems(state, world, player, 'stone', 4).ok).toBe(true);
    const bag = state.bags[0];
    player.position.x += 20;
    expect(collectBag(state, world, player, bag).ok).toBe(false);
    player.position.x -= 20;
    state.time = bag.expiresAt;
    expect(collectBag(state, world, player, bag).ok).toBe(false);
    expect(player.inventory).toEqual({ stone: 6 });
    expect(bag.inventory).toEqual({ stone: 4 });
  });
});
