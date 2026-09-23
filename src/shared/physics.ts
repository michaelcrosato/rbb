import { BALANCE, RESOURCE_TYPES } from './content';
import { clamp } from './math';
import { resourceIsActive } from './state';
import type { GameState, PlayerState, Building } from './state';
import { nearbyResources, WORLD_HALF } from './world';
import type { Resource, WorldDefinition } from './world';
import { structureSolids } from './structure-geometry';
import { siteSolids } from './site-generation';
import { bodyIntersects, containsXZ, raySolid } from './spatial';
import {
  terrainBodyClear,
  terrainCeiling,
  terrainDensity,
  terrainFloor,
  terrainRaycast,
  TERRAIN,
} from './terrain';

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
  below: number = TERRAIN.maxY,
): number {
  let height = terrainFloor(state.terrain, world, x, z, below);
  for (const b of state.buildings.filter((b) => Math.abs(x - b.x) < 2.4 && Math.abs(z - b.z) < 2.4))
    for (const solid of structureSolids(b)) {
      const top = solid.y + solid.height / 2;
      if (top <= below + 0.001 && containsXZ(solid, x, z)) height = Math.max(height, top);
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
      feet < resourceTop(r) &&
      feet + 1.7 > r.y
    )
      return true;
  }
  return (
    !terrainBodyClear(state.terrain, world, x, feet, z) ||
    state.buildings.some(
      (b) =>
        Math.abs(x - b.x) < 2.4 &&
        Math.abs(z - b.z) < 2.4 &&
        structureSolids(b).some((s) => bodyIntersects(s, x, feet, z)),
    ) ||
    world.sites.some(
      (site) =>
        Math.abs(site.x - x) < 4 &&
        Math.abs(site.z - z) < 4 &&
        !state.sites[site.id]?.disabled &&
        siteSolids(site).some((s) => bodyIntersects(s, x, feet, z)),
    )
  );
}

const resourceTop = (r: Resource) => r.y + (r.kind === 'tree' ? 8 : 1.5 * r.scale);

/** Highest resource or landmark top at or below `feet` under the body. These solids block
 * walking but are not ground, so a survivor who clears one mid-jump must land on it rather
 * than sink inside, where every direction would stay blocked. */
function solidTopBelow(
  state: GameState,
  world: WorldDefinition,
  x: number,
  z: number,
  feet: number,
): number {
  let top = -Infinity;
  for (const r of nearbyResources(world, x, z, 3)) {
    const radius = RESOURCE_TYPES[r.kind].radius * r.scale;
    if (
      radius &&
      resourceIsActive(state, r.id) &&
      Math.hypot(x - r.x, z - r.z) < radius + 0.33 &&
      resourceTop(r) <= feet + 0.001
    )
      top = Math.max(top, resourceTop(r));
  }
  for (const site of world.sites) {
    if (Math.abs(site.x - x) >= 4 || Math.abs(site.z - z) >= 4 || state.sites[site.id]?.disabled)
      continue;
    for (const s of siteSolids(site)) {
      // Same 0.015 m step tolerance as bodyIntersects, which lets the body pass that close.
      const solidTop = s.y + s.height / 2;
      if (solidTop <= feet + 0.015 && containsXZ(s, x, z, 0.33)) top = Math.max(top, solidTop);
    }
  }
  return top;
}

