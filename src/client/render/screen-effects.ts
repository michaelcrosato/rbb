import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FrameBuffers, screenSpace, screenVertex } from './buffers';
import type { FrameState } from './frame-state';
import type { GraphicsSettings } from './settings';

export function bufferUniforms(buffers: FrameBuffers, camera: THREE.PerspectiveCamera) {
  return {
    sceneDepth: { value: buffers.depth },
    sceneNormal: { value: buffers.normal },
    sceneMotion: { value: buffers.motion },
    inverseProjection: { value: camera.projectionMatrixInverse },
    projection: { value: camera.projectionMatrix },
    inverseView: { value: camera.matrixWorld },
    texel: { value: new THREE.Vector2(1, 1) },
  };
}
export type ScreenEffect = 'reflections' | 'motion blur' | 'depth of field' | 'buffer view';
const shaders: Record<ScreenEffect, string> = {
  reflections: `
    uniform float strength;
    void main(){vec4 color=texture2D(tDiffuse,vUv);float depth=texture2D(sceneDepth,vUv).r;
      vec4 surface=texture2D(sceneNormal,vUv);float rough=surface.a;
      if(depth>=.999999||rough>.85){gl_FragColor=color;return;}
      vec3 p=viewAt(vUv,depth),n=normalize(surface.xyz*2.-1.),v=normalize(p),r=reflect(v,n);
      vec3 origin=p+n*.15;float previousDelta=0.;vec2 hit=vec2(-1.);float confidence=0.;
      for(int i=1;i<=40;i++){
        float distance=float(i)*.65+pow(float(i)/40.,2.)*30.;vec3 q=origin+r*distance;
        if(q.z>-.1)break;vec4 clip=projection*vec4(q,1.);vec2 uv=clip.xy/clip.w*.5+.5;if(outside(uv))break;
        float sd=texture2D(sceneDepth,uv).r;if(sd>=.999999){previousDelta=0.;continue;}
        float delta=-q.z-depthAt(uv);
        if(delta>0.&&delta<max(.3,distance*.045)&&previousDelta<=0.){
          vec3 other=normalize(texture2D(sceneNormal,uv).xyz*2.-1.);
          if(dot(other,r)<-.05){hit=uv;confidence=1.-float(i)/48.;break;}}
        previousDelta=delta;
      }
      if(hit.x>=0.){float edge=smoothstep(0.,.12,min(min(hit.x,hit.y),min(1.-hit.x,1.-hit.y)));
        float fresnel=.06+.94*pow(1.-max(0.,dot(-v,n)),5.);
        vec3 reflection=texture2D(tDiffuse,hit).rgb;
        color.rgb=mix(color.rgb,reflection,strength*(1.-rough)*fresnel*confidence*edge);}
      gl_FragColor=color;
    }`,
  'motion blur': `
    uniform float strength;uniform vec2 jitterVelocity;
    void main(){vec4 base=texture2D(tDiffuse,vUv),motion=texture2D(sceneMotion,vUv);
      if(motion.w>1.5){gl_FragColor=base;return;}
      vec2 velocity=clamp((motion.xy-jitterVelocity)*strength,vec2(-.035),vec2(.035));
      float depth=depthAt(vUv),weight=1.;vec3 color=base.rgb;
      for(int i=1;i<=10;i++){float t=float(i)/10.-.5;vec2 uv=vUv+velocity*t;if(outside(uv))continue;
        float w=1.-smoothstep(.1,max(.3,depth*.05),abs(depthAt(uv)-depth));
        w*=1.-step(1.5,texture2D(sceneMotion,uv).w);color+=texture2D(tDiffuse,uv).rgb*w;weight+=w;}
      gl_FragColor=vec4(color/weight,base.a);
    }`,
  'depth of field': `
    uniform float focus,aperture;
    void main(){vec4 base=texture2D(tDiffuse,vUv);float depth=depthAt(vUv);
      if(texture2D(sceneMotion,vUv).w>1.5){gl_FragColor=base;return;}
      float coc=clamp(abs(depth-focus)/max(depth,.1)*aperture,0.,.012);
      vec3 color=base.rgb;float weight=1.;
      for(int i=0;i<16;i++){float angle=float(i)*2.399963;float radius=sqrt((float(i)+.5)/16.);
        vec2 uv=vUv+vec2(cos(angle)*texel.x/texel.y,sin(angle))*coc*radius;
        if(outside(uv))continue;float other=depthAt(uv);
        float w=1.-smoothstep(.2,max(.5,depth*.08),max(0.,depth-other));
        w*=1.-step(1.5,texture2D(sceneMotion,uv).w);color+=texture2D(tDiffuse,uv).rgb*w;weight+=w;}
      gl_FragColor=vec4(color/weight,base.a);
    }`,
  'buffer view': `
    uniform float mode;
    void main(){vec3 color=texture2D(sceneNormal,vUv).rgb;
      if(mode<1.5)color=vec3(1.-exp(-depthAt(vUv)/70.));
      if(mode>2.5){vec4 m=texture2D(sceneMotion,vUv);color=vec3(.5+m.xy*15.,m.w*.5);}
      gl_FragColor=vec4(color,1.);
    }`,
};

