import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingKind, ItemId, ResourceKind } from '../../shared/content';

export const material = (
  color: THREE.ColorRepresentation,
  extra: THREE.MeshStandardMaterialParameters = {},
) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true, ...extra });

export function mesh(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const object = new THREE.Mesh(geometry, material(color));
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function colored(geometry: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new THREE.Color(color),
    values = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < values.length; i += 3) {
    values[i] = c.r;
    values[i + 1] = c.g;
    values[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(values, 3));
  g.deleteAttribute('uv');
  if (g !== geometry) geometry.dispose();
  return g;
}

export function resourceGeometry(kind: ResourceKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'tree') {
    parts.push(colored(new THREE.CylinderGeometry(0.16, 0.38, 6, 5).translate(0, 3, 0), '#806649'));
    for (let i = 0; i < 3; i++)
      parts.push(
        colored(
          new THREE.ConeGeometry(2.2 - i * 0.48, 3.8 - i * 0.4, 5)
            .rotateY(i * 0.7)
            .translate(0, 4.1 + i * 1.4, 0),
          ['#3f735b', '#528469', '#6b9773'][i],
        ),
      );
  } else if (kind === 'rock') {
    parts.push(
      colored(
        new THREE.IcosahedronGeometry(1.35, 0)
          .scale(1, 0.83, 0.85)
          .rotateY(0.6)
          .translate(0, 0.75, 0),
        '#a6b4b3',
      ),
    );
    parts.push(colored(new THREE.IcosahedronGeometry(0.55, 0).translate(0.9, 0.3, 0.4), '#859c9c'));
  } else if (kind === 'fiber') {
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4;
      parts.push(
        colored(
          new THREE.ConeGeometry(0.13, 1 + i * 0.08, 3)
            .rotateZ(Math.sin(a) * 0.22)
            .translate(Math.sin(a) * 0.24, 0.55, Math.cos(a) * 0.24),
          i % 2 ? '#d5c787' : '#95ad70',
        ),
      );
    }
  } else if (kind === 'berries') {
    parts.push(
      colored(
        new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.9, 1).translate(0, 0.5, 0),
        '#749265',
      ),
    );
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      parts.push(
        colored(
          new THREE.IcosahedronGeometry(0.11, 0).translate(
            Math.sin(a) * 0.53,
            0.6 + (i % 3) * 0.14,
            Math.cos(a) * 0.53,
          ),
          '#ce7770',
        ),
      );
    }
  } else {
    parts.push(
      colored(new THREE.CylinderGeometry(1.25, 1.45, 0.16, 9).translate(0, 0.05, 0), '#648887'),
    );
    parts.push(
      colored(new THREE.CylinderGeometry(1.05, 1.05, 0.05, 9).translate(0, 0.16, 0), '#88d3cd'),
    );
    for (let i = 0; i < 7; i++)
      parts.push(
        colored(
          new THREE.IcosahedronGeometry(0.4, 0).translate(
            Math.sin(i) * 1.3,
            0.18,
            Math.cos(i) * 1.3,
          ),
          '#aab8ac',
        ),
      );
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

/** Merge each procedural model into one draw call; preserve animated flames separately. */
export function compact(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  for (const child of [...group.children]) {
    if (!(child instanceof THREE.Mesh) || child.name === 'flame') continue;
    const source = child.geometry.clone().applyMatrix4(child.matrixWorld);
    parts.push(
      colored(source, `#${(child.material as THREE.MeshStandardMaterial).color.getHexString()}`),
    );
    child.geometry.dispose();
    (child.material as THREE.Material).dispose();
    group.remove(child);
  }
  if (parts.length) {
    const geometry = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    const combined = new THREE.Mesh(geometry, material('#ffffff', { vertexColors: true }));
    combined.castShadow = true;
    combined.receiveShadow = true;
    group.add(combined);
  }
  return group;
}

export function buildingModel(kind: BuildingKind): THREE.Group {
  const group = new THREE.Group();
  if (kind === 'foundation') {
    for (let i = 0; i < 8; i++)
      group.add(
        mesh(
          new THREE.BoxGeometry(3.96, 0.17, 0.48),
          i % 2 ? '#b08c5d' : '#bf9969',
          0,
          -0.085,
          -1.75 + i * 0.5,
        ),
      );
    for (const x of [-1.7, 1.7])
      for (const z of [-1.7, 1.7])
        group.add(mesh(new THREE.BoxGeometry(0.23, 1.5, 0.23), '#6e6049', x, -0.82, z));
    group.add(
      mesh(new THREE.BoxGeometry(4, 0.24, 0.18), '#766548', 0, -0.25, -1.9),
      mesh(new THREE.BoxGeometry(4, 0.24, 0.18), '#766548', 0, -0.25, 1.9),
    );
  } else if (kind === 'wall') {
    for (let i = 0; i < 10; i++)
      group.add(
        mesh(
          new THREE.BoxGeometry(0.38, 2.8, 0.16),
          i % 2 ? '#b3946c' : '#a88961',
          -1.8 + i * 0.4,
          1.4,
          0,
        ),
      );
    for (const y of [0.4, 2.3])
      group.add(mesh(new THREE.BoxGeometry(4, 0.16, 0.22), '#76644e', 0, y, 0));
  } else if (kind === 'campfire') {
    for (let i = 0; i < 8; i++)
      group.add(
        mesh(
          new THREE.IcosahedronGeometry(0.23, 0),
          '#8f9e96',
          Math.sin((i * Math.PI) / 4) * 0.65,
          0.13,
          Math.cos((i * Math.PI) / 4) * 0.65,
        ),
      );
    for (let i = 0; i < 3; i++) {
      const log = mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.1, 5), '#72553c', 0, 0.17, 0);
      log.rotation.set(Math.PI / 2, 0, i * 2.1);
      group.add(log);
    }
    const flame = mesh(new THREE.ConeGeometry(0.32, 0.9, 5), '#f7bf61', 0, 0.6, 0);
    (flame.material as THREE.MeshStandardMaterial).emissive.set('#e67824');
    (flame.material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
    flame.name = 'flame';
    group.add(flame);
  } else {
    group.add(mesh(new THREE.BoxGeometry(0.95, 0.12, 1.8), '#708c7a', 0, 0.06, 0));
    group.add(
      mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.95, 7).rotateZ(Math.PI / 2),
        '#aaa68a',
        0,
        0.2,
        -0.72,
      ),
    );
    group.add(mesh(new THREE.BoxGeometry(0.95, 0.015, 0.11), '#53675b', 0, 0.13, 0.5));
  }
  return compact(group);
}

