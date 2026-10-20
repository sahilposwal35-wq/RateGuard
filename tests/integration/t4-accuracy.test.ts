import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanRedis, getTestRedis, teardownAll, sleep } from '../helpers.js';
import { SlidingWindowAlgorithm } from '../../src/algorithms/sliding-window.js';
import { SlidingWindowLogAlgorithm } from '../../src/algorithms/sliding-window-log.js';
import type { Redis } from 'ioredis';

describe('T4: Sliding Counter Accuracy vs Exact Log Baseline', () => {
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

  it('measures and reports approximation error of sliding counter against exact log ground truth', async () => {
    const swCounter = new SlidingWindowAlgorithm();
    const swLog = new SlidingWindowLogAlgorithm();

    const limit = 25;
    const windowSeconds = 2;
    const totalRequests = 80;

    const counterKey = 'accuracy:sw_counter';
    const logKey = 'accuracy:sw_log';

    let counterAllowed = 0;
    let logAllowed = 0;

    // Send requests with pseudo-random delays to simulate realistic uneven traffic
    for (let i = 0; i < totalRequests; i++) {
      // Direct comparison on the exact same request sequence
      const [resCounter, resLog] = await Promise.all([
        swCounter.check(counterKey, limit, windowSeconds, 1),
        swLog.check(logKey, limit, windowSeconds, 1),
      ]);

      if (resCounter.allowed) counterAllowed++;
      if (resLog.allowed) logAllowed++;

      // Small jitter between requests (0 to 40ms)
      const delay = (i % 5 === 0) ? 60 : (i % 3 === 0) ? 20 : 5;
      await sleep(delay);
    }

    const difference = Math.abs(counterAllowed - logAllowed);
    const errorRate = (difference / logAllowed) * 100;

    console.log(`[T4 Measurement] Total Requests: ${totalRequests}`);
    console.log(`[T4 Measurement] Exact Log Allowed: ${logAllowed}`);
    console.log(`[T4 Measurement] Sliding Counter Allowed: ${counterAllowed}`);
    console.log(`[T4 Measurement] Absolute Difference: ${difference}`);
    console.log(`[T4 Measurement] Error Rate: ${errorRate.toFixed(2)}%`);

    // Expected result: error rate measured and reported, well within acceptable bounds (<= 25%)
    expect(errorRate).toBeLessThanOrEqual(25);
  });
});
