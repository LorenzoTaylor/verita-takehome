use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{error::Result, extractors::customer::AuthenticatedCustomer, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/events", post(post_events))
        .route("/usage", get(get_usage))
        .route("/invoices", get(get_invoices))
        .route("/invoices/:id", get(get_invoice))
}

#[derive(Deserialize)]
pub struct UsageQuery {
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    pub from: Option<chrono::DateTime<chrono::Utc>>,
    pub to: Option<chrono::DateTime<chrono::Utc>>,
    pub api_key_id: Option<Uuid>,
}

pub async fn post_events(
    customer: AuthenticatedCustomer,
    State(_state): State<AppState>,
    Json(_body): Json<serde_json::Value>,
) -> Result<StatusCode> {
    let _ = customer.id;
    Ok(StatusCode::NOT_IMPLEMENTED)
}

pub async fn get_usage(
    customer: AuthenticatedCustomer,
    State(_state): State<AppState>,
    Query(_params): Query<UsageQuery>,
) -> Result<StatusCode> {
    let _ = customer.id;
    Ok(StatusCode::NOT_IMPLEMENTED)
}

pub async fn get_invoices(
    customer: AuthenticatedCustomer,
    State(_state): State<AppState>,
) -> Result<StatusCode> {
    let _ = customer.id;
    Ok(StatusCode::NOT_IMPLEMENTED)
}

pub async fn get_invoice(
    customer: AuthenticatedCustomer,
    State(_state): State<AppState>,
    Path(_id): Path<Uuid>,
) -> Result<StatusCode> {
    let _ = customer.id;
    Ok(StatusCode::NOT_IMPLEMENTED)
}
