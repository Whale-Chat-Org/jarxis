import { APIError } from 'better-auth';
import 'server-only';
import { z } from 'zod';
import { readBoundedBody } from './bounded-body';
import { env } from './env';
import { HttpError } from './errors';
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
  if (!req.body) throw new HttpError(400, 'INVALID_JSON', 'Request body required');
  const bytes = await readBoundedBody(req.body, 16384, {
    tooLarge: () => new HttpError(413, 'TOO_LARGE', 'Request is too large'),
  });
  let json;
  try {
    json = JSON.parse(bytes.toString());
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Invalid JSON body');
  }
  return schema.parse(json);
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function handler(
  fn: (req: Request, context: unknown) => Promise<Response>,
): (req: Request, context?: unknown) => Promise<Response>;
export function handler<TContext>(
  fn: (req: Request, context: TContext) => Promise<Response>,
): (req: Request, context: TContext) => Promise<Response>;
export function handler<TContext = unknown>(
  fn: (req: Request, context: TContext) => Promise<Response>,
) {
  return async (req: Request, context?: TContext) => {
    try {
      assertOrigin(req);
      return await fn(req, context as TContext);
    } catch (e) {
      if (e instanceof HttpError)
        return json(
          {
            error: {
              code: e.code,
              message: e.message,
              ...(e.code === 'ROLE_IN_USE' &&
              Number.isSafeInteger(e.details?.userCount) &&
              e.details!.userCount > 0
                ? { userCount: e.details!.userCount }
                : {}),
            },
          },
          e.status,
        );
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
