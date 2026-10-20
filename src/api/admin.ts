import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { generateApiKey, hashApiKey } from '../identity/keys.js';

const createPlanSchema = z.object({
  name: z.string().min(1).max(100),
  quota_limit: z.number().int().positive().nullable().optional().default(null),
  quota_mode: z.enum(['exact', 'write_behind']).default('exact'),
});

const updatePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  quota_limit: z.number().int().positive().nullable().optional(),
  quota_mode: z.enum(['exact', 'write_behind']).optional(),
});

const createPolicySchema = z.object({
  plan_id: z.number().int().positive(),
  route_pattern: z.string().min(1).max(500),
  algorithm: z.enum(['fixed_window', 'sliding_window', 'token_bucket']),
  limit_units: z.number().int().positive(),
  window_seconds: z.number().int().positive(),
  burst: z.number().int().positive().nullable().optional().default(null),
  fail_mode: z.enum(['open', 'closed']).default('open'),
  shadow: z.boolean().default(false),
}).refine(
  (data) => data.algorithm !== 'token_bucket' || (data.burst !== null && data.burst !== undefined && data.burst > 0),
  { message: 'burst is required for token_bucket algorithm and must be positive', path: ['burst'] }
);

const updatePolicySchema = z.object({
  route_pattern: z.string().min(1).max(500).optional(),
  algorithm: z.enum(['fixed_window', 'sliding_window', 'token_bucket']).optional(),
  limit_units: z.number().int().positive().optional(),
  window_seconds: z.number().int().positive().optional(),
  burst: z.number().int().positive().nullable().optional(),
  fail_mode: z.enum(['open', 'closed']).optional(),
  shadow: z.boolean().optional(),
});

const createClientSchema = z.object({
  name: z.string().min(1).max(200),
  plan_id: z.number().int().positive(),
});

