use axum::{
    extract::{Path, Query, State},
    routing::{get, patch, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Duration, Utc};
use std::collections::HashMap;
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    extractors::ops_user::{Claims, OpsUser},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(post_login))
        .route("/overview", get(get_overview))
        .route("/revenue-chart", get(get_revenue_chart))
        .route("/events-by-hour", get(get_events_by_hour))
        .route("/customers", get(get_customers))
        .route("/customers/:id", get(get_customer))
        .route("/customers/:id/usage", get(get_customer_usage))
        .route("/customers/:id/credits", post(post_credit))
        .route("/invoices", get(get_all_invoices))
        .route("/invoices/:id/line-items", get(get_invoice_line_items))
        .route(
            "/invoices/:invoice_id/line-items/:item_id",
            patch(patch_line_item),
        )
        .route("/credits", get(get_all_credits))
        .route("/anomalies", get(get_anomalies))
}

// ── Cursor pagination helpers ─────────────────────────────────────────────────

fn encode_cursor(ts: DateTime<Utc>, id: Uuid) -> String {
    URL_SAFE_NO_PAD.encode(format!("{},{}", ts.to_rfc3339(), id))
}

fn decode_cursor(s: &str) -> Option<(DateTime<Utc>, Uuid)> {
    let bytes = URL_SAFE_NO_PAD.decode(s).ok()?;
    let decoded = String::from_utf8(bytes).ok()?;
    let (ts_str, id_str) = decoded.split_once(',')?;
    let ts = DateTime::parse_from_rfc3339(ts_str).ok()?.with_timezone(&Utc);
    let id = Uuid::parse_str(id_str).ok()?;
    Some((ts, id))
}

#[derive(Deserialize)]
struct OpsPageParams {
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Serialize)]
struct Paginated<T: Serialize> {
    data: Vec<T>,
    next_cursor: Option<String>,
}

// ── Login ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    token: String,
}

async fn post_login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Json<LoginResponse>> {
    #[derive(sqlx::FromRow)]
    struct OpsUserRow {
        id: Uuid,
        password_hash: String,
    }

    let row = sqlx::query_as::<_, OpsUserRow>(
        "SELECT id, password_hash FROM ops_users WHERE email = $1",
    )
    .bind(&body.email)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let hash = row.password_hash.clone();
    let password = body.password.clone();
    let valid = tokio::task::spawn_blocking(move || {
        use argon2::{Argon2, PasswordHash, PasswordVerifier};
        let parsed = PasswordHash::new(&hash).map_err(|_| ())?;
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .map_err(|_| ())
    })
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    if valid.is_err() {
        return Err(AppError::Unauthorized);
    }

    let exp = (Utc::now() + Duration::hours(24)).timestamp() as usize;
    let claims = Claims { sub: row.id.to_string(), email: body.email, exp, role: "ops".to_string() };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    Ok(Json(LoginResponse { token }))
}

// ── Customers ─────────────────────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
struct CustomerRow {
    id: Uuid,
    name: String,
    email: String,
    created_at: chrono::DateTime<Utc>,
}

