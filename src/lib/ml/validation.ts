import { z } from 'zod';
import { providerKinds } from './types';

export const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const name = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const baseUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
  }, 'Expected an HTTPS endpoint without credentials, query or fragment');
const apiKey = z
  .string()
  .trim()
  .min(1)
  .max(8192)
  .regex(/^[^\x00-\x20\x7f]+$/);
export const createConnectionSchema = z
  .object({
    name,
    provider: z.enum(providerKinds),
    baseUrl: baseUrl.optional(),
    apiKey: apiKey.optional(),
    priority: z.number().int().min(-10000).max(10000).optional(),
    manualModels: z.array(modelIdSchema).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider === 'custom' && !value.baseUrl)
      context.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'Custom providers require an endpoint',
      });
  });
export const updateConnectionSchema = z
  .object({
    name: name.optional(),
    baseUrl: baseUrl.optional(),
    apiKey: apiKey.optional(),
    priority: z.number().int().min(-10000).max(10000).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export const apiKeyProviders = ['openai', 'anthropic', 'openrouter', 'custom'] as const;
// Preview only checks a catalog; nothing in it is stored.
export const discoveryPreviewSchema = z
  .object({
    provider: z.enum(apiKeyProviders),
    baseUrl: baseUrl.optional(),
    apiKey,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider === 'custom' && !value.baseUrl)
      context.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'Custom providers require an endpoint',
      });
  });
export const manualModelSchema = z.object({ upstreamId: modelIdSchema }).strict();
export const gatewayKeySchema = z.object({ name }).strict();
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
export type DiscoveryPreviewInput = z.infer<typeof discoveryPreviewSchema>;
