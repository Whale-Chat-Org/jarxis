import { z } from 'zod';

export const loginInput = z
  .object({ email: z.email(), password: z.string().min(1).max(128) })
  .strict();
export const refreshInput = z
  .object({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{64}$/) })
  .strict();
