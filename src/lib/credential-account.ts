import type { Transaction } from '@/db';
import { randomUUID } from 'node:crypto';

/** Callers hash and validate passwords before reaching this persistence-only helper. */
export function createCredentialAccount(
  connection: Pick<Transaction, 'account'>,
  userId: string,
  passwordHash: string,
) {
  return connection.account.create({
    data: {
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: passwordHash,
      updatedAt: new Date(),
    },
  });
}
