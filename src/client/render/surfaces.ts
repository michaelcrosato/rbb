import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { Environment, Tuning } from '../../shared/environment';
import { weatherValues } from '../../shared/environment';
import { terrainHeight } from '../../shared/world';
import type { WorldDefinition } from '../../shared/world';
import type { TerrainUpdate } from '../../shared/terrain';
import type { Atmosphere } from './atmosphere';

export class SurfaceEffects {
  readonly uniforms = {
    surfaceTime: { value: 0 },
    surfaceWind: { value: new THREE.Vector2() },
    surfaceWet: { value: 0 },
    surfaceSnow: { value: 0 },
    surfaceDay: { value: 1 },
  };
  private vertex(
    shader: THREE.WebGLProgramParametersWithUniforms,
    wind: boolean,
    height = 8,
  ): void {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = `uniform float surfaceTime;uniform vec2 surfaceWind;varying vec3 vSurfaceWorld;varying float vSurfaceUp;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      ${
        wind
          ? `vec3 base=position;
      #ifdef USE_INSTANCING
      base=(instanceMatrix*vec4(position,1.)).xyz;
      #endif
      float bend=pow(clamp(position.y/${height.toFixed(1)},0.,1.),2.);
      transformed.xz+=surfaceWind*bend*(sin(surfaceTime*1.6+base.x*.15+base.z*.21)*.34+sin(surfaceTime*3.1+base.x*.4)*.12);`
          : ''
      }
      vec4 worldSurface=vec4(transformed,1.);
      #ifdef USE_INSTANCING
      worldSurface=instanceMatrix*worldSurface;
      #endif
      vSurfaceWorld=(modelMatrix*worldSurface).xyz;vSurfaceUp=normal.y;`,
    );
  }
  apply(material: THREE.MeshStandardMaterial, wind = false, height = 8): void {
    material.userData.rbbSurface = true;
    material.userData.rbbWindHeight = wind ? height : 0;
    material.onBeforeCompile = (shader) => {
      this.vertex(shader, wind, height);
      shader.fragmentShader = `uniform float surfaceTime,surfaceWet,surfaceSnow,surfaceDay;varying vec3 vSurfaceWorld;varying float vSurfaceUp;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      diffuseColor.rgb*=mix(1.,.68,surfaceWet);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.78,.84,.86),surfaceSnow*smoothstep(.2,.85,vSurfaceUp));
      float caustic=pow(max(0.,sin(vSurfaceWorld.x*1.9+surfaceTime)*sin(vSurfaceWorld.z*2.3-surfaceTime*.7)),8.);
      diffuseColor.rgb+=caustic*.24*surfaceDay*(1.-smoothstep(-.5,0.,vSurfaceWorld.y));`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor*=mix(1.,.42,surfaceWet);',
      );
    };
    material.customProgramCacheKey = () => `rbb-surface-${wind ? 'wind' : 'solid'}-${height}`;
  }
  depth(height = 8): THREE.MeshDepthMaterial {
    const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    material.onBeforeCompile = (shader) => this.vertex(shader, true, height);
    material.customProgramCacheKey = () => `rbb-wind-depth-${height}`;
    return material;
  }
  update(e: Environment, tuning: Tuning, time: number, wind: boolean, daylight: number): void {
    const w = weatherValues(e),
      angle = (tuning.windDirection * Math.PI) / 180;
    this.uniforms.surfaceTime.value = time;
    this.uniforms.surfaceWind.value
      .set(Math.sin(angle), Math.cos(angle))
      .multiplyScalar(wind ? (0.2 + w.wind) * tuning.windStrength : 0);
    this.uniforms.surfaceWet.value = e.wetness;
    this.uniforms.surfaceSnow.value = e.snowCover;
    this.uniforms.surfaceDay.value = daylight;
  }
}

