import { checkAndConsumeExact, type QuotaResult } from './exact.js';
import { checkAndConsumeWriteBehind } from './write-behind.js';
import { getAlgorithm } from '../algorithms/registry.js';
import { getMetrics } from '../observability/metrics.js';

export interface QuotaCheckOptions {
  clientId: number;
  cost: number;
  plan: {
    quotaLimit: number | null;
    quotaMode: 'exact' | 'write_behind';
  };
  rateLimitKey: string;
  policy: {
    algorithm: string;
    limitUnits: number;
    windowSeconds: number;
    burst: number | null;
  };
}

export async function processQuotaCheck(
  opts: QuotaCheckOptions
): Promise<{
  allowed: boolean;
  refundedUnits?: number;
  quota: { limit: number; used: number; remaining: number } | null;
}> {
  // If no quota configured for this plan, pass through
  if (opts.plan.quotaLimit === null || opts.plan.quotaLimit <= 0) {
    return { allowed: true, quota: null };
  }

  const limit = opts.plan.quotaLimit;
  let result: QuotaResult;

  if (opts.plan.quotaMode === 'write_behind') {
    result = await checkAndConsumeWriteBehind(opts.clientId, opts.cost, limit);
  } else {
    result = await checkAndConsumeExact(opts.clientId, opts.cost, limit);
  }

  if (!result.allowed) {
    // Quota exceeded: best-effort refund of rate units consumed in step 6 (PID 13.1 step 7, 13.2)
    let refundedUnits = 0;
    try {
      const algo = getAlgorithm(opts.policy.algorithm);
      refundedUnits = await algo.refund(
        opts.rateLimitKey,
        opts.policy.limitUnits,
        opts.policy.windowSeconds,
        opts.cost,
        { burst: opts.policy.burst ?? undefined }
      );
      getMetrics().incrementRefund();
    } catch (err) {
      getMetrics().incrementRefundFailure();
      console.error('Best effort rate refund failed on quota denial:', err);
    }

    return {
      allowed: false,
      refundedUnits,
      quota: {
        limit: result.limit,
        used: result.used,
        remaining: result.remaining,
      },
    };
  }

  return {
    allowed: true,
    quota: {
      limit: result.limit,
      used: result.used,
      remaining: result.remaining,
    },
  };
}
