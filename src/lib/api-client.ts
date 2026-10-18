import { z } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
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
    })
    .optional(),
});
/** A successful command whose response body is intentionally unused. */
export async function apiAction(url: string, options: RequestInit = {}): Promise<void> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  if (!response.ok) throw new ApiRequestError(response.status, await responseErrorCode(response));
}
export async function responseErrorCode(response: Response) {
  try {
    const parsed = errorEnvelope.safeParse(await response.json());
    return parsed.success ? parsed.data.error?.code : undefined;
  } catch {
    return undefined;
  }
}

/** Only status and an allowlisted machine-code shape survive a failed request. */
export async function apiRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  if (!response.ok) throw new ApiRequestError(response.status, await responseErrorCode(response));
  if (response.status === 204) return schema.parse(undefined);
  try {
    return schema.parse(await response.json());
  } catch {
    throw new ApiRequestError(502, 'INVALID_RESPONSE');
  }
}

export const inlineFormErrors = { meta: { errorPresentation: 'inline' } } as const;
