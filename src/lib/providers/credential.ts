import 'server-only';
import { z } from 'zod';
import { CredentialError, ProviderConfigurationError } from './credential-errors';
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
    throw new CredentialError();
  let credential: unknown;
  try {
    credential = decryptCredential<Credential>(connection.encryptedCredential, connection.id);
  } catch (error) {
    if (error instanceof ProviderConfigurationError) throw error;
    throw new CredentialError();
  }
  const parsed = z.object({ apiKey: z.string().trim().min(1) }).safeParse(credential);
  if (!parsed.success) throw new CredentialError();
  return parsed.data;
}
