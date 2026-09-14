import * as THREE from 'three';
import type { FrameState } from './frame-state';
import type { SurfaceEffects, Ocean } from './surfaces';

export const screenVertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
export const screenSpace = `
uniform sampler2D sceneDepth,sceneNormal,sceneMotion;
uniform mat4 inverseProjection,projection,inverseView;
uniform vec2 texel;
varying vec2 vUv;
vec3 viewAt(vec2 uv,float depth){vec4 p=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
float depthAt(vec2 uv){return -viewAt(uv,texture2D(sceneDepth,uv).r).z;}
bool outside(vec2 uv){return any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)));}
`;

/** One geometry pass, shared by all screen effects. RGBA16F normal/roughness + motion/history mask. */
export class FrameBuffers {
  readonly target = new THREE.WebGLRenderTarget(1, 1, {
    count: 2,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  });
  private previous = new WeakMap<
    THREE.Object3D,
    { matrix: THREE.Matrix4; version: number; frame: number }
  >();
  private frame = 0;
  private material: THREE.ShaderMaterial;
  get depth(): THREE.DepthTexture {
    return this.target.depthTexture!;
  }
  get normal(): THREE.Texture {
    return this.target.textures[0];
  }
  get motion(): THREE.Texture {
    return this.target.textures[1];
  }
  get bytes(): number {
    return this.target.width * this.target.height * 20;
  }
  constructor(
    private state: FrameState,
    private surfaces: SurfaceEffects,
    private ocean: Ocean,
  ) {
    this.normal.name = 'RBB normal + roughness';
    this.motion.name = 'RBB velocity + previous depth + reactive mask';
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      uniforms: {
        previousVP: { value: state.previousViewProjection },
        previousModel: { value: new THREE.Matrix4() },
        times: { value: new THREE.Vector2() },
        wind: surfaces.uniforms.surfaceWind,
        windHeight: { value: 0 },
        roughness: { value: 1 },
        reactive: { value: 0 },
        ocean: { value: 0 },
        wave: { value: 0 },
        details: { value: 0 },
        heightMap: { value: null },
      },
      vertexShader: `
        uniform mat4 previousVP,previousModel;
        uniform vec2 times,wind;uniform float windHeight,ocean,wave,details;uniform sampler2D heightMap;
        out vec4 currentClip,previousClip;out vec3 vView,vWorld;
        vec3 deform(float time){
          vec3 p=position,base=position;
          #ifdef USE_INSTANCING
          base=(instanceMatrix*vec4(position,1.)).xyz;
          #endif
          if(windHeight>0.){float bend=pow(clamp(position.y/windHeight,0.,1.),2.);
            p.xz+=wind*bend*(sin(time*1.6+base.x*.15+base.z*.21)*.34+sin(time*3.1+base.x*.4)*.12);}
          if(ocean>.5){vec2 uv=(p.xz+320.)/640.;float ground=texture(heightMap,clamp(uv,0.,1.)).r*120.-40.;
            float inside=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
            float depth=mix(30.,max(0.,-ground),inside);
            p.y=(sin(p.x*.12+time*.8)*.55+sin(p.z*.17+time*.55)*.3)*wave*details*smoothstep(0.,5.,depth);}
          return p;
        }
        void main(){vec4 p=vec4(deform(times.x),1.),old=vec4(deform(times.y),1.);
          #ifdef USE_INSTANCING
          p=instanceMatrix*p;old=instanceMatrix*old;
          #endif
          vec4 world=modelMatrix*p;vWorld=world.xyz;vView=(viewMatrix*world).xyz;
          currentClip=projectionMatrix*vec4(vView,1.);previousClip=previousVP*previousModel*old;gl_Position=currentClip;
        }`,
      fragmentShader: `
        uniform float roughness,reactive,ocean,wave,details;uniform vec2 times;
        in vec4 currentClip,previousClip;in vec3 vView,vWorld;
        layout(location=0) out vec4 outNormal;layout(location=1) out vec4 outMotion;
        void main(){vec3 n=normalize(cross(dFdx(vView),dFdy(vView)));
          if(ocean>.5){vec3 wn=normalize(vec3(-cos(vWorld.x*.12+times.x*.8)*.066*wave,1.,-cos(vWorld.z*.17+times.x*.55)*.051*wave));
            n=normalize(mat3(viewMatrix)*wn);if(!gl_FrontFacing)n=-n;}
          vec3 now=currentClip.xyz/currentClip.w*.5+.5,old=previousClip.xyz/max(.00001,previousClip.w)*.5+.5;
          outNormal=vec4(n*.5+.5,roughness);
          outMotion=vec4(clamp(now.xy-old.xy,vec2(-1.),vec2(1.)),clamp(old.z,0.,1.),reactive);
        }`,
    });
    this.material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
      const mesh = object as THREE.Mesh;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const version = mesh instanceof THREE.InstancedMesh ? mesh.instanceMatrix.version : 0;
      const old = this.previous.get(object);
      const fresh = state.cut || !old || old.frame !== this.frame - 1;
      const u = this.material.uniforms;
      u.previousModel.value.copy(fresh ? object.matrixWorld : old.matrix);
      u.windHeight.value = mat.userData.rbbWindHeight ?? 0;
      u.roughness.value = mat instanceof THREE.MeshStandardMaterial ? mat.roughness : 1;
      if (mat.userData.rbbSurface)
        u.roughness.value *= 1 - this.surfaces.uniforms.surfaceWet.value * 0.58;
      u.reactive.value = object.userData.rbbHand
        ? 2
        : fresh || old?.version !== version || object.userData.rbbReactive
          ? 1
          : 0;
      u.ocean.value = object.userData.rbbOcean ? 1 : 0;
      if (u.ocean.value) {
        u.roughness.value = this.ocean.mesh.material.uniforms.reflectionWeight.value > 0 ? 1 : 0.12;
        u.reactive.value = 0.9;
      }
      const record = old ?? { matrix: new THREE.Matrix4(), version, frame: this.frame };
      record.matrix.copy(object.matrixWorld);
      record.version = version;
      record.frame = this.frame;
      this.previous.set(object, record);
      this.material.uniformsNeedUpdate = true;
    };
  }
  resize(width: number, height: number): void {
    this.target.setSize(Math.max(1, width), Math.max(1, height));
  }
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    excluded: THREE.Object3D[],
  ): void {
    const u = this.material.uniforms,
      water = this.ocean.mesh.material.uniforms;
    u.times.value.set(this.state.time, this.state.previousTime);
    u.wave.value = water.wave.value;
    u.details.value = water.details.value;
    u.heightMap.value = water.heightMap.value;
    const hidden = new Map<THREE.Object3D, boolean>();
    const hide = (object: THREE.Object3D) => {
      if (!hidden.has(object)) hidden.set(object, object.visible);
      object.visible = false;
    };
    excluded.forEach(hide);
    scene.traverse((object) => {
      if (
        object instanceof THREE.Points ||
        object instanceof THREE.Line ||
        object.userData.rbbExcludeBuffers
      )
        hide(object);
    });
    const target = renderer.getRenderTarget(),
      override = scene.overrideMaterial,
      background = scene.background;
    const shadows = renderer.shadowMap.autoUpdate,
      color = renderer.getClearColor(new THREE.Color()),
      alpha = renderer.getClearAlpha();
    try {
      scene.overrideMaterial = this.material;
      scene.background = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0, 1);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = override;
      scene.background = background;
      renderer.shadowMap.autoUpdate = shadows;
      renderer.setRenderTarget(target);
      renderer.setClearColor(color, alpha);
      hidden.forEach((visible, object) => {
        object.visible = visible;
      });
      this.frame++;
    }
  }
  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.previous = new WeakMap();
  }
}
