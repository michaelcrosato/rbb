import {
  BALANCE,
  BUILDINGS,
  GRADE_IDS,
  ITEMS,
  ITEM_IDS,
  STRUCTURE_GRADES,
} from '../../shared/content';
import type { Inventory } from '../../shared/content';
import { canAfford, carryCapacity, inventoryWeight } from '../../shared/inventory';
import type { Building, GameState, PlayerState } from '../../shared/state';
import { isStructural } from '../../shared/structure-geometry';
import { costMarkup } from './pack';
import { icon } from './icons';

function storageRows(inventory: Inventory, direction: 'take' | 'deposit'): string {
  return `<div class="supplies-list">${
    ITEM_IDS.filter((id) => inventory[id])
      .map(
        (id) =>
          `<article class="supply-row"><div class="supply-item">${icon(ITEMS[id].icon)}<div><strong>${ITEMS[id].name}</strong><small>${inventory[id]} available</small></div></div><label class="sr-only" for="store-${direction}-${id}">${direction === 'take' ? 'Take' : 'Store'} ${ITEMS[id].name} quantity</label><input id="store-${direction}-${id}" data-preserve type="number" min="1" max="${inventory[id]}" value="${inventory[id]}" inputmode="numeric"><button class="button small-button" data-action="storage-${direction}" data-value="${id}" aria-label="${direction === 'take' ? 'Take' : 'Store'} ${ITEMS[id].name}">${direction === 'take' ? 'Take' : 'Store'}</button></article>`,
      )
      .join('') || '<p class="muted">Empty</p>'
  }</div>`;
}
export function structureMarkup(
  player: PlayerState,
  building: Building | undefined,
  state: GameState,
): string {
  if (!building)
    return '<h2 id="panel-title">Structure removed.</h2><button class="button primary" data-action="resume">Continue exploring</button>';
  const grade = STRUCTURE_GRADES[building.grade];
  const next = GRADE_IDS[GRADE_IDS.indexOf(building.grade) + 1];
  return `<h2 id="panel-title">${BUILDINGS[building.kind].name}</h2><p class="panel-description">${BUILDINGS[building.kind].description}</p>
  <div class="section-label">${grade.name} <span>${Math.ceil(building.health)} / ${grade.health} HP</span></div><progress class="structure-health" max="${grade.health}" value="${building.health}" aria-label="Structure health"></progress><p class="muted small">${Math.round(grade.resistance * 100)}% damage resistance. Aggressive wildlife can break camp pieces. Attached pieces collapse if their support is destroyed.</p>
  <div class="structure-actions">${building.kind === 'door' ? `<button class="button primary" data-action="structure-door">${building.open ? 'Close door' : 'Open door'}</button>` : ''}
  ${isStructural(building.kind) && next ? `<article><h3>Upgrade to ${STRUCTURE_GRADES[next].name.toLowerCase()}</h3><p class="muted small">${STRUCTURE_GRADES[next].health} HP · ${Math.round(STRUCTURE_GRADES[next].resistance * 100)}% resistance. Existing damage carries over proportionally.</p><div class="costs">${costMarkup(STRUCTURE_GRADES[next].cost, player.inventory)}</div><button class="button secondary" data-action="structure-upgrade" ${canAfford(player.inventory, STRUCTURE_GRADES[next].cost) ? '' : 'disabled'}>Upgrade structure</button></article>` : ''}
  <article><h3>Repair +${Math.round(BALANCE.repairFraction * 100)}%</h3><div class="costs">${costMarkup(grade.repair, player.inventory)}</div><button class="button secondary" data-action="structure-repair" ${building.health < grade.health && canAfford(player.inventory, grade.repair) ? '' : 'disabled'}>Repair structure</button></article></div>
  ${building.kind === 'storage' ? `<div class="storage-columns"><section><h3>Shared chest</h3><p class="muted small">${inventoryWeight(building.inventory).toFixed(1)} / ${BALANCE.storageCapacity} kg · anyone nearby can use this chest</p>${storageRows(building.inventory, 'take')}</section><section><h3>Your pack</h3><p class="muted small">${inventoryWeight(player.inventory).toFixed(1)} / ${carryCapacity(player)} kg</p>${storageRows(player.inventory, 'deposit')}</section></div>` : ''}
  ${['campfire', 'furnace', 'workbench'].includes(building.kind) ? '<button class="button primary" data-action="inventory">Open crafting</button>' : ''}
  ${building.owner === player.id ? `<details class="dismantle-options"><summary>Dismantle piece</summary><p class="muted small">No material refund. Empty storage and remove attached pieces first.</p><button class="button secondary" data-action="structure-dismantle" ${Object.keys(building.inventory).length || state.buildings.some((b) => b.support === building.id) ? 'disabled' : ''}>Dismantle this piece</button></details>` : ''}
  <button class="text-button" data-action="resume">Continue exploring</button>`;
}
