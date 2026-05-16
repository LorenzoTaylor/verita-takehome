use axum::{async_trait, body::Bytes, extract::FromRequest, http::Request};
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::{error::AppError, state::AppState};

pub struct VerifiedWebhookPayload(pub Bytes);

#[async_trait]
impl FromRequest<AppState> for VerifiedWebhookPayload {
    type Rejection = AppError;

    async fn from_request(
        req: Request<axum::body::Body>,
        state: &AppState,
    ) -> Result<Self, AppError> {
        let signature = req
            .headers()
            .get("X-Webhook-Signature")
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?
            .to_string();

        let body = Bytes::from_request(req, state)
            .await
            .map_err(|_| AppError::BadRequest("invalid body".into()))?;

        verify_hmac(&body, &signature, &state.webhook_secret)?;

        Ok(VerifiedWebhookPayload(body))
    }
}

fn verify_hmac(body: &[u8], signature: &str, secret: &str) -> Result<(), AppError> {
    type HmacSha256 = Hmac<Sha256>;

    let sig_bytes = hex::decode(signature).map_err(|_| AppError::Unauthorized)?;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid hmac key")))?;
    mac.update(body);

    mac.verify_slice(&sig_bytes).map_err(|_| AppError::Unauthorized)
}
