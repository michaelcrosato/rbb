import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  ADVANCED_FEATURES,
  DEFAULT_GRAPHICS,
  effectiveGraphics,
  graphicsSchema,
} from '../../src/client/render/settings';
import { FrameState, halton } from '../../src/client/render/frame-state';
import { MaterialHooks } from '../../src/client/render/material-hooks';
import { CascadedShadows } from '../../src/client/render/cascades';
import { SurfaceEffects } from '../../src/client/render/surfaces';
import type { Ocean } from '../../src/client/render/surfaces';
import { PostEffects } from '../../src/client/render/post';
import { ScreenPass } from '../../src/client/render/screen-effects';
import type { FrameBuffers } from '../../src/client/render/buffers';

describe('rendering compatibility and device fallbacks', () => {
  it('retains graph targets for scalar/device changes and releases them when effects change', () => {
    const renderer = {
      getPixelRatio: () => 1,
      getSize: (size: THREE.Vector2) => size.set(640, 360),
    } as unknown as THREE.WebGLRenderer;
    const heightMap = new THREE.Texture();
    const ocean = {
      mesh: { material: { uniforms: { heightMap: { value: heightMap } } } },
    } as unknown as Ocean;
    const post = new PostEffects(
      renderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      [],
      [],
      new SurfaceEffects(),
      ocean,
    );
    const settings = graphicsSchema.parse({
      temporalUpscaling: true,
      volumetricFog: true,
      screenSpaceReflections: true,
    });
    post.configure(settings);
    post.resize(640, 360, 1);
    const buffers = post.buffers!;
    const revision = post.graphRevision;
    let disposed = 0;
    buffers.target.addEventListener('dispose', () => disposed++);
    post.configure({
      ...settings,
      exposure: 1.5,
      viewDistance: 0.75,
      saturation: 0.8,
      fogStrength: 1.5,
      reflectionStrength: 0.2,
    });
    post.resize(640, 360, 1);
    expect(post.buffers).toBe(buffers);
    expect(post.graphRevision).toBe(revision);
    expect(disposed).toBe(0);
    post.configure({ ...settings, motionBlur: true });
    expect(post.buffers).not.toBe(buffers);
    expect(disposed).toBe(1);
    post.configure(DEFAULT_GRAPHICS);
    expect(post.buffers).toBeUndefined();
    expect(post.passes).toEqual([]);
    expect(post.bytes).toBe(0);
    post.dispose();
    heightMap.dispose();
  });
  it('disposes the bloom high-pass material that three r186 leaves behind', () => {
    const renderer = {
      getPixelRatio: () => 1,
      getSize: (size: THREE.Vector2) => size.set(640, 360),
    } as unknown as THREE.WebGLRenderer;
    const ocean = {
      mesh: { material: { uniforms: { heightMap: { value: new THREE.Texture() } } } },
    } as unknown as Ocean;
    const post = new PostEffects(
      renderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      [],
      [],
      new SurfaceEffects(),
      ocean,
    );
    post.configure(graphicsSchema.parse({ bloom: true }));
    const { composer } = post as unknown as { composer: EffectComposer };
    const bloom = composer.passes.find((pass) => pass instanceof UnrealBloomPass)!;
    let disposed = 0;
    bloom.materialHighPassFilter.addEventListener('dispose', () => disposed++);
    post.configure(DEFAULT_GRAPHICS);
    expect(disposed).toBe(1);
    post.dispose();
  });
  it('keeps advanced features opt-in on every preset and fills old preferences', () => {
    const legacy = graphicsSchema.parse({ bloom: true, exposure: 1.2 });
    for (const tier of ['high', 'balanced', 'mobile', 'low'])
      for (const key of ADVANCED_FEATURES) {
        expect(effectiveGraphics(legacy, tier)[key]).toBe(false);
      }
    expect(legacy.bloom).toBe(true);
    expect(graphicsSchema.safeParse({ temporalScale: 0.1 }).success).toBe(false);
    expect(graphicsSchema.safeParse({ shadowCascades: 9 }).success).toBe(false);
  });
  it('suppresses costs on Low without mutating requested preferences', () => {
    const requested = graphicsSchema.parse(
      Object.fromEntries(ADVANCED_FEATURES.map((key) => [key, true])),
    );
    const low = effectiveGraphics(requested, 'low');
    for (const key of ADVANCED_FEATURES) {
      expect(low[key]).toBe(false);
      expect(requested[key]).toBe(true);
    }
    expect(effectiveGraphics(requested, 'high')).toEqual(requested);
  });
  it('preserves raster shadows and residency when float attachments are unavailable', () => {
    const requested = graphicsSchema.parse({
      ...Object.fromEntries(ADVANCED_FEATURES.map((key) => [key, true])),
      gpuTiming: true,
    });
    const actual = effectiveGraphics(requested, 'high', {
      floatTargets: false,
      multipleTargets: true,
      timerQueries: false,
      maxTextureSize: 4096,
    });
    expect(actual.cascadedShadows).toBe(true);
    expect(actual.chunkStreaming).toBe(true);
    expect(actual.temporalUpscaling).toBe(false);
    expect(actual.globalIllumination).toBe(false);
    expect(actual.gpuTiming).toBe(false);
    expect(requested.temporalUpscaling).toBe(true);
  });
});

