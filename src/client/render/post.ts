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
  ) {}
  configure(settings: GraphicsSettings): void {
    const { bloom, ambientOcclusion: ao, sunShafts, lensFlare, saturation, contrast } = settings;
    if (!bloom && !ao && !sunShafts && !lensFlare && saturation === 1 && contrast === 1) {
      this.dispose();
      return;
    }
    const signature = [bloom, ao, sunShafts, lensFlare].join(':');
    if (signature !== this.signature) this.dispose();
    this.signature = signature;
    if (!this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      if (ao) {
        this.ao = new EfficientGTAO(this.scene, this.camera);
        this.ao.updateGtaoMaterial({ radius: 2, samples: 8 });
        this.composer.addPass(this.ao);
      }
      if (sunShafts || lensFlare) {
        this.shafts = new SunShaftPass(this.scene, this.camera, this.excluded);
        this.shafts.configure(sunShafts, lensFlare);
        this.composer.addPass(this.shafts);
      }
      if (bloom)
        this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.4, 1.2));
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, saturation: { value: 1 }, contrast: { value: 1 } },
        vertexShader:
          'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:
          'uniform sampler2D tDiffuse;uniform float saturation,contrast;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);float l=dot(c.rgb,vec3(.2126,.7152,.0722));c.rgb=mix(vec3(l),c.rgb,saturation);c.rgb=(c.rgb-.5)*contrast+.5;gl_FragColor=c;}',
      });
      this.composer.addPass(this.grade);
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    this.grade!.uniforms.saturation.value = saturation;
    this.grade!.uniforms.contrast.value = contrast;
  }
  updateSun(direction: { x: number; y: number; z: number }, sunlight: number): void {
    this.shafts?.update(direction, sunlight);
  }
  resize(width: number, height: number, ratio: number): void {
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(width, height);
    this.fxaa?.uniforms.resolution.value.set(1 / (width * ratio), 1 / (height * ratio));
  }
  render(dt: number): void {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
  dispose(): void {
    this.composer?.passes.forEach((pass) => pass.dispose());
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
