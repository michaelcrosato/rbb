import * as THREE from 'three';
import { BALANCE, RESOURCE_TYPES } from '../../shared/content';
import type { BuildingKind, ItemId, ResourceKind } from '../../shared/content';
import { clamp, random } from '../../shared/math';
import type { Snapshot } from '../../shared/protocol';
import { resourceIsActive } from '../../shared/state';
import type { Building, GameState, PlayerState } from '../../shared/state';
import { nearbyResources } from '../../shared/world';
import type { Resource, WorldDefinition } from '../../shared/world';
import {
  boarModel,
  buildingModel,
  disposeObject,
  material,
  mesh,
  resourceGeometry,
  survivorModel,
  toolModel,
} from './models';
import { createTerrain } from './terrain';
import { BuildingBatches } from './buildings';

export type Quality = 'auto' | 'high' | 'balanced' | 'mobile';
export interface RenderSettings {
  quality: Quality;
  sensitivity: number;
  volume: number;
  fov: number;
  showStats: boolean;
}
export const DEFAULT_SETTINGS: RenderSettings = {
  quality: 'auto',
  sensitivity: 1,
  volume: 0.35,
  fov: 75,
  showStats: false,
};
interface InstanceRef {
  mesh: THREE.InstancedMesh;
  index: number;
  matrix: THREE.Matrix4;
  active: boolean;
}
export interface Target {
  id: string;
  name: string;
  action: string;
  kind: 'resource' | 'animal' | 'bag';
  resource?: Resource;
}

