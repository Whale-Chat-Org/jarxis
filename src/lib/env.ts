import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MAIL_FROM: z.string().min(1).default('Jarxis <noreply@localhost>'),
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
