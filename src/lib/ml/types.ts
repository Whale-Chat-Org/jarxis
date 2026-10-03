export const providerKinds = [
  'openai',
  'anthropic',
  'openrouter',
  'custom',
  'codex',
  'claude',
] as const;
export type ProviderKind = (typeof providerKinds)[number];
export type Credential = {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
};
export function defaultBaseUrl(provider: ProviderKind): string {
  const roots = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    custom: '',
    codex: 'https://chatgpt.com/backend-api/codex',
    claude: 'https://api.anthropic.com/v1',
  };
  return roots[provider];
}
export function isSubscription(provider: string): boolean {
  return provider === 'codex' || provider === 'claude';
}
export function publicModelId(provider: string, upstreamId: string): string {
  return `${provider}/${upstreamId}`;
}
