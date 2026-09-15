import { describe, expect, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import { GET } from '../../api/health';
import { clientMessageSchema, PROTOCOL_VERSION, snapshotFor } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/simulation';
import { createState } from '../../src/shared/state';
import { generateWorld, WORLD_HALF } from '../../src/shared/world';

describe('wire protocol', () => {
  it('rejects old protocol versions, unknown fields, unsafe names and out-of-world targets', () => {
    for (const value of [
      { type: 'hello', protocol: 1, name: 'Tester' },
      { type: 'hello', protocol: PROTOCOL_VERSION, name: 'Tester', extra: true },
      { type: 'hello', protocol: PROTOCOL_VERSION, name: '<script>' },
      { type: 'hello', protocol: PROTOCOL_VERSION, name: 'Tester', token: 'short' },
      { type: 'command', seq: 0, command: { type: 'respawn' } },
      {
        type: 'command',
        seq: 1,
        command: { type: 'build', kind: 'foundation', x: WORLD_HALF + 1, z: 0, rotation: 0 },
      },
    ])
      expect(clientMessageSchema.safeParse(value).success).toBe(false);
    expect(
      clientMessageSchema.safeParse({ type: 'hello', protocol: PROTOCOL_VERSION, name: 'Ada-2' })
        .success,
    ).toBe(true);
  });
  it('reveals dropped inventory only to its owner and hides other survivors’ private state', () => {
    const world = generateWorld('privacy');
    const sim = new Simulation(world, createState(world));
    sim.addPlayer('a', 'A');
    sim.addPlayer('b', 'B');
    sim.state.bags.push({
      id: `bag${sim.state.nextId++}`,
      owner: 'b',
      x: 0,
      y: 8,
      z: 90,
      inventory: { wood: 5 },
      expiresAt: 9999,
    });
    const forA = snapshotFor(sim.state, 'a'),
      forB = snapshotFor(sim.state, 'b');
    expect(forA.bags[0].inventory).toEqual({});
    expect(forB.bags[0].inventory).toEqual({ wood: 5 });
    expect(forA.self.id).toBe('a');
    expect(forA.players.map((p) => p.id)).toEqual(['b']);
    expect(Object.keys(forA.players[0]).sort()).toEqual([
      'equipped',
      'health',
      'id',
      'name',
      'position',
      'yaw',
    ]);
  });
  it('serves the static client health route with the package version and protocol', async () => {
    const response = GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      service: 'rbb-client',
      version: pkg.version,
      protocol: PROTOCOL_VERSION,
      status: 'ok',
    });
  });
});
