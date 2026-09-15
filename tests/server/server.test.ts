import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import pkg from '../../package.json' with { type: 'json' };
import { startWorldServer } from '../../server/app';
import { WorldStore } from '../../server/store';
import { TokenBucket } from '../../server/rate-limit';
import type { ClientMessage, ServerMessage, Snapshot } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/simulation';
import { createState, idleInput } from '../../src/shared/state';
import { generateWorld } from '../../src/shared/world';
import { BALANCE } from '../../src/shared/content';

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
  peer.send({ type: 'hello', protocol: 2, name: 'Tester', ...(token ? { token } : {}) });
  const welcome = await peer.wait('welcome');
  return { peer, welcome };
}
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  for (const server of servers.splice(0)) await server.close();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('authoritative world server', () => {
  it('reports readiness, shares world state and keeps other inventory private', async () => {
    const server = await setup();
    const a = await joinWorld(server),
      b = await joinWorld(server);
    const health = (await fetch(`http://127.0.0.1:${server.port}/health`).then((r) =>
      r.json(),
    )) as { players: number; ready: boolean };
    expect(health).toMatchObject({ ready: true, players: 2, version: pkg.version, protocol: 2 });
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
    duplicate.send({ type: 'hello', protocol: 2, name: 'Tester', token: welcome.token });
    expect((await duplicate.wait('error')).message).toContain('already connected');
    const fake = await connect(server);
    fake.send({ type: 'hello', protocol: 2, name: 'Tester', token: 'a'.repeat(64) });
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
    peers.forEach((peer, i) => peer.send({ type: 'hello', protocol: 2, name: `Crew ${i}` }));
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
});
