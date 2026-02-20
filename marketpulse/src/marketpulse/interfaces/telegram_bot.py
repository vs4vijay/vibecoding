import asyncio
from datetime import datetime
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)
from .. import __version__
from ..config import settings
from ..data import get_db_session, Repository, init_db
from ..sources import RSSNewsSource, NewsAPISource, WebScraperSource, GNewsSource
from ..core import StockSuggester
from ..utils import get_logger

logger = get_logger(__name__)


class TelegramBot:
    def __init__(self):
        self.token = settings.telegram_bot_token
        if not self.token:
            raise ValueError("TELEGRAM_BOT_TOKEN not configured")

        # Parse allowed user IDs
        self.allowed_user_ids = set()
        if settings.allowed_telegram_ids:
            try:
                self.allowed_user_ids = {
                    int(uid.strip())
                    for uid in settings.allowed_telegram_ids.split(",")
                    if uid.strip()
                }
                logger.info(f"Access restricted to {len(self.allowed_user_ids)} user(s)")
            except ValueError as e:
                logger.error(f"Invalid ALLOWED_TELEGRAM_IDS format: {e}")
                raise

        self.application = Application.builder().token(self.token).build()
        self.suggester = StockSuggester()
        self.news_sources = [
            RSSNewsSource(),
            GNewsSource(),
            NewsAPISource(),
            WebScraperSource(),
        ]

        self._register_handlers()

    async def _broadcast_message(self, message: str):
        """Send message to all allowed users."""
        if not self.allowed_user_ids:
            logger.warning("No allowed users to broadcast to")
            return
        
        for user_id in self.allowed_user_ids:
            try:
                await self.application.bot.send_message(
                    chat_id=user_id,
                    text=message,
                    parse_mode="Markdown"
                )
            except Exception as e:
                logger.error(f"Failed to send message to {user_id}: {e}")

    def is_user_allowed(self, user_id: int) -> bool:
        """Check if user is allowed to use the bot"""
        if not self.allowed_user_ids:
            return True
        return user_id in self.allowed_user_ids

    def _register_handlers(self):
        self.application.add_handler(CommandHandler("start", self.start_command))
        self.application.add_handler(CommandHandler("help", self.help_command))
        self.application.add_handler(CommandHandler("analyze", self.analyze_command))
        self.application.add_handler(CommandHandler("recent", self.recent_command))
        self.application.add_handler(CommandHandler("settings", self.settings_command))
        self.application.add_handler(CommandHandler("setfrequency", self.set_frequency_command))
        self.application.add_handler(CommandHandler("settime", self.set_time_command))
        self.application.add_handler(CommandHandler("setscore", self.set_score_command))
        self.application.add_handler(CommandHandler("status", self.status_command))

    async def start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        user = update.effective_user
        telegram_id = user.id

        # Check access control
        if not self.is_user_allowed(telegram_id):
            await update.message.reply_text(
                "❌ Access Denied\n\n"
                "This bot is restricted to authorized users only.\n"
                f"Your Telegram ID: {telegram_id}\n\n"
                "Please contact the bot owner for access."
            )
            logger.warning(f"Unauthorized access attempt from user {telegram_id} (@{user.username})")
            return

        with get_db_session() as session:
            repo = Repository(session)
            db_user = repo.get_or_create_user(telegram_id, user.username)

        welcome_message = f"""
 👋 Welcome to MarketPulse, {user.first_name}!

I analyze Indian stock market sentiment from multiple news sources and suggest stocks based on recent news.

Available commands:
/analyze - Run immediate analysis
/recent - Get last analysis (instant)
/settings - View your current settings
/setfrequency <daily|twice_daily|hourly|weekly> - Set analysis frequency
/settime <HH:MM> - Set analysis time (IST)
/setscore <0.0-1.0> - Set minimum sentiment score
/status - Check bot status
/help - Show this message

Your account has been created! Use /analyze to get started.
"""
        await update.message.reply_text(welcome_message)

    async def help_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not self.is_user_allowed(update.effective_user.id):
            await update.message.reply_text("❌ Access Denied")
            return

        help_text = """
📊 MarketPulse Bot Commands:

/analyze - Run sentiment analysis now and get stock suggestions
/recent - Get the most recent analysis (instant, no re-analysis)
/settings - View your current preferences
/setfrequency <frequency> - Set how often to receive updates
  • daily - Once per day (default)
  • twice_daily - Market open and close
  • hourly - Every hour
  • weekly - Once per week
/settime <HH:MM> - Set analysis time in IST (e.g., /settime 09:30)
/setscore <0.0-1.0> - Set minimum sentiment score for suggestions
/status - Check bot and analysis status

The bot analyzes news from:
• RSS feeds (MoneyControl, ET, Mint, BS)
• Google News (free scraper)
• NewsAPI (if configured)
• Web scraping

Sentiment analysis powered by FinBERT (local) with optional LLM support.
"""
        await update.message.reply_text(help_text)

    async def analyze_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        telegram_id = update.effective_user.id

        if not self.is_user_allowed(telegram_id):
            await update.message.reply_text("❌ Access Denied")
            return

        # Get user preferences before session closes
        with get_db_session() as session:
            repo = Repository(session)
            user = repo.get_or_create_user(telegram_id, update.effective_user.username)
            min_score = user.min_sentiment_score
            max_suggestions = user.max_suggestions

        # Immediately show which sources are being used
        configured_sources = [s for s in self.news_sources if s.is_configured()]
        source_list = "\n".join([f"  • {s.source_name}" for s in configured_sources])

        await update.message.reply_text(
            f"🔍 *Starting Analysis*\n\n"
            f"*Fetching from {len(configured_sources)} sources:*\n"
            f"{source_list}\n\n"
            f"_This may take 1-2 minutes..._",
            parse_mode="Markdown"
        )

        try:
            all_articles = []
            source_results = []

            for source in configured_sources:
                articles = await source.fetch_news(
                    query="indian stocks market NSE BSE",
                    days=settings.analysis_lookback_days,
                    limit=30
                )
                all_articles.extend(articles)
                source_results.append(f"  • {source.source_name}: {len(articles)} articles")
                logger.info(f"Fetched {len(articles)} from {source.source_name}")

            if not all_articles:
                await update.message.reply_text("❌ No news articles found. Please try again later.")
                return

            # Show per-source breakdown
            results_text = "\n".join(source_results)
            await update.message.reply_text(
                f"📊 *Articles Fetched:*\n"
                f"{results_text}\n\n"
                f"*Total: {len(all_articles)} articles*\n\n"
                f"_Now analyzing sentiment..._",
                parse_mode="Markdown"
            )

            suggestions = await self.suggester.generate_suggestions(
                all_articles,
                min_score=min_score,
                max_suggestions=max_suggestions
            )

            if not suggestions:
                await update.message.reply_text(
                    "No stocks met your criteria. Try lowering your minimum sentiment score with /setscore"
                )
                return

            # Build comprehensive single message
            message = f"📈 *Top {len(suggestions)} Stock Suggestions*\n"
            message += f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M IST')}\n"
            message += "━━━━━━━━━━━━━━━━━━━━\n\n"

            for i, suggestion in enumerate(suggestions, 1):
                score_emoji = "🟢" if suggestion["avg_sentiment"] > 0.7 else "🟡"

                message += f"{i}. {score_emoji} *{suggestion['stock_symbol']}*\n"
                message += f"   Sentiment: {suggestion['avg_sentiment']:.1%} | Articles: {suggestion['article_count']}\n\n"
                message += "   *📰 Why Pick This:*\n"

                # Show top 3 articles as reasons
                for idx, article in enumerate(suggestion.get("article_details", [])[:3], 1):
                    sentiment_text = "Positive" if article["sentiment_score"] > 0.6 else "Neutral"
                    message += f"   • {sentiment_text} ({article['sentiment_score']:.1%})\n"
                    message += f"     _{article['title'][:80]}{'...' if len(article['title']) > 80 else ''}_\n"
                    message += f"     {article['source']} | [Link]({article['url']})\n"

                message += "\n"

            await update.message.reply_text(
                message,
                parse_mode="Markdown",
                disable_web_page_preview=True
            )

        except Exception as e:
            logger.error(f"Error in analyze command: {e}", exc_info=True)
            await update.message.reply_text(f"❌ Error during analysis: {str(e)}")

    async def recent_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        telegram_id = update.effective_user.id

        if not self.is_user_allowed(telegram_id):
            await update.message.reply_text("❌ Access Denied")
            return

        with get_db_session() as session:
            repo = Repository(session)
            recent_suggestions = repo.get_latest_analysis_batch()

            if not recent_suggestions:
                await update.message.reply_text(
                    "No recent analysis found. Run /analyze to generate new stock suggestions."
                )
                return

            # Get the timestamp of the analysis
            analysis_time = recent_suggestions[0].created_at

            # Build comprehensive single message
            message = f"📈 *Recent Stock Analysis*\n"
            message += f"⏰ Analyzed at: {analysis_time.strftime('%Y-%m-%d %H:%M IST')}\n"
            message += f"📊 Found {len(recent_suggestions)} stocks\n"
            message += "━━━━━━━━━━━━━━━━━━━━\n\n"

            for i, suggestion in enumerate(recent_suggestions, 1):
                score_emoji = "🟢" if suggestion.avg_sentiment_score > 0.7 else "🟡"

                message += f"{i}. {score_emoji} *{suggestion.stock_symbol}*\n"
                message += f"   Sentiment: {suggestion.avg_sentiment_score:.1%} | Articles: {suggestion.article_count}\n\n"

                # Get article details from stored JSON
                article_details = suggestion.article_details or {}
                articles = article_details.get("articles", [])

                if articles:
                    message += "   *📰 Why Pick This:*\n"
                    for idx, article in enumerate(articles[:3], 1):
                        sentiment_text = "Positive" if article["sentiment_score"] > 0.6 else "Neutral"
                        message += f"   • {sentiment_text} ({article['sentiment_score']:.1%})\n"
                        message += f"     _{article['title'][:80]}{'...' if len(article['title']) > 80 else ''}_\n"
                        message += f"     {article['source']} | [Link]({article['url']})\n"

                message += "\n"

        await update.message.reply_text(
            message,
            parse_mode="Markdown",
            disable_web_page_preview=True
        )

    async def settings_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        telegram_id = update.effective_user.id

        if not self.is_user_allowed(telegram_id):
            await update.message.reply_text("❌ Access Denied")
            return

        # Get user settings before session closes
        with get_db_session() as session:
            repo = Repository(session)
            user = repo.get_or_create_user(telegram_id, update.effective_user.username)
            frequency = user.frequency
            analysis_time = user.analysis_time
            min_sentiment_score = user.min_sentiment_score
            max_suggestions = user.max_suggestions
            is_active = user.is_active

        settings_text = f"""
⚙️ Your Current Settings:

📅 Frequency: {frequency}
⏰ Analysis Time: {analysis_time} IST
📊 Min Sentiment Score: {min_sentiment_score:.2f}
🎯 Max Suggestions: {max_suggestions}
✅ Status: {"Active" if is_active else "Inactive"}

Use the set commands to update your preferences:
/setfrequency <frequency>
/settime <HH:MM>
/setscore <0.0-1.0>
"""
        await update.message.reply_text(settings_text)

    async def set_frequency_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        telegram_id = update.effective_user.id

        if not self.is_user_allowed(telegram_id):
            await update.message.reply_text("❌ Access Denied")
            return

        if not context.args:
            await update.message.reply_text(
                "Usage: /setfrequency <daily|twice_daily|hourly|weekly>"
            )
            return

        frequency = context.args[0].lower()
        valid_frequencies = ["daily", "twice_daily", "hourly", "weekly"]

        if frequency not in valid_frequencies:
            await update.message.reply_text(
                f"Invalid frequency. Choose from: {', '.join(valid_frequencies)}"
            )
            return

        with get_db_session() as session:
            repo = Repository(session)
            user = repo.get_or_create_user(telegram_id, update.effective_user.username)
            repo.update_user_preferences(user.id, frequency=frequency)

        await update.message.reply_text(f"✅ Frequency updated to: {frequency}")

    async def set_time_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        telegram_id = update.effective_user.id

        if not self.is_user_allowed(telegram_id):
            await update.message.reply_text("❌ Access Denied")
            return

        if not context.args:
            await update.message.reply_text("Usage: /settime <HH:MM> (e.g., /settime 09:30)")
            return

        time_str = context.args[0]
        try:
            datetime.strptime(time_str, "%H:%M")
        except ValueError:
            await update.message.reply_text("Invalid time format. Use HH:MM (e.g., 09:30)")
            return

        with get_db_session() as session:
            repo = Repository(session)
            user = repo.get_or_create_user(telegram_id, update.effective_user.username)
            repo.update_user_preferences(user.id, analysis_time=time_str)

        await update.message.reply_text(f"✅ Analysis time updated to: {time_str} IST")

    async def set_score_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        telegram_id = update.effective_user.id

        if not self.is_user_allowed(telegram_id):
            await update.message.reply_text("❌ Access Denied")
            return

        if not context.args:
            await update.message.reply_text("Usage: /setscore <0.0-1.0> (e.g., /setscore 0.65)")
            return

        try:
            score = float(context.args[0])
            if not 0.0 <= score <= 1.0:
                raise ValueError
        except ValueError:
            await update.message.reply_text("Invalid score. Must be between 0.0 and 1.0")
            return

        with get_db_session() as session:
            repo = Repository(session)
            user = repo.get_or_create_user(telegram_id, update.effective_user.username)
            repo.update_user_preferences(user.id, min_sentiment_score=score)

        await update.message.reply_text(f"✅ Minimum sentiment score updated to: {score:.2f}")

    async def status_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not self.is_user_allowed(update.effective_user.id):
            await update.message.reply_text("❌ Access Denied")
            return

        status_text = f"""
🤖 MarketPulse v{__version__} Status:

✅ Bot: Online
📡 Sentiment Provider: {settings.sentiment_provider}
🗃️ Database: Connected
📰 News Sources: {len([s for s in self.news_sources if s.is_configured()])} active
🔐 Access Control: {"Enabled" if self.allowed_user_ids else "Disabled (Open)"}

Configuration:
• Lookback: {settings.analysis_lookback_days} days
• Default Time: {settings.default_analysis_time} IST
• Timezone: {settings.timezone}
"""
        await update.message.reply_text(status_text)

    async def _send_startup_broadcast(self):
        if not self.allowed_user_ids:
            return
        message = f"""
*MarketPulse v{__version__} is now online!*

Bot started successfully.
Use /help for available commands.
"""
        await self._broadcast_message(message)
        logger.info("Sent startup broadcast")

    def run(self):
        init_db()
        logger.info("Starting Telegram bot...")

        if self.allowed_user_ids:
            logger.info(f"User access control: Enabled for {len(self.allowed_user_ids)} user(s)")
        else:
            logger.warning("User access control: DISABLED - Bot is open to all users!")

        import platform
        is_windows = platform.system() == "Windows"

        if not is_windows:
            try:
                import uvloop
                asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
            except ImportError:
                pass

        async def send_broadcast_and_run():
            await self._send_startup_broadcast()
            await self.application.run_polling(allowed_updates=Update.ALL_TYPES)

        try:
            if is_windows:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(self._send_startup_broadcast())
                self.application.run_polling(allowed_updates=Update.ALL_TYPES)
            else:
                asyncio.run(send_broadcast_and_run())
        except (KeyboardInterrupt, asyncio.CancelledError):
            logger.info("Bot stopped by user")

    async def _send_shutdown_broadcast(self):
        if not self.allowed_user_ids:
            return
        message = f"""
*MarketPulse v{__version__} is going offline*

Bot is shutting down. See you soon!
"""
        await self._broadcast_message(message)


def main():
    bot = TelegramBot()
    bot.run()


if __name__ == "__main__":
    main()
