import * as THREE from 'three';

type Hook = THREE.Material['onBeforeCompile'];
/** Effects can attach/detach without overwriting wind, fire or other material adapters. */
export class MaterialHooks {
  private retiring = new WeakSet<THREE.MeshStandardMaterial>();
  isRecompiling(material: THREE.MeshStandardMaterial): boolean {
    return this.retiring.has(material);
  }
  private entries = new Map<
    THREE.MeshStandardMaterial,
    { base: Hook; key: string; hooks: Map<string, Hook> }
  >();
  register(material: THREE.MeshStandardMaterial): boolean {
    if (this.entries.has(material)) return false;
    this.entries.set(material, {
      base: material.onBeforeCompile,
      key: material.customProgramCacheKey(),
      hooks: new Map(),
    });
    material.addEventListener('dispose', () => {
      if (!this.retiring.has(material)) this.entries.delete(material);
    });
    return true;
  }
  get materials(): IterableIterator<THREE.MeshStandardMaterial> {
    return this.entries.keys();
  }
  add(material: THREE.MeshStandardMaterial, name: string, hook: Hook): void {
    this.register(material);
    this.entries.get(material)!.hooks.set(name, hook);
    this.rebuild(material);
  }
  remove(name: string): void {
    for (const [material, entry] of this.entries)
      if (entry.hooks.delete(name)) this.rebuild(material);
  }
  private rebuild(material: THREE.MeshStandardMaterial): void {
    const entry = this.entries.get(material)!;
    // Three caches programs by key but only retains the most recent custom uniform
    // object. Retire its GPU cache before changing adapters, so a re-enabled probe
    // cannot reuse a shader whose sampler still references a disposed probe texture.
    // The CPU material and our adapters remain registered; no per-frame disposal.
    this.retiring.add(material);
    try {
      material.dispose();
    } finally {
      this.retiring.delete(material);
    }
    material.onBeforeCompile = (shader, renderer) => {
      entry.base.call(material, shader, renderer);
      for (const hook of entry.hooks.values()) hook.call(material, shader, renderer);
    };
    // The original key can depend on onBeforeCompile.toString(); freeze it before wrapping.
    material.customProgramCacheKey = () => entry.key + ':' + [...entry.hooks.keys()].join(':');
    material.needsUpdate = true;
  }
}
