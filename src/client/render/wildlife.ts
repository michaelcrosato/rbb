import * as THREE from 'three';
import type { Species } from '../../shared/content';
import { WILDLIFE } from '../../shared/content';
import { compact, mesh, material } from './models';

export function wildlifeModel(species: Species): THREE.Group {
  const group = new THREE.Group(),
    sea = WILDLIFE[species].habitat === 'sea';
  const colors: Record<Species, string> = {
    boar: '#766450',
    deer: '#b18b59',
    wolf: '#899292',
    fox: '#c5793c',
    rabbit: '#b3a594',
    fish: '#dfaf55',
    turtle: '#628b6b',
    dolphin: '#809fa5',
  };
  const size = {
    boar: 1,
    deer: 1.15,
    wolf: 1,
    fox: 0.63,
    rabbit: 0.36,
    fish: 0.36,
    turtle: 0.85,
    dolphin: 1.25,
  }[species];
  const color = colors[species],
    bodyY = sea ? 0 : species === 'deer' ? 1.05 : 0.7;
  group.add(
    mesh(
      new THREE.IcosahedronGeometry(0.65, 1).scale(
        sea ? 0.65 : 0.7,
        sea ? 0.45 : 0.75,
        species === 'dolphin' ? 1.8 : 1.2,
      ),
      color,
      0,
      bodyY,
      0,
    ),
  );
  group.add(
    mesh(
      new THREE.IcosahedronGeometry(0.32, 0).scale(0.85, 1, 1.1),
      color,
      0,
      bodyY + (species === 'deer' ? 0.5 : 0.05),
      species === 'dolphin' ? 1.12 : 0.78,
    ),
  );
  const headY = bodyY + (species === 'deer' ? 0.5 : 0.05);
  for (const x of [-0.23, 0.23])
    group.add(
      mesh(
        new THREE.IcosahedronGeometry(0.045, 0),
        '#202a29',
        x,
        headY + 0.04,
        species === 'dolphin' ? 1.22 : 0.88,
      ),
    );
  if (!sea) {
    for (const x of [-0.2, 0.2])
      group.add(
        mesh(
          new THREE.ConeGeometry(0.12, species === 'rabbit' ? 0.72 : 0.28, 4),
          color,
          x,
          headY + (species === 'rabbit' ? 0.56 : 0.32),
          0.7,
        ),
      );
    if (species === 'deer') {
      group.add(mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.65, 5), color, 0, 1.28, 0.48));
      for (const x of [-0.24, 0.24]) {
        group.add(mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.75, 4), '#dbccb0', x, 2.12, 0.68));
        for (const h of [0, 0.22])
          group.add(
            mesh(
              new THREE.ConeGeometry(0.035, 0.35, 4).rotateZ(x > 0 ? -0.7 : 0.7),
              '#dbccb0',
              x * 1.4,
              2.05 + h,
              0.68,
            ),
          );
      }
    }
    if (species === 'boar')
      for (const x of [-0.22, 0.22])
        group.add(mesh(new THREE.ConeGeometry(0.05, 0.25, 4), '#eee4bf', x, 0.64, 1.03));
    if (species === 'wolf' || species === 'fox') {
      group.add(
        mesh(
          new THREE.ConeGeometry(0.18, 0.45, 5).rotateX(Math.PI / 2),
          species === 'fox' ? '#eddbc0' : '#c2c4b5',
          0,
          headY - 0.05,
          1.07,
        ),
      );
      group.add(mesh(new THREE.ConeGeometry(0.2, 0.8, 5).rotateX(-0.8), color, 0, 0.65, -1.02));
    }
  } else {
    if (species === 'turtle')
      group.add(
        mesh(new THREE.IcosahedronGeometry(0.68, 1).scale(1, 0.48, 1.2), '#466e53', 0, 0.15, -0.05),
      );
    else {
      group.add(mesh(new THREE.ConeGeometry(0.26, 0.5, 3), color, 0, 0.38, -0.15));
      group.add(
        mesh(
          new THREE.ConeGeometry(0.35, 0.55, 3)
            .rotateX(-Math.PI / 2)
            .rotateZ(species === 'dolphin' ? 0 : Math.PI / 2),
          color,
          0,
          0,
          -1.25,
        ),
      );
      if (species === 'dolphin')
        group.add(
          mesh(new THREE.ConeGeometry(0.13, 0.55, 5).rotateX(Math.PI / 2), color, 0, -0.03, 1.5),
        );
    }
  }
  compact(group);
  const legGeometry = sea
    ? new THREE.IcosahedronGeometry(0.25, 0).scale(1.7, 0.2, 0.65)
    : new THREE.CylinderGeometry(0.075, 0.055, bodyY, 4).translate(0, -bodyY / 2, 0);
  const limbs = new THREE.InstancedMesh(
    legGeometry,
    material(color),
    species === 'dolphin' ? 2 : 4,
  );
  limbs.name = 'limbs';
  limbs.castShadow = !sea;
  limbs.frustumCulled = false;
  group.add(limbs);
  group.scale.setScalar(size);
  group.userData.species = species;
  group.userData.bodyY = bodyY;
  animateWildlife(group, 0, 0);
  return group;
}
const limbTransform = new THREE.Object3D();
export function animateWildlife(group: THREE.Group, time: number, speed: number): void {
  const species = group.userData.species as Species | undefined;
  if (!species) return;
  const sea = WILDLIFE[species].habitat === 'sea',
    limbs = group.getObjectByName('limbs') as THREE.InstancedMesh;
  for (let i = 0; i < limbs.count; i++) {
    const phase =
      time * (species === 'rabbit' ? 13 : sea ? 3 : 8) + (i === 0 || i === 3 ? 0 : Math.PI);
    limbTransform.position.set(
      i % 2 ? 0.28 : -0.28,
      sea ? -0.05 : group.userData.bodyY - 0.15,
      species === 'dolphin' ? 0.55 : i < 2 ? -0.4 : 0.4,
    );
    limbTransform.rotation.set(
      sea ? 0 : Math.sin(phase) * 0.55 * Math.min(1, speed),
      0,
      sea ? Math.sin(phase) * 0.4 : 0,
    );
    limbTransform.updateMatrix();
    limbs.setMatrixAt(i, limbTransform.matrix);
  }
  limbs.instanceMatrix.needsUpdate = true;
  group.rotation.z = sea ? Math.sin(time * 2) * 0.05 : 0;
}
