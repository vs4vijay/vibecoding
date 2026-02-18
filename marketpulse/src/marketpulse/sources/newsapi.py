from datetime import datetime, timedelta
from typing import List
from newsapi import NewsApiClient
from .base import NewsSource, NewsArticle
from ..config import settings
from ..utils import get_logger

logger = get_logger(__name__)


class NewsAPISource(NewsSource):
    def __init__(self):
        super().__init__("NewsAPI")
        self.client = None
        if self.is_configured():
            self.client = NewsApiClient(api_key=settings.news_api_key)

    def is_configured(self) -> bool:
        return bool(settings.news_api_key)

    async def fetch_news(
        self,
        query: str = "indian stocks OR indian market OR nse OR bse",
        days: int = 7,
        limit: int = 50
    ) -> List[NewsArticle]:
        if not self.is_configured():
            logger.warning("NewsAPI not configured, skipping")
            return []

        articles = []
        from_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

        try:
            response = self.client.get_everything(
                q=query,
                from_param=from_date,
                language="en",
                sort_by="publishedAt",
                page_size=min(limit, 100)
            )

            if response.get("status") == "ok":
                for article_data in response.get("articles", []):
                    try:
                        published_str = article_data.get("publishedAt")
                        published_at = datetime.fromisoformat(
                            published_str.replace("Z", "+00:00")
                        ) if published_str else datetime.utcnow()

                        article = NewsArticle(
                            title=article_data.get("title", ""),
                            url=article_data.get("url", ""),
                            source=article_data.get("source", {}).get("name", self.source_name),
                            published_at=published_at,
                            content=article_data.get("description") or article_data.get("content"),
                        )
                        articles.append(article)
                    except Exception as e:
                        logger.warning(f"Error parsing NewsAPI article: {e}")
                        continue

            logger.info(f"Fetched {len(articles)} articles from NewsAPI")
        except Exception as e:
            logger.error(f"Error fetching from NewsAPI: {e}")

        return articles[:limit]
