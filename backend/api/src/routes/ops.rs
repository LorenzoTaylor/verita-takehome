use axum::{
    extract::{Path, State},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{Duration, Utc};
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
        .route("/customers", get(get_customers))
        .route("/customers/:id", get(get_customer))
        .route("/customers/:id/credits", post(post_credit))
        .route(
            "/invoices/:invoice_id/line-items/:item_id",
            patch(patch_line_item),
        )
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
) -> Result<Json<Vec<CustomerRow>>> {
    let rows = sqlx::query_as::<_, CustomerRow>(
        "SELECT id, name, email, created_at FROM customers ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
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

    // Return the existing credit for this idempotency key if already issued
    if let Some(row) = sqlx::query_as::<_, CreditRow>(
        "SELECT id, amount_minor, reason, created_at FROM credits WHERE idempotency_key = $1",
    )
    .bind(&body.idempotency_key)
    .fetch_optional(&state.db)
    .await?
    {
        return Ok(Json(row));
    }

    let credit_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO credits (id, customer_id, amount_minor, reason, created_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(credit_id)
    .bind(customer_id)
    .bind(body.amount_minor)
    .bind(&body.reason)
    .bind(ops.id)
    .bind(&body.idempotency_key)
    .execute(&state.db)
    .await?;

    sqlx::query(
        "INSERT INTO audit_log
             (actor_id, actor_email, action, entity_type, entity_id, after_val, reason)
         VALUES ($1, $2, 'credit_issued', 'credit', $3, $4, $5)",
    )
    .bind(ops.id)
    .bind(&ops.email)
    .bind(credit_id)
    .bind(json!({ "amount_minor": body.amount_minor, "customer_id": customer_id }))
    .bind(&body.reason)
    .execute(&state.db)
    .await?;

    let row = sqlx::query_as::<_, CreditRow>(
        "SELECT id, amount_minor, reason, created_at FROM credits WHERE id = $1",
    )
    .bind(credit_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(row))
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
