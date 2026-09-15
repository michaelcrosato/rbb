import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { Atmosphere } from './atmosphere';
import type { Tuning } from '../../shared/environment';
import type { GraphicsSettings } from './settings';
import { FrameBuffers, screenSpace, screenVertex } from './buffers';
import { bufferUniforms } from './screen-effects';
import { random } from '../../shared/math';

/** Bounded density integration through cloud slabs and terrain-relative fog. No world-ray queries. */
export class VolumePass extends Pass {
  private target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  private noise: THREE.Data3DTexture;
  private emptyShadow = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  private material: THREE.ShaderMaterial;
  private composite: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private shadows: THREE.DirectionalLight[] = [];
  get bytes(): number {
    return this.target.width * this.target.height * 8 + 32 ** 3;
  }
  constructor(
    buffers: FrameBuffers,
    private camera: THREE.PerspectiveCamera,
    private settings: GraphicsSettings,
    heightMap: THREE.Texture,
  ) {
    super();
    this.emptyShadow.compareFunction = THREE.LessEqualCompare;
    this.emptyShadow.needsUpdate = true;
    const rng = random(86139),
      data = new Uint8Array(32 ** 3);
    for (let i = 0; i < data.length; i++) data[i] = Math.floor(rng() * 256);
    this.noise = new THREE.Data3DTexture(data, 32, 32, 32);
    this.noise.format = THREE.RedFormat;
    this.noise.minFilter = this.noise.magFilter = THREE.LinearFilter;
    this.noise.wrapS = this.noise.wrapT = this.noise.wrapR = THREE.RepeatWrapping;
    this.noise.needsUpdate = true;
    const uniforms = {
      ...bufferUniforms(buffers, camera),
      noiseTex: { value: this.noise },
      heightMap: { value: heightMap },
      origin: { value: camera.position },
      lightDir: { value: new THREE.Vector3() },
      lightColor: { value: new THREE.Color() },
      ambientColor: { value: new THREE.Color() },
      wind: { value: new THREE.Vector2() },
      time: { value: 0 },
      coverage: { value: 0 },
      density: { value: 0 },
      cloudBase: { value: settings.cloudAltitude },
      thickness: { value: settings.cloudThickness },
      clouds: { value: 0 },
      fog: { value: 0 },
      steps: { value: settings.volumeSteps },
      shadowCount: { value: 0 },
      shadowMatrix: { value: Array.from({ length: 4 }, () => new THREE.Matrix4()) },
      shadow0: { value: this.emptyShadow },
      shadow1: { value: this.emptyShadow },
      shadow2: { value: this.emptyShadow },
      shadow3: { value: this.emptyShadow },
      camps: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: screenVertex,
      fragmentShader: `
      ${screenSpace}
      uniform highp sampler3D noiseTex;uniform sampler2D heightMap;
      uniform highp sampler2DShadow shadow0,shadow1,shadow2,shadow3;
      uniform mat4 shadowMatrix[4];uniform int shadowCount,steps;
      uniform vec3 origin,lightDir,lightColor,ambientColor;uniform vec2 wind;
      uniform float time,coverage,density,cloudBase,thickness,clouds,fog;uniform vec4 camps[4];
      float noise3(vec3 p){return textureLod(noiseTex,p,0.).r;}
      float cloudDensity(vec3 p){
        float h=(p.y-cloudBase)/thickness;if(h<0.||h>1.)return 0.;
        p.xz-=wind*time;float n=noise3(p*.00045)*.72+noise3(p*.0015)*.28;
        float shape=smoothstep(.65-coverage*.33,.85-coverage*.22,n);
        return shape*smoothstep(0.,.18,h)*(1.-smoothstep(.65,1.,h))*.048;
      }
      float fogDensity(vec3 p){vec2 uv=(p.xz+320.)/640.;float ground=texture2D(heightMap,clamp(uv,0.,1.)).r*120.-40.;
        return density*exp(-max(0.,p.y-max(0.,ground))/18.)*(.45+noise3(p*.018-vec3(wind.x,0.,wind.y)*time*.006));}
      float shadow(vec3 p){
        for(int i=0;i<4;i++){if(i>=shadowCount)break;vec4 q=shadowMatrix[i]*vec4(p,1.);vec3 uv=q.xyz/q.w;
          if(any(lessThan(uv,vec3(.002)))||any(greaterThan(uv,vec3(.998))))continue;
          uv.z-=.0007;float d=1.;if(i==0)d=texture(shadow0,uv);if(i==1)d=texture(shadow1,uv);
          if(i==2)d=texture(shadow2,uv);if(i==3)d=texture(shadow3,uv);
          return d;
        }return 1.;
      }
      vec4 integrate(vec3 ray,float start,float end,bool isCloud){
        if(end<=start)return vec4(0.,0.,0.,1.);
        float stepLength=(end-start)/float(steps);vec3 sum=vec3(0.);float transmission=1.;
        float phase=.35+.65*pow(max(0.,dot(ray,lightDir)),8.);
        // Stable world-space noise avoids temporal sparkling and does not need a history target.
        float jitter=noise3((origin+ray*start)*.031);
        for(int i=0;i<64;i++){if(i>=steps||transmission<.015)break;
          vec3 p=origin+ray*(start+(float(i)+jitter)*stepLength);
          float den=isCloud?cloudDensity(p):fogDensity(p);if(den<.00002)continue;
          float shade=1.;if(isCloud){float optical=0.;for(int j=1;j<=3;j++)optical+=cloudDensity(p+lightDir*float(j)*22.)*22.;shade=exp(-optical);}
          else shade=shadow(p);
          vec3 illumination=ambientColor+lightColor*shade*phase;
          if(!isCloud){for(int c=0;c<4;c++){float d=distance(p,camps[c].xyz);illumination+=vec3(1.,.38,.09)*camps[c].w/(1.+d*d)*(1.-smoothstep(0.,13.,d));}}
          float alpha=1.-exp(-den*stepLength);sum+=transmission*alpha*illumination;transmission*=1.-alpha;
        }return vec4(sum,transmission);
      }
      void main(){float d=texture2D(sceneDepth,vUv).r;vec3 view=viewAt(vUv,d),world=(inverseView*vec4(view,1.)).xyz;
        float limit=min(1100.,length(world-origin));vec3 ray=normalize(world-origin);
        vec4 cloud=vec4(0.,0.,0.,1.),mist=cloud;float cloudStart=1100.;
        if(clouds>.5&&abs(ray.y)>.0001){float a=(cloudBase-origin.y)/ray.y,b=(cloudBase+thickness-origin.y)/ray.y;
          cloudStart=max(0.,min(a,b));float end=min(limit,max(a,b));cloud=integrate(ray,cloudStart,end,true);}
        if(fog>.5)mist=integrate(ray,0.,min(limit,300.),false);
        // The fog layer stays below the cloud slab; reverse the order when looking down from above it.
        gl_FragColor=origin.y>cloudBase&&ray.y<0.?vec4(cloud.rgb+mist.rgb*cloud.a,cloud.a*mist.a):vec4(mist.rgb+cloud.rgb*mist.a,mist.a*cloud.a);
      }`,
    });
    this.composite = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...bufferUniforms(buffers, camera),
        tDiffuse: { value: null },
        volume: { value: this.target.texture },
        lowTexel: { value: new THREE.Vector2() },
      },
      vertexShader: screenVertex,
      fragmentShader: `uniform sampler2D tDiffuse,volume;uniform vec2 lowTexel;${screenSpace}
      void main(){vec4 base=texture2D(tDiffuse,vUv);float depth=depthAt(vUv);vec4 sum=vec4(0.);float weights=0.;
        vec2 grid=vUv/lowTexel-.5,cell=floor(grid),f=fract(grid);
        for(int y=0;y<2;y++)for(int x=0;x<2;x++){vec2 offset=vec2(x,y),uv=(cell+offset+.5)*lowTexel;
          float bilinear=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
          float w=bilinear/(1.+abs(depthAt(uv)-depth)*4.);sum+=texture2D(volume,uv)*w;weights+=w;}
        vec4 v=sum/max(weights,.00001);gl_FragColor=vec4(base.rgb*v.a+v.rgb,base.a);
      }`,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  update(
    atmosphere: Atmosphere,
    tuning: Tuning,
    time: number,
    lights: THREE.DirectionalLight[],
    camps: THREE.PointLight[],
  ): void {
    const u = this.material.uniforms,
      c = atmosphere.last,
      sun = c.sunlight > 0.02,
      d = sun ? c.sun : c.moon;
    u.lightDir.value.set(d.x, d.y, d.z);
    u.lightColor.value
      .set(sun ? '#ffe6c3' : '#adc7ff')
      .multiplyScalar(sun ? c.sunlight * 0.45 : c.moonlight * 0.7);
    u.ambientColor.value
      .copy(atmosphere.horizon)
      .multiplyScalar(0.3 + c.daylight * 0.55 + c.moonlight);
    u.coverage.value = c.weather.cloud;
    u.density.value =
      (0.001 + c.weather.fog * 0.032) * tuning.fogDensity * this.settings.fogStrength;
    const angle = (tuning.windDirection * Math.PI) / 180;
    u.wind.value
      .set(Math.sin(angle), Math.cos(angle))
      .multiplyScalar((0.4 + c.weather.wind) * tuning.windStrength);
    u.time.value = time;
    u.clouds.value =
      this.settings.volumetricClouds && this.settings.atmosphere && this.camera.position.y >= -0.12
        ? 1
        : 0;
    u.fog.value = this.settings.volumetricFog && this.camera.position.y >= -0.12 ? 1 : 0;
    this.shadows = lights;
    camps.forEach((light, i) =>
      u.camps.value[i].set(
        light.position.x,
        light.position.y,
        light.position.z,
        light.intensity * 0.18,
      ),
    );
  }
  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.settings.effectResolution)),
      h = Math.max(1, Math.round(height * this.settings.effectResolution));
    this.target.setSize(w, h);
    this.composite.uniforms.lowTexel.value.set(1 / w, 1 / h);
  }
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const u = this.material.uniforms;
    const lights = this.shadows.filter((light) => light.castShadow && light.shadow.map);
    u.shadowCount.value = renderer.shadowMap.enabled ? Math.min(4, lights.length) : 0;
    lights.slice(0, 4).forEach((light, i) => {
      u[`shadow${i}`].value = light.shadow.map!.depthTexture;
      u.shadowMatrix.value[i].copy(light.shadow.matrix);
    });
    // Unused slots must not keep a disposed shadow map bound; Three re-uploads bound textures.
    for (let i = lights.length; i < 4; i++) u[`shadow${i}`].value = this.emptyShadow;
    this.quad.material = this.material;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    this.composite.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.composite;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.target.dispose();
    this.noise.dispose();
    this.emptyShadow.dispose();
    this.material.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}
