import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import type { GraphicsSettings } from './settings';
import type { MaterialHooks } from './material-hooks';

export class CascadedShadows {
  private csm?: CSM;
  private signature = '';
  private watched = new WeakSet<THREE.MeshStandardMaterial>();
  constructor(
    private camera: THREE.PerspectiveCamera,
    private scene: THREE.Scene,
    private hooks: MaterialHooks,
  ) {}
  get lights(): THREE.DirectionalLight[] {
    return this.csm?.lights ?? [];
  }
  get active(): boolean {
    return !!this.csm;
  }
  configure(settings: GraphicsSettings, quality: string): void {
    const size = quality === 'high' ? 2048 : 1024;
    const signature =
      settings.shadows && settings.cascadedShadows
        ? `${settings.shadowCascades}:${settings.shadowDistance}:${size}`
        : '';
    if (signature === this.signature) return;
    this.dispose();
    this.signature = signature;
    if (!signature) return;
    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: settings.shadowCascades,
      maxFar: settings.shadowDistance,
      mode: 'practical',
      shadowMapSize: size,
      shadowBias: -0.00008,
      lightNear: 1,
      lightFar: 1000,
      lightMargin: 180,
      lightIntensity: 0,
    });
    this.csm.fade = true;
    this.csm.updateFrustums();
    for (const light of this.csm.lights) light.shadow.normalBias = 0.12;
    for (const material of this.hooks.materials) this.attach(material);
  }
  attach(material: THREE.MeshStandardMaterial): void {
    if (!this.csm || this.csm.shaders.has(material)) return;
    const original = material.onBeforeCompile;
    this.csm.setupMaterial(material);
    const csmHook = material.onBeforeCompile;
    material.onBeforeCompile = original;
    this.hooks.add(material, 'csm', csmHook);
    if (!this.watched.has(material)) {
      this.watched.add(material);
      material.addEventListener('dispose', () => {
        if (!this.hooks.isRecompiling(material)) this.csm?.shaders.delete(material);
      });
    }
  }
  resize(): void {
    this.csm?.updateFrustums();
  }
  update(sun: THREE.DirectionalLight, moon: THREE.DirectionalLight): void {
    if (!this.csm) return;
    const source = sun.intensity > 0.02 ? sun : moon;
    this.csm.lightDirection.copy(source.target.position).sub(source.position).normalize();
    for (const light of this.csm.lights) {
      light.color.copy(source.color);
      light.intensity = source.intensity;
    }
    sun.intensity = moon.intensity = 0;
    sun.castShadow = moon.castShadow = false;
    this.csm.update();
  }
  dispose(): void {
    if (this.csm) {
      this.csm.remove();
      this.csm.dispose();
      for (const light of this.csm.lights) light.shadow.dispose();
      this.hooks.remove('csm');
    }
    this.csm = undefined;
    this.signature = '';
  }
}
