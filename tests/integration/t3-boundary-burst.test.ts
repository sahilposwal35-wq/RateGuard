import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanRedis, getTestRedis, teardownAll, sleep } from '../helpers.js';
import { FixedWindowAlgorithm } from '../../src/algorithms/fixed-window.js';
import { SlidingWindowAlgorithm } from '../../src/algorithms/sliding-window.js';
import type { Redis } from 'ioredis';

describe('T3: Fixed Window Boundary Burst vs Sliding Window Counter', () => {
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
   * Helper to synchronize with Redis clock to hit the end of a window
   */
  async function waitForWindowBoundary(windowSeconds: number, targetRemainingMs: number): Promise<void> {
    const windowMs = windowSeconds * 1000;
    while (true) {
      const time = await redis.time();
      const nowMs = parseInt(time[0], 10) * 1000 + Math.floor(parseInt(time[1], 10) / 1000);
      const elapsedInWindow = nowMs % windowMs;
      const remainingInWindow = windowMs - elapsedInWindow;

      if (remainingInWindow <= targetRemainingMs && remainingInWindow > 50) {
        return;
      }
      await sleep(25);
    }
  }

  it('demonstrates fixed window boundary burst admitting up to 2x limit across window edge', async () => {
    const algo = new FixedWindowAlgorithm();
    const limit = 10;
    const windowSeconds = 2; // 2-second window
    const key = 'test:fw:boundary';

    // Wait until ~250ms before window end
    await waitForWindowBoundary(windowSeconds, 350);

    // Burst 1: Send 10 requests at the end of the current window
    let admittedFirstWindow = 0;
    for (let i = 0; i < limit; i++) {
      const res = await algo.check(key, limit, windowSeconds, 1);
      if (res.allowed) admittedFirstWindow++;
    }
    expect(admittedFirstWindow).toBe(limit);

    // Wait 450ms to cross into the next window
    await sleep(450);

    // Burst 2: Immediately send 10 more requests at start of next window
    let admittedSecondWindow = 0;
    for (let i = 0; i < limit; i++) {
      const res = await algo.check(key, limit, windowSeconds, 1);
      if (res.allowed) admittedSecondWindow++;
    }
    expect(admittedSecondWindow).toBe(limit);

    // Total admitted across the boundary interval (~500ms) is 20 (2x the limit of 10!)
    const totalAdmitted = admittedFirstWindow + admittedSecondWindow;
    expect(totalAdmitted).toBe(20);
    expect(totalAdmitted).toBeGreaterThan(limit);
  });

  it('demonstrates that sliding window counter mitigates boundary burst', async () => {
    const algo = new SlidingWindowAlgorithm();
    const limit = 10;
    const windowSeconds = 2; // 2-second window
    const key = 'test:sw:boundary';

    // Wait until ~250ms before window end
    await waitForWindowBoundary(windowSeconds, 350);

    // Burst 1: Send 10 requests at the end of the current window
    let admittedFirstWindow = 0;
    for (let i = 0; i < limit; i++) {
      const res = await algo.check(key, limit, windowSeconds, 1);
      if (res.allowed) admittedFirstWindow++;
    }
    expect(admittedFirstWindow).toBe(limit);

    // Wait 450ms to cross into next window (now ~10-20% into next window)
    await sleep(450);

    // Burst 2: Try to send 10 requests at start of next window
    let admittedSecondWindow = 0;
    for (let i = 0; i < limit; i++) {
      const res = await algo.check(key, limit, windowSeconds, 1);
      if (res.allowed) admittedSecondWindow++;
    }

    // Sliding window counter factors in the previous window's weight (~80-90%).
    // Therefore, it refuses to admit a second full burst!
    expect(admittedSecondWindow).toBeLessThanOrEqual(3);
    const totalAdmitted = admittedFirstWindow + admittedSecondWindow;
    // Total across boundary is far below 2x (13 <= 20)
    expect(totalAdmitted).toBeLessThan(15);
  });
});
