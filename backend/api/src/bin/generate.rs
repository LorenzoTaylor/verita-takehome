use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use chrono::{DateTime, Duration, Utc};
use rand::{distributions::Alphanumeric, Rng};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use uuid::Uuid;

const BATCH_SIZE: usize = 500;
const CUSTOMERS: usize = 10;
const DAYS: i64 = 90;
const NORMAL_RATE: usize = 200; // events/hour on normal days
const SPIKE_RATE: usize = 2000; // events/hour on spike day
const ENDPOINTS: &[&str] = &["/api/v1/query", "/api/v1/embed", "/api/v1/classify"];

struct CustomerSummary {
    email: String,
    api_key: String,
    events: u64,
}

async fn flush_events(
    pool: &PgPool,
    ids: &[Uuid],
    request_ids: &[String],
    customer_ids: &[Uuid],
    key_ids: &[Uuid],
    endpoints: &[String],
    units: &[i64],
    timestamps: &[DateTime<Utc>],
    statuses: &[String],
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO processed_events (request_id) \
         SELECT x FROM unnest($1::text[]) AS t(x) ON CONFLICT DO NOTHING",
    )
    .bind(request_ids.to_vec())
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO usage_events \
            (id, request_id, customer_id, api_key_id, endpoint, units, timestamp, status) \
         SELECT * FROM unnest(\
            $1::uuid[], $2::text[], $3::uuid[], $4::uuid[], \
            $5::text[], $6::bigint[], $7::timestamptz[], $8::text[]) \
         AS t(id, request_id, customer_id, api_key_id, endpoint, units, ts, status)",
    )
    .bind(ids.to_vec())
    .bind(request_ids.to_vec())
    .bind(customer_ids.to_vec())
    .bind(key_ids.to_vec())
    .bind(endpoints.to_vec())
    .bind(units.to_vec())
    .bind(timestamps.to_vec())
    .bind(statuses.to_vec())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

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
    let window_start = now - Duration::days(DAYS);

    // Single shared price plan for all generated customers
    let plan_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO price_plans (id, name, effective_from, tiers) \
         VALUES ($1, $2, $3, $4::jsonb)",
    )
    .bind(plan_id)
    .bind("Standard")
    .bind(window_start - Duration::days(30))
    .bind(r#"[{"up_to": 10000, "unit_price_minor": 0}, {"up_to": null, "unit_price_minor": 1}]"#)
    .execute(&pool)
    .await?;

    let mut summaries: Vec<CustomerSummary> = Vec::with_capacity(CUSTOMERS);

    for i in 0..CUSTOMERS {
        println!("Generating customer {}/{}...", i + 1, CUSTOMERS);

        let customer_id = Uuid::new_v4();
        let email = format!("gen-{}@example.com", i + 1);

        sqlx::query("INSERT INTO customers (id, name, email) VALUES ($1, $2, $3)")
            .bind(customer_id)
            .bind(format!("Generated Customer {}", i + 1))
            .bind(&email)
            .execute(&pool)
            .await?;

        let key: String = (0..32).map(|_| rng.sample(Alphanumeric) as char).collect();
        let prefix = key[..8].to_string();

        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(key.as_bytes(), &salt)
            .map_err(|e| anyhow::anyhow!("{e}"))?
            .to_string();

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

        sqlx::query(
            "INSERT INTO customer_price_plans (customer_id, price_plan_id) VALUES ($1, $2)",
        )
        .bind(customer_id)
        .bind(plan_id)
        .execute(&pool)
        .await?;

        let spike_day = rng.gen_range(0..DAYS);

        let mut b_ids: Vec<Uuid> = Vec::with_capacity(BATCH_SIZE);
        let mut b_req: Vec<String> = Vec::with_capacity(BATCH_SIZE);
        let mut b_cust: Vec<Uuid> = Vec::with_capacity(BATCH_SIZE);
        let mut b_keys: Vec<Uuid> = Vec::with_capacity(BATCH_SIZE);
        let mut b_ep: Vec<String> = Vec::with_capacity(BATCH_SIZE);
        let mut b_units: Vec<i64> = Vec::with_capacity(BATCH_SIZE);
        let mut b_ts: Vec<DateTime<Utc>> = Vec::with_capacity(BATCH_SIZE);
        let mut b_status: Vec<String> = Vec::with_capacity(BATCH_SIZE);

        // Collect ~5% of request_ids to re-submit as duplicates after the main pass
        let mut dup_candidates: Vec<String> = Vec::new();
        let mut total: u64 = 0;

        for day in 0..DAYS {
            let base_rate = if day == spike_day {
                SPIKE_RATE
            } else {
                NORMAL_RATE
            };

            for hour in 0..24i64 {
                // Vary ±20% around the base rate for realistic distribution
                let count = rng.gen_range((base_rate * 4 / 5)..=(base_rate * 6 / 5));

                for _ in 0..count {
                    let minute = rng.gen_range(0..60i64);
                    let second = rng.gen_range(0..60i64);
                    let ts = window_start
                        + Duration::days(day)
                        + Duration::hours(hour)
                        + Duration::minutes(minute)
                        + Duration::seconds(second);

                    // 2% of events are late-arriving (timestamp >48h before insertion time)
                    let (event_ts, status) = if rng.gen_bool(0.02) {
                        let lag = rng.gen_range(48..240i64);
                        (now - Duration::hours(lag), "late")
                    } else {
                        (ts, "normal")
                    };

                    let request_id = Uuid::new_v4().to_string();

                    if rng.gen_bool(0.05) {
                        dup_candidates.push(request_id.clone());
                    }

                    b_ids.push(Uuid::new_v4());
                    b_req.push(request_id);
                    b_cust.push(customer_id);
                    b_keys.push(key_id);
                    b_ep.push(ENDPOINTS[rng.gen_range(0..ENDPOINTS.len())].to_string());
                    b_units.push(rng.gen_range(100..=5000i64));
                    b_ts.push(event_ts);
                    b_status.push(status.to_string());
                    total += 1;

                    if b_ids.len() >= BATCH_SIZE {
                        flush_events(
                            &pool, &b_ids, &b_req, &b_cust, &b_keys, &b_ep, &b_units, &b_ts,
                            &b_status,
                        )
                        .await?;
                        b_ids.clear();
                        b_req.clear();
                        b_cust.clear();
                        b_keys.clear();
                        b_ep.clear();
                        b_units.clear();
                        b_ts.clear();
                        b_status.clear();
                    }
                }
            }
        }

        if !b_ids.is_empty() {
            flush_events(
                &pool, &b_ids, &b_req, &b_cust, &b_keys, &b_ep, &b_units, &b_ts, &b_status,
            )
            .await?;
        }

        // Re-submit duplicate request_ids in batches; processed_events deduplicates them
        for chunk in dup_candidates.chunks(BATCH_SIZE) {
            sqlx::query(
                "INSERT INTO processed_events (request_id) \
                 SELECT x FROM unnest($1::text[]) AS t(x) ON CONFLICT DO NOTHING",
            )
            .bind(chunk.to_vec())
            .execute(&pool)
            .await?;
        }

        println!(
            "  -> {} events, {} dup re-submissions skipped",
            total,
            dup_candidates.len()
        );

        summaries.push(CustomerSummary {
            email,
            api_key: key,
            events: total,
        });
    }

    println!("\n{:-<84}", "");
    println!("{:<35} {:<35} {:>12}", "Email", "API Key", "Events");
    println!("{:-<84}", "");
    for s in &summaries {
        println!("{:<35} {:<35} {:>12}", s.email, s.api_key, s.events);
    }
    println!("{:-<84}", "");

    Ok(())
}
