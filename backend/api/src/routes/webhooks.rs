use axum::{http::StatusCode, routing::post, Router};

use crate::{error::Result, extractors::webhook::VerifiedWebhookPayload, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new().route("/payments", post(post_payment))
}

pub async fn post_payment(VerifiedWebhookPayload(_body): VerifiedWebhookPayload) -> Result<StatusCode> {
    Ok(StatusCode::NOT_IMPLEMENTED)
}
