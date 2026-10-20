import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { getSnapshot, resolvePolicy } from '../config/snapshot.js';
import { resolveIdentity } from '../identity/resolver.js';
import { getAlgorithm } from '../algorithms/registry.js';
import { getMetrics } from '../observability/metrics.js';
import { getDecisionsBuffer } from '../observability/decisions-buffer.js';
import { processQuotaCheck } from '../quota/manager.js';

const checkSchema = z.object({
  api_key: z.string().min(1),
  route: z.string().min(1).max(500),
  cost: z.number().int().positive().max(100).default(1),
});

export interface CheckResponse {
  allowed: boolean;
  reason: string;
  policy_id: number | null;
  limit: number;
  remaining: number;
  retry_after_ms: number;
  reset_ms: number;
  quota: { limit: number; used: number; remaining: number } | null;
  degraded: boolean;
  shadow: boolean;
}

export async function registerCheckRoute(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  app.post('/v1/check', async (request, reply) => {
    const startTime = performance.now();

    // Step 1: Auth (service token) - will be enforced in Phase 6, pass-through for now
    // Step 2: Validate body
    let body: z.infer<typeof checkSchema>;
    try {
      body = checkSchema.parse(request.body);
    } catch (err) {
      throw err; // Let error handler deal with it
    }

    if (body.route.length > env.MAX_ROUTE_LENGTH) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'Route too long' });
    }

    if (body.cost > env.MAX_COST) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: `Cost exceeds maximum of ${env.MAX_COST}` });
    }

    // Step 3: Check global bypass
    const snapshot = getSnapshot();
    if (snapshot.bypass) {
      const response: CheckResponse = {
        allowed: true,
        reason: 'bypass',
        policy_id: null,
        limit: 0,
        remaining: 0,
        retry_after_ms: 0,
        reset_ms: 0,
        quota: null,
        degraded: false,
        shadow: false,
      };
      recordDecision(response, startTime, null, null, body.route, body.cost);
      return reply.send(response);
    }

    // Step 4: Resolve identity (hash api_key, look up client/plan)
    const identityResult = await resolveIdentity(body.api_key);
    if (!identityResult.ok) {
      const response: CheckResponse = {
        allowed: false,
        reason: identityResult.reason,
        policy_id: null,
        limit: 0,
        remaining: 0,
        retry_after_ms: 0,
        reset_ms: 0,
        quota: null,
        degraded: false,
        shadow: false,
      };
      recordDecision(response, startTime, null, null, body.route, body.cost);
      return reply.send(response);
    }

    const identity = identityResult.identity;

    // Step 5: Resolve policy by route specificity
    const policy = resolvePolicy(identity.planId, body.route);
    if (!policy) {
      // No matching policy - allow by default (no rate limit configured)
      const response: CheckResponse = {
        allowed: true,
        reason: 'ok',
        policy_id: null,
        limit: 0,
        remaining: 0,
        retry_after_ms: 0,
        reset_ms: 0,
        quota: null,
        degraded: false,
        shadow: false,
      };
      recordDecision(response, startTime, identity.clientId, identity.clientName, body.route, body.cost);
      return reply.send(response);
    }

    // Step 6: Run rate algorithm
    const algo = getAlgorithm(policy.algorithm);
    const clientRouteKey = `${identity.clientId}:${body.route}`;
    let rateResult;
    let degraded = false;

    try {
      const redisStart = performance.now();
      rateResult = await algo.check(
        clientRouteKey,
        policy.limitUnits,
        policy.windowSeconds,
        body.cost,
        { burst: policy.burst ?? undefined }
      );
      getMetrics().recordRedisLatency(performance.now() - redisStart);
    } catch (err) {
      // Redis error: apply fail_mode
      if (policy.failMode === 'open') {
        degraded = true;
        const response: CheckResponse = {
          allowed: true,
          reason: 'ok',
          policy_id: policy.id,
          limit: policy.limitUnits,
          remaining: 0,
          retry_after_ms: 0,
          reset_ms: 0,
          quota: null,
          degraded: true,
          shadow: false,
        };
        if (policy.shadow) {
          response.allowed = true;
          response.shadow = true;
        }
        getMetrics().incrementDegraded();
        recordDecision(response, startTime, identity.clientId, identity.clientName, body.route, body.cost, policy);
        return reply.send(response);
      } else {
        // fail_closed
        const response: CheckResponse = {
          allowed: false,
          reason: 'limiter_unavailable',
          policy_id: policy.id,
          limit: policy.limitUnits,
          remaining: 0,
          retry_after_ms: 0,
          reset_ms: 0,
          quota: null,
          degraded: true,
          shadow: false,
        };
        if (policy.shadow) {
          response.allowed = true;
          response.shadow = true;
        }
        getMetrics().incrementDegraded();
        recordDecision(response, startTime, identity.clientId, identity.clientName, body.route, body.cost, policy);
        return reply.send(response);
      }
    }

    if (!rateResult.allowed) {
      // Rate limited
      let response: CheckResponse = {
        allowed: false,
        reason: 'rate_limited',
        policy_id: policy.id,
        limit: rateResult.limit,
        remaining: rateResult.remaining,
        retry_after_ms: rateResult.retryAfterMs,
        reset_ms: rateResult.resetMs,
        quota: null,
        degraded,
        shadow: false,
      };

      // Step 9: Shadow mode
      if (policy.shadow) {
        response = { ...response, allowed: true, shadow: true };
      }

      recordDecision(response, startTime, identity.clientId, identity.clientName, body.route, body.cost, policy);
      return reply.send(response);
    }

    // Step 7: Quota check
    const quotaCheck = await processQuotaCheck({
      clientId: identity.clientId,
      cost: body.cost,
      plan: {
        quotaLimit: identity.quotaLimit,
        quotaMode: identity.quotaMode as 'exact' | 'write_behind',
      },
      rateLimitKey: clientRouteKey,
      policy: {
        algorithm: policy.algorithm,
        limitUnits: policy.limitUnits,
        windowSeconds: policy.windowSeconds,
        burst: policy.burst,
      },
    });

    if (!quotaCheck.allowed) {
      const refunded = quotaCheck.refundedUnits ?? 0;
      let response: CheckResponse = {
        allowed: false,
        reason: 'quota_exceeded',
        policy_id: policy.id,
        limit: rateResult.limit,
        remaining: Math.min(rateResult.limit, rateResult.remaining + refunded),
        retry_after_ms: 0,
        reset_ms: rateResult.resetMs,
        quota: quotaCheck.quota,
        degraded,
        shadow: false,
      };

      if (policy.shadow) {
        response = { ...response, allowed: true, shadow: true };
      }

      recordDecision(response, startTime, identity.clientId, identity.clientName, body.route, body.cost, policy);
      return reply.send(response);
    }

    // Step 8: Build success response
    let response: CheckResponse = {
      allowed: true,
      reason: 'ok',
      policy_id: policy.id,
      limit: rateResult.limit,
      remaining: rateResult.remaining,
      retry_after_ms: 0,
      reset_ms: rateResult.resetMs,
      quota: quotaCheck.quota,
      degraded,
      shadow: false,
    };

    // Step 9: Shadow mode
    if (policy.shadow) {
      response = { ...response, shadow: true };
    }

    // Step 10: Record metrics
    recordDecision(response, startTime, identity.clientId, identity.clientName, body.route, body.cost, policy);
    return reply.send(response);
  });
}

