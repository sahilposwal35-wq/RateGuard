// Metrics counters, histograms and gauges per PID section 18

export interface MetricsData {
  // Counters
  decisions: Record<string, number>;       // by reason
  decisionsByPolicy: Record<string, number>; // by policy_id
  decisionsByAlgorithm: Record<string, number>; // by algorithm
  degradedDecisions: number;
  refunds: number;
  refundFailures: number;
  reloadSuccesses: number;
  reloadFailures: number;

  // Histograms (stored as arrays for percentile computation)
  decisionLatencies: number[];
  redisLatencies: number[];
  pgLatencies: number[];

  // Gauges
  configVersion: number;
  cacheSize: number;
  flusherLag: number;
}

class Metrics {
  private data: MetricsData = this.createEmpty();

  private createEmpty(): MetricsData {
    return {
      decisions: {},
      decisionsByPolicy: {},
      decisionsByAlgorithm: {},
      degradedDecisions: 0,
      refunds: 0,
      refundFailures: 0,
      reloadSuccesses: 0,
      reloadFailures: 0,
      decisionLatencies: [],
      redisLatencies: [],
      pgLatencies: [],
      configVersion: 0,
      cacheSize: 0,
      flusherLag: 0,
    };
  }

  incrementDecision(reason: string, policyId?: number, algorithm?: string): void {
    this.data.decisions[reason] = (this.data.decisions[reason] || 0) + 1;
    if (policyId !== undefined) {
      const key = String(policyId);
      this.data.decisionsByPolicy[key] = (this.data.decisionsByPolicy[key] || 0) + 1;
    }
    if (algorithm) {
      this.data.decisionsByAlgorithm[algorithm] = (this.data.decisionsByAlgorithm[algorithm] || 0) + 1;
    }
  }

  incrementDegraded(): void {
    this.data.degradedDecisions++;
  }

  incrementRefund(): void {
    this.data.refunds++;
  }

  incrementRefundFailure(): void {
    this.data.refundFailures++;
  }

  incrementReloadSuccess(): void {
    this.data.reloadSuccesses++;
  }

  incrementReloadFailure(): void {
    this.data.reloadFailures++;
  }

  recordDecisionLatency(ms: number): void {
    this.data.decisionLatencies.push(ms);
    // Keep bounded
    if (this.data.decisionLatencies.length > 10000) {
      this.data.decisionLatencies = this.data.decisionLatencies.slice(-5000);
    }
  }

  recordRedisLatency(ms: number): void {
    this.data.redisLatencies.push(ms);
    if (this.data.redisLatencies.length > 10000) {
      this.data.redisLatencies = this.data.redisLatencies.slice(-5000);
    }
  }

  recordPgLatency(ms: number): void {
    this.data.pgLatencies.push(ms);
    if (this.data.pgLatencies.length > 10000) {
      this.data.pgLatencies = this.data.pgLatencies.slice(-5000);
    }
  }

  setConfigVersion(v: number): void {
    this.data.configVersion = v;
  }

  setCacheSize(s: number): void {
    this.data.cacheSize = s;
  }

  setFlusherLag(ms: number): void {
    this.data.flusherLag = ms;
  }

  getData(): MetricsData {
    return { ...this.data };
  }

  toPrometheus(): string {
    const lines: string[] = [];

    // Decision counters
    for (const [reason, count] of Object.entries(this.data.decisions)) {
      lines.push(`rateguard_decisions_total{reason="${reason}"} ${count}`);
    }
    for (const [policyId, count] of Object.entries(this.data.decisionsByPolicy)) {
      lines.push(`rateguard_decisions_by_policy_total{policy_id="${policyId}"} ${count}`);
    }
    for (const [algo, count] of Object.entries(this.data.decisionsByAlgorithm)) {
      lines.push(`rateguard_decisions_by_algorithm_total{algorithm="${algo}"} ${count}`);
    }
    lines.push(`rateguard_degraded_decisions_total ${this.data.degradedDecisions}`);
    lines.push(`rateguard_refunds_total ${this.data.refunds}`);
    lines.push(`rateguard_refund_failures_total ${this.data.refundFailures}`);
    lines.push(`rateguard_reload_successes_total ${this.data.reloadSuccesses}`);
    lines.push(`rateguard_reload_failures_total ${this.data.reloadFailures}`);

    // Histograms (percentiles)
    const addPercentiles = (name: string, values: number[]) => {
      if (values.length === 0) return;
      const sorted = [...values].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      lines.push(`${name}{quantile="0.5"} ${p50.toFixed(3)}`);
      lines.push(`${name}{quantile="0.95"} ${p95.toFixed(3)}`);
      lines.push(`${name}{quantile="0.99"} ${p99.toFixed(3)}`);
      lines.push(`${name}_count ${values.length}`);
    };

    addPercentiles('rateguard_decision_latency_ms', this.data.decisionLatencies);
    addPercentiles('rateguard_redis_latency_ms', this.data.redisLatencies);
    addPercentiles('rateguard_pg_latency_ms', this.data.pgLatencies);

    // Gauges
    lines.push(`rateguard_config_version ${this.data.configVersion}`);
    lines.push(`rateguard_cache_size ${this.data.cacheSize}`);
    lines.push(`rateguard_flusher_lag_ms ${this.data.flusherLag}`);

    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.data = this.createEmpty();
  }
}

// Singleton
let metricsInstance: Metrics | null = null;

export function getMetrics(): Metrics {
  if (!metricsInstance) {
    metricsInstance = new Metrics();
  }
  return metricsInstance;
}
