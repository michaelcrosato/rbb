import { BALANCE, BUILDINGS, ITEMS, RECIPES, RESOURCE_TYPES, WILDLIFE } from './content';
import { buildCandidate, validateBuild } from './building';
import { transact } from './inventory';
import { clamp, distance2 } from './math';
import { lineOfSight, stepPlayer } from './physics';
import type { Command } from './protocol';
import { createPlayer, idleInput, resourceHealth, resourceIsActive } from './state';
import type { GameEvent, GameState, PlayerState, Result } from './state';
import { developerAction, developerSchema } from './developer';
import { stepEnvironment } from './environment';
import { stepWildlife } from './wildlife';
import type { WorldDefinition } from './world';

export class Simulation {
  readonly events: GameEvent[] = [];
  constructor(
    readonly world: WorldDefinition,
    readonly state: GameState,
    readonly devAllowed = false,
  ) {}

  addPlayer(id: string, name: string): PlayerState {
    return (this.state.players[id] ??= createPlayer(id, name, this.world));
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
      p.position = { ...p.respawn };
      p.velocityY = 0;
      p.health = 100;
      p.hunger = 80;
      p.thirst = 80;
      p.stamina = 100;
      p.oxygen = 100;
      p.inventory = { rock: 1, berries: 2 };
      p.equipped = 'rock';
      p.input = idleInput();
      p.cooldown = 0;
      p.grounded = true;
      return { ok: true, message: 'A new morning. Your pack is where you fell.' };
    }
    if (p.health <= 0) return fail('Respawn to continue.');
    if (command.type === 'move') {
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
    if (p.cooldown > 0 && (command.type === 'interact' || command.type === 'build'))
      return fail('Wait a moment.');
    if (command.type === 'consume') {
      if (!['berries', 'cookedMeat', 'bandage'].includes(command.item))
        return fail('You cannot use this item.');
      const result = transact(p.inventory, { [command.item]: 1 }, {});
      if (!result.ok) return result;
      if (command.item === 'berries') {
        p.hunger = clamp(p.hunger + 16, 0, 100);
        p.thirst = clamp(p.thirst + 10, 0, 100);
      }
      if (command.item === 'cookedMeat') {
        p.hunger = clamp(p.hunger + 40, 0, 100);
        p.health = clamp(p.health + 8, 0, 100);
      }
      if (command.item === 'bandage') p.health = clamp(p.health + 30, 0, 100);
      p.cooldown = 0.45;
      return this.event('consume', p, `Used ${ITEMS[command.item].name.toLowerCase()}.`);
    }
    if (command.type === 'craft') {
      const recipe = RECIPES[command.recipe];
      if (
        'station' in recipe &&
        !this.state.buildings.some(
          (b) => b.kind === recipe.station && distance2(p.position, b) <= 5,
        )
      )
        return fail('You need a campfire within 5 metres.');
      const result = transact(p.inventory, recipe.cost, recipe.output);
      if (!result.ok) return result;
      if (command.recipe === 'hatchet' || command.recipe === 'pickaxe') {
        p.milestones.craft++;
        p.equipped = command.recipe;
      }
      return this.event('craft', p, `Crafted ${recipe.name.toLowerCase()}.`);
    }
    if (command.type === 'build') {
      const b = buildCandidate(
        this.state,
        this.world,
        command.kind,
        command.x,
        command.z,
        command.rotation,
      );
      const result = validateBuild(this.state, this.world, p, b);
      if (!result.ok) return result;
      const cost = transact(p.inventory, p.dev.freeBuild ? {} : BUILDINGS[b.kind].cost, {});
      if (!cost.ok) return cost;
      this.state.buildings.push({ ...b, id: `b${this.state.nextId++}`, owner: id });
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
    return (dist < 1 || dot > 0.25) && lineOfSight(this.state, p, target.x, target.y + 1, target.z);
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
      const multiplier = p.equipped === def.tool && def.health > 1 ? 3 : 1;
      const hits = Math.min(resourceHealth(this.state, this.world, id), multiplier);
      const result = transact(
        p.inventory,
        {},
        { [def.item]: def.yield * hits * this.state.tuning.gatherYield },
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
      const species = WILDLIFE[animal.species];
      if (!this.inReach(p, animal)) return fail(`${species.name} is out of reach.`);
      animal.health = Math.max(0, animal.health - (p.equipped === 'hatchet' ? 30 : 15));
      p.cooldown = 0.6;
      if (animal.health <= 0) {
        animal.respawnAt = this.state.time + this.state.tuning.wildlifeRespawn;
        this.state.bags.push({
          id: `bag${this.state.nextId++}`,
          owner: '',
          x: animal.x,
          y: animal.y,
          z: animal.z,
          inventory: { ...species.loot },
          expiresAt: this.state.time + 600,
        });
      }
      return this.event(
        'damage',
        p,
        animal.health > 0 ? `${species.name} hit.` : `${species.name} down. Collect its supplies.`,
      );
    }
    const bagIndex = this.state.bags.findIndex((b) => b.id === id);
    if (bagIndex >= 0) {
      const bag = this.state.bags[bagIndex];
      if (!this.inReach(p, bag)) return fail('Move closer to the pack.');
      const result = transact(p.inventory, {}, bag.inventory);
      if (!result.ok) return result;
      this.state.bags.splice(bagIndex, 1);
      p.cooldown = 0.3;
      return this.event('loot', p, 'Supplies collected.');
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
        this.state.buildings.some((b) => b.kind === 'campfire' && distance2(p.position, b) < 5)
      )
        p.health = Math.min(100, p.health + dt * 0.8);
      p.oxygen = clamp(p.oxygen + (p.position.y + 1.65 < -0.12 ? -7 : 25) * dt, 0, 100);
      if (p.oxygen === 0) p.health = Math.max(0, p.health - dt * 6 * this.state.tuning.damage);
      if (p.dev.invincible) p.health = 100;
      if (p.health <= 0) this.die(p);
    }
    stepWildlife(this.state, this.world, activePlayers, dt, (p, damage, name) => {
      if (p.dev.invincible) return;
      p.health = Math.max(0, p.health - damage);
      this.event('damage', p, `${name} hit you. Fight or find higher ground.`);
      if (p.health <= 0) this.die(p);
    });
    if (this.state.tick % 30 === 0) {
      for (const [id, resource] of Object.entries(this.state.resources)) {
        if (resource.health <= 0 && resource.respawnAt <= this.state.time) {
          const definition = this.world.resourceMap.get(id);
          if (
            definition &&
            !this.state.buildings.some((b) => distance2(b, definition) < 4) &&
            !Object.values(this.state.players).some((p) => distance2(p.position, definition) < 3)
          )
            delete this.state.resources[id];
        }
      }
      this.state.bags = this.state.bags.filter((b) => b.expiresAt > this.state.time);
    }
  }

  private die(p: PlayerState): void {
    p.health = 0;
    p.deaths++;
    p.input = idleInput();
    if (Object.keys(p.inventory).length)
      this.state.bags.push({
        id: `bag${this.state.nextId++}`,
        owner: p.id,
        ...p.position,
        inventory: { ...p.inventory },
        expiresAt: this.state.time + 1800,
      });
    p.inventory = {};
    this.event('death', p, 'You fell. Your supplies remain in a pack for 30 world minutes.');
  }
}
