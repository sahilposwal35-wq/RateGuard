import { resetEnvCache } from '../src/config/env.js';

process.env.PORT = '3100';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = 'postgres://rateguard:rateguard@localhost:5432/rateguard';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.ADMIN_TOKEN = 'admin_secret_token_123';
process.env.SERVICE_TOKEN = 'service_secret_token_123';
process.env.NODE_ENV = 'development';

resetEnvCache();

import { getRedis } from '../src/config/redis.js';
import { runMigrations } from '../src/config/database.js';
import { loadSnapshot, startConfigPoller } from '../src/config/snapshot.js';
import { startQuotaFlusher } from '../src/quota/flusher.js';
import { buildApp } from '../src/server.js';

async function main() {
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
}

main().catch((err) => {
  console.error('Failed to start test server:', err);
  process.exit(1);
});
