mod anomaly;
mod invoice;
mod window;

use sqlx::PgPool;

pub fn spawn_all(db: PgPool) {
    spawn("window", std::time::Duration::from_secs(60), db.clone());
    spawn("invoice", std::time::Duration::from_secs(300), db.clone());
    spawn("anomaly", std::time::Duration::from_secs(120), db);
}

fn spawn(job_type: &'static str, interval: std::time::Duration, db: PgPool) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            if let Err(e) = try_run(job_type, &db).await {
                tracing::error!(job = job_type, "job error: {e:#}");
            }
        }
    });
}

async fn try_run(job_type: &str, db: &PgPool) -> anyhow::Result<()> {
    let mut tx = db.begin().await?;

    // Claim the row atomically; SKIP LOCKED means concurrent workers exit immediately
    let job_id: Option<uuid::Uuid> = sqlx::query_scalar(
        "SELECT id FROM jobs WHERE job_type = $1 AND status = 'idle' FOR UPDATE SKIP LOCKED",
    )
    .bind(job_type)
    .fetch_optional(&mut *tx)
    .await?;

    if job_id.is_none() {
        return Ok(());
    }

    sqlx::query("UPDATE jobs SET status = 'running', locked_at = now() WHERE job_type = $1")
        .bind(job_type)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let result = match job_type {
        "window" => window::run(db).await,
        "invoice" => invoice::run(db).await,
        "anomaly" => anomaly::run(db).await,
        _ => Ok(()),
    };

    // Always reset to idle regardless of success/failure
    sqlx::query("UPDATE jobs SET status = 'idle', last_run_at = now() WHERE job_type = $1")
        .bind(job_type)
        .execute(db)
        .await?;

    result
}
