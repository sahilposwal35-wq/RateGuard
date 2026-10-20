import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { resetEnvCache } from '../src/config/env.js';

process.env.PORT = '3000';
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

async function main() {
  console.log('Starting RateGuard live demo environment...\n');

  // Check Redis
  const redisUp = await isPortOpen(6379);
  if (!redisUp) {
    console.error('Error: Redis is not running on port 6379. Please start Redis first.');
    process.exit(1);
  }

  // Check / Start PostgreSQL
  const pgUp = await isPortOpen(5432);
  let pgInstance: EmbeddedPostgres | null = null;
  if (!pgUp) {
    console.log('Starting local PostgreSQL on port 5432...');
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
    console.log('PostgreSQL started successfully.');
  }

  // Connect and prepare app
  const { getRedis } = await import('../src/config/redis.js');
  const redis = getRedis();
  try {
    await redis.connect();
  } catch {}

  const { runMigrations } = await import('../src/config/database.js');
  await runMigrations();

  const { loadSnapshot, startConfigPoller } = await import('../src/config/snapshot.js');
  await loadSnapshot();
  await startConfigPoller(1000);

  const { startQuotaFlusher } = await import('../src/quota/flusher.js');
  startQuotaFlusher(5000);

  const { buildApp } = await import('../src/server.js');
  const app = await buildApp();
  await app.listen({ port: 3000, host: '127.0.0.1' });

  console.log('===============================================================');
  console.log(' RATEGUARD LIVE ADMIN CONSOLE IS READY!                        ');
  console.log('===============================================================');
  console.log(' Open in your browser:');
  console.log('   -> http://localhost:3000/console/                           ');
  console.log('');
  console.log(' Admin Sign In Token:');
  console.log('   admin_secret_token_123');
  console.log('===============================================================');
  console.log(' Press Ctrl+C to stop the server.\n');

  const shutdown = async () => {
    console.log('\nShutting down server...');
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
  console.error('Fatal error starting live console:', err);
  process.exit(1);
});
