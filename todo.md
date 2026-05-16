# Brain Doc — Metered API Billing

## Decisions

### Stack
- **Backend:** Rust, Axum, SQLx
- **Database:** Postgres — money in integer minor units, TIMESTAMPTZ everywhere, UUIDs for all PKs
- **Frontend:** Two separate React + Vite + TypeScript SPAs (customer dashboard, ops console) — one Rust backend, one DB
- **Migrations:** `sqlx migrate`
- **Infra:** Docker Compose — postgres + backend + two frontend services

### Background Jobs
Three jobs, each with its own locked row in a `jobs` table. Workers claim rows via `SELECT ... FOR UPDATE SKIP LOCKED` — concurrent runs exit cleanly.

1. **Window job** — events → usage windows, hourly
2. **Invoice job** — windows → line items → invoices, monthly
3. **Anomaly job** — reads windows, writes anomaly flags, hourly (runs after window job)

Anomaly job checks window job `last_run_at` before executing to avoid stale data.

### Idempotency
- **Events:** `processed_events` table, `INSERT ... ON CONFLICT (request_id) DO NOTHING`. If 0 rows affected, skip.
- **Jobs:** `SKIP LOCKED` on job table row — only one worker proceeds.
- **Webhook:** delivery ID dedup table, same `ON CONFLICT` pattern. Signature verified before dedup check.

Scaling path: migrate event dedup to Redis SETNX at peak load, keep table as async audit trail.

### API Key Storage
Prefix + hash (Stripe-style). Store short prefix (8 chars max) + Argon2 hash. Show full key once on creation, never again. Ops can identify keys by prefix without seeing the secret.

### Tenant Scoping
Axum extractor resolves API key → `AuthenticatedCustomer` type. All queries filter by `customer_id = $1` in SQL — no fetch-then-check. Can't write a handler without the extractor if the type requires it.

Test: integration tests assert cross-tenant access returns 404.

### Pagination
Cursor-based. Cursor encodes `(timestamp, id)` pair, base64-encoded, opaque to client. Query: `WHERE (timestamp, id) < ($cursor_ts, $cursor_id)`. Never timestamp alone.

### Money & Pricing
Integer minor units. Tiered pricing stored in a `price_plans` table with `effective_from` date. Invoice job reads the plan active at period start — one DB read per job run, not per event.

### Audit Log Immutability
Postgres trigger raises exception on any `UPDATE` or `DELETE` against the audit table. Enforced outside the application — no code path can bypass it. Corrections = new entry, never mutation.

### Late-Arriving Events
Written to DB with `late` status, excluded from current window. Ops sees the delta. Adjustment posts as credit line item on next invoice. Closed invoices never reopened or mutated.

Flag: large late-event batches produce large credits — anomaly job should surface credits over a threshold.

### Ops Authentication
Ops user table: email + hashed password, JWT session. No roles beyond "is ops." Per-user identity in audit log is the reason — a shared env token makes every ops action look identical.

Not built: password reset, MFA.

### Anomaly Signals (in scope)
- Usage 10× 30-day rolling average
- Usage drops to zero
- Same `request_id` arriving at abnormal frequency
- Invoice amount spikes vs. prior month
- API key used from multiple IPs in short window

Out of scope: alerting/paging, email notifications, customer-facing visibility.

### Failure Modes
1. **Aggregation job** — compute-heavy at 500M events/month. Fix: partition `usage_events` by hour, incremental window processing, index on `(customer_id, timestamp)`.
2. **Idempotency table write contention** — 2,000 events/sec peak is a single-table hotspot. Fix: Redis SETNX for dedup.
3. **Single Postgres write node** — all writes funnel into one instance. Fix: read replicas for ops/reporting first, then Citus or partitioning.

Note: event stream is mocked — in production a queue (Kafka/SQS) sits in front of ingestion.

---

## Todo

### Infrastructure
- [x] Init Cargo workspace (`backend/`)
- [x] Init two Vite + React + TS apps (`frontend/customer/`, `frontend/ops/`)
- [x] Write `docker-compose.yml` — postgres, backend, customer frontend, ops frontend
- [x] Write `.env.example` — DB creds, webhook signing key, JWT secret, ops seed user
- [x] Write `sqlx migrate` migration files (see schema below)

