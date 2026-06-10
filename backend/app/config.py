from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+asyncpg://localhost:5432/home_theater"
    host: str = "0.0.0.0"
    port: int = 8000
    default_download_root: str | None = None
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout: int = 30
    log_level: str = "INFO"

    @property
    def db_url(self) -> str:
        return self.database_url


settings = Settings()
