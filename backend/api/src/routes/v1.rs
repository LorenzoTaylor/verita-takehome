use axum::{
    extract::{Path, Query, State},
    routing::{delete, get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    extractors::{
        customer::AuthenticatedCustomer,
        customer_jwt::CustomerSession,
        ops_user::Claims,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(post_login))
        .route("/me", get(get_me))
        .route("/events", post(post_events))
        .route("/usage", get(get_usage))
        .route("/usage/stats", get(get_usage_stats))
        .route("/invoices", get(get_invoices))
        .route("/invoices/:id", get(get_invoice))
        .route("/api-keys", get(list_api_keys).post(create_api_key))
        .route("/api-keys/:id", delete(revoke_api_key))
}

// ── Auth ──────────────────────────────────────────────────────────────────────

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
    struct CustomerRow {
        id: Uuid,
        password_hash: Option<String>,
    }

    let row = sqlx::query_as::<_, CustomerRow>(
        "SELECT id, password_hash FROM customers WHERE email = $1",
    )
    .bind(&body.email)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let hash = row.password_hash.ok_or(AppError::Unauthorized)?;
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
    let claims = Claims {
        sub: row.id.to_string(),
        email: body.email,
        exp,
        role: "customer".to_string(),
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    Ok(Json(LoginResponse { token }))
}

// ── Me ───────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct MeResponse {
    name: String,
    email: String,
}

async fn get_me(
    customer: CustomerSession,
    State(state): State<AppState>,
) -> Result<Json<MeResponse>> {
    #[derive(sqlx::FromRow)]
    struct Row { name: String, email: String }
    let row = sqlx::query_as::<_, Row>(
        "SELECT name, email FROM customers WHERE id = $1",
    )
    .bind(customer.id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(MeResponse { name: row.name, email: row.email }))
}

// ── Events ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct EventsBody {
    events: Vec<IncomingEvent>,
}