### Database Schema
- [x] `customers` — id, name, email, created_at
- [x] `api_keys` — id, customer_id, prefix, key_hash, created_at, revoked_at
- [x] `usage_events` — id, request_id (unique), customer_id, api_key_id, endpoint, units, timestamp, status (normal/late)
- [x] `processed_events` — request_id PK, processed_at
- [x] `usage_windows` — id, customer_id, window_start (hour), units_total
- [x] `price_plans` — id, name, effective_from, tiers (JSONB array of {up_to, unit_price_minor})
- [x] `customer_price_plans` — customer_id, price_plan_id, assigned_at
- [x] `invoices` — id, customer_id, period_start, period_end, status (draft/issued/paid), total_minor
- [x] `invoice_line_items` — id, invoice_id, description, units, unit_price_minor, total_minor, overridden_at
- [x] `credits` — id, customer_id, invoice_id, amount_minor, reason, created_by, created_at
- [x] `audit_log` — id, actor_id, action, entity_type, entity_id, before (JSONB), after (JSONB), reason, created_at
- [x] `jobs` — id, job_type, status, last_run_at, locked_at
- [x] `webhook_deliveries` — delivery_id PK, received_at, processed_at
- [x] `ops_users` — id, email, password_hash, created_at
- [x] `anomaly_flags` — id, customer_id, signal_type, value, threshold, flagged_at, resolved_at
- [x] Postgres trigger on `audit_log` — block UPDATE/DELETE

### Backend — Core
- [x] Axum app setup, router, shared state (DB pool)
- [x] `AuthenticatedCustomer` extractor — resolve API key → customer, reject unknown/revoked keys
- [x] `OpsUser` extractor — verify JWT, reject non-ops
- [x] Webhook signature verification middleware

### Backend — Customer API (`/v1`)
- [x] `POST /v1/events` — batch ingest, idempotency table check, insert usage_events
- [x] `GET /v1/usage` — cursor paginated, filter by date range + api key
- [x] `GET /v1/invoices` — list invoices for authenticated customer
- [x] `GET /v1/invoices/{id}` — invoice detail + line items

### Backend — Ops API (`/ops`)
- [x] `POST /ops/auth/login` — email + password → JWT
- [x] `GET /ops/customers` — list all customers
- [x] `GET /ops/customers/{id}` — customer detail, usage summary, invoices, anomaly flags
- [x] `POST /ops/customers/{id}/credits` — issue credit, write audit log
- [x] `PATCH /ops/invoices/{id}/line-items/{id}` — override line item, write audit log

### Backend — Webhook
- [ ] `POST /webhooks/payments` — verify signature, dedup delivery ID, mark invoice paid

### Background Jobs
- [x] Job runner — poll jobs table on interval, `SKIP LOCKED` claim, dispatch by type
- [x] Window job — aggregate `usage_events` into `usage_windows` by customer × hour
- [x] Invoice job — roll windows into line items, apply tiered pricing from price plan, create invoice, transition status draft → issued
- [x] Anomaly job — compute rolling 30-day averages, write `anomaly_flags` for each signal type

### Seed / Generator Script
- [ ] Create N customers with API keys
- [ ] Generate usage events at realistic rate (200/sec sustained, bursts)
- [ ] Introduce duplicate `request_id`s to test idempotency
- [ ] Introduce late-arriving events
- [ ] Seed price plans, ops users

### Customer Frontend (`frontend/customer`)
- [ ] Auth — API key entry, store in memory (not localStorage)
- [ ] Usage chart — current period, units over time
- [ ] Usage table — cursor-paginated, filterable by date + api key
- [ ] Invoice list
- [ ] Invoice detail — line items, credits applied
- [ ] Loading + error states on all data fetches

### Ops Frontend (`frontend/ops`)
- [ ] Auth — login form, JWT stored in memory
- [ ] Customer list — searchable
- [ ] Customer detail — usage summary, invoice list, anomaly flags
- [ ] Issue credit — confirmation modal, reason required, idempotency token on submit
- [ ] Line item override — confirmation modal, reason required, shows before/after, idempotency token on submit
- [ ] Loading + error states on all data fetches

### Tests
- [ ] Event ingestion idempotency — same request_id delivered 3x = billed once
- [ ] Concurrent ingestion — two workers processing same request_id simultaneously
- [ ] Aggregator idempotency — window job runs twice = same window totals
- [ ] Tenant isolation — customer A cannot read customer B's invoice or usage
- [ ] Tiered pricing math — units across tier boundaries calculate correctly
- [ ] Credit issuance double-click — ops clicks twice = one credit
- [ ] Webhook replay — same delivery ID twice = invoice paid once
- [ ] Audit log immutability — UPDATE/DELETE on audit_log raises exception
- [ ] Late event handling — late event excluded from closed window, surfaces as credit

### DESIGN.md
- [ ] Data model section — schema, indexes, 10×/100× scaling
- [ ] Idempotency & concurrency section
- [ ] Aggregation pipeline section
- [ ] Failure modes section
- [ ] Threat model section — hostile customer, hostile ops user, compromised webhook
- [ ] Trade-offs section (min 2)
- [ ] Operational thinking — what to alert on, migration story, how ops debugs a wrong invoice
- [ ] What you didn't build section
