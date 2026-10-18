export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}
export class CredentialError extends Error {
  constructor() {
    super('Provider requires an API key');
    this.name = 'CredentialError';
  }
}
