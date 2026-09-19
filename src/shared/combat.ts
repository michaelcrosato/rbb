import { BALANCE, ITEMS, RESOURCE_TYPES, WEAPONS, WILDLIFE } from './content';
import { carryCapacity, transact } from './inventory';
import { lineOfSight } from './physics';
import { distance2 } from './math';
import { raySolid } from './spatial';
import type { Animal, GameState, PlayerState, Result } from './state';
import type { WorldDefinition } from './world';
import { createGroundLoot } from './transfers';
import { resourceIsActive } from './state';

export function attack(
  state: GameState,
  world: WorldDefinition,
  player: PlayerState,
  meleeTarget?: string,
): Result {
  const weapon = player.inventory[player.equipped] ? WEAPONS[player.equipped] : undefined;
  if (!weapon) return { ok: false, message: 'Equip a hunting weapon or tool from your pack.' };
  if (player.cooldown > 0) return { ok: false, message: 'Wait a moment.' };
  const origin = {
    x: player.position.x,
    y: player.position.y + BALANCE.eyeHeight,
    z: player.position.z,
  };
  const direction = {
    x: -Math.sin(player.yaw) * Math.cos(player.pitch),
    y: Math.sin(player.pitch),
    z: -Math.cos(player.yaw) * Math.cos(player.pitch),
  };
  let target: Animal | undefined,
    nearest = weapon.range;
  if (!weapon.ammo && meleeTarget) {
    const animal = state.animals.find((a) => a.id === meleeTarget && a.health > 0);
    if (animal) {
      const distance = distance2(player.position, animal);
      const facing =
        ((animal.x - player.position.x) * direction.x +
          (animal.z - player.position.z) * direction.z) /
        Math.max(0.01, distance);
      if (
        distance <= weapon.range &&
        Math.abs(animal.y - player.position.y) < 3 &&
        (distance < 1 || facing > 0.25) &&
        lineOfSight(state, player, animal.x, animal.y + 0.6, animal.z, world)
      )
        target = animal;
    }
    if (!target) return { ok: false, message: 'Move closer and face the animal.' };
  } else {
    for (const animal of state.animals) {
      if (animal.health <= 0) continue;
      const radius = WILDLIFE[animal.species].radius;
      const hit = raySolid(
        origin,
        direction,
        {
          x: animal.x,
          y: animal.y + 0.5,
          z: animal.z,
          width: radius * 2,
          height: 1.2,
          depth: radius * 2,
        },
        nearest,
      );
      if (
        hit !== null &&
        lineOfSight(
          state,
          player,
          origin.x + direction.x * (hit + 0.1),
          origin.y + direction.y * (hit + 0.1),
          origin.z + direction.z * (hit + 0.1),
          world,
        )
      ) {
        target = animal;
        nearest = hit;
      }
    }
    if (
      target &&
      world.resources.some(
        (r) =>
          resourceIsActive(state, r.id) &&
          RESOURCE_TYPES[r.kind].radius > 0 &&
          raySolid(
            origin,
            direction,
            {
              x: r.x,
              y: r.y + (r.kind === 'tree' ? 4 : 0.8),
              z: r.z,
              width: RESOURCE_TYPES[r.kind].radius * r.scale * 2,
              height: r.kind === 'tree' ? 8 : 1.6,
              depth: RESOURCE_TYPES[r.kind].radius * r.scale * 2,
            },
            nearest,
          ) !== null,
      )
    )
      target = undefined;
  }
  if (
    target &&
    target.health <= weapon.damage &&
    state.bags.filter((b) => b.expiresAt > state.time).length >= BALANCE.maxBags
  )
    return { ok: false, message: 'Collect some ground supplies before hunting more wildlife.' };
  if (weapon.ammo) {
    if (!player.inventory[weapon.ammo])
      return { ok: false, message: `You need ${ITEMS[weapon.ammo].name.toLowerCase()}.` };
    const spent = transact(player.inventory, { [weapon.ammo]: 1 }, {}, carryCapacity(player));
    if (!spent.ok) return spent;
  }
  player.cooldown = weapon.cooldown;
  if (!target) return { ok: true, message: weapon.ammo ? 'Shot missed.' : 'Swing missed.' };
  target.health = Math.max(0, target.health - weapon.damage);
  target.behavior = WILDLIFE[target.species].damage ? 'chase' : 'flee';
  if (target.health <= 0) {
    target.respawnAt = state.time + state.tuning.wildlifeRespawn;
    createGroundLoot(state, target, WILDLIFE[target.species].loot);
  }
  return {
    ok: true,
    message: `${WILDLIFE[target.species].name} ${target.health > 0 ? 'hit.' : 'down. Collect its supplies.'}`,
  };
}
