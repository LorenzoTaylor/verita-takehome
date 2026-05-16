use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use uuid::Uuid;

use crate::{error::Result, extractors::ops_user::OpsUser, state::AppState};

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

pub async fn post_login(
    State(_state): State<AppState>,
    Json(_body): Json<serde_json::Value>,
) -> Result<StatusCode> {
    Ok(StatusCode::NOT_IMPLEMENTED)
}

pub async fn get_customers(
    _ops: OpsUser,
    State(_state): State<AppState>,
) -> Result<StatusCode> {
    Ok(StatusCode::NOT_IMPLEMENTED)
}

pub async fn get_customer(
    _ops: OpsUser,
    State(_state): State<AppState>,
    Path(_id): Path<Uuid>,
) -> Result<StatusCode> {
    Ok(StatusCode::NOT_IMPLEMENTED)
}

pub async fn post_credit(
    ops: OpsUser,
    State(_state): State<AppState>,
    Path(_customer_id): Path<Uuid>,
    Json(_body): Json<serde_json::Value>,
) -> Result<StatusCode> {
    let _ = ops.id;
    Ok(StatusCode::NOT_IMPLEMENTED)
}

pub async fn patch_line_item(
    ops: OpsUser,
    State(_state): State<AppState>,
    Path((_invoice_id, _item_id)): Path<(Uuid, Uuid)>,
    Json(_body): Json<serde_json::Value>,
) -> Result<StatusCode> {
    let _ = ops.id;
    Ok(StatusCode::NOT_IMPLEMENTED)
}
