import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptCredential,
  encryptCredential,
  hashGatewayKey,
  mintGatewayKey,
} from '@/lib/ml/crypto';

beforeEach(() => {
  vi.stubEnv('ML_ENCRYPTION_KEY', 'a'.repeat(64));
  vi.stubEnv('BETTER_AUTH_SECRET', 'b'.repeat(64));
  vi.stubEnv('JWT_SECRET', 'c'.repeat(64));
});
afterEach(() => vi.unstubAllEnvs());
describe('ML credentials', () => {
  it('round trips credentials with randomized authenticated encryption', () => {
    const value = { apiKey: 'provider-secret', refreshToken: 'refresh-secret', expiresAt: 123 };
    const encrypted = encryptCredential(value, 'connection-1');
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain('provider-secret');
    expect(encryptCredential(value, 'connection-1')).not.toBe(encrypted);
    expect(decryptCredential(encrypted, 'connection-1')).toEqual(value);
  });
  it('rejects a different connection and a different login purpose', () => {
    const encrypted = encryptCredential({ accessToken: 'secret' }, 'login:job:state');
    expect(() => decryptCredential(encrypted, 'login:job:input')).toThrow(
      'Credential decryption failed',
    );
    expect(() => decryptCredential(encrypted, 'other')).toThrow('Credential decryption failed');
  });
  it('rejects modified and malformed envelopes with sanitized errors', () => {
    const encrypted = encryptCredential('secret', 'id');
    const parts = encrypted.split('.');
    const tag = Buffer.from(parts[2], 'base64url');
    tag[0] ^= 1;
    parts[2] = tag.toString('base64url');
    for (const value of [parts.join('.'), 'v2.a.b.c', 'secret', 'v1.a.b.c.extra']) {
      expect(() => decryptCredential(value, 'id')).toThrow('Credential decryption failed');
    }
  });
  it('validates the independent key lazily and rejects rotation', () => {
    const encrypted = encryptCredential('secret', 'id');
    vi.stubEnv('ML_ENCRYPTION_KEY', 'd'.repeat(64));
    expect(() => decryptCredential(encrypted, 'id')).toThrow('Credential decryption failed');
    for (const key of ['', 'a'.repeat(63), 'x'.repeat(64), 'b'.repeat(64), 'C'.repeat(64)]) {
      vi.stubEnv('ML_ENCRYPTION_KEY', key);
      expect(() => encryptCredential('secret', 'id')).toThrow(
        'ML encryption configuration is invalid',
      );
    }
  });
  it('mints high entropy keys and persists only deterministic hashes', () => {
    const first = mintGatewayKey();
    const second = mintGatewayKey();
    expect(first.key).toMatch(/^jml_[\w-]{43}$/);
    expect(first.key).not.toBe(second.key);
    expect(first.hash).toMatch(/^[a-f\d]{64}$/);
    expect(first.hash).toBe(hashGatewayKey(first.key));
    expect(first.prefix).toBe(first.key.slice(0, 12));
  });
});
