import { Redis } from 'ioredis';
import pg from 'pg';

// Test database and redis configuration
export const TEST_CONFIG = {
  REDIS_URL: 'redis://127.0.0.1:6379',
  DATABASE_URL: 'postgres://rateguard:rateguard@localhost:5432/rateguard',
  SERVICE_TOKEN: 'test-service-token',
  ADMIN_TOKEN: 'test-admin-token',
};

let testRedis: Redis | null = null;
let testPool: pg.Pool | null = null;

export function getTestRedis(): Redis {
  if (!testRedis) {
    testRedis = new Redis(TEST_CONFIG.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }
  return testRedis;
}

export function getTestPool(): pg.Pool {
  if (!testPool) {
    testPool = new pg.Pool({
      connectionString: TEST_CONFIG.DATABASE_URL,
      max: 5,
    });
  }
  return testPool;
}

export async function setupTestEnv(): Promise<void> {
  // Set environment variables for the app
  process.env.REDIS_URL = TEST_CONFIG.REDIS_URL;
  process.env.DATABASE_URL = TEST_CONFIG.DATABASE_URL;
  process.env.SERVICE_TOKEN = TEST_CONFIG.SERVICE_TOKEN;
  process.env.ADMIN_TOKEN = TEST_CONFIG.ADMIN_TOKEN;
  process.env.LOG_LEVEL = 'error';
  process.env.CONFIG_POLL_INTERVAL_MS = '60000'; // Long poll for tests
  process.env.FLUSHER_INTERVAL_MS = '60000';
  process.env.NODE_ENV = 'test';
}

export async function cleanDatabase(): Promise<void> {
  const pool = getTestPool();
  await pool.query('DELETE FROM quota_usage');
  await pool.query('DELETE FROM api_keys');
  await pool.query('DELETE FROM policies');
  await pool.query('DELETE FROM clients');
  await pool.query('DELETE FROM plans');
  await pool.query("UPDATE settings SET value = 'false' WHERE key = 'bypass'");
  await pool.query('UPDATE config_version SET version = 1 WHERE id = 1');
  // Reset sequences
  await pool.query('ALTER SEQUENCE plans_id_seq RESTART WITH 1');
  await pool.query('ALTER SEQUENCE clients_id_seq RESTART WITH 1');
  await pool.query('ALTER SEQUENCE api_keys_id_seq RESTART WITH 1');
  await pool.query('ALTER SEQUENCE policies_id_seq RESTART WITH 1');
}

export async function cleanRedis(): Promise<void> {
  const redis = getTestRedis();
  await redis.flushall();
}

export async function cleanAll(): Promise<void> {
  await cleanRedis();
  await cleanDatabase();
}

export async function teardownAll(): Promise<void> {
  if (testRedis) {
    await testRedis.quit().catch(() => {});
    testRedis = null;
  }
  if (testPool) {
    await testPool.end().catch(() => {});
    testPool = null;
  }
}

// Helper to create a plan, policy, client, and API key for testing
export interface TestSetup {
  planId: number;
  policyId: number;
  clientId: number;
  apiKey: string;
  keyId: number;
}

export async function createTestSetup(opts: {
  planName?: string;
  algorithm?: string;
  limit?: number;
  windowSeconds?: number;
  burst?: number | null;
  quotaLimit?: number | null;
  quotaMode?: string;
  routePattern?: string;
  failMode?: string;
  shadow?: boolean;
}): Promise<TestSetup> {
  const pool = getTestPool();

  const planResult = await pool.query(
    'INSERT INTO plans (name, quota_limit, quota_mode) VALUES ($1, $2, $3) RETURNING id',
    [opts.planName ?? `plan-${Date.now()}`, opts.quotaLimit ?? null, opts.quotaMode ?? 'exact']
  );
  const planId = parseInt(planResult.rows[0].id, 10);

  const algorithm = opts.algorithm ?? 'token_bucket';
  const burst = algorithm === 'token_bucket' ? (opts.burst ?? opts.limit ?? 10) : (opts.burst ?? null);

  const policyResult = await pool.query(
    `INSERT INTO policies (plan_id, route_pattern, algorithm, limit_units, window_seconds, burst, fail_mode, shadow)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      planId,
      opts.routePattern ?? '*',
      algorithm,
      opts.limit ?? 10,
      opts.windowSeconds ?? 60,
      burst,
      opts.failMode ?? 'open',
      opts.shadow ?? false,
    ]
  );
  const policyId = parseInt(policyResult.rows[0].id, 10);

  const clientResult = await pool.query(
    'INSERT INTO clients (name, plan_id) VALUES ($1, $2) RETURNING id',
    [`client-${Date.now()}`, planId]
  );
  const clientId = parseInt(clientResult.rows[0].id, 10);

  // Generate key
  const { generateApiKey, hashApiKey } = await import('../src/identity/keys.js');
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);

  const keyResult = await pool.query(
    'INSERT INTO api_keys (client_id, key_hash) VALUES ($1, $2) RETURNING id',
    [clientId, keyHash]
  );
  const keyId = parseInt(keyResult.rows[0].id, 10);

  // Increment config version
  await pool.query('UPDATE config_version SET version = version + 1 WHERE id = 1');

  return { planId, policyId, clientId, apiKey, keyId };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
