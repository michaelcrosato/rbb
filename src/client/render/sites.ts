import * as THREE from 'three';
import { SITE_TYPES } from '../../shared/content';
import { siteSolids } from '../../shared/site-generation';
import type { WorldSite } from '../../shared/site-generation';
import { compact, mesh } from './models';

export function siteModel(site: WorldSite): THREE.Group {
  const group = new THREE.Group();
  for (const s of siteSolids(site)) {
    const color =
      s.role === 'marker'
        ? SITE_TYPES[site.kind].color
        : s.role === 'crate'
          ? '#9a794f'
          : s.role === 'timber' || site.kind === 'camp'
            ? '#7f6c51'
            : site.kind === 'depot'
              ? '#7f9290'
              : '#a8b0a0';
    group.add(
      mesh(
        new THREE.BoxGeometry(s.width, s.height, s.depth),
        color,
        s.x - site.x,
        s.y - site.y,
        s.z - site.z,
      ),
    );
    if (s.role === 'crate') {
      for (const x of [-0.45, 0.45])
        group.add(
          mesh(
            new THREE.BoxGeometry(0.1, s.height + 0.01, s.depth + 0.01),
            '#687a75',
            x,
            s.y - site.y,
            0,
          ),
        );
      group.add(mesh(new THREE.BoxGeometry(0.22, 0.16, 0.035), '#d1bd7f', 0, 0.52, 0.52));
    }
  }
  compact(group);
  group.position.set(site.x, site.y, site.z);
  return group;
}
