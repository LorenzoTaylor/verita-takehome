mod error;
mod extractors;
mod routes;
mod state;

use sqlx::postgres::PgPoolOptions;
use state::AppState;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let jwt_secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");
    let webhook_secret =
        std::env::var("WEBHOOK_SIGNING_SECRET").expect("WEBHOOK_SIGNING_SECRET must be set");

    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
        .expect("failed to connect to database");

    sqlx::migrate!("../migrations")
        .run(&db)
        .await
        .expect("failed to run migrations");

    let state = AppState { db, jwt_secret, webhook_secret };

    let app = routes::router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    tracing::info!("listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}
