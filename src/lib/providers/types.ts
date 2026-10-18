export const providerDefinitions = {
  openai: { baseUrl: 'https://api.openai.com/v1', dialect: 'chat', endpoint: 'chat/completions' },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    dialect: 'anthropic',
    endpoint: 'messages',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    dialect: 'chat',
    endpoint: 'chat/completions',
  },
  custom: { baseUrl: '', dialect: 'chat', endpoint: 'chat/completions' },
} as const;
export const providerKinds = [
  'openai',
  'anthropic',
  'openrouter',
  'custom',
] as const satisfies readonly (keyof typeof providerDefinitions)[];
export type ProviderKind = keyof typeof providerDefinitions;
export type Credential = { apiKey?: string };
export const isProviderKind = (value: string): value is ProviderKind =>
  Object.hasOwn(providerDefinitions, value);
export function defaultBaseUrl(provider: ProviderKind): string {
  return providerDefinitions[provider].baseUrl;
}
