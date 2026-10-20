import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv, cleanRedis, getTestRedis, teardownAll } from '../helpers.js';
import { TokenBucketAlgorithm } from '../../src/algorithms/token-bucket.js';
import type { Redis } from 'ioredis';

describe('T18: Concurrency Flakiness Verification (20 Consecutive Runs)', () => {
  let redis: Redis;
  const algo = new TokenBucketAlgorithm();

  beforeAll(async () => {
    await setupTestEnv();
    redis = getTestRedis();
    const { setRedisInstance } = await import('../../src/config/redis.js');
    setRedisInstance(redis);
  });

  afterAll(async () => {
    await teardownAll();
  });

  it('passes 20 consecutive concurrent execution runs with zero flakiness', async () => {
    const totalRuns = 20;
    const limit = 15;
    const concurrentCallers = 45;
    const runResults: number[] = [];

    for (let run = 1; run <= totalRuns; run++) {
      await cleanRedis();
      const testKey = `concurrency:t18:run:${run}`;

      // 45 concurrent callers competing for 15 tokens
      const promises = Array.from({ length: concurrentCallers }, () =>
        algo.check(testKey, limit, 60, 1, { burst: limit })
      );

      const results = await Promise.all(promises);
      const admitted = results.filter((r) => r.allowed).length;
      runResults.push(admitted);

      // Theoretical bound: capacity is 15, atomic Redis token bucket must admit exactly 15
      expect(admitted).toBe(limit);
    }

    console.log(`[T18 Verification] Successfully completed all ${totalRuns} consecutive runs.`);
    console.log(`[T18 Verification] Admitted counts across 20 runs: ${runResults.join(', ')}`);
    expect(runResults.length).toBe(totalRuns);
    expect(runResults.every((count) => count === limit)).toBe(true);
  });
});