async fn get_customers(
    _ops: OpsUser,
    State(state): State<AppState>,
    Query(params): Query<OpsPageParams>,
) -> Result<Json<Paginated<CustomerRow>>> {
    let limit = params.limit.unwrap_or(100).min(500);

    let rows = if let Some(ref c) = params.cursor {
        let (cursor_ts, cursor_id) =
            decode_cursor(c).ok_or_else(|| AppError::BadRequest("invalid cursor".into()))?;
        sqlx::query_as::<_, CustomerRow>(
            "SELECT id, name, email, created_at FROM customers
             WHERE (created_at < $1 OR (created_at = $1 AND id < $2))
             ORDER BY created_at DESC, id DESC LIMIT $3",
        )
        .bind(cursor_ts)
        .bind(cursor_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, CustomerRow>(
            "SELECT id, name, email, created_at FROM customers
             ORDER BY created_at DESC, id DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    let next_cursor = if rows.len() == limit as usize {
        rows.last().map(|r| encode_cursor(r.created_at, r.id))
    } else {
        None
    };

    Ok(Json(Paginated { data: rows, next_cursor }))
}

#[derive(Serialize, sqlx::FromRow)]
struct InvoiceSummary {
    id: Uuid,
    period_start: chrono::DateTime<Utc>,
    period_end: chrono::DateTime<Utc>,
    status: String,
    total_minor: i64,
    created_at: chrono::DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
struct CreditRow {
    id: Uuid,
    amount_minor: i64,
    reason: String,
    created_at: chrono::DateTime<Utc>,
}

#[derive(Serialize)]
struct CustomerDetail {
    #[serde(flatten)]
    customer: CustomerRow,
    invoices: Vec<InvoiceSummary>,
    credits: Vec<CreditRow>,
}

async fn get_customer(
    _ops: OpsUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<CustomerDetail>> {
    let customer = sqlx::query_as::<_, CustomerRow>(
        "SELECT id, name, email, created_at FROM customers WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let invoices = sqlx::query_as::<_, InvoiceSummary>(
        "SELECT id, period_start, period_end, status, total_minor, created_at
         FROM invoices WHERE customer_id = $1 ORDER BY period_start DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let credits = sqlx::query_as::<_, CreditRow>(
        "SELECT id, amount_minor, reason, created_at
         FROM credits WHERE customer_id = $1 ORDER BY created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(CustomerDetail { customer, invoices, credits }))
}

// ── Credits ───────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreditBody {
    amount_minor: i64,
    reason: String,
    idempotency_key: String,
}

async fn post_credit(
    ops: OpsUser,
    State(state): State<AppState>,
    Path(customer_id): Path<Uuid>,
    Json(body): Json<CreditBody>,
) -> Result<Json<CreditRow>> {
    if body.amount_minor <= 0 {
        return Err(AppError::BadRequest("amount_minor must be > 0".into()));
    }

    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM customers WHERE id = $1)")
            .bind(customer_id)
            .fetch_one(&state.db)
            .await?;
    if !exists {
        return Err(AppError::NotFound);
    }

    let credit_id = Uuid::new_v4();

    // RETURNING returns a row only on fresh insert; ON CONFLICT DO NOTHING returns nothing on replay.
    let inserted = sqlx::query_as::<_, CreditRow>(
        "INSERT INTO credits (id, customer_id, amount_minor, reason, created_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, amount_minor, reason, created_at",
    )
    .bind(credit_id)
    .bind(customer_id)
    .bind(body.amount_minor)
    .bind(&body.reason)
    .bind(ops.id)
    .bind(&body.idempotency_key)
    .fetch_optional(&state.db)
    .await?;

    if let Some(row) = inserted {
        sqlx::query(
            "INSERT INTO audit_log
                 (actor_id, actor_email, action, entity_type, entity_id, after_val, reason)
             VALUES ($1, $2, 'credit_issued', 'credit', $3, $4, $5)",
        )
        .bind(ops.id)
        .bind(&ops.email)
        .bind(row.id)
        .bind(json!({ "amount_minor": body.amount_minor, "customer_id": customer_id }))
        .bind(&body.reason)
        .execute(&state.db)
        .await?;
        Ok(Json(row))
    } else {
        let row = sqlx::query_as::<_, CreditRow>(
            "SELECT id, amount_minor, reason, created_at FROM credits WHERE idempotency_key = $1",
        )
        .bind(&body.idempotency_key)
        .fetch_one(&state.db)
        .await?;
        Ok(Json(row))
    }
}

// ── Customer usage ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct UsageDay {
    date: String,
    units: i64,
}

async fn get_customer_usage(
    _ops: OpsUser,
    State(state): State<AppState>,
    Path(customer_id): Path<Uuid>,
) -> Result<Json<Vec<UsageDay>>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        day: chrono::NaiveDate,
        units: i64,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT DATE(timestamp AT TIME ZONE 'UTC') as day, SUM(units)::bigint as units
         FROM usage_events
         WHERE customer_id = $1 AND timestamp >= now() - interval '30 days'
         GROUP BY DATE(timestamp AT TIME ZONE 'UTC')
         ORDER BY day",
    )
    .bind(customer_id)
    .fetch_all(&state.db)
    .await?;

    let map: HashMap<chrono::NaiveDate, i64> =
        rows.into_iter().map(|r| (r.day, r.units)).collect();
    let today = chrono::Utc::now().date_naive();
    let days: Vec<UsageDay> = (0..30i64)
        .rev()
        .map(|i| {
            let d = today - chrono::Duration::days(i);
            UsageDay { date: d.to_string(), units: *map.get(&d).unwrap_or(&0) }
        })
        .collect();

    Ok(Json(days))
}

// ── Line items ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PatchLineItemBody {
    total_minor: i64,
    reason: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct LineItemRow {
    id: Uuid,
    description: String,
    units: i64,
    unit_price_minor: i64,
    total_minor: i64,
    overridden_at: Option<chrono::DateTime<Utc>>,
}

async fn patch_line_item(
    ops: OpsUser,
    State(state): State<AppState>,
    Path((invoice_id, item_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<PatchLineItemBody>,
) -> Result<Json<LineItemRow>> {
    if body.total_minor < 0 {
        return Err(AppError::BadRequest("total_minor must be >= 0".into()));
    }

    let mut tx = state.db.begin().await?;

    // Validate line item belongs to this invoice and capture before state for audit
    let before = sqlx::query_as::<_, LineItemRow>(
        "SELECT id, description, units, unit_price_minor, total_minor, overridden_at
         FROM invoice_line_items WHERE id = $1 AND invoice_id = $2",
    )
    .bind(item_id)
    .bind(invoice_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    sqlx::query(
        "UPDATE invoice_line_items SET total_minor = $1, overridden_at = now() WHERE id = $2",
    )
    .bind(body.total_minor)
    .bind(item_id)
    .execute(&mut *tx)
    .await?;

    // Recompute invoice total from all line items
    sqlx::query(
        "UPDATE invoices
         SET total_minor = (
             SELECT COALESCE(SUM(total_minor), 0)
             FROM invoice_line_items
             WHERE invoice_id = $1
         )
         WHERE id = $1",
    )
    .bind(invoice_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO audit_log
             (actor_id, actor_email, action, entity_type, entity_id, before_val, after_val, reason)
         VALUES ($1, $2, 'line_item_overridden', 'invoice_line_item', $3, $4, $5, $6)",
    )
    .bind(ops.id)
    .bind(&ops.email)
    .bind(item_id)
    .bind(json!({ "total_minor": before.total_minor }))
    .bind(json!({ "total_minor": body.total_minor }))
    .bind(&body.reason)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let updated = sqlx::query_as::<_, LineItemRow>(
        "SELECT id, description, units, unit_price_minor, total_minor, overridden_at
         FROM invoice_line_items WHERE id = $1",
    )
    .bind(item_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(updated))
}

async fn get_invoice_line_items(
    _ops: OpsUser,
    State(state): State<AppState>,
    Path(invoice_id): Path<Uuid>,
) -> Result<Json<Vec<LineItemRow>>> {
    let items = sqlx::query_as::<_, LineItemRow>(
        "SELECT id, description, units, unit_price_minor, total_minor, overridden_at
         FROM invoice_line_items WHERE invoice_id = $1 ORDER BY id",
    )
    .bind(invoice_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(items))
}

// ── Overview ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct OverviewQuery {
    days: Option<i64>,
}

#[derive(Serialize)]
struct OverviewStats {
    total_customers: i64,
    prev_customers: i64,
    total_revenue_minor: i64,
    prev_revenue_minor: i64,
    open_invoices: i64,
    active_anomalies: i64,
    prev_active_anomalies: i64,
}

async fn get_overview(
    _ops: OpsUser,
    State(state): State<AppState>,
    Query(q): Query<OverviewQuery>,
) -> Result<Json<OverviewStats>> {
    let days = q.days.unwrap_or(30).max(1);

    let total_customers: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM customers")
            .fetch_one(&state.db)
            .await?;

    let prev_customers: i64 =
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM customers WHERE created_at < now() - ($1 * interval '1 day')"
        )
        .bind(days)
        .fetch_one(&state.db)
        .await?;

    let total_revenue_minor: i64 =
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_minor), 0)::bigint FROM invoices
             WHERE status = 'paid' AND period_end >= now() - ($1 * interval '1 day')"
        )
        .bind(days)
        .fetch_one(&state.db)
        .await?;

    let prev_revenue_minor: i64 =
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_minor), 0)::bigint FROM invoices
             WHERE status = 'paid'
             AND period_end >= now() - ($1 * 2 * interval '1 day')
             AND period_end < now() - ($1 * interval '1 day')"
        )
        .bind(days)
        .fetch_one(&state.db)
        .await?;

    let open_invoices: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM invoices WHERE status IN ('draft', 'issued')")
            .fetch_one(&state.db)
            .await?;

    let active_anomalies: i64 =
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM anomaly_flags
             WHERE resolved_at IS NULL AND flagged_at >= now() - ($1 * interval '1 day')"
        )
        .bind(days)
        .fetch_one(&state.db)
        .await?;

    let prev_active_anomalies: i64 =
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM anomaly_flags
             WHERE resolved_at IS NULL
             AND flagged_at >= now() - ($1 * 2 * interval '1 day')
             AND flagged_at < now() - ($1 * interval '1 day')"
        )
        .bind(days)
        .fetch_one(&state.db)
        .await?;

    Ok(Json(OverviewStats {
        total_customers, prev_customers,
        total_revenue_minor, prev_revenue_minor,
        open_invoices,
        active_anomalies, prev_active_anomalies,
    }))
}