export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.08, 950);
  readonly worldGroup = new THREE.Group();
  readonly raycaster = new THREE.Raycaster();
  readonly sun = new THREE.DirectionalLight('#fff0cb', 2.6);
  readonly ambient = new THREE.HemisphereLight('#d4eaf0', '#79876a', 2.1);
  readonly stats = {
    fps: 60,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    pixelRatio: 1,
    quality: 'balanced',
  };
  private readonly resources = new Map<string, InstanceRef>();
  private readonly buildings = new BuildingBatches();
  private readonly cullables: {
    object: THREE.Object3D;
    center: THREE.Vector3;
    radius: number;
    kind: ResourceKind | 'terrain';
  }[] = [];
  private readonly actors = new Map<string, THREE.Group>();
  private readonly loot = new Map<string, THREE.Mesh>();
  private readonly clouds = new THREE.Group();
  private readonly water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly selection: THREE.Mesh;
  private readonly hand = new THREE.Group();
  private preview: THREE.Group | null = null;
  private previewKind: BuildingKind | null = null;
  private equipped: ItemId | null = null;
  private previousTime = 0;
  private elapsed = 0;
  private frameCount = 0;
  private frameTime = 0;
  private swing = 0;
  private settings: RenderSettings = { ...DEFAULT_SETTINGS };
  private resolution = 1;
  private maxResolution = 1;
  private stableSeconds = 0;
  private readonly resizeObserver: ResizeObserver;
  private world: WorldDefinition;

  constructor(
    readonly canvas: HTMLCanvasElement,
    world: WorldDefinition,
  ) {
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.13;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#bad5dc');
    this.scene.fog = new THREE.Fog('#bad5dc', 100, 560);
    this.scene.add(this.ambient, this.sun, this.sun.target, this.worldGroup, this.clouds);
    this.sun.position.set(-60, 110, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -60;
    this.sun.shadow.camera.right = 60;
    this.sun.shadow.camera.top = 60;
    this.sun.shadow.camera.bottom = -60;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.normalBias = 0.08;
    this.sun.shadow.bias = -0.00015;
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400, 1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          brightness: { value: 1 },
          fogColor: { value: new THREE.Color('#bad5dc') },
        },
        vertexShader:
          'varying vec3 vWorld; void main(){vec4 p=modelMatrix*vec4(position,1.0);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}',
        fragmentShader: `uniform float time; uniform float brightness; uniform vec3 fogColor; varying vec3 vWorld;
        void main(){float wave=sin(vWorld.x*.31+time*.65)*sin(vWorld.z*.26+time*.38);
        float stripe=pow(max(0.,sin(vWorld.x*.65+vWorld.z*.42+time*.8)),24.)*.16;
        vec3 col=mix(vec3(.16,.40,.43),vec3(.29,.57,.56),wave*.16+.5)+stripe;
        float fog=smoothstep(100.,560.,distance(cameraPosition,vWorld));
        gl_FragColor=vec4(mix(col*brightness,fogColor,fog),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      }),
    );
    this.water.position.y = 0;
    this.scene.add(this.water);
    this.selection = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.67, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: '#f3e8ae',
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.hand.position.set(0.45, -0.42, -0.72);
    this.camera.add(this.hand);
    this.scene.add(this.camera);
    this.makeClouds();
    this.setWorld(world);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.applySettings(this.settings);
    this.resize();
  }

  setWorld(world: WorldDefinition): void {
    for (const child of [...this.worldGroup.children]) disposeObject(child);
    this.resources.clear();
    this.buildings.reset(this.worldGroup);
    this.cullables.length = 0;
    this.actors.clear();
    this.loot.clear();
    this.world = world;
    const terrain = createTerrain(world);
    this.worldGroup.add(terrain);
    for (const object of terrain.children)
      if (object instanceof THREE.Mesh && object.geometry.boundingSphere)
        this.cullables.push({
          object,
          center: object.geometry.boundingSphere.center,
          radius: object.geometry.boundingSphere.radius,
          kind: 'terrain',
        });
    const buckets = new Map<string, Resource[]>();
    for (const resource of world.resources) {
      const key = `${resource.kind}:${Math.floor(resource.x / 64)},${Math.floor(resource.z / 64)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(resource);
    }
    const geometries = new Map<ResourceKind, THREE.BufferGeometry>();
    const propMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
    });
    const dummy = new THREE.Object3D();
    for (const resources of buckets.values()) {
      const kind = resources[0].kind;
      if (!geometries.has(kind)) geometries.set(kind, resourceGeometry(kind));
      const batch = new THREE.InstancedMesh(geometries.get(kind)!, propMaterial, resources.length);
      batch.castShadow = kind === 'tree' || kind === 'rock';
      batch.receiveShadow = kind !== 'tree';
      resources.forEach((r, index) => {
        dummy.position.set(r.x, r.y, r.z);
        dummy.rotation.set(0, r.rotation, 0);
        dummy.scale.setScalar(r.scale);
        dummy.updateMatrix();
        batch.setMatrixAt(index, dummy.matrix);
        this.resources.set(r.id, {
          mesh: batch,
          index,
          matrix: dummy.matrix.clone(),
          active: true,
        });
      });
      batch.computeBoundingSphere();
      this.cullables.push({
        object: batch,
        center: batch.boundingSphere!.center,
        radius: batch.boundingSphere!.radius,
        kind,
      });
      this.worldGroup.add(batch);
    }
    this.previousTime = 0;
  }

  private makeClouds(): void {
    const rng = random(480),
      geometry = new THREE.IcosahedronGeometry(1, 1),
      cloudMaterial = material('#f0eee0', { roughness: 1 });
    const batch = new THREE.InstancedMesh(geometry, cloudMaterial, 90),
      dummy = new THREE.Object3D();
    for (let i = 0; i < 90; i++) {
      const angle = rng() * Math.PI * 2,
        radius = 180 + rng() * 420;
      dummy.position.set(Math.sin(angle) * radius, 90 + rng() * 60, Math.cos(angle) * radius);
      dummy.scale.set(15 + rng() * 20, 3 + rng() * 6, 7 + rng() * 9);
      dummy.updateMatrix();
      batch.setMatrixAt(i, dummy.matrix);
    }
    batch.computeBoundingSphere();
    this.clouds.add(batch);
  }

  applySettings(settings: RenderSettings): void {
    this.settings = { ...settings };
    const mobile = matchMedia('(pointer: coarse)').matches;
    const tier = settings.quality === 'auto' ? (mobile ? 'mobile' : 'balanced') : settings.quality;
    this.stats.quality = tier;
    this.resolution =
      tier === 'high'
        ? Math.min(devicePixelRatio, 1.75)
        : tier === 'mobile'
          ? Math.min(devicePixelRatio, 1.15)
          : Math.min(devicePixelRatio, 1.4);
    this.maxResolution = this.resolution;
    this.stableSeconds = 0;
    this.renderer.shadowMap.enabled = tier !== 'mobile';
    this.sun.shadow.mapSize.setScalar(tier === 'high' ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth,
      height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.resolution);
    this.renderer.setSize(width, height, false);
    this.stats.pixelRatio = this.resolution;
  }

  sync(snapshot: Snapshot): void {
    for (const [id, ref] of this.resources) {
      const active = !snapshot.resources[id] || snapshot.resources[id].health > 0;
      if (ref.active !== active) {
        ref.mesh.setMatrixAt(
          ref.index,
          active ? ref.matrix : new THREE.Matrix4().makeScale(0, 0, 0),
        );
        ref.mesh.instanceMatrix.needsUpdate = true;
        ref.active = active;
      }
    }
    this.buildings.sync(snapshot.buildings);
    const actors = new Set<string>();
    for (const animal of snapshot.animals) {
      if (animal.health <= 0) continue;
      actors.add(animal.id);
      const object = this.actors.get(animal.id) ?? boarModel();
      if (!this.actors.has(animal.id)) {
        this.actors.set(animal.id, object);
        this.worldGroup.add(object);
      }
      object.position.set(animal.x, animal.y, animal.z);
      object.rotation.y = animal.yaw;
    }
    for (const player of snapshot.players) {
      if (player.health <= 0) continue;
      actors.add(player.id);
      const object = this.actors.get(player.id) ?? survivorModel();
      if (!this.actors.has(player.id)) {
        this.actors.set(player.id, object);
        this.worldGroup.add(object);
      }
      object.position.set(player.position.x, player.position.y, player.position.z);
      object.rotation.y = player.yaw + Math.PI;
    }
    for (const [id, object] of this.actors)
      if (!actors.has(id)) {
        disposeObject(object);
        this.actors.delete(id);
      }
    for (const [id, object] of this.loot)
      if (!snapshot.bags.some((b) => b.id === id)) {
        disposeObject(object);
        this.loot.delete(id);
      }
    for (const bag of snapshot.bags)
      if (!this.loot.has(bag.id)) {
        const object = mesh(
          new THREE.BoxGeometry(0.5, 0.4, 0.65),
          '#b59669',
          bag.x,
          bag.y + 0.2,
          bag.z,
        );
        this.loot.set(bag.id, object);
        this.worldGroup.add(object);
      }
    if (snapshot.self.equipped !== this.equipped) {
      this.equipped = snapshot.self.equipped;
      for (const child of [...this.hand.children]) disposeObject(child);
      this.hand.add(toolModel(snapshot.self.equipped));
    }
  }

  findTarget(state: GameState, player: PlayerState): Target | null {
    let best: Target | null = null,
      bestScore = -Infinity;
    const origin = this.camera.position,
      direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const consider = (x: number, y: number, z: number, target: Target, radius: number) => {
      const delta = new THREE.Vector3(x, y, z).sub(origin),
        dist = delta.length();
      const dot = delta.normalize().dot(direction);
      const threshold = 1 - Math.max(0.06, (radius / Math.max(dist, 1)) * 0.24);
      if (
        Math.hypot(x - player.position.x, z - player.position.z) <= BALANCE.interactRange &&
        dot > threshold &&
        dot - dist * 0.013 > bestScore
      ) {
        best = target;
        bestScore = dot - dist * 0.013;
      }
    };
    for (const r of nearbyResources(
      this.world,
      player.position.x,
      player.position.z,
      BALANCE.interactRange,
    )) {
      if (!resourceIsActive(state, r.id)) continue;
      const height = r.kind === 'tree' ? 1.5 : r.kind === 'rock' ? 0.9 : 0.5;
      consider(
        r.x,
        r.y + height,
        r.z,
        {
          id: r.id,
          name: RESOURCE_TYPES[r.kind].name,
          action:
            r.kind === 'spring'
              ? 'Drink fresh water'
              : r.kind === 'tree'
                ? 'Gather wood'
                : r.kind === 'rock'
                  ? 'Gather stone'
                  : 'Collect',
          kind: 'resource',
          resource: r,
        },
        r.kind === 'tree' ? 1.1 : 0.8,
      );
    }
    for (const animal of state.animals)
      if (animal.health > 0)
        consider(
          animal.x,
          animal.y + 0.65,
          animal.z,
          { id: animal.id, name: 'Wild boar', action: 'Attack', kind: 'animal' },
          1,
        );
    for (const bag of state.bags)
      consider(
        bag.x,
        bag.y + 0.3,
        bag.z,
        {
          id: bag.id,
          name: bag.owner === player.id ? 'Your lost pack' : 'Supply pack',
          action: 'Collect supplies',
          kind: 'bag',
        },
        0.8,
      );
    this.selection.visible = !!best;
    if (best) {
      const target = best as Target;
      const position =
        target.resource ??
        state.animals.find((a) => a.id === target.id) ??
        state.bags.find((b) => b.id === target.id)!;
      this.selection.position.set(position.x, position.y + 0.05, position.z);
      this.selection.scale.setScalar(target.resource?.kind === 'rock' ? 2 : 1);
    }
    return best;
  }

  showPreview(building: Omit<Building, 'id' | 'owner'> | null, valid: boolean): void {
    if (!building) {
      if (this.preview) this.preview.visible = false;
      return;
    }
    if (this.previewKind !== building.kind || !this.preview) {
      if (this.preview) disposeObject(this.preview);
      this.preview = buildingModel(building.kind);
      this.previewKind = building.kind;
      this.preview.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          (o.material as THREE.Material).dispose();
          o.material = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
          });
          o.castShadow = false;
        }
      });
      this.scene.add(this.preview);
    }
    this.preview.visible = true;
    this.preview.position.set(building.x, building.y, building.z);
    this.preview.rotation.y = (building.rotation * Math.PI) / 2;
    this.preview.traverse((o) => {
      if (o instanceof THREE.Mesh)
        (o.material as THREE.MeshBasicMaterial).color.set(valid ? '#bde298' : '#ef8f76');
    });
  }

  swingTool(): void {
    this.swing = 1;
  }

  render(
    time: number,
    player: PlayerState | null,
    yaw: number,
    pitch: number,
    worldTime: number,
    active: boolean,
  ): void {
    const elapsedFrame = this.previousTime
      ? Math.max(0, (time - this.previousTime) / 1000)
      : 1 / 60;
    const dt = Math.min(elapsedFrame, 0.1);
    this.previousTime = time;
    this.elapsed += dt;
    if (player) {
      const factor = 1 - Math.exp(-dt * 22);
      const desired = new THREE.Vector3(
        player.position.x,
        player.position.y + 1.65,
        player.position.z,
      );
      if (this.camera.position.distanceTo(desired) > 8) this.camera.position.copy(desired);
      else this.camera.position.lerp(desired, factor);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(pitch, yaw, 0);
      this.hand.visible = active && player.health > 0;
      const moving = active && Math.abs(player.input.forward) + Math.abs(player.input.strafe) > 0;
      this.swing = Math.max(0, this.swing - dt * 3);
      this.hand.position.y =
        -0.42 +
        (moving ? Math.sin(this.elapsed * 10) * 0.018 : 0) +
        Math.sin(this.swing * Math.PI) * 0.15;
      this.hand.rotation.x = -Math.sin(this.swing * Math.PI) * 1.3;
    } else {
      const angle = this.elapsed * 0.014;
      this.camera.position.set(142 + Math.sin(angle) * 9, 64, 219 + Math.cos(angle) * 7);
      this.camera.lookAt(-16, 12, 15);
      this.hand.visible = false;
    }
    const day = (worldTime % BALANCE.daySeconds) / BALANCE.daySeconds;
    const light = clamp(Math.sin(day * Math.PI * 2) * 0.65 + 0.52, 0.14, 1);
    const sky = new THREE.Color('#24394e').lerp(new THREE.Color('#bad5dc'), light);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.sun.intensity = light * 2.6;
    this.ambient.intensity = 0.75 + light * 1.35;
    this.sun.position.set(this.camera.position.x - 65, 110, this.camera.position.z + 30);
    this.sun.target.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.water.material.uniforms.time.value = this.elapsed;
    this.water.material.uniforms.brightness.value = 0.25 + light * 0.75;
    this.water.material.uniforms.fogColor.value.copy(sky);
    this.clouds.rotation.y = this.elapsed * 0.001;
    this.buildings.update(this.elapsed);
    const mobile = this.stats.quality === 'mobile',
      high = this.stats.quality === 'high';
    for (const c of this.cullables) {
      const range =
        c.kind === 'terrain' || c.kind === 'tree'
          ? mobile
            ? 240
            : high
              ? 560
              : 380
          : c.kind === 'rock'
            ? mobile
              ? 145
              : high
                ? 340
                : 240
            : mobile
              ? 70
              : high
                ? 160
                : 110;
      c.object.visible =
        !player ||
        Math.hypot(this.camera.position.x - c.center.x, this.camera.position.z - c.center.z) <
          range + c.radius;
    }
    this.renderer.render(this.scene, this.camera);
    this.frameCount++;
    this.frameTime += elapsedFrame;
    if (this.frameTime >= 1) {
      this.stats.fps = Math.round(this.frameCount / this.frameTime);
      this.stats.drawCalls = this.renderer.info.render.calls;
      this.stats.triangles = this.renderer.info.render.triangles;
      this.stats.geometries = this.renderer.info.memory.geometries;
      if (
        this.settings.quality === 'auto' &&
        !document.hidden &&
        this.elapsed > 5 &&
        this.stats.fps < 42 &&
        this.resolution > 0.7
      ) {
        this.resolution = Math.max(0.7, this.resolution - 0.1);
        this.resize();
      }
      this.stableSeconds =
        this.stats.fps >= 58 && !document.hidden ? this.stableSeconds + this.frameTime : 0;
      if (
        this.settings.quality === 'auto' &&
        this.stableSeconds > 12 &&
        this.resolution < this.maxResolution
      ) {
        this.resolution = Math.min(this.maxResolution, this.resolution + 0.1);
        this.stableSeconds = 0;
        this.resize();
      }
      this.frameTime = 0;
      this.frameCount = 0;
    }
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    disposeObject(this.scene);
    this.renderer.dispose();
  }
}
