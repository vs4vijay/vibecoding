from datetime import datetime
from typing import List
import httpx
from bs4 import BeautifulSoup
from .base import NewsSource, NewsArticle
from ..utils import get_logger

logger = get_logger(__name__)


class WebScraperSource(NewsSource):
    SCRAPE_TARGETS = [
        {
            "url": "https://www.moneycontrol.com/news/business/stocks/",
            "title_selector": "h2 a",
            "link_attr": "href",
            "date_selector": "span.article-time",
        },
    ]

    def __init__(self):
        super().__init__("Web Scraper")

    def is_configured(self) -> bool:
        return True

    async def fetch_news(
        self,
        query: str = "indian stocks",
        days: int = 7,
        limit: int = 50
    ) -> List[NewsArticle]:
        articles = []

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for target in self.SCRAPE_TARGETS:
                try:
                    response = await client.get(target["url"])
                    response.raise_for_status()

                    soup = BeautifulSoup(response.text, "html.parser")
                    title_elements = soup.select(target["title_selector"])

                    for elem in title_elements[:limit]:
                        try:
                            title = elem.get_text(strip=True)
                            link = elem.get(target["link_attr"], "")

                            if not link.startswith("http"):
                                base_url = f"{response.url.scheme}://{response.url.host}"
                                link = base_url + link

                            article = NewsArticle(
                                title=title,
                                url=link,
                                source=self.source_name,
                                published_at=datetime.utcnow(),
                            )
                            articles.append(article)

                            if len(articles) >= limit:
                                return articles
                        except Exception as e:
                            logger.warning(f"Error parsing scraped element: {e}")
                            continue

                except Exception as e:
                    logger.error(f"Error scraping {target['url']}: {e}")
                    continue

        logger.info(f"Fetched {len(articles)} articles via web scraping")
        return articles[:limit]
