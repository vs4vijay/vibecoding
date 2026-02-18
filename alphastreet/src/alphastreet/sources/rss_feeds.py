import feedparser
from datetime import datetime, timedelta
from typing import List
import httpx
from .base import NewsSource, NewsArticle
from ..utils import get_logger

logger = get_logger(__name__)


class RSSNewsSource(NewsSource):
    INDIAN_NEWS_FEEDS = [
        "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
        "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
        "https://www.moneycontrol.com/rss/latestnews.xml",
        "https://www.moneycontrol.com/rss/marketreports.xml",
        "https://www.business-standard.com/rss/markets-106.rss",
        "https://www.business-standard.com/rss/finance-103.rss",
        "https://www.livemint.com/rss/markets",
        "https://www.livemint.com/rss/companies",
    ]

    def __init__(self):
        super().__init__("RSS Feeds")

    def is_configured(self) -> bool:
        return True

    async def fetch_news(
        self,
        query: str = "indian stocks",
        days: int = 7,
        limit: int = 50
    ) -> List[NewsArticle]:
        articles = []
        cutoff_date = datetime.utcnow() - timedelta(days=days)

        async with httpx.AsyncClient(timeout=30.0) as client:
            for feed_url in self.INDIAN_NEWS_FEEDS:
                try:
                    response = await client.get(feed_url)
                    feed = feedparser.parse(response.content)

                    for entry in feed.entries:
                        try:
                            published = self._parse_date(entry)
                            if published and published >= cutoff_date:
                                article = NewsArticle(
                                    title=entry.get("title", ""),
                                    url=entry.get("link", ""),
                                    source=feed.feed.get("title", self.source_name),
                                    published_at=published,
                                    content=entry.get("summary", entry.get("description", "")),
                                )
                                articles.append(article)

                                if len(articles) >= limit:
                                    return articles
                        except Exception as e:
                            logger.warning(f"Error parsing RSS entry: {e}")
                            continue

                except Exception as e:
                    logger.error(f"Error fetching RSS feed {feed_url}: {e}")
                    continue

        logger.info(f"Fetched {len(articles)} articles from RSS feeds")
        return articles[:limit]

    def _parse_date(self, entry) -> datetime:
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            return datetime(*entry.published_parsed[:6])
        elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
            return datetime(*entry.updated_parsed[:6])
        return datetime.utcnow()
