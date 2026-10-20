import { getRedis } from '../config/redis.js';
import { getPool } from '../config/database.js';
import { getMetrics } from '../observability/metrics.js';

let flusherInterval: ReturnType<typeof setInterval> | null = null;
let isFlushing = false;

export async function flushQuotaUsageOnce(): Promise<number> {
  const redis = getRedis();
  const pool = getPool();
  const startTime = performance.now();

  // Find all quota keys
  const keys = await redis.keys('q:{*}:*');
  if (keys.length === 0) {
    getMetrics().setFlusherLag(0);
    return 0;
  }

  const client = await pool.connect();
  let flushedCount = 0;

  try {
    for (const key of keys) {
      // Key format: q:{clientId}:periodStart
      const match = key.match(/^q:\{(\d+)\}:(\d{4}-\d{2}-\d{2})$/);
      if (!match) continue;

      const clientId = parseInt(match[1], 10);
      const periodStart = match[2];

      const val = await redis.get(key);
      if (val === null) continue;
      const total = parseInt(val, 10);

      // Monotonic flush using GREATEST (PID section 13.4 step 3)
      await client.query(
        `INSERT INTO quota_usage (client_id, period_start, used)
         VALUES ($1, $2, $3)
         ON CONFLICT (client_id, period_start)
         DO UPDATE SET used = GREATEST(quota_usage.used, EXCLUDED.used)`,
        [clientId, periodStart, total]
      );
      flushedCount++;
    }
  } finally {
    client.release();
  }

  const lagMs = Math.round(performance.now() - startTime);
  getMetrics().setFlusherLag(lagMs);

  return flushedCount;
}

export function startQuotaFlusher(intervalMs: number): void {
  if (flusherInterval) return;

  flusherInterval = setInterval(async () => {
    if (isFlushing) return; // Prevent concurrent flushes
    isFlushing = true;
    try {
      await flushQuotaUsageOnce();
    } catch (err) {
      console.error('Quota flusher error, will retry on next interval:', err);
    } finally {
      isFlushing = false;
    }
  }, intervalMs);
}

export function stopQuotaFlusher(): void {
  if (flusherInterval) {
    clearInterval(flusherInterval);
    flusherInterval = null;
  }
}
