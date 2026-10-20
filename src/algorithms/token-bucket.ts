import type { RateLimitAlgorithm, RateLimitResult, AlgorithmOptions } from './interface.js';
import { evalScript } from './script-loader.js';
import { getRedis } from '../config/redis.js';

export class TokenBucketAlgorithm implements RateLimitAlgorithm {
  readonly name = 'token_bucket';

  async check(
    key: string,
    limit: number,
    windowSeconds: number,
    cost: number,
    options?: AlgorithmOptions
  ): Promise<RateLimitResult> {
    const redis = getRedis();
    const capacity = options?.burst ?? limit;
    // refill rate: limit tokens per window
    const refillRate = limit / windowSeconds;
    const redisKey = `rl:{${key}}:token_bucket`;

    const result = await evalScript(redis, 'token-bucket', [redisKey], [
      capacity,
      refillRate,
      cost,
    ]) as number[];

    return {
      allowed: result[0] === 1,
      limit: capacity,
      remaining: Math.max(0, result[1]),
      retryAfterMs: result[2],
      resetMs: result[3],
    };
  }

  async refund(
    key: string,
    limit: number,
    _windowSeconds: number,
    units: number,
    options?: AlgorithmOptions
  ): Promise<number> {
    const redis = getRedis();
    const capacity = options?.burst ?? limit;
    const redisKey = `rl:{${key}}:token_bucket`;

    const result = await evalScript(redis, 'refund', [redisKey], [
      'token_bucket',
      units,
      capacity,
      0,
    ]) as number[];

    return result[0];
  }
}
