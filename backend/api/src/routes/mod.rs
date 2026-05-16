mod ops;
mod v1;
mod webhooks;

use axum::Router;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/v1", v1::router())
        .nest("/ops", ops::router())
        .nest("/webhooks", webhooks::router())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
