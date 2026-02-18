from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = Field(
        default="sqlite:///./data/marketpulse.db",
        description="Database connection URL"
    )

    telegram_bot_token: str = Field(
        default="",
        description="Telegram bot token from BotFather"
    )

    allowed_telegram_ids: str = Field(
        default="",
        description="Comma-separated list of allowed Telegram user IDs (empty = allow all)"
    )

    news_api_key: str = Field(
        default="",
        description="NewsAPI.org API key"
    )

    openai_api_key: str = Field(
        default="",
        description="OpenAI API key for GPT-based sentiment analysis"
    )
    
    anthropic_api_key: str = Field(
        default="",
        description="Anthropic API key for Claude-based sentiment analysis"
    )

    sentiment_provider: Literal["local", "openai", "anthropic"] = Field(
        default="local",
        description="Sentiment analysis provider"
    )
    
    local_model_name: str = Field(
        default="ProsusAI/finbert",
        description="HuggingFace model for local sentiment analysis"
    )

    min_sentiment_score: float = Field(
        default=0.6,
        ge=0.0,
        le=1.0,
        description="Minimum sentiment score for stock suggestions"
    )
    
    max_suggestions: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Maximum number of stock suggestions to return"
    )
    
    analysis_lookback_days: int = Field(
        default=7,
        ge=1,
        le=30,
        description="Number of days to look back for news analysis"
    )

    default_analysis_time: str = Field(
        default="09:00",
        description="Default time for daily analysis (HH:MM format)"
    )
    
    timezone: str = Field(
        default="Asia/Kolkata",
        description="Timezone for scheduling"
    )

    log_level: str = Field(
        default="INFO",
        description="Logging level"
    )
    
    log_file: str = Field(
        default="./data/marketpulse.log",
        description="Log file path"
    )


settings = Settings()
