import type { BuildingKind } from './content';
import type { Building, BuildingPlacement } from './state';
import { transformSolid } from './spatial';
import type { Solid } from './spatial';

export const isPlatform = (kind: BuildingKind): boolean =>
  ['foundation', 'floor', 'stairwell'].includes(kind);
export const isWall = (kind: BuildingKind): boolean => ['wall', 'doorway', 'window'].includes(kind);
export const isUpper = (kind: BuildingKind): boolean =>
  ['floor', 'stairwell', 'roof'].includes(kind);
export const isStructural = (kind: BuildingKind): boolean =>
  isPlatform(kind) || isWall(kind) || ['roof', 'stairs', 'fence', 'door'].includes(kind);
const box = (
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
): Solid => ({ x, y, z, width, height, depth });

/** Local solids are the authoritative model, used directly by the instanced renderer. */
export function localStructureSolids(kind: BuildingKind, open = false): Solid[] {
  switch (kind) {
    case 'foundation':
      return [box(0, -0.15, 0, 4, 0.3, 4)];
    case 'floor':
      return [box(0, -0.12, 0, 4, 0.24, 4)];
    case 'stairwell':
      return [
        box(-1.48, -0.12, 0, 1.04, 0.24, 4),
        box(1.48, -0.12, 0, 1.04, 0.24, 4),
        box(0, -0.12, -1.8, 1.92, 0.24, 0.4),
      ];
    case 'roof':
      return [
        box(0, -0.12, 0, 4, 0.24, 4),
        box(-1.9, 0.15, 0, 0.2, 0.3, 4),
        box(1.9, 0.15, 0, 0.2, 0.3, 4),
      ];
    case 'wall':
      return [box(0, 1.5, 0, 4, 3, 0.24)];
    case 'doorway':
      return [
        box(-1.4, 1.2, 0, 1.2, 2.4, 0.24),
        box(1.4, 1.2, 0, 1.2, 2.4, 0.24),
        box(0, 2.7, 0, 4, 0.6, 0.24),
      ];
    case 'window':
      return [
        box(0, 0.6, 0, 4, 1.2, 0.24),
        box(-1.4, 1.8, 0, 1.2, 1.2, 0.24),
        box(1.4, 1.8, 0, 1.2, 1.2, 0.24),
        box(0, 2.7, 0, 4, 0.6, 0.24),
      ];
    case 'door':
      return [open ? box(-0.77, 1.18, -0.78, 0.16, 2.36, 1.56) : box(0, 1.18, 0, 1.56, 2.36, 0.16)];
    case 'stairs':
      return Array.from({ length: 10 }, (_, i) =>
        box(0, (i + 1) * 0.15, 1.8 - i * 0.4, 1.7, (i + 1) * 0.3, 0.4),
      );
    case 'fence':
      return [box(0, 0.9, 0, 4, 1.8, 0.24)];
    case 'storage':
      return [box(0, 0.5, 0, 1.6, 1, 1)];
    case 'workbench':
      return [box(0, 0.6, 0, 1.8, 1.2, 0.9)];
    case 'furnace':
      return [box(0, 0.9, 0, 1.4, 1.8, 1.4)];
    case 'campfire':
      return [box(0, 0.15, 0, 1, 0.3, 1)];
    case 'bedroll':
      return [box(0, 0.08, 0, 0.9, 0.16, 1.7)];
  }
}
const solidCache = new WeakMap<object, { key: string; solids: Solid[] }>();
export function structureSolids(building: BuildingPlacement & { open?: boolean }): Solid[] {
  const key = `${building.kind}:${building.x}:${building.y}:${building.z}:${building.rotation}:${building.open}`;
  const cached = solidCache.get(building);
  if (cached?.key === key) return cached.solids;
  const solids = localStructureSolids(building.kind, building.open).map((solid) =>
    transformSolid(solid, building),
  );
  solidCache.set(building, { key, solids });
  return solids;
}
export function structureSignature(building: Building): string {
  return `${building.id}:${building.grade}:${Number(building.open)}`;
}
