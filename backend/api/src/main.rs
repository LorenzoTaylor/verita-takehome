use axum::Router;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let app = Router::new();

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    tracing::info!("listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}
