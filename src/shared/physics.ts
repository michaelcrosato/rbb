import { BALANCE, RESOURCE_TYPES } from './content';
import { clamp } from './math';
import { resourceIsActive } from './state';
import type { GameState, PlayerState, Building } from './state';
import { nearbyResources, terrainHeight, WORLD_HALF } from './world';
import type { WorldDefinition } from './world';

export function wallContains(b: Building, x: number, z: number, padding = 0.33): boolean {
  const alongX = b.rotation % 2 === 0;
  return (
    Math.abs(x - b.x) < (alongX ? 2 : 0.12) + padding &&
    Math.abs(z - b.z) < (alongX ? 0.12 : 2) + padding
  );
}

export function groundHeight(
  state: GameState,
  world: WorldDefinition,
  x: number,
  z: number,
): number {
  let height = terrainHeight(x, z, world.hash);
  for (const b of state.buildings) {
    if (b.kind === 'foundation' && Math.abs(x - b.x) <= 2.15 && Math.abs(z - b.z) <= 2.15)
      height = Math.max(height, b.y);
  }
  return height;
}

export function blocked(
  state: GameState,
  world: WorldDefinition,
  x: number,
  z: number,
  feet: number,
): boolean {
  for (const r of nearbyResources(world, x, z, 3)) {
    const radius = RESOURCE_TYPES[r.kind].radius * r.scale;
    if (
      radius &&
      resourceIsActive(state, r.id) &&
      Math.hypot(x - r.x, z - r.z) < radius + 0.33 &&
      feet < r.y + (r.kind === 'tree' ? 8 : 1.5 * r.scale)
    )
      return true;
  }
  return state.buildings.some(
    (b) => b.kind === 'wall' && feet < b.y + 3 && feet + 1.7 > b.y && wallContains(b, x, z),
  );
}

export function lineOfSight(
  state: GameState,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
): boolean {
  for (let t = 0.1; t < 1; t += 0.1) {
    const px = player.position.x + (x - player.position.x) * t;
    const pz = player.position.z + (z - player.position.z) * t;
    const py = player.position.y + 1.5 + (y - player.position.y - 1.5) * t;
    if (
      state.buildings.some(
        (b) => b.kind === 'wall' && py > b.y && py < b.y + 3 && wallContains(b, px, pz, 0),
      )
    )
      return false;
  }
  return true;
}

export function stepPlayer(
  state: GameState,
  world: WorldDefinition,
  p: PlayerState,
  dt: number,
): void {
  if (p.health <= 0) return;
  const input = p.input;
  p.yaw = input.yaw;
  p.pitch = input.pitch;
  const swimming = terrainHeight(p.position.x, p.position.z, world.hash) < -1.2 && p.position.y < 0;
  const moving = Math.hypot(input.forward, input.strafe) > 0.01;
  const sprinting = input.sprint && moving && p.stamina > 1 && !swimming;
  const speed =
    (swimming ? BALANCE.swimSpeed : sprinting ? BALANCE.sprintSpeed : BALANCE.walkSpeed) *
    state.tuning.movementSpeed;
  p.stamina = clamp(p.stamina + (sprinting ? -12 : 14) * dt, 0, 100);
  const length = Math.max(1, Math.hypot(input.forward, input.strafe));
  const dx =
    ((-Math.sin(p.yaw) * input.forward + Math.cos(p.yaw) * input.strafe) / length) * speed * dt;
  const dz =
    ((-Math.cos(p.yaw) * input.forward - Math.sin(p.yaw) * input.strafe) / length) * speed * dt;
  if (p.dev.flight) {
    p.position.x = clamp(p.position.x + dx * 3, -WORLD_HALF + 8, WORLD_HALF - 8);
    p.position.z = clamp(p.position.z + dz * 3, -WORLD_HALF + 8, WORLD_HALF - 8);
    p.position.y = clamp(
      p.position.y +
        (Math.sin(p.pitch) * input.forward + Number(input.jump) - Number(input.dive)) *
          speed *
          3 *
          dt,
      -15,
      140,
    );
    p.velocityY = 0;
    p.grounded = false;
    return;
  }
  if (input.jump && p.grounded && !swimming) {
    p.velocityY = BALANCE.jumpSpeed * Math.sqrt(state.tuning.jumpHeight);
    p.grounded = false;
  }
  const swimmingUp = input.jump;
  input.jump = false;
  const tryMove = (x: number, z: number) => {
    x = clamp(x, -WORLD_HALF + 2, WORLD_HALF - 2);
    z = clamp(z, -WORLD_HALF + 2, WORLD_HALF - 2);
    const ground = groundHeight(state, world, x, z);
    if (ground - p.position.y > 0.65 || blocked(state, world, x, z, p.position.y)) return;
    p.position.x = x;
    p.position.z = z;
  };
  tryMove(p.position.x + dx, p.position.z);
  tryMove(p.position.x, p.position.z + dz);
  if (swimming) {
    const vertical = input.dive ? -2.3 : swimmingUp ? 3 : p.position.y < -1.2 ? 1.2 : 0;
    p.velocityY += (vertical - p.velocityY) * Math.min(1, dt * 5);
    p.position.y = Math.max(
      groundHeight(state, world, p.position.x, p.position.z) + 0.15,
      Math.min(-1.2, p.position.y + p.velocityY * dt),
    );
    p.grounded = false;
    return;
  }
  const floor = Math.max(groundHeight(state, world, p.position.x, p.position.z), -1.2);
  p.velocityY -= BALANCE.gravity * state.tuning.gravity * dt;
  p.position.y += p.velocityY * dt;
  if (p.position.y <= floor) {
    if (p.velocityY < -13 && !p.dev.invincible)
      p.health = Math.max(0, p.health - (-p.velocityY - 13) * 4 * state.tuning.damage);
    p.position.y = floor;
    p.velocityY = 0;
    p.grounded = true;
  } else p.grounded = false;
}
