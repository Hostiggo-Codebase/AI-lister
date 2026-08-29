from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    @field_validator("*", mode="before")
    @classmethod
    def _strip_and_drop_inline_comments(cls, v):
        """Tolerate `.env` values with trailing whitespace / inline `# comments`."""
        if isinstance(v, str):
            v = v.strip()
            # a value that is only an inline comment == not set
            if v.startswith("#"):
                return ""
            # strip ` # comment` when preceded by whitespace (matches dotenv)
            for i in range(1, len(v)):
                if v[i] == "#" and v[i - 1] in " \t":
                    return v[:i].strip()
        return v

    # database
    database_url: str = ""
    db_schema: str = "hostiggo_testing_schema"
    import_schema: str = "hostiggo_testing_schema"

    # supabase storage
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_photo_bucket: str = "homestay-photos"

    # llm
    anthropic_api_key: str = ""
    import_llm_model: str = "claude-sonnet-5"

    # fx
    fx_api_url: str = ""
    fx_base_currency: str = "INR"

    # pipeline
    import_max_photos: int = 40
    import_tier2_enabled: bool = True
    import_fetch_timeout_s: int = 20
    import_photo_max_bytes: int = 8_000_000
    import_worker_concurrency: int = 2

    # service
    api_key: str = ""
    log_level: str = "INFO"

    @property
    def has_llm(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def has_storage(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def has_db(self) -> bool:
        return bool(self.database_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
