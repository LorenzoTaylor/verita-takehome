use sqlx::PgPool;

pub async fn run(db: &PgPool) -> anyhow::Result<()> {
    // Full recompute: idempotent because we SET, not add.
    // Late-status events are excluded — they go through credit adjustment instead.
    let result = sqlx::query(
        "INSERT INTO usage_windows (id, customer_id, window_start, units_total)
         SELECT
             gen_random_uuid(),
             customer_id,
             date_trunc('hour', timestamp) AS window_start,
             SUM(units)
         FROM usage_events
         WHERE status = 'normal'
         GROUP BY customer_id, date_trunc('hour', timestamp)
         ON CONFLICT (customer_id, window_start)
         DO UPDATE SET units_total = EXCLUDED.units_total",
    )
    .execute(db)
    .await?;

    tracing::info!(rows = result.rows_affected(), "window job complete");
    Ok(())
}