export function lineOfSight(
  state: GameState,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  world: WorldDefinition,
  ignoreId?: string,
): boolean {
  const origin = {
    x: player.position.x,
    y: player.position.y + BALANCE.eyeHeight,
    z: player.position.z,
  };
  const direction = { x: x - origin.x, y: y - origin.y, z: z - origin.z };
  if (
    terrainRaycast(
      state.terrain,
      world,
      origin,
      direction,
      Math.hypot(direction.x, direction.y, direction.z) - 0.12,
    )
  )
    return false;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 0.12) return true;
  const ray = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  if (
    state.buildings.some(
      (b) =>
        b.id !== ignoreId &&
        structureSolids(b).some((s) => raySolid(origin, ray, s, length - 0.12) !== null),
    )
  )
    return false;
  if (
    world.sites.some(
      (site) =>
        !state.sites[site.id]?.disabled &&
        siteSolids(site).some(
          (s) =>
            !(site.id === ignoreId && s.role === 'crate') &&
            raySolid(origin, ray, s, length - 0.12) !== null,
        ),
    )
  )
    return false;
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
  const swimming =
    p.position.y < 0 &&
    terrainDensity(state.terrain, world, p.position.x, p.position.y + 0.2, p.position.z) >= 0;
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
      TERRAIN.minY + 2,
      TERRAIN.maxY + 12,
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
  const floorAt = (x: number, z: number) =>
    Math.max(
      ...[
        [0, 0],
        [0.33, 0],
        [-0.33, 0],
        [0, 0.33],
        [0, -0.33],
      ].map(([dx, dz]) => groundHeight(state, world, x + dx, z + dz, p.position.y + 0.65)),
    );
  const tryMove = (x: number, z: number) => {
    x = clamp(x, -WORLD_HALF + 2, WORLD_HALF - 2);
    z = clamp(z, -WORLD_HALF + 2, WORLD_HALF - 2);
    const ground = floorAt(x, z);
    const feet = Math.max(p.position.y, ground);
    if (blocked(state, world, x, z, feet)) return;
    p.position.x = x;
    p.position.z = z;
  };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.2));
  for (let i = 0; i < steps; i++) {
    tryMove(p.position.x + dx / steps, p.position.z);
    tryMove(p.position.x, p.position.z + dz / steps);
  }
  if (swimming) {
    const vertical = input.dive ? -2.3 : swimmingUp ? 3 : p.position.y < -1.2 ? 1.2 : 0;
    p.velocityY += (vertical - p.velocityY) * Math.min(1, dt * 5);
    p.position.y = Math.max(
      floorAt(p.position.x, p.position.z) + 0.15,
      Math.min(
        -1.2,
        terrainCeiling(state.terrain, world, p.position.x, p.position.z, p.position.y + 0.1) - 1.7,
        p.position.y + p.velocityY * dt,
      ),
    );
    p.grounded = false;
    return;
  }
  const floor = Math.max(
    floorAt(p.position.x, p.position.z),
    -1.2,
    solidTopBelow(state, world, p.position.x, p.position.z, p.position.y),
  );
  let ceiling = terrainCeiling(
    state.terrain,
    world,
    p.position.x,
    p.position.z,
    p.position.y + 0.1,
  );
  for (const [dx, dz] of [
    [0.33, 0],
    [-0.33, 0],
    [0, 0.33],
    [0, -0.33],
  ])
    ceiling = Math.min(
      ceiling,
      terrainCeiling(
        state.terrain,
        world,
        p.position.x + dx,
        p.position.z + dz,
        p.position.y + 0.1,
      ),
    );
  for (const b of state.buildings)
    for (const s of structureSolids(b))
      if (
        s.y - s.height / 2 > p.position.y + 0.1 &&
        containsXZ(s, p.position.x, p.position.z, 0.33)
      )
        ceiling = Math.min(ceiling, s.y - s.height / 2);
  // Tuned gravity can otherwise pass the schema bound on long drops and fail every snapshot.
  p.velocityY = Math.max(
    -BALANCE.terminalVelocity,
    p.velocityY - BALANCE.gravity * state.tuning.gravity * dt,
  );
  p.position.y += p.velocityY * dt;
  if (p.velocityY > 0 && p.position.y + 1.7 > ceiling) {
    p.position.y = ceiling - 1.7;
    p.velocityY = 0;
  }
  if (p.position.y <= floor) {
    if (p.velocityY < -13 && !p.dev.invincible)
      p.health = Math.max(0, p.health - (-p.velocityY - 13) * 4 * state.tuning.damage);
    p.position.y = floor;
    p.velocityY = 0;
    p.grounded = true;
  } else p.grounded = false;
}
