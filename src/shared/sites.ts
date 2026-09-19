import { SITE_TYPES } from './content';
import type { ItemId } from './content';
import { carryCapacity, transferInventory } from './inventory';
import type { GameState, PlayerState, Result } from './state';
import { siteLoot, isQuarry, siteSolids } from './site-generation';
import { canReachSupplies } from './transfers';
import type { WorldDefinition } from './world';
import { bodyIntersects } from './spatial';
import { terrainFloor } from './terrain';
import { terrainHeight } from './world';

export function collectSite(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  id: string,
  item?: ItemId,
  count?: number,
): Result {
  const site = world.sites.find((s) => s.id === id),
    contents = state.sites[id];
  if (!site || !contents || contents.disabled || isQuarry(site))
    return { ok: false, message: 'Those supplies are unavailable.' };
  if (!canReachSupplies(state, world, player, site, site.id))
    return { ok: false, message: 'Move closer with a clear view of the salvage crate.' };
  if (!Object.keys(contents.inventory).length)
    return { ok: false, message: 'This landmark has been searched. Return after it restocks.' };
  const requested = item
    ? { [item]: count ?? contents.inventory[item] ?? 0 }
    : { ...contents.inventory };
  const result = transferInventory(contents.inventory, player.inventory, requested, {
    capacity: carryCapacity(player),
    partial: true,
  });
  if (!result.ok) return result;
  if (!contents.restockAt) contents.restockAt = state.time + SITE_TYPES[site.kind].restock;
  return {
    ok: true,
    message: Object.keys(contents.inventory).length
      ? 'Salvage collected. More remains in the crate.'
      : 'Landmark searched. The shared crate is empty.',
  };
}
export function restockSites(state: GameState, world: WorldDefinition): void {
  for (const site of world.sites) {
    const contents = state.sites[site.id];
    if (
      !contents ||
      contents.disabled ||
      isQuarry(site) ||
      !contents.restockAt ||
      contents.restockAt > state.time ||
      Object.keys(contents.inventory).length
    )
      continue;
    contents.cycle++;
    contents.inventory = siteLoot(world.seed, site, contents.cycle);
    contents.restockAt = 0;
  }
}
/** Old expeditions keep all existing camps and excavations. A conflicting new site
 * stays absent for that save, instead of appearing through a player's structure. */
export function compatibleSites(state: GameState, world: WorldDefinition): void {
  for (const site of world.sites) {
    const conflict =
      state.buildings.some((b) => Math.hypot(b.x - site.x, b.z - site.z) < 16) ||
      Object.values(state.players).some((p) =>
        siteSolids(site).some((s) => bodyIntersects(s, p.position.x, p.position.y, p.position.z)),
      ) ||
      [
        ...siteSolids(site),
        ...world.resources.filter((r) => r.id.startsWith(`${site.id}-node-`)),
      ].some(
        (point) =>
          Math.abs(
            terrainFloor(state.terrain, world, point.x, point.z) -
              terrainHeight(point.x, point.z, world.hash),
          ) > 0.6,
      );
    if (!conflict) continue;
    state.sites[site.id].disabled = true;
    for (const r of world.resources.filter((r) => r.id.startsWith(`${site.id}-node-`)))
      state.resources[r.id] = { health: 0, respawnAt: 1e12 };
  }
}
