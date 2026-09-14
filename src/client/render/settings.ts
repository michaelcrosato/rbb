import { z } from 'zod';
import type { RenderCapabilities } from './capabilities';

export const ADVANCED_FEATURES = [
  'cascadedShadows',
  'volumetricClouds',
  'volumetricFog',
  'globalIllumination',
  'screenSpaceReflections',
  'temporalUpscaling',
  'motionBlur',
  'depthOfField',
  'gpuOcclusion',
  'chunkStreaming',
] as const;
export const graphicsSchema = z
  .object({
    shadows: z.boolean().default(true),
    atmosphere: z.boolean().default(true),
    particles: z.boolean().default(true),
    wind: z.boolean().default(true),
    waterDetails: z.boolean().default(true),
    localLights: z.boolean().default(true),
    bloom: z.boolean().default(false),
    ambientOcclusion: z.boolean().default(false),
    sunShafts: z.boolean().default(false),
    lensFlare: z.boolean().default(false),
    planarReflections: z.boolean().default(false),
    ambientParticles: z.boolean().default(true),
    cascadedShadows: z.boolean().default(false),
    volumetricClouds: z.boolean().default(false),
    volumetricFog: z.boolean().default(false),
    globalIllumination: z.boolean().default(false),
    screenSpaceReflections: z.boolean().default(false),
    temporalUpscaling: z.boolean().default(false),
    motionBlur: z.boolean().default(false),
    depthOfField: z.boolean().default(false),
    gpuOcclusion: z.boolean().default(false),
    chunkStreaming: z.boolean().default(false),
    gpuTiming: z.boolean().default(false),
    effectResolution: z.number().min(0.25).max(1).default(0.5),
    volumeSteps: z.number().int().min(8).max(64).default(24),
    cloudAltitude: z.number().min(40).max(240).default(105),
    cloudThickness: z.number().min(15).max(120).default(55),
    fogStrength: z.number().min(0.1).max(3).default(1),
    giStrength: z.number().min(0).max(2).default(0.45),
    reflectionStrength: z.number().min(0).max(1).default(0.55),
    temporalScale: z.number().min(0.5).max(1).default(0.67),
    motionBlurStrength: z.number().min(0).max(1).default(0.35),
    focusDistance: z.number().min(1).max(150).default(12),
    aperture: z.number().min(0).max(0.05).default(0.012),
    shadowDistance: z.number().min(80).max(500).default(280),
    shadowCascades: z.number().int().min(2).max(4).default(3),
    streamingDistance: z.number().min(128).max(640).default(320),
    bufferView: z.enum(['off', 'depth', 'normals', 'velocity']).default('off'),
    wireframe: z.boolean().default(false),
    collisionDebug: z.boolean().default(false),
    eyeAdaptation: z.boolean().default(true),
    exposure: z.number().min(0.25).max(2.5).default(1.13),
    saturation: z.number().min(0).max(2).default(1),
    contrast: z.number().min(0.5).max(1.5).default(1),
    viewDistance: z.number().min(0.5).max(1.5).default(1),
    resolutionScale: z.number().min(0.5).max(1.5).default(1),
  })
  .strict();
export type GraphicsSettings = z.infer<typeof graphicsSchema>;
export const DEFAULT_GRAPHICS = graphicsSchema.parse({});

/** A device preset only affects presentation. It never reaches shared state. */
export function effectiveGraphics(
  graphics: GraphicsSettings,
  quality: string,
  capabilities?: RenderCapabilities,
): GraphicsSettings {
  let result = { ...graphics };
  if (quality === 'low')
    result = {
      ...graphics,
      shadows: false,
      bloom: false,
      ambientOcclusion: false,
      sunShafts: false,
      lensFlare: false,
      planarReflections: false,
      ambientParticles: false,
      waterDetails: false,
      localLights: false,
      saturation: 1,
      contrast: 1,
      resolutionScale: Math.min(1, graphics.resolutionScale),
      ...Object.fromEntries(ADVANCED_FEATURES.map((key) => [key, false])),
      bufferView: 'off',
    };
  if (capabilities && (!capabilities.floatTargets || !capabilities.multipleTargets)) {
    for (const key of [
      'volumetricClouds',
      'volumetricFog',
      'globalIllumination',
      'screenSpaceReflections',
      'temporalUpscaling',
      'motionBlur',
      'depthOfField',
      'gpuOcclusion',
      'bloom',
      'ambientOcclusion',
      'sunShafts',
      'lensFlare',
      'planarReflections',
    ] as const)
      result[key] = false;
    result.saturation = result.contrast = 1;
    result.bufferView = 'off';
  }
  if (capabilities && !capabilities.timerQueries) result.gpuTiming = false;
  return result;
}
