import * as THREE from 'three';
import { noise } from '../../shared/math';
import { vertexHeight, TERRAIN_STEP, WORLD_HALF } from '../../shared/world';
import type { WorldDefinition } from '../../shared/world';

export function createTerrain(world: WorldDefinition): THREE.Group {
  const group = new THREE.Group();
  const groundMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
  });
  const shore: number[] = [];
  const sand = new THREE.Color('#cfc19a'),
    grass = new THREE.Color('#8d9d68'),
    forest = new THREE.Color('#788d61'),
    rock = new THREE.Color('#9ba6a0'),
    deep = new THREE.Color('#849d8e');
  for (let cx = -WORLD_HALF; cx < WORLD_HALF; cx += 64) {
    for (let cz = -WORLD_HALF; cz < WORLD_HALF; cz += 64) {
      const positions: number[] = [],
        colors: number[] = [];
      const tri = (points: number[][]) => {
        const height = points.reduce((s, p) => s + p[1], 0) / 3;
        const x = points.reduce((s, p) => s + p[0], 0) / 3,
          z = points.reduce((s, p) => s + p[2], 0) / 3;
        const variation = noise(x / 7, z / 7, world.hash + 44);
        const base =
          height < -0.5
            ? deep
            : height < 3.5
              ? sand
              : height > 32
                ? rock
                : variation > 0.5
                  ? grass
                  : forest;
        const color = base.clone().multiplyScalar(0.93 + variation * 0.14);
        points.forEach((p) => {
          positions.push(...p);
          colors.push(color.r, color.g, color.b);
        });
        const intersections: number[][] = [];
        for (let i = 0; i < 3; i++) {
          const a = points[i],
            b = points[(i + 1) % 3];
          if (a[1] < 0.1 !== b[1] < 0.1) {
            const t = (0.1 - a[1]) / (b[1] - a[1]);
            intersections.push([a[0] + (b[0] - a[0]) * t, 0.13, a[2] + (b[2] - a[2]) * t]);
          }
        }
        if (intersections.length === 2) shore.push(...intersections[0], ...intersections[1]);
      };
      for (let x = cx; x < cx + 64; x += TERRAIN_STEP) {
        for (let z = cz; z < cz + 64; z += TERRAIN_STEP) {
          const a = [x, vertexHeight(x, z, world.hash), z],
            b = [x + 4, vertexHeight(x + 4, z, world.hash), z];
          const c = [x, vertexHeight(x, z + 4, world.hash), z + 4],
            d = [x + 4, vertexHeight(x + 4, z + 4, world.hash), z + 4];
          tri([a, c, b]);
          tri([d, b, c]);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, groundMaterial);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(shore, 3));
  group.add(
    new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: '#e0efe2', transparent: true, opacity: 0.6 }),
    ),
  );
  return group;
}
