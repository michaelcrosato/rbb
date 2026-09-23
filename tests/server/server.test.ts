import { PROTOCOL_VERSION } from '../../src/shared/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import pkg from '../../package.json' with { type: 'json' };
import { startWorldServer } from '../../server/app';
import { WorldStore } from '../../server/store';
import { SnapshotBacklog, TokenBucket } from '../../server/rate-limit';
import type { ClientMessage, ServerMessage, Snapshot } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/simulation';
import { createBuilding, createState, idleInput } from '../../src/shared/state';
import { generateWorld } from '../../src/shared/world';
import { BALANCE } from '../../src/shared/content';
import { applyTerrainUpdate, emptyTerrain, terrainFloor } from '../../src/shared/terrain';

type RunningServer = Awaited<ReturnType<typeof startWorldServer>>;
const servers: RunningServer[] = [],
  directories: string[] = [],
  sockets: WebSocket[] = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function setup(dataDir?: string, allowDevTools = false): Promise<RunningServer> {
  if (!dataDir) {
    dataDir = await mkdtemp(join(tmpdir(), 'rbb-test-'));
    directories.push(dataDir);
  }
  const server = await startWorldServer({
    port: 0,
    allowDevTools,
    host: '127.0.0.1',
    dataDir,
    log: () => {},
    saveIntervalMs: 1000,
  });
  servers.push(server);
  return server;
}
class Peer {
  messages: ServerMessage[] = [];
  seq = 0;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => this.messages.push(JSON.parse(raw.toString()) as ServerMessage));
  }
  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }
  async wait<T extends ServerMessage['type']>(
    type: T,
    predicate?: (m: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const index = this.messages.findIndex(
        (m) =>
          m.type === type && (!predicate || predicate(m as Extract<ServerMessage, { type: T }>)),
      );
      if (index >= 0)
        return this.messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await delay(15);
    }
    throw new Error(`Timed out waiting for ${type}`);
  }
}
async function connect(server: RunningServer): Promise<Peer> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: 'http://localhost:5173' });
  sockets.push(ws);
  const peer = new Peer(ws);
  await once(ws, 'open');
  return peer;
}
async function joinWorld(server: RunningServer, token?: string) {
  const peer = await connect(server);
  peer.send({
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    name: 'Tester',
    ...(token ? { token } : {}),
  });
  const welcome = await peer.wait('welcome');
  return { peer, welcome };
}
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  for (const server of servers.splice(0)) await server.close();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('authoritative world server', () => {
  it('contests landmark salvage without duplication and persists the shared remainder across restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-landmark-server-'));
    directories.push(dir);
    const world = generateWorld('quiet-frontier'),
      sim = new Simulation(world, createState(world));
    const site = world.sites.find((s) => s.kind === 'depot')!;
    const tokens = ['d'.repeat(64), 'e'.repeat(64)];
    const store = new WorldStore(join(dir, 'world.db'));
    for (const [index, token] of tokens.entries()) {
      const player = sim.addPlayer(`salvager${index}`, `Salvager ${index}`);
      player.position = { x: site.x + index * 0.5, y: site.y, z: site.z + 2.5 };
      store.register(token, player.id);
    }
    sim.state.sites[site.id].inventory = { parts: 1, scrap: 8 };
    store.save(sim.state);
    store.close();
    const server = await setup(dir),
      peers = await Promise.all(tokens.map((token) => joinWorld(server, token)));
    for (const { peer } of peers)
      peer.send({
        type: 'command',
        seq: 1,
        command: { type: 'collect', target: site.id, item: 'parts', count: 1 },
      });
    const snapshots = await Promise.all(
      peers.map(
        async ({ peer }) =>
          (
            await peer.wait(
              'snapshot',
              (m) => m.snapshot.sites[site.id].inventory.parts === undefined,
            )
          ).snapshot,
      ),
    );
    expect(snapshots.reduce((sum, s) => sum + (s.self.inventory.parts ?? 0), 0)).toBe(1);
    expect(snapshots.every((s) => s.players.every((p) => !('inventory' in p)))).toBe(true);
    peers[0].peer.send({
      type: 'command',
      seq: 2,
      command: { type: 'collect', target: site.id, item: 'scrap', count: 3 },
    });
    await peers[0].peer.wait('snapshot', (m) => m.snapshot.self.inventory.scrap === 3);
    peers[0].peer.send({
      type: 'command',
      seq: 3,
      command: { type: 'collect', target: 'site-lookout' },
    });
    expect((await peers[0].peer.wait('result', (m) => m.seq === 3)).result.ok).toBe(false);
    await server.close();
    const restarted = await setup(dir),
      resumed = await joinWorld(restarted, tokens[0]);
    expect(resumed.welcome.snapshot.sites[site.id].inventory).toEqual({ scrap: 5 });
    expect(resumed.welcome.snapshot.sites[site.id].restockAt).toBeGreaterThan(
      resumed.welcome.snapshot.time,
    );
    expect(resumed.welcome.snapshot.self.inventory.scrap).toBe(3);
    expect(resumed.welcome.snapshot.sandbox).toBe(false);
  });

  it('owns workshop costs, contested storage, gear, reinforcement and firearm damage on a normal server', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-workshop-server-'));
    directories.push(dir);
    const world = generateWorld('quiet-frontier'),
      sim = new Simulation(world, createState(world));
    const smith = sim.addPlayer('smith', 'Smith'),
      friend = sim.addPlayer('friend', 'Friend');
    friend.position.x = 0.5;
    smith.inventory = {
      rock: 1,
      wood: 100,
      stone: 36,
      ironOre: 8,
      charcoal: 4,
      huntingRifle: 1,
      cartridge: 1,
      armor: 1,
      backpack: 1,
    };
    const add = (kind: 'furnace' | 'storage' | 'wall', x: number, z: number) => {
      const b = createBuilding(
        { kind, x, y: 8, z, rotation: 0 },
        `b${sim.state.nextId++}`,
        smith.id,
      );
      sim.state.buildings.push(b);
      return b;
    };
    add('furnace', -3, 86);
    const chest = add('storage', 3, 86),
      wall = add('wall', 0, 89);
    chest.inventory = { parts: 1 };
    wall.health = 90;
    sim.state.animals = [
      {
        id: 'wild-server-test',
        species: 'boar',
        behavior: 'roam',
        x: 0,
        y: 8,
        z: 72,
        homeX: 0,
        homeZ: 72,
        yaw: 0,
        health: 60,
        cooldown: 0,
        respawnAt: 0,
      },
    ];
    sim.state.tuning.wildlifeSpeed =
      sim.state.tuning.wildlifeAggression =
      sim.state.tuning.needsRate =
        0;
    const tokenA = 'f'.repeat(64),
      tokenB = '9'.repeat(64),
      store = new WorldStore(join(dir, 'world.db'));
    store.save(sim.state);
    store.register(tokenA, smith.id);
    store.register(tokenB, friend.id);
    store.close();
    const server = await setup(dir),
      a = await joinWorld(server, tokenA),
      b = await joinWorld(server, tokenB);
    a.peer.send({ type: 'command', seq: 1, command: { type: 'craft', recipe: 'metal', count: 2 } });
    const smelted = (await a.peer.wait('snapshot', (m) => m.snapshot.self.inventory.metal === 4))
      .snapshot;
    expect(smelted.self.inventory.ironOre).toBeUndefined();
    expect(smelted.self.inventory.charcoal).toBeUndefined();
    a.peer.send({ type: 'command', seq: 2, command: { type: 'craft', recipe: 'metal' } });
    expect((await a.peer.wait('result', (m) => m.seq === 2)).result.ok).toBe(false);
    a.peer.send({ type: 'command', seq: 3, command: { type: 'wear', item: 'armor' } });
    a.peer.send({ type: 'command', seq: 4, command: { type: 'wear', item: 'backpack' } });
    a.peer.send({
      type: 'command',
      seq: 5,
      command: { type: 'structure', target: wall.id, action: 'upgrade' },
    });
    const upgraded = (
      await a.peer.wait(
        'snapshot',
        (m) => m.snapshot.buildings.find((b) => b.id === wall.id)?.grade === 'stone',
      )
    ).snapshot;
    expect(upgraded.buildings.find((b) => b.id === wall.id)?.health).toBe(225);
    expect(upgraded.self.inventory.stone).toBeUndefined();
    expect(upgraded.self.inventory.wood).toBe(96);
    a.peer.send({
      type: 'command',
      seq: 6,
      command: { type: 'storage', target: chest.id, direction: 'take', item: 'parts', count: 1 },
    });
    b.peer.send({
      type: 'command',
      seq: 1,
      command: { type: 'storage', target: chest.id, direction: 'take', item: 'parts', count: 1 },
    });
    const results = await Promise.all(
      [a, b].map(
        async ({ peer }) =>
          (
            await peer.wait(
              'snapshot',
              (m) => !m.snapshot.buildings.find((b) => b.id === chest.id)?.inventory.parts,
            )
          ).snapshot,
      ),
    );
    expect(results.reduce((sum, s) => sum + (s.self.inventory.parts ?? 0), 0)).toBe(1);
    a.peer.send({ type: 'command', seq: 7, command: { type: 'equip', item: 'huntingRifle' } });
    a.peer.send({
      type: 'command',
      seq: 8,
      command: { type: 'move', input: { ...idleInput(), pitch: Math.atan2(-1.05, 14) } },
    });
    a.peer.send({ type: 'command', seq: 9, command: { type: 'attack' } });
    const hunted = (await a.peer.wait('snapshot', (m) => m.snapshot.animals[0].health === 0))
      .snapshot;
    expect(hunted.self.inventory.cartridge).toBeUndefined();
    expect(hunted.bags).toHaveLength(1);
    a.peer.send({ type: 'command', seq: 10, command: { type: 'attack' } });
    expect((await a.peer.wait('result', (m) => m.seq === 10)).result.ok).toBe(false);
    await server.close();
    const restarted = await setup(dir),
      resumed = await joinWorld(restarted, tokenA);
    expect(resumed.welcome.snapshot.self.worn).toEqual({ armor: 'armor', backpack: 'backpack' });
    expect(resumed.welcome.snapshot.buildings.find((b) => b.id === wall.id)).toMatchObject({
      grade: 'stone',
      health: 225,
    });
    expect(resumed.welcome.snapshot.bags).toHaveLength(1);
    expect(resumed.welcome.snapshot.devAllowed).toBe(false);
  });
  it('shares dropped stacks, persists partial collection, and resolves competing pickups once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-supplies-test-'));
    directories.push(dir);
    let server = await setup(dir);
    let a = await joinWorld(server),
      b = await joinWorld(server);
    a.peer.send({ type: 'command', seq: 1, command: { type: 'drop', item: 'berries', count: 2 } });
    const dropped = (await b.peer.wait('snapshot', (message) => message.snapshot.bags.length === 1))
      .snapshot;
    const bag = dropped.bags[0];
    expect(bag.inventory.berries).toBe(2);
    b.peer.send({
      type: 'command',
      seq: 1,
      command: { type: 'collect', target: bag.id, item: 'berries', count: 1 },
    });
    const partial = (
      await b.peer.wait('snapshot', (message) => message.snapshot.self.inventory.berries === 4)
    ).snapshot;
    expect(partial.bags[0].inventory.berries).toBe(1);
    const aToken = a.welcome.token,
      bToken = b.welcome.token;
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    server = await setup(dir);
    a = await joinWorld(server, aToken);
    b = await joinWorld(server, bToken);
    expect(a.welcome.snapshot.self.inventory.berries).toBe(1);
    expect(b.welcome.snapshot.self.inventory.berries).toBe(4);
    expect(b.welcome.snapshot.bags[0].inventory.berries).toBe(1);
    const tick = b.welcome.snapshot.tick;
    for (const survivor of [a, b])
      survivor.peer.send({
        type: 'command',
        seq: 1,
        command: { type: 'collect', target: bag.id, item: 'berries', count: 1 },
      });
    const snapshots = await Promise.all(
      [a, b].map(
        async ({ peer }) =>
          (
            await peer.wait(
              'snapshot',
              (message) => message.snapshot.tick > tick && message.snapshot.bags.length === 0,
            )
          ).snapshot,
      ),
    );
    expect(
      snapshots.reduce((sum, snapshot) => sum + (snapshot.self.inventory.berries ?? 0), 0),
    ).toBe(6);
    expect(
      snapshots.every((snapshot) => snapshot.players.every((player) => !('inventory' in player))),
    ).toBe(true);
  });

  it('replicates ordinary-player excavation as deltas, rejects terrain cheats, and restores edits after restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-terrain-test-'));
    directories.push(dir);
    const world = generateWorld('quiet-frontier');
    const sim = new Simulation(world, createState(world));
    const p = sim.addPlayer('earthworker', 'Earthworker');
    p.position = { x: 20, y: 8, z: 88 };
    p.inventory = { pickaxe: 1 };
    p.equipped = 'pickaxe';
    const token = 'c'.repeat(64); // Synthetic test identity, isolated temporary DB.
    const store = new WorldStore(join(dir, 'world.db'));
    store.save(sim.state);
    store.register(token, p.id);
    store.close();
    const server = await setup(dir);
    const a = await joinWorld(server, token),
      b = await joinWorld(server);
    let remote = applyTerrainUpdate(emptyTerrain(), b.welcome.snapshot.terrain!);
    a.peer.send({
      type: 'command',
      seq: 1,
      command: { type: 'move', input: { ...idleInput(), pitch: -0.4 } },
    });
    await a.peer.wait('snapshot', (m) => m.snapshot.self.pitch === -0.4);
    a.peer.send({
      type: 'command',
      seq: 2,
      command: { type: 'terrain', request: { mode: 'dig', level: 8 } },
    });
    expect(
      (await a.peer.wait('events', (m) => m.events.some((e) => e.message === 'Terrain excavated.')))
        .events,
    ).toContainEqual(expect.objectContaining({ type: 'gather', playerId: p.id }));
    const changed = (await b.peer.wait('snapshot', (m) => m.snapshot.terrain?.revision === 1))
      .snapshot;
    expect(changed.terrain?.base).toBe(0);
    remote = applyTerrainUpdate(remote, changed.terrain!);
    expect(terrainFloor(remote, world, 20, 84.5)).toBeLessThan(8);
    expect(changed.players.every((player) => !('inventory' in player))).toBe(true);
    const inventory = (
      await a.peer.wait('snapshot', (m) => (m.snapshot.self.inventory.dirt ?? 0) > 0)
    ).snapshot.self.inventory;
    const fresh = await b.peer.wait(
      'snapshot',
      (m) => m.snapshot.tick > changed.tick && !m.snapshot.terrain,
    );
    expect(fresh.snapshot.terrain).toBeUndefined();
    a.peer.send({
      type: 'command',
      seq: 3,
      command: {
        type: 'dev',
        request: {
          action: 'terrain',
          brush: {
            mode: 'dig',
            shape: 'box',
            x: 20,
            y: 4,
            z: 88,
            radius: 12,
            strength: 1,
            level: 2,
          },
        },
      },
    });
    expect((await a.peer.wait('result', (m) => m.seq === 3)).result.ok).toBe(false);
    await server.close();
    const restarted = await setup(dir),
      resumed = await joinWorld(restarted, token);
    const restored = applyTerrainUpdate(emptyTerrain(), resumed.welcome.snapshot.terrain!);
    expect(restored).toEqual(remote);
    expect(resumed.welcome.snapshot.self.inventory).toEqual(inventory);
    expect(resumed.welcome.snapshot.sandbox).toBe(false);
  });
  it('reports readiness, shares world state and keeps other inventory private', async () => {
    const server = await setup();
    const a = await joinWorld(server),
      b = await joinWorld(server);
    const health = (await fetch(`http://127.0.0.1:${server.port}/health`).then((r) =>
      r.json(),
    )) as { players: number; ready: boolean };
    expect(health).toMatchObject({
      ready: true,
      players: 2,
      version: pkg.version,
      protocol: PROTOCOL_VERSION,
    });
    const snapshot = (await a.peer.wait('snapshot', (m) => m.snapshot.players.length === 1))
      .snapshot;
    expect(snapshot.players[0].id).toBe(b.welcome.playerId);
    expect(snapshot.players[0]).not.toHaveProperty('inventory');
    a.peer.send({ type: 'command', seq: 1, command: { type: 'craft', recipe: 'hatchet' } });
    expect((await a.peer.wait('result')).result.ok).toBe(false);
    a.peer.send({ type: 'command', seq: 2, command: { type: 'interact', target: 'starter-tree' } });
    expect((await a.peer.wait('result')).result.ok).toBe(false);
  });
  it('advertises developer capability, blocks ordinary-server cheats and shares enabled environment changes', async () => {
    const normal = await setup(),
      a = await joinWorld(normal);
    expect(a.welcome.snapshot.devAllowed).toBe(false);
    a.peer.send({ type: 'command', seq: 1, command: { type: 'dev', request: { action: 'kit' } } });
    expect((await a.peer.wait('result')).result.ok).toBe(false);
    const sandbox = await setup(undefined, true),
      b = await joinWorld(sandbox),
      observer = await joinWorld(sandbox);
    expect(b.welcome.snapshot.devAllowed).toBe(true);
    b.peer.send({
      type: 'command',
      seq: 1,
      command: { type: 'dev', request: { action: 'weather', weather: 'storm', instant: true } },
    });
    expect((await b.peer.wait('result')).result.ok).toBe(true);
    const snapshot = (
      await observer.peer.wait('snapshot', (m) => m.snapshot.environment.weather === 'storm')
    ).snapshot;
    expect(snapshot.sandbox).toBe(true);
    expect(snapshot.environment.duration).toBe(0);
    expect(snapshot.animals.some((a) => a.species === 'dolphin')).toBe(true);
  });
  it('owns movement, rejects replay, and stops stale held input', async () => {
    const server = await setup(),
      { peer, welcome } = await joinWorld(server);
    peer.send({
      type: 'command',
      seq: 1,
      command: { type: 'move', input: { ...idleInput(), forward: -1 } },
    });
    const first = (
      await peer.wait(
        'snapshot',
        (m) => m.snapshot.self.position.z > welcome.snapshot.self.position.z + 0.4,
      )
    ).snapshot;
    peer.send({ type: 'command', seq: 1, command: { type: 'consume', item: 'berries' } });
    expect((await peer.wait('result')).result.message).toContain('stale');
    await delay(650);
    peer.messages = [];
    const later = (await peer.wait('snapshot')).snapshot;
    expect(later.self.position.z - first.self.position.z).toBeLessThan(2);
    expect(later.self.input.forward).toBe(0);
    expect(later.self.inventory.berries).toBe(3);
  });
  it('resumes all four survivors and shared resources after a process restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-restart-'));
    directories.push(dir);
    const server = await setup(dir),
      { peer, welcome } = await joinWorld(server);
    const crew = await Promise.all(Array.from({ length: 3 }, () => joinWorld(server)));
    for (const { peer: teammate } of crew)
      teammate.send({ type: 'command', seq: 1, command: { type: 'consume', item: 'berries' } });
    await Promise.all(
      crew.map(({ peer: teammate }) =>
        teammate.wait('snapshot', (m) => m.snapshot.self.inventory.berries === 2),
      ),
    );
    peer.send({
      type: 'command',
      seq: 1,
      command: { type: 'move', input: { ...idleInput(), yaw: Math.atan2(1, 3) } },
    });
    await delay(80);
    peer.send({ type: 'command', seq: 2, command: { type: 'interact', target: 'starter-fiber' } });
    const gathered = await peer.wait('snapshot', (m) => m.snapshot.self.inventory.fiber === 6);
    expect(gathered.snapshot.resources['starter-fiber'].health).toBe(0);
    const closed = once(peer.ws, 'close');
    peer.ws.close();
    await closed;
    await server.close();
    const restarted = await setup(dir),
      resumed = await joinWorld(restarted, welcome.token);
    expect(resumed.welcome.playerId).toBe(welcome.playerId);
    expect(resumed.welcome.snapshot.self.inventory.fiber).toBe(6);
    expect(resumed.welcome.snapshot.resources['starter-fiber'].health).toBe(0);
    expect(resumed.welcome.snapshot.self.input.forward).toBe(0);
    const returned = await Promise.all(
      crew.map(({ welcome: teammate }) => joinWorld(restarted, teammate.token)),
    );
    expect(returned.map(({ welcome: teammate }) => teammate.playerId)).toEqual(
      crew.map(({ welcome: teammate }) => teammate.playerId),
    );
    expect(
      returned.every(({ welcome: teammate }) => teammate.snapshot.self.inventory.berries === 2),
    ).toBe(true);
    await resumed.peer.wait('snapshot', (m) => m.snapshot.players.length === 3);
  });
  it('rejects session theft, duplicate tabs, hostile browser origins and malformed data', async () => {
    const server = await setup(),
      { welcome } = await joinWorld(server);
    const duplicate = await connect(server);
    duplicate.send({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      name: 'Tester',
      token: welcome.token,
    });
    expect((await duplicate.wait('error')).message).toContain('already connected');
    const fake = await connect(server);
    fake.send({ type: 'hello', protocol: PROTOCOL_VERSION, name: 'Tester', token: 'a'.repeat(64) });
    expect((await fake.wait('error')).message).toContain('no longer valid');
    const hostile = new WebSocket(`ws://127.0.0.1:${server.port}`, {
      origin: 'https://untrusted.example',
    });
    sockets.push(hostile);
    const error = await new Promise<Error>((resolve) => hostile.on('error', resolve));
    expect(error.message).toContain('403');
    const malformed = await connect(server);
    const close = once(malformed.ws, 'close');
    malformed.ws.send('{bad');
    expect((await close)[0]).toBe(1008);
    const outdated = await connect(server);
    const outdatedClose = once(outdated.ws, 'close');
    outdated.ws.send(JSON.stringify({ type: 'hello', protocol: 1, name: 'Tester' }));
    expect((await outdatedClose)[0]).toBe(1008);
  });
  it('lets a survivor resume over a new connection once the old one falls silent, even when full', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-stale-'));
    directories.push(dir);
    const server = await startWorldServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: dir,
      log: () => {},
      staleSessionMs: 300,
    });
    servers.push(server);
    const crew = [];
    for (let i = 0; i < BALANCE.maxPlayers; i++) crew.push(await joinWorld(server));
    const [lost] = crew;
    // A tab that is still answering keeps its survivor.
    lost.peer.send({ type: 'ping', at: 1 });
    await lost.peer.wait('pong');
    const live = await connect(server);
    live.send({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      name: 'Tester',
      token: lost.welcome.token,
    });
    expect((await live.wait('error')).message).toContain('already connected');
    // The lost tab's network path died: it sends nothing while its teammates keep playing.
    const departed = once(lost.peer.ws, 'close');
    for (let seq = 1; seq <= 6; seq++) {
      await delay(100);
      for (const { peer } of crew.slice(1)) peer.send({ type: 'ping', at: seq });
    }
    const resumed = await joinWorld(server, lost.welcome.token);
    expect(resumed.welcome.playerId).toBe(lost.welcome.playerId);
    await departed;
    await resumed.peer.wait('snapshot', (m) => m.snapshot.players.length === 3);
    expect(server.diagnostics().connections).toBe(BALANCE.maxPlayers);
  });
  it('admits a survivor to a heavily edited world rather than mistaking its baseline for a slow client', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-baseline-'));
    directories.push(dir);
    const world = generateWorld('quiet-frontier'),
      sim = new Simulation(world, createState(world));
    sim.addPlayer('excavator', 'Excavator');
    // 50,000 changed deep samples: a welcome of about 1.3 MB before compression.
    for (let x = -100; x < 100; x++)
      for (let z = -125; z < 125; z++) sim.state.terrain.samples[`${x},-20,${z}`] = -1;
    sim.state.terrain.revision = 1;
    const store = new WorldStore(join(dir, 'world.db'));
    store.register('f'.repeat(64), 'excavator');
    store.save(sim.state);
    store.close();
    const server = await setup(dir);
    const { peer, welcome } = await joinWorld(server, 'f'.repeat(64));
    expect(Object.keys(welcome.snapshot.terrain!.samples)).toHaveLength(50_000);
    for (let i = 0; i < 3; i++)
      expect((await peer.wait('snapshot')).snapshot.terrain).toBeUndefined();
    expect(peer.ws.readyState).toBe(WebSocket.OPEN);
  });
  it('limits action bursts and closes message floods', async () => {
    const server = await setup();
    const { peer } = await joinWorld(server);
    for (let seq = 1; seq <= 20; seq++)
      peer.send({ type: 'command', seq, command: { type: 'consume', item: 'berries' } });
    const limited = await peer.wait('result', (m) => m.result.message.includes('Too many actions'));
    expect(limited.seq).toBeGreaterThan(12);
    const flood = await joinWorld(server);
    const closed = once(flood.peer.ws, 'close');
    for (let at = 0; at < 120; at++) flood.peer.send({ type: 'ping', at });
    expect((await closed)[0]).toBe(1008);
  });
  it('holds a four-player load without leaking inventory or losing tick authority', async () => {
    const server = await setup();
    const peers = await Promise.all(Array.from({ length: 4 }, () => joinWorld(server)));
    const start = server.diagnostics().tick;
    for (let step = 0; step < 35; step++) {
      for (const { peer } of peers)
        peer.send({
          type: 'command',
          seq: ++peer.seq,
          command: {
            type: 'move',
            input: { ...idleInput(), forward: step % 2 ? 0.4 : -0.4, yaw: 0.7 },
          },
        });
      await delay(34);
    }
    expect(server.diagnostics()).toMatchObject({
      healthy: true,
      connections: 4,
      rejectedMessages: 0,
    });
    expect(server.diagnostics().tick - start).toBeGreaterThan(25);
    const snapshot: Snapshot = (
      await peers[0].peer.wait('snapshot', (m) => m.snapshot.players.length === 3)
    ).snapshot;
    expect(snapshot.players.every((p) => !('inventory' in p))).toBe(true);
  });
  it('admits exactly four simultaneous joins, rejects overflow without creating survivors, and frees departed slots', async () => {
    const server = await setup();
    expect(BALANCE.maxPlayers).toBe(4);
    const peers = await Promise.all(Array.from({ length: 6 }, () => connect(server)));
    const closed = peers.map((peer) => once(peer.ws, 'close'));
    peers.forEach((peer, i) =>
      peer.send({ type: 'hello', protocol: PROTOCOL_VERSION, name: `Crew ${i}` }),
    );
    const admitted: { peer: Peer; welcome: Extract<ServerMessage, { type: 'welcome' }> }[] = [];
    for (const peer of peers) {
      const deadline = performance.now() + 4000;
      while (
        !peer.messages.some((m) => m.type === 'welcome' || m.type === 'error') &&
        performance.now() < deadline
      )
        await delay(15);
      const welcome = peer.messages.find((m) => m.type === 'welcome');
      if (welcome?.type === 'welcome') admitted.push({ peer, welcome });
      else {
        expect((await peer.wait('error')).message).toContain('World full (4/4)');
        expect((await closed[peers.indexOf(peer)])[0]).toBe(1008);
      }
    }
    expect(admitted).toHaveLength(4);
    expect(server.diagnostics().players).toBe(4);
    const health = () => fetch(`http://127.0.0.1:${server.port}/health`).then((r) => r.json());
    expect(await health()).toMatchObject({ players: 4, capacity: 4 });
    const leaving = admitted[0];
    leaving.peer.ws.close();
    await closed[peers.indexOf(leaving.peer)];
    await admitted[1].peer.wait('snapshot', (m) => m.snapshot.players.length === 2);
    const resumed = await joinWorld(server, leaving.welcome.token);
    expect(resumed.welcome.playerId).toBe(leaving.welcome.playerId);
    expect(server.diagnostics().players).toBe(4);
    expect(await health()).toMatchObject({ players: 4, capacity: 4 });
  });
  it('serializes competing resource gathers from four survivors without duplicating rewards', async () => {
    const server = await setup();
    const peers = await Promise.all(Array.from({ length: 4 }, () => joinWorld(server)));
    for (const { peer } of peers) {
      peer.send({
        type: 'command',
        seq: 1,
        command: { type: 'move', input: { ...idleInput(), yaw: Math.atan2(1, 3) } },
      });
      peer.send({
        type: 'command',
        seq: 2,
        command: { type: 'interact', target: 'starter-fiber' },
      });
    }
    const snapshots = await Promise.all(
      peers.map(
        async ({ peer }) =>
          (await peer.wait('snapshot', (m) => m.snapshot.resources['starter-fiber']?.health === 0))
            .snapshot,
      ),
    );
    expect(snapshots.reduce((sum, snapshot) => sum + (snapshot.self.inventory.fiber ?? 0), 0)).toBe(
      6,
    );
    for (const snapshot of snapshots) {
      expect(snapshot.players).toHaveLength(3);
      expect(snapshot.players.every((p) => !('inventory' in p))).toBe(true);
    }
  });
});

