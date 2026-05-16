use chrono::{Datelike, TimeZone, Utc};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Deserialize)]
struct PriceTier {
    up_to: Option<i64>,
    unit_price_minor: i64,
}

struct LineItem {
    description: String,
    units: i64,
    unit_price_minor: i64,
    total_minor: i64,
}

fn apply_tiers(total_units: i64, tiers: &[PriceTier]) -> Vec<LineItem> {
    let mut items = Vec::new();
    let mut remaining = total_units;
    let mut cumulative_up_to = 0i64;

    for tier in tiers {
        if remaining == 0 {
            break;
        }

        let tier_capacity = match tier.up_to {
            Some(up_to) => (up_to - cumulative_up_to).max(0),
            None => remaining,
        };
        let tier_units = tier_capacity.min(remaining);

        if tier_units > 0 {
            let description = if cumulative_up_to == 0 {
                if tier.unit_price_minor == 0 {
                    format!("First {} units (free tier)", tier_units)
                } else {
                    format!("First {} units", tier_units)
                }
            } else {
                format!(
                    "Next {} units at ${:.3}",
                    tier_units,
                    tier.unit_price_minor as f64 / 1000.0
                )
            };
            items.push(LineItem {
                description,
                units: tier_units,
                unit_price_minor: tier.unit_price_minor,
                total_minor: tier_units * tier.unit_price_minor,
            });
            remaining -= tier_units;
        }

        if let Some(up_to) = tier.up_to {
            cumulative_up_to = up_to;
        }
    }

    items
}

pub async fn run(db: &PgPool) -> anyhow::Result<()> {
    let now = Utc::now();

    // Previous calendar month
    let (prev_year, prev_month) = if now.month() == 1 {
        (now.year() - 1, 12u32)
    } else {
        (now.year(), now.month() - 1)
    };
    let period_start = Utc.with_ymd_and_hms(prev_year, prev_month, 1, 0, 0, 0).unwrap();
    let period_end = Utc.with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0).unwrap();

    // Customers with the price plan active at period_start (most recent assignment)
    #[derive(sqlx::FromRow)]
    struct CustomerPlan {
        customer_id: Uuid,
        tiers: serde_json::Value,
    }
    let customers = sqlx::query_as::<_, CustomerPlan>(
        "SELECT DISTINCT ON (cpp.customer_id)
             cpp.customer_id,
             pp.tiers
         FROM customer_price_plans cpp
         JOIN price_plans pp ON pp.id = cpp.price_plan_id
         WHERE cpp.assigned_at <= $1
         ORDER BY cpp.customer_id, cpp.assigned_at DESC",
    )
    .bind(period_start)
    .fetch_all(db)
    .await?;

    let mut invoices_created = 0u32;

    for cp in &customers {
        // Skip if invoice already exists for this period (idempotency)
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM invoices WHERE customer_id = $1 AND period_start = $2)",
        )
        .bind(cp.customer_id)
        .bind(period_start)
        .fetch_one(db)
        .await?;

        if exists {
            continue;
        }

        // Sum usage windows for this period (exclusive end)
        let total_units: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(units_total), 0)
             FROM usage_windows
             WHERE customer_id = $1
               AND window_start >= $2
               AND window_start < $3",
        )
        .bind(cp.customer_id)
        .bind(period_start)
        .bind(period_end)
        .fetch_one(db)
        .await?;

        let tiers: Vec<PriceTier> = serde_json::from_value(cp.tiers.clone())?;
        let line_items = apply_tiers(total_units, &tiers);
        let total_minor: i64 = line_items.iter().map(|l| l.total_minor).sum();

        let invoice_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO invoices (id, customer_id, period_start, period_end, status, total_minor)
             VALUES ($1, $2, $3, $4, 'issued', $5)",
        )
        .bind(invoice_id)
        .bind(cp.customer_id)
        .bind(period_start)
        .bind(period_end)
        .bind(total_minor)
        .execute(db)
        .await?;

        for item in &line_items {
            sqlx::query(
                "INSERT INTO invoice_line_items
                     (id, invoice_id, description, units, unit_price_minor, total_minor)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(Uuid::new_v4())
            .bind(invoice_id)
            .bind(&item.description)
            .bind(item.units)
            .bind(item.unit_price_minor)
            .bind(item.total_minor)
            .execute(db)
            .await?;
        }

        invoices_created += 1;
    }

    tracing::info!(
        period = %period_start.format("%Y-%m"),
        invoices_created,
        "invoice job complete"
    );
    Ok(())
}
