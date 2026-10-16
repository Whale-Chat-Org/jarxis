import { describe, expect, it } from 'vitest';
import {
  discoveryFailureMessage,
  encodeDiscoveryFailure,
  MlRequestError,
  mlErrorMessage,
  readErrorCode,
  storedDiscoveryFailureMessage,
} from '@/lib/ml/errors';

const fallback = 'Fallback copy';

describe('ML provider error messages', () => {
  it('maps management API codes to fixed guidance', () => {
    expect(mlErrorMessage(new MlRequestError(400, 'INVALID_ENDPOINT'), fallback)).toMatch(
      /public HTTPS base URL/,
    );
    expect(mlErrorMessage(new MlRequestError(404, 'NOT_FOUND'), fallback)).toMatch(
      /Reload to see the latest providers/,
    );
    expect(mlErrorMessage(new MlRequestError(403, 'FORBIDDEN'), fallback)).toBe(
      'Only owners can manage ML providers.',
    );
  });

  it('falls back to shared status copy, then to the caller fallback', () => {
    expect(mlErrorMessage(new MlRequestError(401), fallback)).toBe(
      'Please sign in again to continue.',
    );
    expect(mlErrorMessage(new MlRequestError(502, 'UNKNOWN_CODE'), fallback)).toBe(fallback);
    expect(mlErrorMessage(new TypeError('raw network detail'), fallback)).toBe(fallback);
  });

  it('reads only a well-formed code and never the server message', async () => {
    const secret = 'sk-upstream-secret';
    const response = Response.json(
      { error: { code: 'INVALID_ENDPOINT', message: secret } },
      { status: 400 },
    );
    const code = await readErrorCode(response);
    expect(code).toBe('INVALID_ENDPOINT');
    const message = mlErrorMessage(new MlRequestError(400, code), fallback);
    expect(message).not.toContain(secret);
    expect(await readErrorCode(Response.json({ error: { code: `<b>${secret}</b>` } }))).toBe(
      undefined,
    );
    expect(await readErrorCode(new Response('not json', { status: 500 }))).toBe(undefined);
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
