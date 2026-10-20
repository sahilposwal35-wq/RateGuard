import { getRedis } from '../config/redis.js';
import { getPool } from '../config/database.js';
import { evalScript } from '../algorithms/script-loader.js';
import { getCurrentPeriodStartUtc, type QuotaResult } from './exact.js';

const MONTH_TTL_SECONDS = 35 * 24 * 3600; // 35 days

export async function checkAndConsumeWriteBehind(
  clientId: number,
  cost: number,
  quotaLimit: number,
  periodStart: string = getCurrentPeriodStartUtc()
): Promise<QuotaResult> {
  const redis = getRedis();
  const redisKey = `q:{${clientId}}:${periodStart}`;

  // Check if key exists in Redis
  const exists = await redis.exists(redisKey);
  let dbUsed = 0;

  if (exists === 0) {
    // Missing in Redis: fetch current durable usage from PostgreSQL (PID 13.4 step 2)
    const pool = getPool();
    const res = await pool.query(
      'SELECT used FROM quota_usage WHERE client_id = $1 AND period_start = $2',
      [clientId, periodStart]
    );
    if (res.rows.length > 0) {
      dbUsed = parseInt(res.rows[0].used, 10);
    }
  }

  const result = await evalScript(
    redis,
    'write-behind-quota',
    [redisKey],
    [cost, quotaLimit, dbUsed, MONTH_TTL_SECONDS]
  ) as number[];

  const allowed = result[0] === 1;
  const used = result[1];
  const remaining = Math.max(0, quotaLimit - used);

  return {
    allowed,
    used,
    remaining,
    limit: quotaLimit,
  };
}

export async function getWriteBehindUsage(
  clientId: number,
  periodStart: string = getCurrentPeriodStartUtc()
): Promise<number> {
  const redis = getRedis();
  const redisKey = `q:{${clientId}}:${periodStart}`;
  const raw = await redis.get(redisKey);
  if (raw !== null) {
    return parseInt(raw, 10);
  }

  // Fallback to DB
  const pool = getPool();
  const res = await pool.query(
    'SELECT used FROM quota_usage WHERE client_id = $1 AND period_start = $2',
    [clientId, periodStart]
  );
  if (res.rows.length === 0) return 0;
  return parseInt(res.rows[0].used, 10);
}
