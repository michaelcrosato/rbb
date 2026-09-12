import { describe, expect, it } from 'vitest';
import { hashString, random } from '../../src/shared/math';
import {
  generateWorld,
  nearbyResources,
  SPAWN,
  terrainHeight,
  vertexHeight,
} from '../../src/shared/world';

describe('deterministic island', () => {
  it('rebuilds the exact same resource IDs, positions, and topology from a seed', () => {
    const a = generateWorld('quiet-frontier'),
      b = generateWorld('quiet-frontier'),
      c = generateWorld('another-island');
    expect(a.resources).toEqual(b.resources);
    expect(a.resources).not.toEqual(c.resources);
    expect(new Set(a.resources.map((r) => r.id)).size).toBe(a.resources.length);
    expect(a.resources.length).toBeGreaterThan(700);
  });
  it('has safe, level spawns and useful starting resources across seeds', () => {
    for (const seed of [
      'quiet-frontier',
      '0',
      's25',
      'RTX 3070',
      'tiny',
      'forest',
      'test-999',
      'north shore',
    ]) {
      const world = generateWorld(seed);
      expect(terrainHeight(SPAWN.x, SPAWN.z, world.hash)).toBe(8);
      expect(nearbyResources(world, SPAWN.x, SPAWN.z, 16).map((r) => r.kind)).toEqual(
        expect.arrayContaining(['tree', 'rock', 'fiber', 'berries', 'spring']),
      );
      for (const r of world.resources) expect(r.y).toBe(terrainHeight(r.x, r.z, world.hash));
    }
  });
  it('collides with the rendered triangles, including the shared diagonal', () => {
    const seed = hashString('quiet-frontier');
    const a = vertexHeight(64, -40, seed),
      b = vertexHeight(68, -40, seed),
      c = vertexHeight(64, -36, seed),
      d = vertexHeight(68, -36, seed);
    expect(terrainHeight(65, -39, seed)).toBeCloseTo(a * 0.5 + b * 0.25 + c * 0.25, 10);
    expect(terrainHeight(67, -37, seed)).toBeCloseTo(d * 0.5 + b * 0.25 + c * 0.25, 10);
    expect(terrainHeight(66, -38, seed)).toBeCloseTo((b + c) / 2, 10);
  });
  it('spatial queries are equivalent to a full resource scan', () => {
    const world = generateWorld('spatial'),
      rng = random(32);
    for (let i = 0; i < 80; i++) {
      const x = rng() * 500 - 250,
        z = rng() * 500 - 250,
        range = rng() * 20;
      expect(
        nearbyResources(world, x, z, range)
          .map((r) => r.id)
          .sort(),
      ).toEqual(
        world.resources
          .filter((r) => Math.hypot(x - r.x, z - r.z) <= range)
          .map((r) => r.id)
          .sort(),
      );
    }
  });
});
