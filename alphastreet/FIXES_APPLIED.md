# Fixes Applied to AlphaStreet

## Issues Fixed

### 1. User Access Control ✅
**Problem**: Bot was open to anyone who found it - no user whitelist

**Solution**: Added `ALLOWED_TELEGRAM_IDS` environment variable
- Configure in `.env` file with comma-separated Telegram user IDs
- Leave empty to allow all users (open mode)
- Get your Telegram ID from @userinfobot
- Unauthorized users see access denied message with their ID

**Example `.env` entry:**
```env
# Leave empty to allow all users
ALLOWED_TELEGRAM_IDS=

# Or restrict to specific users
ALLOWED_TELEGRAM_IDS=123456789,987654321
```

**Security features:**
- All bot commands check authorization
- Logs unauthorized access attempts
- Shows user their ID so they can request access
- Clear warning in logs when running in open mode

### 2. Telegram Bot Crash Fix ✅
**Problem**: Bot crashed on startup with async scheduler error
```
Traceback (most recent call last):
  asyncio.create_task(run_scheduler())
  # Before event loop started
```

**Solution**: Removed problematic scheduler implementation
- Removed `schedule` library dependency
- Removed `AnalysisScheduler` integration from bot
- Bot now runs cleanly with polling
- Users can still trigger analysis manually with `/analyze`

**Note**: For automated scheduling, consider using external cron jobs or systemd timers to call the analysis function.

### 3. Google News API Replacement ✅
**Problem**: User didn't want to use Google's official API

**Solution**: Completely removed GoogleNews dependency
- Removed `GoogleNews` library (unofficial scraper)
- Removed from all interfaces (Telegram bot & TUI)
- Removed from `pyproject.toml` dependencies
- Deleted `google_news.py` source file

**Current news sources (all free):**
1. **RSS Feeds** (Always active, no API key needed)
   - Economic Times
   - MoneyControl
   - Business Standard
   - Mint
   - LiveMint

2. **NewsAPI.org** (Optional, free tier: 100 requests/day)
   - Set `NEWS_API_KEY` in `.env`

3. **Web Scraping** (Always active, no API key needed)
   - Direct scraping of stock news websites

### 4. Stock Extraction Improvements ✅
**Problem**: Extracting random capitalized words (STATE, READY, UPSIDE, COUNTERS) instead of actual stocks

**Solution**: Completely rewritten stock extraction logic
- Added 100+ false positive filters
- Added known Indian company names database (50+ companies)
- Context-aware extraction (requires stock/shares/Ltd keywords)
- Support for NSE:/BSE: prefixed symbols
- Multi-word company names (Asian Paints, State Bank, etc.)
- Length and format validation

**Results:**
- ✅ Filters out: STATE, READY, UPSIDE, COUNTERS, INDUSTRIES, etc.
- ✅ Correctly extracts: RELIANCE, TCS, HDFC, TITAN, ASIANPAINTS
- ✅ Handles NSE:SBIN, BSE:TATAMOTORS formats
- ✅ Recognizes "Asian Paints shares" → ASIANPAINTS

## Configuration Changes

### New .env Variables
```env
# User Access Control (NEW)
ALLOWED_TELEGRAM_IDS=123456789,987654321

# Removed (no longer needed)
# GOOGLE_NEWS_API_KEY=
# GOOGLE_CSE_ID=
```

### Updated Dependencies
**Removed:**
- `GoogleNews>=1.6.0`
- `schedule>=1.2.0`

**Retained (core functionality):**
- `python-telegram-bot>=21.0` - Telegram integration
- `textual>=0.50.0` - Terminal UI
- `transformers>=4.30.0` - FinBERT sentiment
- `feedparser>=6.0.0` - RSS feeds
- `beautifulsoup4>=4.12.0` - Web scraping
- `newsapi-python>=0.2.7` - NewsAPI integration

## How to Use

### 1. Update Dependencies
```bash
cd alphastreet
uv sync
```

### 2. Configure Access Control
Get your Telegram user ID from [@userinfobot](https://t.me/userinfobot), then add to `.env`:
```env
ALLOWED_TELEGRAM_IDS=YOUR_USER_ID
```

### 3. Run the Bot
```bash
# Telegram Bot
uv run alphastreet-bot

# Terminal TUI
uv run alphastreet-tui
```

### 4. Verify Access Control
Check the startup logs:
```
User access control: Enabled for 1 user(s)
```

Or if open:
```
User access control: DISABLED - Bot is open to all users!
```

## Testing

### Test User Access
1. Start bot with `ALLOWED_TELEGRAM_IDS` set
2. Try accessing from unauthorized account
3. Should see: "❌ Access Denied" with user ID

### Test Stock Extraction
The following should now work correctly:
- "Reliance Industries stock gains 5%" → RELIANCE
- "TCS shares hit all-time high" → TCS
- "Asian Paints and Titan rally" → ASIANPAINTS, TITAN
- "NSE: SBIN surges" → SBIN
- "STATE government policy" → (correctly ignored)

### Test News Sources
Run analysis and verify logs show:
```
Fetched X articles from RSS Feeds
Fetched Y articles from NewsAPI (if configured)
Fetched Z articles from Web Scraper
```

## Security Recommendations

1. **Always use ALLOWED_TELEGRAM_IDS in production**
   - Prevents unauthorized API usage
   - Protects LLM API costs (if using OpenAI/Anthropic)
   - Controls database growth

2. **Monitor logs for unauthorized access**
   ```bash
   tail -f data/alphastreet.log | grep "Unauthorized"
   ```

3. **Regularly review user list**
   - Add/remove users as needed in `.env`
   - Restart bot to apply changes

## Future Enhancements

Potential improvements based on user feedback:
- [ ] Add scheduled analysis back using system cron
- [ ] Add more Indian news sources (ET Now, CNBC TV18)
- [ ] Implement user roles (admin, viewer, etc.)
- [ ] Add rate limiting per user
- [ ] Web dashboard for user management
- [ ] Webhook-based news alerts

---

All fixes tested and working as of 2026-02-18
