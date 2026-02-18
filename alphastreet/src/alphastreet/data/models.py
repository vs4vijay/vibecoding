from datetime import datetime
from typing import Optional
from sqlalchemy import String, Float, Integer, DateTime, Boolean, Text, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[Optional[int]] = mapped_column(Integer, unique=True, nullable=True, index=True)
    username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    min_sentiment_score: Mapped[float] = mapped_column(Float, default=0.6)
    max_suggestions: Mapped[int] = mapped_column(Integer, default=10)
    analysis_time: Mapped[str] = mapped_column(String(5), default="09:00")
    frequency: Mapped[str] = mapped_column(String(20), default="daily")
    
    preferred_sectors: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    excluded_stocks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class NewsArticle(Base):
    __tablename__ = "news_articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    url: Mapped[str] = mapped_column(String(1000), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(100))
    published_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    mentioned_stocks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SentimentAnalysis(Base):
    __tablename__ = "sentiment_analysis"

    id: Mapped[int] = mapped_column(primary_key=True)
    news_article_id: Mapped[int] = mapped_column(Integer, index=True)
    
    sentiment_score: Mapped[float] = mapped_column(Float)
    sentiment_label: Mapped[str] = mapped_column(String(50))
    confidence: Mapped[float] = mapped_column(Float)
    
    provider: Mapped[str] = mapped_column(String(50))
    model_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    analysis_metadata: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class StockSuggestion(Base):
    __tablename__ = "stock_suggestions"

    id: Mapped[int] = mapped_column(primary_key=True)
    stock_symbol: Mapped[str] = mapped_column(String(50), index=True)
    stock_name: Mapped[str] = mapped_column(String(200))

    avg_sentiment_score: Mapped[float] = mapped_column(Float, index=True)
    article_count: Mapped[int] = mapped_column(Integer)

    is_unlisted: Mapped[bool] = mapped_column(Boolean, default=False)
    sector: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    reasoning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    related_news_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    article_details: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    suggested_for_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
