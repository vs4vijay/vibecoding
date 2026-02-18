# AlphaStreet

Indian Stock Sentiment Analysis Bot with Telegram and Terminal UI interfaces.

## Features

- **Multi-Source News Aggregation**: Fetches news from RSS feeds, NewsAPI, Google News, and web scraping
- **Advanced Sentiment Analysis**:
  - Local models (FinBERT for financial sentiment)
  - LLM APIs (OpenAI GPT, Anthropic Claude)
- **Dual Interface**:
  - Telegram Bot for mobile/desktop
  - Terminal TUI for local usage
- **Multi-User Support**:
  - Global configuration
  - Individual user preferences
  - Custom frequency and thresholds
- **Database-Agnostic**: SQLite by default, easily switch to PostgreSQL/MongoDB
- **Scheduled Analysis**: Daily, twice-daily, hourly, or weekly updates

## Installation

### Prerequisites

- Python 3.12+
- uv (Python package manager)

### Quick Start

```bash
# Clone or navigate to the alphastreet directory
cd alphastreet

# Install dependencies using uv
uv sync

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your API keys and preferences
```

## Configuration

Edit `.env` file with your settings:

```env
# Database (SQLite by default)
DATABASE_URL=sqlite:///./data/alphastreet.db

# Telegram Bot (Required for Telegram interface)
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather

# News API Keys (Optional - for additional sources)
NEWS_API_KEY=your_newsapi_key
GOOGLE_NEWS_API_KEY=your_google_api_key

# LLM API Keys (Optional - for LLM-based sentiment)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Sentiment Analysis
SENTIMENT_PROVIDER=local  # Options: local, openai, anthropic
LOCAL_MODEL_NAME=ProsusAI/finbert

# Stock Analysis
MIN_SENTIMENT_SCORE=0.6
MAX_SUGGESTIONS=10
ANALYSIS_LOOKBACK_DAYS=7

# Scheduler
DEFAULT_ANALYSIS_TIME=09:00
TIMEZONE=Asia/Kolkata
```

## Usage

### Terminal TUI

Launch the interactive terminal interface:

```bash
uv run alphastreet-tui
```

**Keyboard Shortcuts:**
- `a` - Run analysis now
- `r` - Refresh suggestions
- `s` - Show settings
- `q` - Quit

### Telegram Bot

Start the Telegram bot:

```bash
uv run alphastreet-bot
```

**Bot Commands:**
- `/start` - Register and get started
- `/analyze` - Run immediate analysis
- `/settings` - View your preferences
- `/setfrequency <daily|twice_daily|hourly|weekly>` - Set update frequency
- `/settime <HH:MM>` - Set analysis time (IST)
- `/setscore <0.0-1.0>` - Set minimum sentiment score
- `/status` - Check bot status
- `/help` - Show help message

### Command Line

Show available options:

```bash
uv run alphastreet
```

## Architecture

```
alphastreet/
├── src/alphastreet/
│   ├── config.py              # Configuration management
│   ├── main.py                # Entry point
│   ├── core/
│   │   ├── sentiment.py       # Sentiment analysis (local + LLM)
│   │   ├── stock_suggester.py # Stock suggestion engine
│   │   └── scheduler.py       # Task scheduling
│   ├── data/
│   │   ├── models.py          # SQLAlchemy models
│   │   ├── database.py        # DB connection management
│   │   └── repository.py      # Data access layer
│   ├── sources/
│   │   ├── base.py            # Base news source interface
│   │   ├── rss_feeds.py       # RSS feed aggregator
│   │   ├── newsapi.py         # NewsAPI integration
│   │   ├── scraper.py         # Web scraper
│   │   └── google_news.py     # Google News integration
│   ├── interfaces/
│   │   ├── telegram_bot.py    # Telegram bot
│   │   └── tui.py             # Terminal UI
│   └── utils/
│       └── logger.py          # Logging utilities
└── data/                      # SQLite database & logs
```

## News Sources

### Free Sources (No API Key Required)

1. **RSS Feeds** (Always enabled)
   - Economic Times
   - MoneyControl
   - Business Standard
   - Mint

2. **Google News** (Always enabled)
   - Indian stocks and market news

3. **Web Scraping** (Always enabled)
   - MoneyControl stocks section

### Optional Sources (API Key Required)

1. **NewsAPI** - Set `NEWS_API_KEY` in `.env`
   - Free tier: 100 requests/day
   - Get key: https://newsapi.org/

## Sentiment Analysis Options

### 1. Local Models (Default)

```env
SENTIMENT_PROVIDER=local
LOCAL_MODEL_NAME=ProsusAI/finbert
```

**Pros:**
- Free, unlimited
- Fast after initial model download
- Privacy-friendly

**Cons:**
- Requires ~500MB disk space
- First run downloads model
- Needs decent CPU/GPU

### 2. OpenAI

```env
SENTIMENT_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

**Pros:**
- High accuracy
- Good for complex analysis

**Cons:**
- Costs money per request
- Requires API key

### 3. Anthropic Claude

```env
SENTIMENT_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

**Pros:**
- Excellent reasoning
- Good for nuanced analysis

**Cons:**
- Costs money per request
- Requires API key

## Database Configuration

### SQLite (Default)

```env
DATABASE_URL=sqlite:///./data/alphastreet.db
```

Perfect for single-instance deployment.

### PostgreSQL

```env
DATABASE_URL=postgresql://user:password@localhost:5432/alphastreet
```

Better for production with multiple instances.

### MongoDB

```env
DATABASE_URL=mongodb://localhost:27017/alphastreet
```

Flexible schema for varying data structures.

## Troubleshooting

### Bot Not Starting

- Check `TELEGRAM_BOT_TOKEN` in `.env`
- Verify token with BotFather
- Check internet connection

### No News Articles Found

- Verify news source APIs are accessible
- Check API keys if using NewsAPI
- Ensure firewall allows HTTP requests

### Sentiment Analysis Errors

- For local models: Check disk space (~500MB needed)
- For LLM APIs: Verify API keys and credits
- Check logs in `data/alphastreet.log`

### Database Errors

- Ensure `data/` directory exists
- Check write permissions
- For PostgreSQL/MongoDB: Verify connection string

## Disclaimer

This tool is for informational purposes only. Stock suggestions are based on sentiment analysis and should not be considered financial advice. Always do your own research and consult with financial advisors before making investment decisions.

## License

MIT License

---

Built with ❤️ for Indian stock market enthusiasts
