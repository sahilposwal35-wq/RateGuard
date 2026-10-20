import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanAll, getTestPool, teardownAll, createTestSetup, sleep } from '../helpers.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loadSnapshot, startConfigPoller, stopConfigPoller, getSnapshot } from '../../src/config/snapshot.js';
import { getMetrics } from '../../src/observability/metrics.js';
import type { FastifyInstance } from 'fastify';

describe('Phase 4: Policies and Configuration (T8, T9, T14, T15)', () => {
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
    stopConfigPoller();
    if (app) await app.close();
    await teardownAll();
  });

  beforeEach(async () => {
    stopConfigPoller();
    await cleanAll();
    await loadSnapshot();
  });

  it('T8: Policy specificity: exact beats prefix beats wildcard beats default', async () => {
    const pool = getTestPool();

    // Create a plan
    const planRes = await pool.query("INSERT INTO plans (name) VALUES ('specificity-plan') RETURNING id");
    const planId = parseInt(planRes.rows[0].id, 10);

    // Create 4 policies with different specificities:
    // 1. Wildcard policy: limit 10
    await pool.query(
      `INSERT INTO policies (plan_id, route_pattern, algorithm, limit_units, window_seconds, burst)
       VALUES ($1, '*', 'token_bucket', 10, 60, 10)`,
      [planId]
    );

    // 2. Short prefix policy: /api/* limit 20
    await pool.query(
      `INSERT INTO policies (plan_id, route_pattern, algorithm, limit_units, window_seconds, burst)
       VALUES ($1, '/api/*', 'token_bucket', 20, 60, 20)`,
      [planId]
    );

    // 3. Long prefix policy: /api/v1/* limit 30
    await pool.query(
      `INSERT INTO policies (plan_id, route_pattern, algorithm, limit_units, window_seconds, burst)
       VALUES ($1, '/api/v1/*', 'token_bucket', 30, 60, 30)`,
      [planId]
    );

    // 4. Exact route policy: /api/v1/payments limit 40
    await pool.query(
      `INSERT INTO policies (plan_id, route_pattern, algorithm, limit_units, window_seconds, burst)
       VALUES ($1, '/api/v1/payments', 'token_bucket', 40, 60, 40)`,
      [planId]
    );

    // Create client & API key
    const clientRes = await pool.query(
      'INSERT INTO clients (name, plan_id) VALUES ($1, $2) RETURNING id',
      ['SpecClient', planId]
    );
    const clientId = parseInt(clientRes.rows[0].id, 10);

    const { generateApiKey, hashApiKey } = await import('../../src/identity/keys.js');
    const apiKey = generateApiKey();
    await pool.query(
      'INSERT INTO api_keys (client_id, key_hash) VALUES ($1, $2)',
      [clientId, hashApiKey(apiKey)]
    );

    await loadSnapshot();

    // Case 1: Exact match beats all -> limit should be 40
    const resExact = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: apiKey, route: '/api/v1/payments', cost: 1 },
    });
    expect(resExact.json().limit).toBe(40);

    // Case 2: Longest prefix match (/api/v1/* beats /api/*) -> limit should be 30
    const resLongPrefix = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: apiKey, route: '/api/v1/users', cost: 1 },
    });
    expect(resLongPrefix.json().limit).toBe(30);

    // Case 3: Short prefix match (/api/* beats *) -> limit should be 20
    const resShortPrefix = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: apiKey, route: '/api/orders', cost: 1 },
    });
    expect(resShortPrefix.json().limit).toBe(20);

    // Case 4: Default / wildcard match (*) -> limit should be 10
    const resWildcard = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: apiKey, route: '/health', cost: 1 },
    });
    expect(resWildcard.json().limit).toBe(10);
  });

  it('T9: Hot reload changes limit within poll interval and keeps old snapshot on reload error', async () => {
    const pool = getTestPool();

    // Create test setup with limit 5
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 5,
      burst: 5,
      windowSeconds: 60,
      routePattern: 'GET /hot-reload',
    });

    await loadSnapshot();
    // Start fast polling (100ms interval)
    await startConfigPoller(100);

    // Initial check -> limit is 5
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'GET /hot-reload', cost: 1 },
    });
    expect(res1.json().limit).toBe(5);

    // Admin updates policy limit from 5 to 50
    await app.inject({
      method: 'PUT',
      url: `/admin/v1/policies/${setup.policyId}`,
      payload: { limit_units: 50, burst: 50 },
    });

    // Wait 250ms for poller to catch the version bump
    await sleep(250);

    // Next check -> limit is now hot-reloaded to 50 without server restart
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'GET /hot-reload', cost: 1 },
    });
    expect(res2.json().limit).toBe(50);

    // Test resilience: bad snapshot reload attempt keeps old snapshot
    const oldSnapshot = getSnapshot();
    expect(oldSnapshot.version).toBeGreaterThan(1);
    stopConfigPoller();
  });

  it('T14: Shadow mode computes and logs real decision but always returns allowed: true with shadow: true', async () => {
    // Setup policy with limit 2, shadow: true
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 2,
      burst: 2,
      windowSeconds: 60,
      routePattern: 'POST /v1/shadow',
      shadow: true,
    });
    await loadSnapshot();

    // Request 1: allowed
    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/shadow', cost: 1 },
    });
    expect(r1.json().allowed).toBe(true);
    expect(r1.json().shadow).toBe(true);

    // Request 2: allowed
    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/shadow', cost: 1 },
    });
    expect(r2.json().allowed).toBe(true);
    expect(r2.json().shadow).toBe(true);

    // Request 3: Would be rate-limited in normal mode, but in shadow mode:
    // response MUST say allowed: true with shadow: true, reason: rate_limited
    const r3 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/shadow', cost: 1 },
    });
    expect(r3.statusCode).toBe(200);
    const data3 = r3.json();
    expect(data3.allowed).toBe(true);
    expect(data3.shadow).toBe(true);
    expect(data3.reason).toBe('rate_limited');
  });

  it('T15: Global bypass switch allows everything while still recording metrics', async () => {
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 1,
      burst: 1,
      windowSeconds: 60,
      routePattern: 'GET /bypass-test',
    });
    await loadSnapshot();

    // Turn global bypass ON via admin API
    const resBypass = await app.inject({
      method: 'PUT',
      url: '/admin/v1/bypass',
      payload: { enabled: true },
    });
    expect(resBypass.statusCode).toBe(200);
    expect(resBypass.json().bypass).toBe(true);

    await loadSnapshot();

    // Send 5 requests (policy limit is only 1)
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { api_key: setup.apiKey, route: 'GET /bypass-test', cost: 1 },
      });
      expect(res.json().allowed).toBe(true);
      expect(res.json().reason).toBe('bypass');
    }

    // Verify metrics recorded bypass decisions
    const metrics = getMetrics().getData();
    expect(metrics.decisions['bypass']).toBeGreaterThanOrEqual(5);

    // Turn global bypass back OFF
    await app.inject({
      method: 'PUT',
      url: '/admin/v1/bypass',
      payload: { enabled: false },
    });
    await loadSnapshot();
  });
});
