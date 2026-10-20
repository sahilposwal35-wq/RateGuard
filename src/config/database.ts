import pg from 'pg';
import { loadEnv } from './env.js';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function runMigrations(): Promise<void> {
  const p = getPool();

  // Ensure migrations table exists
  await p.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const fs = await import('fs');
  const path = await import('path');

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  let files: string[];
  try {
    files = fs.readdirSync(migrationsDir)
      .filter((f: string) => f.endsWith('.sql'))
      .sort();
  } catch {
    // No migrations directory
    return;
  }

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match) continue;
    const id = parseInt(match[1], 10);

    const existing = await p.query('SELECT id FROM migrations WHERE id = $1', [id]);
    if (existing.rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (id, name) VALUES ($1, $2)', [id, file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
