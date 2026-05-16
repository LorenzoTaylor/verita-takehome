# Decision Log

---

## Web Framework + DB Access

Complex queries (upserts, aggregations, locks) meant we needed to see the actual SQL — an ORM hiding that is a liability here. Framework and DB layer were picked together since they have to cooperate under the same async model.

| Option | Upsides | Downsides |
|---|---|---|
| Axum | Clean extractors, Tower ecosystem | Routing boilerplate |
| Actix-web | Fastest, mature | Actor model overhead |
| Warp | Elegant composition | Cryptic errors, less active |

| Option | Upsides | Downsides |
|---|---|---|
| SQLx | Raw SQL, compile-time checked | Write all SQL yourself |
| SeaORM | Migrations built in | Heavy, awkward joins |
| Diesel | Strong types | Sync-only, steep curve |

**Chose: Axum + SQLx.** Control over SQL, type-safe without ORM magic, Axum extractors make tenant scoping enforceable at the type level.

---

## Background Jobs + Idempotency

Considered together — the job mechanism and idempotency strategy are coupled. Two distinct problems: event replay (2,000/sec peak) and job double-run (hourly/monthly).

| Option | Upsides | Downsides |
|---|---|---|
| Job table + `SKIP LOCKED` | No extra infra, explicit | Roll locking yourself |
| apalis | Retries built in | Doesn't solve idempotency, extra dep |
| Tokio tasks + DB lock | Simplest | No crash persistence |

| Option | Upsides | Downsides |
|---|---|---|
| Idempotency table (`ON CONFLICT DO NOTHING`) | Durable, simple | Write hotspot at scale |
| Redis SETNX | Fast, low-latency | Extra infra, eviction risk |
| Idempotent queries only | No extra table | Only covers jobs, not events |

**Chose: Job table + `SKIP LOCKED` for scheduling. Idempotency table for events.**

Scaling note: idempotency table is the first thing that breaks at peak load. Migration path: Redis SETNX for dedup, keep the table as async audit trail.

---

## API Key Storage

Keys must not be retrievable in plaintext after creation. Considered how ops would identify which key a customer is using without exposing the secret.

| Option | Upsides | Downsides |
|---|---|---|
| Hash-only (Argon2) | Simple, secure | Ops can't identify keys |
| Prefix + hash | Ops visibility, Stripe-style | Slightly more complexity |

**Chose: Prefix + hash.** Store a short prefix (e.g. `sk_abc123`) + Argon2 hash of the full key. Show full key once on creation, never again. Ops can identify which key without seeing the secret.

What breaks: if the prefix is too long it leaks entropy. Keep prefix to 8 chars max.

---

## Tenant Scoping

Every `/v1` endpoint must be scoped to the authenticated customer. The risk is a customer guessing another customer's UUID and reading their data.

| Option | Upsides | Downsides |
|---|---|---|
| Per-handler check (`can_access_x`) | Familiar, explicit | Easy to forget, two DB round trips |
| Middleware attaches customer ID | Centralized auth | Still possible to skip the check in queries |
| Axum extractor + `WHERE customer_id = $1` | Compile-time enforced, one round trip | Requires discipline in query design |

**Chose: Axum extractor.** Auth resolves API key → `AuthenticatedCustomer` type. Every query that touches customer data takes that type and filters by `customer_id` in the SQL. Can't write a handler that skips it without the compiler complaining. No fetch-then-check — just filtered fetch.

What breaks: if a query joins across tables and the `customer_id` filter is on the wrong table, scoping silently fails. Mitigate with integration tests that assert cross-tenant access returns 404.

---

## Pagination

Usage events are written continuously — a customer paging through results while ingestion is happening will get duplicate or skipped rows with offset pagination.

| Option | Upsides | Downsides |
|---|---|---|
| Offset (`?page=2&limit=50`) | Simple, universal | Drifts under concurrent writes |
| Cursor (`?cursor=<token>`) | Stable, no drift | Slightly more complex |

**Chose: Cursor pagination.** Cursor encodes the last-seen `(timestamp, id)` pair. Query uses `WHERE (timestamp, id) < ($cursor_ts, $cursor_id)` — stable regardless of inserts. Token is base64-encoded, opaque to the client.

What breaks: cursors tied to `timestamp` break if two events share an identical timestamp and straddle a page boundary. Fix: always use `(timestamp, id)` as a composite cursor, never timestamp alone.

---

## Money & Pricing

Money stored as integer minor units (no floats, ever). The question was where tiered pricing logic lives.

| Option | Upsides | Downsides |
|---|---|---|
| Hardcoded in job | Simple | Price change = code deploy |
| Price plan table in DB | Data change, no deploy | One extra read per job run |

**Chose: Price plan table.** Tiers stored as rows with an `effective_from` date. Job reads the plan active at invoice period start — one read per job run (hourly), not per event. Naturally extends to future pricing changes without touching code.

What breaks: if `effective_from` logic has an off-by-one on period boundaries, a customer gets billed at the wrong tier for a full month. Fix: integration test that creates a plan mid-month and asserts the correct tier is applied.

---

## Audit Log Immutability

Spec requires credit issuance and line-item overrides to be immutable — mutating or deleting an audit row must not be possible through normal code paths.

| Option | Upsides | Downsides |
|---|---|---|
| App-level (no update/delete method exposed) | Simple | Relies on discipline, bypassable |
| DB trigger (raises exception on UPDATE/DELETE) | Enforced outside app, truly immutable | Slightly more infra |

**Chose: Postgres trigger.** A trigger on the audit table raises an exception on any `UPDATE` or `DELETE`. No application code path can bypass it — not a bug, not a missing check, not a future dev forgetting the rule.

