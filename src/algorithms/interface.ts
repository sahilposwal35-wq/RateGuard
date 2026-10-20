export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetMs: number;
}

export interface RateLimitAlgorithm {
  readonly name: string;
  check(key: string, limit: number, windowSeconds: number, cost: number, options?: AlgorithmOptions): Promise<RateLimitResult>;
  refund(key: string, limit: number, windowSeconds: number, units: number, options?: AlgorithmOptions): Promise<number>;
}

export interface AlgorithmOptions {
  burst?: number; // token bucket capacity
}