describe('durability and rate limits', () => {
  it('recovers a missing primary row and refuses unknown database schema versions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-schema-'));
    directories.push(dir);
    const path = join(dir, 'world.db');
    const store = new WorldStore(path);
    const state = createState(generateWorld('recovery'));
    store.save(state);
    store.save(state);
    store.db.prepare('DELETE FROM snapshots WHERE slot = ?').run('current');
    expect(store.load()!.seed).toBe('recovery');
    expect(store.recovered).toBe(true);
    store.db.exec('PRAGMA user_version=2');
    store.close();
    expect(() => new WorldStore(path)).toThrow(/newer schema/);
  });
  it('atomically recovers a corrupt snapshot from the previous healthy snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-store-'));
    directories.push(dir);
    const store = new WorldStore(join(dir, 'world.db'));
    const world = generateWorld('durable');
    const sim = new Simulation(world, createState(world));
    const p = sim.addPlayer('local', 'Tester');
    store.save(sim.state);
    p.inventory.wood = 10;
    store.save(sim.state);
    store.db.prepare('UPDATE snapshots SET body = ? WHERE slot = ?').run('{broken', 'current');
    expect(store.load()!.players.local.inventory.wood).toBeUndefined();
    expect(store.recovered).toBe(true);
    store.save(sim.state);
    expect(store.load()!.players.local.inventory.wood).toBe(10);
    store.close();
  });
  it('refuses to erase a world when both snapshots are damaged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-corrupt-'));
    directories.push(dir);
    const store = new WorldStore(join(dir, 'world.db'));
    const world = generateWorld('durable');
    store.save(createState(world));
    store.db.prepare('UPDATE snapshots SET body = ?').run('corrupted');
    expect(() => store.load()).toThrow(/no world was overwritten/);
    store.close();
    await expect(setup(dir)).rejects.toThrow(/no world was overwritten/);
  });
  it('rejects seed changes on an existing world', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rbb-seed-'));
    directories.push(dir);
    const server = await setup(dir);
    await server.close();
    await expect(
      startWorldServer({ port: 0, dataDir: dir, seed: 'different', log: () => {} }),
    ).rejects.toThrow(/does not match/);
  });
  it('enforces burst and sustained limits without unbounded refill', () => {
    const limiter = new TokenBucket(2, 3, 0);
    expect([limiter.take(0), limiter.take(0), limiter.take(0), limiter.take(0)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(limiter.take(400)).toBe(false);
    expect(limiter.take(500)).toBe(true);
    expect([
      limiter.take(100000),
      limiter.take(100000),
      limiter.take(100000),
      limiter.take(100000),
    ]).toEqual([true, true, true, false]);
  });
  it('skips snapshots while a socket is backlogged and closes only a sustained backlog', () => {
    const backlog = new SnapshotBacklog(1000, 500);
    expect(backlog.check(0, 0)).toBe('send');
    expect([backlog.check(5000, 100), backlog.check(5000, 600)]).toEqual(['skip', 'skip']);
    expect(backlog.check(900, 650)).toBe('send');
    expect([backlog.check(5000, 700), backlog.check(5000, 1201)]).toEqual(['skip', 'close']);
  });
});
