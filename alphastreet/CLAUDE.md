# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AlphaStreet is an Indian stock sentiment analysis bot that fetches news from multiple sources, performs sentiment analysis using FinBERT or LLM APIs, and suggests stocks based on positive sentiment. It provides both a Telegram bot interface and a Terminal UI (TUI).

## Key Commands

### Development
```bash
# Install/sync dependencies
uv sync

# Run Telegram bot
uv run alphastreet-bot

# Run Terminal UI
uv run alphastreet-tui

# Run main CLI
uv run alphastreet
```

### Database
```bash
# Database is auto-initialized on first run
# Location: ./data/alphastreet.db (SQLite)
# To reset: rm -f data/alphastreet.db
```

## Architecture

### Multi-Layer Design

1. **Data Layer** (`src/alphastreet/data/`)
   - `models.py`: SQLAlchemy ORM models (User, NewsArticle, SentimentAnalysis, StockSuggestion)
   - `database.py`: DB connection management with context manager
   - `repository.py`: Data access layer - **ALL database operations go through Repository**
   - Design is **database-agnostic** via SQLAlchemy - can switch from SQLite to PostgreSQL/MongoDB by changing DATABASE_URL

2. **News Sources** (`src/alphastreet/sources/`)
   - All sources inherit from `NewsSource` base class
   - Each source implements `fetch_news()` and `is_configured()`
   - **Always active** (no API key): RSSNewsSource, GNewsSource (free Google News scraper), WebScraperSource
   - **Optional** (needs API key): NewsAPISource
   - When adding new sources: inherit from `NewsSource`, implement async `fetch_news()`, add to interfaces

3. **Core Logic** (`src/alphastreet/core/`)
   - `sentiment.py`: Multi-provider sentiment analysis
     - **Local**: FinBERT (ProsusAI/finbert) - downloads ~500MB on first run
     - **LLM**: OpenAI GPT or Anthropic Claude (optional, costs money)
     - Returns normalized score 0.0-1.0 where >0.5 = positive
   - `stock_suggester.py`: Stock extraction and suggestion engine
     - **Critical**: Uses KNOWN_COMPANIES set + COMMON_FALSE_POSITIVES for accurate extraction
     - Extracts stocks from news titles+content using regex patterns
     - Filters out common words (STATE, READY, UPSIDE, COUNTERS, INDUSTRIES, etc.)
     - Aggregates sentiment scores per stock across multiple articles
   - `scheduler.py`: Task scheduling (currently not integrated in bot - manual trigger only)

4. **Interfaces** (`src/alphastreet/interfaces/`)
   - `telegram_bot.py`: Telegram bot with user access control
     - **Access Control**: Set ALLOWED_TELEGRAM_IDS in .env (comma-separated user IDs)
     - Leave empty to allow all users (logs warning)
     - All commands check `is_user_allowed()` before execution
   - `tui.py`: Textual-based terminal UI
     - Keyboard shortcuts: 'a' analyze, 'r' refresh, 's' settings, 'q' quit

### Configuration Management

- Uses `pydantic-settings` for type-safe config validation
- All config in `config.py` via `Settings` class
- Environment variables loaded from `.env` file
- Key settings:
  - `ALLOWED_TELEGRAM_IDS`: User access control (empty = open to all)
  - `SENTIMENT_PROVIDER`: local/openai/anthropic
  - `MIN_SENTIMENT_SCORE`: Threshold for stock suggestions (default 0.6)

### News Fetching Flow

1. Each interface (bot/TUI) initializes list of news sources
2. Call `source.fetch_news(query, days, limit)` for each configured source
3. Sources return `List[NewsArticle]` with title, url, source, published_at, content
4. StockSuggester processes articles:
   - Extracts stock mentions from title + content
   - Stores article in DB via Repository
   - Runs sentiment analysis if not already done
   - Stores sentiment in DB
   - Aggregates sentiments per stock
   - Returns top suggestions sorted by sentiment score

### Stock Extraction Logic

