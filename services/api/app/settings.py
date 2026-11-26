from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_DEFAULT_SECRET = "dev-only-change-before-production-nairasense"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    environment: str = "development"  # "development" | "test" | "production"
    cors_origins: list[str] = ["http://localhost:3000"]
    database_path: str = "nairasense_dev.db"
    vision_provider: str = "local"  # "local" (100% offline) | "gemini" | "mock"
    allow_reference_enrollment: bool = False
    enrolled_prototypes_path: str = "naira_enrolled_prototypes.json"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    auth_secret: str = _DEV_DEFAULT_SECRET
    auth_token_ttl_seconds: int = 86400 * 7
    jwt_issuer: str = "nairasense-api"
    jwt_audience: str = "nairasense-web"

    def validate_security_config(self) -> None:
        is_weak = not self.auth_secret or self.auth_secret == _DEV_DEFAULT_SECRET or len(self.auth_secret) < 32
        if self.environment.lower() == "production" and is_weak:
            raise RuntimeError(
                "AUTH_SECRET must be set to a strong (>=32 char) secret in production."
            )


settings = Settings()
