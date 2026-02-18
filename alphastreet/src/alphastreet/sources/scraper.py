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
            "title_selector": "li h2 a, article h2 a, .news_title a",
            "link_attr": "href",
            "base_url": "https://www.moneycontrol.com",
        },
    ]

    def __init__(self):
        super().__init__("Web Scraper")

    def is_configured(self) -> bool:
        # Disabled: MoneyControl blocks scraping with 403 Forbidden
        # TODO: Find alternative sources or use API-based approach
        return False

    async def fetch_news(
        self,
        query: str = "indian stocks",
        days: int = 7,
        limit: int = 50
    ) -> List[NewsArticle]:
        articles = []

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers) as client:
            for target in self.SCRAPE_TARGETS:
                try:
                    logger.info(f"Scraping {target['url']}...")
                    response = await client.get(target["url"])
                    response.raise_for_status()

                    soup = BeautifulSoup(response.text, "html.parser")

                    # Try multiple selectors
                    title_elements = soup.select(target["title_selector"])
                    logger.debug(f"Found {len(title_elements)} elements with selector: {target['title_selector']}")

                    if not title_elements:
                        # Try finding any article links as fallback
                        title_elements = soup.find_all('a', href=True, string=True)
                        logger.debug(f"Fallback: Found {len(title_elements)} article links")

                    for elem in title_elements[:limit]:
                        try:
                            title = elem.get_text(strip=True)

                            # Skip if title is too short or empty
                            if not title or len(title) < 10:
                                continue

                            link = elem.get(target["link_attr"], "")

                            # Build full URL
                            if link and not link.startswith("http"):
                                if link.startswith("/"):
                                    link = target.get("base_url", "") + link
                                else:
                                    base_url = f"{response.url.scheme}://{response.url.host}"
                                    link = base_url + "/" + link

                            # Skip if no valid link
                            if not link or not link.startswith("http"):
                                continue

                            article = NewsArticle(
                                title=title,
                                url=link,
                                source="MoneyControl",
                                published_at=datetime.utcnow(),
                            )
                            articles.append(article)

                            if len(articles) >= limit:
                                break

                        except Exception as e:
                            logger.debug(f"Error parsing scraped element: {e}")
                            continue

                    logger.info(f"Successfully scraped {len(articles)} articles from {target['url']}")

                except Exception as e:
                    logger.error(f"Error scraping {target['url']}: {e}")
                    continue

        logger.info(f"Fetched {len(articles)} articles via web scraping")
        return articles[:limit]
