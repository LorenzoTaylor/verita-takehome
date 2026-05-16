use axum::{async_trait, extract::FromRequestParts, http::request::Parts};
use jsonwebtoken::{decode, DecodingKey, Validation};
use uuid::Uuid;

use crate::{error::AppError, extractors::ops_user::Claims, state::AppState};

pub struct CustomerSession {
    pub id: Uuid,
}

#[async_trait]
impl FromRequestParts<AppState> for CustomerSession {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let token = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(AppError::Unauthorized)?;

        let data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|_| AppError::Unauthorized)?;

        if data.claims.role != "customer" {
            return Err(AppError::Unauthorized);
        }

        let id = Uuid::parse_str(&data.claims.sub).map_err(|_| AppError::Unauthorized)?;

        Ok(CustomerSession { id })
    }
}