describe('camera history', () => {
  it('shares live attachments and camera matrices instead of cloning them in ShaderPass', () => {
    const buffers = {
      depth: new THREE.DepthTexture(1, 1),
      normal: new THREE.Texture(),
      motion: new THREE.Texture(),
    } as FrameBuffers;
    const camera = new THREE.PerspectiveCamera();
    const pass = new ScreenPass('reflections', buffers, camera, DEFAULT_GRAPHICS);
    expect(pass.uniforms.sceneNormal.value).toBe(buffers.normal);
    expect(pass.uniforms.sceneDepth.value).toBe(buffers.depth);
    expect(pass.uniforms.inverseProjection.value).toBe(camera.projectionMatrixInverse);
    pass.configure({
      ...DEFAULT_GRAPHICS,
      reflectionStrength: 0.25,
      focusDistance: 30,
      aperture: 0.02,
      bufferView: 'velocity',
    });
    expect(pass.uniforms.strength.value).toBe(0.25);
    expect(pass.uniforms.focus.value).toBe(30);
    expect(pass.uniforms.aperture.value).toBe(0.02);
    expect(pass.uniforms.mode.value).toBe(3);
    pass.dispose();
    buffers.normal.dispose();
    buffers.depth.dispose();
    buffers.motion.dispose();
  });
  it('restores the unjittered camera after each frame and detects discontinuities', () => {
    const frame = new FrameState(),
      camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 950);
    const projection = camera.projectionMatrix.clone();
    frame.begin(camera, 640, 360, true, 1);
    expect(frame.cut).toBe(true);
    expect(camera.projectionMatrix.equals(projection)).toBe(false);
    frame.end(camera);
    expect(camera.projectionMatrix.equals(projection)).toBe(true);
    camera.position.x += 0.1;
    frame.begin(camera, 640, 360, true, 2);
    expect(frame.cut).toBe(false);
    frame.end(camera);
    camera.position.x += 20;
    frame.begin(camera, 640, 360, true, 3);
    expect(frame.cut).toBe(true);
    expect(frame.previousViewProjection.equals(frame.viewProjection)).toBe(true);
    frame.end(camera);
    frame.reset('world replaced');
    frame.begin(camera, 640, 360, false, 4);
    expect(frame.cut).toBe(true);
    expect(frame.resetReason).toBe('world replaced');
    frame.end(camera);
    expect(
      new Set(Array.from({ length: 16 }, (_, i) => `${halton(i + 1, 2)},${halton(i + 1, 3)}`)).size,
    ).toBe(16);
  });
});

describe('composable material adapters', () => {
  it('removes cascades without losing foliage and independent lighting hooks', () => {
    const material = new THREE.MeshStandardMaterial(),
      surfaces = new SurfaceEffects(),
      hooks = new MaterialHooks();
    surfaces.apply(material, true, 8);
    hooks.register(material);
    const retirements: boolean[] = [];
    material.addEventListener('dispose', () => retirements.push(hooks.isRecompiling(material)));
    hooks.add(material, 'test-light', (shader) => {
      shader.fragmentShader += '\n// indirect';
    });
    const cascades = new CascadedShadows(new THREE.PerspectiveCamera(), new THREE.Scene(), hooks);
    cascades.configure({ ...DEFAULT_GRAPHICS, cascadedShadows: true }, 'balanced');
    expect(cascades.lights).toHaveLength(3);
    cascades.dispose();
    const shader = {
      uniforms: {},
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <color_fragment>',
    } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('surfaceWind');
    expect(shader.fragmentShader).toContain('// indirect');
    expect(material.defines?.USE_CSM).toBeUndefined();
    expect(material.customProgramCacheKey()).toBe('rbb-surface-wind-8:test-light');
    expect(retirements).toEqual([true, true, true]);
    material.dispose();
    expect(retirements.at(-1)).toBe(false);
    expect([...hooks.materials]).toHaveLength(0);
  });
});
