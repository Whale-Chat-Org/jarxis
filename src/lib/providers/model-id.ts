import { createHash } from 'node:crypto';
import 'server-only';
import { defaultBaseUrl, isProviderKind } from './types';

function normalizedEndpoint(value: string) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

/** Accounts at the same endpoint pool together; unrelated custom gateways never collide by model name. */
export function publicModelId(
  connection: { provider: string; baseUrl: string },
  upstreamId: string,
) {
  const preset = isProviderKind(connection.provider) ? defaultBaseUrl(connection.provider) : '';
  const endpoint = normalizedEndpoint(connection.baseUrl);
  const namespace =
    preset && endpoint === normalizedEndpoint(preset)
      ? connection.provider
      : `${connection.provider}-${createHash('sha256').update(endpoint).digest('hex').slice(0, 24)}`;
  return `${namespace}/${upstreamId}`;
}
