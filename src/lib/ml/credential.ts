import 'server-only';
import { decryptCredential } from './crypto';
import { providerKinds, type Credential } from './types';

export type CredentialConnection = {
  id: string;
  provider: string;
  status: string;
  encryptedCredential: string | null;
};

export async function getUsableCredential(connection: CredentialConnection): Promise<Credential> {
  if (
    !providerKinds.some((provider) => provider === connection.provider) ||
    connection.status !== 'ready' ||
    !connection.encryptedCredential
  )
    throw new Error('Provider requires an API key');
  const credential = decryptCredential<Credential>(connection.encryptedCredential, connection.id);
  if (typeof credential.apiKey !== 'string' || !credential.apiKey.trim())
    throw new Error('Provider requires an API key');
  return { apiKey: credential.apiKey };
}
