import Fastify from 'fastify';
import { createRateGuardMiddleware } from './middleware.js';

export function buildDemoApp(opts?: { rateGuardUrl?: string; serviceToken?: string }) {
  const app = Fastify({ logger: false });
  const rateGuardUrl = opts?.rateGuardUrl || process.env.RATEGUARD_URL || 'http://localhost:3000';
  const serviceToken = opts?.serviceToken || process.env.SERVICE_TOKEN || 'test-service-token';

  const rateLimit = createRateGuardMiddleware({ rateGuardUrl, serviceToken });

  // Public endpoint without limiter
  app.get('/health', async () => ({ status: 'healthy' }));

  // Protected endpoints with RateGuard middleware
  app.get('/api/v1/resource', { preHandler: rateLimit }, async () => {
    return { data: 'Valuable protected resource content' };
  });

  app.post('/api/v1/orders', { preHandler: rateLimit }, async (req) => {
    return { orderId: 42, status: 'created', body: req.body };
  });

  return app;
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  const port = parseInt(process.env.DEMO_PORT || '4000', 10);
  const app = buildDemoApp();
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    console.log(`Demo API running at http://localhost:${port}`);
  });
}
