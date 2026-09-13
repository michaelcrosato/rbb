import * as THREE from 'three';
import { random } from '../../shared/math';
import type { Building } from '../../shared/state';

/** One bounded particle batch for floating dust, fireflies and campfire embers. */
export class AmbientParticles extends THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  constructor() {
    const rng = random(831),
      positions: number[] = [],
      kinds: number[] = [];
    for (let i = 0; i < 512; i++) {
      positions.push(rng(), rng(), rng());
      kinds.push(i < 384 ? 0 : 1 + Math.floor((i - 384) / 32));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('kind', new THREE.Float32BufferAttribute(kinds, 1));
    super(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          time: { value: 0 },
          daylight: { value: 1 },
          camps: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
          campCount: { value: 0 },
          rain: { value: 0 },
        },
        vertexShader: `attribute float kind;uniform float time,daylight,campCount,rain;uniform vec3 camps[4];varying vec3 color;varying float alpha;
      void main(){vec3 p;float size; if(kind<.5){p=cameraPosition+vec3((fract(position.x+time*.004)-.5)*36.,(position.y-.5)*8.+sin(time*.8+position.x*20.)*.3,(fract(position.z+time*.002)-.5)*36.);alpha=(.15+(1.-daylight)*.5)*(.5+.5*sin(time*1.5+position.z*30.))*(1.-rain);color=mix(vec3(.65,1.,.15),vec3(.9,.85,.65),daylight);size=mix(45.,22.,daylight);}
      else{int i=int(kind)-1;float age=fract(position.y+time*.23);p=camps[i]+vec3((position.x-.5)*(.3+age),.5+age*2.6,(position.z-.5)*(.3+age));alpha=(1.-age)*step(kind,campCount);color=vec3(1.,.28,.035);size=30.;}
      vec4 mv=viewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(size/-mv.z,1.,7.);}`,
        fragmentShader: `varying vec3 color;varying float alpha;void main(){float glow=pow(max(0.,1.-length(gl_PointCoord-.5)*2.),2.);gl_FragColor=vec4(color,alpha*glow);}`,
      }),
    );
    this.frustumCulled = false;
  }
  update(time: number, daylight: number, rain: number, camps: Building[], mobile: boolean): void {
    this.material.uniforms.time.value = time;
    this.material.uniforms.daylight.value = daylight;
    this.material.uniforms.rain.value = rain;
    this.material.uniforms.campCount.value = Math.min(camps.length, mobile ? 1 : 4);
    const positions = this.material.uniforms.camps.value as THREE.Vector3[];
    camps.slice(0, 4).forEach((camp, i) => positions[i].set(camp.x, camp.y, camp.z));
  }
}
