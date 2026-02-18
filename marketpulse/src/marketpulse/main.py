import sys
import asyncio
from .config import settings
from .data import init_db
from .utils import get_logger

logger = get_logger(__name__)


def main():
    print("""
    ╔═══════════════════════════════════════╗
    ║      MarketPulse v0.1.0               ║
    ║  Indian Stock Sentiment Analysis      ║
    ╚═══════════════════════════════════════╝
    """)

    init_db()
    logger.info("Database initialized")

    print("\nAvailable interfaces:")
    print("1. Telegram Bot (marketpulse-bot)")
    print("2. Terminal TUI (marketpulse-tui)")
    print("\nOr use this CLI:")
    print("  marketpulse         - Show this menu")
    print("  marketpulse-bot     - Start Telegram bot")
    print("  marketpulse-tui     - Start Terminal UI")

    print("\n" + "="*40)
    print(f"Configuration:")
    print(f"  Database: {settings.database_url}")
    print(f"  Sentiment Provider: {settings.sentiment_provider}")
    print(f"  Lookback Days: {settings.analysis_lookback_days}")
    print(f"  Min Score: {settings.min_sentiment_score}")
    print("="*40)

    if len(sys.argv) > 1:
        command = sys.argv[1]
        if command == "bot":
            from .interfaces.telegram_bot import main as bot_main
            bot_main()
        elif command == "tui":
            from .interfaces.tui import main as tui_main
            tui_main()
        else:
            print(f"\nUnknown command: {command}")
            print("Use 'marketpulse-bot' or 'marketpulse-tui'")
    else:
        print("\n💡 Choose an interface to get started!")


if __name__ == "__main__":
    main()