export class ScreenPass extends ShaderPass {
  configure(settings: GraphicsSettings): void {
    this.uniforms.strength.value =
      this.effect === 'reflections' ? settings.reflectionStrength : settings.motionBlurStrength;
    this.uniforms.focus.value = settings.focusDistance;
    this.uniforms.aperture.value = settings.aperture;
    this.uniforms.mode.value = ['off', 'depth', 'normals', 'velocity'].indexOf(settings.bufferView);
  }
  constructor(
    readonly effect: ScreenEffect,
    buffers: FrameBuffers,
    camera: THREE.PerspectiveCamera,
    settings: GraphicsSettings,
  ) {
    // ShaderPass clones plain shader definitions, including camera matrices and depth
    // textures. A material retains the live, shared frame-buffer references instead.
    super(
      new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
          ...bufferUniforms(buffers, camera),
          tDiffuse: { value: null },
          strength: {
            value:
              effect === 'reflections' ? settings.reflectionStrength : settings.motionBlurStrength,
          },
          focus: { value: settings.focusDistance },
          aperture: { value: settings.aperture },
          jitterVelocity: { value: new THREE.Vector2() },
          mode: { value: ['off', 'depth', 'normals', 'velocity'].indexOf(settings.bufferView) },
        },
        vertexShader: screenVertex,
        fragmentShader: `uniform sampler2D tDiffuse;${screenSpace}${shaders[effect]}`,
      }),
    );
  }
  override setSize(width: number, height: number): void {
    this.uniforms.texel.value.set(1 / width, 1 / height);
  }
}

/** Native-output history is separate from the lower-resolution scene/composer targets. */
export class TemporalResolve {
  private history = [0, 1].map(
    () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }),
  );
  private index = 0;
  private valid = false;
  private resolve: THREE.ShaderMaterial;
  private present: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  get bytes(): number {
    return this.history[0].width * this.history[0].height * 16;
  }
  constructor(
    private frame: FrameState,
    buffers: FrameBuffers,
    camera: THREE.PerspectiveCamera,
  ) {
    this.resolve = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...bufferUniforms(buffers, camera),
        tDiffuse: { value: null },
        history: { value: null },
        valid: { value: 0 },
        jitter: { value: frame.jitter },
        previousJitter: { value: frame.previousJitter },
        previousVP: { value: frame.previousViewProjection },
        inverseVP: { value: frame.inverseViewProjection },
        nearFar: { value: new THREE.Vector2(camera.near, camera.far) },
      },
      vertexShader: screenVertex,
      fragmentShader: `
      uniform sampler2D tDiffuse,history;uniform float valid;uniform vec2 jitter,previousJitter,nearFar;uniform mat4 previousVP,inverseVP;
      ${screenSpace}
      float linearDepth(float d){return nearFar.x*nearFar.y/(nearFar.y-d*(nearFar.y-nearFar.x));}
      void main(){
        vec2 uv=clamp(vUv-jitter*texel,texel*.5,1.-texel*.5);
        vec4 current=texture2D(tDiffuse,uv),motion=texture2D(sceneMotion,uv);float d=texture2D(sceneDepth,uv).r;
        vec2 oldUV=uv-motion.xy+previousJitter*texel;float expected=linearDepth(motion.z);
        if(d>=.999999){vec4 world=inverseVP*vec4(uv*2.-1.,1.,1.);world/=world.w;vec4 old=previousVP*world;
          oldUV=old.xy/old.w*.5+.5+previousJitter*texel;expected=nearFar.y;motion.w=.6;}
        vec4 old=texture2D(history,clamp(oldUV,0.,1.));
        vec3 lo=current.rgb,hi=current.rgb;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          vec3 c=texture2D(tDiffuse,clamp(uv+vec2(x,y)*texel,texel*.5,1.-texel*.5)).rgb;lo=min(lo,c);hi=max(hi,c);}
        old.rgb=clamp(old.rgb,lo,hi);
        float weight=valid*(outside(oldUV)?0.:.9)*(1.-clamp(motion.w,0.,1.));
        weight*=1.-smoothstep(max(.08,expected*.01),max(.2,expected*.025),abs(old.a-expected));
        weight*=1.-smoothstep(.01,.08,length(motion.xy));
        gl_FragColor=vec4(mix(current.rgb,old.rgb,weight),linearDepth(d));
      }`,
    });
    this.present = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tDiffuse: { value: null } },
      vertexShader: screenVertex,
      fragmentShader:
        'uniform sampler2D tDiffuse;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(tDiffuse,vUv).rgb,1.);}',
    });
    this.quad = new FullScreenQuad(this.resolve);
  }
  resize(width: number, height: number, inputWidth: number, inputHeight: number): void {
    this.history.forEach((target) => target.setSize(width, height));
    this.valid = false;
    this.resolve.uniforms.texel.value.set(1 / inputWidth, 1 / inputHeight);
  }
  render(renderer: THREE.WebGLRenderer, texture: THREE.Texture): void {
    const output = this.history[this.index],
      old = this.history[1 - this.index];
    // Allocate/clear history before binding it as a sampler. Sampling an uninitialized
    // render-target texture makes WebGL allocate a standalone texture that cannot be retired by the target.
    if (!this.valid) {
      renderer.setRenderTarget(old);
      renderer.clear();
    }
    this.resolve.uniforms.tDiffuse.value = texture;
    this.resolve.uniforms.history.value = old.texture;
    this.resolve.uniforms.valid.value = this.valid && !this.frame.cut ? 1 : 0;
    this.quad.material = this.resolve;
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
    this.present.uniforms.tDiffuse.value = output.texture;
    this.quad.material = this.present;
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
    this.index = 1 - this.index;
    this.valid = true;
  }
  dispose(): void {
    this.history.forEach((target) => target.dispose());
    this.resolve.dispose();
    this.present.dispose();
    this.quad.dispose();
  }
}
