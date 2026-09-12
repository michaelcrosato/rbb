import { z } from 'zod';
import { BALANCE } from '../shared/content';
import { PROTOCOL_VERSION, snapshotFor } from '../shared/protocol';
import type { Command, ServerMessage, Snapshot } from '../shared/protocol';
import { stateSchema } from '../shared/save';
import { Simulation } from '../shared/simulation';
import { createState } from '../shared/state';
import type { GameEvent, GameState, Result } from '../shared/state';
import { generateWorld } from '../shared/world';
import type { WorldDefinition } from '../shared/world';

export interface Session {
  mode: 'solo' | 'online';
  state: GameState;
  world: WorldDefinition;
  playerId: string;
  status: string;
  ping: number;
  command(command: Command): void;
  update(dt: number, paused: boolean): void;
  close(): void;
  onResult: (result: Result) => void;
  onEvents: (events: GameEvent[]) => void;
}

export class LocalSession implements Session {
  readonly mode = 'solo' as const;
  readonly world: WorldDefinition;
  readonly state: GameState;
  readonly sim: Simulation;
  readonly playerId: string = 'local';
  status = 'Solo · saved on this device';
  ping = 0;
  onResult: (result: Result) => void = () => {};
  onEvents: (events: GameEvent[]) => void = () => {};
  private accumulator = 0;
  constructor(seed: string, state?: GameState, playerId = 'local') {
    this.playerId = playerId;
    this.world = generateWorld(seed);
    this.state = state ?? createState(this.world);
    this.sim = new Simulation(this.world, this.state);
    this.sim.addPlayer(this.playerId, 'Wanderer');
  }
  command(command: Command): void {
    const result = this.sim.command(this.playerId, command);
    if (command.type !== 'move' && (!result.ok || command.type === 'respawn'))
      this.onResult(result);
    const events = this.sim.drainEvents();
    if (events.length) this.onEvents(events);
  }
  update(dt: number, paused: boolean): void {
    if (paused) {
      this.accumulator = 0;
      return;
    }
    this.accumulator += Math.min(dt, 0.1);
    const step = 1 / BALANCE.tickRate;
    while (this.accumulator >= step) {
      this.sim.tick(step);
      this.accumulator -= step;
    }
    const events = this.sim.drainEvents();
    if (events.length) this.onEvents(events);
  }
  close(): void {}
}

const publicPlayer = stateSchema.shape.players.valueType.pick({
  id: true,
  name: true,
  position: true,
  yaw: true,
  health: true,
  equipped: true,
});
const snapshotSchema = z.object({
  tick: stateSchema.shape.tick,
  time: stateSchema.shape.time,
  seed: stateSchema.shape.seed,
  self: stateSchema.shape.players.valueType,
  players: z.array(publicPlayer).max(16),
  resources: stateSchema.shape.resources,
  buildings: stateSchema.shape.buildings,
  bags: stateSchema.shape.bags,
  animals: stateSchema.shape.animals,
});

export function normalizeServerUrl(value: string): string {
  const url = new URL(value);
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      'Use a ws:// or wss:// world-server address without credentials or a query string.',
    );
  if (location.protocol === 'https:' && url.protocol !== 'wss:')
    throw new Error('An HTTPS game needs a secure wss:// server.');
  return url.toString();
}

/** Commands only. The server owns movement, inventory, world mutations, and time. */
export class RemoteSession implements Session {
  readonly mode = 'online' as const;
  world: WorldDefinition;
  state: GameState;
  playerId = '';
  status = 'Connecting…';
  ping = 0;
  onResult: (result: Result) => void = () => {};
  onEvents: (events: GameEvent[]) => void = () => {};
  private socket?: WebSocket;
  private seq = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private closed = false;
  private sincePing = 0;
  private lastMessage = performance.now();
  private token?: string;
  private pendingMove?: Extract<Command, { type: 'move' }>;
  private sinceMove = 0;
  private key: string;

  private constructor(
    private readonly url: string,
    private readonly name: string,
    fresh = false,
  ) {
    this.world = generateWorld('connecting');
    this.state = createState(this.world);
    this.key = `rbb.session:${url}`;
    try {
      if (!fresh) this.token = localStorage.getItem(this.key) ?? undefined;
    } catch {}
  }

  static connect(url: string, name: string, fresh = false): Promise<RemoteSession> {
    const session = new RemoteSession(normalizeServerUrl(url), name, fresh);
    return new Promise((resolve, reject) => session.open(() => resolve(session), reject));
  }

