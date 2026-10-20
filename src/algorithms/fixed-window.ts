import type { RateLimitAlgorithm, RateLimitResult } from './interface.js';
import { evalScript } from './script-loader.js';
import { getRedis } from '../config/redis.js';

export class FixedWindowAlgorithm implements RateLimitAlgorithm {
  readonly name = 'fixed_window';

  async check(
    key: string,
    limit: number,
    windowSeconds: number,
    cost: number,
  ): Promise<RateLimitResult> {
    const redis = getRedis();
    const redisKey = `rl:{${key}}:fixed_window`;

    const result = await evalScript(redis, 'fixed-window', [redisKey], [
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
    const redisKey = `rl:{${key}}:fixed_window`;

    const result = await evalScript(redis, 'refund', [redisKey], [
      'fixed_window',
      units,
      limit,
      windowSeconds,
    ]) as number[];

    return result[0];
  }
}
