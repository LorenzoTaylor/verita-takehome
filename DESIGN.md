# DESIGN.md

## 1. Data model

The schema has twelve tables. The core chain: `customers` → `api_keys` → `usage_events` → `usage_windows` → `invoice_line_items` → `invoices`. Supporting tables handle idempotency, ops access, and observability.

Key tables and why they're shaped the way they are:

- `usage_events`: `request_id TEXT UNIQUE` is the idempotency key, enforced at the DB level, one row per external event. `units BIGINT CHECK (units > 0)` prevents zero or negative billing. `status` tracks late arrivals.
- `usage_windows`: `UNIQUE (customer_id, window_start)` makes upserts deterministic. The aggregation job can run twice and land in the same row.
- `invoices`: `UNIQUE (customer_id, period_start)` prevents double-invoicing a month.
- `credits`: `idempotency_key TEXT UNIQUE` stops double-clicks from ops from issuing duplicate credits.
- `audit_log`: `actor_email` is denormalized so records survive ops user deletion. Immutability is enforced by Postgres triggers, not application code (see section 5).
- `processed_events`: a separate idempotency table, not a flag on `usage_events`, so the dedup check runs before the insert with no read-then-check race.
- `jobs`: a lock table used with `SKIP LOCKED` for job coordination.
- `webhook_deliveries`: delivery-ID dedup for payment webhooks.

Indexes and why each is there:

- `(customer_id, timestamp)` on `usage_events`: the primary read pattern for the window job and `/v1/usage`. Almost everything goes through this.
- `(customer_id, window_start)` on `usage_windows`: the invoice job reads per-customer per-hour.
- `prefix` on `api_keys`: auth narrows to one row via prefix before running Argon2. Without this index, auth scans the whole table on every request.
- `(customer_id, period_start DESC)` on `invoices`: customer portal lists invoices newest-first.
- `resolved_at WHERE resolved_at IS NULL` partial index on `anomaly_flags`: ops only queries open anomalies, so the index skips all resolved ones.

At 10x load (roughly 50M events/month): add a BRIN index on `usage_events(timestamp)` for range-scan efficiency and partition `usage_events` by month. Old partitions become read-only and can be archived cheaply.

At 100x (the 500M events/month production target): partition `usage_events` by `(customer_id hash, month)` so the window job parallelizes across shards. Add a read replica for ops queries — overview and anomaly pages do heavy aggregations that shouldn't compete with event writes. Citus is the next move if single-node write throughput hits the ceiling, but I'd exhaust partitioning first.

---

## 2. Idempotency and concurrency

Four scenarios that had to be safe:

**Event ingestion replay.** `POST /v1/events` runs `INSERT INTO processed_events (request_id) ON CONFLICT DO NOTHING` before touching `usage_events`. If the request_id is already present, the event is skipped and the response returns 200. The two-table design means the dedup gate is a single keyed write with no read-then-check race. Concurrent ingestion of the same request_id races to `processed_events`; only one wins.

**Aggregator running twice.** The window job acquires a row lock on `jobs WHERE job_type = 'window'` using `SELECT FOR UPDATE SKIP LOCKED`. A second instance finds zero rows and exits immediately, no blocking. The actual window update uses `INSERT ... ON CONFLICT (customer_id, window_start) DO UPDATE SET units_total = EXCLUDED.units_total`, which overwrites with the freshly computed total — safe to replay any number of times because the result is always derived from the complete set of source events for that hour.

**Webhook delivered three times.** `POST /webhooks/payments` runs `INSERT INTO webhook_deliveries (delivery_id) ON CONFLICT DO NOTHING`. If the delivery ID is already present, the handler returns 200 with no side effects. Signature verification runs before the dedup check, so unsigned requests never reach it.

**Ops double-clicking "issue credit".** The ops client generates a UUID idempotency key when the dialog opens and sends it in the request body. The `credits.idempotency_key` column has a `UNIQUE` constraint. A second identical request hits `ON CONFLICT DO NOTHING` and returns the existing credit row. The key is held for the lifetime of the dialog, not regenerated on each click.

---

## 3. Aggregation pipeline

The window job runs hourly. It does a full recompute: `SELECT customer_id, date_trunc('hour', timestamp), SUM(units) FROM usage_events WHERE status = 'normal' GROUP BY ...` and upserts the result into `usage_windows` with `ON CONFLICT DO UPDATE SET units_total = EXCLUDED.units_total`. This is intentionally a full scan rather than an incremental `WHERE timestamp >= last_run_at` approach. The trade-off: each run is slower (full table scan), but the result is always correct — late events, retries, and corrections are automatically captured on the next run with no bookkeeping. At current scale this is fine; at 500M events/month the fix is partitioning, not incrementalism (see section 4).

The invoice job runs monthly. It reads `usage_windows` for the billing period, applies tiered pricing from `price_plans` (tiers stored as JSONB, plan pinned at period start), and writes `invoice_line_items` and an `invoice` row. Invoices start as `draft` until explicitly issued.

Windows are recomputable. Invoices in `issued` or `paid` state are not — the invoice job skips any customer that already has a non-draft invoice for that period. Line-item overrides are soft: `overridden_at` gets set and the new value is written, but the original values stay in the audit log.

Late-arriving events are written with `status = 'late'` and excluded from the current window. The delta posts as a credit line item on the next open invoice. Closed invoices are never reopened. Customers see a credit on their next bill with a clear reason, and the historical record stays intact.

To check for drift between raw events and window totals: `SUM(units) FROM usage_events WHERE customer_id = $1 AND timestamp BETWEEN $start AND $end` vs `SUM(units_total) FROM usage_windows` for the same range. A gap means late events (`status = 'late'` are excluded from windows) or a job that hasn't run yet. The full-recompute approach means rerunning the job is always safe and self-correcting.

