import { EQUIPMENT, ITEMS } from './content';
import type { Inventory, ItemId } from './content';
import { carryCapacity, inventoryWeight, transact } from './inventory';
import type { PlayerState, Result } from './state';

export function normalizeEquipment(player: PlayerState): void {
  for (const slot of ['armor', 'backpack'] as const) {
    const item = player.worn[slot];
    if (item && !player.inventory[item]) player.worn[slot] = null;
  }
  if (!player.inventory[player.equipped]) player.equipped = 'rock';
}
/** Preview removals so a dropped/deposited pack cannot strand an overweight inventory. */
export function canRemoveItems(player: PlayerState, cost: Inventory): Result {
  const preview = { ...player, inventory: { ...player.inventory }, worn: { ...player.worn } };
  const result = transact(
    preview.inventory,
    cost,
    {},
    Math.max(carryCapacity(player), inventoryWeight(player.inventory)),
  );
  if (!result.ok) return result;
  normalizeEquipment(preview);
  return inventoryWeight(preview.inventory) <= carryCapacity(preview) + 0.0001
    ? { ok: true, message: '' }
    : { ok: false, message: 'Lighten your pack before removing the trail pack.' };
}
export function wearEquipment(player: PlayerState, item: ItemId): Result {
  const definition = EQUIPMENT[item];
  if (!definition || !player.inventory[item])
    return { ok: false, message: 'Choose equipment from your pack.' };
  const next = {
    ...player,
    worn: {
      ...player.worn,
      [definition.slot]: player.worn[definition.slot] === item ? null : item,
    },
  };
  if (inventoryWeight(player.inventory) > carryCapacity(next) + 0.0001)
    return { ok: false, message: 'Lighten your pack before removing the trail pack.' };
  player.worn = next.worn;
  return {
    ok: true,
    message: `${next.worn[definition.slot] ? 'Wearing' : 'Removed'} ${ITEMS[item].name.toLowerCase()}.`,
  };
}
export function armorResistance(player: PlayerState): number {
  const item = player.worn.armor;
  return item && player.inventory[item] ? (EQUIPMENT[item]?.resistance ?? 0) : 0;
}
