import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { resetEnvCache } from '../src/config/env.js';

process.env.PORT = '3100';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = 'postgres://rateguard:rateguard@localhost:5432/rateguard';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.ADMIN_TOKEN = 'admin_secret_token_123';
process.env.SERVICE_TOKEN = 'service_secret_token_123';
process.env.NODE_ENV = 'development';

resetEnvCache();

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.destroy();
      resolve(true);
    }).on('error', () => {
      resolve(false);
    });
  });
}

import { getRedis } from '../src/config/redis.js';
import { runMigrations } from '../src/config/database.js';
import { loadSnapshot, startConfigPoller } from '../src/config/snapshot.js';
import { startQuotaFlusher } from '../src/quota/flusher.js';
import { buildApp } from '../src/server.js';

async function main() {
  const pgUp = await isPortOpen(5432);
  let pgInstance: EmbeddedPostgres | null = null;
  if (!pgUp) {
    pgInstance = new EmbeddedPostgres({
      database_dir: './data/pg',
      user: 'rateguard',
      password: 'rateguard',
      port: 5432,
      persistent: true,
    });
    try {
      await pgInstance.initialise();
    } catch {}
    await pgInstance.start();
    try {
      await pgInstance.createDatabase('rateguard');
    } catch {}
  }

  const redis = getRedis();
  try {
    await redis.connect();
  } catch {}

  await runMigrations();
  await loadSnapshot();
  await startConfigPoller(1000);
  startQuotaFlusher(5000);

  const app = await buildApp();
  await app.listen({ port: 3100, host: '127.0.0.1' });
  console.log('Test server ready at http://127.0.0.1:3100');

  const shutdown = async () => {
    await app.close();
    if (pgInstance) {
      await pgInstance.stop();
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start test server:', err);
  process.exit(1);
});