  private open(ready?: () => void, fail?: (error: Error) => void): void {
    if (this.closed) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.seq = 0;
    let welcomed = false;
    const timeout = setTimeout(() => {
      fail?.(new Error('The world server did not respond. Check the address and try again.'));
      if (fail) this.closed = true;
      socket.close();
    }, 8000);
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          name: this.name,
          ...(this.token ? { token: this.token } : {}),
        }),
      );
    socket.onmessage = (e) => {
      this.lastMessage = performance.now();
      try {
        if (typeof e.data !== 'string' || e.data.length > 2_000_000)
          throw new Error('Invalid server payload.');
        const message = JSON.parse(e.data) as ServerMessage;
        if (message.type === 'welcome') {
          if (message.protocol !== PROTOCOL_VERSION || !/^[a-f0-9]{64}$/.test(message.token))
            throw new Error('Server protocol is incompatible.');
          const snapshot = snapshotSchema.parse(message.snapshot);
          this.playerId = snapshot.self.id;
          this.token = message.token;
          try {
            localStorage.setItem(this.key, message.token);
          } catch {
            this.onResult({
              ok: false,
              message:
                'Session storage is unavailable. Rejoining after a reload will create a new survivor.',
            });
          }
          this.applySnapshot(snapshot);
          welcomed = true;
          clearTimeout(timeout);
          this.reconnectAttempts = 0;
          this.status = 'Connected · authoritative world';
          ready?.();
        } else if (message.type === 'snapshot' && welcomed)
          this.applySnapshot(snapshotSchema.parse(message.snapshot));
        else if (message.type === 'result' && typeof message.result?.message === 'string')
          this.onResult(message.result);
        else if (message.type === 'events' && Array.isArray(message.events))
          this.onEvents(
            message.events
              .filter(
                (e) =>
                  e.playerId === this.playerId &&
                  ['gather', 'craft', 'build', 'damage', 'death', 'consume', 'loot'].includes(
                    e.type,
                  ) &&
                  typeof e.message === 'string',
              )
              .slice(0, 30),
          );
        else if (message.type === 'pong') this.ping = Math.round(performance.now() - message.at);
        else if (message.type === 'error') {
          if (!welcomed && fail) {
            this.closed = true;
            fail(new Error(message.message));
            socket.close();
          }
          this.onResult({ ok: false, message: String(message.message) });
        }
      } catch {
        this.status = 'Incompatible server data';
        this.closed = true;
        clearTimeout(timeout);
        fail?.(new Error('The server returned incompatible game data.'));
        socket.close();
      }
    };
    socket.onerror = () => {
      /* onclose handles retry and failure once. */
    };
    socket.onclose = () => {
      clearTimeout(timeout);
      this.pendingMove = undefined;
      if (this.closed) return;
      if (!welcomed && fail) {
        this.closed = true;
        fail(new Error('Could not connect to the world server.'));
        return;
      }
      this.status = 'Disconnected · reconnecting…';
      if (this.reconnectAttempts >= 6) {
        this.status = 'Connection lost · return to menu to rejoin';
        return;
      }
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts++, 10000);
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }

  private applySnapshot(snapshot: Snapshot): void {
    if (snapshot.seed !== this.world.seed) {
      this.world = generateWorld(snapshot.seed);
      this.state = createState(this.world);
    }
    this.state.tick = snapshot.tick;
    this.state.time = snapshot.time;
    this.state.players = { [snapshot.self.id]: snapshot.self };
    // Keep only public data on remote survivors. Their inventory never travels over the wire.
    for (const p of snapshot.players)
      this.state.players[p.id] = {
        ...snapshot.self,
        ...p,
        inventory: {},
        input: { ...snapshot.self.input, forward: 0, strafe: 0 },
      };
    this.state.resources = snapshot.resources;
    this.state.buildings = snapshot.buildings;
    this.state.bags = snapshot.bags;
    this.state.animals = snapshot.animals;
  }

  command(command: Command): void {
    if (command.type === 'move') {
      this.pendingMove = {
        ...command,
        input: { ...command.input, jump: command.input.jump || !!this.pendingMove?.input.jump },
      };
      return;
    }
    if (this.socket?.readyState !== WebSocket.OPEN || !this.status.startsWith('Connected')) {
      this.onResult({ ok: false, message: 'Reconnect before taking an action.' });
      return;
    }
    this.socket.send(JSON.stringify({ type: 'command', seq: ++this.seq, command }));
  }

  update(dt: number): void {
    this.sinceMove += dt;
    this.sincePing += dt;
    if (this.socket?.readyState !== WebSocket.OPEN || !this.status.startsWith('Connected')) return;
    if (this.pendingMove && this.sinceMove >= 1 / 30) {
      this.socket.send(
        JSON.stringify({ type: 'command', seq: ++this.seq, command: this.pendingMove }),
      );
      this.pendingMove = undefined;
      this.sinceMove = 0;
    }
    if (this.sincePing > 3) {
      this.sincePing = 0;
      this.socket.send(JSON.stringify({ type: 'ping', at: performance.now() }));
    }
    if (performance.now() - this.lastMessage > 12000) {
      this.status = 'Connection stalled · reconnecting…';
      this.socket.close();
    }
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

export const getSnapshot = (session: Session): Snapshot =>
  snapshotFor(session.state, session.playerId);
