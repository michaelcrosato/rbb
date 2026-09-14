import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
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
import { ScreenPass } from '../../src/client/render/screen-effects';
import type { FrameBuffers } from '../../src/client/render/buffers';

describe('rendering compatibility and device fallbacks', () => {
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
