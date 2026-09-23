import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SunShaftPass } from './shafts';
import type { GraphicsSettings } from './settings';
import { FrameBuffers } from './buffers';
import { FrameState } from './frame-state';
import { ScreenPass, TemporalResolve } from './screen-effects';
import { VolumePass } from './volumes';
import type { SurfaceEffects, Ocean } from './surfaces';
import type { Atmosphere } from './atmosphere';
import type { Tuning } from '../../shared/environment';

/** AO uses half-resolution buffers and reuses the main pass's shadow maps. */
class EfficientGTAO extends GTAOPass {
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
  }
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const update = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      renderer.shadowMap.autoUpdate = update;
    }
  }
}

/** Targets are allocated only when optional post effects are enabled. */
export class PostEffects {
  readonly frame = new FrameState();
  buffers?: FrameBuffers;
  private temporal?: TemporalResolve;
  private volumes?: VolumePass;
  private inputWidth = 1;
  private inputHeight = 1;
  private scale = 1;
  private jitterVelocity = new THREE.Vector2();
  private screenPasses: ScreenPass[] = [];
  graphRevision = 0;
  passes: string[] = [];
  get bytes(): number {
    return (
      (this.buffers?.bytes ?? 0) +
      (this.temporal?.bytes ?? 0) +
      (this.volumes?.bytes ?? 0) +
      (this.composer ? this.inputWidth * this.inputHeight * 24 : 0)
    );
  }
  private composer?: EffectComposer;
  private ao?: GTAOPass;
  private shafts?: SunShaftPass;
  private grade?: ShaderPass;
  private fxaa?: ShaderPass;
  private signature = '';
  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private excluded: THREE.Object3D[],
    private bufferExcluded: THREE.Object3D[],
    private surfaces: SurfaceEffects,
    private ocean: Ocean,
  ) {}
  configure(settings: GraphicsSettings): void {
    const { bloom, ambientOcclusion: ao, sunShafts, lensFlare, saturation, contrast } = settings;
    const screen =
      settings.screenSpaceReflections ||
      settings.volumetricClouds ||
      settings.volumetricFog ||
      settings.depthOfField ||
      settings.motionBlur ||
      settings.temporalUpscaling ||
      settings.bufferView !== 'off';
    if (
      !bloom &&
      !ao &&
      !sunShafts &&
      !lensFlare &&
      saturation === 1 &&
      contrast === 1 &&
      !screen &&
      !settings.gpuOcclusion
    ) {
      this.dispose();
      return;
    }
    // Only changes to pass/attachment ownership rebuild the graph. Device settings
    // and effect scalars do not need new textures, shader materials or history targets.
    const signature = JSON.stringify([
      bloom,
      ao,
      sunShafts || lensFlare,
      settings.screenSpaceReflections,
      settings.volumetricClouds || settings.volumetricFog,
      settings.depthOfField,
      settings.motionBlur,
      settings.temporalUpscaling,
      settings.bufferView !== 'off',
      screen || settings.gpuOcclusion,
      screen || bloom || ao || sunShafts || lensFlare || saturation !== 1 || contrast !== 1,
    ]);
    if (signature !== this.signature) {
      this.dispose();
      this.graphRevision++;
    }
    this.signature = signature;
    this.scale = settings.temporalUpscaling ? settings.temporalScale : 1;
    if ((screen || settings.gpuOcclusion) && !this.buffers)
      this.buffers = new FrameBuffers(this.frame, this.surfaces, this.ocean);
    if (!screen && !bloom && !ao && !sunShafts && !lensFlare && saturation === 1 && contrast === 1)
      return;
    if (!this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.renderToScreen = !settings.temporalUpscaling;
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.passes = ['scene'];
      if (ao) {
        this.ao = new EfficientGTAO(this.scene, this.camera);
        this.ao.updateGtaoMaterial({ radius: 2, samples: 8 });
        this.composer.addPass(this.ao);
        this.passes.push('ambient occlusion');
      }
      if (settings.screenSpaceReflections) this.addScreen('reflections', settings);
      if (settings.volumetricClouds || settings.volumetricFog) {
        this.volumes = new VolumePass(
          this.buffers!,
          this.camera,
          settings,
          this.ocean.mesh.material.uniforms.heightMap.value,
        );
        this.composer.addPass(this.volumes);
        this.passes.push('volumetric media');
      }
      if (settings.depthOfField) this.addScreen('depth of field', settings);
      if (settings.motionBlur) this.addScreen('motion blur', settings);
      if (sunShafts || lensFlare) {
        this.shafts = new SunShaftPass(this.scene, this.camera, this.excluded);
        this.shafts.configure(sunShafts, lensFlare);
        this.composer.addPass(this.shafts);
        this.passes.push('sun shafts / flare');
      }
      if (bloom) {
        this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.4, 1.2));
        this.passes.push('bloom');
      }
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, saturation: { value: 1 }, contrast: { value: 1 } },
        vertexShader:
          'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:
          'uniform sampler2D tDiffuse;uniform float saturation,contrast;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);float l=dot(c.rgb,vec3(.2126,.7152,.0722));c.rgb=mix(vec3(l),c.rgb,saturation);c.rgb=(c.rgb-.5)*contrast+.5;gl_FragColor=c;}',
      });
      this.composer.addPass(this.grade);
      this.passes.push('tone mapping / color');
      if (settings.temporalUpscaling) {
        this.temporal = new TemporalResolve(this.frame, this.buffers!, this.camera);
        this.passes.push('temporal resolve');
      } else {
        this.fxaa = new ShaderPass(FXAAShader);
        this.composer.addPass(this.fxaa);
      }
      if (settings.bufferView !== 'off') this.addScreen('buffer view', settings);
    }
    this.grade!.uniforms.saturation.value = saturation;
    this.grade!.uniforms.contrast.value = contrast;
    this.shafts?.configure(sunShafts, lensFlare);
    this.volumes?.configure(settings);
    for (const pass of this.screenPasses) pass.configure(settings);
  }
  private addScreen(
    effect: ConstructorParameters<typeof ScreenPass>[0],
    settings: GraphicsSettings,
  ): void {
    const pass = new ScreenPass(effect, this.buffers!, this.camera, settings);
    this.composer!.addPass(pass);
    this.screenPasses.push(pass);
    this.passes.push(effect);
  }
  updateMedia(
    atmosphere: Atmosphere,
    tuning: Tuning,
    time: number,
    lights: THREE.DirectionalLight[],
    camps: THREE.PointLight[],
  ): void {
    this.volumes?.update(atmosphere, tuning, time, lights, camps);
  }
  updateSun(direction: { x: number; y: number; z: number }, sunlight: number): void {
    this.shafts?.update(direction, sunlight);
  }
  resize(width: number, height: number, ratio: number): void {
    this.inputWidth = Math.max(1, Math.floor(width * ratio * this.scale));
    this.inputHeight = Math.max(1, Math.floor(height * ratio * this.scale));
    this.composer?.setPixelRatio(1);
    this.composer?.setSize(this.inputWidth, this.inputHeight);
    this.buffers?.resize(this.inputWidth, this.inputHeight);
    this.temporal?.resize(
      Math.floor(width * ratio),
      Math.floor(height * ratio),
      this.inputWidth,
      this.inputHeight,
    );
    this.fxaa?.uniforms.resolution.value.set(1 / this.inputWidth, 1 / this.inputHeight);
    this.frame.reset('resize / settings');
  }
  begin(time: number): void {
    this.frame.begin(this.camera, this.inputWidth, this.inputHeight, !!this.temporal, time);
  }
  render(dt: number): void {
    this.jitterVelocity.copy(this.frame.previousJitter).sub(this.frame.jitter);
    this.jitterVelocity.x /= this.inputWidth;
    this.jitterVelocity.y /= this.inputHeight;
    for (const pass of this.screenPasses)
      pass.uniforms.jitterVelocity.value.copy(this.jitterVelocity);
    this.buffers?.render(this.renderer, this.scene, this.camera, this.bufferExcluded);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (this.temporal) this.temporal.render(this.renderer, this.composer!.readBuffer.texture);
  }
  end(): void {
    this.frame.end(this.camera);
  }
  dispose(): void {
    this.buffers?.dispose();
    this.buffers = undefined;
    this.temporal?.dispose();
    this.temporal = undefined;
    this.volumes = undefined;
    this.passes = [];
    this.frame.reset('render graph changed');
    this.screenPasses = [];
    this.composer?.passes.forEach((pass) => {
      pass.dispose();
      // three r186's UnrealBloomPass.dispose() leaves its high-pass material (and program) alive.
      if (pass instanceof UnrealBloomPass) pass.materialHighPassFilter.dispose();
    });
    this.composer?.dispose();
    this.ao?.gtaoMaterial.dispose();
    this.ao?.blendMaterial.dispose();
    this.ao = undefined;
    this.shafts = undefined;
    this.grade = undefined;
    this.fxaa = undefined;
    this.composer = undefined;
    this.signature = '';
  }
}
