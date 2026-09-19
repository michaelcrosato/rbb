import { BALANCE, BUILDINGS, CONSUMABLES, ITEMS, RESOURCE_TYPES, TOOLS } from './content';
import { buildCandidate, validateBuild } from './building';
import { carryCapacity, transact } from './inventory';
import { clamp, distance2 } from './math';
import { lineOfSight, stepPlayer, groundHeight } from './physics';
import { playerEarthwork, resourceSupported, safeTerrainSpawn } from './earthworks';
import type { Command } from './protocol';
import { createBuilding, createPlayer, idleInput, resourceHealth, resourceIsActive } from './state';
import type { GameEvent, GameState, PlayerState, Result } from './state';
import { developerAction, developerSchema } from './developer';
import { stepEnvironment } from './environment';
import { stepWildlife } from './wildlife';
import type { WorldDefinition } from './world';
import { collectBag, createGroundLoot, dropItems } from './transfers';
import { collectSite, restockSites } from './sites';
import { craftItems } from './crafting';
import { attack } from './combat';
import { structureAction, storageTransfer } from './structures';
import { armorResistance, wearEquipment } from './equipment';

export class Simulation {
  readonly events: GameEvent[] = [];
  constructor(
    readonly world: WorldDefinition,
    readonly state: GameState,
    readonly devAllowed = false,
  ) {}

  addPlayer(id: string, name: string): PlayerState {
    if (!this.state.players[id]) {
      const p = createPlayer(id, name, this.world);
      p.position = safeTerrainSpawn(this.state, this.world, p.position);
      this.state.players[id] = p;
    }
    return this.state.players[id];
  }

  drainEvents(): GameEvent[] {
    return this.events.splice(0);
  }
  private event(type: GameEvent['type'], p: PlayerState, message: string): Result {
    this.events.push({ type, playerId: p.id, message, x: p.position.x, z: p.position.z });
    if (this.events.length > 200) this.events.shift();
    return { ok: true, message };
  }