// ── Revenue chart ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct RevenueDay {
    date: String,
    revenue_minor: i64,
}

async fn get_revenue_chart(
    _ops: OpsUser,
    State(state): State<AppState>,
    Query(q): Query<OverviewQuery>,
) -> Result<Json<Vec<RevenueDay>>> {
    let days = q.days.unwrap_or(90).max(1);

    #[derive(sqlx::FromRow)]
    struct Row { day: chrono::NaiveDate, revenue_minor: i64 }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT DATE(period_end AT TIME ZONE 'UTC') AS day,
                COALESCE(SUM(total_minor), 0)::bigint AS revenue_minor
         FROM invoices
         WHERE status = 'paid' AND period_end >= now() - ($1 * interval '1 day')
         GROUP BY DATE(period_end AT TIME ZONE 'UTC')
         ORDER BY day",
    )
    .bind(days)
    .fetch_all(&state.db)
    .await?;

    let map: HashMap<chrono::NaiveDate, i64> =
        rows.into_iter().map(|r| (r.day, r.revenue_minor)).collect();
    let today = chrono::Utc::now().date_naive();
    let data: Vec<RevenueDay> = (0..days)
        .rev()
        .map(|i| {
            let d = today - chrono::Duration::days(i);
            RevenueDay { date: d.to_string(), revenue_minor: *map.get(&d).unwrap_or(&0) }
        })
        .collect();

    Ok(Json(data))
}

