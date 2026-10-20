import { Redis } from 'ioredis';
import { loadEnv } from './env.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const env = loadEnv();
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableReadyCheck: true,
      commandTimeout: env.REDIS_TIMEOUT_MS,
    });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

export function setRedisInstance(r: Redis): void {
  redis = r;
}