  command(id: string, command: Command): Result {
    const p = this.state.players[id];
    if (!p) return { ok: false, message: 'Survivor not found.' };
    const fail = (message: string): Result => ({ ok: false, message });
    if (command.type === 'dev') {
      if (!this.devAllowed) return fail('Developer tools are disabled by this server.');
      const validated = developerSchema.safeParse(command.request);
      if (!validated.success) return fail('Invalid developer parameters.');
      if (validated.data.action === 'step') {
        this.state.sandbox = true;
        for (let i = 0; i < validated.data.ticks; i++) this.tick();
        return { ok: true, message: `Advanced ${validated.data.ticks} simulation ticks.` };
      }
      return developerAction(this.state, this.world, p, validated.data);
    }
    if (command.type === 'respawn') {
      if (p.health > 0) return fail('You are already alive.');
      p.position = safeTerrainSpawn(this.state, this.world, p.respawn);
      p.velocityY = 0;
      p.health = 100;
      p.hunger = 80;
      p.thirst = 80;
      p.stamina = 100;
      p.oxygen = 100;
      if (!Object.keys(p.inventory).length) p.inventory = { rock: 1, berries: 2 };
      p.equipped = 'rock';
      p.input = idleInput();
      p.cooldown = 0;
      p.grounded = true;
      return { ok: true, message: 'A new morning. Your pack is where you fell.' };
    }
    if (p.health <= 0) return fail('Respawn to continue.');
    if (command.type === 'move') {
      // Turning is immediate intent. A following action on the same socket must
      // use this look direction even when no movement tick occurred between them.
      p.yaw = command.input.yaw;
      p.pitch = command.input.pitch;
      p.input = {
        ...command.input,
        jump: p.dev.flight ? command.input.jump : p.input.jump || command.input.jump,
      };
      return { ok: true, message: '' };
    }
    if (command.type === 'equip') {
      if (!(p.inventory[command.item] ?? 0)) return fail('This item is not in your pack.');
      p.equipped = command.item;
      return { ok: true, message: '' };
    }
    if (command.type === 'wear') {
      const result = wearEquipment(p, command.item);
      return result.ok ? this.event('loot', p, result.message) : result;
    }
    if (command.type === 'quick-slot') {
      if (
        !p.inventory[command.item] ||
        !Number.isInteger(command.slot) ||
        command.slot < 0 ||
        command.slot > 4
      )
        return fail('Choose an item from your pack and a quick slot.');
      p.quickSlots[command.slot] = command.item;
      return this.event(
        'loot',
        p,
        `Assigned ${ITEMS[command.item].name.toLowerCase()} to slot ${command.slot + 1}.`,
      );
    }
    if (command.type === 'structure') {
      const result = structureAction(this.state, this.world, p, command.target, command.action);
      if (result.ok) this.state.tick++;
      return result.ok ? this.event('build', p, result.message) : result;
    }
    if (command.type === 'storage') {
      const result = storageTransfer(
        this.state,
        this.world,
        p,
        command.target,
        command.direction,
        command.item,
        command.count,
      );
      return result.ok ? this.event('loot', p, result.message) : result;
    }
    if (command.type === 'attack') {
      const result = attack(this.state, this.world, p);
      return result.ok ? this.event('damage', p, result.message) : result;
    }
    if (command.type === 'drop') {
      const result = dropItems(this.state, this.world, p, command.item, command.count);
      if (result.ok && !p.inventory[p.equipped]) p.equipped = 'rock';
      return result.ok ? this.event('loot', p, result.message) : result;
    }
    if (command.type === 'collect') {
      if (this.state.sites[command.target]) {
        const result = collectSite(
          this.state,
          this.world,
          p,
          command.target,
          command.item,
          command.count,
        );
        return result.ok ? this.event('loot', p, result.message) : result;
      }
      const bag = this.state.bags.find((bag) => bag.id === command.target);
      if (!bag) return fail('Those supplies are no longer available.');
      const result = collectBag(this.state, this.world, p, bag, command.item, command.count);
      return result.ok ? this.event('loot', p, result.message) : result;
    }
    if (p.cooldown > 0 && (command.type === 'interact' || command.type === 'build'))
      return fail('Wait a moment.');
    if (command.type === 'terrain') {
      const result = playerEarthwork(this.state, this.world, p, command.request);
      return result.ok ? this.event('gather', p, result.message) : result;
    }
    if (command.type === 'consume') {
      const effect = CONSUMABLES[command.item];
      if (!effect) return fail('You cannot use this item.');
      const result = transact(p.inventory, { [command.item]: 1 }, {}, carryCapacity(p));
      if (!result.ok) return result;
      p.hunger = clamp(p.hunger + (effect.hunger ?? 0), 0, 100);
      p.thirst = clamp(p.thirst + (effect.thirst ?? 0), 0, 100);
      p.health = clamp(p.health + (effect.health ?? 0), 0, 100);
      p.cooldown = 0.45;
      return this.event('consume', p, `Used ${ITEMS[command.item].name.toLowerCase()}.`);
    }
    if (command.type === 'craft') {
      const result = craftItems(this.state, this.world, p, command.recipe, command.count);
      return result.ok ? this.event('craft', p, result.message) : result;
    }
    if (command.type === 'build') {
      const b = buildCandidate(
        this.state,
        this.world,
        command.kind,
        command.x,
        command.z,
        command.rotation,
        p.position.y + 0.65,
        p.position,
      );
      const result = validateBuild(this.state, this.world, p, b);
      if (!result.ok) return result;
      const cost = transact(
        p.inventory,
        p.dev.freeBuild ? {} : BUILDINGS[b.kind].cost,
        {},
        carryCapacity(p),
      );
      if (!cost.ok) return cost;
      this.state.buildings.push(createBuilding(b, `b${this.state.nextId++}`, id));
      p.cooldown = 0.4;
      p.milestones.build++;
      if (b.kind === 'bedroll') {
        p.respawn = { x: b.x, y: b.y, z: b.z };
        p.milestones.camp++;
      }
      return this.event(
        'build',
        p,
        b.kind === 'bedroll'
          ? 'Bedroll placed. Respawn point set.'
          : `Built ${BUILDINGS[b.kind].name.toLowerCase()}.`,
      );
    }
    if (command.type === 'interact') return this.interact(p, command.target);
    return fail('Unknown action.');
  }

  private inReach(p: PlayerState, target: { x: number; y: number; z: number }): boolean {
    const dist = distance2(p.position, target);
    if (dist > BALANCE.interactRange || Math.abs(p.position.y - target.y) > 4.5) return false;
    const dot =
      ((target.x - p.position.x) * -Math.sin(p.yaw) +
        (target.z - p.position.z) * -Math.cos(p.yaw)) /
      Math.max(0.01, dist);
    return (
      (dist < 1 || dot > 0.25) &&
      lineOfSight(this.state, p, target.x, target.y + 1, target.z, this.world)
    );
  }

