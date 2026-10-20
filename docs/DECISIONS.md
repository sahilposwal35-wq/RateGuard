# RateGuard: Decision Log

All decisions, scope changes, and interpretive choices are recorded here with date and rationale.

## Scope Changes

### SC-001: Admin Console Added (2026-10-20)

**Change:** "User interface" removed from PID section 5.2 (Out of scope). Admin console added to section 5.1 (In scope). New endpoint `GET /admin/v1/decisions` added to section 16.2.

**Reason:** The owner approved a small admin console as a thin client of the admin API, used to demonstrate the limiter live. The console contains no business logic; every number shown comes from a real API response.

**Impact:** New Phase 8 added to the development plan. Console served at `/console`. New in-memory ring buffer (last 200 decisions) exposed via `GET /admin/v1/decisions` (read only, added in Phase 6).

---

## Interpretive Decisions

Decisions made where the PID was ambiguous, choosing the simplest interpretation as required.

(Entries will be added during implementation as ambiguities arise.)
