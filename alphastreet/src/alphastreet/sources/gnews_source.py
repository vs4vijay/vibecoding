from datetime import datetime, timedelta
from typing import List
from gnews import GNews
from .base import NewsSource, NewsArticle
from ..utils import get_logger

logger = get_logger(__name__)


class GNewsSource(NewsSource):
    """
    Free Google News scraper using gnews library.
    No API key needed - scrapes Google News directly.
    """

    def __init__(self):
        super().__init__("Google News (Free)")

    def is_configured(self) -> bool:
        """Always available - no API key needed"""
        return True

    async def fetch_news(
        self,
        query: str = "indian stocks market",
        days: int = 7,
        limit: int = 50
    ) -> List[NewsArticle]:
        articles = []

        try:
            # Configure GNews for India
            google_news = GNews(
                language='en',
                country='IN',  # India
                period=f'{days}d',  # Last N days
                max_results=limit
            )

            # Search for Indian stock market news
            queries = [
                "indian stocks",
                "nse bse stocks",
                "indian stock market",
                "indian shares"
            ]

            seen_urls = set()

            for search_query in queries:
                try:
                    results = google_news.get_news(search_query)

                    for item in results:
                        try:
                            url = item.get('url', '')
                            if not url or url in seen_urls:
                                continue

                            seen_urls.add(url)

                            # Parse published date
                            published_date = item.get('published date', '')
                            try:
                                published_at = datetime.strptime(
                                    published_date,
                                    '%a, %d %b %Y %H:%M:%S %Z'
                                )
                            except Exception:
                                published_at = datetime.utcnow()

                            article = NewsArticle(
                                title=item.get('title', ''),
                                url=url,
                                source=item.get('publisher', {}).get('title', self.source_name),
                                published_at=published_at,
                                content=item.get('description', ''),
                            )
                            articles.append(article)

                            if len(articles) >= limit:
                                break

                        except Exception as e:
                            logger.warning(f"Error parsing GNews article: {e}")
                            continue

                    if len(articles) >= limit:
                        break

                except Exception as e:
                    logger.warning(f"Error fetching from GNews query '{search_query}': {e}")
                    continue

            logger.info(f"Fetched {len(articles)} articles from Google News (free)")

        except Exception as e:
            logger.error(f"Error in GNews source: {e}")

        return articles[:limit]
