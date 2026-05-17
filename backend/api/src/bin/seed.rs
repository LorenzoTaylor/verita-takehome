use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use rand::Rng;
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

    let mut rng = rand::thread_rng();
    let now = Utc::now();

    // sk_-prefixed key: 32 random bytes base64-encoded
    let raw_bytes: [u8; 32] = rng.gen();
    let key = format!("sk_{}", URL_SAFE_NO_PAD.encode(raw_bytes));
    let prefix = key.chars().take(12).collect::<String>();

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(key.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("hashing failed: {e}"))?
        .to_string();

    let suffix: String = key.chars().skip(3).take(6).collect();
    let email = format!("test-{}@example.com", suffix.to_lowercase());

    let customer_password =
        std::env::var("CUSTOMER_SEED_PASSWORD").unwrap_or_else(|_| "customer-local-password".into());
    let customer_salt = SaltString::generate(&mut OsRng);
    let customer_password_hash = Argon2::default()
        .hash_password(customer_password.as_bytes(), &customer_salt)
        .map_err(|e| anyhow::anyhow!("hashing failed: {e}"))?
        .to_string();

    let customer_id = Uuid::new_v4();
    sqlx::query("INSERT INTO customers (id, name, email, password_hash) VALUES ($1, $2, $3, $4)")
        .bind(customer_id)
        .bind("Test Customer")
        .bind(&email)
        .bind(&customer_password_hash)
        .execute(&pool)
        .await?;

    let key_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO api_keys (id, customer_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(key_id)
    .bind(customer_id)
    .bind("Production")
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
    .bind(now - Duration::days(200))
    .bind(r#"[
        {"up_to": 10000, "unit_price_minor": 0},
        {"up_to": 100000, "unit_price_minor": 1},
        {"up_to": null, "unit_price_minor": 1}
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

    // Events spread across 120 days so date-range pickers show meaningfully different data
    let endpoints = ["/api/v1/query", "/api/v1/embed", "/api/v1/classify"];
    let days = 120i64;
    let mut total_events = 0u64;
    let mut monthly_units: std::collections::HashMap<(i32, u32), i64> = std::collections::HashMap::new();

    for day_offset in 0..days {
        let day_start = now - Duration::days(days - 1 - day_offset);
        if day_start > now { break; }

        // More events in recent weeks so the chart has interesting shape
        let recency = day_offset as f64 / days as f64;
        let base: u32 = (20.0 + recency * 80.0) as u32;
        let count = rng.gen_range(base..(base + 40));

        for _ in 0..count {
            let hour = rng.gen_range(6i64..22);
            let minute = rng.gen_range(0i64..60);
            let ts = day_start + Duration::hours(hour) + Duration::minutes(minute);
            if ts > now { continue; }

            let units: i64 = rng.gen_range(100..=5000);
            let endpoint = endpoints[rng.gen_range(0..3)];
            let request_id = Uuid::new_v4().to_string();

            *monthly_units
                .entry((ts.year(), ts.month()))
                .or_insert(0) += units;

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
            .bind(endpoint)
            .bind(units)
            .bind(ts)
            .execute(&pool)
            .await?;

            total_events += 1;
        }
    }

    // Monthly invoices for completed past months
    let now_ym = (now.year(), now.month());
    let mut month_keys: Vec<(i32, u32)> = monthly_units.keys().cloned().collect();
    month_keys.sort();
    let mut last_invoice_id = Uuid::new_v4();

    for (year, month) in &month_keys {
        let (year, month) = (*year, *month);
        if (year, month) == now_ym { continue; }

        let period_start = NaiveDate::from_ymd_opt(year, month, 1)
            .unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc();
        let (ny, nm) = if month == 12 { (year + 1, 1u32) } else { (year, month + 1) };
        let period_end = NaiveDate::from_ymd_opt(ny, nm, 1)
            .unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc();

        let month_total = monthly_units[&(year, month)];
        let (total_minor, tiers) = apply_tiers(month_total);
        let status = if period_end < now - Duration::days(14) { "paid" } else { "issued" };

        let invoice_id = Uuid::new_v4();
        last_invoice_id = invoice_id;
        sqlx::query(
            "INSERT INTO invoices (id, customer_id, period_start, period_end, status, total_minor)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (customer_id, period_start) DO NOTHING",
        )
        .bind(invoice_id)
        .bind(customer_id)
        .bind(period_start)
        .bind(period_end)
        .bind(status)
        .bind(total_minor)
        .execute(&pool)
        .await?;

        for (desc, units, unit_price, line_total) in &tiers {
            sqlx::query(
                "INSERT INTO invoice_line_items
                    (id, invoice_id, description, units, unit_price_minor, total_minor)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(Uuid::new_v4())
            .bind(invoice_id)
            .bind(desc)
            .bind(units)
            .bind(unit_price)
            .bind(line_total)
            .execute(&pool)
            .await?;
        }
    }

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
    println!("  Customer Email    : {email}");
    println!("  Customer Password : {customer_password}");
    println!("  API Key           : {key}");
    println!("  Total events      : {total_events}");
    println!("  Last invoice ID   : {last_invoice_id}");
    println!("  Ops Email         : {ops_email}");
    println!("  Ops Password      : {ops_password}");

    Ok(())
}

fn apply_tiers(total_units: i64) -> (i64, Vec<(String, i64, i64, i64)>) {
    let tiers = [(10_000i64, 0i64), (100_000, 1), (i64::MAX, 1)];
    let mut remaining = total_units;
    let mut prev = 0i64;
    let mut line_items = Vec::new();
    let mut grand_total = 0i64;

    for (up_to, unit_price) in tiers {
        if remaining <= 0 { break; }
        let capacity = up_to.saturating_sub(prev);
        let in_tier = remaining.min(capacity);
        if in_tier <= 0 { break; }
        let tier_total = in_tier * unit_price;
        let desc = if unit_price == 0 {
            format!("First {} units (free tier)", fmt_units(in_tier))
        } else {
            format!("Next {} units at $0.001", fmt_units(in_tier))
        };
        line_items.push((desc, in_tier, unit_price, tier_total));
        grand_total += tier_total;
        remaining -= in_tier;
        prev = up_to;
    }

    (grand_total, line_items)
}

fn fmt_units(n: i64) -> String {
    let s = n.to_string();
    let chars: Vec<char> = s.chars().collect();
    let mut result = String::new();
    for (i, &c) in chars.iter().enumerate() {
        if i > 0 && (chars.len() - i) % 3 == 0 { result.push(','); }
        result.push(c);
    }
    result
}
