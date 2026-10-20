import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanAll, getTestPool, teardownAll, createTestSetup, sleep, getTestRedis } from '../helpers.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loadSnapshot } from '../../src/config/snapshot.js';
import { flushQuotaUsageOnce } from '../../src/quota/flusher.js';
import type { FastifyInstance } from 'fastify';

describe('Phase 5: Quota Enforcement & Verification (T10, T11, T16)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupTestEnv();
    resetEnvCache();
    const { getRedis } = await import('../../src/config/redis.js');
    const redis = getRedis();
    try { await redis.connect(); } catch {}
    const { runMigrations } = await import('../../src/config/database.js');
    await runMigrations();
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
    await loadSnapshot();
  });

  it('T10: Exact quota under high concurrency never exceeds limit', async () => {
    const quotaLimit = 20;
    const concurrentRequests = 50;

    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 100, // High rate limit so only quota restricts
      burst: 100,
      windowSeconds: 60,
      quotaLimit,
      quotaMode: 'exact',
      routePattern: 'POST /v1/exact-quota',
    });
    await loadSnapshot();

    // Fire 50 concurrent requests
    const promises = Array.from({ length: concurrentRequests }, () =>
      app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: {
          api_key: setup.apiKey,
          route: 'POST /v1/exact-quota',
          cost: 1,
        },
      })
    );

    const responses = await Promise.all(promises);
    const results = responses.map((r) => r.json());

    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed && r.reason === 'quota_exceeded').length;

    // Concurrency guarantee: exact quota NEVER over-admits
    expect(allowedCount).toBe(quotaLimit);
    expect(deniedCount).toBe(concurrentRequests - quotaLimit);

    // Verify durable usage in PostgreSQL matches exact limit
    const pool = getTestPool();
    const dbRes = await pool.query(
      'SELECT used FROM quota_usage WHERE client_id = $1',
      [setup.clientId]
    );
    expect(parseInt(dbRes.rows[0].used, 10)).toBe(quotaLimit);

    // Verify GET /v1/usage reports exact state
    const usageRes = await app.inject({
      method: 'GET',
      url: `/v1/usage/${setup.clientId}`,
    });
    expect(usageRes.statusCode).toBe(200);
    const usage = usageRes.json();
    expect(usage.used).toBe(quotaLimit);
    expect(usage.remaining).toBe(0);
    expect(usage.quota_mode).toBe('exact');
  });

  it('T11: Write-behind quota under concurrency and simulated Redis restart measures loss window and recovers cleanly', async () => {
    const quotaLimit = 50;
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 200,
      burst: 200,
      windowSeconds: 60,
      quotaLimit,
      quotaMode: 'write_behind',
      routePattern: 'POST /v1/wb-quota',
    });
    await loadSnapshot();

    // 1. Send 20 requests
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { api_key: setup.apiKey, route: 'POST /v1/wb-quota', cost: 1 },
      });
      expect(res.json().allowed).toBe(true);
    }

    // 2. Periodic flush to PostgreSQL
    const flushed = await flushQuotaUsageOnce();
    expect(flushed).toBeGreaterThan(0);

    const pool = getTestPool();
    const dbRes1 = await pool.query(
      'SELECT used FROM quota_usage WHERE client_id = $1',
      [setup.clientId]
    );
    const durableUsageBeforeRestart = parseInt(dbRes1.rows[0].used, 10);
    expect(durableUsageBeforeRestart).toBe(20);

    // 3. Send 10 more requests before next flush
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { api_key: setup.apiKey, route: 'POST /v1/wb-quota', cost: 1 },
      });
    }

    // 4. Simulate unexpected Redis restart (ephemeral cache loss)
    const redis = getTestRedis();
    await redis.flushall();

    // Documented loss window measurement (PID section 13.4 step 4):
    // Usage since the last flush (10 requests) was in volatile Redis memory
    const lostRequests = 10;
    console.log(`[T11 Measurement] Documented Write-Behind Loss Window: ${lostRequests} un-flushed units lost on simulated crash`);

    // 5. Subsequent request triggers rehydration from PostgreSQL with SET NX
    const resAfterRestart = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/wb-quota', cost: 1 },
    });
    expect(resAfterRestart.json().allowed).toBe(true);

    // Rehydrated usage should start at durable (20) + 1 = 21
    expect(resAfterRestart.json().quota.used).toBe(durableUsageBeforeRestart + 1);

    // 6. Verify GET /v1/usage includes loss window note for write_behind plans
    const usageRes = await app.inject({
      method: 'GET',
      url: `/v1/usage/${setup.clientId}`,
    });
    expect(usageRes.json().loss_window_note).toContain('Usage since the last periodic flush may be lost');
  });

  it('T16: Refund path returns consumed rate units when quota denies request', async () => {
    // Plan with quota = 3, but rate limit = 10
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 10,
      burst: 10,
      windowSeconds: 60,
      quotaLimit: 3,
      quotaMode: 'exact',
      routePattern: 'POST /v1/refund-test',
    });
    await loadSnapshot();

    // Send 3 requests to exhaust quota
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { api_key: setup.apiKey, route: 'POST /v1/refund-test', cost: 1 },
      });
      expect(res.json().allowed).toBe(true);
    }

    // At this point:
    // Rate tokens remaining: 10 - 3 = 7
    // Quota remaining: 3 - 3 = 0

    // Send 4th request: rate passes (7 tokens available), but quota denies!
    const resDenied = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/refund-test', cost: 1 },
    });

    const deniedBody = resDenied.json();
    expect(deniedBody.allowed).toBe(false);
    expect(deniedBody.reason).toBe('quota_exceeded');

    // Due to refund logic (PID 13.1 step 7 & PID 13.2), the rate token consumed during step 6
    // is refunded back because the request was denied by quota.
    // Verify rate tokens remaining is still 7 (refunded), NOT 6!
    expect(deniedBody.remaining).toBe(7);

    // Verify another check attempt still sees 7 rate tokens remaining
    const resCheckAgain = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/refund-test', cost: 1 },
    });
    expect(resCheckAgain.json().remaining).toBe(7);
  });
});