export class Ocean {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private heightMap?: THREE.DataTexture;
  private reflector?: Reflector;
  private height = (x: number, z: number): number => terrainHeight(x, z, 0);
  private readonly changedPixels = new Set<number>();
  private segments = 192;
  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400, 192, 192).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
        uniforms: {
          heightMap: { value: null },
          reflectionMap: { value: null },
          reflectionMatrix: { value: new THREE.Matrix4() },
          reflectionWeight: { value: 0 },
          time: { value: 0 },
          wave: { value: 0.6 },
          details: { value: 1 },
          sky: { value: new THREE.Color() },
          sun: { value: new THREE.Vector3() },
          moon: { value: new THREE.Vector3() },
          sunlight: { value: 1 },
          moonlight: { value: 0 },
          daylight: { value: 1 },
          fogNear: { value: 100 },
          fogFar: { value: 560 },
          wind: { value: new THREE.Vector2() },
        },
        vertexShader: `uniform float time,wave,details;uniform sampler2D heightMap;varying vec3 vWorld;varying float vDepth;
      void main(){vec3 p=position;vec2 uv=(p.xz+320.)/640.;float ground=texture2D(heightMap,clamp(uv,0.,1.)).r*120.-40.;float inside=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);vDepth=mix(30.,max(0.,-ground),inside);
      p.y=(sin(p.x*.12+time*.8)*.55+sin(p.z*.17+time*.55)*.3)*wave*details*smoothstep(0.,5.,vDepth);
      vWorld=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
        fragmentShader: `uniform float time,wave,details,sunlight,moonlight,daylight,fogNear,fogFar,reflectionWeight;uniform sampler2D reflectionMap;uniform mat4 reflectionMatrix;uniform vec3 sky,sun,moon;uniform vec2 wind;varying vec3 vWorld;varying float vDepth;
      void main(){vec3 v=normalize(cameraPosition-vWorld);vec3 n=normalize(vec3(-cos(vWorld.x*.12+time*.8)*.066*wave,1.,-cos(vWorld.z*.17+time*.55)*.051*wave));
      n.xz+=vec2(sin(vWorld.z*1.4+time*2.+wind.x),cos(vWorld.x*1.2+time*1.3+wind.y))*.025*details;
      float fresnel=.08+.92*pow(1.-max(0.,dot(v,n)),5.);
      vec3 base=mix(vec3(.18,.46,.42),vec3(.035,.19,.24),smoothstep(0.,14.,vDepth))*(.035+daylight*.95+moonlight);
      vec3 col=mix(base,sky,fresnel*.88);
      if(reflectionWeight>.01){vec4 projected=reflectionMatrix*vec4(vWorld.x,0.,vWorld.z,1.);vec2 uv=projected.xy/projected.w+n.xz*.012*details;
      float edge=smoothstep(0.,.04,min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y)));
      col=mix(col,texture2D(reflectionMap,clamp(uv,0.,1.)).rgb,fresnel*.82*reflectionWeight*edge);}
      vec3 reflectDir=reflect(-v,n);
      col+=vec3(1.,.7,.35)*pow(max(0.,dot(reflectDir,sun)),220.)*sunlight*details;
      col+=vec3(.6,.75,1.)*pow(max(0.,dot(reflectDir,moon)),140.)*moonlight*details;
      float foam=(1.-smoothstep(.1,1.8,vDepth))*(.55+.45*sin(vWorld.x*.7+vWorld.z*.6+time*1.2));
      col=mix(col,vec3(.72,.87,.83)*(.07+daylight+moonlight),foam*.75*details);
      if(cameraPosition.y<-.12)col=mix(col,vec3(.035,.17,.19),.6);
      float fog=smoothstep(fogNear,fogFar,distance(cameraPosition,vWorld));
      gl_FragColor=vec4(mix(col,sky,fog),mix(.68,1.,smoothstep(0.,4.,vDepth)));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.userData.rbbOcean = true;
    scene.add(this.mesh);
  }
  setWorld(
    world: WorldDefinition,
    height = (x: number, z: number) => terrainHeight(x, z, world.hash),
  ): void {
    this.height = height;
    this.changedPixels.clear();
    this.heightMap?.dispose();
    const size = 256,
      data = new Uint8Array(size * size);
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++)
        data[z * size + x] = Math.round(
          THREE.MathUtils.clamp(
            (this.height((x / (size - 1)) * 640 - 320, (z / (size - 1)) * 640 - 320) + 40) / 120,
            0,
            1,
          ) * 255,
        );
    this.heightMap = new THREE.DataTexture(data, size, size, THREE.RedFormat);
    this.heightMap.minFilter = this.heightMap.magFilter = THREE.LinearFilter;
    this.heightMap.needsUpdate = true;
    this.mesh.material.uniforms.heightMap.value = this.heightMap;
  }
  updateTerrain(update: TerrainUpdate): void {
    if (!this.heightMap) return;
    const dirty = update.base === -1 ? new Set(this.changedPixels) : new Set<number>();
    for (const key of Object.keys(update.samples)) {
      const [x, , z] = key.split(',').map(Number);
      const px = Math.round(((x + 320) / 640) * 255),
        pz = Math.round(((z + 320) / 640) * 255);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (px + dx < 0 || px + dx > 255 || pz + dz < 0 || pz + dz > 255) continue;
          dirty.add((pz + dz) * 256 + px + dx);
        }
    }
    const data = this.heightMap.image.data as Uint8Array;
    for (const i of dirty) {
      data[i] = Math.round(
        THREE.MathUtils.clamp(
          (this.height(((i % 256) / 255) * 640 - 320, (Math.floor(i / 256) / 255) * 640 - 320) +
            40) /
            120,
          0,
          1,
        ) * 255,
      );
      this.changedPixels.add(i);
    }
    if (dirty.size) this.heightMap.needsUpdate = true;
  }
  setQuality(quality: string): void {
    const segments =
      quality === 'low' ? 24 : quality === 'mobile' ? 64 : quality === 'high' ? 192 : 128;
    if (segments === this.segments) return;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(2400, 2400, segments, segments).rotateX(
      -Math.PI / 2,
    );
    this.segments = segments;
  }
  configureReflections(enabled: boolean, quality: string): void {
    const size = quality === 'high' ? 1024 : quality === 'mobile' ? 256 : 512;
    if (!enabled) {
      this.reflector?.dispose();
      this.reflector?.geometry.dispose();
      this.reflector = undefined;
      this.mesh.material.uniforms.reflectionMap.value = null;
      this.mesh.material.uniforms.reflectionWeight.value = 0;
    } else {
      if (!this.reflector) {
        this.reflector = new Reflector(new THREE.PlaneGeometry(1, 1), {
          textureWidth: size,
          textureHeight: size,
          multisample: 0,
          clipBias: 0.003,
        });
        this.reflector.rotation.x = -Math.PI / 2;
        this.reflector.updateMatrixWorld();
      }
      this.reflector.getRenderTarget().setSize(size, size);
      this.mesh.material.uniforms.reflectionMap.value = this.reflector.getRenderTarget().texture;
    }
  }
  contextLost(): void {
    this.configureReflections(false, 'balanced');
    this.heightMap?.dispose();
    if (this.heightMap) this.heightMap.needsUpdate = true;
  }
  renderReflection(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    excluded: THREE.Object3D[],
  ): void {
    this.mesh.material.uniforms.reflectionWeight.value = 0;
    if (
      !this.reflector ||
      camera.position.y < 0.1 ||
      camera.position.y > 70 ||
      this.height(camera.position.x, camera.position.z) > 12
    )
      return;
    // Reflector freezes shadow updates. The first reflection must wait until the main
    // view has allocated comparison depth maps for newly enabled sun/moon/cascades.
    if (
      renderer.shadowMap.enabled &&
      scene.children.some(
        (object) =>
          object instanceof THREE.DirectionalLight && object.castShadow && !object.shadow.map,
      )
    )
      return;
    const objects = [this.mesh, ...excluded],
      visibility = objects.map((o) => o.visible);
    try {
      objects.forEach((o) => {
        o.visible = false;
      });
      // Reflector's installed implementation takes the first three mesh callback arguments.
      const render = this.reflector.onBeforeRender as (
        renderer: THREE.WebGLRenderer,
        scene: THREE.Scene,
        camera: THREE.Camera,
      ) => void;
      render.call(this.reflector, renderer, scene, camera);
      const matrix = (this.reflector.material as THREE.ShaderMaterial).uniforms.textureMatrix
        .value as THREE.Matrix4;
      this.mesh.material.uniforms.reflectionMatrix.value
        .copy(matrix)
        .multiply(this.reflector.matrixWorld.clone().invert());
      this.mesh.material.uniforms.reflectionWeight.value = 1;
    } finally {
      objects.forEach((o, i) => {
        o.visible = visibility[i];
      });
    }
  }
  update(
    atmosphere: Atmosphere,
    scene: THREE.Scene,
    tuning: Tuning,
    time: number,
    details: boolean,
  ): void {
    const u = this.mesh.material.uniforms,
      c = atmosphere.last,
      fog = scene.fog as THREE.Fog;
    u.time.value = time;
    u.wave.value = tuning.waveHeight * (0.4 + c.weather.wind * 1.5);
    u.details.value = details ? 1 : 0;
    u.sky.value.copy(fog.color);
    u.sun.value.set(c.sun.x, c.sun.y, c.sun.z);
    u.moon.value.set(c.moon.x, c.moon.y, c.moon.z);
    u.sunlight.value = c.sunlight;
    u.moonlight.value = c.moonlight;
    u.daylight.value = c.daylight;
    u.fogNear.value = fog.near;
    u.fogFar.value = fog.far;
    u.wind.value.set(tuning.windStrength, tuning.windDirection);
  }
  dispose(): void {
    this.heightMap?.dispose();
    this.configureReflections(false, 'low');
  }
}
