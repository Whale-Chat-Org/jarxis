import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function encryptionKey(): Buffer {
  const value = process.env.ML_ENCRYPTION_KEY;
  if (
    !value ||
    !/^[a-f\d]{64}$/i.test(value) ||
    [process.env.BETTER_AUTH_SECRET, process.env.JWT_SECRET].some(
      (secret) => secret && secret.toLowerCase() === value.toLowerCase(),
    )
  ) {
    throw new Error('ML encryption configuration is invalid');
  }
  return Buffer.from(value, 'hex');
}
export function encryptCredential(value: unknown, context: string): string {
  const key = encryptionKey();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [
      'v1',
      nonce.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  } catch {
    throw new Error('Credential encryption failed');
  }
}
export function decryptCredential<T>(ciphertext: string, context: string): T {
  const key = encryptionKey();
  try {
    const parts = ciphertext.split('.');
    if (
      parts.length !== 4 ||
      parts[0] !== 'v1' ||
      parts.slice(1).some((part) => !/^[\w-]+$/.test(part))
    )
      throw new Error();
    const nonce = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(parts[3], 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    ) as T;
  } catch {
    throw new Error('Credential decryption failed');
  }
}
export function hashGatewayKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
export function mintGatewayKey() {
  const key = `jml_${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, 12), hash: hashGatewayKey(key) };
}