#[derive(Deserialize)]
pub struct IncomingEvent {
    request_id: String,
    api_key_id: Uuid,
    endpoint: String,
    units: i64,
    timestamp: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct EventsResponse {
    accepted: usize,
    duplicate: usize,
}

pub async fn post_events(
    customer: AuthenticatedCustomer,
    State(state): State<AppState>,
    Json(body): Json<EventsBody>,
) -> Result<Json<EventsResponse>> {
    if body.events.is_empty() {
        return Ok(Json(EventsResponse { accepted: 0, duplicate: 0 }));
    }

    // Validate all api_key_ids in the batch belong to this customer up front
    let key_ids: Vec<Uuid> = body.events.iter().map(|e| e.api_key_id).collect();
    let valid_key_ids: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM api_keys WHERE id = ANY($1) AND customer_id = $2 AND revoked_at IS NULL",
    )
    .bind(&key_ids)
    .bind(customer.id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();

    let mut tx = state.db.begin().await?;
    let mut accepted = 0usize;
    let mut duplicate = 0usize;

    for event in &body.events {
        if !valid_key_ids.contains(&event.api_key_id) {
            return Err(AppError::BadRequest(format!(
                "api_key_id {} is not valid for this customer",
                event.api_key_id
            )));
        }
        if event.units <= 0 {
            return Err(AppError::BadRequest("units must be > 0".into()));
        }

        let result = sqlx::query(
            "INSERT INTO processed_events (request_id) VALUES ($1) ON CONFLICT DO NOTHING",
        )
        .bind(&event.request_id)
        .execute(&mut *tx)
        .await?;

        if result.rows_affected() == 1 {
            let is_late: bool = sqlx::query_scalar(
                "SELECT EXISTS(
                    SELECT 1 FROM invoices
                    WHERE customer_id = $1
                    AND status IN ('issued', 'paid')
                    AND period_start <= $2 AND period_end > $2
                )",
            )
            .bind(customer.id)
            .bind(event.timestamp)
            .fetch_one(&mut *tx)
            .await?;

            let status = if is_late { "late" } else { "normal" };

            sqlx::query(
                "INSERT INTO usage_events
                    (id, request_id, customer_id, api_key_id, endpoint, units, timestamp, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(Uuid::new_v4())
            .bind(&event.request_id)
            .bind(customer.id)
            .bind(event.api_key_id)
            .bind(&event.endpoint)
            .bind(event.units)
            .bind(event.timestamp)
            .bind(status)
            .execute(&mut *tx)
            .await?;

            accepted += 1;
        } else {
            duplicate += 1;
        }
    }

    tx.commit().await?;
    Ok(Json(EventsResponse { accepted, duplicate }))
}

// ── Usage ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UsageQuery {
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub key_prefix: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct UsageEventRow {
    pub id: Uuid,
    pub request_id: String,
    pub api_key_id: Uuid,
    pub endpoint: String,
    pub units: i64,
    pub timestamp: DateTime<Utc>,
    pub status: String,
}

#[derive(Serialize)]
pub struct PagedResponse<T> {
    pub data: Vec<T>,
    pub next_cursor: Option<String>,
}

fn encode_cursor(ts: DateTime<Utc>, id: Uuid) -> String {
    URL_SAFE_NO_PAD.encode(format!("{},{}", ts.to_rfc3339(), id))
}

fn decode_cursor(s: &str) -> Option<(DateTime<Utc>, Uuid)> {
    let bytes = URL_SAFE_NO_PAD.decode(s).ok()?;
    let decoded = String::from_utf8(bytes).ok()?;
    let (ts_str, id_str) = decoded.split_once(',')?;
    let ts: DateTime<Utc> = ts_str.parse().ok()?;
    let id: Uuid = id_str.parse().ok()?;
    Some((ts, id))
}

pub async fn get_usage(
    customer: CustomerSession,
    State(state): State<AppState>,
    Query(params): Query<UsageQuery>,
) -> Result<Json<PagedResponse<UsageEventRow>>> {
    let limit = params.limit.unwrap_or(50).min(200);

    let rows = if let Some(ref c) = params.cursor {
        let (cursor_ts, cursor_id) =
            decode_cursor(c).ok_or_else(|| AppError::BadRequest("invalid cursor".into()))?;

        sqlx::query_as::<_, UsageEventRow>(
            "SELECT id, request_id, api_key_id, endpoint, units, timestamp, status
             FROM usage_events
             WHERE customer_id = $1
               AND ($2::timestamptz IS NULL OR timestamp >= $2)
               AND ($3::timestamptz IS NULL OR timestamp <= $3)
               AND ($4::text IS NULL OR api_key_id IN (
                     SELECT id FROM api_keys WHERE customer_id = $1 AND prefix ILIKE ($4 || '%')))
               AND (timestamp < $5 OR (timestamp = $5 AND id < $6))
             ORDER BY timestamp DESC, id DESC
             LIMIT $7",
        )
        .bind(customer.id)
        .bind(params.from)
        .bind(params.to)
        .bind(params.key_prefix)
        .bind(cursor_ts)
        .bind(cursor_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, UsageEventRow>(
            "SELECT id, request_id, api_key_id, endpoint, units, timestamp, status
             FROM usage_events
             WHERE customer_id = $1
               AND ($2::timestamptz IS NULL OR timestamp >= $2)
               AND ($3::timestamptz IS NULL OR timestamp <= $3)
               AND ($4::text IS NULL OR api_key_id IN (
                     SELECT id FROM api_keys WHERE customer_id = $1 AND prefix ILIKE ($4 || '%')))
             ORDER BY timestamp DESC, id DESC
             LIMIT $5",
        )
        .bind(customer.id)
        .bind(params.from)
        .bind(params.to)
        .bind(params.key_prefix)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    let next_cursor = if rows.len() == limit as usize {
        rows.last().map(|r| encode_cursor(r.timestamp, r.id))
    } else {
        None
    };

    Ok(Json(PagedResponse { data: rows, next_cursor }))
}

// ── Usage Stats (aggregated) ─────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DailyUsage {
    pub date: String,
    pub units: i64,
    pub events: i64,
    pub late_events: i64,
}

#[derive(Serialize)]
pub struct UsageStats {
    pub total_units: i64,
    pub event_count: i64,
    pub late_count: i64,
    pub endpoints_used: i64,
    pub daily: Vec<DailyUsage>,
}

#[derive(Deserialize)]
pub struct StatsQuery {
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
}

pub async fn get_usage_stats(
    customer: CustomerSession,
    State(state): State<AppState>,
    Query(params): Query<StatsQuery>,
) -> Result<Json<UsageStats>> {
    #[derive(sqlx::FromRow)]
    struct TotalsRow {
        total_units: i64,
        event_count: i64,
        late_count: i64,
        endpoints_used: i64,
    }

    // All stats from usage_events — guarantees total_units == sum(daily.units)
    let totals = sqlx::query_as::<_, TotalsRow>(
        "SELECT
            COALESCE(SUM(units), 0)::bigint AS total_units,
            COUNT(*)::bigint AS event_count,
            COUNT(*) FILTER (WHERE status = 'late')::bigint AS late_count,
            COUNT(DISTINCT endpoint)::bigint AS endpoints_used
         FROM usage_events
         WHERE customer_id = $1
           AND ($2::timestamptz IS NULL OR timestamp >= $2)
           AND ($3::timestamptz IS NULL OR timestamp <= $3)",
    )
    .bind(customer.id)
    .bind(params.from)
    .bind(params.to)
    .fetch_one(&state.db)
    .await?;

    #[derive(sqlx::FromRow)]
    struct DailyRow {
        date: chrono::NaiveDate,
        units: i64,
        events: i64,
        late_events: i64,
    }

    let daily_rows = sqlx::query_as::<_, DailyRow>(
        "SELECT
            DATE(timestamp AT TIME ZONE 'UTC') AS date,
            COALESCE(SUM(units), 0)::bigint AS units,
            COUNT(*)::bigint AS events,
            COUNT(*) FILTER (WHERE status = 'late')::bigint AS late_events
         FROM usage_events
         WHERE customer_id = $1
           AND ($2::timestamptz IS NULL OR timestamp >= $2)
           AND ($3::timestamptz IS NULL OR timestamp <= $3)
         GROUP BY DATE(timestamp AT TIME ZONE 'UTC')
         ORDER BY date",
    )
    .bind(customer.id)
    .bind(params.from)
    .bind(params.to)
    .fetch_all(&state.db)
    .await?;

    let daily = daily_rows
        .into_iter()
        .map(|r| DailyUsage {
            date: r.date.to_string(),
            units: r.units,
            events: r.events,
            late_events: r.late_events,
        })
        .collect();

    Ok(Json(UsageStats {
        total_units: totals.total_units,
        event_count: totals.event_count,
        late_count: totals.late_count,
        endpoints_used: totals.endpoints_used,
        daily,
    }))
}

// ── Invoices ──────────────────────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct InvoiceRow {
    pub id: Uuid,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub status: String,
    pub total_minor: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct LineItemRow {
    pub id: Uuid,
    pub description: String,
    pub units: i64,
    pub unit_price_minor: i64,
    pub total_minor: i64,
    pub overridden_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct InvoiceDetail {
    #[serde(flatten)]
    pub invoice: InvoiceRow,
    pub line_items: Vec<LineItemRow>,
}

pub async fn get_invoices(
    customer: CustomerSession,
    State(state): State<AppState>,
) -> Result<Json<Vec<InvoiceRow>>> {
    let rows = sqlx::query_as::<_, InvoiceRow>(
        "SELECT id, period_start, period_end, status, total_minor, created_at
         FROM invoices
         WHERE customer_id = $1
         ORDER BY period_start DESC",
    )
    .bind(customer.id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

pub async fn get_invoice(
    customer: CustomerSession,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<InvoiceDetail>> {
    // Scoped fetch: customer_id filter prevents cross-tenant reads
    let invoice = sqlx::query_as::<_, InvoiceRow>(
        "SELECT id, period_start, period_end, status, total_minor, created_at
         FROM invoices
         WHERE id = $1 AND customer_id = $2",
    )
    .bind(id)
    .bind(customer.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let line_items = sqlx::query_as::<_, LineItemRow>(
        "SELECT id, description, units, unit_price_minor, total_minor, overridden_at
         FROM invoice_line_items
         WHERE invoice_id = $1
         ORDER BY id",
    )
    .bind(invoice.id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(InvoiceDetail { invoice, line_items }))
}

// ── API keys ──────────────────────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
struct ApiKeyRow {
    id: Uuid,
    name: String,
    prefix: String,
    created_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
}

async fn list_api_keys(
    customer: CustomerSession,
    State(state): State<AppState>,
) -> Result<Json<Vec<ApiKeyRow>>> {
    let rows = sqlx::query_as::<_, ApiKeyRow>(
        "SELECT id, name, prefix, created_at, revoked_at
         FROM api_keys WHERE customer_id = $1
         ORDER BY created_at DESC",
    )
    .bind(customer.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct CreateKeyBody {
    name: String,
}

#[derive(Serialize)]
struct CreatedKey {
    id: Uuid,
    name: String,
    prefix: String,
    secret: String,
    created_at: DateTime<Utc>,
}

async fn create_api_key(
    customer: CustomerSession,
    State(state): State<AppState>,
    Json(body): Json<CreateKeyBody>,
) -> Result<Json<CreatedKey>> {
    use argon2::{
        password_hash::{rand_core::OsRng, SaltString},
        Argon2, PasswordHasher,
    };

    let raw_bytes: [u8; 32] = rand::random();
    let secret = format!("sk_{}", URL_SAFE_NO_PAD.encode(raw_bytes));
    let prefix = secret.chars().take(8).collect::<String>();

    let hash = tokio::task::spawn_blocking({
        let secret = secret.clone();
        move || {
            let salt = SaltString::generate(&mut OsRng);
            Argon2::default()
                .hash_password(secret.as_bytes(), &salt)
                .map(|h| h.to_string())
                .map_err(|e| anyhow::anyhow!("{e}"))
        }
    })
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))??;

    let id = Uuid::new_v4();
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO api_keys (id, customer_id, name, prefix, key_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(customer.id)
    .bind(&body.name)
    .bind(&prefix)
    .bind(&hash)
    .bind(now)
    .execute(&state.db)
    .await?;

    Ok(Json(CreatedKey { id, name: body.name, prefix, secret, created_at: now }))
}

async fn revoke_api_key(
    customer: CustomerSession,
    State(state): State<AppState>,
    Path(key_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let result = sqlx::query(
        "UPDATE api_keys SET revoked_at = now()
         WHERE id = $1 AND customer_id = $2 AND revoked_at IS NULL",
    )
    .bind(key_id)
    .bind(customer.id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "revoked": true })))
}
