import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BALANCE,
  BUILDINGS,
  ITEMS,
  RESOURCE_TYPES,
  SITE_TYPES,
  STRUCTURE_GRADES,
  WEAPONS,
  WILDLIFE,
} from '../../shared/content';
import type { BuildingKind, ItemId, ResourceKind } from '../../shared/content';
import { random } from '../../shared/math';
import type { Snapshot } from '../../shared/protocol';
import { resourceIsActive } from '../../shared/state';
import type { BuildingPlacement, GameState, PlayerState } from '../../shared/state';
import { structureSolids, structureSignature } from '../../shared/structure-geometry';
import { isQuarry } from '../../shared/site-generation';
import { raySolid } from '../../shared/spatial';
import { siteModel } from './sites';
import { nearbyResources } from '../../shared/world';
import type { Resource, WorldDefinition } from '../../shared/world';
import {
  buildingModel,
  disposeObject,
  material,
  mesh,
  resourceGeometry,
  survivorModel,
  toolModel,
} from './models';
import { EditableTerrain } from './terrain';
import { lineOfSight } from '../../shared/physics';
import type { TerrainBrush } from '../../shared/terrain';
import { BuildingBatches } from './buildings';
import { Atmosphere } from './atmosphere';
import { Ocean, SurfaceEffects } from './surfaces';
import { PostEffects } from './post';
import { DEFAULT_GRAPHICS, effectiveGraphics } from './settings';
import type { GraphicsSettings } from './settings';
import { animateWildlife, wildlifeModel } from './wildlife';
import { createEnvironment, DEFAULT_TUNING } from '../../shared/environment';
import type { Environment, Tuning } from '../../shared/environment';
import { AmbientParticles } from './motes';
import { GpuTimer, renderCapabilities } from './capabilities';
import type { RenderCapabilities } from './capabilities';
import { MaterialHooks } from './material-hooks';
import { CascadedShadows } from './cascades';
import { IrradianceProbes } from './probes';
import { ChunkVisibility } from './visibility';

export type Quality = 'auto' | 'high' | 'balanced' | 'mobile' | 'low';
export interface RenderSettings {
  quality: Quality;
  sensitivity: number;
  volume: number;
  fov: number;
  showStats: boolean;
  graphics: GraphicsSettings;
}
export const DEFAULT_SETTINGS: RenderSettings = {
  quality: 'auto',
  sensitivity: 1,
  volume: 0.35,
  fov: 75,
  showStats: false,
  graphics: { ...DEFAULT_GRAPHICS },
};
const CLOUD_CLEAR = new THREE.Color('#eff1ef'),
  CLOUD_OVERCAST = new THREE.Color('#596872');
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
  kind: 'resource' | 'animal' | 'bag' | 'site' | 'building';
  resource?: Resource;
}

