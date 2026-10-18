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
    instance.on('error', () => console.error('Redis unavailable', { kind: 'RedisError' }));
  }
  return instance;
}
export async function readyRedis() {
  const r = redis();
  if (r.status === 'wait') {
    try {
      await r.connect();
    } catch {
      throw new HttpError(503, 'UNAVAILABLE', 'Security service unavailable');
    }
  }
  if (r.status !== 'ready') throw new HttpError(503, 'UNAVAILABLE', 'Security service unavailable');
  return r;
}
export async function rateLimit(key: string, max = 20, seconds = 60) {
  const r = await readyRedis();
  const id = createHash('sha256').update(key).digest('hex');
  let result: unknown;
  try {
    result = await r.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
      1,
      `limit:${id}`,
      seconds,
    );
  } catch {
    throw new HttpError(503, 'UNAVAILABLE', 'Security service unavailable');
  }
  const n = Number(result);
  if (!Number.isSafeInteger(n) || n < 1)
    throw new HttpError(503, 'UNAVAILABLE', 'Security service unavailable');
  if (n > max)
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
}
export function requestIP(headers: Headers) {
  return env().TRUST_PROXY ? (headers.get('x-real-ip') ?? 'unknown') : 'shared';
}
