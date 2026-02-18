from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional


@dataclass
class NewsArticle:
    title: str
    url: str
    source: str
    published_at: datetime
    content: Optional[str] = None
    mentioned_stocks: Optional[List[str]] = None


class NewsSource(ABC):
    def __init__(self, source_name: str):
        self.source_name = source_name

    @abstractmethod
    async def fetch_news(
        self,
        query: str = "indian stocks",
        days: int = 7,
        limit: int = 50
    ) -> List[NewsArticle]:
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        pass
