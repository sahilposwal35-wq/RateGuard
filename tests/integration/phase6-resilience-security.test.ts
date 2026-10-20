import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanAll, getTestPool, teardownAll, createTestSetup, getTestRedis } from '../helpers.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loadSnapshot } from '../../src/config/snapshot.js';
import { setRedisInstance, getRedis } from '../../src/config/redis.js';
import { closePool } from '../../src/config/database.js';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';

describe('Phase 6: Resilience & Security (T12, T13, T17)', () => {
  let app: FastifyInstance;
  let healthyRedis: Redis;

  beforeAll(async () => {
    await setupTestEnv();
    resetEnvCache();
    healthyRedis = getTestRedis();
    try { await healthyRedis.connect(); } catch {}
    const { runMigrations } = await import('../../src/config/database.js');
    await runMigrations();
    await loadSnapshot();
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
  });

  afterAll(async () => {
    setRedisInstance(healthyRedis);
    if (app) await app.close();
    await teardownAll();
  });

  beforeEach(async () => {
    setRedisInstance(healthyRedis);
    await cleanAll();
    await loadSnapshot();
  });

  it('T12: When Redis is down, fail-open allows (degraded: true) and fail-closed denies (limiter_unavailable, degraded: true)', async () => {
    const pool = getTestPool();

    // 1. Setup plan
    const planRes = await pool.query("INSERT INTO plans (name) VALUES ('resilience-plan') RETURNING id");
    const planId = parseInt(planRes.rows[0].id, 10);

    // Policy A: fail_mode = 'open'
    await pool.query(
      `INSERT INTO policies (plan_id, route_pattern, algorithm, limit_units, window_seconds, burst, fail_mode)
       VALUES ($1, 'POST /v1/open', 'token_bucket', 10, 60, 10, 'open')`,
      [planId]
    );

    // Policy B: fail_mode = 'closed'
    await pool.query(
      `INSERT INTO policies (plan_id, route_pattern, algorithm, limit_units, window_seconds, burst, fail_mode)
       VALUES ($1, 'POST /v1/closed', 'token_bucket', 10, 60, 10, 'closed')`,
      [planId]
    );

    // Client & Key
    const clientRes = await pool.query(
      'INSERT INTO clients (name, plan_id) VALUES ($1, $2) RETURNING id',
      ['FailoverClient', planId]
    );
    const clientId = parseInt(clientRes.rows[0].id, 10);

    const { generateApiKey, hashApiKey } = await import('../../src/identity/keys.js');
    const apiKey = generateApiKey();
    await pool.query('INSERT INTO api_keys (client_id, key_hash) VALUES ($1, $2)', [
      clientId,
      hashApiKey(apiKey),
    ]);
    await loadSnapshot();

    // Verify both work normally first
    const normA = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: apiKey, route: 'POST /v1/open', cost: 1 },
    });
    expect(normA.json().allowed).toBe(true);
    expect(normA.json().degraded).toBe(false);

    // 2. Simulate Redis outage: point to non-existent port with immediate timeout
    const brokenRedis = new Redis('redis://127.0.0.1:59999', {
      maxRetriesPerRequest: 0,
      connectTimeout: 50,
      commandTimeout: 50,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    setRedisInstance(brokenRedis);

    // 3. Test policy with fail_mode 'open' -> MUST allow with degraded: true
    const resOpen = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: apiKey, route: 'POST /v1/open', cost: 1 },
    });
    expect(resOpen.statusCode).toBe(200);
    const dataOpen = resOpen.json();
    expect(dataOpen.allowed).toBe(true);
    expect(dataOpen.reason).toBe('ok');
    expect(dataOpen.degraded).toBe(true);

    // 4. Test policy with fail_mode 'closed' -> MUST deny with limiter_unavailable and degraded: true
    const resClosed = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: apiKey, route: 'POST /v1/closed', cost: 1 },
    });
    expect(resClosed.statusCode).toBe(200);
    const dataClosed = resClosed.json();
    expect(dataClosed.allowed).toBe(false);
    expect(dataClosed.reason).toBe('limiter_unavailable');
    expect(dataClosed.degraded).toBe(true);

    // 5. Readiness endpoint reports degraded
    const readyRes = await app.inject({ method: 'GET', url: '/readyz' });
    expect(readyRes.json().degraded).toBe(true);
    expect(readyRes.json().status).toBe('degraded');

    // 6. Clean recovery when Redis returns
    await brokenRedis.quit().catch(() => {});
    setRedisInstance(healthyRedis);

    const resRecovered = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: apiKey, route: 'POST /v1/open', cost: 1 },
    });
    expect(resRecovered.json().allowed).toBe(true);
    expect(resRecovered.json().degraded).toBe(false);
  });

  it('T13: When PostgreSQL is down, cached config and identity continue serving decisions', async () => {
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 20,
      burst: 20,
      windowSeconds: 60,
      routePattern: 'GET /pg-down-test',
    });
    await loadSnapshot();

    // Warm up cache so client & policy are in memory
    const warmRes = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'GET /pg-down-test', cost: 1 },
    });
    expect(warmRes.json().allowed).toBe(true);

    // Simulate PostgreSQL outage by closing connection pool
    await closePool();

    // Decisions still succeed from memory cache! (PID section 13.5)
    const resDuringOutage = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'GET /pg-down-test', cost: 1 },
    });
    expect(resDuringOutage.statusCode).toBe(200);
    expect(resDuringOutage.json().allowed).toBe(true);
    expect(resDuringOutage.json().reason).toBe('ok');
  });

  it('T17: Security checks: service token, admin token, input limits, and key privacy in logs', async () => {
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 10,
      burst: 10,
      windowSeconds: 60,
      routePattern: 'POST /v1/sec-test',
    });
    await loadSnapshot();

    // 1. Invalid service token rejected with 401
    const resBadToken = await app.inject({
      method: 'POST',
      url: '/v1/check',
      headers: {
        authorization: 'Bearer wrong-service-token',
      },
      payload: { api_key: setup.apiKey, route: 'POST /v1/sec-test', cost: 1 },
    });
    expect(resBadToken.statusCode).toBe(401);
    expect(resBadToken.json().code).toBe('UNAUTHORIZED');

    // 2. Valid service token accepted
    const resGoodToken = await app.inject({
      method: 'POST',
      url: '/v1/check',
      headers: {
        authorization: 'Bearer test-service-token',
      },
      payload: { api_key: setup.apiKey, route: 'POST /v1/sec-test', cost: 1 },
    });
    expect(resGoodToken.statusCode).toBe(200);
    expect(resGoodToken.json().allowed).toBe(true);

    // 3. Invalid admin token rejected with 401
    const resBadAdmin = await app.inject({
      method: 'POST',
      url: '/admin/v1/plans',
      headers: {
        authorization: 'Bearer wrong-admin-token',
      },
      payload: { name: 'unauthorized-plan' },
    });
    expect(resBadAdmin.statusCode).toBe(401);
    expect(resBadAdmin.json().code).toBe('UNAUTHORIZED');

    // 4. Input validation: cost exceeds maximum
    const resExcessCost = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/sec-test', cost: 9999 },
    });
    expect(resExcessCost.statusCode).toBe(400);

    // 5. Input validation: route exceeds maximum length
    const longRoute = 'POST /' + 'a'.repeat(600);
    const resLongRoute = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: longRoute, cost: 1 },
    });
    expect(resLongRoute.statusCode).toBe(400);

    // 6. Log hygiene: intercept stdout to confirm raw api_key is NEVER written to logs (PID 17)
    const logs: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any, ...args: any[]) => {
      logs.push(String(chunk));
      return originalWrite.apply(process.stdout, [chunk, ...args]);
    }) as any;

    try {
      await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { api_key: setup.apiKey, route: 'POST /v1/sec-test', cost: 1 },
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    const allOutput = logs.join('');
    // Confirm raw api_key string never appears in any decision log
    expect(allOutput).not.toContain(setup.apiKey);
  });
});
