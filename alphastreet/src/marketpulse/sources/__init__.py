from .base import NewsSource, NewsArticle
from .rss_feeds import RSSNewsSource
from .newsapi import NewsAPISource
from .scraper import WebScraperSource
from .gnews_source import GNewsSource

__all__ = [
    "NewsSource",
    "NewsArticle",
    "RSSNewsSource",
    "NewsAPISource",
    "WebScraperSource",
    "GNewsSource",
]
