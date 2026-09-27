import { z } from 'zod';

/**
 * Request validation for the routes this application still owns.
 *
 * The user/role administration schemas (`userPatch`, `roleInput`, `assignmentInput`, `listInput`)
 * were removed with the `/api/v1` administration endpoints — those requests are now validated by
 * the Better Auth admin plugin.
 */
export const loginInput = z
  .object({ email: z.email(), password: z.string().min(1).max(128) })
  .strict();
export const refreshInput = z
  .object({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{64}$/) })
  .strict();
