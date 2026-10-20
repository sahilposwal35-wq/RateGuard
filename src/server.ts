import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { loadEnv } from './config/env.js';
import { getPool, runMigrations, closePool } from './config/database.js';
import { getRedis, closeRedis } from './config/redis.js';
import { loadSnapshot, startConfigPoller, stopConfigPoller } from './config/snapshot.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerCheckRoute } from './api/check.js';
import { registerRefundRoute } from './api/refund.js';
import { registerUsageRoutes } from './api/usage.js';
import { startQuotaFlusher, stopQuotaFlusher } from './quota/flusher.js';
import { getMetrics } from './observability/metrics.js';
import { getDecisionsBuffer } from './observability/decisions-buffer.js';

export async function buildApp() {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            hostname: request.hostname,
          };
        },
      },
    },
    bodyLimit: 1048576, // 1MB
    requestTimeout: 30000,
  });

  // Error handler for Fastify validation, Zod, and general errors
  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number; issues?: Array<{ path: (string | number)[]; message: string }> }, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({
        code: 'INVALID_INPUT',
        message: error.message,
      });
    }
    if (error.name === 'ZodError' && error.issues) {
      return reply.code(400).send({
        code: 'INVALID_INPUT',
        message: 'Validation failed',
        errors: error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    app.log.error(error);
    const statusCode = error.statusCode ?? 500;
    return reply.code(statusCode).send({
      code: 'INTERNAL_ERROR',
      message: statusCode === 500 ? 'Internal server error' : error.message,
    });
  });

  // Register routes
  await registerAdminRoutes(app);
  await registerCheckRoute(app);
  await registerRefundRoute(app);
  await registerUsageRoutes(app);

  // Decisions buffer endpoint (scope change SC-001)
  app.get('/admin/v1/decisions', async (_request, reply) => {
    const buffer = getDecisionsBuffer();
    return reply.send(buffer.getAll());
  });

  // Register static console files
  const consoleDistPath = path.resolve(process.cwd(), 'dist/console');
  if (fs.existsSync(consoleDistPath)) {
    await app.register(fastifyStatic, {
      root: consoleDistPath,
      prefix: '/console/',
    });

    app.get('/console', async (_request, reply) => {
      return reply.redirect('/console/');
    });
  }

  // Health endpoint
  app.get('/healthz', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  // Readiness endpoint
  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, string> = {};
    let healthy = true;
    let degraded = false;

    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'error';
      healthy = false;
    }

    try {
      const redis = getRedis();
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
      degraded = true;
    }

    const status = !healthy ? 'error' : degraded ? 'degraded' : 'ok';
    const code = healthy ? 200 : 503;
    return reply.code(code).send({ status, checks, degraded });
  });

  // Metrics endpoint
  app.get('/metrics', async (_request, reply) => {
    const metrics = getMetrics();
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(metrics.toPrometheus());
  });

  return app;
}

async function main() {
  const env = loadEnv();

  // Connect Redis
  const redis = getRedis();
  await redis.connect();

  // Run migrations
  await runMigrations();

  // Load initial config snapshot and start poller
  await loadSnapshot();
  await startConfigPoller(env.CONFIG_POLL_INTERVAL_MS);

  // Start background quota flusher (PID 13.4)
  startQuotaFlusher(env.FLUSHER_INTERVAL_MS);

  // Build and start the app
  const app = await buildApp();

  const shutdown = async () => {
    app.log.info('Shutting down...');
    stopConfigPoller();
    stopQuotaFlusher();
    await app.close();
    await closeRedis();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`RateGuard listening on ${env.HOST}:${env.PORT}`);
}

import { fileURLToPath } from 'node:url';

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
