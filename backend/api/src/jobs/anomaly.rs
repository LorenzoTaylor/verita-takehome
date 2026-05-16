use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn run(db: &PgPool) -> anyhow::Result<()> {
    // Guard: only run if window job completed in the last 2 hours
    let window_last_run: Option<chrono::DateTime<Utc>> =
        sqlx::query_scalar("SELECT last_run_at FROM jobs WHERE job_type = 'window'")
            .fetch_optional(db)
            .await?
            .flatten();

    let stale = window_last_run
        .map(|t| Utc::now() - t > chrono::Duration::hours(2))
        .unwrap_or(true);

    if stale {
        tracing::warn!("window job hasn't run recently — skipping anomaly detection");
        return Ok(());
    }

    check_usage_spikes(db).await?;
    check_usage_drops(db).await?;
    check_invoice_spikes(db).await?;

    tracing::info!("anomaly job complete");
    Ok(())
}

// Signal: latest complete hour usage > 10× 30-day rolling hourly average
async fn check_usage_spikes(db: &PgPool) -> anyhow::Result<()> {
    #[derive(sqlx::FromRow)]
    struct SpikeRow {
        customer_id: Uuid,
        recent_units: i64,
        avg_units: f64,
    }

    let rows = sqlx::query_as::<_, SpikeRow>(
        "WITH recent AS (
             SELECT customer_id, units_total AS recent_units
             FROM usage_windows
             WHERE window_start = date_trunc('hour', now() - interval '1 hour')
         ),
         rolling AS (
             SELECT customer_id, AVG(units_total) AS avg_units
             FROM usage_windows
             WHERE window_start >= now() - interval '30 days'
               AND window_start < date_trunc('hour', now() - interval '1 hour')
             GROUP BY customer_id
         )
         SELECT r.customer_id, r.recent_units, ro.avg_units
         FROM recent r
         JOIN rolling ro ON ro.customer_id = r.customer_id
         WHERE ro.avg_units > 0
           AND r.recent_units > ro.avg_units * 10",
    )
    .fetch_all(db)
    .await?;

    for row in rows {
        flag_if_new(db, row.customer_id, "usage_spike", row.recent_units as f64, row.avg_units * 10.0).await?;
    }
    Ok(())
}

// Signal: customer had usage 2 hours ago but zero in the last complete hour
async fn check_usage_drops(db: &PgPool) -> anyhow::Result<()> {
    let customer_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT prev.customer_id
         FROM usage_windows prev
         LEFT JOIN usage_windows curr
           ON curr.customer_id = prev.customer_id
          AND curr.window_start = date_trunc('hour', now() - interval '1 hour')
         WHERE prev.window_start = date_trunc('hour', now() - interval '2 hours')
           AND prev.units_total > 0
           AND (curr.units_total IS NULL OR curr.units_total = 0)",
    )
    .fetch_all(db)
    .await?;

    for customer_id in customer_ids {
        flag_if_new(db, customer_id, "usage_drop", 0.0, 1.0).await?;
    }
    Ok(())
}

// Signal: most recent invoice total > 3× the previous invoice for the same customer
async fn check_invoice_spikes(db: &PgPool) -> anyhow::Result<()> {
    #[derive(sqlx::FromRow)]
    struct InvoiceSpikeRow {
        customer_id: Uuid,
        total_minor: i64,
        prev_total: i64,
    }

    let rows = sqlx::query_as::<_, InvoiceSpikeRow>(
        "WITH ranked AS (
             SELECT
                 customer_id,
                 total_minor,
                 LAG(total_minor) OVER (PARTITION BY customer_id ORDER BY period_start) AS prev_total
             FROM invoices
             WHERE status IN ('issued', 'paid', 'draft')
         )
         SELECT customer_id, total_minor, prev_total
         FROM ranked
         WHERE prev_total IS NOT NULL
           AND prev_total > 0
           AND total_minor > prev_total * 3",
    )
    .fetch_all(db)
    .await?;

    for row in rows {
        flag_if_new(
            db,
            row.customer_id,
            "invoice_spike",
            row.total_minor as f64,
            row.prev_total as f64 * 3.0,
        )
        .await?;
    }
    Ok(())
}

// Insert a flag only if no unresolved flag of the same type exists for this customer within 2h
async fn flag_if_new(
    db: &PgPool,
    customer_id: Uuid,
    signal_type: &str,
    value: f64,
    threshold: f64,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO anomaly_flags (id, customer_id, signal_type, value, threshold, flagged_at)
         SELECT gen_random_uuid(), $1, $2, $3, $4, now()
         WHERE NOT EXISTS (
             SELECT 1 FROM anomaly_flags
             WHERE customer_id = $1
               AND signal_type = $2
               AND resolved_at IS NULL
               AND flagged_at > now() - interval '2 hours'
         )",
    )
    .bind(customer_id)
    .bind(signal_type)
    .bind(value)
    .bind(threshold)
    .execute(db)
    .await?;

    tracing::warn!(
        customer_id = %customer_id,
        signal = signal_type,
        value,
        threshold,
        "anomaly flagged"
    );
    Ok(())
}
