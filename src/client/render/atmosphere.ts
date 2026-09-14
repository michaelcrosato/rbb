import * as THREE from 'three';
import { celestial, createEnvironment, DEFAULT_TUNING } from '../../shared/environment';
import type { Environment, Tuning } from '../../shared/environment';
import { random } from '../../shared/math';

const vertex = `varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment = `
varying vec3 vDirection;
uniform vec3 zenith,horizon,sunDirection,moonDirection;
uniform float daylight,twilight,phase,moonSize,cloud,time,stars,volumeClouds;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){
 vec3 d=normalize(vDirection); float up=max(0.,d.y);
 vec3 color=mix(horizon,zenith,pow(up,.42));
 float sunset=pow(max(0.,dot(normalize(vec3(d.x,.12,d.z)),normalize(vec3(sunDirection.x,.12,sunDirection.z)))),5.);
 color+=vec3(.95,.22,.045)*twilight*sunset*pow(1.-up,4.);
 float sunDot=dot(d,sunDirection);
 color+=vec3(1.,.62,.22)*pow(max(sunDot,0.),64.)*.4*(1.-cloud)*smoothstep(-.06,.02,sunDirection.y);
 float disc=smoothstep(cos(.009),cos(.007),sunDot)*smoothstep(-.025,.005,sunDirection.y);
 color=mix(color,vec3(8.,5.5,2.5),disc*(1.-cloud*.85));
 vec3 right=normalize(cross(moonDirection,vec3(0,1,0))); vec3 top=cross(right,moonDirection);
 float radius=.016*moonSize;
 vec2 uv=vec2(dot(d,right),dot(d,top))/radius;
 float rr=dot(uv,uv);
 if(dot(d,moonDirection)>.99 && rr<1.){
   vec3 n=vec3(uv,sqrt(1.-rr));
   float lit=smoothstep(-.035,.035,dot(n,vec3(sin(phase*6.2831853),0.,-cos(phase*6.2831853))));
   float craters=.76+.24*noise(n*13.);
   vec3 moonColor=mix(vec3(.018,.025,.04),vec3(.85,.9,1.)*craters,lit);
   color=mix(color,moonColor,(1.-cloud*.96)*smoothstep(-.02,.02,moonDirection.y)*(1.-daylight*.92));
 }
 // A continuous overcast layer closes the gaps between the faceted cloud banks.
 float n=noise(d*9.+vec3(time*.003,0.,time*.002));
 float layer=smoothstep(1.-cloud*.85,1.,n*.65+cloud*.55)*smoothstep(-.05,.18,d.y);
 color=mix(color,mix(vec3(.015,.021,.035),vec3(.43,.48,.5),daylight),layer*.93*(1.-volumeClouds));
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

export class Atmosphere {
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly moon = new THREE.DirectionalLight('#b9cef7', 0);
  readonly horizon = new THREE.Color();
  readonly zenith = new THREE.Color();
  last = celestial(createEnvironment(), DEFAULT_TUNING);
  flash = 0;
  constructor(scene: THREE.Scene) {
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(850, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          zenith: { value: this.zenith },
          horizon: { value: this.horizon },
          sunDirection: { value: new THREE.Vector3() },
          moonDirection: { value: new THREE.Vector3() },
          daylight: { value: 1 },
          twilight: { value: 0 },
          phase: { value: 0.5 },
          moonSize: { value: 1 },
          cloud: { value: 0 },
          volumeClouds: { value: 0 },
          time: { value: 0 },
          stars: { value: 0 },
        },
      }),
    );
    this.sky.renderOrder = -20;
    this.sky.frustumCulled = false;
    const rng = random(96051),
      positions: number[] = [],
      sizes: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const y = rng() * 2 - 1,
        angle = rng() * Math.PI * 2,
        r = Math.sqrt(1 - y * y);
      positions.push(Math.sin(angle) * r * 810, y * 810, Math.cos(angle) * r * 810);
      sizes.push(0.8 + rng() * 1.7);
    }
    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    starsGeometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    this.stars = new THREE.Points(
      starsGeometry,
      new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0 }, time: { value: 0 } },
        transparent: true,
        depthWrite: false,
        vertexShader: `attribute float size; varying float alpha; uniform float time; void main(){vec4 p=modelViewMatrix*vec4(position,1.);alpha=smoothstep(-.02,.06,(modelMatrix*vec4(position,0.)).y/810.);gl_Position=projectionMatrix*p;gl_PointSize=size*(.85+.15*sin(time+position.x));}`,
        fragmentShader: `uniform float opacity;varying float alpha;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(.82,.9,1.,(1.-smoothstep(.1,.5,d))*opacity*alpha);}`,
      }),
    );
    this.stars.renderOrder = -19;
    this.stars.frustumCulled = false;
    const seeds: number[] = [];
    for (let i = 0; i < 1800; i++) seeds.push(rng(), rng(), rng());
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seeds, 3));
    this.particles = new THREE.Points(
      particleGeometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          time: { value: 0 },
          intensity: { value: 0 },
          snow: { value: 0 },
          wind: { value: new THREE.Vector2() },
          light: { value: 1 },
          underwater: { value: 0 },
        },
        vertexShader: `uniform float time,snow,underwater; uniform vec2 wind; varying float seed; void main(){seed=position.x;float speed=mix(15.,1.2,snow);vec3 p=vec3((fract(position.x+time*wind.x*.018)-.5)*42.,(fract(position.y-time*speed/24.)-.3)*24.,(fract(position.z+time*wind.y*.018)-.5)*42.);if(underwater>.5)p.y=(fract(position.y+time*.12)-.5)*14.;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((mix(160.,85.,snow)+underwater*40.)/-mv.z,1.,18.);}`,
        fragmentShader: `uniform float intensity,snow,light,underwater;varying float seed;void main(){if(seed>intensity)discard;vec2 p=gl_PointCoord-.5;float shape=mix(step(abs(p.x),.12),1.-smoothstep(.2,.5,length(p)),max(snow,underwater));gl_FragColor=vec4(vec3(.65,.78,.85)*(.18+light*.82),shape*.65);}`,
      }),
    );
    this.particles.frustumCulled = false;
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    Object.assign(this.moon.shadow.camera, {
      left: -60,
      right: 60,
      top: 60,
      bottom: -60,
      near: 1,
      far: 500,
    });
    this.moon.shadow.normalBias = 0.1;
    this.moon.shadow.bias = -0.0002;
    scene.add(this.sky, this.stars, this.particles, this.moon, this.moon.target);
  }
  update(
    e: Environment,
    tuning: Tuning,
    camera: THREE.Camera,
    sun: THREE.DirectionalLight,
    ambient: THREE.HemisphereLight,
    scene: THREE.Scene,
    seconds: number,
    mobile: boolean,
    particles: boolean,
    enabled: boolean,
  ): void {
    const c = (this.last = celestial(e, tuning)),
      weather = c.weather;
    this.horizon.set('#080e21').lerp(new THREE.Color('#b8cfce'), c.daylight);
    this.zenith.set('#030712').lerp(new THREE.Color('#669bc0'), c.daylight);
    this.horizon.lerp(
      new THREE.Color('#788b97').multiplyScalar(0.1 + c.daylight * 0.65),
      weather.cloud * 0.55,
    );
    this.zenith.lerp(this.horizon, weather.cloud * 0.55);
    const u = this.sky.material.uniforms;
    u.sunDirection.value.set(c.sun.x, c.sun.y, c.sun.z);
    u.moonDirection.value.set(c.moon.x, c.moon.y, c.moon.z);
    u.daylight.value = c.daylight;
    u.twilight.value = c.twilight;
    u.phase.value = c.phase;
    u.moonSize.value = tuning.moonSize;
    u.cloud.value = weather.cloud;
    u.time.value = seconds;
    this.sky.position.copy(camera.position);
    this.sky.visible = enabled;
    this.stars.position.copy(camera.position);
    this.stars.rotation.set((tuning.latitude * Math.PI) / 180, 0, (e.hours * Math.PI) / 12);
    this.stars.material.uniforms.opacity.value = c.stars;
    this.stars.material.uniforms.time.value = seconds;
    this.stars.visible = enabled && c.stars > 0.01;
    // Shared sky time makes storm flashes agree across clients; no damage is attached to flashes.
    const stormTime = e.weatherAge % 19;
    this.flash =
      e.weather === 'storm' &&
      weather.rain > 0.8 &&
      ((stormTime > 12 && stormTime < 12.1) || (stormTime > 12.25 && stormTime < 12.42))
        ? 0.55
        : 0;
    this.horizon.addScalar(this.flash);
    const positionLight = (
      light: THREE.DirectionalLight,
      d: { x: number; y: number; z: number },
    ) => {
      const anchor = camera.position.clone();
      anchor.y = Math.max(0, anchor.y - 1.65);
      // Snap the camera-following focus to shadow texels to reduce shimmer while walking.
      anchor.x = Math.round(anchor.x * 8) / 8;
      anchor.z = Math.round(anchor.z * 8) / 8;
      light.target.position.copy(anchor);
      light.position.copy(anchor).add(new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(200));
    };
    positionLight(sun, c.sun);
    positionLight(this.moon, c.moon);
    sun.color.set('#fff3da').lerp(new THREE.Color('#ff9c54'), c.twilight * 0.7);
    sun.intensity = c.sunlight;
    this.moon.intensity = c.moonlight;
    sun.castShadow = c.sunlight > 0.02;
    this.moon.castShadow = c.moonlight > 0.005 && c.sunlight < 0.02;
    ambient.color.set('#7285b0').lerp(this.horizon, c.daylight);
    ambient.groundColor.set('#394051').lerp(new THREE.Color('#64744f'), c.daylight);
    ambient.intensity =
      0.045 + c.daylight * 1.9 * (1 - weather.cloud * 0.28) + c.moonlight * 0.6 + this.flash * 3;
    const underwater = camera.position.y < -0.12;
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(
      underwater
        ? new THREE.Color('#17494f').multiplyScalar(0.2 + c.daylight * 0.8 + c.moonlight)
        : this.horizon,
    );
    fog.near = underwater ? 0.1 : Math.max(5, (100 * (1 - weather.fog * 0.96)) / tuning.fogDensity);
    fog.far = underwater
      ? 28
      : Math.max(45, ((mobile ? 340 : 560) * (1 - weather.fog * 0.88)) / tuning.fogDensity);
    (scene.background as THREE.Color).copy(fog.color);
    this.sky.visible &&= !underwater;
    this.stars.visible &&= !underwater;
    const pu = this.particles.material.uniforms,
      angle = (tuning.windDirection * Math.PI) / 180;
    pu.time.value = seconds;
    pu.wind.value
      .set(Math.sin(angle), Math.cos(angle))
      .multiplyScalar(weather.wind * tuning.windStrength);
    pu.snow.value = weather.snow;
    pu.underwater.value = underwater ? 1 : 0;
    pu.light.value = c.daylight + c.moonlight;
    pu.intensity.value = underwater
      ? 0.14
      : Math.max(weather.rain, weather.snow) * tuning.precipitation;
    this.particles.position.copy(camera.position);
    this.particles.visible = particles && pu.intensity.value > 0.01;
    this.particles.geometry.setDrawRange(0, mobile ? 500 : 1800);
  }
}
