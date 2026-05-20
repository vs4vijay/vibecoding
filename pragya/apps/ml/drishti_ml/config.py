from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    ml_host: str = Field(default="localhost")
    ml_port: int = Field(default=8000)
    ml_version: str = Field(default="0.1.0")
    internal_shared_secret: str = Field(default="dev-only-not-a-secret", min_length=8)
    default_seed: int = Field(default=42)
    artefacts_dir: str = Field(default="./artefacts")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
