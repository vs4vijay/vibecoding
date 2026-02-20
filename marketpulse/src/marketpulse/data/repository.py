from typing import List, Optional, Type, TypeVar
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
from .models import User, NewsArticle, SentimentAnalysis, StockSuggestion

T = TypeVar("T")


class Repository:
    def __init__(self, session: Session):
        self.session = session

    def create_user(
        self,
        telegram_id: Optional[int] = None,
        username: Optional[str] = None,
        **kwargs
    ) -> User:
        user = User(telegram_id=telegram_id, username=username, **kwargs)
        self.session.add(user)
        self.session.flush()
        return user

    def get_user_by_telegram_id(self, telegram_id: int) -> Optional[User]:
        return self.session.query(User).filter(
            User.telegram_id == telegram_id
        ).first()

    def get_or_create_user(self, telegram_id: int, username: Optional[str] = None) -> User:
        user = self.get_user_by_telegram_id(telegram_id)
        if not user:
            user = self.create_user(telegram_id=telegram_id, username=username)
        return user

    def update_user_preferences(self, user_id: int, **kwargs) -> Optional[User]:
        user = self.session.query(User).filter(User.id == user_id).first()
        if user:
            for key, value in kwargs.items():
                if hasattr(user, key):
                    setattr(user, key, value)
            user.updated_at = datetime.utcnow()
            self.session.flush()
        return user

    def get_all_active_users(self) -> List[User]:
        return self.session.query(User).filter(User.is_active == True).all()

    def create_news_article(
        self,
        title: str,
        url: str,
        source: str,
        published_at: datetime,
        content: Optional[str] = None,
        mentioned_stocks: Optional[str] = None
    ) -> NewsArticle:
        article = NewsArticle(
            title=title,
            url=url,
            source=source,
            published_at=published_at,
            content=content,
            mentioned_stocks=mentioned_stocks
        )
        self.session.add(article)
        self.session.flush()
        return article

    def get_news_article_by_url(self, url: str) -> Optional[NewsArticle]:
        return self.session.query(NewsArticle).filter(NewsArticle.url == url).first()

    def get_recent_news_articles(self, days: int = 7, limit: int = 100) -> List[NewsArticle]:
        since_date = datetime.utcnow() - timedelta(days=days)
        return self.session.query(NewsArticle).filter(
            NewsArticle.published_at >= since_date
        ).order_by(desc(NewsArticle.published_at)).limit(limit).all()

    def create_sentiment_analysis(
        self,
        news_article_id: int,
        sentiment_score: float,
        sentiment_label: str,
        confidence: float,
        provider: str,
        model_name: Optional[str] = None,
        analysis_metadata: Optional[dict] = None
    ) -> SentimentAnalysis:
        analysis = SentimentAnalysis(
            news_article_id=news_article_id,
            sentiment_score=sentiment_score,
            sentiment_label=sentiment_label,
            confidence=confidence,
            provider=provider,
            model_name=model_name,
            analysis_metadata=analysis_metadata
        )
        self.session.add(analysis)
        self.session.flush()
        return analysis

    def get_sentiment_by_article_id(self, article_id: int) -> Optional[SentimentAnalysis]:
        return self.session.query(SentimentAnalysis).filter(
            SentimentAnalysis.news_article_id == article_id
        ).first()

    def create_stock_suggestion(
        self,
        stock_symbol: str,
        stock_name: str,
        avg_sentiment_score: float,
        article_count: int,
        **kwargs
    ) -> StockSuggestion:
        suggestion = StockSuggestion(
            stock_symbol=stock_symbol,
            stock_name=stock_name,
            avg_sentiment_score=avg_sentiment_score,
            article_count=article_count,
            **kwargs
        )
        self.session.add(suggestion)
        self.session.flush()
        return suggestion

    def get_suggestions_for_date(
        self,
        date: datetime,
        min_score: float = 0.6,
        limit: int = 10
    ) -> List[StockSuggestion]:
        start_date = datetime(date.year, date.month, date.day)
        end_date = start_date + timedelta(days=1)

        return self.session.query(StockSuggestion).filter(
            and_(
                StockSuggestion.suggested_for_date >= start_date,
                StockSuggestion.suggested_for_date < end_date,
                StockSuggestion.avg_sentiment_score >= min_score
            )
        ).order_by(desc(StockSuggestion.avg_sentiment_score)).limit(limit).all()

    def get_recent_suggestions(
        self,
        telegram_id: int,
        hours: int = 24,
        limit: int = 10
    ) -> List[StockSuggestion]:
        """Get the most recent stock suggestions within the specified hours."""
        from datetime import timezone
        since_time = datetime.now(timezone.utc) - timedelta(hours=hours)

        return self.session.query(StockSuggestion).filter(
            StockSuggestion.created_at >= since_time
        ).order_by(desc(StockSuggestion.created_at)).limit(limit).all()

    def get_latest_analysis_batch(self) -> List[StockSuggestion]:
        """Get the most recent complete analysis batch (all suggestions from the same run)."""
        # Get the most recent suggestion's timestamp
        latest = self.session.query(StockSuggestion).order_by(
            desc(StockSuggestion.created_at)
        ).first()

        if not latest:
            return []

        # Get all suggestions created within 1 minute of the latest (same batch)
        batch_start = latest.created_at - timedelta(minutes=1)
        batch_end = latest.created_at + timedelta(minutes=1)

        return self.session.query(StockSuggestion).filter(
            and_(
                StockSuggestion.created_at >= batch_start,
                StockSuggestion.created_at <= batch_end
            )
        ).order_by(desc(StockSuggestion.avg_sentiment_score)).all()
