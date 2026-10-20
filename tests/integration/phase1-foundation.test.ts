import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnv, cleanAll, getTestPool, teardownAll, getTestRedis } from '../helpers.js';
import { resetEnvCache } from '../../src/config/env.js';
import { resolveIdentity } from '../../src/identity/resolver.js';
import { generateApiKey, hashApiKey, constantTimeCompare } from '../../src/identity/keys.js';
import type { FastifyInstance } from 'fastify';

describe('Phase 1: Foundation', () => {
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

  it('creates and manages plans through admin API', async () => {
    // 1. Create a plan
    const resCreate = await app.inject({
      method: 'POST',
      url: '/admin/v1/plans',
      payload: {
        name: 'standard',
        quota_limit: 50000,
        quota_mode: 'exact',
      },
    });
    expect(resCreate.statusCode).toBe(201);
    const plan = resCreate.json();
    expect(plan.name).toBe('standard');
    expect(plan.quota_mode).toBe('exact');

    // 2. Conflict on duplicate name
    const resDup = await app.inject({
      method: 'POST',
      url: '/admin/v1/plans',
      payload: { name: 'standard' },
    });
    expect(resDup.statusCode).toBe(409);

    // 3. Get plans
    const resList = await app.inject({
      method: 'GET',
      url: '/admin/v1/plans',
    });
    expect(resList.statusCode).toBe(200);
    expect(resList.json().length).toBe(1);

    // 4. Update plan
    const resUpdate = await app.inject({
      method: 'PUT',
      url: `/admin/v1/plans/${plan.id}`,
      payload: { quota_limit: 75000 },
    });
    expect(resUpdate.statusCode).toBe(200);
    expect(resUpdate.json().quota_limit).toBe('75000');
  });

  it('creates policies with validation (burst required for token bucket)', async () => {
    // Create plan first
    const resPlan = await app.inject({
      method: 'POST',
      url: '/admin/v1/plans',
      payload: { name: 'premium' },
    });
    const plan = resPlan.json();

    // Invalid policy: token_bucket without burst
    const resInvalid = await app.inject({
      method: 'POST',
      url: '/admin/v1/policies',
      payload: {
        plan_id: parseInt(plan.id, 10),
        route_pattern: '/v1/charge',
        algorithm: 'token_bucket',
        limit_units: 100,
        window_seconds: 60,
      },
    });
    expect(resInvalid.statusCode).toBe(400);

    // Valid policy with burst
    const resValid = await app.inject({
      method: 'POST',
      url: '/admin/v1/policies',
      payload: {
        plan_id: parseInt(plan.id, 10),
        route_pattern: '/v1/charge',
        algorithm: 'token_bucket',
        limit_units: 100,
        window_seconds: 60,
        burst: 120,
      },
    });
    expect(resValid.statusCode).toBe(201);
    expect(resValid.json().burst).toBe('120');
  });

  it('issues an API key, shows secret once, stores SHA-256 hash, and verifies via constant-time compare', async () => {
    // 1. Create plan and client
    const resPlan = await app.inject({
      method: 'POST',
      url: '/admin/v1/plans',
      payload: { name: 'key-test-plan' },
    });
    const plan = resPlan.json();

    const resClient = await app.inject({
      method: 'POST',
      url: '/admin/v1/clients',
      payload: { name: 'Acme Corp', plan_id: parseInt(plan.id, 10) },
    });
    const client = resClient.json();

    // 2. Issue API key
    const resKey = await app.inject({
      method: 'POST',
      url: `/admin/v1/clients/${client.id}/api-keys`,
    });
    expect(resKey.statusCode).toBe(201);
    const keyData = resKey.json();
    expect(keyData.api_key).toMatch(/^rg_live_[a-f0-9]{64}$/);

    // 3. Verify key is NOT in list endpoint (only id and status)
    const resList = await app.inject({
      method: 'GET',
      url: `/admin/v1/clients/${client.id}/api-keys`,
    });
    expect(resList.statusCode).toBe(200);
    expect(resList.json()[0].api_key).toBeUndefined();

    // 4. Resolve identity with plain key
    const resolved = await resolveIdentity(keyData.api_key);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.identity.clientId).toBe(parseInt(client.id, 10));
      expect(resolved.identity.clientName).toBe('Acme Corp');
    }

    // 5. Unknown key resolution
    const unknown = await resolveIdentity('rg_live_unknownunknownunknownunknown1234');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.reason).toBe('unknown_key');
    }

    // 6. Revoke key
    const resRevoke = await app.inject({
      method: 'POST',
      url: `/admin/v1/api-keys/${keyData.id}/revoke`,
    });
    expect(resRevoke.statusCode).toBe(200);

    // 7. Revoked key resolution
    const { clearIdentityCache } = await import('../../src/identity/resolver.js');
    clearIdentityCache();
    const revoked = await resolveIdentity(keyData.api_key);
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect(revoked.reason).toBe('key_revoked');
    }
  });

  it('constant-time comparison verifies hashes securely', () => {
    const key = generateApiKey();
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    const hash3 = hashApiKey(key + 'x');

    expect(constantTimeCompare(hash1, hash2)).toBe(true);
    expect(constantTimeCompare(hash1, hash3)).toBe(false);
    expect(constantTimeCompare(hash1, Buffer.from('short'))).toBe(false);
  });
});
