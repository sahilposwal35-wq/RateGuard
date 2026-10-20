import type { FastifyRequest, FastifyReply } from 'fastify';

export interface LimiterMiddlewareOptions {
  rateGuardUrl: string;
  serviceToken: string;
  defaultCost?: number;
}

export function createRateGuardMiddleware(opts: LimiterMiddlewareOptions) {
  const { rateGuardUrl, serviceToken, defaultCost = 1 } = opts;

  return async function rateGuardMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const apiKey = request.headers['x-api-key'] || request.headers['authorization'];
    if (!apiKey || typeof apiKey !== 'string') {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing x-api-key or authorization header',
      });
    }

    const cleanKey = apiKey.startsWith('Bearer ') ? apiKey.slice(7).trim() : apiKey.trim();
    const route = `${request.method} ${request.routeOptions.url || request.url}`;
    const cost = defaultCost;

    try {
      const response = await fetch(`${rateGuardUrl}/v1/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceToken}`,
        },
        body: JSON.stringify({
          api_key: cleanKey,
          route,
          cost,
        }),
      });

      if (!response.ok) {
        // RateGuard service issue: allow request to proceed (fail-open at gateway)
        request.log.warn(`RateGuard returned HTTP ${response.status}, failing open`);
        return;
      }

      const decision = await response.json() as {
        allowed: boolean;
        reason: string;
        limit: number;
        remaining: number;
        retry_after_ms: number;
        reset_ms: number;
        degraded: boolean;
        shadow: boolean;
      };

      // Set standard and documented rate limit headers (PID 16.4)
      reply.header('X-RateLimit-Limit', String(decision.limit));
      reply.header('X-RateLimit-Remaining', String(decision.remaining));
      reply.header('X-RateLimit-Reset', String(Math.ceil(decision.reset_ms / 1000)));

      if (decision.degraded) {
        reply.header('X-RateLimit-Degraded', 'true');
      }

      if (!decision.allowed && !decision.shadow) {
        const retryAfterSeconds = Math.max(1, Math.ceil(decision.retry_after_ms / 1000));
        reply.header('Retry-After', String(retryAfterSeconds));

        return reply.code(429).send({
          error: 'Too Many Requests',
          message: decision.reason === 'quota_exceeded'
            ? 'Monthly quota exceeded for this billing period'
            : 'Rate limit exceeded, please retry later',
          reason: decision.reason,
          retry_after_seconds: retryAfterSeconds,
          remaining: decision.remaining,
        });
      }
    } catch (err) {
      // Gateway fail-open on network error to decision service
      request.log.warn('Could not reach RateGuard, failing open');
    }
  };
}
