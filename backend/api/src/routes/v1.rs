use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    extractors::customer::AuthenticatedCustomer,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/events", post(post_events))
        .route("/usage", get(get_usage))
        .route("/invoices", get(get_invoices))
        .route("/invoices/:id", get(get_invoice))
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
            sqlx::query(
                "INSERT INTO usage_events
                    (id, request_id, customer_id, api_key_id, endpoint, units, timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(Uuid::new_v4())
            .bind(&event.request_id)
            .bind(customer.id)
            .bind(event.api_key_id)
            .bind(&event.endpoint)
            .bind(event.units)
            .bind(event.timestamp)
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
    pub api_key_id: Option<Uuid>,
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
    customer: AuthenticatedCustomer,
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
               AND ($4::uuid IS NULL OR api_key_id = $4)
               AND (timestamp < $5 OR (timestamp = $5 AND id < $6))
             ORDER BY timestamp DESC, id DESC
             LIMIT $7",
        )
        .bind(customer.id)
        .bind(params.from)
        .bind(params.to)
        .bind(params.api_key_id)
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
               AND ($4::uuid IS NULL OR api_key_id = $4)
             ORDER BY timestamp DESC, id DESC
             LIMIT $5",
        )
        .bind(customer.id)
        .bind(params.from)
        .bind(params.to)
        .bind(params.api_key_id)
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
    customer: AuthenticatedCustomer,
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
    customer: AuthenticatedCustomer,
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
