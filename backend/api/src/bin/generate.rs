use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use chrono::{Datelike, DateTime, Duration, NaiveDate, Timelike, Utc, Weekday};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const BATCH_SIZE: usize = 500;
const DAYS: i64 = 365;
const ENDPOINTS: &[&str] = &["/api/v1/query", "/api/v1/embed", "/api/v1/classify"];
const KEY_NAMES: &[&str] = &["Production", "Staging", "Development", "Testing"];

#[derive(Debug, Clone, Copy, PartialEq)]
enum Profile {
    Whale,
    Medium,
    Small,
    Churned,
    New,
    Occasional,
}

impl Profile {
    fn label(self) -> &'static str {
        match self {
            Profile::Whale => "whale",
            Profile::Medium => "medium",
            Profile::Small => "small",
            Profile::Churned => "churned",
            Profile::New => "new",
            Profile::Occasional => "occasional",
        }
    }
}

struct ProfileConfig {
    base_events_per_hour: f64,
    spike_multiplier: f64,
    spike_prob: f64,
    key_count_min: usize,
    key_count_max: usize,
    plan_name: &'static str,
}

fn profile_config(profile: Profile) -> ProfileConfig {
    match profile {
        Profile::Whale => ProfileConfig {
            base_events_per_hour: 50.0,
            spike_multiplier: 10.0,
            spike_prob: 0.05,
            key_count_min: 2,
            key_count_max: 4,
            plan_name: "Enterprise",
        },
        Profile::Medium => ProfileConfig {
            base_events_per_hour: 10.0,
            spike_multiplier: 5.0,
            spike_prob: 0.03,
            key_count_min: 1,
            key_count_max: 2,
            plan_name: "Pro",
        },
        Profile::Small => ProfileConfig {
            base_events_per_hour: 1.0,
            spike_multiplier: 8.0,
            spike_prob: 0.02,
            key_count_min: 1,
            key_count_max: 1,
            plan_name: "Starter",
        },
        Profile::Churned => ProfileConfig {
            base_events_per_hour: 10.0,
            spike_multiplier: 5.0,
            spike_prob: 0.03,
            key_count_min: 1,
            key_count_max: 2,
            plan_name: "Standard",
        },
        Profile::New => ProfileConfig {
            base_events_per_hour: 5.0,
            spike_multiplier: 5.0,
            spike_prob: 0.02,
            key_count_min: 1,
            key_count_max: 1,
            plan_name: "Starter",
        },
        Profile::Occasional => ProfileConfig {
            base_events_per_hour: 0.0, // overridden per-month below
            spike_multiplier: 3.0,
            spike_prob: 0.02,
            key_count_min: 1,
            key_count_max: 2,
            plan_name: "Standard",
        },
    }
}

struct Tier {
    up_to: Option<i64>,
    unit_price_minor: i64,
}

struct LineItemData {
    description: String,
    units: i64,
    unit_price_minor: i64,
    total_minor: i64,
}

fn apply_tiers(total_units: i64, tiers: &[Tier]) -> (i64, Vec<LineItemData>) {
    let mut remaining = total_units;
    let mut prev_boundary = 0i64;
    let mut line_items = Vec::new();
    let mut grand_total = 0i64;

    for tier in tiers {
        if remaining <= 0 {
            break;
        }
        let tier_limit = tier.up_to.unwrap_or(i64::MAX);
        let tier_capacity = tier_limit.saturating_sub(prev_boundary);
        let units_in_tier = remaining.min(tier_capacity);
        if units_in_tier <= 0 {
            break;
        }
        let tier_total = units_in_tier * tier.unit_price_minor;
        let description = if tier.unit_price_minor == 0 {
            format!("First {} units (free tier)", fmt_units(units_in_tier))
        } else {
            format!(
                "Next {} units at ${:.4}",
                fmt_units(units_in_tier),
                tier.unit_price_minor as f64 / 1000.0
            )
        };
        line_items.push(LineItemData {
            description,
            units: units_in_tier,
            unit_price_minor: tier.unit_price_minor,
            total_minor: tier_total,
        });
        grand_total += tier_total;
        remaining -= units_in_tier;
        prev_boundary = tier_limit;
    }

    (grand_total, line_items)
}

