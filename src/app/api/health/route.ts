import { db } from '@/db';
import { readyRedis } from '@/lib/redis';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await db.$queryRaw`select 1`;
    await (await readyRedis()).ping();
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
