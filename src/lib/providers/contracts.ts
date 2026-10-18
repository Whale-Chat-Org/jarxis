import { z } from 'zod';
import { providerKinds } from './types';

export const modelSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  upstreamId: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  discovered: z.boolean(),
});
export const connectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(providerKinds),
  baseUrl: z.string(),
  enabled: z.boolean(),
  priority: z.number(),
  status: z.string(),
  discoveryStatus: z.string(),
  discoveryError: z.string().nullable().optional(),
  lastDiscoveredAt: z.string().nullable().optional(),
  modelStateVersion: z.string().regex(/^[a-f0-9]{64}$/),
  models: z.array(modelSchema),
});
export const gatewayKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export const providerDataSchema = z.object({
  connections: z.array(connectionSchema),
});
export const connectionResponseSchema = z.object({ connection: connectionSchema });
export const issuedKeySchema = z.object({ key: z.string() });
export type Model = z.infer<typeof modelSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type GatewayKey = z.infer<typeof gatewayKeySchema>;
export type ProviderData = z.infer<typeof providerDataSchema>;

export const gatewayKeyListSchema = z.object({
  keys: z.array(gatewayKeySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export const gatewayKeyResponseSchema = z.object({ record: gatewayKeySchema });
export const createdGatewayKeySchema = z.object({ key: z.string(), record: gatewayKeySchema });
