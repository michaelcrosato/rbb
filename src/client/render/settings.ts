import { z } from 'zod';
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
export function effectiveGraphics(graphics: GraphicsSettings, quality: string): GraphicsSettings {
  if (quality !== 'low') return graphics;
  return {
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
  };
}
