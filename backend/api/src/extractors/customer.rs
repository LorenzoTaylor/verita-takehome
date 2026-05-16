use argon2::{Argon2, PasswordHash, PasswordVerifier};
use axum::{async_trait, extract::FromRequestParts, http::request::Parts};
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

pub struct AuthenticatedCustomer {
    pub id: Uuid,
}

#[derive(sqlx::FromRow)]
struct ApiKeyRow {
    customer_id: Uuid,
    key_hash: String,
}

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedCustomer {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, AppError> {
        let key = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(AppError::Unauthorized)?
            .to_string();

        if key.len() < 8 {
            return Err(AppError::Unauthorized);
        }

        let prefix = &key[..8];

        let row = sqlx::query_as::<_, ApiKeyRow>(
            "SELECT customer_id, key_hash FROM api_keys WHERE prefix = $1 AND revoked_at IS NULL",
        )
        .bind(prefix)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::Unauthorized)?;

        let hash = row.key_hash;
        let key_bytes = key.into_bytes();

        // Argon2 verify is CPU-intensive; run on blocking thread to avoid stalling the async runtime
        let valid = tokio::task::spawn_blocking(move || {
            let parsed = PasswordHash::new(&hash).map_err(|_| ())?;
            Argon2::default()
                .verify_password(&key_bytes, &parsed)
                .map(|_| true)
                .map_err(|_| ())
        })
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("join error: {e}")))?
        .unwrap_or(false);

        if !valid {
            return Err(AppError::Unauthorized);
        }

        Ok(AuthenticatedCustomer { id: row.customer_id })
    }
}