export function survivorModel(): THREE.Group {
  const group = new THREE.Group();
  group.add(mesh(new THREE.CylinderGeometry(0.23, 0.28, 0.65, 5), '#718a79', 0, 1.03, 0));
  group.add(mesh(new THREE.IcosahedronGeometry(0.24, 1), '#c7a688', 0, 1.63, 0));
  for (const x of [-0.14, 0.14])
    group.add(mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.7, 5), '#555e58', x, 0.35, 0));
  for (const x of [-0.34, 0.34])
    group.add(mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.67, 5), '#b49d80', x, 1, 0));
  return compact(group);
}

export function toolModel(item: ItemId): THREE.Group {
  const group = new THREE.Group();
  if (item === 'hatchet' || item === 'pickaxe') {
    group.add(mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.7, 5), '#a4875f', 0, 0, 0));
    if (item === 'hatchet')
      group.add(
        mesh(new THREE.IcosahedronGeometry(0.2, 0).scale(1, 0.85, 0.3), '#adc3c0', -0.08, 0.26, 0),
      );
    else
      group.add(
        mesh(new THREE.ConeGeometry(0.09, 0.55, 4).rotateZ(Math.PI / 2), '#afc4c2', 0, 0.25, 0),
      );
    group.add(mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.1, 6), '#dfceb0', 0, 0.18, 0));
  } else if (item === 'berries') {
    for (let i = 0; i < 5; i++)
      group.add(
        mesh(
          new THREE.IcosahedronGeometry(0.07, 0),
          '#c67a77',
          Math.sin(i) * 0.08,
          i * 0.025,
          Math.cos(i) * 0.08,
        ),
      );
  } else group.add(mesh(new THREE.IcosahedronGeometry(0.19, 0).scale(1.2, 0.85, 0.9), '#a8b6b1'));
  compact(group);
  group.rotation.z = -0.4;
  return group;
}

export function disposeObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  object.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Points) {
      geometries.add(o.geometry);
      if (o instanceof THREE.Mesh && o.customDepthMaterial) materials.add(o.customDepthMaterial);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
    // Instance matrices live in their own GPU buffer, released only by the mesh's dispose event.
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  object.removeFromParent();
}