// ── Events by hour ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct EventsHour {
    h: String,
    events: i64,
}

async fn get_events_by_hour(
    _ops: OpsUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<EventsHour>>> {
    #[derive(sqlx::FromRow)]
    struct Row { hour: i32, events: i64 }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT EXTRACT(HOUR FROM timestamp AT TIME ZONE 'UTC')::int AS hour,
                COUNT(*)::bigint AS events
         FROM usage_events
         WHERE timestamp >= DATE_TRUNC('day', now() AT TIME ZONE 'UTC')
         GROUP BY 1
         ORDER BY 1",
    )
    .fetch_all(&state.db)
    .await?;

    let map: HashMap<i32, i64> = rows.into_iter().map(|r| (r.hour, r.events)).collect();
    let data: Vec<EventsHour> = (0..24)
        .map(|h| EventsHour {
            h: format!("{:02}", h),
            events: *map.get(&h).unwrap_or(&0),
        })
        .collect();

    Ok(Json(data))
}

// ── All invoices ──────────────────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
struct InvoiceListRow {
    id: Uuid,
    customer_id: Uuid,
    customer_name: String,
    period_start: chrono::DateTime<Utc>,
    period_end: chrono::DateTime<Utc>,
    status: String,
    total_minor: i64,
    created_at: chrono::DateTime<Utc>,
}

