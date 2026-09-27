import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { env } from './env';
import { HttpError } from './errors';
let instance: Redis | undefined;
export function redis() {
  if (!instance) {
    instance = new Redis(env().REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    instance.on('error', () => {});
  }
  return instance;
}
export async function readyRedis() {
  const r = redis();
  if (r.status === 'wait') await r.connect();
  if (r.status !== 'ready') throw new HttpError(503, 'UNAVAILABLE', 'Security service unavailable');
  return r;
}
export async function rateLimit(key: string, max = 20, seconds = 60) {
  const r = await readyRedis();
  const id = createHash('sha256').update(key).digest('hex');
  const n = Number(
    await r.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
      1,
      `limit:${id}`,
      seconds,
    ),
  );
  if (n > max)
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
}
export function requestIP(headers: Headers) {
  return env().TRUST_PROXY ? (headers.get('x-real-ip') ?? 'unknown') : 'shared';
}
