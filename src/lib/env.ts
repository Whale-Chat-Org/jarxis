import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  // Brevo REST API key (xkeysib-...), not the SMTP key.
  BREVO_API_KEY: z.string().min(1),
  // Test-only override so acceptance tests can capture mail with a local Brevo stand-in.
  BREVO_API_URL: z.url().optional(),
  // Must be a sender or domain verified in Brevo, e.g. `Jarxis <noreply@example.com>`.
  MAIL_FROM: z.string().min(1),
  // Only enable behind a trusted reverse proxy that overwrites X-Real-IP.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
let cached: z.infer<typeof schema> | undefined;
export function env() {
  if (!cached) {
    const parsed = schema.parse(process.env);
    if (parsed.JWT_SECRET === parsed.BETTER_AUTH_SECRET)
      throw new Error('JWT_SECRET must differ from BETTER_AUTH_SECRET');
    cached = parsed;
  }
  return cached;
}

const avatarSchema = z.object({
  AZURE_STORAGE_CONNECTION_STRING: z.string().min(1),
  AZURE_STORAGE_CONTAINER: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/)
    .default('profile-photos'),
});
let avatarCached: z.infer<typeof avatarSchema> | undefined;

/** Parse blob credentials only when avatar storage is used, keeping unrelated auth routes usable. */
export function avatarEnv() {
  return (avatarCached ??= avatarSchema.parse(process.env));
}
