import type { Transaction } from '@/db';
import 'server-only';
/** Durable namespace: old and new workers must serialize on the same lock. */
export async function lockConnection(transaction: Transaction, id: string) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ml:connection:${id}`}, 0))`;
}