---

## 4. Failure modes

**Aggregation job performance.** The window job does a full table scan every hour — `SUM(units) GROUP BY customer_id, hour` across all of `usage_events`. At 500M events/month that table has roughly 16M rows per day, and the job runs 1,440 times daily. The fix is partitioning `usage_events` by month. Each run then scans only the current month's partition, which is bounded and shrinks relative to the total table. The `(customer_id, timestamp)` index handles the per-customer grouping within that partition. Incrementalism (tracking `last_run_at`) is an alternative but introduces drift risk when events arrive late or jobs crash mid-run; partitioning solves the performance problem while keeping the full-recompute correctness guarantee.

**Idempotency table write contention.** At 2,000 events/sec peak, `INSERT INTO processed_events` is a single-table write bottleneck. `ON CONFLICT` at that rate creates hot blocks and lock contention. The fix is Redis `SETNX` with a TTL long enough to cover the replay window (48 hours covers most delivery retries), keeping `processed_events` as an async audit trail. This decouples the fast path from Postgres.

**Single Postgres write node.** All writes — event ingestion, idempotency checks, window upserts, job locks — go through one instance. That's the hard ceiling. Migration in order: (1) read replicas for ops/reporting, since overview aggregations are read-heavy and shouldn't compete with event writes; (2) partition `usage_events` by customer_id hash if per-partition throughput becomes the constraint; (3) Citus if needed, but that's a real migration, not a dial to turn.

---

## 5. Threat model

**Hostile customer**

The obvious attack is guessing another customer's UUID and reading their invoices or usage.

Tenant scoping is enforced at the extractor level, not in individual handlers. The `CustomerSession` extractor resolves the API key to a `customer_id` and attaches it to the request. Every query binds `customer_id = $1` from the extractor. There's no handler that fetches by ID alone. A valid UUID belonging to a different customer returns 404, the same as a wrong UUID.

API keys are generated as `sk_<32 random bytes base64>`. An 8-character prefix is stored in plaintext to narrow the Argon2 verification to one row; the rest is hashed with Argon2id. The secret is shown once at creation and never again. A DB dump leaks prefixes, not secrets.

**Hostile internal user**

The realistic abuse case: an ops user issues an inflated credit to a customer they have a personal relationship with, or shaves a line item to undercharge.

Every credit issuance and line-item override writes to `audit_log` with `actor_id`, `actor_email`, `before_val`, `after_val`, and `reason`. The audit log is append-only via a Postgres trigger that raises an exception on any `UPDATE` or `DELETE`. This isn't a convention someone could forget — the trigger sits in the database, outside any application code path. An ops user can issue a credit; they can't erase it.

Double credit is blocked by the `idempotency_key` unique constraint on `credits`. A second click on the same dialog returns the existing credit row. The UI holds the key for the lifetime of the dialog.

**Compromised webhook source**

The risk is a replayed or forged payment webhook marking invoices paid without actual payment.

The endpoint verifies an HMAC-SHA256 signature against a shared secret from the environment (not the repo). Unsigned or incorrectly signed requests are rejected before any business logic runs. After verification, `webhook_deliveries` deduplicates by delivery ID — a redelivered webhook finds its ID already present and returns 200 with no side effects. If an attacker can forge the signature, the shared secret is compromised and the response is secret rotation, not code changes.

---

## 6. Trade-offs

**Cursor pagination vs. offset**

Usage events are written continuously. Offset pagination returns inconsistent results when rows are inserted mid-page — a customer's page 2 can skip rows that were on page 1 when the first request was made. Cursor pagination encodes the last-seen `(timestamp, id)` and queries `WHERE (timestamp, id) < ($cursor_ts, $cursor_id)`, which is stable regardless of concurrent inserts.

The cost: cursors are opaque to clients (can't jump to page N) and take a bit more to implement. For an API customers will integrate against programmatically, stable pagination is a correctness requirement. Offset would have been simpler and wrong.

**Job table with SKIP LOCKED vs. an external queue**

An external queue (Celery, RQ, Sidekiq) gives retries, dead-letter queues, and a monitoring UI. The cost is an additional service — Redis or RabbitMQ — plus separate coordination between the job runner and the database that needs its own safety guarantees.

A Postgres job table with `SKIP LOCKED` keeps everything in one place: the lock, the work, and the last-run timestamp are all queryable SQL. For three jobs running hourly and monthly, an extra service isn't worth it. If job count or cadence grows, migration is straightforward — the job table becomes a queue table and the locking logic moves into the queue library.

---

## 7. What wasn't built

**Event stream buffer.** `POST /v1/events` writes directly to Postgres. At 2,000 events/sec peak, a queue (Kafka or SQS) in front of ingestion is the standard buffer against spikes. Adding it is purely additive — the consumer replaces the HTTP ingest path, nothing else changes.

**Password reset and MFA.** Ops users have email/password login, no reset flow, no second factor. Fine for a prototype. Audit log integrity is only as good as the identity it captures, which is worth saying out loud.

**Alerting.** Anomaly flags are written to the DB and surfaced in the ops console, but nothing pages on them. In production this would wire to PagerDuty or equivalent.

**PDF invoices.** Invoice detail shows line items with no download option. A background job rendering to S3 and linking from the invoice record is the next obvious step.

**Multi-currency.** All amounts are USD minor units. Adding currency support is a schema change (`currency` column on `invoices`, pricing plan updates) and not much else architecturally.

Next priorities in order: Kafka ingest buffer, monthly partitioning on `usage_events`, Redis dedup for the fast path, dead-letter handling for webhooks, MFA for ops users.
