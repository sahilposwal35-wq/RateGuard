import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanAll, teardownAll, createTestSetup } from '../helpers.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loadSnapshot } from '../../src/config/snapshot.js';
import { buildApp } from '../../src/server.js';
import { buildDemoApp } from '../../demo-api/server.js';
import type { FastifyInstance } from 'fastify';

describe('Demo API with Limiter Middleware (Phase 7)', () => {
  let rateGuardApp: FastifyInstance;
  let demoApp: FastifyInstance;
  let rateGuardPort: number;

  beforeAll(async () => {
    await setupTestEnv();
    resetEnvCache();
    const { getRedis } = await import('../../src/config/redis.js');
    const redis = getRedis();
    try { await redis.connect(); } catch {}
    const { runMigrations } = await import('../../src/config/database.js');
    await runMigrations();
    await loadSnapshot();

    rateGuardApp = await buildApp();
    // Start RateGuard on dynamic port
    const address = await rateGuardApp.listen({ port: 0, host: '127.0.0.1' });
    const portMatch = address.match(/:(\d+)$/);
    rateGuardPort = portMatch ? parseInt(portMatch[1], 10) : 3000;

    demoApp = buildDemoApp({
      rateGuardUrl: `http://127.0.0.1:${rateGuardPort}`,
      serviceToken: 'test-service-token',
    });
  });

  afterAll(async () => {
    if (demoApp) await demoApp.close();
    if (rateGuardApp) await rateGuardApp.close();
    await teardownAll();
  });

  beforeEach(async () => {
    await cleanAll();
    await loadSnapshot();
  });

  it('allows requests within limit and returns 429 with Retry-After when exceeded', async () => {
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 2,
      burst: 2,
      windowSeconds: 60,
      routePattern: 'GET /api/v1/resource',
    });
    await loadSnapshot();

    // 1. Request 1: Allowed -> 200 OK
    const res1 = await demoApp.inject({
      method: 'GET',
      url: '/api/v1/resource',
      headers: {
        'x-api-key': setup.apiKey,
      },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.headers['x-ratelimit-remaining']).toBe('1');
    expect(res1.json().data).toBe('Valuable protected resource content');

    // 2. Request 2: Allowed -> 200 OK
    const res2 = await demoApp.inject({
      method: 'GET',
      url: '/api/v1/resource',
      headers: {
        'x-api-key': setup.apiKey,
      },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['x-ratelimit-remaining']).toBe('0');

    // 3. Request 3: Denied -> 429 Too Many Requests with Retry-After
    const res3 = await demoApp.inject({
      method: 'GET',
      url: '/api/v1/resource',
      headers: {
        'x-api-key': setup.apiKey,
      },
    });
    expect(res3.statusCode).toBe(429);
    expect(res3.headers['retry-after']).toBeDefined();
    expect(parseInt(res3.headers['retry-after'] as string, 10)).toBeGreaterThanOrEqual(1);
    expect(res3.json().error).toBe('Too Many Requests');
    expect(res3.json().reason).toBe('rate_limited');
  });
});
