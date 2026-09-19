import { BALANCE, EQUIPMENT, isConsumable, ITEMS, ITEM_IDS } from '../../shared/content';
import type { ItemId } from '../../shared/content';
import { carryCapacity, inventoryWeight } from '../../shared/inventory';
import type { LootBag, PlayerState } from '../../shared/state';
import { icon } from './icons';

export function itemDetailsMarkup(player: PlayerState, item: ItemId | null): string {
  if (!item || !player.inventory[item])
    return '<h2 id="panel-title">Item moved.</h2><p class="panel-description">This stack is no longer in your pack.</p><button class="button primary" data-action="inventory">Back to pack</button>';
  const definition = ITEMS[item];
  const count = player.inventory[item]!;
  return `<h2 id="panel-title">${definition.name}</h2>
    <p class="panel-description">${definition.description}</p>
    <div class="supply-summary">${icon(definition.icon)}<span>${count} in your pack · ${(count * definition.weight).toFixed(2)} kg</span></div>
    <div class="pause-buttons"><button class="button secondary" data-action="${EQUIPMENT[item] ? 'wear' : 'item'}" data-value="${item}">${EQUIPMENT[item] ? (Object.values(player.worn).includes(item) ? 'Remove equipment' : 'Wear equipment') : isConsumable(item) ? 'Use one' : 'Equip item'}</button></div>
    <label for="quick-slot">Quick slot</label><div class="quick-slot-form"><select id="quick-slot">${player.quickSlots.map((id, index) => `<option value="${index}">${index + 1} · ${ITEMS[id].name}</option>`).join('')}</select><button class="button secondary" data-action="assign-slot" data-value="${item}">Assign slot</button></div>
    <section class="transfer-form"><h3>Share supplies</h3>
    <p class="muted small">Drop a stack on nearby ground. Anyone can pick it up. Dropped supplies expire after ${BALANCE.droppedItemLifetime / 60} world minutes.</p>
    <label for="drop-quantity">Quantity to drop</label>
    <input id="drop-quantity" data-preserve type="number" min="1" max="${count}" step="1" value="1" inputmode="numeric">
    <div class="quantity-presets"><button class="text-button" data-action="drop-amount" data-value="1">One</button><button class="text-button" data-action="drop-amount" data-value="${Math.max(1, Math.floor(count / 2))}">Half</button><button class="text-button" data-action="drop-amount" data-value="${count}">All</button></div>
    <button class="button primary" data-action="drop-item" data-value="${item}">Drop supplies ${icon('arrow')}</button></section>
    <button class="text-button" data-action="inventory">← Back to pack</button>`;
}

export function suppliesMarkup(
  player: PlayerState,
  bag: Pick<LootBag, 'inventory'> | undefined,
  title = 'Ground supplies',
  description = 'Take what you need. Uncollected items remain here for your crew.',
): string {
  if (!bag)
    return '<h2 id="panel-title">Supplies moved.</h2><p class="panel-description">This pack was collected or expired.</p><button class="button primary" data-action="resume">Continue exploring</button>';
  const contents = ITEM_IDS.filter((item) => bag.inventory[item]);
  return `<h2 id="panel-title">${title}</h2>
    <p class="panel-description">${description}</p>
    <div class="section-label">YOUR PACK <span>${inventoryWeight(player.inventory).toFixed(1)} / ${carryCapacity(player)} kg</span></div>
    ${contents.length ? `<div class="supplies-list">${contents.map((item) => `<article class="supply-row"><div class="supply-item">${icon(ITEMS[item].icon)}<div><strong>${ITEMS[item].name}</strong><small>${bag.inventory[item]} available</small></div></div><label class="sr-only" for="collect-quantity-${item}">${ITEMS[item].name} quantity</label><input id="collect-quantity-${item}" data-preserve type="number" min="1" max="${bag.inventory[item]}" step="1" value="${bag.inventory[item]}" inputmode="numeric"><button class="button small-button" data-action="collect-item" data-value="${item}" aria-label="Take ${ITEMS[item].name}">Take</button></article>`).join('')}</div><button class="button primary" data-action="collect-all">Take all that fits ${icon('bag')}</button>` : '<p class="muted">These supplies are empty or out of reach. Move closer to inspect them.</p>'}
    <button class="text-button" data-action="resume">Continue exploring</button>`;
}
