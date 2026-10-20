import type { RateLimitAlgorithm } from './interface.js';
import { TokenBucketAlgorithm } from './token-bucket.js';
import { FixedWindowAlgorithm } from './fixed-window.js';
import { SlidingWindowAlgorithm } from './sliding-window.js';
import { SlidingWindowLogAlgorithm } from './sliding-window-log.js';

const algorithms = new Map<string, RateLimitAlgorithm>();

function register(algo: RateLimitAlgorithm): void {
  algorithms.set(algo.name, algo);
}

register(new TokenBucketAlgorithm());
register(new FixedWindowAlgorithm());
register(new SlidingWindowAlgorithm());
register(new SlidingWindowLogAlgorithm());

export function getAlgorithm(name: string): RateLimitAlgorithm {
  const algo = algorithms.get(name);
  if (!algo) throw new Error(`Unknown algorithm: ${name}`);
  return algo;
}

export function listAlgorithms(): string[] {
  return Array.from(algorithms.keys());
}