export class WorldRenderer {
  get remoteSurvivors() {
    return [...this.actors.entries()]
      .filter(([, actor]) => actor.userData.survivor)
      .map(([id, actor]) => ({
        id,
        visible: actor.visible,
        position: { x: actor.position.x, y: actor.position.y, z: actor.position.z },
        yaw: actor.rotation.y,
      }));
  }
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.08, 950);
  readonly worldGroup = new THREE.Group();
  readonly raycaster = new THREE.Raycaster();
  readonly sun = new THREE.DirectionalLight('#fff0cb', 2.6);
  readonly ambient = new THREE.HemisphereLight('#d4eaf0', '#79876a', 2.1);
  readonly capabilities: RenderCapabilities;
  private readonly timer: GpuTimer;
  private readonly hooks = new MaterialHooks();
  private readonly cascades: CascadedShadows;
  private probes?: IrradianceProbes;
  private readonly visibility: ChunkVisibility;
  get effectiveGraphics(): GraphicsSettings {
    return { ...this.graphics };
  }
  get pipeline() {
    return {
      passes: [...this.post.passes],
      graphRevision: this.post.graphRevision,
      sharedBuffer: !!this.post.buffers,
      estimatedTargetMiB: Math.round((this.post.bytes / 1048576) * 10) / 10,
      historyReset: this.post.frame.resetReason,
      capabilities: this.capabilities,
      probes: this.probes?.stats ?? null,
      visibility: this.visibility.stats,
      fallback: Object.entries(this.settings.graphics)
        .filter(([key, value]) => value !== this.graphics[key as keyof GraphicsSettings])
        .map(([key]) => key),
    };
  }
  readonly stats = {
    fps: 60,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    frameMs: 16.67,
    pixelRatio: 1,
    quality: 'balanced',
    gpuMs: null as number | null,
    gpuP95Ms: null as number | null,
  };
  private terrain!: EditableTerrain;
  get terrainRevision(): number {
    return this.terrain.revision;
  }
  get terrainDiagnostics() {
    return this.terrain.diagnostics;
  }
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
  readonly atmosphere: Atmosphere;
  private readonly ocean: Ocean;
  private readonly surfaces = new SurfaceEffects();
  private readonly post: PostEffects;
  private readonly motes = new AmbientParticles();
  private graphics = { ...DEFAULT_GRAPHICS };
  private readonly campLights = Array.from(
    { length: 4 },
    () => new THREE.PointLight('#ffae55', 0, 13, 2),
  );
  private environment: Environment = createEnvironment();
  private tuning: Tuning = { ...DEFAULT_TUNING };
  private camps: Snapshot['buildings'] = [];
  private buildingSignature = '';
  private sites = new Map<string, THREE.Group>();
  private readonly debugGroup = new THREE.Group();
  private readonly debugBounds = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial({
      color: '#efc55e',
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    }),
    2048,
  );
  private readonly selection: THREE.Mesh;
  private readonly terrainBrush = new THREE.Group();
  private readonly terrainSphere = new THREE.Group();
  private readonly terrainBox = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial({
      color: '#efd695',
      wireframe: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
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
  /** The device ratio the current cap was computed for. */
  private devicePixelRatio = 1;
  private stableSeconds = 0;
  private readonly resizeObserver: ResizeObserver;
  private world: WorldDefinition;
  private readonly contextLost = (event: Event) => {
    event.preventDefault();
    this.post.frame.reset('graphics context lost');
    this.timer.clear();
    this.visibility.contextLost();
    // Detach target/VAO disposal listeners while the old context is still lost.
    // Disposing these after Three restores its context would delete stale GL handles.
    this.post.dispose();
    this.cascades.dispose();
    this.probes?.dispose();
    this.probes = undefined;
    this.ocean.contextLost();
    // Three's geometry/instance disposal listeners capture the old GL managers.
    // Retire them now, retaining CPU arrays for restoration and later world replacement.
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points ||
        object instanceof THREE.Line
      )
        object.geometry.dispose();
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.sun.shadow.dispose();
    this.sun.shadow.map = null;
    this.atmosphere.moon.shadow.dispose();
    this.atmosphere.moon.shadow.map = null;
  };
  private readonly contextRestored = () => {
    Object.assign(this.capabilities, renderCapabilities(this.renderer));
    this.timer.restore();
    this.applySettings(this.settings);
    this.post.frame.reset('graphics context restored');
  };

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
    this.renderer.info.autoReset = false;
    this.capabilities = renderCapabilities(this.renderer);
    this.timer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.cascades = new CascadedShadows(this.camera, this.scene, this.hooks);
    this.visibility = new ChunkVisibility(this.renderer);
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
    this.sun.shadow.camera.far = 500;
    this.sun.shadow.normalBias = 0.08;
    this.sun.shadow.bias = -0.00015;
    this.atmosphere = new Atmosphere(this.scene);
    this.ocean = new Ocean(this.scene);
    this.post = new PostEffects(
      this.renderer,
      this.scene,
      this.camera,
      [
        this.atmosphere.sky,
        this.atmosphere.stars,
        this.atmosphere.particles,
        this.motes,
        this.hand,
        this.debugGroup,
      ],
      [
        this.atmosphere.sky,
        this.atmosphere.stars,
        this.atmosphere.particles,
        this.clouds,
        this.motes,
        this.debugGroup,
      ],
      this.surfaces,
      this.ocean,
    );
    this.scene.add(...this.campLights, this.debugGroup, this.motes);
    this.debugBounds.frustumCulled = false;
    this.debugGroup.add(this.debugBounds);
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
    this.selection.userData.rbbExcludeBuffers = true;
    this.scene.add(this.selection);
    for (let axis = 0; axis < 3; axis++) {
      const points = Array.from(
        { length: 64 },
        (_, i) =>
          new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2), Math.sin((i / 64) * Math.PI * 2), 0),
      );
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: '#efd695',
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        }),
      );
      if (axis === 1) ring.rotation.x = Math.PI / 2;
      if (axis === 2) ring.rotation.y = Math.PI / 2;
      this.terrainSphere.add(ring);
    }
    this.terrainBrush.add(this.terrainSphere, this.terrainBox);
    this.terrainBrush.visible = false;
    this.terrainBrush.userData.rbbExcludeBuffers = true;
    this.scene.add(this.terrainBrush);
    this.hand.position.set(0.45, -0.42, -0.72);
    this.camera.add(this.hand);
    this.scene.add(this.camera);
    this.makeClouds();
    this.setWorld(world);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.applySettings(this.settings);
    this.resize();
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
  }

  setWorld(world: WorldDefinition): void {
    this.post.dispose();
    this.probes?.dispose();
    this.probes = undefined;
    this.visibility.reset();
    for (const child of [...this.worldGroup.children]) disposeObject(child);
    this.resources.clear();
    this.buildings.reset(this.worldGroup);
    this.cullables.length = 0;
    this.actors.clear();
    this.loot.clear();
    this.sites.clear();
    this.world = world;
    for (const site of world.sites) {
      const model = siteModel(site);
      this.sites.set(site.id, model);
      this.worldGroup.add(model);
    }
    this.terrain = new EditableTerrain(world);
    this.ocean.setWorld(world, (x, z) => this.terrain.height(x, z));
    const terrain = this.terrain.group;
    this.worldGroup.add(terrain);
    const groundMaterials = new Set<THREE.MeshStandardMaterial>();
    terrain.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial)
        groundMaterials.add(o.material);
    });
    groundMaterials.forEach((m) => this.surfaces.apply(m));
    for (const object of terrain.children)
      if (object instanceof THREE.Mesh && object.geometry.boundingSphere)
        this.cullables.push({
          object,
          center: object.geometry.boundingSphere.center,
          radius: object.geometry.boundingSphere.radius,
          kind: 'terrain',
        });
    for (const chunk of this.cullables)
      chunk.object.castShadow =
        this.graphics.cascadedShadows || !!chunk.object.userData.terrainEdited;
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
      const wind = kind === 'tree' || kind === 'fiber' || kind === 'berries';
      const batchMaterial = propMaterial.clone();
      this.surfaces.apply(batchMaterial, wind, kind === 'tree' ? 8 : 1.5);
      const batch = new THREE.InstancedMesh(geometries.get(kind)!, batchMaterial, resources.length);
      if (wind) batch.customDepthMaterial = this.surfaces.depth(kind === 'tree' ? 8 : 1.5);
      batch.castShadow = RESOURCE_TYPES[kind].radius > 0;
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
    propMaterial.dispose();
    this.previousTime = 0;
    this.registerMaterials();
    this.post.configure(this.graphics);
    this.configureInfrastructure();
    this.resize();
  }

  private registerMaterials(): void {
    const register = (object: THREE.Object3D) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials)
        if (material instanceof THREE.MeshStandardMaterial && this.hooks.register(material)) {
          this.cascades.attach(material);
          this.probes?.attach(material);
        }
    };
    this.worldGroup.traverse(register);
    this.clouds.traverse(register);
    this.hand.traverse((object) => {
      object.userData.rbbHand = true;
      register(object);
    });
  }

  private configureInfrastructure(): void {
    if (this.graphics.globalIllumination) {
      this.probes ??= new IrradianceProbes(this.renderer, this.scene, this.hooks, this.world);
      this.probes.configure(this.graphics.giStrength);
    } else {
      this.probes?.dispose();
      this.probes = undefined;
    }
    this.visibility.configure(this.graphics, this.cullables);
  }

  private makeClouds(): void {
    const rng = random(480),
      geometry = mergeGeometries([
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.IcosahedronGeometry(0.7, 1).translate(0.85, -0.08, 0.1),
        new THREE.IcosahedronGeometry(0.8, 1).translate(-0.7, 0.1, -0.1),
      ]),
      cloudMaterial = material('#f0eee0', { roughness: 1 });
    cloudMaterial.userData.rbbNoGI = true;
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

  /** Highest render pixel ratio for the current tier, device ratio and resolution scale. */
  private pixelRatioCap(): number {
    this.devicePixelRatio = devicePixelRatio;
    const tier = this.stats.quality;
    const limit = tier === 'low' ? 0.8 : tier === 'high' ? 1.75 : tier === 'mobile' ? 1.15 : 1.4;
    return Math.min(devicePixelRatio, limit) * this.graphics.resolutionScale;
  }

  applySettings(settings: RenderSettings): void {
    this.settings = { ...settings };
    const mobile = matchMedia('(pointer: coarse)').matches;
    const tier = settings.quality === 'auto' ? (mobile ? 'mobile' : 'balanced') : settings.quality;
    this.stats.quality = tier;
    const graphics = (this.graphics = effectiveGraphics(
      settings.graphics,
      tier,
      this.capabilities,
    ));
    this.ocean.setQuality(tier);
    this.ocean.configureReflections(graphics.planarReflections, tier);
    this.resolution = this.maxResolution = this.pixelRatioCap();
    this.stableSeconds = 0;
    const shadows = (tier !== 'mobile' || graphics.cascadedShadows) && graphics.shadows;
    if (this.renderer.shadowMap.enabled !== shadows)
      for (const material of this.hooks.materials) material.needsUpdate = true;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.toneMappingExposure = graphics.exposure;
    this.post.configure(graphics);
    this.cascades.configure(graphics, tier);
    this.configureInfrastructure();
    for (const chunk of this.cullables)
      if (chunk.kind === 'terrain')
        chunk.object.castShadow = graphics.cascadedShadows || !!chunk.object.userData.terrainEdited;
    const shadowSize = tier === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.setScalar(shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth,
      height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const ratio = Math.min(
      this.resolution,
      this.capabilities.maxTextureSize / width,
      this.capabilities.maxTextureSize / height,
    );
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.stats.pixelRatio = ratio;
    this.post?.resize(width, height, ratio);
    this.cascades.resize();
  }

  sync(snapshot: Snapshot): void {
    if (this.terrain.update(snapshot.terrain)) {
      this.ocean.updateTerrain(snapshot.terrain!);
      this.visibility.reset();
      for (const c of this.cullables)
        if (c.kind === 'terrain' && c.object instanceof THREE.Mesh) {
          c.center = c.object.geometry.boundingSphere!.center;
          c.radius = c.object.geometry.boundingSphere!.radius;
          c.object.castShadow = this.graphics.cascadedShadows || !!c.object.userData.terrainEdited;
        }
      this.visibility.configure(this.graphics, this.cullables);
      this.post.frame.reset('terrain changed');
      this.probes?.invalidate();
    }
    if (
      Math.abs(snapshot.environment.hours - this.environment.hours) > 0.1 ||
      snapshot.environment.weather !== this.environment.weather ||
      Math.abs(snapshot.environment.wetness - this.environment.wetness) > 0.2
    ) {
      this.post.frame.reset('environment changed');
      this.probes?.invalidate();
    }
    this.environment = snapshot.environment;
    this.tuning = snapshot.tuning;
    this.camps = snapshot.buildings.filter((b) => b.kind === 'campfire');
    const buildingSignature = snapshot.buildings.map(structureSignature).join(',');
    if (buildingSignature !== this.buildingSignature) {
      this.buildingSignature = buildingSignature;
      this.post.frame.reset('construction changed');
      this.probes?.invalidate();
    }
    if (this.settings.graphics.collisionDebug) {
      const dummy = new THREE.Object3D();
      let count = 0;
      const box = (
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        depth: number,
      ) => {
        if (
          count >= 2048 ||
          Math.hypot(x - this.camera.position.x, z - this.camera.position.z) > 65
        )
          return;
        dummy.position.set(x, y + height / 2, z);
        dummy.scale.set(width, height, depth);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this.debugBounds.setMatrixAt(count++, dummy.matrix);
      };
      for (const r of this.world.resources) {
        if (
          RESOURCE_TYPES[r.kind].radius &&
          (!snapshot.resources[r.id] || snapshot.resources[r.id].health > 0)
        ) {
          const radius = RESOURCE_TYPES[r.kind].radius * r.scale + 0.33;
          box(r.x, r.y, r.z, radius * 2, r.kind === 'tree' ? 8 : 1.5 * r.scale, radius * 2);
        }
      }
      for (const b of snapshot.buildings)
        for (const s of structureSolids(b))
          box(s.x, s.y - s.height / 2, s.z, s.width, s.height, s.depth);
      for (const p of snapshot.players)
        box(p.position.x, p.position.y, p.position.z, 0.66, 1.7, 0.66);
      for (const a of snapshot.animals)
        if (a.health > 0)
          box(a.x, a.y, a.z, WILDLIFE[a.species].radius * 2, 1.3, WILDLIFE[a.species].radius * 2);
      this.debugBounds.count = count;
      this.debugBounds.instanceMatrix.needsUpdate = true;
    }
    for (const [id, ref] of this.resources) {
      const active = !snapshot.resources[id] || snapshot.resources[id].health > 0;
      if (ref.active !== active) {
        this.post.frame.reset('resource changed');
        this.probes?.invalidate();
        ref.mesh.setMatrixAt(
          ref.index,
          active ? ref.matrix : new THREE.Matrix4().makeScale(0, 0, 0),
        );
        ref.mesh.instanceMatrix.needsUpdate = true;
        ref.active = active;
      }
    }
    this.buildings.sync(snapshot.buildings);
    for (const [id, model] of this.sites) model.visible = !snapshot.sites[id]?.disabled;
    const actors = new Set<string>();
    for (const animal of snapshot.animals) {
      if (animal.health <= 0) continue;
      actors.add(animal.id);
      const object = this.actors.get(animal.id) ?? wildlifeModel(animal.species);
      if (!this.actors.has(animal.id)) {
        this.actors.set(animal.id, object);
        this.worldGroup.add(object);
      }
      const target = new THREE.Vector3(animal.x, animal.y, animal.z);
      if (!object.userData.target) object.position.copy(target);
      object.userData.speed = object.userData.target
        ? target.distanceTo(object.userData.target) * 10
        : 0;
      object.userData.target = target;
      object.userData.yaw = animal.yaw;
    }
    for (const player of snapshot.players) {
      if (player.health <= 0) continue;
      actors.add(player.id);
      const appearance = `${player.worn.armor}:${player.worn.backpack}`;
      const existing = this.actors.get(player.id);
      if (existing && existing.userData.appearance !== appearance) {
        disposeObject(existing);
        this.actors.delete(player.id);
      }
      const object = this.actors.get(player.id) ?? survivorModel(player.worn);
      object.userData.appearance = appearance;
      if (!this.actors.has(player.id)) {
        this.actors.set(player.id, object);
        this.worldGroup.add(object);
      }
      const target = new THREE.Vector3(player.position.x, player.position.y, player.position.z);
      // Smooth authoritative samples at render rate; snap respawns and large corrections.
      if (!object.userData.target || object.position.distanceTo(target) > 8) {
        object.position.copy(target);
        object.rotation.y = player.yaw + Math.PI;
      }
      object.userData.survivor = true;
      object.userData.target = target;
      object.userData.yaw = player.yaw + Math.PI;
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
    for (const bag of snapshot.bags) {
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
      this.loot.get(bag.id)!.position.set(bag.x, bag.y + 0.2, bag.z);
    }
    const equipped = snapshot.self.inventory[snapshot.self.equipped]
      ? snapshot.self.equipped
      : null;
    if (equipped !== this.equipped) {
      this.equipped = equipped;
      for (const child of [...this.hand.children]) disposeObject(child);
      if (equipped) this.hand.add(toolModel(equipped));
    }
    this.registerMaterials();
  }

  findTarget(state: GameState, player: PlayerState): Target | null {
    let best: Target | null = null,
      bestScore = -Infinity;
    const origin = this.camera.position,
      direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const consider = (
      x: number,
      y: number,
      z: number,
      target: Target,
      radius: number,
      range: number = BALANCE.interactRange,
    ) => {
      const delta = new THREE.Vector3(x, y, z).sub(origin),
        dist = delta.length();
      const dot = delta.normalize().dot(direction);
      const threshold = 1 - Math.max(0.06, (radius / Math.max(dist, 1)) * 0.24);
      if (
        Math.hypot(x - player.position.x, z - player.position.z) <= range &&
        dot > threshold &&
        dot - dist * 0.013 > bestScore &&
        lineOfSight(
          state,
          player,
          x,
          y,
          z,
          this.world,
          target.kind === 'building' || target.kind === 'site' ? target.id : undefined,
        )
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
      const height = r.kind === 'tree' ? 1.5 : RESOURCE_TYPES[r.kind].radius > 0 ? 0.9 : 0.5;
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
              : `Gather ${ITEMS[RESOURCE_TYPES[r.kind].item].name.toLowerCase()}`,
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
          { id: animal.id, name: WILDLIFE[animal.species].name, action: 'Attack', kind: 'animal' },
          1,
          player.inventory[player.equipped]
            ? (WEAPONS[player.equipped]?.range ?? BALANCE.interactRange)
            : BALANCE.interactRange,
        );
    for (const bag of state.bags)
      consider(
        bag.x,
        bag.y + 0.3,
        bag.z,
        {
          id: bag.id,
          name: bag.owner === player.id ? 'Your supplies' : 'Shared supplies',
          action: 'Collect supplies',
          kind: 'bag',
        },
        0.8,
      );
    for (const site of this.world.sites)
      if (!isQuarry(site) && !state.sites[site.id]?.disabled)
        consider(
          site.x,
          site.y + 0.5,
          site.z,
          {
            id: site.id,
            name: SITE_TYPES[site.kind].name,
            action: 'Search shared salvage',
            kind: 'site',
          },
          0.8,
        );
    for (const b of state.buildings) {
      if (Math.hypot(b.x - player.position.x, b.z - player.position.z) > BALANCE.interactRange)
        continue;
      for (const solid of structureSolids(b)) {
        const hit = raySolid(origin, direction, solid, BALANCE.interactRange + 2);
        if (hit !== null)
          consider(
            origin.x + direction.x * hit,
            origin.y + direction.y * hit,
            origin.z + direction.z * hit,
            {
              id: b.id,
              name: BUILDINGS[b.kind].name,
              action: `${STRUCTURE_GRADES[b.grade].name} · ${Math.ceil(b.health)} HP · Inspect`,
              kind: 'building',
            },
            0.3,
          );
      }
    }
    this.selection.visible = !!best;
    if (best) {
      const target = best as Target;
      const position =
        target.resource ??
        state.animals.find((a) => a.id === target.id) ??
        state.bags.find((b) => b.id === target.id) ??
        state.buildings.find((b) => b.id === target.id) ??
        this.world.sites.find((site) => site.id === target.id)!;
      this.selection.position.set(position.x, position.y + 0.05, position.z);
      this.selection.scale.setScalar(target.resource?.kind === 'rock' ? 2 : 1);
    }
    return best;
  }

  showTerrainBrush(brush: TerrainBrush | null): void {
    this.terrainBrush.visible = !!brush;
    if (!brush) return;
    this.selection.visible = false;
    this.terrainBrush.position.set(brush.x, brush.y, brush.z);
    this.terrainBrush.scale.setScalar(brush.radius);
    this.terrainSphere.visible = brush.shape === 'sphere';
    this.terrainBox.visible = brush.shape === 'box';
  }

  showPreview(building: BuildingPlacement | null, valid: boolean): void {
    if (!building) {
      if (this.preview) this.preview.visible = false;
      return;
    }
    if (this.previewKind !== building.kind || !this.preview) {
      if (this.preview) disposeObject(this.preview);
      this.preview = buildingModel(building.kind);
      this.preview.userData.rbbExcludeBuffers = true;
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
    active: boolean,
  ): void {
    if (this.renderer.getContext().isContextLost()) return;
    // Moving the window to another monitor or zooming changes the device ratio without
    // necessarily resizing the canvas, so recompute the cap rather than keep the old one.
    if (devicePixelRatio !== this.devicePixelRatio) {
      this.resolution = this.maxResolution = this.pixelRatioCap();
      this.stableSeconds = 0;
      this.resize();
    }
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
    const graphics = this.graphics;
    const mobile = this.stats.quality === 'mobile' || this.stats.quality === 'low';
    this.atmosphere.update(
      this.environment,
      this.tuning,
      this.camera,
      this.sun,
      this.ambient,
      this.scene,
      this.elapsed,
      mobile,
      graphics.particles,
      graphics.atmosphere,
    );
    if (this.stats.quality === 'low') this.atmosphere.particles.geometry.setDrawRange(0, 180);
    const targetExposure =
      graphics.exposure *
      (graphics.eyeAdaptation ? 1 + (1 - this.atmosphere.last.daylight) * 2.5 : 1);
    this.renderer.toneMappingExposure +=
      (targetExposure - this.renderer.toneMappingExposure) * (1 - Math.exp(-dt * 1.4));
    this.surfaces.update(
      this.environment,
      this.tuning,
      this.elapsed,
      graphics.wind,
      this.atmosphere.last.daylight,
    );
    if (graphics.volumetricFog && this.camera.position.y >= -0.12) {
      const fog = this.scene.fog as THREE.Fog;
      fog.near = 450;
      fog.far = 1000;
    }
    this.ocean.update(
      this.atmosphere,
      this.scene,
      this.tuning,
      this.elapsed,
      graphics.waterDetails,
    );
    this.clouds.rotation.y = this.elapsed * 0.001 * this.tuning.windStrength;
    this.clouds.visible =
      graphics.atmosphere && !graphics.volumetricClouds && this.camera.position.y > 0;
    this.atmosphere.sky.material.uniforms.volumeClouds.value = graphics.volumetricClouds ? 1 : 0;
    const cloudBatch = this.clouds.children[0] as THREE.InstancedMesh;
    cloudBatch.count = Math.round(20 + this.atmosphere.last.weather.cloud * 70);
    const cloudMaterial = cloudBatch.material as THREE.MeshStandardMaterial;
    cloudMaterial.color
      .copy(CLOUD_CLEAR)
      .lerp(CLOUD_OVERCAST, this.atmosphere.last.weather.cloud * 0.8);
    cloudMaterial.emissive
      .copy(this.atmosphere.horizon)
      .multiplyScalar(this.atmosphere.last.daylight * 0.22);
    const eye = this.camera.position;
    const campDistance = (c: { x: number; y: number; z: number }) =>
      (c.x - eye.x) ** 2 + (c.y - eye.y) ** 2 + (c.z - eye.z) ** 2;
    const nearestCamps = [...this.camps].sort((a, b) => campDistance(a) - campDistance(b));
    this.campLights.forEach((light, i) => {
      const camp = nearestCamps[i];
      light.intensity =
        graphics.localLights && camp && (i === 0 || !mobile)
          ? 12 + Math.sin(this.elapsed * 13 + i) * 1.8
          : 0;
      if (camp) light.position.set(camp.x, camp.y + 0.85, camp.z);
    });
    this.motes.visible = graphics.ambientParticles && this.camera.position.y > 0;
    this.motes.update(
      this.elapsed,
      this.atmosphere.last.daylight,
      this.atmosphere.last.weather.rain,
      nearestCamps,
      mobile,
    );
    for (const actor of this.actors.values()) {
      if (actor.userData.target) {
        actor.position.lerp(actor.userData.target, 1 - Math.exp(-dt * 15));
        const diff = Math.atan2(
          Math.sin(actor.userData.yaw - actor.rotation.y),
          Math.cos(actor.userData.yaw - actor.rotation.y),
        );
        actor.rotation.y += diff * (1 - Math.exp(-dt * 12));
        animateWildlife(actor, this.elapsed + actor.position.x, actor.userData.speed);
      }
      actor.visible =
        actor.position.distanceTo(this.camera.position) <
        (mobile ? 100 : 220) * graphics.viewDistance;
    }
    this.worldGroup.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial)
        o.material.wireframe = graphics.wireframe;
    });
    this.debugGroup.visible = graphics.collisionDebug;
    this.buildings.update(this.elapsed);
    const high = this.stats.quality === 'high';
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
          range * graphics.viewDistance + c.radius;
    }
    this.renderer.info.reset();
    this.camera.updateMatrixWorld();
    this.cascades.update(this.sun, this.atmosphere.moon);
    this.timer.begin(graphics.gpuTiming);
    if (this.camera.position.y < -0.12 !== this.post.frame.previousPosition.y < -0.12)
      this.post.frame.reset('water boundary');
    this.post.begin(this.elapsed);
    // Residency is based on real unused time, independent of animation's clamped dt.
    this.visibility.before(this.camera, elapsedFrame, this.post.frame.cut);
    this.ocean.renderReflection(this.renderer, this.scene, this.camera, [
      this.hand,
      this.atmosphere.particles,
      this.motes,
      this.debugGroup,
      this.selection,
      ...(this.preview ? [this.preview] : []),
    ]);
    this.post.updateSun(
      this.atmosphere.last.sun,
      graphics.atmosphere ? this.atmosphere.last.sunlight : 0,
    );
    this.post.updateMedia(
      this.atmosphere,
      this.tuning,
      this.elapsed,
      this.cascades.active ? this.cascades.lights : [this.sun, this.atmosphere.moon],
      this.campLights,
    );
    this.post.render(dt);
    this.visibility.after(this.camera, this.post.buffers);
    this.probes?.update(
      this.camera.position,
      dt,
      [
        this.hand,
        this.ocean.mesh,
        this.atmosphere.sky,
        this.atmosphere.stars,
        this.atmosphere.particles,
        this.clouds,
        this.motes,
        this.debugGroup,
        this.selection,
        ...(this.preview ? [this.preview] : []),
      ],
      this.cullables,
    );
    this.post.end();
    this.timer.end();
    this.frameCount++;
    // Use the clamped step so one long frame (tab switch, shader compile) cannot read as a low
    // frame rate and step the automatic resolution down.
    this.frameTime += dt;
    if (this.frameTime >= 1) {
      this.stats.fps = Math.round(this.frameCount / this.frameTime);
      this.stats.gpuMs = this.timer.milliseconds;
      this.stats.gpuP95Ms = this.timer.p95Milliseconds;
      this.stats.drawCalls = this.renderer.info.render.calls;
      this.stats.triangles = this.renderer.info.render.triangles;
      this.stats.geometries = this.renderer.info.memory.geometries;
      this.stats.textures = this.renderer.info.memory.textures;
      this.stats.programs = this.renderer.info.programs?.length ?? 0;
      this.stats.frameMs = Math.round((this.frameTime / this.frameCount) * 100000) / 100;
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
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    this.resizeObserver.disconnect();
    this.post.dispose();
    this.cascades.dispose();
    this.probes?.dispose();
    this.visibility.dispose();
    this.timer.clear();
    this.ocean.dispose();
    disposeObject(this.scene);
    this.renderer.dispose();
  }
}
