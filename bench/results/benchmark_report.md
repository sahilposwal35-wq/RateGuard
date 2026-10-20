# RateGuard Empirical Benchmark Results

Measured on 2026-10-20T02:53:44.769Z
**Environment**: 12th Gen Intel(R) Core(TM) i5-12450H (12 cores), 14.8 GB RAM, Node v22.22.1, Linux x64.

## 1. Decision Latency per Algorithm

| Algorithm | p50 (ms) | p95 (ms) | p99 (ms) | Average (ms) | Throughput (req/s) |
|---|---|---|---|---|---|
| Token Bucket | 1.53 | 2.69 | 3.48 | 1.65 | 606 |
| Fixed Window | 1.23 | 2 | 2.65 | 1.25 | 801 |
| Sliding Window Counter | 1.15 | 1.99 | 3.38 | 1.63 | 614 |

## 2. Redis Calls per Decision

| Algorithm | Redis Commands per Check | Atomic Mechanism |
|---|---|---|
| Token Bucket | 1 | EVALSHA Lua script with TIME command |
| Fixed Window | 1 | EVALSHA Lua script with TIME command |
| Sliding Window Counter | 1 | EVALSHA Lua script with TIME command |
| Sliding Window Log | 1 | EVALSHA Lua script with TIME command |

## 3. Memory per Key (Evaluated at 100,000 Keys)

| Algorithm | Bytes per Client / Key | Memory for 100,000 Clients (MB) |
|---|---|---|
| Fixed Window | 113 B | 10.8 MB |
| Sliding Window Counter | 121 B | 11.5 MB |
| Token Bucket | 125 B | 11.9 MB |

## 4. Sliding Counter Accuracy vs Exact Log Baseline

| Metric | Measured Value |
|---|---|
| Sample Traffic Requests | 300 |
| Exact Log Admitted (Ground Truth) | 50 |
| Sliding Window Counter Admitted | 50 |
| Absolute Difference | 0 |
| **Approximation Error Rate** | **0%** |

## 5. Quota: Exact (PostgreSQL) vs Write-Behind (Redis)

| Strategy | Storage Tier | p50 Latency (ms) | p99 Latency (ms) | Throughput (ops/s) | Concurrency Guarantee |
|---|---|---|---|---|---|
| **Exact** | PostgreSQL | 2.61 | 4.98 | 371 | Never over-admits (conditional row lock) |
| **Write-Behind** | Redis + Background Flush | 0.31 | 1.62 | 2174 | Documented loss window on sudden crash |

*Speedup: Write-behind quota achieves 5.9x higher throughput compared to exact database transactions.*

## 6. Scaling Across Instances

| Instances | Concurrent Throughput (req/s) | Total Time for 1,500 Requests (ms) |
|---|---|---|
| 1 Instance | 1820 | 824 |
| 2 Instances | 2564 | 585 |
| 3 Instances | 2963 | 506 |

## 7. Outage Detection & Recovery

| Event | Time to Detect / Recover | Endpoint Status |
|---|---|---|
| Redis Failure Outage | 4.72 ms | degraded |
| Redis Service Recovery | 1.41 ms | ok |
