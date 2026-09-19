import { BALANCE, ITEMS } from './content';
import type { Inventory, ItemId } from './content';
import { carryCapacity, transferInventory } from './inventory';
import { canRemoveItems, normalizeEquipment } from './equipment';
import { distance2 } from './math';
import { groundHeight, lineOfSight } from './physics';
import type { GameState, LootBag, PlayerState, Result } from './state';
import { terrainBodyClear } from './terrain';
import { WORLD_HALF } from './world';
import type { WorldDefinition } from './world';

/** World transfers use server-owned positions; the request contains only identity and quantity. */
export function canReachSupplies(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  target: { x: number; y: number; z: number },
  ignoreId?: string,
): boolean {
  return (
    player.health > 0 &&
    distance2(player.position, target) <= BALANCE.interactRange &&
    Math.abs(player.position.y - target.y) <= 3 &&
    lineOfSight(state, player, target.x, target.y + 0.3, target.z, world, ignoreId)
  );
}

export function dropItems(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  item: ItemId,
  count: number,
): Result {
  if (player.health <= 0) return { ok: false, message: 'Respawn to continue.' };
  const removal = canRemoveItems(player, { [item]: count });
  if (!removal.ok) return removal;
  if (state.bags.filter((bag) => bag.expiresAt > state.time).length >= BALANCE.maxBags)
    return { ok: false, message: 'Too many ground supplies. Collect a pack before dropping more.' };
  let location: { x: number; y: number; z: number } | undefined;
  for (const distance of [BALANCE.dropDistance, 0.5, 0]) {
    const x = player.position.x - Math.sin(player.yaw) * distance;
    const z = player.position.z - Math.cos(player.yaw) * distance;
    if (Math.abs(x) > WORLD_HALF - 1 || Math.abs(z) > WORLD_HALF - 1) continue;
    const y = groundHeight(state, world, x, z, player.position.y + 0.65);
    if (
      terrainBodyClear(state.terrain, world, x, y + 0.05, z, 0.2, 0.35) &&
      canReachSupplies(state, world, player, { x, y, z })
    ) {
      location = { x, y, z };
      break;
    }
  }
  if (!location) return { ok: false, message: 'Find a clear, reachable place for the supplies.' };
  const inventory: Inventory = {};
  const result = transferInventory(
    player.inventory,
    inventory,
    { [item]: count },
    { capacity: carryCapacity(player) },
  );
  if (!result.ok) return result;
  normalizeEquipment(player);
  state.bags = state.bags.filter((bag) => bag.expiresAt > state.time);
  state.bags.push({
    id: `bag${state.nextId++}`,
    owner: player.id,
    ...location,
    inventory,
    expiresAt: state.time + BALANCE.droppedItemLifetime,
  });
  return {
    ok: true,
    message: `Dropped ${count} ${ITEMS[item].name.toLowerCase()}. Anyone can collect it.`,
  };
}

/** Callers keep their source intact if the bounded ground-loot pool is full. */
export function createGroundLoot(
  state: GameState,
  at: { x: number; y: number; z: number },
  inventory: import('./content').Inventory,
  owner = '',
  lifetime = 600,
): LootBag | null {
  if (state.bags.filter((b) => b.expiresAt > state.time).length >= BALANCE.maxBags) return null;
  state.bags = state.bags.filter((b) => b.expiresAt > state.time);
  const bag = {
    id: `bag${state.nextId++}`,
    owner,
    x: at.x,
    y: at.y,
    z: at.z,
    inventory: { ...inventory },
    expiresAt: state.time + lifetime,
  };
  state.bags.push(bag);
  return bag;
}

export function collectBag(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  bag: LootBag,
  item?: ItemId,
  count?: number,
): Result {
  if (!state.bags.includes(bag) || bag.expiresAt <= state.time)
    return { ok: false, message: 'Those supplies are no longer available.' };
  if (!canReachSupplies(state, world, player, bag))
    return { ok: false, message: 'Move closer with a clear view of the supplies.' };
  const requested = item ? { [item]: count ?? bag.inventory[item] ?? 0 } : { ...bag.inventory };
  const result = transferInventory(bag.inventory, player.inventory, requested, {
    capacity: carryCapacity(player),
    partial: true,
  });
  if (!result.ok) return result;
  const remaining = Object.keys(bag.inventory).length > 0;
  const limitedByCapacity = Object.entries(requested).some(
    ([id, amount]) => (result.moved[id as ItemId] ?? 0) < amount!,
  );
  if (!remaining) state.bags.splice(state.bags.indexOf(bag), 1);
  return {
    ok: true,
    message: remaining
      ? limitedByCapacity
        ? 'Collected what fits. More supplies remain.'
        : 'Supplies collected. More remain here.'
      : 'Supplies collected.',
  };
}
