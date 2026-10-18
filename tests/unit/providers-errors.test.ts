import {
  discoveryFailureMessage,
  encodeDiscoveryFailure,
  providerErrorMessage,
  ProviderRequestError,
  responseErrorCode,
  storedDiscoveryFailureMessage,
} from '@/lib/providers/errors';
import { describe, expect, it } from 'vitest';

const fallback = 'Fallback copy';

describe('Provider error messages', () => {
  it('maps management API codes to fixed guidance', () => {
    expect(
      providerErrorMessage(new ProviderRequestError(400, 'INVALID_ENDPOINT'), fallback),
    ).toMatch(/public HTTPS base URL/);
    expect(providerErrorMessage(new ProviderRequestError(404, 'NOT_FOUND'), fallback)).toMatch(
      /Reload to see the latest providers/,
    );
    expect(providerErrorMessage(new ProviderRequestError(403, 'FORBIDDEN'), fallback)).toBe(
      'Only owners can manage Providers.',
    );
  });

  it('falls back to shared status copy, then to the caller fallback', () => {
    expect(providerErrorMessage(new ProviderRequestError(401), fallback)).toBe(
      'Please sign in again to continue.',
    );
    expect(providerErrorMessage(new ProviderRequestError(502, 'UNKNOWN_CODE'), fallback)).toBe(
      fallback,
    );
    expect(providerErrorMessage(new TypeError('raw network detail'), fallback)).toBe(fallback);
  });

  it('reads only a well-formed code and never the server message', async () => {
    const secret = 'sk-upstream-secret';
    const response = Response.json(
      { error: { code: 'INVALID_ENDPOINT', message: secret } },
      { status: 400 },
    );
    const code = await responseErrorCode(response);
    expect(code).toBe('INVALID_ENDPOINT');
    const message = providerErrorMessage(new ProviderRequestError(400, code), fallback);
    expect(message).not.toContain(secret);
    expect(await responseErrorCode(Response.json({ error: { code: `<b>${secret}</b>` } }))).toBe(
      undefined,
    );
    expect(await responseErrorCode(new Response('not json', { status: 500 }))).toBe(undefined);
  });

  it('turns stored discovery reasons into fixed copy and old free text into a generic line', () => {
    expect(storedDiscoveryFailureMessage(encodeDiscoveryFailure('rate_limited', 429))).toBe(
      discoveryFailureMessage('rate_limited', 429),
    );
    expect(storedDiscoveryFailureMessage('auth:401')).toContain('HTTP 401');
    expect(storedDiscoveryFailureMessage('Model discovery failed. <b>secret</b>')).toBe(
      'Model discovery failed. Check the connection and retry.',
    );
    expect(storedDiscoveryFailureMessage('auth:<script>')).not.toContain('<script>');
  });
});

describe('rate limit wait copy', () => {
  it('formats seconds and rounded-up minutes', () => {
    expect(discoveryFailureMessage('rate_limited', 429, 1)).toContain('Try again in 1 second.');
    expect(discoveryFailureMessage('rate_limited', 429, 30)).toContain('Try again in 30 seconds.');
    expect(discoveryFailureMessage('rate_limited', 429, 60)).toContain('Try again in 1 minute.');
    expect(discoveryFailureMessage('rate_limited', null, 61)).toContain('Try again in 2 minutes.');
    expect(discoveryFailureMessage('rate_limited')).toContain('Wait a moment, then retry.');
  });
});
