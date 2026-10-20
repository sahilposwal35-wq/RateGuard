# RateGuard Requirements Traceability Matrix

This matrix provides full bidirectional traceability from the Project Initiation Document (PID) functional requirements (FR-1 to FR-15), non-functional requirements, and test requirements (T1 to T18) to the implementation files and automated test suites.

---

## 1. Functional Requirements Traceability

| Requirement ID | Summary Description | Implementation Source Files | Verification Tests & Specs |
|---|---|---|---|
| **FR-1** | `POST /v1/check` accepts `api_key`, `route`, `cost` (default 1) and returns decision | `src/api/check.ts`<br>`src/server.ts` | `tests/integration/phase1-foundation.test.ts`<br>`tests/integration/t5-t7-token-bucket.test.ts` |
| **FR-2** | Resolve `api_key` to client and plan via SHA-256 hash comparison; unknown or revoked keys denied with specific reason codes | `src/identity/hasher.ts`<br>`src/identity/resolver.ts`<br>`src/api/check.ts` | `tests/integration/phase1-foundation.test.ts`<br>`tests/integration/phase6-resilience-security.test.ts` (T17) |
| **FR-3** | Route specificity resolution order: exact route, longest prefix, wildcard, plan default | `src/config/snapshot.ts`<br>`src/api/check.ts` | `tests/integration/phase4-policies-config.test.ts` (T8) |
| **FR-4** | Support algorithms: `token_bucket`, `fixed_window`, `sliding_window` (counter), and `sliding_window_log` test baseline | `src/algorithms/token-bucket.ts`<br>`src/algorithms/fixed-window.ts`<br>`src/algorithms/sliding-window.ts`<br>`src/algorithms/sliding-window-log.ts` | `tests/unit/t1-algorithms.test.ts` (T1)<br>`tests/integration/t3-boundary-burst.test.ts` (T3)<br>`tests/integration/t4-accuracy.test.ts` (T4) |
| **FR-5** | Cost-weighted requests: consume multiple units accurately | `src/algorithms/token-bucket.ts`<br>`src/api/check.ts` | `tests/integration/t5-t7-token-bucket.test.ts` (T7) |
| **FR-6** | Monthly quota per calendar month in UTC with two modes: exact (PostgreSQL) and write-behind (Redis + flusher) | `src/quota/exact.ts`<br>`src/quota/write-behind.ts`<br>`src/quota/flusher.ts`<br>`src/quota/manager.ts` | `tests/integration/phase5-quota.test.ts` (T10, T11) |
| **FR-7** | Hot reload of plans and policies without process restart via atomic snapshot swap and `config_version` polling | `src/config/snapshot.ts`<br>`src/api/admin.ts` | `tests/integration/phase4-policies-config.test.ts` (T9) |
| **FR-8** | Per-policy fail mode (`open` or `closed`) applied when rate store is unavailable | `src/api/check.ts`<br>`src/quota/manager.ts` | `tests/integration/phase6-resilience-security.test.ts` (T12) |
| **FR-9** | Per-policy shadow flag: evaluate decisions and log metrics without blocking requests (`allowed: true`, `shadow: true`) | `src/api/check.ts`<br>`src/observability/decisions-buffer.ts` | `tests/integration/phase4-policies-config.test.ts` (T14) |
| **FR-10** | Global bypass switch: allow all traffic, log metrics and decisions | `src/api/admin.ts`<br>`src/api/check.ts` | `tests/integration/phase4-policies-config.test.ts` (T15)<br>`tests/e2e/console.spec.ts` |
| **FR-11** | Admin API for CRUD operations on plans, policies, clients, issuing/revoking keys, and bypass switch | `src/api/admin.ts` | `tests/integration/phase1-foundation.test.ts`<br>`tests/e2e/console.spec.ts` |
| **FR-12** | `GET /v1/usage/{client_id}` reports current calendar period usage, remaining, limit, and quota mode | `src/api/usage.ts`<br>`src/quota/manager.ts` | `tests/integration/phase5-quota.test.ts` (T16) |
| **FR-13** | Decision response returns limit, remaining, reset, retry information; demo API middleware maps to HTTP 429 and `Retry-After` | `src/api/check.ts`<br>`demo-api/middleware.ts` | `tests/integration/demo-api.test.ts` |
| **FR-14** | Prometheus metrics endpoint (`/metrics`) and structured JSON logs for every decision | `src/observability/metrics.ts`<br>`src/observability/logger.ts`<br>`src/observability/decisions-buffer.ts` | `tests/integration/phase6-resilience-security.test.ts`<br>`tests/integration/demo-api.test.ts` |
| **FR-15** | Internal `POST /v1/refund` and quota denial refund return rate units to Redis | `src/algorithms/refund.ts`<br>`src/api/refund.ts`<br>`src/quota/manager.ts` | `tests/integration/refund.test.ts`<br>`tests/integration/phase5-quota.test.ts` (T16) |

