import { BALANCE, BUILDINGS, GRADE_IDS, MIN_STRUCTURE_HEALTH, STRUCTURE_GRADES } from './content';
import type { ItemId } from './content';
import { carryCapacity, transact, transferInventory } from './inventory';
import { canRemoveItems, normalizeEquipment } from './equipment';
import { lineOfSight } from './physics';
import { distance2 } from './math';
import { bodyIntersects, solidsOverlap } from './spatial';
import { isStructural, structureSolids } from './structure-geometry';
import type { Building, GameState, PlayerState, Result } from './state';
import { createGroundLoot } from './transfers';
import { SPAWN, terrainHeight } from './world';
import type { WorldDefinition } from './world';

export function canReachStructure(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  building: Building,
): boolean {
  return (
    player.health > 0 &&
    distance2(player.position, building) <= BALANCE.interactRange &&
    Math.abs(player.position.y - building.y) < 4.5 &&
    lineOfSight(state, player, building.x, building.y + 0.7, building.z, world, building.id)
  );
}
export function structureAction(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  target: string,
  action: 'upgrade' | 'repair' | 'door' | 'dismantle',
): Result {
  const b = state.buildings.find((b) => b.id === target);
  const fail = (message: string): Result => ({ ok: false, message });
  if (!b) return fail('This structure is no longer here.');
  if (!canReachStructure(state, world, player, b))
    return fail('Move closer with a clear view of the structure.');
  if (action === 'door') {
    if (b.kind !== 'door') return fail('Choose a door.');
    const next = { ...b, open: !b.open };
    if (
      structureSolids(next).some(
        (s) =>
          Object.values(state.players).some(
            (p) => p.health > 0 && bodyIntersects(s, p.position.x, p.position.y, p.position.z),
          ) ||
          state.animals.some((a) => a.health > 0 && bodyIntersects(s, a.x, a.y, a.z, 0.5, 1)) ||
          state.buildings.some(
            (other) =>
              other.id !== b.id &&
              other.id !== b.support &&
              structureSolids(other).some((t) => solidsOverlap(s, t)),
          ),
      )
    )
      return fail('The door is obstructed. Clear the doorway and swing area.');
    b.open = next.open;
    return { ok: true, message: b.open ? 'Door opened.' : 'Door closed.' };
  }
  if (action === 'dismantle') {
    if (b.owner !== player.id) return fail('Only the builder can dismantle this piece.');
    if (Object.keys(b.inventory).length) return fail('Empty this storage first.');
    if (state.buildings.some((other) => other.support === b.id))
      return fail('Remove the attached pieces first.');
    removeBuildings(state, world, new Set([b.id]));
    return { ok: true, message: 'Piece dismantled. Materials were not recovered.' };
  }
  const grade = STRUCTURE_GRADES[b.grade];
  if (action === 'upgrade') {
    if (!isStructural(b.kind)) return fail('This camp fixture cannot be reinforced.');
    const next = GRADE_IDS[GRADE_IDS.indexOf(b.grade) + 1];
    if (!next) return fail('This structure already has the strongest reinforcement.');
    const result = transact(
      player.inventory,
      STRUCTURE_GRADES[next].cost,
      {},
      carryCapacity(player),
    );
    if (!result.ok) return result;
    b.health = (b.health / grade.health) * STRUCTURE_GRADES[next].health;
    b.grade = next;
    return { ok: true, message: `Upgraded to ${STRUCTURE_GRADES[next].name.toLowerCase()}.` };
  }
  if (b.health >= grade.health) return fail('This structure is already fully repaired.');
  const result = transact(player.inventory, grade.repair, {}, carryCapacity(player));
  if (!result.ok) return result;
  b.health = Math.min(grade.health, b.health + grade.health * BALANCE.repairFraction);
  return { ok: true, message: `${BUILDINGS[b.kind].name} repaired.` };
}
export function storageTransfer(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  target: string,
  direction: 'deposit' | 'take',
  item: ItemId,
  count: number,
): Result {
  const storage = state.buildings.find((b) => b.id === target && b.kind === 'storage');
  if (!storage || !canReachStructure(state, world, player, storage))
    return { ok: false, message: 'Move closer with a clear view of the chest.' };
  const requested = { [item]: count };
  if (direction === 'deposit') {
    const removal = canRemoveItems(player, requested);
    if (!removal.ok) return removal;
  }
  const result =
    direction === 'deposit'
      ? transferInventory(player.inventory, storage.inventory, requested, {
          capacity: BALANCE.storageCapacity,
          partial: true,
        })
      : transferInventory(storage.inventory, player.inventory, requested, {
          capacity: carryCapacity(player),
          partial: true,
        });
  if (!result.ok) return result;
  normalizeEquipment(player);
  return {
    ok: true,
    message: `${direction === 'deposit' ? 'Stored' : 'Collected'} ${result.moved[item]} item${result.moved[item] === 1 ? '' : 's'}.`,
  };
}
function removeBuildings(state: GameState, world: WorldDefinition, ids: Set<string>): void {
  for (const b of state.buildings.filter((b) => ids.has(b.id))) {
    if (Object.keys(b.inventory).length) createGroundLoot(state, b, b.inventory, b.owner, 1800);
    if (b.kind === 'bedroll')
      for (const p of Object.values(state.players))
        if (distance2(p.respawn, b) < 0.1 && Math.abs(p.respawn.y - b.y) < 0.1)
          p.respawn = { ...SPAWN, y: terrainHeight(SPAWN.x, SPAWN.z, world.hash) };
  }
  state.buildings = state.buildings.filter((b) => !ids.has(b.id));
}
/** Wildlife can breach camps. Dependent pieces collapse together; chest contents
 * become shared bags, and the whole removal is deferred if that would lose items. */
export function damageStructure(
  state: GameState,
  world: WorldDefinition,
  target: string,
  damage: number,
): boolean {
  const b = state.buildings.find((b) => b.id === target);
  if (!b || !Number.isFinite(damage) || damage <= 0) return false;
  const health = b.health - damage * (1 - STRUCTURE_GRADES[b.grade].resistance);
  if (health >= MIN_STRUCTURE_HEALTH) {
    b.health = health;
    return true;
  }
  const ids = new Set([b.id]);
  let added = true;
  while (added) {
    added = false;
    for (const other of state.buildings)
      if (other.support && ids.has(other.support) && !ids.has(other.id)) {
        ids.add(other.id);
        added = true;
      }
  }
  const bagsNeeded = state.buildings.filter(
    (b) => ids.has(b.id) && Object.keys(b.inventory).length,
  ).length;
  if (state.bags.filter((b) => b.expiresAt > state.time).length + bagsNeeded > BALANCE.maxBags)
    return false;
  removeBuildings(state, world, ids);
  return true;
}
