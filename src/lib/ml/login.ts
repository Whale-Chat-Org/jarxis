import 'server-only';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { db } from '@/db';
import { encryptCredential, decryptCredential } from './crypto';
import { safeFetch } from './network';
import type { Credential } from './types';

export type CredentialConnection = {
  id: string;
  provider: string;
  status: string;
  encryptedCredential: string | null;
};

export function publicLoginUrl(provider: string, value: string): string | null {
  try {
    const url = new URL(value);
    const hosts =
      provider === 'codex'
        ? ['auth.openai.com']
        : provider === 'claude'
          ? ['claude.ai', 'console.anthropic.com', 'platform.claude.com']
          : [];
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !hosts.includes(url.hostname) ||
      value.length > 4096
    )
      return null;
    if (provider === 'codex' && url.pathname !== '/codex/device') return null;
    if (provider === 'claude' && !['/oauth/authorize', '/oauth/authorize/'].includes(url.pathname))
      return null;
    const allowed = new Set([
      'client_id',
      'response_type',
      'redirect_uri',
      'scope',
      'state',
      'code_challenge',
      'code_challenge_method',
      'organization_uuid',
    ]);
    for (const key of url.searchParams.keys()) if (!allowed.has(key)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function token(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 16384 ? value : undefined;
}

export function parseCliCredential(provider: string, value: unknown): Credential {
  if (!value || typeof value !== 'object') throw new Error('CLI credential unavailable');
  const document = value as Record<string, unknown>;
  const source = (provider === 'codex' ? document.tokens : document.claudeAiOauth) as
    Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object') throw new Error('CLI credential unavailable');
  const accessToken = token(provider === 'codex' ? source.access_token : source.accessToken);
  const refreshToken = token(provider === 'codex' ? source.refresh_token : source.refreshToken);
  if (!accessToken || !refreshToken) throw new Error('CLI credential unavailable');
  let expiresAt = typeof source.expiresAt === 'number' ? source.expiresAt : undefined;
  if (provider === 'codex') {
    try {
      const payload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64url').toString(),
      ) as { exp?: number };
      if (typeof payload.exp === 'number') expiresAt = payload.exp * 1000;
    } catch {
      throw new Error('CLI credential expiry unavailable');
    }
  }
  if (!expiresAt || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
    throw new Error('CLI credential expiry unavailable');
  return {
    accessToken,
    refreshToken,
    expiresAt,
    accountId: token(provider === 'codex' ? source.account_id : source.accountId),
  };
}

export async function readIsolatedCredential(
  provider: string,
  directory: string,
): Promise<Credential> {
  const root = await realpath(directory);
  const filename = join(
    root,
    provider === 'codex' ? 'codex/auth.json' : 'claude/.credentials.json',
  );
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
    throw new Error('CLI credential unavailable');
  const resolved = await realpath(filename);
  const inside = relative(root, resolved);
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('CLI credential unavailable');
  return parseCliCredential(provider, JSON.parse(await readFile(resolved, 'utf8')));
}

export async function getUsableCredential(connection: CredentialConnection): Promise<Credential> {
  if (connection.status !== 'ready' || !connection.encryptedCredential)
    throw new Error('Provider requires reconnect');
  const initial = decryptCredential<Credential>(connection.encryptedCredential, connection.id);
  if (initial.apiKey) return initial;
  if (!initial.accessToken || !initial.expiresAt) throw new Error('Provider requires reconnect');
  if (initial.expiresAt > Date.now() + 60000) return initial;
  const lock = createHash('sha256')
    .update(`${connection.provider}:${initial.accountId ?? 'shared'}`)
    .digest('hex');
  const result = await db.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ml:connection:${connection.id}`}, 0))`;
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ml-refresh:${lock}`}, 0))`;
      const current = await transaction.mlConnection.findUnique({ where: { id: connection.id } });
      if (!current || current.status !== 'ready' || !current.encryptedCredential) return null;
      const credential = decryptCredential<Credential>(current.encryptedCredential, current.id);
      if (
        credential.accessToken &&
        credential.expiresAt &&
        credential.expiresAt > Date.now() + 60000
      )
        return credential;
      if (!credential.refreshToken) {
        await transaction.mlConnection.updateMany({
          where: { id: current.id, encryptedCredential: current.encryptedCredential },
          data: { status: 'reconnect_required' },
        });
        return null;
      }
      const clientId =
        current.provider === 'codex'
          ? process.env.ML_CODEX_OAUTH_CLIENT_ID
          : process.env.ML_CLAUDE_OAUTH_CLIENT_ID;
      if (!clientId) throw new Error('Provider refresh configuration unavailable');
      const endpoint =
        current.provider === 'codex'
          ? 'https://auth.openai.com/oauth/token'
          : current.provider === 'claude'
            ? 'https://console.anthropic.com/v1/oauth/token'
            : null;
      if (!endpoint) throw new Error('Provider refresh unsupported');
      const response = await safeFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: credential.refreshToken,
          client_id: clientId,
        }),
        signal: AbortSignal.timeout(20000),
        timeoutMs: 20000,
        maxResponseBytes: 65536,
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        if (body?.error === 'invalid_grant' || response.status === 401) {
          await transaction.mlConnection.updateMany({
            where: { id: current.id, encryptedCredential: current.encryptedCredential },
            data: { status: 'reconnect_required' },
          });
          return null;
        }
        throw new Error('Provider refresh unavailable');
      }
      const accessToken = token(body?.access_token);
      const seconds = body?.expires_in;
      if (
        !accessToken ||
        typeof seconds !== 'number' ||
        !Number.isFinite(seconds) ||
        seconds <= 60 ||
        seconds > 31536000
      )
        throw new Error('Provider refresh unavailable');
      const refreshed: Credential = {
        ...credential,
        accessToken,
        refreshToken: token(body?.refresh_token) ?? credential.refreshToken,
        expiresAt: Date.now() + seconds * 1000,
      };
      const saved = await transaction.mlConnection.updateMany({
        where: {
          id: current.id,
          status: 'ready',
          encryptedCredential: current.encryptedCredential,
        },
        data: { encryptedCredential: encryptCredential(refreshed, current.id) },
      });
      return saved.count === 1 ? refreshed : null;
    },
    { maxWait: 30000, timeout: 30000 },
  );
  if (!result) throw new Error('Provider requires reconnect');
  return result;
}