**Critical for accuracy**:
- Pattern matching: NSE:/BSE: prefixes, company names with "stock/shares/Ltd"
- Known companies list: ~50 major Indian stocks (RELIANCE, TCS, HDFC, etc.)
- False positive filtering: 100+ common words filtered (STATE, READY, UPSIDE, etc.)
- Context validation: Word must appear with stock-related keywords
- When adding new stocks: Add to `KNOWN_COMPANIES` set in `stock_suggester.py`
- When seeing false positives: Add to `COMMON_FALSE_POSITIVES` set

## Important Implementation Notes

### When Adding New News Sources

1. Create new file in `sources/` inheriting from `NewsSource`
2. Implement `fetch_news()` (async) and `is_configured()` (sync)
3. Add to `sources/__init__.py` exports
4. Add to news_sources list in both `telegram_bot.py` and `tui.py`

### When Modifying Sentiment Analysis

- Score normalization: POSITIVE = 0.5 + (confidence/2), NEGATIVE = 0.5 - (confidence/2), NEUTRAL = 0.5
- Always store provider and model_name in SentimentAnalysis table for debugging
- Local model loads on first SentimentAnalyzer instantiation (can be slow)

### When Working with Database

- **Never** use raw SQL or session.query() directly in interfaces/core
- **Always** add methods to Repository for new queries
- Use `with get_db_session() as session:` for automatic commit/rollback
- Repository methods should be simple, single-purpose queries

### User Access Control

- Telegram bot: All commands must check `is_user_allowed()` first
- Get user Telegram ID from @userinfobot on Telegram
- Format in .env: `ALLOWED_TELEGRAM_IDS=123456789,987654321`
- Bot logs unauthorized attempts with user ID and username

## Environment Configuration

Required for Telegram bot:
- `TELEGRAM_BOT_TOKEN`: From @BotFather

Optional:
- `ALLOWED_TELEGRAM_IDS`: Comma-separated user IDs (empty = allow all)
- `NEWS_API_KEY`: For NewsAPI source (100 requests/day free)
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`: For LLM sentiment analysis

## Common Issues

1. **Bot crashes on startup**: Check async/scheduler issues - scheduler is currently disabled
2. **Wrong stock extraction** (STATE, READY, etc.): Add to COMMON_FALSE_POSITIVES
3. **Missing known stocks**: Add to KNOWN_COMPANIES set
4. **First run slow**: FinBERT model downloading (~500MB)
5. **Database locked**: SQLite doesn't support concurrent writes - use PostgreSQL for multi-instance

## Dependencies

- `python-telegram-bot`: Telegram bot framework (async)
- `textual`: Terminal UI framework
- `transformers` + `torch`: For FinBERT local sentiment model
- `gnews`: Free Google News scraper (no API key needed)
- `feedparser`: RSS feed parsing
- `beautifulsoup4`: Web scraping
- `sqlalchemy`: Database ORM
- `pydantic-settings`: Configuration management

## Architecture Decisions

1. **Why Repository pattern?**: Decouples data access from business logic, makes DB swapping easy
2. **Why async news fetching?**: Multiple sources fetched concurrently for speed
3. **Why both TUI and Telegram?**: TUI for local development/testing, Telegram for production use
4. **Why SQLite default?**: Zero setup, perfect for single-user/dev, easy to switch later
5. **Why FinBERT over VADER/TextBlob?**: FinBERT trained on financial text, much better for stock sentiment

## CRITICAL: File Editing on Windows

### ⚠️ MANDATORY: Always Use Backslashes on Windows for File Paths

**When using Edit or MultiEdit tools on Windows, you MUST use backslashes (`\`) in file paths, NOT forward slashes (`/`).**

#### ❌ WRONG - Will cause errors:
```
Edit(file_path: "S:/GitHub/vibecoding/alphastreet/file.py", ...)
```

#### ✅ CORRECT - Always works:
```
Edit(file_path: "S:\GitHub\vibecoding\alphastreet\file.py", ...)
```

**Note:** The codebase is on Windows at `S:\GitHub\vibecoding\alphastreet\`. Always use backslashes when editing files.
