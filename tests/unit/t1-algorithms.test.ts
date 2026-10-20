// T1: Unit tests of each algorithm with controlled time
// Validates hand-calculated sequences match actual results

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import { setupTestEnv, cleanRedis, getTestRedis, teardownAll } from '../helpers.js';

// We test algorithms directly against Redis with known states
// Since Lua scripts use Redis TIME, we can't inject time directly
// but we can verify the behavior with sequential calls and timing

describe('T1: Algorithm unit tests with controlled sequences', () => {
  let redis: Redis;

  beforeAll(async () => {
    await setupTestEnv();
    redis = getTestRedis();
    // Dynamically import after env is set
    await import('../../src/config/redis.js').then(m => m.setRedisInstance(redis));
  });

  afterAll(async () => {
    await teardownAll();
  });

  beforeEach(async () => {
    await cleanRedis();
  });

  describe('Token Bucket', () => {
    it('allows requests up to capacity then denies', async () => {
      const { TokenBucketAlgorithm } = await import('../../src/algorithms/token-bucket.js');
      const algo = new TokenBucketAlgorithm();

      // capacity=5, limit=5/60s, cost=1
      const results = [];
      for (let i = 0; i < 7; i++) {
        results.push(await algo.check('t1-tb-basic', 5, 60, 1, { burst: 5 }));
      }

      // First 5 should be allowed
      for (let i = 0; i < 5; i++) {
        expect(results[i].allowed).toBe(true);
        expect(results[i].limit).toBe(5);
      }
      // 6th and 7th should be denied
      expect(results[5].allowed).toBe(false);
      expect(results[6].allowed).toBe(false);
      expect(results[5].retryAfterMs).toBeGreaterThan(0);
    });

    it('handles cost correctly', async () => {
      const { TokenBucketAlgorithm } = await import('../../src/algorithms/token-bucket.js');
      const algo = new TokenBucketAlgorithm();

      // capacity=10, cost=3
      const r1 = await algo.check('t1-tb-cost', 10, 60, 3, { burst: 10 });
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(7);

      const r2 = await algo.check('t1-tb-cost', 10, 60, 3, { burst: 10 });
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(4);

      const r3 = await algo.check('t1-tb-cost', 10, 60, 3, { burst: 10 });
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(1);

      // Only 1 token left, cost=3 should fail
      const r4 = await algo.check('t1-tb-cost', 10, 60, 3, { burst: 10 });
      expect(r4.allowed).toBe(false);
    });

    it('refills tokens over time', async () => {
      const { TokenBucketAlgorithm } = await import('../../src/algorithms/token-bucket.js');
      const algo = new TokenBucketAlgorithm();

      // capacity=5, rate=5/1s=5/s, exhaust all
      for (let i = 0; i < 5; i++) {
        await algo.check('t1-tb-refill', 5, 1, 1, { burst: 5 });
      }
      const denied = await algo.check('t1-tb-refill', 5, 1, 1, { burst: 5 });
      expect(denied.allowed).toBe(false);

      // Wait for refill (at 5/s, should refill 5 tokens in ~1s)
      await new Promise(r => setTimeout(r, 1100));

      const afterRefill = await algo.check('t1-tb-refill', 5, 1, 1, { burst: 5 });
      expect(afterRefill.allowed).toBe(true);
    });
  });

  describe('Fixed Window', () => {
    it('allows requests up to limit then denies within same window', async () => {
      const { FixedWindowAlgorithm } = await import('../../src/algorithms/fixed-window.js');
      const algo = new FixedWindowAlgorithm();

      const results = [];
      for (let i = 0; i < 7; i++) {
        results.push(await algo.check('t1-fw-basic', 5, 60, 1));
      }

      for (let i = 0; i < 5; i++) {
        expect(results[i].allowed).toBe(true);
      }
      expect(results[5].allowed).toBe(false);
      expect(results[6].allowed).toBe(false);
      expect(results[5].retryAfterMs).toBeGreaterThan(0);
    });

    it('handles cost correctly', async () => {
      const { FixedWindowAlgorithm } = await import('../../src/algorithms/fixed-window.js');
      const algo = new FixedWindowAlgorithm();

      const r1 = await algo.check('t1-fw-cost', 10, 60, 4);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(6);

      const r2 = await algo.check('t1-fw-cost', 10, 60, 4);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(2);

      // Only 2 left, cost=4 should fail
      const r3 = await algo.check('t1-fw-cost', 10, 60, 4);
      expect(r3.allowed).toBe(false);
    });
  });

  describe('Sliding Window Counter', () => {
    it('allows requests up to limit then denies', async () => {
      const { SlidingWindowAlgorithm } = await import('../../src/algorithms/sliding-window.js');
      const algo = new SlidingWindowAlgorithm();

      const results = [];
      for (let i = 0; i < 7; i++) {
        results.push(await algo.check('t1-sw-basic', 5, 60, 1));
      }

      for (let i = 0; i < 5; i++) {
        expect(results[i].allowed).toBe(true);
      }
      expect(results[5].allowed).toBe(false);
      expect(results[6].allowed).toBe(false);
    });
  });

  describe('Sliding Window Log (exact baseline)', () => {
    it('allows requests up to limit and tracks exactly', async () => {
      const { SlidingWindowLogAlgorithm } = await import('../../src/algorithms/sliding-window-log.js');
      const algo = new SlidingWindowLogAlgorithm();

      const results = [];
      for (let i = 0; i < 7; i++) {
        results.push(await algo.check('t1-swl-basic', 5, 60, 1));
      }

      for (let i = 0; i < 5; i++) {
        expect(results[i].allowed).toBe(true);
      }
      expect(results[5].allowed).toBe(false);
    });
  });
});
