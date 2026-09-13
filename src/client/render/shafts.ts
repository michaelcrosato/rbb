import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Quarter-resolution silhouettes mask a bounded radial sunlight gather. */
export class SunShaftPass extends Pass {
  private readonly mask = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  private readonly black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private readonly material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tDiffuse: { value: null },
      occlusion: { value: this.mask.texture },
      source: { value: new THREE.Vector2() },
      strength: { value: 0 },
      shafts: { value: 1 },
      flare: { value: 0 },
      aspect: { value: 1 },
    },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D tDiffuse,occlusion;uniform vec2 source;uniform float strength,shafts,flare,aspect;varying vec2 vUv;
    void main(){vec4 color=texture2D(tDiffuse,vUv);vec2 p=vUv;vec2 stepUV=(source-vUv)/32.;float light=0.;
    for(int i=0;i<32;i++){p+=stepUV;vec2 d=(p-source)*vec2(aspect,1.);light+=texture2D(occlusion,p).r*exp(-dot(d,d)*240.);}
    float visibility=texture2D(occlusion,clamp(source,0.,1.)).r;
    vec2 axis=vec2(.5)-source;float ghosts=0.;
    for(int i=1;i<=3;i++){vec2 d=(vUv-(source+axis*(.5+float(i)*.6)))*vec2(aspect,1.);float r=.018+float(i)*.008;ghosts+=pow(max(0.,1.-length(d)/r),2.)*.07;}
    vec2 delta=(vUv-source)*vec2(aspect,1.);float halo=exp(-dot(delta,delta)*75.)*.2;
    color.rgb+=vec3(1.,.64,.29)*strength*(light/32.*shafts*.22+(halo+ghosts)*visibility*flare);
    gl_FragColor=color;}`,
  });
  private readonly quad = new FullScreenQuad(this.material);
  private readonly white = new THREE.Color(0xffffff);
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private excluded: THREE.Object3D[],
  ) {
    super();
  }
  configure(shafts: boolean, flare: boolean): void {
    this.enabled = shafts || flare;
    this.material.uniforms.shafts.value = shafts ? 1 : 0;
    this.material.uniforms.flare.value = flare ? 1 : 0;
  }
  update(direction: { x: number; y: number; z: number }, sunlight: number): void {
    const d = new THREE.Vector3(direction.x, direction.y, direction.z);
    const facing = this.camera.getWorldDirection(new THREE.Vector3()).dot(d);
    if (this.camera.position.y < 0 || direction.y < 0 || facing < 0.1) {
      this.material.uniforms.source.value.set(0.5, 0.5);
      this.material.uniforms.strength.value = 0;
      return;
    }
    const projected = d.multiplyScalar(500).add(this.camera.position).project(this.camera);
    this.material.uniforms.source.value.set(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5);
    this.material.uniforms.strength.value =
      sunlight *
      THREE.MathUtils.smoothstep(facing, 0.1, 0.6) *
      (1 -
        THREE.MathUtils.smoothstep(
          Math.max(Math.abs(projected.x), Math.abs(projected.y)),
          0.8,
          1.35,
        ));
  }
  override setSize(width: number, height: number): void {
    this.mask.setSize(Math.max(1, Math.round(width / 4)), Math.max(1, Math.round(height / 4)));
    this.material.uniforms.aspect.value = width / height;
  }
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    if (this.material.uniforms.strength.value > 0.001) {
      const background = this.scene.background,
        fog = this.scene.fog,
        override = this.scene.overrideMaterial;
      const shadowUpdate = renderer.shadowMap.autoUpdate;
      const visibility = this.excluded.map((o) => o.visible);
      try {
        this.excluded.forEach((o) => {
          o.visible = false;
        });
        this.scene.background = this.white;
        this.scene.fog = null;
        this.scene.overrideMaterial = this.black;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(this.mask);
        renderer.clear();
        renderer.render(this.scene, this.camera);
      } finally {
        this.excluded.forEach((o, i) => {
          o.visible = visibility[i];
        });
        this.scene.background = background;
        this.scene.fog = fog;
        this.scene.overrideMaterial = override;
        renderer.shadowMap.autoUpdate = shadowUpdate;
      }
    }
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.mask.dispose();
    this.black.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
