import type { RateLimitAlgorithm, RateLimitResult } from './interface.js';
import { evalScript } from './script-loader.js';
import { getRedis } from '../config/redis.js';

export class SlidingWindowAlgorithm implements RateLimitAlgorithm {
  readonly name = 'sliding_window';

  async check(
    key: string,
    limit: number,
    windowSeconds: number,
    cost: number,
  ): Promise<RateLimitResult> {
    const redis = getRedis();
    const redisKey = `rl:{${key}}:sliding_window`;

    const result = await evalScript(redis, 'sliding-window', [redisKey], [
      limit,
      windowSeconds,
      cost,
    ]) as number[];

    return {
      allowed: result[0] === 1,
      limit,
      remaining: Math.max(0, result[1]),
      retryAfterMs: result[2],
      resetMs: result[3],
    };
  }

  async refund(
    key: string,
    limit: number,
    windowSeconds: number,
    units: number,
  ): Promise<number> {
    const redis = getRedis();
    const redisKey = `rl:{${key}}:sliding_window`;

    const result = await evalScript(redis, 'refund', [redisKey], [
      'sliding_window',
      units,
      limit,
      windowSeconds,
    ]) as number[];

    return result[0];
  }
}
