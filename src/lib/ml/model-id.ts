import 'server-only';
import { createHash } from 'node:crypto';
import { defaultBaseUrl, providerKinds, type ProviderKind } from './types';

function normalizedEndpoint(value: string) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

/** Accounts at the same endpoint pool together; unrelated custom gateways never collide by model name. */
export function poolModelId(connection: { provider: string; baseUrl: string }, upstreamId: string) {
  const preset = providerKinds.includes(connection.provider as ProviderKind)
    ? defaultBaseUrl(connection.provider as ProviderKind)
    : '';
  const endpoint = normalizedEndpoint(connection.baseUrl);
  const namespace =
    preset && endpoint === normalizedEndpoint(preset)
      ? connection.provider
      : `${connection.provider}-${createHash('sha256').update(endpoint).digest('hex').slice(0, 24)}`;
  return `${namespace}/${upstreamId}`;
}
