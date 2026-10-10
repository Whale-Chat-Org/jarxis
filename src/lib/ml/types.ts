export const providerKinds = ['openai', 'anthropic', 'openrouter', 'custom'] as const;
export type ProviderKind = (typeof providerKinds)[number];
export type Credential = {
  apiKey?: string;
};
export function defaultBaseUrl(provider: ProviderKind): string {
  const roots = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    custom: '',
  };
  return roots[provider];
}
export function publicModelId(provider: string, upstreamId: string): string {
  return `${provider}/${upstreamId}`;
}
