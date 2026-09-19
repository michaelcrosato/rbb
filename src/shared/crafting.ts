import { BALANCE, BUILDINGS, RECIPES, TOOLS, WEAPONS } from './content';
import type { Inventory, RecipeDefinition, RecipeId, ItemId } from './content';
import { carryCapacity, transact } from './inventory';
import { distance2 } from './math';
import { lineOfSight } from './physics';
import type { GameState, PlayerState, Result } from './state';
import type { WorldDefinition } from './world';

export function recipeCosts(
  recipe: RecipeDefinition,
  count: number,
): { cost: Inventory; output: Inventory } {
  const scale = (inventory: Inventory): Inventory =>
    Object.fromEntries(Object.entries(inventory).map(([id, n]) => [id, n * count]));
  return { cost: scale(recipe.cost), output: scale(recipe.output) };
}
export function stationAvailable(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  kind: RecipeDefinition['station'],
): boolean {
  return (
    !kind ||
    state.buildings.some(
      (b) =>
        b.kind === kind &&
        b.health > 0 &&
        distance2(player.position, b) <= 5 &&
        Math.abs(player.position.y - b.y) < 3 &&
        lineOfSight(state, player, b.x, b.y + 0.7, b.z, world, b.id),
    )
  );
}
export function craftItems(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  id: RecipeId,
  count = 1,
): Result {
  const recipe: RecipeDefinition = RECIPES[id];
  if (!recipe || !Number.isInteger(count) || count < 1 || count > BALANCE.craftBatchLimit)
    return { ok: false, message: 'Choose a valid recipe and batch.' };
  if (!stationAvailable(state, world, player, recipe.station))
    return {
      ok: false,
      message: `You need a ${BUILDINGS[recipe.station!].name.toLowerCase()} within 5 metres and a clear view.`,
    };
  const batch = recipeCosts(recipe, count);
  const result = transact(player.inventory, batch.cost, batch.output, carryCapacity(player));
  if (!result.ok) return result;
  const item = Object.keys(recipe.output)[0] as ItemId;
  if (TOOLS[item] || WEAPONS[item]) {
    player.milestones.craft++;
    player.equipped = item;
  }
  return {
    ok: true,
    message: `Crafted ${recipe.name.toLowerCase()}${count > 1 ? ` (${count} batches)` : ''}.`,
  };
}