---

## 2. Non-Functional Requirements Traceability

| Area | Requirement Definition | Implementation & Architecture | Verification & Measurement |
|---|---|---|---|
| **Correctness** | Concurrency safety under high volume callers; no over-admission | Lua scripts with atomic evaluation (`EVALSHA`) and conditional SQL updates | `tests/concurrency/t2-race-demo.test.ts` (T2)<br>`tests/concurrency/repeat-runs.test.ts` (T18: 20 consecutive runs) |
| **Latency** | Sub-millisecond Redis decision evaluation; p50/p95/p99 measured and recorded | Pipelined operations, in-memory config snapshot, EVALSHA cache | `bench/results/benchmarks.json`<br>`bench/run-benchmarks.ts` (p50: 0.17ms, p99: 0.44ms) |
| **Availability** | Explicit graceful degradation for Redis and PostgreSQL failure | Fail-open / fail-closed per policy; in-memory cached config snapshot; `/readyz` degraded reporting | `tests/integration/phase6-resilience-security.test.ts` (T12, T13) |
| **Security** | SHA-256 key hashing, constant-time comparison, service/admin Bearer token auth, no secret logging | `src/identity/hasher.ts`<br>`src/api/auth.ts`<br>`src/observability/logger.ts` | `tests/integration/phase6-resilience-security.test.ts` (T17) |
| **Observability** | `/metrics` Prometheus counters/histograms/gauges, in-memory 200 decisions ring buffer, `/healthz`, `/readyz` | `src/observability/metrics.ts`<br>`src/observability/decisions-buffer.ts`<br>`src/server.ts` | `tests/integration/phase6-resilience-security.test.ts`<br>`tests/e2e/console.spec.ts` |
| **Portability** | Standalone runnable with Docker Compose without external dependencies | `docker-compose.yml`<br>`Dockerfile` | Multi-instance proxy setup and verification |
| **Maintainability** | Clean modular TypeScript, strict mode, zero ORM, plain numbered SQL migrations | `src/algorithms/base.ts`<br>`migrations/001_initial.sql` | `npm run build` (`tsc` strict check passes with 0 errors) |
| **Testability** | Injectable time for pure algorithms, real Redis and PostgreSQL for integration tests | `tests/helpers.ts` | All 13 test suites execute against live Redis and PostgreSQL |

---

## 3. Test Traceability (PID Section 19: T1 to T18)

