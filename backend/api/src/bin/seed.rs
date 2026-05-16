use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use rand::{distributions::Alphanumeric, Rng};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // Generate a random 32-char alphanumeric API key; prefix is first 8 chars
    let key: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let prefix = key[..8].to_string();

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(key.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("hashing failed: {e}"))?
        .to_string();

    // Use a unique email so seed is safe to run multiple times
    let email = format!("test-{}@example.com", &key[..6].to_lowercase());

    let customer_id = Uuid::new_v4();
    sqlx::query("INSERT INTO customers (id, name, email) VALUES ($1, $2, $3)")
        .bind(customer_id)
        .bind("Test Customer")
        .bind(&email)
        .execute(&pool)
        .await?;

    let key_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO api_keys (id, customer_id, prefix, key_hash) VALUES ($1, $2, $3, $4)",
    )
    .bind(key_id)
    .bind(customer_id)
    .bind(&prefix)
    .bind(&hash)
    .execute(&pool)
    .await?;

    // Price plan
    let plan_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO price_plans (id, name, effective_from, tiers)
         VALUES ($1, $2, $3, $4::jsonb)",
    )
    .bind(plan_id)
    .bind("Standard")
    .bind(Utc::now() - Duration::days(60))
    .bind(r#"[
        {"up_to": 10000, "unit_price_minor": 0},
        {"up_to": 100000, "unit_price_minor": 1},
        {"up_to": null, "unit_price_minor": 0}
    ]"#)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO customer_price_plans (customer_id, price_plan_id) VALUES ($1, $2)",
    )
    .bind(customer_id)
    .bind(plan_id)
    .execute(&pool)
    .await?;

    // 10 usage events spread across the last 10 hours
    let now = Utc::now();
    for i in 0..10i64 {
        let request_id = Uuid::new_v4().to_string();
        let ts = now - Duration::hours(i);

        sqlx::query(
            "INSERT INTO processed_events (request_id) VALUES ($1) ON CONFLICT DO NOTHING",
        )
        .bind(&request_id)
        .execute(&pool)
        .await?;

        sqlx::query(
            "INSERT INTO usage_events
                (id, request_id, customer_id, api_key_id, endpoint, units, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(Uuid::new_v4())
        .bind(&request_id)
        .bind(customer_id)
        .bind(key_id)
        .bind("/api/v1/query")
        .bind(1000i64 * (i + 1))
        .bind(ts)
        .execute(&pool)
        .await?;
    }

    // One issued invoice with two line items
    let invoice_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO invoices (id, customer_id, period_start, period_end, status, total_minor)
         VALUES ($1, $2, $3, $4, 'issued', 4500)",
    )
    .bind(invoice_id)
    .bind(customer_id)
    .bind(now - Duration::days(30))
    .bind(now - Duration::days(1))
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO invoice_line_items
            (id, invoice_id, description, units, unit_price_minor, total_minor)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(invoice_id)
    .bind("First 10,000 units (free tier)")
    .bind(10000i64)
    .bind(0i64)
    .bind(0i64)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO invoice_line_items
            (id, invoice_id, description, units, unit_price_minor, total_minor)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(invoice_id)
    .bind("Next 4,500 units at $0.001")
    .bind(4500i64)
    .bind(1i64)
    .bind(4500i64)
    .execute(&pool)
    .await?;

    // Ops user
    let ops_email = std::env::var("OPS_SEED_EMAIL").unwrap_or_else(|_| "ops@example.com".into());
    let ops_password =
        std::env::var("OPS_SEED_PASSWORD").unwrap_or_else(|_| "ops-local-password".into());
    let ops_salt = SaltString::generate(&mut OsRng);
    let ops_hash = Argon2::default()
        .hash_password(ops_password.as_bytes(), &ops_salt)
        .map_err(|e| anyhow::anyhow!("hashing failed: {e}"))?
        .to_string();
    let ops_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO ops_users (id, email, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING",
    )
    .bind(ops_id)
    .bind(&ops_email)
    .bind(&ops_hash)
    .execute(&pool)
    .await?;

    println!("Seeded successfully.");
    println!("  Customer ID : {customer_id}");
    println!("  API Key ID  : {key_id}");
    println!("  API Key     : {key}");
    println!("  Invoice ID  : {invoice_id}");
    println!("  Ops Email   : {ops_email}");
    println!("  Ops Password: {ops_password}");
    println!();
    println!("Curl examples:");
    println!("  # Ingest events");
    println!(r#"  curl -s -X POST http://localhost:8080/v1/events \
    -H 'Authorization: Bearer {key}' \
    -H 'Content-Type: application/json' \
    -d '{{"events":[{{"request_id":"test-001","api_key_id":"{key_id}","endpoint":"/api/query","units":500,"timestamp":"2025-01-01T12:00:00Z"}}]}}'"#);
    println!();
    println!("  # List usage");
    println!("  curl -s http://localhost:8080/v1/usage -H 'Authorization: Bearer {key}' | jq .");
    println!();
    println!("  # List invoices");
    println!("  curl -s http://localhost:8080/v1/invoices -H 'Authorization: Bearer {key}' | jq .");
    println!();
    println!("  # Invoice detail");
    println!("  curl -s http://localhost:8080/v1/invoices/{invoice_id} -H 'Authorization: Bearer {key}' | jq .");

    Ok(())
}
