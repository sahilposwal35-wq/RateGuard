# RateGuard: Implementation Plan

This document maps each development phase to concrete tasks, files, and acceptance tests.

## Phase 1: Foundation

### Tasks
1. Initialize Node.js project with TypeScript strict mode
2. Set up Docker Compose: Redis, PostgreSQL, app service
3. Create SQL migrations from PID section 15 (plans, clients, api_keys, policies, quota_usage, config_version, settings)
4. Configuration through environment variables (zod validated)
5. Fastify server setup with structured JSON logging
6. Admin endpoints:
   - POST/GET/PUT/DELETE `/admin/v1/plans`
   - POST/GET/PUT/DELETE `/admin/v1/policies`
   - POST/GET `/admin/v1/clients`
   - POST `/admin/v1/clients/:id/api-keys` (issue key, show secret once, store SHA-256 hash)
   - POST `/admin/v1/api-keys/:id/revoke`
7. Constant-time hash comparison for API key verification

### Files
- `package.json`, `tsconfig.json`, `docker-compose.yml`, `Dockerfile`
- `migrations/001_initial.sql`
- `src/server.ts` - Fastify app entry
- `src/config/env.ts` - Environment config with zod
- `src/config/database.ts` - PostgreSQL pool
- `src/config/redis.ts` - ioredis client
- `src/api/admin.ts` - Admin route handlers
- `src/identity/keys.ts` - Key generation, hashing, constant-time compare

### Acceptance
- `docker compose up` starts all services
- A plan can be created, a client created, a key issued and the hash stored
- Key resolution works with constant-time comparison

---

## Phase 2: First Algorithm (Token Bucket)

### Tasks
1. POST `/v1/check` endpoint with zod validation
2. Token bucket Lua script from PID section 14.3 (verified with tests)
3. EVALSHA with NOSCRIPT fallback
4. Redis timeout budget
5. Cost support in token bucket
6. Decision response shape per PID section 16.1

### Files
- `src/algorithms/interface.ts` - Algorithm interface
- `src/algorithms/token-bucket.ts` - Token bucket implementation
- `src/algorithms/scripts/token-bucket.lua` - Lua script
- `src/api/check.ts` - POST /v1/check handler
- `tests/unit/token-bucket.test.ts` - T1 tests
- `tests/integration/check.test.ts` - T5, T7 tests
- `tests/concurrency/race-demo.test.ts` - T2 naive vs Lua demo

### Acceptance
- Tests T1 (unit, injected time), T5 (burst and refill), T7 (cost-weighted) pass
- T2 race demo written (naive over-admits, Lua stays within bound)

---

## Phase 3: Other Algorithms

### Tasks
1. Fixed window algorithm and Lua script
2. Sliding window counter algorithm and Lua script
3. Sliding window log (exact baseline for testing)
4. Shared algorithm interface verified with all algorithms
5. Refund Lua script and POST `/v1/refund` endpoint
6. Complete T2 race demo across algorithms

### Files
- `src/algorithms/fixed-window.ts`
- `src/algorithms/scripts/fixed-window.lua`
- `src/algorithms/sliding-window.ts`
- `src/algorithms/scripts/sliding-window.lua`
- `src/algorithms/sliding-window-log.ts`
- `src/algorithms/scripts/sliding-window-log.lua`
- `src/algorithms/refund.ts`
- `src/algorithms/scripts/refund.lua`
- `src/api/refund.ts`
- `tests/unit/fixed-window.test.ts`
- `tests/unit/sliding-window.test.ts`
- `tests/integration/boundary-burst.test.ts` - T3
- `tests/integration/accuracy.test.ts` - T4

### Acceptance
- T2 (race demo passes for all algorithms), T3 (boundary burst), T4 (accuracy comparison) pass
- MVP complete

---

## Phase 4: Policies and Config

### Tasks
1. Route specificity resolution: exact, longest prefix, wildcard, plan default
2. In-memory snapshot with atomic swap (policy cache)
3. Config loader with config_version polling
4. Shadow mode (compute decision, always return allowed with shadow=true)
5. Global bypass switch (PUT `/admin/v1/bypass`)

### Files
- `src/config/snapshot.ts` - In-memory policy/plan snapshot
- `src/config/loader.ts` - Config version polling and reload
- `src/identity/policy-resolver.ts` - Route specificity matching
- `tests/integration/specificity.test.ts` - T8
- `tests/integration/hot-reload.test.ts` - T9
- `tests/integration/shadow.test.ts` - T14
- `tests/integration/bypass.test.ts` - T15

