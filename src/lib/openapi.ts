import { z } from 'zod';
import { getAuth } from './auth';
import { isBlockedAuthPath } from './auth-paths';
import { env } from './env';
import {
  discoveryPreviewSchema,
  gatewayKeySchema,
  updateModelStatesSchema,
} from './providers/validation';
import { loginInput, refreshInput } from './validation';
const schema = (v: z.ZodType) => z.toJSONSchema(v, { io: 'input' });
export async function openapi() {
  const native = await getAuth().api.generateOpenAPISchema();
  const paths: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(native.paths)) {
    if (isBlockedAuthPath(path)) continue;
    paths[`/api/auth${path}`] = value;
  }
  const op = (summary: string, input?: z.ZodType, auth = true) => ({
    summary,
    tags: ['Administration'],
    ...(auth ? { security: [{ bearerAuth: [] }, { cookieAuth: [] }] } : { security: [] }),
    ...(input
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schema(input) } },
          },
        }
      : {}),
    responses: {
      200: { description: 'Success' },
      400: { description: 'Invalid request' },
      401: { description: 'Authentication required' },
      403: { description: 'Permission denied' },
      409: { description: 'Conflicting state' },
      429: { description: 'Rate limited' },
      503: { description: 'Dependency unavailable' },
    },
  });
  paths['/api/v1/auth/login'] = {
    post: {
      ...op('Exchange verified email/password for tokens', loginInput, false),
      tags: ['Tokens'],
    },
  };
  paths['/api/v1/auth/refresh'] = {
    post: {
      ...op('Rotate refresh token; replay revokes the session family', refreshInput, false),
      tags: ['Tokens'],
    },
  };
  paths['/api/v1/me'] = {
    get: { ...op('Resolve the caller identity from a bearer token or session cookie') },
  };
  paths['/api/v1/auth/logout'] = {
    post: {
      ...op('Revoke current API token family'),
      tags: ['Tokens'],
      security: [{ bearerAuth: [] }],
    },
  };
  const roleBody = z.object({
    name: z.string().min(2).max(64),
    description: z.string().max(500),
    permissions: z.array(z.string()),
  });
  paths['/api/admin/roles'] = {
    get: { ...op('List system and custom roles'), security: [{ cookieAuth: [] }] },
    post: {
      ...op('Create a custom role (owner session required)', roleBody),
      security: [{ cookieAuth: [] }],
    },
  };
  paths['/api/admin/roles/{key}'] = {
    patch: {
      ...op('Update a custom role (owner session required)', roleBody),
      security: [{ cookieAuth: [] }],
    },
    delete: {
      ...op('Delete an unassigned custom role (owner session required)'),
      security: [{ cookieAuth: [] }],
    },
  };
  const gatewayOperation = (summary: string, input?: z.ZodType) => ({
    ...op(summary, input),
    tags: ['Model gateway'],
    security: [{ gatewayKey: [] }],
    description:
      'Use an owner-issued application key, not a Jarxis session or JWT. Model IDs are provider-qualified. Stateless requests only; unsupported features return 400. Inference bodies are limited to 1 MiB and requests to 120 seconds. Streaming uses server-sent events.',
    responses: {
      ...op(summary).responses,
      200: { description: 'OpenAI-compatible JSON or text/event-stream when stream is true' },
      413: { description: 'Inference body exceeds 1 MiB' },
      502: { description: 'Upstream model unavailable' },
      504: { description: 'Inference deadline exceeded' },
    },
  });
  paths['/api/llm/v1/models'] = {
    get: gatewayOperation('List enabled models available in the provider pool'),
  };
  paths['/api/llm/v1/chat/completions'] = {
    post: gatewayOperation(
      'Create a chat completion with priority routing and pre-output failover',
      z
        .object({
          model: z.string(),
          messages: z.array(z.record(z.string(), z.unknown())),
          stream: z.boolean().optional(),
        })
        .passthrough(),
    ),
  };
  paths['/api/llm/v1/responses'] = {
    post: gatewayOperation(
      'Create a stateless model response',
      z
        .object({
          model: z.string(),
          input: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
          stream: z.boolean().optional(),
          store: z.literal(false).optional(),
        })
        .passthrough(),
    ),
  };
  const providerOperation = (summary: string) => ({
    ...op(summary),
    tags: ['Providers'],
    security: [{ cookieAuth: [] }],
    description:
      'Active, verified owner session required. Bearer and impersonated sessions are rejected. Mutations require same-origin protection and are limited to 16 KiB. Responses contain redacted connection metadata only.',
  });
  paths['/api/admin/providers'] = {
    get: providerOperation('List provider connections and application key metadata'),
    post: {
      ...providerOperation('Add a provider connection'),
      responses: {
        ...providerOperation('Add a provider connection').responses,
        201: {
          description:
            'Connection saved. API-key connections include the result of a bounded first discovery; an upstream discovery failure is reported in discoveryStatus, not as an error.',
        },
      },
    },
  };
  paths['/api/admin/providers/discover'] = {
    post: {
      ...providerOperation('Preview an API-key provider model catalog without saving it'),
      requestBody: {
        required: true,
        content: { 'application/json': { schema: schema(discoveryPreviewSchema) } },
      },
      description:
        'Requires providers:manage. Accepts openai, anthropic, openrouter or custom with an API key; custom requires an HTTPS baseUrl. The key is used for one bounded catalog request (15 seconds total, 2 MiB per page, 20 pages, 5000 models) to a public HTTPS destination without redirects, and is never stored or logged. Returns { discovery: { status: ok | unsupported | failed, models: [{ id, name }], error } }. Saving a connection discovers again server-side; preview results are not accepted as input.',
    },
  };
  paths['/api/admin/providers/{id}'] = {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    patch: providerOperation('Update a connection, credentials, or priority'),
    delete: providerOperation('Delete a provider connection'),
  };
  paths['/api/admin/providers/{id}/refresh'] = {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: providerOperation('Schedule model discovery'),
  };
  paths['/api/admin/providers/{id}/models'] = {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: providerOperation('Add an explicit model ID'),
    patch: {
      ...providerOperation('Save model availability and connection settings'),
      requestBody: {
        required: true,
        content: { 'application/json': { schema: schema(updateModelStatesSchema) } },
      },
      description:
        'Requires providers:manage. Send the modelStateVersion from the connection listing as version. Sort models by ID, then pack enabled flags as least-significant-bit-first bytes and encode as unpadded base64url in states. Optional connection fields save in the same transaction. A changed model catalog or concurrent model edit returns 409 MODEL_CATALOG_CHANGED; reload models before retrying. Each changed model is audited. Credentials are never returned.',
    },
  };
  paths['/api/admin/providers/keys'] = {
    get: {
      ...providerOperation('List API key metadata'),
      description:
        'Requires providers:read and a direct owner browser session. Returns { keys, total, page, pageSize }. Metadata includes createdAt, lastUsedAt and revokedAt; never returns key hashes or full keys.',
      parameters: [
        {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 },
        },
        {
          name: 'pageSize',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } },
        {
          name: 'searchField',
          in: 'query',
          schema: { type: 'string', enum: ['name', 'prefix'], default: 'name' },
        },
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: ['all', 'active', 'revoked'], default: 'all' },
        },
        {
          name: 'sortDirection',
          in: 'query',
          schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      ],
    },
    post: providerOperation('Issue an application key; reveal its value once'),
  };
  paths['/api/admin/providers/keys/{keyId}'] = {
    parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }],
    get: {
      ...providerOperation('Read API key metadata'),
      description:
        'Requires providers:read and a direct owner browser session. Returns { record } with metadata only. Missing keys return 404.',
    },
    patch: {
      ...providerOperation('Rename an active API key'),
      requestBody: {
        required: true,
        content: { 'application/json': { schema: schema(gatewayKeySchema) } },
      },
      description:
        'Requires providers:manage and a direct owner browser session. Changes only the name and writes an atomic providers:key:rename audit event. Returns { record }; revoked keys return 409 API_KEY_REVOKED.',
    },
    delete: providerOperation('Revoke an application key'),
  };
  return {
    ...native,
    openapi: '3.1.1',
    info: {
      title: 'Jarxis API',
      version: '1.0.0',
      description:
        'Cookie sessions for the web application. Direct login and rotating bearer tokens for API clients. Permissions are checked against current database state.',
    },
    servers: [{ url: new URL(env().BETTER_AUTH_URL).origin }],
    paths,
    components: {
      ...native.components,
      securitySchemes: {
        ...native.components?.securitySchemes,
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        gatewayKey: { type: 'http', scheme: 'bearer', bearerFormat: 'Jarxis application key' },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name:
            env().NODE_ENV === 'production'
              ? '__Secure-better-auth.session_token'
              : 'better-auth.session_token',
        },
      },
    },
  };
}
