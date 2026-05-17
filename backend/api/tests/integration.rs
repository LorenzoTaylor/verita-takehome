use api::{extractors::ops_user::Claims, routes, state::AppState};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2, Params,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use jsonwebtoken::{encode, EncodingKey, Header};
use rand::{distributions::Alphanumeric, Rng};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

const TEST_JWT_SECRET: &str = "test-secret";
const TEST_WEBHOOK_SECRET: &str = "test-webhook-secret";

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn test_db() -> PgPool {
    dotenvy::dotenv().ok();
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/billing".into());
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .expect("failed to connect to test database");
    sqlx::migrate!("../migrations")
        .run(&pool)
        .await
        .expect("failed to run migrations");
    pool
}

fn test_app(db: PgPool) -> axum::Router {
    routes::router(AppState {
        db,
        jwt_secret: TEST_JWT_SECRET.to_string(),
        webhook_secret: TEST_WEBHOOK_SECRET.to_string(),
    })
}

fn fast_argon2() -> Argon2<'static> {
    Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        Params::new(32, 1, 1, None).unwrap(),
    )
}

// Returns (customer_id, email, raw_api_key, jwt_token)
async fn seed_customer(db: &PgPool) -> (Uuid, String, String, String) {
    let id = Uuid::new_v4();
    let email = format!("test-{}@example.com", id.as_simple());

    let argon2 = fast_argon2();
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = argon2.hash_password(b"password", &salt).unwrap().to_string();

    sqlx::query(
        "INSERT INTO customers (id, name, email, password_hash) VALUES ($1, $2, $3, $4)",
    )
    .bind(id)
    .bind("Test Customer")
    .bind(&email)
    .bind(&password_hash)
    .execute(db)
    .await
    .unwrap();

    let raw_key: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let prefix = raw_key[..8].to_string();
    let salt = SaltString::generate(&mut OsRng);
    let key_hash = argon2.hash_password(raw_key.as_bytes(), &salt).unwrap().to_string();

    sqlx::query(
        "INSERT INTO api_keys (id, customer_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(Uuid::new_v4())
    .bind(id)
    .bind("Test Key")
    .bind(&prefix)
    .bind(&key_hash)
    .execute(db)
    .await
    .unwrap();

    let exp = (Utc::now() + Duration::hours(24)).timestamp() as usize;
    let claims = Claims { sub: id.to_string(), email: email.clone(), exp, role: "customer".to_string() };
    let token = encode(&Header::default(), &claims, &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes())).unwrap();

    (id, email, raw_key, token)
}

// Returns (ops_id, email, jwt_token)
async fn seed_ops_user(db: &PgPool) -> (Uuid, String, String) {
    let id = Uuid::new_v4();
    let email = format!("ops-{}@example.com", id.as_simple());

    let argon2 = fast_argon2();
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = argon2.hash_password(b"ops-password", &salt).unwrap().to_string();

    sqlx::query("INSERT INTO ops_users (id, email, password_hash) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(&email)
        .bind(&password_hash)
        .execute(db)
        .await
        .unwrap();

    let exp = (Utc::now() + Duration::hours(24)).timestamp() as usize;
    let claims = Claims { sub: id.to_string(), email: email.clone(), exp, role: "ops".to_string() };
    let token = encode(&Header::default(), &claims, &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes())).unwrap();

    (id, email, token)
}