fn fmt_units(n: i64) -> String {
    let s = n.to_string();
    let chars: Vec<char> = s.chars().collect();
    let mut result = String::new();
    for (i, &c) in chars.iter().enumerate() {
        if i > 0 && (chars.len() - i) % 3 == 0 {
            result.push(',');
        }
        result.push(c);
    }
    result
}

fn hour_multiplier(hour: u32) -> f64 {
    match hour {
        9..=17 => 2.0,
        6..=8 => 1.0,
        18..=21 => 1.2,
        _ => 0.3,
    }
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

struct CustomerSummary {
    email: String,
    profile: &'static str,
    events: u64,
    invoices: u32,
    total_billed_minor: i64,
}

fn build_customer_list() -> Vec<(Profile, usize)> {
    let mut list = Vec::new();
    for i in 0..5  { list.push((Profile::Whale,      i)); }
    for i in 0..15 { list.push((Profile::Medium,     i)); }
    for i in 0..20 { list.push((Profile::Small,      i)); }
    for i in 0..5  { list.push((Profile::Churned,    i)); }
    for i in 0..3  { list.push((Profile::New,        i)); }
    for i in 0..2  { list.push((Profile::Occasional, i)); }
    list
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().to_string() + chars.as_str(),
    }
}

fn month_period(year: i32, month: u32) -> (DateTime<Utc>, DateTime<Utc>) {
    let start = NaiveDate::from_ymd_opt(year, month, 1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    let (ny, nm) = if month == 12 { (year + 1, 1u32) } else { (year, month + 1) };
    let end = NaiveDate::from_ymd_opt(ny, nm, 1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    (start, end)
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

    // ── Price plans ──────────────────────────────────────────────────────────
    let plan_defs: &[(&str, &str)] = &[
        (
            "Starter",
            r#"[{"up_to":5000,"unit_price_minor":0},{"up_to":null,"unit_price_minor":1}]"#,
        ),
        (
            "Standard",
            r#"[{"up_to":50000,"unit_price_minor":0},{"up_to":null,"unit_price_minor":1}]"#,
        ),
        (
            "Pro",
            r#"[{"up_to":200000,"unit_price_minor":0},{"up_to":null,"unit_price_minor":1}]"#,
        ),
        (
            "Enterprise",
            r#"[{"up_to":1000000,"unit_price_minor":0},{"up_to":null,"unit_price_minor":1}]"#,
        ),
    ];

    let mut plan_ids: HashMap<&str, Uuid> = HashMap::new();
    for &(name, tiers_json) in plan_defs {
        let plan_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO price_plans (id, name, effective_from, tiers) VALUES ($1, $2, $3, $4::jsonb)",
        )
        .bind(plan_id)
        .bind(name)
        .bind(window_start - Duration::days(30))
        .bind(tiers_json)
        .execute(&pool)
        .await?;
        plan_ids.insert(name, plan_id);
    }

    let tier_defs: HashMap<&str, Vec<Tier>> = {
        let mut m: HashMap<&str, Vec<Tier>> = HashMap::new();
        m.insert(
            "Starter",
            vec![
                Tier { up_to: Some(5_000),     unit_price_minor: 0 },
                Tier { up_to: None,             unit_price_minor: 1 },
            ],
        );
        m.insert(
            "Standard",
            vec![
                Tier { up_to: Some(50_000),    unit_price_minor: 0 },
                Tier { up_to: None,             unit_price_minor: 1 },
            ],
        );
        m.insert(
            "Pro",
            vec![
                Tier { up_to: Some(200_000),   unit_price_minor: 0 },
                Tier { up_to: None,             unit_price_minor: 1 },
            ],
        );
        m.insert(
            "Enterprise",
            vec![
                Tier { up_to: Some(1_000_000), unit_price_minor: 0 },
                Tier { up_to: None,             unit_price_minor: 1 },
            ],
        );
        m
    };

    let customer_list = build_customer_list();
    let total = customer_list.len();
    let mut summaries: Vec<CustomerSummary> = Vec::with_capacity(total);

    for (idx, (profile, local_idx)) in customer_list.iter().enumerate() {
        let profile = *profile;
        let cfg = profile_config(profile);

        println!(
            "Generating customer {}/{} ({})...",
            idx + 1,
            total,
            profile.label()
        );

        // ── Join / churn dates ───────────────────────────────────────────────
        let join_date: DateTime<Utc> = match profile {
            Profile::New     => now - Duration::days(rng.gen_range(3..=30)),
            Profile::Churned => window_start + Duration::days(rng.gen_range(0..=(DAYS - 180))),
            _                => window_start + Duration::days(rng.gen_range(0..90)),
        };

        let churn_date: Option<DateTime<Utc>> = if profile == Profile::Churned {
            let earliest = join_date + Duration::days(30);
            let latest = now - Duration::days(30);
            if earliest < latest {
                let span = (latest - earliest).num_days();
                Some(earliest + Duration::days(rng.gen_range(0..=span)))
            } else {
                Some(now - Duration::days(30))
            }
        } else {
            None
        };

        let active_end = churn_date.unwrap_or(now);
        let active_days = (active_end - join_date).num_days().max(1);

        // ── Customer ─────────────────────────────────────────────────────────
        let customer_id = Uuid::new_v4();
        let email = format!("gen-{}-{}@example.com", profile.label(), local_idx + 1);

        sqlx::query("INSERT INTO customers (id, name, email) VALUES ($1, $2, $3)")
            .bind(customer_id)
            .bind(format!(
                "{} Customer {}",
                capitalize(profile.label()),
                local_idx + 1
            ))
            .bind(&email)
            .execute(&pool)
            .await?;

        // Medium alternates between Standard and Pro for variety
        let plan_name: &str = if profile == Profile::Medium && local_idx % 2 == 0 {
            "Standard"
        } else {
            cfg.plan_name
        };

        sqlx::query(
            "INSERT INTO customer_price_plans (customer_id, price_plan_id, assigned_at) \
             VALUES ($1, $2, $3)",
        )
        .bind(customer_id)
        .bind(plan_ids[plan_name])
        .bind(join_date)
        .execute(&pool)
        .await?;

        // ── API keys ─────────────────────────────────────────────────────────
        let key_count = rng.gen_range(cfg.key_count_min..=cfg.key_count_max);
        let mut key_ids: Vec<Uuid> = Vec::with_capacity(key_count);

        for k in 0..key_count {
            let raw_bytes: [u8; 32] = rng.gen();
            let raw_key = format!("sk_{}", URL_SAFE_NO_PAD.encode(raw_bytes));
            let prefix = raw_key.chars().take(8).collect::<String>();

            let salt = SaltString::generate(&mut OsRng);
            let hash = Argon2::default()
                .hash_password(raw_key.as_bytes(), &salt)
                .map_err(|e| anyhow::anyhow!("{e}"))?
                .to_string();

            let key_id = Uuid::new_v4();
            // Revoke the last key for churned customers
            let revoked_at: Option<DateTime<Utc>> =
                if profile == Profile::Churned && k + 1 == key_count {
                    churn_date
                } else {
                    None
                };

            sqlx::query(
                "INSERT INTO api_keys (id, customer_id, prefix, key_hash, name, revoked_at) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(key_id)
            .bind(customer_id)
            .bind(&prefix)
            .bind(&hash)
            .bind(KEY_NAMES[k % KEY_NAMES.len()])
            .bind(revoked_at)
            .execute(&pool)
            .await?;

            key_ids.push(key_id);
        }

        // ── Event generation ─────────────────────────────────────────────────
        let mut b_ids: Vec<Uuid> = Vec::with_capacity(BATCH_SIZE);
        let mut b_req: Vec<String> = Vec::with_capacity(BATCH_SIZE);
        let mut b_cust: Vec<Uuid> = Vec::with_capacity(BATCH_SIZE);
        let mut b_keys: Vec<Uuid> = Vec::with_capacity(BATCH_SIZE);
        let mut b_ep: Vec<String> = Vec::with_capacity(BATCH_SIZE);
        let mut b_units: Vec<i64> = Vec::with_capacity(BATCH_SIZE);
        let mut b_ts: Vec<DateTime<Utc>> = Vec::with_capacity(BATCH_SIZE);
        let mut b_status: Vec<String> = Vec::with_capacity(BATCH_SIZE);
        let mut dup_candidates: Vec<String> = Vec::new();
        let mut total_events: u64 = 0;

        // Accumulate monthly unit totals for invoice generation
        let mut monthly_units: HashMap<(i32, u32), i64> = HashMap::new();

        // Randomly scatter spike days across the active window
        let num_spikes = ((active_days as f64) * cfg.spike_prob).ceil() as i64;
        let mut spike_days: HashSet<i64> = HashSet::new();
        for _ in 0..num_spikes {
            spike_days.insert(rng.gen_range(0..active_days));
        }

        for day_offset in 0..=active_days {
            let day_start = join_date + Duration::days(day_offset);
            if day_start > now { break; }
            let is_spike = spike_days.contains(&day_offset);
            let is_weekend = matches!(
                day_start.date_naive().weekday(),
                Weekday::Sat | Weekday::Sun
            );
            let weekday_mult: f64 = if is_weekend { 0.3 } else { 1.0 };

            let max_hour = if day_start.date_naive() == now.date_naive() { now.hour() } else { 23 };
            for hour in 0u32..=max_hour {
                let h_mult = hour_multiplier(hour);

                // Occasional customers: heavy every 3rd month, near-zero otherwise
                let base: f64 = if profile == Profile::Occasional {
                    if day_start.month() % 3 == 1 { 200.0 } else { 0.02 }
                } else {
                    cfg.base_events_per_hour
                };

                let count_f =
                    base * weekday_mult * h_mult * rng.gen_range(0.7_f64..=1.3_f64);
                let mut count = count_f.round() as u64;
                if is_spike {
                    count = (count as f64 * cfg.spike_multiplier).round() as u64;
                }

                for _ in 0..count {
                    let minute = rng.gen_range(0..60i64);
                    let second = rng.gen_range(0..60i64);
                    let ts = day_start
                        + Duration::hours(hour as i64)
                        + Duration::minutes(minute)
                        + Duration::seconds(second);

                    // 2% of events arrive late
                    let (event_ts, status) = if rng.gen_bool(0.02) {
                        let lag = rng.gen_range(48..240i64);
                        (now - Duration::hours(lag), "late")
                    } else {
                        (ts, "normal")
                    };

                    let event_units = rng.gen_range(100..=5000i64);
                    let key_idx = rng.gen_range(0..key_ids.len());
                    let request_id = Uuid::new_v4().to_string();

                    if rng.gen_bool(0.05) {
                        dup_candidates.push(request_id.clone());
                    }

                    *monthly_units
                        .entry((event_ts.year(), event_ts.month()))
                        .or_insert(0) += event_units;

                    b_ids.push(Uuid::new_v4());
                    b_req.push(request_id);
                    b_cust.push(customer_id);
                    b_keys.push(key_ids[key_idx]);
                    b_ep.push(ENDPOINTS[rng.gen_range(0..ENDPOINTS.len())].to_string());
                    b_units.push(event_units);
                    b_ts.push(event_ts);
                    b_status.push(status.to_string());
                    total_events += 1;

                    if b_ids.len() >= BATCH_SIZE {
                        flush_events(
                            &pool, &b_ids, &b_req, &b_cust, &b_keys, &b_ep, &b_units,
                            &b_ts, &b_status,
                        )
                        .await?;
                        b_ids.clear(); b_req.clear(); b_cust.clear(); b_keys.clear();
                        b_ep.clear(); b_units.clear(); b_ts.clear(); b_status.clear();
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

        for chunk in dup_candidates.chunks(BATCH_SIZE) {
            sqlx::query(
                "INSERT INTO processed_events (request_id) \
                 SELECT x FROM unnest($1::text[]) AS t(x) ON CONFLICT DO NOTHING",
            )
            .bind(chunk.to_vec())
            .execute(&pool)
            .await?;
        }

        // ── Invoices ─────────────────────────────────────────────────────────
        let tiers = &tier_defs[plan_name];
        let now_ym = (now.year(), now.month());
        let mut invoice_count = 0u32;
        let mut total_billed_minor = 0i64;

        let mut month_keys: Vec<(i32, u32)> = monthly_units.keys().cloned().collect();
        month_keys.sort();

        for (year, month) in month_keys {
            if (year, month) == now_ym {
                continue; // skip the current, still-open month
            }

            let (period_start, period_end) = month_period(year, month);
            let month_total = monthly_units[&(year, month)];
            let (inv_total_minor, line_items) = apply_tiers(month_total, tiers);

            let status = if period_end < now - Duration::days(14) {
                "paid"
            } else if period_end < now - Duration::days(3) {
                "issued"
            } else {
                "draft"
            };

            let invoice_id = Uuid::new_v4();
            let inserted = sqlx::query(
                "INSERT INTO invoices \
                 (id, customer_id, period_start, period_end, status, total_minor) \
                 VALUES ($1, $2, $3, $4, $5, $6) \
                 ON CONFLICT (customer_id, period_start) DO NOTHING",
            )
            .bind(invoice_id)
            .bind(customer_id)
            .bind(period_start)
            .bind(period_end)
            .bind(status)
            .bind(inv_total_minor)
            .execute(&pool)
            .await?
            .rows_affected();

            if inserted == 0 {
                continue;
            }

            for li in &line_items {
                sqlx::query(
                    "INSERT INTO invoice_line_items \
                     (id, invoice_id, description, units, unit_price_minor, total_minor) \
                     VALUES ($1, $2, $3, $4, $5, $6)",
                )
                .bind(Uuid::new_v4())
                .bind(invoice_id)
                .bind(&li.description)
                .bind(li.units)
                .bind(li.unit_price_minor)
                .bind(li.total_minor)
                .execute(&pool)
                .await?;
            }

            invoice_count += 1;
            total_billed_minor += inv_total_minor;
        }

        println!(
            "  -> {} events, {} invoices, ${:.2} billed",
            total_events,
            invoice_count,
            total_billed_minor as f64 / 1000.0,
        );

        summaries.push(CustomerSummary {
            email,
            profile: profile.label(),
            events: total_events,
            invoices: invoice_count,
            total_billed_minor,
        });
    }

    // ── Populate usage_windows from all inserted events ───────────────────────
    println!("\nAggregating usage_windows...");
    sqlx::query(
        "INSERT INTO usage_windows (id, customer_id, window_start, units_total) \
         SELECT gen_random_uuid(), customer_id, \
                date_trunc('hour', timestamp)::timestamptz, \
                SUM(units) \
         FROM usage_events \
         GROUP BY customer_id, date_trunc('hour', timestamp) \
         ON CONFLICT (customer_id, window_start) \
         DO UPDATE SET units_total = EXCLUDED.units_total",
    )
    .execute(&pool)
    .await?;

    // ── Summary table ─────────────────────────────────────────────────────────
    println!("\n{:-<90}", "");
    println!(
        "{:<40} {:<12} {:>12} {:>9} {:>12}",
        "Email", "Profile", "Events", "Invoices", "Billed"
    );
    println!("{:-<90}", "");
    for s in &summaries {
        println!(
            "{:<40} {:<12} {:>12} {:>9} {:>12}",
            s.email,
            s.profile,
            s.events,
            s.invoices,
            format!("${:.2}", s.total_billed_minor as f64 / 1000.0),
        );
    }
    println!("{:-<90}", "");

    Ok(())
}
