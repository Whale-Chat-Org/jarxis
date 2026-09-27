import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../lib/env';
const globalDb = globalThis as unknown as { jarxisPrisma?: PrismaClient };
let client: PrismaClient | undefined;
function getClient() {
  return (client ??= globalDb.jarxisPrisma ??=
    new PrismaClient({
      adapter: new PrismaPg({ connectionString: env().DATABASE_URL, max: 10 }),
    }));
}
// Importing server modules during Next builds does not read runtime secrets or connect.
export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const c = getClient();
    const value = Reflect.get(c, property, c);
    return typeof value === 'function' ? value.bind(c) : value;
  },
});
export { Prisma };
export type Transaction = Prisma.TransactionClient;