function recordDecision(
  response: CheckResponse,
  startTime: number,
  clientId: number | null,
  clientName: string | null,
  route: string,
  cost: number,
  policy?: { id: number; algorithm: string } | null
): void {
  const latencyMs = performance.now() - startTime;
  const metrics = getMetrics();

  metrics.incrementDecision(response.reason, policy?.id, policy?.algorithm);
  metrics.recordDecisionLatency(latencyMs);

  // Structured log per decision (PID section 18)
  // Note: api_key is NEVER logged (PID section 17)
  const logEntry = {
    type: 'decision',
    clientId,
    policyId: response.policy_id,
    reason: response.reason,
    allowed: response.allowed,
    latencyMs: Math.round(latencyMs * 100) / 100,
    degraded: response.degraded,
    shadow: response.shadow,
    route,
    cost,
  };

  // Use process.stdout for structured log
  process.stdout.write(JSON.stringify(logEntry) + '\n');

  // Record in decisions buffer
  const buffer = getDecisionsBuffer();
  buffer.push({
    timestamp: new Date().toISOString(),
    clientId,
    clientName,
    route,
    policyId: response.policy_id,
    reason: response.reason,
    allowed: response.allowed,
    latencyMs: Math.round(latencyMs * 100) / 100,
    algorithm: policy?.algorithm ?? null,
    degraded: response.degraded,
    shadow: response.shadow,
    cost,
  });
}
