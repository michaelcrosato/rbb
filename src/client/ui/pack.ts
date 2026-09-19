import {
  BALANCE,
  BUILDINGS,
  EQUIPMENT,
  ITEMS,
  ITEM_IDS,
  RECIPES,
  RECIPE_IDS,
  isConsumable,
} from '../../shared/content';
import type { Inventory, ItemId, RecipeDefinition } from '../../shared/content';
import { canAfford, carryCapacity, inventoryWeight } from '../../shared/inventory';
import { stationAvailable } from '../../shared/crafting';
import type { GameState, PlayerState } from '../../shared/state';
import type { WorldDefinition } from '../../shared/world';
import { icon } from './icons';

export function costMarkup(cost: Inventory, inventory: Inventory): string {
  return Object.entries(cost)
    .map(
      ([id, count]) =>
        `<span class="cost ${(inventory[id as ItemId] ?? 0) >= count ? 'enough' : ''}">${icon(ITEMS[id as ItemId].icon)}${count} ${ITEMS[id as ItemId].name}</span>`,
    )
    .join('');
}
export const CRAFT_CATEGORIES = [
  'All',
  'Materials',
  'Tools',
  'Weapons',
  'Equipment',
  'Provisions',
] as const;
export function packMarkup(
  player: PlayerState,
  state: GameState,
  world: WorldDefinition,
  category = 'All',
): string {
  const recipes = RECIPE_IDS.filter(
    (id) =>
      category === 'All' ||
      ((RECIPES[id] as RecipeDefinition).category ??
        (id === 'hatchet' || id === 'pickaxe' ? 'Tools' : 'Provisions')) === category,
  );
  return `<h2 id="panel-title">A life, in your pack.</h2><p class="panel-description">Salvage landmarks, work rich quarry veins, and bring supplies home. Build a furnace and workbench for advanced recipes.</p>
  <div class="equipment-summary"><span>Vest: ${player.worn.armor ? ITEMS[player.worn.armor].name : 'None'}</span><span>Pack: ${player.worn.backpack ? ITEMS[player.worn.backpack].name : 'Standard'}</span></div>
  <div class="pack-layout"><div><div class="section-label">YOUR SUPPLIES <span>${inventoryWeight(player.inventory).toFixed(1)} / ${carryCapacity(player)} kg</span></div>
  <div class="inventory-grid">${ITEM_IDS.filter((id) => player.inventory[id])
    .map(
      (id) =>
        `<div class="inventory-stack"><button class="inventory-item" data-action="${EQUIPMENT[id] ? 'wear' : 'item'}" data-value="${id}" title="${ITEMS[id].description}"><span style="color:${ITEMS[id].color}">${icon(ITEMS[id].icon)}</span><strong>${ITEMS[id].name}</strong><b>×${player.inventory[id]}</b><small>${EQUIPMENT[id] ? (Object.values(player.worn).includes(id) ? 'Wearing · remove' : 'Wear equipment') : isConsumable(id) ? 'Click to use' : 'Click to equip'}</small></button><button class="manage-stack" data-action="item-details" data-value="${id}" aria-label="Manage ${ITEMS[id].name}">Details / drop</button></div>`,
    )
    .join(
      '',
    )}</div><p class="muted small">Details let you drop a chosen quantity or assign any item to a quick slot.</p></div>
  <div><div class="section-label">CRAFTING <span>${RECIPE_IDS.length} RECIPES</span></div><div class="craft-filters" aria-label="Recipe categories">${CRAFT_CATEGORIES.map((c) => `<button class="text-button ${category === c ? 'selected' : ''}" data-action="craft-filter" data-value="${c}" aria-pressed="${category === c}">${c}</button>`).join('')}</div>
  <div class="recipe-list">${recipes
    .map((id) => {
      const recipe: RecipeDefinition = RECIPES[id];
      const output = Object.keys(recipe.output)[0] as ItemId;
      const station = stationAvailable(state, world, player, recipe.station);
      return `<article class="recipe"><div class="recipe-icon">${icon(ITEMS[output].icon)}</div><div class="recipe-details"><h3>${recipe.name}</h3><p>${recipe.description}</p>${recipe.station ? `<small class="station-status ${station ? 'enough' : ''}">${station ? 'Ready at' : 'Needs'} ${BUILDINGS[recipe.station].name.toLowerCase()} · within 5 m</small>` : ''}<div class="costs">${costMarkup(recipe.cost, player.inventory)}</div><small class="muted">Cost per batch</small></div><div class="recipe-actions"><label for="craft-count-${id}">Batches</label><input id="craft-count-${id}" data-preserve type="number" min="1" max="${BALANCE.craftBatchLimit}" value="1" step="1" inputmode="numeric"><button class="button small-button" data-action="craft" data-value="${id}" ${canAfford(player.inventory, recipe.cost) && station ? '' : 'disabled'}>Craft</button></div></article>`;
    })
    .join('')}</div></div></div>`;
}
