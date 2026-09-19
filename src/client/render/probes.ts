import * as THREE from 'three';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';
import { terrainHeight } from '../../shared/world';
import type { WorldDefinition } from '../../shared/world';
import type { MaterialHooks } from './material-hooks';

const SPACING = 40;
/** A small terrain-following radiance cache. Captures geometry with ordinary rasterization. */
export class IrradianceProbes {
  private data = new Float32Array(27 * 3 * 4);
  private texture = new THREE.DataTexture(this.data, 27, 3, THREE.RGBAFormat, THREE.FloatType);
  private target = new THREE.WebGLCubeRenderTarget(32, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
  });
  private camera = new THREE.CubeCamera(0.15, 180, this.target);
  private uniforms = {
    rbbProbeMap: { value: this.texture },
    rbbProbeOrigin: { value: new THREE.Vector2() },
    rbbProbeGain: { value: 0 },
  };
  private attached = new WeakSet<THREE.MeshStandardMaterial>();
  private ready = new Set<number>();
  private face = 0;
  private probe = 0;
  private accumulator = 0;
  private generation = 0;
  private reading = false;
  private disposed = false;
  private center = new THREE.Vector2(Infinity, Infinity);
  private gain = 0.45;
  private captures = 0;
  private error = '';
  get stats() {
    return {
      ready: this.ready.size,
      total: 9,
      captures: this.captures,
      reading: this.reading,
      error: this.error,
      estimatedBytes: 32 * 32 * 6 * 12 + this.data.byteLength,
    };
  }
  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private hooks: MaterialHooks,
    world: WorldDefinition,
    private height = (x: number, z: number) => terrainHeight(x, z, world.hash),
  ) {
    this.texture.needsUpdate = true;
    this.camera.coordinateSystem = THREE.WebGLCoordinateSystem;
    this.camera.updateCoordinateSystem();
    for (const material of hooks.materials) this.attach(material);
  }
  configure(gain: number): void {
    this.gain = gain;
    this.uniforms.rbbProbeGain.value = gain;
  }
  attach(material: THREE.MeshStandardMaterial): void {
    if (this.attached.has(material) || material.userData.rbbNoGI) return;
    this.attached.add(material);
    this.hooks.add(material, 'irradiance-probes', (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader =
        'varying vec3 vRbbProbeWorld;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `
        #include <project_vertex>
        vec4 rbbProbePosition=vec4(transformed,1.);
        #ifdef USE_INSTANCING
        rbbProbePosition=instanceMatrix*rbbProbePosition;
        #endif
        vRbbProbeWorld=(modelMatrix*rbbProbePosition).xyz;`,
        );
      shader.fragmentShader =
        `varying vec3 vRbbProbeWorld;uniform sampler2D rbbProbeMap;uniform vec2 rbbProbeOrigin;uniform float rbbProbeGain;\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_maps>',
        `
        #include <lights_fragment_maps>
        #if defined(RE_IndirectDiffuse)
          vec2 probeGrid=clamp((vRbbProbeWorld.xz-rbbProbeOrigin)/${SPACING.toFixed(1)},0.,2.);
          vec2 probeCell=min(floor(probeGrid),vec2(1.)),probeFraction=probeGrid-probeCell;
          vec3 probeCoefficients[9];for(int i=0;i<9;i++)probeCoefficients[i]=vec3(0.);
          float probeWeight=0.;
          for(int z=0;z<2;z++)for(int x=0;x<2;x++){
            vec2 cell=probeCell+vec2(x,z);float w=(x==0?1.-probeFraction.x:probeFraction.x)*(z==0?1.-probeFraction.y:probeFraction.y);
            float ready=textureLod(rbbProbeMap,vec2((cell.x*9.+.5)/27.,(cell.y+.5)/3.),0.).a;w*=ready;probeWeight+=w;
            for(int i=0;i<9;i++)probeCoefficients[i]+=textureLod(rbbProbeMap,vec2((cell.x*9.+float(i)+.5)/27.,(cell.y+.5)/3.),0.).rgb*w;
          }
          vec3 probeNormal=transformNormalByInverseViewMatrix(geometryNormal,viewMatrix);
          float edge=1.-smoothstep(${SPACING.toFixed(1)},${(SPACING * 2).toFixed(1)},max(abs(vRbbProbeWorld.x-rbbProbeOrigin.x-${SPACING.toFixed(1)}),abs(vRbbProbeWorld.z-rbbProbeOrigin.y-${SPACING.toFixed(1)})));
          irradiance+=max(vec3(0.),shGetIrradianceAt(probeNormal,probeCoefficients))*rbbProbeGain*edge/max(1.,probeWeight);
        #endif`,
      );
    });
  }
  invalidate(): void {
    this.generation++;
    this.face = this.probe = 0;
    this.ready.clear();
    this.data.fill(0);
    this.texture.needsUpdate = true;
  }
  update(
    position: THREE.Vector3,
    dt: number,
    excluded: THREE.Object3D[],
    chunks: { object: THREE.Object3D; center: THREE.Vector3; radius: number }[],
  ): void {
    if (this.disposed || this.error) return;
    const x = Math.round(position.x / SPACING),
      z = Math.round(position.z / SPACING);
    if (x !== this.center.x || z !== this.center.y) {
      this.center.set(x, z);
      this.uniforms.rbbProbeOrigin.value.set((x - 1) * SPACING, (z - 1) * SPACING);
      this.invalidate();
    }
    this.accumulator = Math.min(0.2, this.accumulator + dt);
    // Twelve faces per second; only one face in any frame. Readback is asynchronous.
    if (this.reading || this.accumulator < 1 / 12) return;
    this.accumulator = 0;
    if (this.face === 0) {
      const origin = this.uniforms.rbbProbeOrigin.value;
      const px = origin.x + (this.probe % 3) * SPACING,
        pz = origin.y + Math.floor(this.probe / 3) * SPACING;
      this.camera.position.set(px, Math.max(0, this.height(px, pz)) + 2.5, pz);
      this.camera.updateMatrixWorld(true);
    }
    const visibility = new Map<THREE.Object3D, boolean>();
    chunks.forEach((chunk) => {
      visibility.set(chunk.object, chunk.object.visible);
      chunk.object.visible = chunk.center.distanceTo(this.camera.position) < 180 + chunk.radius;
    });
    excluded.forEach((object) => {
      if (!visibility.has(object)) visibility.set(object, object.visible);
      object.visible = false;
    });
    const target = this.renderer.getRenderTarget(),
      shadow = this.renderer.shadowMap.autoUpdate,
      background = this.scene.background,
      fog = this.scene.fog;
    try {
      this.uniforms.rbbProbeGain.value = 0;
      this.renderer.shadowMap.autoUpdate = false;
      // Capture reflected surface radiance, leaving the sky to the existing hemispheric light.
      this.scene.background = new THREE.Color(0);
      this.scene.fog = null;
      this.renderer.setRenderTarget(this.target, this.face);
      this.renderer.render(this.scene, this.camera.children[this.face] as THREE.Camera);
      this.captures++;
    } finally {
      this.renderer.setRenderTarget(target);
      this.renderer.shadowMap.autoUpdate = shadow;
      this.scene.background = background;
      this.scene.fog = fog;
      this.uniforms.rbbProbeGain.value = this.gain;
      visibility.forEach((visible, object) => {
        object.visible = visible;
      });
    }
    if (++this.face < 6) return;
    this.face = 0;
    this.reading = true;
    const generation = this.generation,
      probeIndex = this.probe;
    void LightProbeGenerator.fromCubeRenderTarget(this.renderer, this.target)
      .then((probe) => {
        if (this.disposed || generation !== this.generation) return;
        probe.sh.coefficients.forEach((coefficient, i) => {
          const offset = (probeIndex * 9 + i) * 4;
          this.data[offset] = coefficient.x;
          this.data[offset + 1] = coefficient.y;
          this.data[offset + 2] = coefficient.z;
          this.data[offset + 3] = 1;
        });
        this.texture.needsUpdate = true;
        this.ready.add(probeIndex);
        this.probe = (probeIndex + 1) % 9;
      })
      .catch((error) => {
        if (!this.disposed)
          this.error = error instanceof Error ? error.message : 'Probe readback failed';
      })
      .finally(() => {
        this.reading = false;
        if (this.disposed) this.target.dispose();
      });
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.hooks.remove('irradiance-probes');
    this.texture.dispose();
    if (!this.reading) this.target.dispose();
  }
}
