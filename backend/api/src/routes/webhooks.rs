use axum::{http::StatusCode, routing::post, Router};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    extractors::webhook::VerifiedWebhookPayload,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/payments", post(post_payment))
}

#[derive(Deserialize)]
struct PaymentWebhook {
    delivery_id: String,
    invoice_id: Uuid,
}

async fn post_payment(
    axum::extract::State(state): axum::extract::State<AppState>,
    VerifiedWebhookPayload(body): VerifiedWebhookPayload,
) -> Result<StatusCode> {
    let payload: PaymentWebhook =
        serde_json::from_slice(&body).map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Dedup: insert delivery ID — if already present, skip all work
    let result = sqlx::query(
        "INSERT INTO webhook_deliveries (delivery_id) VALUES ($1) ON CONFLICT DO NOTHING",
    )
    .bind(&payload.delivery_id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Ok(StatusCode::OK); // replayed delivery, already processed
    }

    // Transition invoice issued → paid; AND guard prevents double-payment
    sqlx::query(
        "UPDATE invoices SET status = 'paid' WHERE id = $1 AND status = 'issued'",
    )
    .bind(payload.invoice_id)
    .execute(&state.db)
    .await?;

    // Mark delivery fully processed
    sqlx::query(
        "UPDATE webhook_deliveries SET processed_at = now() WHERE delivery_id = $1",
    )
    .bind(&payload.delivery_id)
    .execute(&state.db)
    .await?;

    Ok(StatusCode::OK)
}
