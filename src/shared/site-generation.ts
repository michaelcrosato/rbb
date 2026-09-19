import { SITE_IDS, SITE_TYPES } from './content';
import type { ResourceKind, SiteKind } from './content';
import { hashString, random } from './math';
import type { Resource } from './world';
import type { Solid } from './spatial';

export interface WorldSite {
  id: string;
  kind: SiteKind;
  x: number;
  y: number;
  z: number;
}
export interface SiteSolid extends Solid {
  role: 'crate' | 'masonry' | 'timber' | 'marker';
}
const siteSolidCache = new WeakMap<WorldSite, SiteSolid[]>();
export const isQuarry = (site: Pick<WorldSite, 'kind'>): boolean => site.kind.endsWith('Quarry');
/** Every prop's solid is also its rendered shape. Containers have their own solid for ray exclusion. */
export function siteSolids(site: WorldSite): SiteSolid[] {
  const cached = siteSolidCache.get(site);
  if (cached) return cached;
  const shapes: SiteSolid[] = isQuarry(site)
    ? [
        { x: -2, y: 1.8, z: -2, width: 0.3, height: 3.6, depth: 0.3, role: 'timber' },
        { x: -2, y: 3.4, z: -2, width: 1.8, height: 0.7, depth: 0.15, role: 'marker' },
      ]
    : [
        { x: 0, y: 0.45, z: 0, width: 1.4, height: 0.9, depth: 1, role: 'crate' },
        { x: -2.7, y: 1.5, z: -2.4, width: 0.5, height: 3, depth: 0.5, role: 'masonry' },
        { x: 2.7, y: 1.5, z: -2.4, width: 0.5, height: 3, depth: 0.5, role: 'masonry' },
        { x: 0, y: 0.8, z: -2.4, width: 5.4, height: 1.6, depth: 0.35, role: 'masonry' },
        { x: -2.7, y: 1, z: 0, width: 0.5, height: 2, depth: 0.5, role: 'masonry' },
        { x: 2.7, y: 1, z: 0, width: 0.5, height: 2, depth: 0.5, role: 'masonry' },
        {
          x: -2.7,
          y: site.kind === 'lookout' ? 4 : 3.3,
          z: -2.4,
          width: 0.22,
          height: site.kind === 'lookout' ? 4 : 2.6,
          depth: 0.22,
          role: 'timber',
        },
        {
          x: -2.2,
          y: site.kind === 'lookout' ? 5.5 : 4.2,
          z: -2.4,
          width: 1.2,
          height: 0.8,
          depth: 0.1,
          role: 'marker',
        },
      ];
  const solids = shapes.map((s) => ({ ...s, x: site.x + s.x, y: site.y + s.y, z: site.z + s.z }));
  siteSolidCache.set(site, solids);
  return solids;
}

/** An independent RNG stream leaves generation-v1 terrain, trees and stones byte-for-byte stable. */
export function generateSites(
  seed: string,
  resources: Resource[],
  height: (x: number, z: number) => number,
): WorldSite[] {
  const rng = random(hashString(`${seed}:sites-v1`));
  const anchors = [
    [-28, 116],
    [-85, -30],
    [85, 30],
    [48, 112],
    [-72, -108],
    [110, -82],
  ];
  const sites: WorldSite[] = [];
  for (const [index, kind] of SITE_IDS.entries()) {
    const [ax, az] = anchors[index];
    let best: WorldSite | undefined,
      score = -Infinity;
    for (let attempt = 0; attempt < 240; attempt++) {
      const spread = attempt < 120 ? 42 : 110;
      const x = ax + (rng() - 0.5) * spread,
        z = az + (rng() - 0.5) * spread;
      const y = height(x, z);
      if (
        y < 3 ||
        y > 48 ||
        Math.hypot(x, z - 86) < 21 ||
        sites.some((s) => Math.hypot(s.x - x, s.z - z) < 32)
      )
        continue;
      const floors = [-3, 3].flatMap((dx) => [-3, 3].map((dz) => height(x + dx, z + dz)));
      const slope = Math.max(...floors) - Math.min(...floors);
      if (slope > 2) continue;
      const clearance = Math.min(
        ...resources
          .filter((r) => r.kind === 'tree' || r.kind === 'rock')
          .map((r) => Math.hypot(x - r.x, z - r.z) - (r.kind === 'tree' ? 0.6 : 1.1) * r.scale),
      );
      if (clearance < 4.4) continue;
      const nextScore = Math.min(clearance, 9) - slope * 2 - Math.hypot(x - ax, z - az) * 0.035;
      if (nextScore > score) {
        score = nextScore;
        best = { id: `site-${kind}`, kind, x, y, z };
      }
    }
    // The open starter meadow is always dry. Deterministic fallback slots keep rare
    // inhospitable seeds playable without relocating existing resources or terrain.
    if (!best) {
      const x = [-18, 18, -18, 18, 0, 0][index],
        z = [102, 102, 68, 68, 109, 63][index];
      best = { id: `site-${kind}`, kind, x, z, y: height(x, z) };
    }
    sites.push(best);
    if (!isQuarry(best)) continue;
    const main: ResourceKind =
      kind === 'stoneQuarry' ? 'quarryStone' : kind === 'ironQuarry' ? 'iron' : 'sulfur';
    let placed = 0;
    for (let attempt = 0; attempt < 180 && placed < 6; attempt++) {
      const angle = rng() * Math.PI * 2,
        radius = 4.5 + rng() * 9;
      const x = best.x + Math.cos(angle) * radius,
        z = best.z + Math.sin(angle) * radius;
      const y = height(x, z);
      if (y < 2 || resources.some((r) => Math.hypot(r.x - x, r.z - z) < 3.6)) continue;
      resources.push({
        id: `${best.id}-node-${placed}`,
        kind: placed < 4 ? main : kind === 'stoneQuarry' ? 'iron' : 'quarryStone',
        x,
        y,
        z,
        scale: 1.1,
        rotation: rng() * Math.PI * 2,
      });
      placed++;
    }
  }
  return sites;
}

export function siteLoot(
  seed: string,
  site: WorldSite,
  cycle: number,
): import('./content').Inventory {
  const rng = random(hashString(`${seed}:${site.id}:loot:${cycle}`));
  return Object.fromEntries(
    Object.entries(SITE_TYPES[site.kind].loot).map(([id, [min, max]]) => [
      id,
      min + Math.floor(rng() * (max - min + 1)),
    ]),
  );
}
