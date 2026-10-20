import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanRedis, getTestRedis, teardownAll } from '../helpers.js';
import { TokenBucketAlgorithm } from '../../src/algorithms/token-bucket.js';
import { FixedWindowAlgorithm } from '../../src/algorithms/fixed-window.js';
import type { Redis } from 'ioredis';

describe('T2: Race Demo - Naive Read-Then-Write vs Atomic Lua', () => {
  let redis: Redis;

  beforeAll(async () => {
    await setupTestEnv();
    redis = getTestRedis();
    const { setRedisInstance } = await import('../../src/config/redis.js');
    setRedisInstance(redis);
  });

  afterAll(async () => {
    await teardownAll();
  });

  beforeEach(async () => {
    await cleanRedis();
  });

  /**
   * Naive read-then-write limiter implemented in application code.
   * Simulates typical anti-pattern where read and write are non-atomic.
   */
  async function naiveCheck(key: string, limit: number, cost: number): Promise<boolean> {
    const raw = await redis.get(key);
    const current = raw ? parseInt(raw, 10) : 0;
    
    // Simulate real-world async application execution delay
    await new Promise((r) => setTimeout(r, Math.random() * 5 + 1));
    
    if (current + cost <= limit) {
      await redis.set(key, String(current + cost));
      return true;
    }
    return false;
  }

  it('demonstrates that naive read-then-write over-admits under concurrent load', async () => {
    const limit = 20;
    const concurrentRequests = 60;
    const key = 'race:naive:test';

    // Fire 60 concurrent requests
    const promises = Array.from({ length: concurrentRequests }, () =>
      naiveCheck(key, limit, 1)
    );
    const results = await Promise.all(promises);
    const admitted = results.filter((allowed) => allowed).length;

    // The naive limiter experiences races and admits significantly more than the limit of 20
    expect(admitted).toBeGreaterThan(limit);
  });

  it('proves that Lua token bucket stays strictly within limit under concurrent load', async () => {
    const limit = 20;
    const concurrentRequests = 60;
    const key = 'race:lua:token_bucket';
    const algo = new TokenBucketAlgorithm();

    // Fire 60 concurrent requests
    const promises = Array.from({ length: concurrentRequests }, () =>
      algo.check(key, limit, 60, 1, { burst: limit })
    );
    const results = await Promise.all(promises);
    const admitted = results.filter((res) => res.allowed).length;

    // Lua script executes atomically inside Redis: admitted count cannot exceed capacity
    expect(admitted).toBeLessThanOrEqual(limit);
    expect(admitted).toBe(limit);
  });

  it('proves that Lua fixed window stays strictly within limit under concurrent load', async () => {
    const limit = 20;
    const concurrentRequests = 60;
    const key = 'race:lua:fixed_window';
    const algo = new FixedWindowAlgorithm();

    const promises = Array.from({ length: concurrentRequests }, () =>
      algo.check(key, limit, 60, 1)
    );
    const results = await Promise.all(promises);
    const admitted = results.filter((res) => res.allowed).length;

    expect(admitted).toBeLessThanOrEqual(limit);
    expect(admitted).toBe(limit);
  });
});
