-- customers
CREATE TABLE customers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- api_keys
CREATE TABLE api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    prefix      TEXT NOT NULL,           -- 8-char human-readable prefix, stored plaintext
    key_hash    TEXT NOT NULL,           -- argon2 hash of full key
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX api_keys_customer_id_idx ON api_keys(customer_id);
CREATE INDEX api_keys_prefix_idx ON api_keys(prefix);

-- usage_events
CREATE TABLE usage_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  TEXT NOT NULL UNIQUE,   -- globally unique, idempotency key
    customer_id UUID NOT NULL REFERENCES customers(id),
    api_key_id  UUID NOT NULL REFERENCES api_keys(id),
    endpoint    TEXT NOT NULL,
    units       BIGINT NOT NULL CHECK (units > 0),
    timestamp   TIMESTAMPTZ NOT NULL,
    status      TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal', 'late'))
);

CREATE INDEX usage_events_customer_timestamp_idx ON usage_events(customer_id, timestamp);
CREATE INDEX usage_events_api_key_id_idx ON usage_events(api_key_id);

-- processed_events (idempotency table)
CREATE TABLE processed_events (
    request_id    TEXT PRIMARY KEY,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- usage_windows (one row per customer x hour)
CREATE TABLE usage_windows (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID NOT NULL REFERENCES customers(id),
    window_start TIMESTAMPTZ NOT NULL,  -- truncated to hour
    units_total  BIGINT NOT NULL DEFAULT 0,
    UNIQUE (customer_id, window_start)
);

CREATE INDEX usage_windows_customer_window_idx ON usage_windows(customer_id, window_start);

-- price_plans
CREATE TABLE price_plans (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    -- tiers: [{up_to: 10000, unit_price_minor: 0}, {up_to: 100000, unit_price_minor: 1}, {up_to: null, unit_price_minor: 1}]
    tiers         JSONB NOT NULL
);

-- customer_price_plans
CREATE TABLE customer_price_plans (
    customer_id   UUID NOT NULL REFERENCES customers(id),
    price_plan_id UUID NOT NULL REFERENCES price_plans(id),
    assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (customer_id, assigned_at)
);

CREATE INDEX customer_price_plans_customer_idx ON customer_price_plans(customer_id, assigned_at DESC);

-- invoices
CREATE TABLE invoices (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID NOT NULL REFERENCES customers(id),
    period_start TIMESTAMPTZ NOT NULL,
    period_end   TIMESTAMPTZ NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid')),
    total_minor  BIGINT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, period_start)
);

CREATE INDEX invoices_customer_id_idx ON invoices(customer_id, period_start DESC);

-- invoice_line_items
CREATE TABLE invoice_line_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id),
    description     TEXT NOT NULL,
    units           BIGINT NOT NULL DEFAULT 0,
    unit_price_minor BIGINT NOT NULL DEFAULT 0,
    total_minor     BIGINT NOT NULL DEFAULT 0,
    overridden_at   TIMESTAMPTZ
);

CREATE INDEX line_items_invoice_id_idx ON invoice_line_items(invoice_id);

-- credits
CREATE TABLE credits (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID NOT NULL REFERENCES customers(id),
    invoice_id   UUID REFERENCES invoices(id),  -- nullable: credit may not be tied to a specific invoice
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    reason       TEXT NOT NULL,
    created_by   UUID NOT NULL,                 -- references ops_users(id)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX credits_customer_id_idx ON credits(customer_id);

-- ops_users
CREATE TABLE ops_users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audit_log (append-only enforced by trigger below)
CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID NOT NULL,           -- ops_users(id)
    actor_email TEXT NOT NULL,           -- denormalized so log survives user deletion
    action      TEXT NOT NULL,           -- 'credit_issued' | 'line_item_overridden'
    entity_type TEXT NOT NULL,
    entity_id   UUID NOT NULL,
    before_val  JSONB,
    after_val   JSONB,
    reason      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id);
CREATE INDEX audit_log_actor_idx ON audit_log(actor_id);

-- immutability trigger
CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- jobs (background job lock table)
CREATE TABLE jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type    TEXT NOT NULL UNIQUE,   -- 'window', 'invoice', 'anomaly'
    status      TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running')),
    last_run_at TIMESTAMPTZ,
    locked_at   TIMESTAMPTZ
);

INSERT INTO jobs (job_type) VALUES ('window'), ('invoice'), ('anomaly');

-- webhook_deliveries (idempotency for payment webhooks)
CREATE TABLE webhook_deliveries (
    delivery_id  TEXT PRIMARY KEY,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

-- anomaly_flags
CREATE TABLE anomaly_flags (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID NOT NULL REFERENCES customers(id),
    signal_type  TEXT NOT NULL,   -- 'usage_spike' | 'usage_drop' | 'request_id_flood' | 'invoice_spike' | 'multi_ip'
    value        NUMERIC,
    threshold    NUMERIC,
    flagged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ
);

CREATE INDEX anomaly_flags_customer_idx ON anomaly_flags(customer_id, flagged_at DESC);
CREATE INDEX anomaly_flags_unresolved_idx ON anomaly_flags(resolved_at) WHERE resolved_at IS NULL;
