import re
import json
from pathlib import Path
from typing import List, Dict, Set
from datetime import datetime
from collections import defaultdict
from ..data import get_db_session, Repository
from ..sources import NewsArticle
from .sentiment import SentimentAnalyzer, SentimentResult
from ..config import settings
from ..utils import get_logger

logger = get_logger(__name__)


class StockSuggester:
    _sentiment_analyzer = None

    def __init__(self):
        object.__setattr__(self, '_valid_stocks', set())
        object.__setattr__(self, 'stock_names', {})
        object.__setattr__(self, 'name_to_symbol', {})

        self._load_stock_symbols()

    @property
    def sentiment_analyzer(self):
        if StockSuggester._sentiment_analyzer is None:
            logger.info("Initializing sentiment analyzer (lazy load)...")
            StockSuggester._sentiment_analyzer = SentimentAnalyzer()
        return StockSuggester._sentiment_analyzer

    @property
    def valid_stocks(self):
        return getattr(self, '_valid_stocks', set())

    @valid_stocks.setter
    def valid_stocks(self, value):
        object.__setattr__(self, '_valid_stocks', value)

    def _load_stock_symbols(self):
        """Load valid stock symbols from JSON file."""
        # Look for stock_symbols.json in data directory
        stock_file = Path(__file__).parent.parent.parent / "data" / "stock_symbols.json"

        if not stock_file.exists():
            logger.warning(f"Stock symbols file not found: {stock_file}")
            logger.warning("Using fallback manual list. Run scripts/fetch_stock_symbols.py to generate.")
            self._use_fallback_stocks()
            return

        try:
            with open(stock_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.valid_stocks = set(data.get("stocks", {}).keys())
            self.stock_names = {
                symbol: info.get("name", symbol)
                for symbol, info in data.get("stocks", {}).items()
            }

            # Create reverse mapping: company name variations -> ticker symbol
            self.name_to_symbol = {}
            for symbol, info in data.get("stocks", {}).items():
                # Add the symbol itself
                self.name_to_symbol[symbol] = symbol

                # Add company name words
                name = info.get("name", "")
                if name:
                    # Extract key words from company name
                    words = re.findall(r'\b[A-Z][a-z]+\b', name)
                    for word in words:
                        if word.upper() not in ["LTD", "LIMITED", "COMPANY", "CORPORATION", "INDUSTRIES", "GROUP"]:
                            self.name_to_symbol[word.upper()] = symbol

            logger.info(f"Loaded {len(self.valid_stocks)} valid stock symbols from {stock_file}")
            logger.info(f"Last updated: {data.get('last_updated', 'unknown')}")

        except Exception as e:
            logger.error(f"Error loading stock symbols: {e}")
            self._use_fallback_stocks()

    def _use_fallback_stocks(self):
        """Fallback to a minimal manually curated list."""
        self.valid_stocks = {
            "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
            "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK",
            "ASIANPAINT", "MARUTI", "TATAMOTORS", "SUNPHARMA", "ULTRACEMCO",
            "TITAN", "BAJFINANCE", "NESTLEIND", "WIPRO", "HCLTECH", "TECHM",
            "POWERGRID", "NTPC", "ONGC", "TATASTEEL", "ADANIPORTS", "JSWSTEEL",
            "HINDALCO", "INDUSINDBK", "DIVISLAB", "BAJAJFINSV", "DRREDDY",
            "EICHERMOT", "CIPLA", "GODREJCP", "BPCL", "GRASIM", "COALINDIA",
            "SHREECEM", "VEDL", "TATACHEM", "TATAPOWER", "TATACONSUM",
            "ZOMATO", "PAYTM", "NYKAA", "DMART", "POLICYBZR", "DELHIVERY",
        }
        self.stock_names = {symbol: symbol for symbol in self.valid_stocks}
        self.name_to_symbol = {symbol: symbol for symbol in self.valid_stocks}
        logger.info(f"Using fallback list with {len(self.valid_stocks)} stocks")

    # Patterns to extract stock mentions with better context
    STOCK_PATTERNS = [
        # NSE/BSE explicit mentions
        r"NSE:\s*([A-Z][A-Z0-9]{1,15})\b",
        r"BSE:\s*([A-Z][A-Z0-9]{1,15})\b",
        # Company name followed by stock-related keywords
        r"\b([A-Z][A-Z0-9]{2,15})\s+(?:stock|shares|share|equity|scrip|Ltd|Limited)\b",
        r"\b(?:stock|shares|share)\s+(?:of\s+)?([A-Z][A-Z0-9]{2,15})\b",
        # Known company names
        r"\b(Reliance|TCS|Infosys|HDFC|ICICI|Tata|Adani|Wipro|HCL|Maruti|Bharti|Airtel|Bajaj|Titan|Kotak|Axis|Asian\s+Paints?|ITC|SBI|State\s+Bank|L&T|Larsen|Toubro|Sun\s+Pharma|Nestle|Tech\s+Mahindra|Ultratech|JSW|Hindalco|IndusInd|Dr\.?\s*Reddy|Eicher|Cipla|Godrej|BPCL|Vedanta|Zomato|Paytm|Nykaa|DMart|Delhivery)\b",
    ]

    # Expanded false positives - common English words that aren't stocks
    COMMON_FALSE_POSITIVES = {
        # Financial terms
        "NSE", "BSE", "IPO", "FII", "DII", "SEBI", "RBI", "GST", "GDP", "SENSEX", "NIFTY",
        "CEO", "CFO", "MD", "AGM", "EPS", "PE", "PB", "ROE", "EBITDA", "ROI", "CAGR",
        "Q1", "Q2", "Q3", "Q4", "FY", "YOY", "QOQ", "MOM", "YTD", "MTD",
        "INR", "USD", "EUR", "GBP", "US", "UK", "EU", "CN", "JP",
        "STOCK", "STOCKS", "SHARE", "SHARES", "EQUITY", "MARKET", "MARKETS",
        "TRADING", "TRADER", "INVEST", "INVESTOR", "FUND", "FUNDS",
        # Common words that might appear capitalized
        "THE", "AND", "OR", "BUT", "WITH", "FROM", "TO", "FOR", "ON", "AT", "BY",
        "IN", "OF", "AS", "IS", "WAS", "ARE", "WERE", "BE", "BEEN", "HAS", "HAVE",
        "WILL", "WOULD", "CAN", "COULD", "MAY", "MIGHT", "SHOULD", "MUST",
        "THIS", "THAT", "THESE", "THOSE", "IT", "ITS", "THEIR", "THEM",
        "SAID", "SAYS", "TOLD", "TELLS", "ADDED", "NOTED", "ANNOUNCED", "ANNOUNCED",
        "REPORT", "REPORTS", "REPORTED", "NEWS", "NEW", "LATEST", "RECENT",
        "GROWTH", "PROFIT", "REVENUE", "LOSS", "SALE", "SALES", "BUY", "SELL",
        "HIGH", "LOW", "UP", "DOWN", "RISE", "FALL", "GAIN", "GAINS", "LOST",
        "INDIA", "INDIAN", "MUMBAI", "DELHI", "BANGALORE", "BENGALURU",
        "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
        "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
        "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
        "PERCENT", "CRORE", "CRORES", "LAKH", "LAKHS", "MILLION", "BILLION",
        "RUPEE", "RUPEES", "DOLLAR", "DOLLARS", "YEAR", "MONTH", "WEEK", "DAY",
        "COMPANY", "COMPANIES", "FIRM", "FIRMS", "BUSINESS", "INDUSTRY", "INDUSTRIES",
        "STATE", "STATES", "GOVERNMENT", "CENTRAL", "FEDERAL", "NATIONAL",
        "READY", "UPSIDE", "DOWNSIDE", "COUNTER", "COUNTERS", "TOP", "BOTTOM",
        "BEST", "WORST", "BETTER", "WORSE", "GOOD", "BAD", "STRONG", "WEAK",
        "BIG", "SMALL", "LARGE", "HUGE", "MAJOR", "MINOR", "KEY", "MAIN",
        "AMID", "AMID", "AFTER", "BEFORE", "DURING", "WHILE", "SINCE",
        "LIMITED", "LTD", "CORPORATION", "CORP", "BANK", "GROUP", "HOLDINGS",
        "SERVICES", "SERVICE", "TECHNOLOGIES", "TECHNOLOGY", "SYSTEMS", "SYSTEM",
        "SOLUTIONS", "SOLUTION", "PRODUCTS", "PRODUCT", "ENTERPRISES", "ENTERPRISE",
    }

    async def generate_suggestions(
        self,
        news_articles: List[NewsArticle],
        min_score: float = None,
        max_suggestions: int = None
    ) -> List[Dict]:
        min_score = min_score or settings.min_sentiment_score
        max_suggestions = max_suggestions or settings.max_suggestions

        stock_sentiments = defaultdict(list)
        stock_articles = defaultdict(list)
        stock_article_details = defaultdict(list)  # Store full article details

        with get_db_session() as session:
            repo = Repository(session)

            for article in news_articles:
                try:
                    existing_article = repo.get_news_article_by_url(article.url)
                    if not existing_article:
                        # Extract from both title and content for better coverage
                        full_text = f"{article.title}. {article.content or ''}"
                        mentioned_stocks = self.extract_stock_mentions(full_text)

                        logger.debug(f"Extracted stocks from '{article.title[:50]}...': {mentioned_stocks}")

                        existing_article = repo.create_news_article(
                            title=article.title,
                            url=article.url,
                            source=article.source,
                            published_at=article.published_at,
                            content=article.content,
                            mentioned_stocks=",".join(mentioned_stocks) if mentioned_stocks else None
                        )

                    existing_sentiment = repo.get_sentiment_by_article_id(existing_article.id)
                    if not existing_sentiment:
                        text = f"{article.title}. {article.content or ''}"
                        sentiment = await self.sentiment_analyzer.analyze(text)

                        existing_sentiment = repo.create_sentiment_analysis(
                            news_article_id=existing_article.id,
                            sentiment_score=sentiment.score,
                            sentiment_label=sentiment.label.value,
                            confidence=sentiment.confidence,
                            provider=sentiment.provider,
                            model_name=sentiment.model_name
                        )

                    stocks = existing_article.mentioned_stocks.split(",") if existing_article.mentioned_stocks else []

                    for stock in stocks:
                        stock = stock.strip()
                        if stock:
                            stock_sentiments[stock].append(existing_sentiment.sentiment_score)
                            stock_articles[stock].append(existing_article.id)
                            # Store article details for display
                            stock_article_details[stock].append({
                                "title": existing_article.title,
                                "url": existing_article.url,
                                "source": existing_article.source,
                                "sentiment_score": existing_sentiment.sentiment_score,
                                "sentiment_label": existing_sentiment.sentiment_label
                            })

                except Exception as e:
                    logger.error(f"Error processing article {article.url}: {e}")
                    continue

            suggestions = []
            for stock_symbol, sentiment_scores in stock_sentiments.items():
                # Require at least 1 article mentioning the stock
                if len(sentiment_scores) < 1:
                    continue

                avg_score = sum(sentiment_scores) / len(sentiment_scores)

                if avg_score >= min_score:
                    # Sort articles by sentiment score (highest first)
                    article_details = sorted(
                        stock_article_details[stock_symbol],
                        key=lambda x: x["sentiment_score"],
                        reverse=True
                    )

                    suggestions.append({
                        "stock_symbol": stock_symbol,
                        "avg_sentiment": avg_score,
                        "article_count": len(sentiment_scores),
                        "related_articles": stock_articles[stock_symbol],
                        "article_details": article_details[:3]  # Top 3 articles
                    })

            suggestions.sort(key=lambda x: (x["avg_sentiment"], x["article_count"]), reverse=True)
            top_suggestions = suggestions[:max_suggestions]

            for suggestion in top_suggestions:
                try:
                    repo.create_stock_suggestion(
                        stock_symbol=suggestion["stock_symbol"],
                        stock_name=suggestion["stock_symbol"],
                        avg_sentiment_score=suggestion["avg_sentiment"],
                        article_count=suggestion["article_count"],
                        related_news_ids=",".join(map(str, suggestion["related_articles"])),
                        article_details={"articles": suggestion.get("article_details", [])},
                        suggested_for_date=datetime.utcnow()
                    )
                except Exception as e:
                    logger.error(f"Error saving suggestion: {e}")

            logger.info(f"Generated {len(top_suggestions)} stock suggestions")
            return top_suggestions

    def extract_stock_mentions(self, text: str) -> Set[str]:
        """Extract stock mentions and validate against known ticker symbols."""
        mentioned_stocks = set()
        potential_matches = set()

        # Extract using patterns
        for pattern in self.STOCK_PATTERNS:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                stock = match.upper().strip().replace(" ", "")

                # Validation checks
                if not stock or len(stock) < 2:
                    continue

                # Skip false positives
                if stock in self.COMMON_FALSE_POSITIVES:
                    continue

                # Skip if it's all numbers
                if stock.isdigit():
                    continue

                # Skip if too long (likely not a stock symbol)
                if len(stock) > 20:
                    continue

                potential_matches.add(stock)

        # Validate against known symbols
        for stock in potential_matches:
            # Direct match with valid ticker
            if stock in self.valid_stocks:
                mentioned_stocks.add(stock)
                continue

            # Try to map company name to ticker
            if stock in self.name_to_symbol:
                ticker = self.name_to_symbol[stock]
                mentioned_stocks.add(ticker)
                continue

            # Check if it appears with stock-related context
            stock_context_pattern = rf"\b{re.escape(stock)}\b.*?\b(?:stock|share|equity|Ltd|Limited|scrip)\b"
            if re.search(stock_context_pattern, text, re.IGNORECASE):
                # Still validate it's a known symbol
                if stock in self.valid_stocks:
                    mentioned_stocks.add(stock)

        return mentioned_stocks
