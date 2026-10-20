import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanAll, teardownAll, createTestSetup, sleep } from '../helpers.js';
import { resetEnvCache } from '../../src/config/env.js';
import type { FastifyInstance } from 'fastify';

describe('T5 & T7: Token Bucket Integration Tests', () => {
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

  it('T5: Token bucket burst and refill', async () => {
    // Limit = 10 per 5s (2 tokens/sec), burst = 10
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 10,
      windowSeconds: 5,
      burst: 10,
      routePattern: 'POST /v1/burst',
    });
    const { loadSnapshot } = await import('../../src/config/snapshot.js');
    await loadSnapshot();

    // 1. Send 10 rapid requests - all should be allowed by burst capacity
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: {
          api_key: setup.apiKey,
          route: 'POST /v1/burst',
          cost: 1,
        },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.allowed).toBe(true);
      expect(data.reason).toBe('ok');
    }

    // 2. 11th request should be denied immediately
    const resDenied = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: {
        api_key: setup.apiKey,
        route: 'POST /v1/burst',
        cost: 1,
      },
    });
    expect(resDenied.statusCode).toBe(200);
    const deniedData = resDenied.json();
    expect(deniedData.allowed).toBe(false);
    expect(deniedData.reason).toBe('rate_limited');
    expect(deniedData.retry_after_ms).toBeGreaterThan(0);

    // 3. Wait for refill (at 2 tokens/sec, wait 1.1s for ~2 tokens)
    await sleep(1100);

    // 4. Request should now be allowed again
    const resRefilled = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: {
        api_key: setup.apiKey,
        route: 'POST /v1/burst',
        cost: 1,
      },
    });
    expect(resRefilled.statusCode).toBe(200);
    expect(resRefilled.json().allowed).toBe(true);
    expect(resRefilled.json().reason).toBe('ok');
  });

  it('T7: Cost-weighted requests consume units correctly', async () => {
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: 10,
      windowSeconds: 60,
      burst: 10,
      routePattern: 'POST /v1/heavy',
    });
    const { loadSnapshot } = await import('../../src/config/snapshot.js');
    await loadSnapshot();

    // 1. Cost 3
    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/heavy', cost: 3 },
    });
    expect(r1.json().allowed).toBe(true);
    expect(r1.json().remaining).toBe(7);

    // 2. Cost 3
    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/heavy', cost: 3 },
    });
    expect(r2.json().allowed).toBe(true);
    expect(r2.json().remaining).toBe(4);

    // 3. Cost 3
    const r3 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/heavy', cost: 3 },
    });
    expect(r3.json().allowed).toBe(true);
    expect(r3.json().remaining).toBe(1);

    // 4. Cost 3 - only 1 remaining, must be denied
    const r4 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/heavy', cost: 3 },
    });
    expect(r4.json().allowed).toBe(false);
    expect(r4.json().reason).toBe('rate_limited');

    // 5. Cost 1 - exactly 1 token remaining, must be allowed
    const r5 = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { api_key: setup.apiKey, route: 'POST /v1/heavy', cost: 1 },
    });
    expect(r5.json().allowed).toBe(true);
    expect(r5.json().remaining).toBe(0);
  });
});
