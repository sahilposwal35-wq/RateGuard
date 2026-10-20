import type { RateLimitAlgorithm, RateLimitResult } from './interface.js';
import { evalScript } from './script-loader.js';
import { getRedis } from '../config/redis.js';

export class SlidingWindowLogAlgorithm implements RateLimitAlgorithm {
  readonly name = 'sliding_window_log';

  async check(
    key: string,
    limit: number,
    windowSeconds: number,
    cost: number,
  ): Promise<RateLimitResult> {
    const redis = getRedis();
    const redisKey = `rl:{${key}}:sliding_window_log`;

    const result = await evalScript(redis, 'sliding-window-log', [redisKey], [
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
    _key: string,
    _limit: number,
    _windowSeconds: number,
    _units: number,
  ): Promise<number> {
    // Sliding window log does not support refund (exact baseline only)
    return 0;
  }
}