async function incrementConfigVersion(client: import('pg').PoolClient): Promise<void> {
  await client.query('UPDATE config_version SET version = version + 1 WHERE id = 1');
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const pool = getPool();

  // --- Plans ---
  app.post('/admin/v1/plans', async (request, reply) => {
    const body = createPlanSchema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'INSERT INTO plans (name, quota_limit, quota_mode) VALUES ($1, $2, $3) RETURNING *',
        [body.name, body.quota_limit, body.quota_mode]
      );
      await incrementConfigVersion(client);
      await client.query('COMMIT');
      return reply.code(201).send(result.rows[0]);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof Error && 'code' in err && (err as Record<string, unknown>).code === '23505') {
        return reply.code(409).send({ code: 'CONFLICT', message: `Plan with name "${body.name}" already exists` });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  app.get('/admin/v1/plans', async (_request, reply) => {
    const result = await pool.query('SELECT * FROM plans ORDER BY id');
    return reply.send(result.rows);
  });

  app.get('/admin/v1/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await pool.query('SELECT * FROM plans WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Plan not found' });
    }
    return reply.send(result.rows[0]);
  });

  app.put('/admin/v1/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updatePlanSchema.parse(request.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (body.name !== undefined) { fields.push(`name = $${idx++}`); values.push(body.name); }
    if (body.quota_limit !== undefined) { fields.push(`quota_limit = $${idx++}`); values.push(body.quota_limit); }
    if (body.quota_mode !== undefined) { fields.push(`quota_mode = $${idx++}`); values.push(body.quota_mode); }
    if (fields.length === 0) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'No fields to update' });
    }
    values.push(id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE plans SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Plan not found' });
      }
      await incrementConfigVersion(client);
      await client.query('COMMIT');
      return reply.send(result.rows[0]);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof Error && 'code' in err && (err as Record<string, unknown>).code === '23505') {
        return reply.code(409).send({ code: 'CONFLICT', message: 'Plan name already exists' });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  app.delete('/admin/v1/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('DELETE FROM plans WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Plan not found' });
      }
      await incrementConfigVersion(client);
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof Error && 'code' in err && (err as Record<string, unknown>).code === '23503') {
        return reply.code(409).send({ code: 'CONFLICT', message: 'Plan has dependent resources' });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  // --- Policies ---
  app.post('/admin/v1/policies', async (request, reply) => {
    const body = createPolicySchema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const planCheck = await client.query('SELECT id FROM plans WHERE id = $1', [body.plan_id]);
      if (planCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(422).send({ code: 'INVALID_REFERENCE', message: 'Plan not found' });
      }
      const result = await client.query(
        `INSERT INTO policies (plan_id, route_pattern, algorithm, limit_units, window_seconds, burst, fail_mode, shadow)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [body.plan_id, body.route_pattern, body.algorithm, body.limit_units, body.window_seconds, body.burst, body.fail_mode, body.shadow]
      );
      await incrementConfigVersion(client);
      await client.query('COMMIT');
      return reply.code(201).send(result.rows[0]);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof Error && 'code' in err && (err as Record<string, unknown>).code === '23505') {
        return reply.code(409).send({ code: 'CONFLICT', message: 'Policy for this plan and route already exists' });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  app.get('/admin/v1/policies', async (request, reply) => {
    const query = request.query as { plan_id?: string };
    if (query.plan_id) {
      const result = await pool.query('SELECT * FROM policies WHERE plan_id = $1 ORDER BY id', [query.plan_id]);
      return reply.send(result.rows);
    }
    const result = await pool.query('SELECT * FROM policies ORDER BY id');
    return reply.send(result.rows);
  });

  app.get('/admin/v1/policies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await pool.query('SELECT * FROM policies WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Policy not found' });
    }
    return reply.send(result.rows[0]);
  });

  app.put('/admin/v1/policies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updatePolicySchema.parse(request.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (body.route_pattern !== undefined) { fields.push(`route_pattern = $${idx++}`); values.push(body.route_pattern); }
    if (body.algorithm !== undefined) { fields.push(`algorithm = $${idx++}`); values.push(body.algorithm); }
    if (body.limit_units !== undefined) { fields.push(`limit_units = $${idx++}`); values.push(body.limit_units); }
    if (body.window_seconds !== undefined) { fields.push(`window_seconds = $${idx++}`); values.push(body.window_seconds); }
    if (body.burst !== undefined) { fields.push(`burst = $${idx++}`); values.push(body.burst); }
    if (body.fail_mode !== undefined) { fields.push(`fail_mode = $${idx++}`); values.push(body.fail_mode); }
    if (body.shadow !== undefined) { fields.push(`shadow = $${idx++}`); values.push(body.shadow); }
    if (fields.length === 0) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'No fields to update' });
    }
    values.push(id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE policies SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Policy not found' });
      }
      await incrementConfigVersion(client);
      await client.query('COMMIT');
      return reply.send(result.rows[0]);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof Error && 'code' in err && (err as Record<string, unknown>).code === '23505') {
        return reply.code(409).send({ code: 'CONFLICT', message: 'Policy for this plan and route already exists' });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  app.delete('/admin/v1/policies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('DELETE FROM policies WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Policy not found' });
      }
      await incrementConfigVersion(client);
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch {
      await client.query('ROLLBACK');
      throw new Error('Failed to delete policy');
    } finally {
      client.release();
    }
  });

  // --- Clients ---
  app.post('/admin/v1/clients', async (request, reply) => {
    const body = createClientSchema.parse(request.body);
    const planCheck = await pool.query('SELECT id FROM plans WHERE id = $1', [body.plan_id]);
    if (planCheck.rows.length === 0) {
      return reply.code(422).send({ code: 'INVALID_REFERENCE', message: 'Plan not found' });
    }
    const result = await pool.query(
      'INSERT INTO clients (name, plan_id) VALUES ($1, $2) RETURNING *',
      [body.name, body.plan_id]
    );
    return reply.code(201).send(result.rows[0]);
  });

  app.get('/admin/v1/clients', async (_request, reply) => {
    const result = await pool.query(
      `SELECT c.*, p.name as plan_name FROM clients c JOIN plans p ON c.plan_id = p.id ORDER BY c.id`
    );
    return reply.send(result.rows);
  });

  app.get('/admin/v1/clients/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(
      `SELECT c.*, p.name as plan_name FROM clients c JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Client not found' });
    }
    return reply.send(result.rows[0]);
  });

  // --- API Keys ---
  app.post('/admin/v1/clients/:id/api-keys', async (request, reply) => {
    const { id } = request.params as { id: string };
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id = $1', [id]);
    if (clientCheck.rows.length === 0) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Client not found' });
    }
    const plainKey = generateApiKey();
    const keyHash = hashApiKey(plainKey);
    const result = await pool.query(
      'INSERT INTO api_keys (client_id, key_hash) VALUES ($1, $2) RETURNING id, client_id, status, created_at',
      [id, keyHash]
    );
    // Secret shown once only
    return reply.code(201).send({
      ...result.rows[0],
      api_key: plainKey,
    });
  });

  app.get('/admin/v1/clients/:id/api-keys', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(
      'SELECT id, client_id, status, created_at FROM api_keys WHERE client_id = $1 ORDER BY id',
      [id]
    );
    return reply.send(result.rows);
  });

  app.post('/admin/v1/api-keys/:id/revoke', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(
      "UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND status = 'active' RETURNING id, client_id, status",
      [id]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Active API key not found' });
    }
    return reply.send(result.rows[0]);
  });

  // --- Bypass ---
  app.put('/admin/v1/bypass', async (request, reply) => {
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('bypass', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [String(body.enabled)]
      );
      await incrementConfigVersion(client);
      await client.query('COMMIT');
      return reply.send({ bypass: body.enabled });
    } catch {
      await client.query('ROLLBACK');
      throw new Error('Failed to update bypass');
    } finally {
      client.release();
    }
  });

  app.get('/admin/v1/bypass', async (_request, reply) => {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'bypass'");
    const bypass = result.rows.length > 0 ? result.rows[0].value === 'true' : false;
    return reply.send({ bypass });
  });
}