fn webhook_sig(body: &[u8], secret: &str) -> String {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

async fn call(app: axum::Router, req: Request<Body>) -> (StatusCode, Value) {
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

fn json_req(method: &str, uri: &str, auth: Option<&str>, body: Value) -> Request<Body> {
    let bytes = serde_json::to_vec(&body).unwrap();
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("Content-Type", "application/json");
    if let Some(token) = auth {
        builder = builder.header("Authorization", format!("Bearer {token}"));
    }
    builder.body(Body::from(bytes)).unwrap()
}

fn get_req(uri: &str, token: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_customer_login() {
    let db = test_db().await;
    let app = test_app(db.clone());
    let (_, email, _, _) = seed_customer(&db).await;

    let (status, body) = call(
        app.clone(),
        json_req("POST", "/v1/auth/login", None, json!({"email": &email, "password": "password"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["token"].is_string());

    let (status, _) = call(
        app,
        json_req("POST", "/v1/auth/login", None, json!({"email": &email, "password": "wrong"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_ops_login_and_role_isolation() {
    let db = test_db().await;
    let app = test_app(db.clone());
    let (_, ops_email, ops_token) = seed_ops_user(&db).await;
    let (_, _, _, customer_token) = seed_customer(&db).await;

    let (status, body) = call(
        app.clone(),
        json_req(
            "POST",
            "/ops/auth/login",
            None,
            json!({"email": &ops_email, "password": "ops-password"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["token"].is_string());

    // Ops JWT on customer route → 401
    let (status, _) = call(app.clone(), get_req("/v1/usage", &ops_token)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Customer JWT on ops route → 401
    let (status, _) = call(app, get_req("/ops/customers", &customer_token)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_event_idempotency() {
    let db = test_db().await;
    let app = test_app(db.clone());
    let (customer_id, _, raw_key, _) = seed_customer(&db).await;

    let api_key_id: Uuid =
        sqlx::query_scalar("SELECT id FROM api_keys WHERE customer_id = $1")
            .bind(customer_id)
            .fetch_one(&db)
            .await
            .unwrap();

    let request_id = format!("req-{}", Uuid::new_v4());
    let body = json!({
        "events": [{
            "request_id": &request_id,
            "api_key_id": api_key_id,
            "endpoint": "/api/v1/query",
            "units": 100,
            "timestamp": "2025-01-15T12:00:00Z"
        }]
    });

    let (status, resp) = call(
        app.clone(),
        json_req("POST", "/v1/events", Some(&raw_key), body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(resp["accepted"], 1);
    assert_eq!(resp["duplicate"], 0);

    let (status, resp) = call(app, json_req("POST", "/v1/events", Some(&raw_key), body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(resp["accepted"], 0);
    assert_eq!(resp["duplicate"], 1);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM usage_events WHERE request_id = $1")
            .bind(&request_id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_tenant_isolation() {
    let db = test_db().await;
    let app = test_app(db.clone());
    let (customer_a_id, _, raw_key_a, _) = seed_customer(&db).await;
    let (_, _, _, token_b) = seed_customer(&db).await;

    let api_key_id: Uuid =
        sqlx::query_scalar("SELECT id FROM api_keys WHERE customer_id = $1")
            .bind(customer_a_id)
            .fetch_one(&db)
            .await
            .unwrap();

    let request_id = format!("req-{}", Uuid::new_v4());
    call(
        app.clone(),
        json_req(
            "POST",
            "/v1/events",
            Some(&raw_key_a),
            json!({
                "events": [{
                    "request_id": &request_id,
                    "api_key_id": api_key_id,
                    "endpoint": "/api/v1/query",
                    "units": 100,
                    "timestamp": "2025-01-15T12:00:00Z"
                }]
            }),
        ),
    )
    .await;

    let (status, resp) = call(app, get_req("/v1/usage", &token_b)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(resp["data"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_credit_idempotency() {
    let db = test_db().await;
    let app = test_app(db.clone());
    let (customer_id, _, _, _) = seed_customer(&db).await;
    let (_, _, ops_token) = seed_ops_user(&db).await;

    let idem_key = format!("idem-{}", Uuid::new_v4());
    let body = json!({
        "amount_minor": 5000,
        "reason": "test credit",
        "idempotency_key": &idem_key
    });

    let (status, resp1) = call(
        app.clone(),
        json_req(
            "POST",
            &format!("/ops/customers/{customer_id}/credits"),
            Some(&ops_token),
            body.clone(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let credit_id = resp1["id"].as_str().unwrap().to_string();

    let (status, resp2) = call(
        app,
        json_req(
            "POST",
            &format!("/ops/customers/{customer_id}/credits"),
            Some(&ops_token),
            body,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(resp2["id"].as_str().unwrap(), credit_id);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM credits WHERE idempotency_key = $1")
            .bind(&idem_key)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_audit_log_immutability() {
    let db = test_db().await;
    let actor_id = Uuid::new_v4();
    let entity_id = Uuid::new_v4();

    let log_id: Uuid = sqlx::query_scalar(
        "INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id",
    )
    .bind(actor_id)
    .bind("immutable-test@example.com")
    .bind("test_action")
    .bind("test_entity")
    .bind(entity_id)
    .bind("test reason")
    .fetch_one(&db)
    .await
    .unwrap();

    let update = sqlx::query("UPDATE audit_log SET reason = 'hacked' WHERE id = $1")
        .bind(log_id)
        .execute(&db)
        .await;
    assert!(update.is_err(), "UPDATE on audit_log should be rejected by trigger");

    let delete = sqlx::query("DELETE FROM audit_log WHERE id = $1")
        .bind(log_id)
        .execute(&db)
        .await;
    assert!(delete.is_err(), "DELETE on audit_log should be rejected by trigger");
}

#[tokio::test]
async fn test_webhook_replay() {
    let db = test_db().await;
    let app = test_app(db.clone());

    let delivery_id = format!("dlv-{}", Uuid::new_v4());
    let invoice_id = Uuid::new_v4();
    let payload = serde_json::to_vec(&json!({
        "delivery_id": &delivery_id,
        "invoice_id": invoice_id
    }))
    .unwrap();
    let sig = webhook_sig(&payload, TEST_WEBHOOK_SECRET);

    let build_webhook_req = |body: Vec<u8>| {
        Request::builder()
            .method("POST")
            .uri("/webhooks/payments")
            .header("Content-Type", "application/json")
            .header("X-Webhook-Signature", &sig)
            .body(Body::from(body))
            .unwrap()
    };

    let (status, _) = call(app.clone(), build_webhook_req(payload.clone())).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = call(app, build_webhook_req(payload)).await;
    assert_eq!(status, StatusCode::OK);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM webhook_deliveries WHERE delivery_id = $1")
            .bind(&delivery_id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_line_item_override() {
    let db = test_db().await;
    let app = test_app(db.clone());
    let (customer_id, _, _, _) = seed_customer(&db).await;
    let (_, _, ops_token) = seed_ops_user(&db).await;

    let now = Utc::now();
    let invoice_id = Uuid::new_v4();
    let item_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO invoices (id, customer_id, period_start, period_end, status, total_minor)
         VALUES ($1, $2, $3, $4, 'issued', 10000)",
    )
    .bind(invoice_id)
    .bind(customer_id)
    .bind(now - Duration::days(30))
    .bind(now - Duration::days(1))
    .execute(&db)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO invoice_line_items (id, invoice_id, description, units, unit_price_minor, total_minor)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(item_id)
    .bind(invoice_id)
    .bind("Original line item")
    .bind(10000i64)
    .bind(1i64)
    .bind(10000i64)
    .execute(&db)
    .await
    .unwrap();

    let (status, resp) = call(
        app,
        json_req(
            "PATCH",
            &format!("/ops/invoices/{invoice_id}/line-items/{item_id}"),
            Some(&ops_token),
            json!({"total_minor": 5000, "reason": "courtesy discount"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(resp["total_minor"], 5000);
    assert!(resp["overridden_at"].is_string());

    let total: i64 = sqlx::query_scalar("SELECT total_minor FROM invoices WHERE id = $1")
        .bind(invoice_id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(total, 5000);

    let log_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE entity_id = $1 AND action = 'line_item_overridden'",
    )
    .bind(item_id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(log_count, 1);
}
