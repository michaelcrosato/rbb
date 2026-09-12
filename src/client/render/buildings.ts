import * as THREE from 'three';
import { BUILDING_IDS } from '../../shared/content';
import type { Building } from '../../shared/state';
import { buildingModel, disposeObject } from './models';

/** Buildings cost at most five main-pass draw calls, even at the world's 512-piece limit. */
export class BuildingBatches {
  readonly group = new THREE.Group();
  private signature = '';
  private fireTime = { value: 0 };

  reset(parent: THREE.Group): void {
    disposeObject(this.group);
    this.group.clear();
    this.signature = '';
    parent.add(this.group);
  }

  sync(buildings: Building[]): void {
    const signature = buildings.map((b) => b.id).join(',');
    if (signature === this.signature) return;
    this.signature = signature;
    for (const child of [...this.group.children]) disposeObject(child);
    const dummy = new THREE.Object3D(),
      matrix = new THREE.Matrix4();
    for (const kind of BUILDING_IDS) {
      const pieces = buildings.filter((b) => b.kind === kind);
      if (!pieces.length) continue;
      const template = buildingModel(kind);
      template.updateMatrixWorld(true);
      for (const source of template.children) {
        if (!(source instanceof THREE.Mesh)) continue;
        const mat = (source.material as THREE.MeshStandardMaterial).clone();
        if (source.name === 'flame') {
          mat.onBeforeCompile = (shader) => {
            shader.uniforms.rbbFireTime = this.fireTime;
            shader.vertexShader =
              'uniform float rbbFireTime;\n' +
              shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\ntransformed.y *= 1.0 + sin(rbbFireTime * 9.0 + instanceMatrix[3].x) * 0.13;',
              );
          };
          mat.customProgramCacheKey = () => 'rbb-fire-v1';
        }
        const batch = new THREE.InstancedMesh(source.geometry.clone(), mat, pieces.length);
        batch.castShadow = source.name !== 'flame';
        batch.receiveShadow = true;
        pieces.forEach((piece, index) => {
          dummy.position.set(piece.x, piece.y, piece.z);
          dummy.rotation.set(0, (piece.rotation * Math.PI) / 2, 0);
          dummy.updateMatrix();
          matrix.multiplyMatrices(dummy.matrix, source.matrixWorld);
          batch.setMatrixAt(index, matrix);
        });
        batch.computeBoundingSphere();
        this.group.add(batch);
      }
      disposeObject(template);
    }
  }

  update(time: number): void {
    this.fireTime.value = time;
  }
}
