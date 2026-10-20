import { FastifyInstance } from 'fastify';
import { getPool } from '../config/database.js';
import { getCurrentPeriodStartUtc, getExactUsage } from '../quota/exact.js';
import { getWriteBehindUsage } from '../quota/write-behind.js';

export async function registerUsageRoutes(app: FastifyInstance): Promise<void> {
  const pool = getPool();

  app.get('/v1/usage/:client_id', async (request, reply) => {
    const { client_id } = request.params as { client_id: string };
    const clientId = parseInt(client_id, 10);
    if (isNaN(clientId)) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'Invalid client ID' });
    }

    const clientRes = await pool.query(
      `SELECT c.id, c.name, c.plan_id, p.name as plan_name, p.quota_limit, p.quota_mode
       FROM clients c
       JOIN plans p ON c.plan_id = p.id
       WHERE c.id = $1`,
      [clientId]
    );

    if (clientRes.rows.length === 0) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Client not found' });
    }

    const client = clientRes.rows[0];
    const periodStart = getCurrentPeriodStartUtc();
    const quotaLimit = client.quota_limit !== null ? parseInt(client.quota_limit, 10) : null;
    const quotaMode = client.quota_mode as 'exact' | 'write_behind';

    let used = 0;
    if (quotaMode === 'write_behind') {
      used = await getWriteBehindUsage(clientId, periodStart);
    } else {
      used = await getExactUsage(clientId, periodStart);
    }

    const remaining = quotaLimit !== null ? Math.max(0, quotaLimit - used) : null;

    return reply.send({
      client_id: clientId,
      client_name: client.name,
      plan_id: parseInt(client.plan_id, 10),
      plan_name: client.plan_name,
      period_start: periodStart,
      quota_mode: quotaMode,
      limit: quotaLimit,
      used,
      remaining,
      loss_window_note: quotaMode === 'write_behind'
        ? 'Usage since the last periodic flush may be lost if Redis restarts unexpectedly'
        : null,
    });
  });
}
