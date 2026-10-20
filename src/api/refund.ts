import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveIdentity } from '../identity/resolver.js';
import { resolvePolicy } from '../config/snapshot.js';
import { getAlgorithm } from '../algorithms/registry.js';
import { getMetrics } from '../observability/metrics.js';
import { verifyServiceToken } from './auth.js';

const refundSchema = z.object({
  api_key: z.string().min(1),
  route: z.string().min(1).max(500),
  cost: z.number().int().positive().max(100).default(1),
});

export async function registerRefundRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/refund', async (request, reply) => {
    await verifyServiceToken(request, reply);
    if (reply.sent) return;

    const body = refundSchema.parse(request.body);

    const identityResult = await resolveIdentity(body.api_key);
    if (!identityResult.ok) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'Invalid API key' });
    }

    const identity = identityResult.identity;
    const policy = resolvePolicy(identity.planId, body.route);

    if (!policy) {
      return reply.send({ refunded: 0 });
    }

    const algo = getAlgorithm(policy.algorithm);
    const clientRouteKey = `${identity.clientId}:${body.route}`;

    try {
      const refunded = await algo.refund(
        clientRouteKey,
        policy.limitUnits,
        policy.windowSeconds,
        body.cost,
        { burst: policy.burst ?? undefined }
      );
      getMetrics().incrementRefund();
      return reply.send({ refunded });
    } catch (err) {
      // Refund failure: log and count, do not fail the request (PID 13.5)
      getMetrics().incrementRefundFailure();
      console.error('Refund failed:', err);
      return reply.send({ refunded: 0 });
    }
  });
}
