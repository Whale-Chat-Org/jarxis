import { ChatOpenAI } from '@langchain/openai';

function agentConfig() {
  const url = process.env.JARXIS_AGENT_GATEWAY_URL;
  const key = process.env.JARXIS_AGENT_GATEWAY_KEY;
  const model = process.env.JARXIS_AGENT_MODEL;
  if (!url || !key || !model) {
    throw new Error(
      'Set JARXIS_AGENT_GATEWAY_URL, JARXIS_AGENT_GATEWAY_KEY, and JARXIS_AGENT_MODEL.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('JARXIS_AGENT_GATEWAY_URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('JARXIS_AGENT_GATEWAY_URL must be an HTTP URL without credentials.');
  }
  if (!key.startsWith('jml_')) throw new Error('JARXIS_AGENT_GATEWAY_KEY must be a gateway key.');
  return { url: parsed.toString().replace(/\/$/, ''), key, model };
}

export function safeModelError(error: unknown): Error {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : undefined;
  if (status === 401 || status === 403) {
    return new Error('Jarxis gateway authentication failed. Check the agent gateway key.');
  }
  return new Error(
    status === undefined
      ? 'Jarxis gateway request failed. Check the gateway URL, model, and server availability.'
      : `Jarxis gateway request failed (HTTP ${status}). Check the configured model and gateway.`,
  );
}

export function createGatewayModel() {
  const { url, key, model } = agentConfig();
  return new ChatOpenAI({
    model,
    apiKey: key,
    useResponsesApi: false,
    streamUsage: false,
    configuration: { baseURL: url },
  });
}
