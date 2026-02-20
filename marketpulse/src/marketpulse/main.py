import argparse
from .config import settings
from .data import init_db
from .utils import get_logger

logger = get_logger(__name__)


def main():
    parser = argparse.ArgumentParser(
        description="MarketPulse - Indian Stock Sentiment Analysis"
    )
    parser.add_argument(
        "--tui",
        action="store_true",
        help="Launch Terminal UI instead of Telegram bot"
    )
    args = parser.parse_args()

    init_db()
    logger.info("Database initialized")

    if args.tui:
        from .interfaces.tui import main as tui_main
        tui_main()
    else:
        from .interfaces.telegram_bot import main as bot_main
        bot_main()


if __name__ == "__main__":
    main()
