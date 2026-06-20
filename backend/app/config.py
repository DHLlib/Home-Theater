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

    # 站点探测 / 自适应检测（秒 / 次数）
    probe_interval: int = 600
    fail_threshold: int = 3
    recover_threshold: int = 2
    check_base_interval: int = 300
    check_max_interval: int = 3600

    # 下载 / 推流 / 缓存
    max_concurrent_downloads: int = 10
    sse_heartbeat_interval: int = 30
    play_cache_ttl_seconds: int = 7 * 24 * 3600  # 7 天

    # 分类映射读路径：true 走数据库中间表，false 回退 JSON
    use_category_mapping_table: bool = True

    @property
    def db_url(self) -> str:
        return self.database_url


settings = Settings()
