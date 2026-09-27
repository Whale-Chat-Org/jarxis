import 'server-only';
import { z } from 'zod';
import { APIError } from 'better-auth';
import { HttpError } from './errors';
import { env } from './env';
export function assertOrigin(req: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(env().BETTER_AUTH_URL).origin)
    throw new HttpError(403, 'ORIGIN_REJECTED', 'Origin is not allowed');
  if (req.headers.has('cookie') && !origin)
    throw new HttpError(
      403,
      'ORIGIN_REQUIRED',
      'Origin is required for cookie-authenticated mutations',
    );
}
export async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    throw new HttpError(415, 'CONTENT_TYPE', 'Expected application/json');
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'INVALID_JSON', 'Request body required');
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 16384) {
      await reader.cancel();
      throw new HttpError(413, 'TOO_LARGE', 'Request is too large');
    }
    chunks.push(value);
  }
  let json;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Invalid JSON body');
  }
  return schema.parse(json);
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function handler<TContext = unknown>(
  fn: (req: Request, context: TContext) => Promise<Response>,
) {
  return async (req: Request, context?: TContext) => {
    try {
      assertOrigin(req);
      return await fn(req, context as TContext);
    } catch (e) {
      if (e instanceof HttpError)
        return json({ error: { code: e.code, message: e.message } }, e.status);
      if (e instanceof z.ZodError)
        return json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request',
              issues: e.issues.map((i) => ({ path: i.path, message: i.message })),
            },
          },
          400,
        );
      if (e instanceof APIError)
        return json(
          {
            error: {
              code: 'AUTH_ERROR',
              message: e.statusCode === 429 ? 'Too many requests' : 'Authentication failed',
            },
          },
          e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500,
        );
      // Do not print request bodies, SQL parameters, credentials, or raw provider errors.
      console.error('Request failed', { kind: e instanceof Error ? e.name : 'UnknownError' });
      return json(
        { error: { code: 'UNAVAILABLE', message: 'Service temporarily unavailable' } },
        503,
      );
    }
  };
}