  private interact(p: PlayerState, id: string): Result {
    const fail = (message: string): Result => ({ ok: false, message });
    const resource = this.world.resourceMap.get(id);
    if (resource) {
      if (!resourceIsActive(this.state, id)) return fail('This resource needs time to regrow.');
      if (!this.inReach(p, resource)) return fail('Move closer and face the resource.');
      if (resource.kind === 'spring') {
        p.thirst = 100;
        p.cooldown = 0.7;
        return this.event('consume', p, 'Fresh water. Thirst restored.');
      }
      const def = RESOURCE_TYPES[resource.kind];
      const tool = p.inventory[p.equipped] ? TOOLS[p.equipped] : undefined;
      const multiplier = tool?.family === def.tool && def.health > 1 ? tool.hits : 1;
      const hits = Math.min(resourceHealth(this.state, this.world, id), multiplier);
      const result = transact(
        p.inventory,
        {},
        { [def.item]: def.yield * hits * this.state.tuning.gatherYield },
        carryCapacity(p),
      );
      if (!result.ok) return result;
      const health = resourceHealth(this.state, this.world, id) - hits;
      this.state.resources[id] = {
        health,
        respawnAt:
          health <= 0 ? this.state.time + def.respawn * this.state.tuning.resourceRespawn : 0,
      };
      p.cooldown = def.health > 1 ? 0.55 : 0.25;
      p.milestones.gather += def.yield * hits * this.state.tuning.gatherYield;
      return this.event(
        'gather',
        p,
        `+${def.yield * hits * this.state.tuning.gatherYield} ${ITEMS[def.item].name}`,
      );
    }
    const animal = this.state.animals.find((a) => a.id === id && a.health > 0);
    if (animal) {
      const result = attack(this.state, this.world, p, id);
      return result.ok ? this.event('damage', p, result.message) : result;
    }
    const bagIndex = this.state.bags.findIndex((b) => b.id === id);
    if (bagIndex >= 0) {
      const bag = this.state.bags[bagIndex];
      const result = collectBag(this.state, this.world, p, bag);
      if (!result.ok) return result;
      p.cooldown = 0.3;
      return this.event('loot', p, result.message);
    }
    return fail('There is nothing to gather here.');
  }

  tick(dt = 1 / BALANCE.tickRate, activeIds?: ReadonlySet<string>): void {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1)
      throw new Error('Simulation requires a bounded fixed step.');
    this.state.tick++;
    this.state.time += dt;
    stepEnvironment(this.state.environment, this.state.tuning, this.world.hash, dt);
    const activePlayers = Object.values(this.state.players).filter(
      (p) => !activeIds || activeIds.has(p.id),
    );
    for (const p of activePlayers) {
      if (p.health <= 0) continue;
      p.cooldown = Math.max(0, p.cooldown - dt);
      stepPlayer(this.state, this.world, p, dt);
      p.hunger = Math.max(0, p.hunger - dt * 0.025 * this.state.tuning.needsRate);
      p.thirst = Math.max(
        0,
        p.thirst - dt * (p.input.sprint ? 0.055 : 0.035) * this.state.tuning.needsRate,
      );
      if (p.hunger <= 0 || p.thirst <= 0)
        p.health = Math.max(0, p.health - dt * 2 * this.state.tuning.damage);
      else if (
        p.hunger > 30 &&
        p.thirst > 30 &&
        this.state.buildings.some(
          (b) =>
            b.kind === 'campfire' &&
            distance2(p.position, b) < 5 &&
            Math.abs(p.position.y - b.y) < 3 &&
            lineOfSight(this.state, p, b.x, b.y + 0.5, b.z, this.world, b.id),
        )
      )
        p.health = Math.min(100, p.health + dt * 0.8);
      p.oxygen = clamp(p.oxygen + (p.position.y + 1.65 < -0.12 ? -7 : 25) * dt, 0, 100);
      if (p.oxygen === 0) p.health = Math.max(0, p.health - dt * 6 * this.state.tuning.damage);
      if (p.dev.invincible) p.health = 100;
      if (p.health <= 0) this.die(p);
    }
    stepWildlife(this.state, this.world, activePlayers, dt, (p, damage, name) => {
      if (p.dev.invincible) return;
      p.health = Math.max(0, p.health - damage * (1 - armorResistance(p)));
      this.event('damage', p, `${name} hit you. Fight or find higher ground.`);
      if (p.health <= 0) this.die(p);
    });
    if (this.state.tick % 30 === 0) {
      restockSites(this.state, this.world);
      for (const [id, resource] of Object.entries(this.state.resources)) {
        if (resource.health <= 0 && resource.respawnAt <= this.state.time) {
          const definition = this.world.resourceMap.get(id);
          if (
            definition &&
            resourceSupported(this.state, this.world, definition) &&
            !this.state.buildings.some((b) => distance2(b, definition) < 4) &&
            !Object.values(this.state.players).some((p) => distance2(p.position, definition) < 3)
          )
            delete this.state.resources[id];
        }
      }
      this.state.bags = this.state.bags.filter((b) => b.expiresAt > this.state.time);
      for (const bag of this.state.bags)
        bag.y = Math.min(bag.y, groundHeight(this.state, this.world, bag.x, bag.z, bag.y + 0.2));
    }
  }

  private die(p: PlayerState): void {
    p.health = 0;
    p.deaths++;
    p.input = idleInput();
    const kept =
      Object.keys(p.inventory).length > 0 &&
      !createGroundLoot(this.state, p.position, p.inventory, p.id, 1800);
    if (!kept) {
      p.inventory = {};
      p.worn = { armor: null, backpack: null };
    }
    this.event(
      'death',
      p,
      kept
        ? 'You fell. Ground storage is full; your supplies stay with you through respawn.'
        : 'You fell. Your supplies remain in a pack for 30 world minutes.',
    );
  }
}
