import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanAll, teardownAll, createTestSetup } from '../helpers.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loadSnapshot } from '../../src/config/snapshot.js';
import { buildApp } from '../../src/server.js';
import type { FastifyInstance } from 'fastify';

describe('T6: Multi-Instance Global Limits (Three Instances Behind Round-Robin)', () => {
  let instance1: FastifyInstance;
  let instance2: FastifyInstance;
  let instance3: FastifyInstance;
  let instances: FastifyInstance[];

  beforeAll(async () => {
    await setupTestEnv();
    resetEnvCache();
    const { getRedis } = await import('../../src/config/redis.js');
    const redis = getRedis();
    try { await redis.connect(); } catch {}
    const { runMigrations } = await import('../../src/config/database.js');
    await runMigrations();
    await loadSnapshot();

    // Create 3 independent application instances sharing the same central stores
    instance1 = await buildApp();
    instance2 = await buildApp();
    instance3 = await buildApp();
    instances = [instance1, instance2, instance3];
  });

  afterAll(async () => {
    for (const inst of instances) {
      if (inst) await inst.close();
    }
    await teardownAll();
  });

  beforeEach(async () => {
    await cleanAll();
    await loadSnapshot();
  });

  it('proves global limits hold across three instances with round-robin dispatch', async () => {
    const globalLimit = 30;
    const totalRequests = 90;

    // Token bucket with limit=30 in 60s, burst=30
    const setup = await createTestSetup({
      algorithm: 'token_bucket',
      limit: globalLimit,
      burst: globalLimit,
      windowSeconds: 60,
      routePattern: 'POST /v1/multi-inst',
    });
    await loadSnapshot();

    // Dispatch requests round-robin across instances 1, 2, 3 concurrently
    const promises = Array.from({ length: totalRequests }, (_, i) => {
      const targetInstance = instances[i % instances.length];
      return targetInstance.inject({
        method: 'POST',
        url: '/v1/check',
        payload: {
          api_key: setup.apiKey,
          route: 'POST /v1/multi-inst',
          cost: 1,
        },
      });
    });

    const responses = await Promise.all(promises);
    const results = responses.map((r) => r.json());

    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed && r.reason === 'rate_limited').length;

    console.log(`[T6 Multi-Instance] Total Requests: ${totalRequests}`);
    console.log(`[T6 Multi-Instance] Across 3 Instances Admitted: ${allowedCount}`);
    console.log(`[T6 Multi-Instance] Denied: ${deniedCount}`);

    // If instances had counted locally in-process, 3 * 30 = 90 would have been admitted!
    // Because RateGuard coordinates centrally via atomic Redis scripts:
    // Global admitted count is strictly bounded by the shared policy limit!
    expect(allowedCount).toBe(globalLimit);
    expect(deniedCount).toBe(totalRequests - globalLimit);
  });
});