What breaks: if you ever need to correct a genuinely bad audit entry (e.g. wrong actor logged), there's no app path to fix it. That's intentional — corrections should be a new entry, not a mutation.

---

## Late-Arriving Events

Events may arrive after their window has been aggregated or after an invoice has been issued. Full reconciliation is out of scope but the design must describe the approach.

| Option | Upsides | Downsides |
|---|---|---|
| Append to next open window | Simple, no special handling | Weird UX — usage shows up in wrong period |
| Flag + hold, credit adjustment next invoice | Clean history, immutable invoices, clear audit trail | Slightly more complexity |

**Chose: Flag and hold + credit adjustment.** Late events are written to the DB with a `late` status and excluded from the current window. Ops is surfaced the delta. The adjustment posts as a credit line item on the next invoice — closed invoices are never reopened or mutated. Customer sees a credit on their next bill with a clear reason. Immutable history is preserved throughout.

What breaks: if late events arrive in large batches (e.g. a backfill), the credit line item can be surprisingly large. Ops anomaly signal should flag credits over a threshold for review before the invoice is finalized.

---

## Frontend Structure

Spec allows one or two SPAs. Security isolation is a concern — ops components must never be reachable from the customer surface.

| Option | Upsides | Downsides |
|---|---|---|
| One SPA, two routes | Shared components, one build | Risk of leaking ops routes/components |
| Two separate SPAs | Hard isolation, separate auth flows | Duplicate some boilerplate |

**Chose: Two separate SPAs.** Customer dashboard and ops console are fully isolated apps with separate builds, separate auth, and no shared routing surface. No risk of an ops route being accidentally reachable from the customer app.

What breaks: shared logic (API client, types) gets duplicated. Fix: extract into a shared `packages/common` if it grows — but for this scope, duplication is fine.

Note: one Rust backend, one Postgres DB. Two SPAs are two frontend builds pointing at the same API — isolation is at the frontend level only.

---

## Ops Authentication

Spec doesn't define how ops users authenticate. Ops console is a separate SPA hitting the same backend.

| Option | Upsides | Downsides |
|---|---|---|
| Hardcoded env token (`OPS_SECRET`) | Zero complexity | No per-user identity in audit log |
| Ops user table | Per-user identity, proper audit trail | More scope |

**Chose: Ops user table.** Audit log entries must capture actor — a shared env token means every ops action looks the same in the log. Separate ops accounts give real actor identity. Kept simple: email + hashed password, JWT session, no roles/permissions beyond "is ops."

What breaks: no password reset flow, no MFA. Acceptable for this scope — document as next to build.

---

## Webhook Idempotency

Payment processor may deliver the same webhook multiple times. Must not double-effect (mark invoice paid twice, trigger duplicate actions).

| Option | Upsides | Downsides |
|---|---|---|
| Invoice state check (paid = no-op) | Simple | Breaks if processor sends multiple event types |
| Delivery ID dedup table | Correct for any event type, explicit | One extra table |

**Chose: Delivery ID dedup table.** Processor sends a unique delivery ID in the header. Store it on receipt — `INSERT ... ON CONFLICT DO NOTHING`. If it's already seen, return 200 immediately and do nothing. Handles replays regardless of invoice state or event type.

What breaks: delivery IDs must be trusted from the header — a forged or missing ID bypasses dedup. Mitigate: signature verification runs before dedup check, so unsigned requests are rejected first.

---

## Anomaly Detection

Spec calls out 10× 30-day average as the example signal. Additional signals in scope: zero usage drop, high-frequency `request_id` (retry loop), invoice spike vs. prior month, API key used from multiple IPs in short window.

**Signals in scope:**
- Usage 10× 30-day average
- Usage drops to zero
- Same `request_id` arriving at abnormal frequency
- Invoice amount spikes vs. prior month
- API key used from multiple IPs in short window

**Out of scope:** alerting/paging, email notifications, customer-facing anomaly visibility.

---

## Background Job Breakdown

Considered folding anomaly detection into the window job for simplicity. Rejected — mixing aggregation and anomaly logic couples two concerns that should evolve independently (different cadence, different logic).

| Option | Upsides | Downsides |
|---|---|---|
| Anomaly folded into window job | One less job | Coupled, harder to change independently |
| Separate anomaly job | Single responsibility, flexible cadence | One more job to operate |

**Chose: Three separate jobs.**

1. **Window job** — events → usage windows, runs hourly
2. **Invoice job** — windows → line items → invoices, runs monthly
3. **Anomaly job** — reads windows, computes rolling averages, writes anomaly flags, runs hourly after window job

Anomaly job reads from pre-aggregated windows — not raw events — so it's cheap. Each job stays focused and can be tuned or replaced without touching the others.

What breaks: if window job fails, anomaly job runs on stale data and may miss a spike. Fix: anomaly job checks window job last-run timestamp before executing.

---

## Failure Modes

Three things that break first at production scale.

**1. Aggregation job performance**
Hourly window job scans raw events across 5,000 customers. At 500M events/month it becomes a long-running, compute-heavy query. Fix: partition `usage_events` by hour, index on `(customer_id, timestamp)`, and process windows incrementally rather than full scans.

**2. Idempotency table write contention**
At 2,000 events/sec peak, `processed_events` is a single-table write hotspot. `INSERT ... ON CONFLICT` at that rate causes lock contention. Fix: migrate dedup to Redis SETNX for fast writes; keep the table as an async audit trail.

**3. Single Postgres write node**
All writes — events, idempotency checks, window updates, job locks — funnel into one instance. This is the ceiling. Fix: read replicas for ops/reporting queries first, then consider Citus or partitioning if write throughput becomes the wall.

Note: event stream is mocked in this implementation — in production, a queue (Kafka/SQS) in front of ingestion would be the real buffer against peak load.
