import { BALANCE } from '../shared/content';
import { PROTOCOL_VERSION, serverMessageSchema, snapshotFor } from '../shared/protocol';
import type { Command, Snapshot } from '../shared/protocol';
import { MAX_SAVE_BYTES } from '../shared/save';
import { applyTerrainUpdate } from '../shared/terrain';
import { Simulation } from '../shared/simulation';
import { createState } from '../shared/state';
import type { GameEvent, GameState, Result } from '../shared/state';
import { generateWorld } from '../shared/world';
import type { WorldDefinition } from '../shared/world';
import { normalizeServerUrl } from './multiplayer';

export interface Session {
  mode: 'solo' | 'online';
  devAllowed: boolean;
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
  readonly devAllowed = true;
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
    this.sim = new Simulation(this.world, this.state, true);
    this.sim.addPlayer(this.playerId, 'Wanderer');
  }
  command(command: Command): void {
    const result = this.sim.command(this.playerId, command);
    if (
      command.type !== 'move' &&
      (!result.ok || command.type === 'respawn' || command.type === 'dev')
    )
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

/** Commands only. The server owns movement, inventory, world mutations, and time. */
export class RemoteSession implements Session {
  readonly mode = 'online' as const;
  devAllowed = false;
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
    readonly serverUrl: string,
    private readonly name: string,
    fresh = false,
  ) {
    this.world = generateWorld('connecting');
    this.state = createState(this.world);
    this.key = `rbb.session:${serverUrl}`;
    try {
      if (!fresh) this.token = sessionStorage.getItem(this.key) ?? undefined;
    } catch {}
    try {
      if (!fresh && !this.token) this.token = localStorage.getItem(this.key) ?? undefined;
    } catch {}
  }

  static connect(url: string, name: string, fresh = false): Promise<RemoteSession> {
    const session = new RemoteSession(normalizeServerUrl(url), name, fresh);
    return new Promise((resolve, reject) => session.open(() => resolve(session), reject));
  }

  private open(ready?: () => void, fail?: (error: Error) => void): void {
    if (this.closed) return;
    const socket = new WebSocket(this.serverUrl);
    this.socket = socket;
    this.seq = 0;
    this.pendingMove = undefined;
    let welcomed = false;
    const current = () => !this.closed && this.socket === socket;
    const timeout = setTimeout(() => {
      if (!current()) return;
      fail?.(new Error('The world server did not respond. Check the address and try again.'));
      if (fail) this.closed = true;
      socket.close();
    }, 8000);
    socket.onopen = () => {
      if (!current()) return;
      socket.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          name: this.name,
          ...(this.token ? { token: this.token } : {}),
        }),
      );
    };
    socket.onmessage = (e) => {
      if (!current()) return;
      try {
        if (typeof e.data !== 'string' || e.data.length > MAX_SAVE_BYTES)
          throw new Error('Invalid server payload.');
        const message = serverMessageSchema.parse(JSON.parse(e.data));
        if (!welcomed && message.type !== 'welcome' && message.type !== 'error')
          throw new Error('Join before receiving world updates.');
        if (message.type === 'welcome') {
          if (welcomed) throw new Error('Duplicate welcome.');
          const snapshot = message.snapshot;
          this.playerId = snapshot.self.id;
          this.applySnapshot(snapshot);
          this.token = message.token;
          let stored = false;
          try {
            sessionStorage.setItem(this.key, message.token);
            stored = true;
          } catch {}
          try {
            localStorage.setItem(this.key, message.token);
            stored = true;
          } catch {}
          if (!stored) {
            this.onResult({
              ok: false,
              message:
                'Session storage is unavailable. Rejoining after a reload will create a new survivor.',
            });
          }
          welcomed = true;
          clearTimeout(timeout);
          this.reconnectAttempts = 0;
          this.status = 'Connected · authoritative world';
          ready?.();
        } else if (message.type === 'snapshot') {
          if (
            message.snapshot.self.id !== this.playerId ||
            message.snapshot.seed !== this.world.seed
          )
            throw new Error('The world or survivor changed without a new welcome.');
          this.applySnapshot(message.snapshot);
        } else if (message.type === 'result') this.onResult(message.result);
        else if (message.type === 'events')
          this.onEvents(message.events.filter((e) => e.playerId === this.playerId).slice(0, 30));
        else if (message.type === 'pong')
          this.ping = Math.max(0, Math.round(performance.now() - message.at));
        else if (message.type === 'error') {
          if (!welcomed) {
            this.closed = true;
            this.status = message.message;
            clearTimeout(timeout);
            fail?.(new Error(message.message));
            socket.close();
          }
          this.onResult({ ok: false, message: message.message });
        }
        this.lastMessage = performance.now();
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
    socket.onclose = (event) => {
      clearTimeout(timeout);
      if (!current()) return;
      this.pendingMove = undefined;
      if (!welcomed && fail) {
        this.closed = true;
        fail(new Error('Could not connect to the world server.'));
        return;
      }
      if (event.code === 1008) {
        this.status = 'Could not rejoin · return to menu to join again';
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
    this.devAllowed = snapshot.devAllowed;
    if (snapshot.terrain)
      this.state.terrain = applyTerrainUpdate(this.state.terrain, snapshot.terrain);
    this.state.environment = snapshot.environment;
    this.state.tuning = snapshot.tuning;
    this.state.sandbox = snapshot.sandbox;
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
    this.state.sites = snapshot.sites;
  }

  command(command: Command): void {
    if (command.type === 'move') {
      if (
        this.closed ||
        this.socket?.readyState !== WebSocket.OPEN ||
        !this.status.startsWith('Connected')
      )
        return;
      this.pendingMove = {
        ...command,
        input: { ...command.input, jump: command.input.jump || !!this.pendingMove?.input.jump },
      };
      return;
    }
    if (
      this.closed ||
      this.socket?.readyState !== WebSocket.OPEN ||
      !this.status.startsWith('Connected')
    ) {
      this.onResult({ ok: false, message: 'Reconnect before taking an action.' });
      return;
    }
    this.flushMove();
    this.socket.send(JSON.stringify({ type: 'command', seq: ++this.seq, command }));
  }

  private flushMove(): void {
    if (!this.pendingMove || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({ type: 'command', seq: ++this.seq, command: this.pendingMove }),
    );
    this.pendingMove = undefined;
    this.sinceMove = 0;
  }

  update(dt: number): void {
    this.sinceMove += dt;
    this.sincePing += dt;
    if (
      this.closed ||
      this.socket?.readyState !== WebSocket.OPEN ||
      !this.status.startsWith('Connected')
    )
      return;
    if (this.pendingMove && this.sinceMove >= 1 / BALANCE.tickRate) {
      this.flushMove();
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

export const getSnapshot = (session: Session, terrainSince = -1): Snapshot =>
  snapshotFor(session.state, session.playerId, session.devAllowed, terrainSince, session.world);
