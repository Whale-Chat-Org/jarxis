import { z } from 'zod';

/**
 * Input contracts for the emailed first-owner setup flow.
 *
 * Kept separate from `validation.ts` so the unauthenticated setup endpoints have one obvious,
 * strict place for their schemas. Unknown keys are rejected; the email is trimmed and lowercased
 * before the address itself is validated, so the value that reaches the database is already
 * normalized and matches the lowercase convention used by the `pnpm owner` CLI.
 */
export const setupInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    // Mirrors Better Auth's `minPasswordLength: 12` and its 128-character ceiling.
    password: z.string().min(12).max(128),
  })
  .strict();

export type SetupInput = z.infer<typeof setupInput>;

/** The request id is an opaque UUID handed back by `POST /api/setup`; the code is six digits. */
export const setupVerifyInput = z
  .object({
    requestId: z.uuid(),
    code: z.string().regex(/^[0-9]{6}$/, 'Code must be 6 digits'),
  })
  .strict();

export type SetupVerifyInput = z.infer<typeof setupVerifyInput>;

export const setupResendInput = z.object({ requestId: z.uuid() }).strict();

export type SetupResendInput = z.infer<typeof setupResendInput>;
