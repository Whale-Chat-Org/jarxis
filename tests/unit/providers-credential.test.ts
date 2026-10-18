import { getUsableCredential } from '@/lib/providers/credential';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ decrypt: vi.fn() }));
vi.mock('@/lib/providers/crypto', () => ({ decryptCredential: mocks.decrypt }));
const connection = {
  id: 'connection',
  provider: 'openai',
  status: 'ready',
  encryptedCredential: 'encrypted',
};
beforeEach(() => vi.resetAllMocks());
it('returns only the API key from a ready connection', async () => {
  mocks.decrypt.mockReturnValue({ apiKey: 'key', accessToken: 'discarded' });
  await expect(getUsableCredential(connection)).resolves.toEqual({ apiKey: 'key' });
});
it.each(['codex', 'claude'])('rejects removed provider %s before decrypting', async (provider) => {
  await expect(getUsableCredential({ ...connection, provider })).rejects.toThrow('API key');
  expect(mocks.decrypt).not.toHaveBeenCalled();
});
it.each([{ accessToken: 'token', refreshToken: 'refresh' }, {}, { apiKey: ' ' }, { apiKey: 12 }])(
  'rejects credentials without a usable API key',
  async (credential) => {
    mocks.decrypt.mockReturnValue(credential);
    await expect(getUsableCredential(connection)).rejects.toThrow('API key');
  },
);
