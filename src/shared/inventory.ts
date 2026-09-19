import { ITEMS, ITEM_IDS, MAX_WEIGHT, EQUIPMENT } from './content';
import type { Inventory, ItemId } from './content';
import type { Result, PlayerState } from './state';

export const inventoryWeight = (inventory: Inventory): number =>
  ITEM_IDS.reduce((sum, id) => sum + (inventory[id] ?? 0) * ITEMS[id].weight, 0);
export const canAfford = (inventory: Inventory, cost: Inventory): boolean =>
  ITEM_IDS.every((id) => (inventory[id] ?? 0) >= (cost[id] ?? 0));
export function carryCapacity(player: Pick<PlayerState, 'worn' | 'inventory'>): number {
  const pack = player.worn.backpack;
  return MAX_WEIGHT + (pack && player.inventory[pack] ? (EQUIPMENT[pack]?.capacity ?? 0) : 0);
}

/** Atomic, bounded inventory transaction. Never consume ingredients if the output cannot fit. */
export function transact(
  inventory: Inventory,
  cost: Inventory,
  gain: Inventory,
  capacity = MAX_WEIGHT,
): Result {
  if (
    [cost, gain].some((change) =>
      Object.entries(change).some(
        ([id, count]) =>
          !ITEM_IDS.includes(id as keyof Inventory) || !Number.isSafeInteger(count) || count < 0,
      ),
    )
  )
    return { ok: false, message: 'Invalid inventory transaction.' };
  if (!canAfford(inventory, cost)) return { ok: false, message: 'You need more materials.' };
  const next = { ...inventory };
  for (const id of ITEM_IDS) {
    const count = (next[id] ?? 0) - (cost[id] ?? 0) + (gain[id] ?? 0);
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000)
      return { ok: false, message: 'Invalid inventory transaction.' };
    if (count === 0) delete next[id];
    else next[id] = count;
  }
  if (inventoryWeight(next) > capacity + 0.0001)
    return { ok: false, message: 'Your pack is full. Use some materials first.' };
  for (const id of ITEM_IDS) delete inventory[id];
  Object.assign(inventory, next);
  return { ok: true, message: '' };
}

export interface TransferResult extends Result {
  moved: Inventory;
}

/** Plan both sides before committing. A failed transfer cannot consume or duplicate items.
 * Partial transfers use stable registry order, so solo and the server choose the same stacks. */
export function transferInventory(
  source: Inventory,
  destination: Inventory,
  requested: Inventory,
  options: { capacity?: number; partial?: boolean } = {},
): TransferResult {
  const fail = (message: string): TransferResult => ({ ok: false, message, moved: {} });
  if (source === destination) return fail('Choose a different destination.');
  const entries = Object.entries(requested) as [ItemId, number][];
  if (
    !entries.length ||
    entries.some(
      ([item, count]) =>
        !ITEM_IDS.includes(item) || !Number.isSafeInteger(count) || count < 1 || count > 10000,
    )
  )
    return fail('Choose a valid item quantity.');
  if (!canAfford(source, requested)) return fail('Those items are no longer available.');
  const capacity = options.capacity ?? MAX_WEIGHT;
  const moved: Inventory = {};
  let room = capacity - inventoryWeight(destination);
  for (const item of ITEM_IDS) {
    const requestedCount = requested[item] ?? 0;
    if (!requestedCount) continue;
    const availableRoom = Math.max(0, Math.floor((room + 0.00001) / ITEMS[item].weight));
    const count = Math.min(requestedCount, availableRoom, 10000 - (destination[item] ?? 0));
    if (!options.partial && count < requestedCount) return fail('There is not enough room.');
    if (count > 0) {
      moved[item] = count;
      room -= count * ITEMS[item].weight;
    }
  }
  if (!Object.keys(moved).length) return fail('There is not enough room.');
  const nextSource = { ...source };
  const nextDestination = { ...destination };
  const removed = transact(nextSource, moved, {}, Math.max(MAX_WEIGHT, inventoryWeight(source)));
  if (!removed.ok) return fail(removed.message);
  const added = transact(nextDestination, {}, moved, capacity);
  if (!added.ok) return fail(added.message);
  for (const item of ITEM_IDS) {
    delete source[item];
    delete destination[item];
  }
  Object.assign(source, nextSource);
  Object.assign(destination, nextDestination);
  return { ok: true, message: '', moved };
}
