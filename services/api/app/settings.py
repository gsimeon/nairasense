from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    cors_origins: list[str] = ["http://localhost:3000"]
    database_path: str = "nairasense_dev.db"
    vision_provider: str = "local"  # "local" (100% offline) | "gemini" | "mock"
    allow_reference_enrollment: bool = False
    enrolled_prototypes_path: str = "naira_enrolled_prototypes.json"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"


settings = Settings()