async fn get_all_invoices(
    _ops: OpsUser,
    State(state): State<AppState>,
    Query(params): Query<OpsPageParams>,
) -> Result<Json<Paginated<InvoiceListRow>>> {
    let limit = params.limit.unwrap_or(100).min(500);

    let rows = if let Some(ref c) = params.cursor {
        let (cursor_ts, cursor_id) =
            decode_cursor(c).ok_or_else(|| AppError::BadRequest("invalid cursor".into()))?;
        sqlx::query_as::<_, InvoiceListRow>(
            "SELECT i.id, i.customer_id, c.name AS customer_name,
                    i.period_start, i.period_end, i.status, i.total_minor, i.created_at
             FROM invoices i JOIN customers c ON c.id = i.customer_id
             WHERE (i.created_at < $1 OR (i.created_at = $1 AND i.id < $2))
             ORDER BY i.created_at DESC, i.id DESC LIMIT $3",
        )
        .bind(cursor_ts)
        .bind(cursor_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, InvoiceListRow>(
            "SELECT i.id, i.customer_id, c.name AS customer_name,
                    i.period_start, i.period_end, i.status, i.total_minor, i.created_at
             FROM invoices i JOIN customers c ON c.id = i.customer_id
             ORDER BY i.created_at DESC, i.id DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    let next_cursor = if rows.len() == limit as usize {
        rows.last().map(|r| encode_cursor(r.created_at, r.id))
    } else {
        None
    };

    Ok(Json(Paginated { data: rows, next_cursor }))
}

// ── All credits ───────────────────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
struct CreditListRow {
    id: Uuid,
    customer_id: Uuid,
    customer_name: String,
    amount_minor: i64,
    reason: String,
    created_at: chrono::DateTime<Utc>,
}

async fn get_all_credits(
    _ops: OpsUser,
    State(state): State<AppState>,
    Query(params): Query<OpsPageParams>,
) -> Result<Json<Paginated<CreditListRow>>> {
    let limit = params.limit.unwrap_or(100).min(500);

    let rows = if let Some(ref c) = params.cursor {
        let (cursor_ts, cursor_id) =
            decode_cursor(c).ok_or_else(|| AppError::BadRequest("invalid cursor".into()))?;
        sqlx::query_as::<_, CreditListRow>(
            "SELECT cr.id, cr.customer_id, c.name AS customer_name,
                    cr.amount_minor, cr.reason, cr.created_at
             FROM credits cr JOIN customers c ON c.id = cr.customer_id
             WHERE (cr.created_at < $1 OR (cr.created_at = $1 AND cr.id < $2))
             ORDER BY cr.created_at DESC, cr.id DESC LIMIT $3",
        )
        .bind(cursor_ts)
        .bind(cursor_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, CreditListRow>(
            "SELECT cr.id, cr.customer_id, c.name AS customer_name,
                    cr.amount_minor, cr.reason, cr.created_at
             FROM credits cr JOIN customers c ON c.id = cr.customer_id
             ORDER BY cr.created_at DESC, cr.id DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    let next_cursor = if rows.len() == limit as usize {
        rows.last().map(|r| encode_cursor(r.created_at, r.id))
    } else {
        None
    };

    Ok(Json(Paginated { data: rows, next_cursor }))
}

// ── Anomalies ─────────────────────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
struct AnomalyListRow {
    id: Uuid,
    customer_id: Uuid,
    customer_name: String,
    signal_type: String,
    value: Option<f64>,
    threshold: Option<f64>,
    flagged_at: chrono::DateTime<Utc>,
    resolved_at: Option<chrono::DateTime<Utc>>,
}

async fn get_anomalies(
    _ops: OpsUser,
    State(state): State<AppState>,
    Query(params): Query<OpsPageParams>,
) -> Result<Json<Paginated<AnomalyListRow>>> {
    let limit = params.limit.unwrap_or(100).min(500);

    let rows = if let Some(ref c) = params.cursor {
        let (cursor_ts, cursor_id) =
            decode_cursor(c).ok_or_else(|| AppError::BadRequest("invalid cursor".into()))?;
        sqlx::query_as::<_, AnomalyListRow>(
            "SELECT af.id, af.customer_id, c.name AS customer_name,
                    af.signal_type, af.value::float8, af.threshold::float8,
                    af.flagged_at, af.resolved_at
             FROM anomaly_flags af JOIN customers c ON c.id = af.customer_id
             WHERE (af.flagged_at < $1 OR (af.flagged_at = $1 AND af.id < $2))
             ORDER BY af.flagged_at DESC, af.id DESC LIMIT $3",
        )
        .bind(cursor_ts)
        .bind(cursor_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, AnomalyListRow>(
            "SELECT af.id, af.customer_id, c.name AS customer_name,
                    af.signal_type, af.value::float8, af.threshold::float8,
                    af.flagged_at, af.resolved_at
             FROM anomaly_flags af JOIN customers c ON c.id = af.customer_id
             ORDER BY af.flagged_at DESC, af.id DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    let next_cursor = if rows.len() == limit as usize {
        rows.last().map(|r| encode_cursor(r.flagged_at, r.id))
    } else {
        None
    };

    Ok(Json(Paginated { data: rows, next_cursor }))
}
