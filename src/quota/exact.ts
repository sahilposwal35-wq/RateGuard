import { getPool } from '../config/database.js';

export interface QuotaResult {
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
}

export function getCurrentPeriodStartUtc(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export async function checkAndConsumeExact(
  clientId: number,
  cost: number,
  quotaLimit: number,
  periodStart: string = getCurrentPeriodStartUtc()
): Promise<QuotaResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // 1. Ensure row exists for client and period
    await client.query(
      `INSERT INTO quota_usage (client_id, period_start, used)
       VALUES ($1, $2, 0)
       ON CONFLICT (client_id, period_start) DO NOTHING`,
      [clientId, periodStart]
    );

    // 2. Atomic conditional update (PID section 15.1)
    // Zero rows updated means quota exceeded
    const updateResult = await client.query(
      `UPDATE quota_usage
       SET used = used + $1
       WHERE client_id = $2 AND period_start = $3 AND used + $1 <= $4
       RETURNING used`,
      [cost, clientId, periodStart, quotaLimit]
    );

    if (updateResult.rows.length === 0) {
      // Exceeded: fetch current used count
      const currentRes = await client.query(
        `SELECT used FROM quota_usage WHERE client_id = $1 AND period_start = $2`,
        [clientId, periodStart]
      );
      const used = currentRes.rows.length > 0 ? parseInt(currentRes.rows[0].used, 10) : 0;
      return {
        allowed: false,
        used,
        remaining: Math.max(0, quotaLimit - used),
        limit: quotaLimit,
      };
    }

    const newUsed = parseInt(updateResult.rows[0].used, 10);
    return {
      allowed: true,
      used: newUsed,
      remaining: Math.max(0, quotaLimit - newUsed),
      limit: quotaLimit,
    };
  } finally {
    client.release();
  }
}

export async function getExactUsage(
  clientId: number,
  periodStart: string = getCurrentPeriodStartUtc()
): Promise<number> {
  const pool = getPool();
  const res = await pool.query(
    'SELECT used FROM quota_usage WHERE client_id = $1 AND period_start = $2',
    [clientId, periodStart]
  );
  if (res.rows.length === 0) return 0;
  return parseInt(res.rows[0].used, 10);
}
