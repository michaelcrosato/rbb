import { z } from 'zod';

/** Shared by save and wire validation without a dependency on either format. */
export const moveSchema = z
  .object({
    forward: z.number().finite().min(-1).max(1),
    strafe: z.number().finite().min(-1).max(1),
    yaw: z
      .number()
      .finite()
      .min(-Math.PI * 2)
      .max(Math.PI * 2),
    pitch: z.number().finite().min(-1.5).max(1.5),
    sprint: z.boolean(),
    jump: z.boolean(),
    dive: z.boolean().default(false),
  })
  .strict();
