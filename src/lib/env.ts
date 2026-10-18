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

const azureStorageSchema = z.object({
  STORAGE_PROVIDER: z.literal('azure').default('azure'),
  AZURE_STORAGE_CONNECTION_STRING: z.string().min(1),
  AZURE_STORAGE_CONTAINER: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/)
    .default('jarxis-storage'),
});
const s3StorageSchema = z.object({
  STORAGE_PROVIDER: z.literal('s3'),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.preprocess((value) => value || undefined, z.url().optional()),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
type StorageProviderConfig = z.infer<typeof azureStorageSchema> | z.infer<typeof s3StorageSchema>;
let storageCached: StorageProviderConfig[] | undefined;

/** Detect configured backends lazily so unrelated routes work without storage credentials. */
export function storageEnv(): StorageProviderConfig[] {
  if (storageCached) return storageCached;
  const providers: StorageProviderConfig[] = [];
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    providers.push(azureStorageSchema.parse({ ...process.env, STORAGE_PROVIDER: 'azure' }));
  }
  if (process.env.S3_BUCKET) {
    providers.push(s3StorageSchema.parse({ ...process.env, STORAGE_PROVIDER: 's3' }));
  }
  if (!providers.length) throw new Error('Configure Azure Blob Storage or S3 storage');
  return (storageCached = providers);
}
