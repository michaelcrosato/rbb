import { ITEMS, ITEM_IDS, MAX_WEIGHT } from './content';
import type { Inventory } from './content';
import type { Result } from './state';

export const inventoryWeight = (inventory: Inventory): number =>
  ITEM_IDS.reduce((sum, id) => sum + (inventory[id] ?? 0) * ITEMS[id].weight, 0);
export const canAfford = (inventory: Inventory, cost: Inventory): boolean =>
  ITEM_IDS.every((id) => (inventory[id] ?? 0) >= (cost[id] ?? 0));

/** Atomic, bounded inventory transaction. Never consume ingredients if the output cannot fit. */
export function transact(inventory: Inventory, cost: Inventory, gain: Inventory): Result {
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
  if (inventoryWeight(next) > MAX_WEIGHT + 0.0001)
    return { ok: false, message: 'Your pack is full. Use some materials first.' };
  for (const id of ITEM_IDS) delete inventory[id];
  Object.assign(inventory, next);
  return { ok: true, message: '' };
}
