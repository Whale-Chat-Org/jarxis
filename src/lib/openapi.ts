import { z } from 'zod';
import { getAuth } from './auth';
import { loginInput, refreshInput } from './validation';
import { env } from './env';
const schema = (v: z.ZodType) => z.toJSONSchema(v, { io: 'input' });
export async function openapi() {
  const native = await getAuth().api.generateOpenAPISchema();
  const paths: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(native.paths)) paths[`/api/auth${path}`] = value;
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
