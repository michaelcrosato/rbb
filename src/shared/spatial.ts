import type { Vec3 } from './state';

/** Axis-aligned solids shared by collision, ray queries, placement and rendering. */
export interface Solid {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}
export function containsXZ(s: Solid, x: number, z: number, padding = 0): boolean {
  return Math.abs(x - s.x) < s.width / 2 + padding && Math.abs(z - s.z) < s.depth / 2 + padding;
}
export function solidsOverlap(a: Solid, b: Solid, inset = 0.02): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 - inset &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 - inset &&
    Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 - inset
  );
}
export function bodyIntersects(
  s: Solid,
  x: number,
  feet: number,
  z: number,
  radius = 0.33,
  height = 1.7,
): boolean {
  return (
    feet < s.y + s.height / 2 - 0.015 &&
    feet + height > s.y - s.height / 2 + 0.015 &&
    containsXZ(s, x, z, radius)
  );
}
/** Distance to entry along a normalized ray, or null. Handles thin walls without stepping past them. */
export function raySolid(
  origin: Vec3,
  direction: Vec3,
  solid: Solid,
  range: number,
): number | null {
  let near = 0,
    far = range;
  for (const [axis, size] of [
    ['x', 'width'],
    ['y', 'height'],
    ['z', 'depth'],
  ] as const) {
    const lo = solid[axis] - solid[size] / 2,
      hi = solid[axis] + solid[size] / 2;
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < lo || origin[axis] > hi) return null;
    } else {
      const a = (lo - origin[axis]) / direction[axis],
        b = (hi - origin[axis]) / direction[axis];
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return null;
    }
  }
  return near <= range && far >= 0 ? near : null;
}
export function transformSolid(solid: Solid, at: Vec3 & { rotation: number }): Solid {
  const angle = (at.rotation * Math.PI) / 2;
  const odd = at.rotation % 2 !== 0;
  return {
    ...solid,
    x: at.x + Math.cos(angle) * solid.x + Math.sin(angle) * solid.z,
    y: at.y + solid.y,
    z: at.z - Math.sin(angle) * solid.x + Math.cos(angle) * solid.z,
    width: odd ? solid.depth : solid.width,
    depth: odd ? solid.width : solid.depth,
  };
}
