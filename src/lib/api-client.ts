import { z } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    readonly userCount?: number,
  ) {
    super('Request failed');
    this.name = 'ApiRequestError';
  }
}

const errorEnvelope = z.object({
  error: z
    .object({
      code: z
        .string()
        .regex(/^[A-Z_]{1,64}$/)
        .optional(),
      userCount: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .catch(undefined),
    })
    .optional(),
});
/** A successful command whose response body is intentionally unused. */
export async function apiAction(url: string, options: RequestInit = {}): Promise<void> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  if (!response.ok) throw await responseError(response);
}
async function responseError(response: Response) {
  try {
    const parsed = errorEnvelope.safeParse(await response.json());
    const error = parsed.success ? parsed.data.error : undefined;
    return new ApiRequestError(
      response.status,
      error?.code,
      error?.code === 'ROLE_IN_USE' ? error.userCount : undefined,
    );
  } catch {
    return new ApiRequestError(response.status);
  }
}
export async function responseErrorCode(response: Response) {
  return (await responseError(response)).code;
}

/** Only status and an allowlisted machine-code shape survive a failed request. */
export async function apiRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return schema.parse(undefined);
  try {
    return schema.parse(await response.json());
  } catch {
    throw new ApiRequestError(502, 'INVALID_RESPONSE');
  }
}

export const inlineFormErrors = { meta: { errorPresentation: 'inline' } } as const;
