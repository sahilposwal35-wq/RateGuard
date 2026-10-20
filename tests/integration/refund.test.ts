import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanAll, teardownAll, createTestSetup } from '../helpers.js';
import { resetEnvCache } from '../../src/config/env.js';
import type { FastifyInstance } from 'fastify';

describe('Refund Logic & POST /v1/refund (FR-15)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupTestEnv();
    resetEnvCache();
    const { getRedis } = await import('../../src/config/redis.js');
    const redis = getRedis();
    try { await redis.connect(); } catch {}
    const { runMigrations } = await import('../../src/config/database.js');
    await runMigrations();
    const { loadSnapshot } = await import('../../src/config/snapshot.js');
    await loadSnapshot();
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    await teardownAll();
  });

  beforeEach(async () => {
    await cleanAll();
    const { loadSnapshot } = await import('../../src/config/snapshot.js');
    await loadSnapshot();
  });

  it('refunds tokens to a token bucket without exceeding capacity', async () => {
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 10,
      windowSeconds: 60,
      burst: 10,
      routePattern: 'POST /v1/action',
    });
    const { loadSnapshot } = await import('../../src/config/snapshot.js');
    await loadSnapshot();

    // 1. Check with cost 4 -> remaining is 6
    const resCheck = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/action', cost: 4 },
    });
    expect(resCheck.json().allowed).toBe(true);
    expect(resCheck.json().remaining).toBe(6);

    // 2. Refund 2 units -> remaining should become 8
    const resRefund1 = await app.inject({
      method: 'POST',
      url: '/v1/refund',
      payload: { api_key: setup.apiKey, route: 'POST /v1/action', cost: 2 },
    });
    expect(resRefund1.statusCode).toBe(200);
    expect(resRefund1.json().refunded).toBe(2);

    // Verify next check sees 8 - 1 = 7 remaining
    const resCheck2 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/action', cost: 1 },
    });
    expect(resCheck2.json().remaining).toBe(7);

    // 3. Refund 20 units -> capped at capacity (10), doesn't overshoot
    const resRefundCap = await app.inject({
      method: 'POST',
      url: '/v1/refund',
      payload: { api_key: setup.apiKey, route: 'POST /v1/action', cost: 20 },
    });
    expect(resRefundCap.statusCode).toBe(200);
    // At most 3 tokens could be refunded before hitting capacity 10
    expect(resRefundCap.json().refunded).toBeLessThanOrEqual(3);
  });

  it('refunds units to a fixed window without going below zero', async () => {
    const setup = await createTestSetup({
      algorithm: 'fixed_window',
      limit: 10,
      windowSeconds: 60,
      routePattern: 'POST /v1/fw-action',
    });
    const { loadSnapshot } = await import('../../src/config/snapshot.js');
    await loadSnapshot();

    // Check with cost 3
    const resCheck = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/fw-action', cost: 3 },
    });
    expect(resCheck.json().allowed).toBe(true);
    expect(resCheck.json().remaining).toBe(7);

    // Refund 2 units
    const resRefund = await app.inject({
      method: 'POST',
      url: '/v1/refund',
      payload: { api_key: setup.apiKey, route: 'POST /v1/fw-action', cost: 2 },
    });
    expect(resRefund.statusCode).toBe(200);
    expect(resRefund.json().refunded).toBe(2);

    // Check again with cost 1 -> remaining should be 8
    const resCheck2 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/fw-action', cost: 1 },
    });
    expect(resCheck2.json().remaining).toBe(8);
  });
});