| Test ID | Test Name / Purpose | Expected Result | Implementation Test File |
|---|---|---|---|
| **T1** | Algorithm unit tests with controlled sequences | Token bucket, fixed window, sliding counter, and log match hand-calculated expectations | `tests/unit/t1-algorithms.test.ts` |
| **T2** | Race demo: naive read-then-write limiter vs Lua limiter under many concurrent callers | Naive over-admits; Lua limiter stays strictly within bound | `tests/concurrency/t2-race-demo.test.ts` |
| **T3** | Fixed window boundary burst vs sliding window | Fixed window admits up to ~2x limit across boundary; sliding window counter mitigates boundary burst | `tests/integration/t3-boundary-burst.test.ts` |
| **T4** | Sliding counter accuracy vs exact log baseline | Approximation error of sliding window counter against ground-truth log measured and reported | `tests/integration/t4-accuracy.test.ts` |
| **T5** | Token bucket burst and refill | Burst admitted up to burst capacity, followed by steady refill rate | `tests/integration/t5-t7-token-bucket.test.ts` |
| **T6** | Multi-instance global limits (three instances behind round-robin dispatch) | Global limits hold strictly across three distributed instances | `tests/concurrency/multi-instance.test.ts` |
| **T7** | Cost-weighted request consumption | Requests consume specified units; partial remaining capacity rejects higher-cost requests | `tests/integration/t5-t7-token-bucket.test.ts` |
| **T8** | Route policy specificity hierarchy | Exact route beats longest prefix, which beats wildcard, which beats plan default | `tests/integration/phase4-policies-config.test.ts` |
| **T9** | Hot reload without downtime | Config version polling updates snapshot atomically; corrupted update preserves active snapshot | `tests/integration/phase4-policies-config.test.ts` |
| **T10** | Exact quota under high concurrency | Conditional PostgreSQL update guarantees admitted total never exceeds monthly quota limit | `tests/integration/phase5-quota.test.ts` |
| **T11** | Write-behind quota under concurrency and Redis crash simulation | Monotonic GREATEST flusher accurately syncs counts; loss window documented under crash | `tests/integration/phase5-quota.test.ts` |
| **T12** | Redis failure: fail-open and fail-closed policies | Fail-open allows traffic with `degraded: true`; fail-closed denies with `limiter_unavailable` | `tests/integration/phase6-resilience-security.test.ts` |
| **T13** | PostgreSQL failure survival | In-memory cached snapshot continues evaluating rate limits when database is offline | `tests/integration/phase6-resilience-security.test.ts` |
| **T14** | Shadow mode policy evaluation | Requests always return `allowed: true` with `shadow: true`; would-be-denied logged | `tests/integration/phase4-policies-config.test.ts` |
| **T15** | Global bypass override | Allows all traffic immediately with reason `bypass`, still records decision stream and metrics | `tests/integration/phase4-policies-config.test.ts` |
| **T16** | Rate token refund on quota denial | Units consumed during rate check are returned via refund script if quota check rejects request | `tests/integration/refund.test.ts`<br>`tests/integration/phase5-quota.test.ts` |
| **T17** | Security verification | Rejects unauthorized tokens, verifies constant-time hash check, confirms API keys never appear in logs | `tests/integration/phase6-resilience-security.test.ts` |
| **T18** | Concurrency repeatability verification | High-concurrency suite passes 20 consecutive execution loops with zero flakiness | `tests/concurrency/repeat-runs.test.ts` |

---

## 4. Admin Console (Phase 8 Scope Change) Traceability

| Feature / Page | Functional Scope | Implementation Source Files | End-to-End Verification Test |
|---|---|---|---|
| **Sign in** | Memory-only session token, no localStorage, token validation | `console/src/pages/signin.ts`<br>`console/src/api.ts` | `tests/e2e/console.spec.ts` (Test 1) |
| **System Overview** | Live `/readyz` status (Redis, PostgreSQL, degraded), bypass flag, decision latency chart, last 200 decisions table | `console/src/pages/overview.ts`<br>`src/observability/decisions-buffer.ts` | `tests/e2e/console.spec.ts` (Test 1) |
| **Plans & Policies** | Tiered plans management, quota mode selection, policy creation with algorithm and fail mode selection | `console/src/pages/plans.ts` | `tests/e2e/console.spec.ts` (Test 2) |
| **Clients & Keys** | Tenant client registration, one-time secret API key issuance modal with copy button, key revocation with confirmation | `console/src/pages/clients.ts` | `tests/e2e/console.spec.ts` (Test 3) |
| **Test Playground** | Live single check sender, burst batch runner (N requests), raw JSON display, one-line decision summary | `console/src/pages/playground.ts` | `tests/e2e/console.spec.ts` (Test 4) |
| **Quota & Usage** | Client quota consumption meter, period remaining, write-behind vs exact mode durability note | `console/src/pages/usage.ts` | Playwright responsive suite (Test 6) |
| **Shadow Mode Report** | Audit policies in shadow mode, decision count of theoretical would-be-denied callers | `console/src/pages/shadow.ts` | Playwright responsive suite (Test 6) |
| **Settings** | Global bypass toggle with confirmation modal, cluster polling interval, current config version | `console/src/pages/settings.ts` | `tests/e2e/console.spec.ts` (Test 5) |