### Acceptance
- T8 (policy specificity), T9 (hot reload), T14 (shadow mode), T15 (bypass) pass

---

## Phase 5: Quota

### Tasks
1. Exact mode: conditional UPDATE in PostgreSQL, insert-if-absent
2. Write-behind mode: monotonic Redis counter, initialized from PostgreSQL with SET NX
3. Flusher background task: writes to PostgreSQL with GREATEST
4. Refund on quota denial (return rate units consumed in step 6)
5. GET `/v1/usage/:client_id` endpoint

### Files
- `src/quota/exact.ts`
- `src/quota/write-behind.ts`
- `src/quota/flusher.ts`
- `src/api/usage.ts`
- `tests/integration/quota-exact.test.ts` - T10
- `tests/integration/quota-write-behind.test.ts` - T11
- `tests/integration/refund-path.test.ts` - T16

### Acceptance
- T10 (exact quota under concurrency), T11 (write-behind with simulated Redis restart), T16 (refund path) pass

---

## Phase 6: Resilience and Security

### Tasks
1. Per-policy fail_mode: open and closed when Redis unavailable
2. Degraded flag in responses
3. GET `/healthz` and GET `/readyz` endpoints
4. Service token auth on `/v1/*`, admin token auth on `/admin/v1/*`
5. Strict input validation (max cost, max route length, request size limit)
6. api_key never written to logs
7. In-memory decisions ring buffer (last 200 decisions)
8. GET `/admin/v1/decisions` endpoint

### Files
- `src/api/auth.ts` - Token authentication middleware
- `src/api/health.ts` - Health/readiness endpoints
- `src/observability/metrics.ts` - Counters, histograms, gauges
- `src/observability/logger.ts` - Structured logging (no api_key)
- `src/observability/decisions-buffer.ts` - Ring buffer
- `tests/integration/fail-modes.test.ts` - T12
- `tests/integration/pg-down.test.ts` - T13
- `tests/integration/security.test.ts` - T17

### Acceptance
- T12 (Redis down, fail-open and fail-closed), T13 (PostgreSQL down), T17 (security checks) pass

---

## Phase 7: Evidence and Polish

### Tasks
1. Docker Compose: three app instances behind round-robin proxy
2. Multi-instance tests
3. Benchmark scripts for every row in PID section 20
4. Demo API with limiter middleware returning 429 with Retry-After
5. README with quick start, architecture, trade-offs, benchmark table
6. Demo script from PID section 25
7. Repeat run test (T18)

### Files
- `docker-compose.yml` (updated with 3 instances + proxy)
- `demo-api/server.ts` - Demo API
- `demo-api/middleware.ts` - Limiter middleware
- `bench/decision-latency.js` - k6 script
- `bench/redis-calls.js`
- `bench/memory-per-key.js`
- `bench/accuracy.js`
- `bench/quota-comparison.js`
- `bench/scaling.js`
- `bench/failure.js`
- `tests/concurrency/multi-instance.test.ts` - T6
- `tests/concurrency/repeat-runs.test.ts` - T18
- `README.md`
- `docs/demo-script.md`

### Acceptance
- T6 (three instances, global limit holds), T18 (concurrency tests pass 20 consecutive runs)
- Benchmark table generated from real measurements
- Demo script runs end to end
- All T1-T18 pass

---

## Phase 8: Admin Console

### Tasks
1. Console build setup (esbuild/Vite vanilla mode)
2. Font bundling (Inter + IBM Plex Mono via fontsource)
3. Serve console at `/console` from the app
4. Pages: Sign in, Overview, Plans/Policies, Clients/Keys, Playground, Usage/Quota, Shadow Report, Settings
5. Playwright tests
6. UI review and screenshots
7. Copy rule verification (no markdown symbols, no dashes)
8. All T1-T18 still pass

### Files
- `console/index.html`
- `console/src/main.ts`
- `console/src/api.ts` - API client
- `console/src/router.ts` - Client-side routing
- `console/src/pages/*.ts` - One file per page
- `console/src/styles.css` - Global styles
- `console/vite.config.ts`
- `tests/e2e/console.test.ts` - Playwright tests
- `docs/UI_REVIEW.md`

### Acceptance
- All console pages work and match look/copy rules
- Playwright tests pass
- Screenshots captured and reviewed
- No markdown symbols or dashes in visible text
- All T1-T18 still pass

---

## Traceability

See `docs/TRACEABILITY.md` for the complete mapping of FR, NFR, and test IDs to implementation files.
