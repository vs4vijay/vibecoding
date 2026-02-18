import asyncio
from datetime import datetime
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import Header, Footer, Button, Static, DataTable, Log, Input, Label
from textual.binding import Binding
from ..config import settings
from ..data import get_db_session, Repository, init_db
from ..sources import RSSNewsSource, NewsAPISource, WebScraperSource, GNewsSource
from ..core import StockSuggester
from ..utils import get_logger

logger = get_logger(__name__)


class StockSuggestionsTable(Static):
    def __init__(self):
        super().__init__()
        self.suggestions = []

    def compose(self) -> ComposeResult:
        yield DataTable()

    def on_mount(self):
        table = self.query_one(DataTable)
        table.add_columns("Rank", "Symbol", "Sentiment", "Articles", "Score")
        table.cursor_type = "row"

    def update_suggestions(self, suggestions):
        self.suggestions = suggestions
        table = self.query_one(DataTable)
        table.clear()

        for i, suggestion in enumerate(suggestions, 1):
            score_indicator = "🟢" if suggestion["avg_sentiment"] > 0.7 else "🟡" if suggestion["avg_sentiment"] > 0.6 else "🔴"
            table.add_row(
                f"#{i}",
                suggestion["stock_symbol"],
                f"{suggestion['avg_sentiment']:.2%}",
                str(suggestion["article_count"]),
                score_indicator
            )


class MarketPulseTUI(App):
    CSS = """
    Screen {
        background: $surface;
    }

    #status {
        dock: top;
        height: 3;
        background: $panel;
        padding: 1;
    }

    #main-container {
        layout: horizontal;
        height: 100%;
    }

    #left-panel {
        width: 50%;
        border: solid $primary;
        padding: 1;
    }

    #right-panel {
        width: 50%;
        border: solid $secondary;
        padding: 1;
    }

    #controls {
        dock: bottom;
        height: 8;
        background: $panel;
        layout: vertical;
        padding: 1;
    }

    Button {
        margin: 1 2;
    }

    DataTable {
        height: 100%;
    }

    #log-container {
        height: 100%;
        border: solid green;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("a", "analyze", "Analyze"),
        Binding("r", "refresh", "Refresh"),
        Binding("s", "settings", "Settings"),
    ]

    def __init__(self):
        super().__init__()
        self.suggester = StockSuggester()
        self.news_sources = [
            RSSNewsSource(),
            GNewsSource(),
            NewsAPISource(),
            WebScraperSource(),
        ]
        self.is_analyzing = False

    def compose(self) -> ComposeResult:
        yield Header()

        yield Container(
            Static(f"MarketPulse - Indian Stock Sentiment Analysis | {datetime.now().strftime('%Y-%m-%d %H:%M')}", id="status"),
            Horizontal(
                Vertical(
                    Label("📊 Stock Suggestions"),
                    StockSuggestionsTable(),
                    id="left-panel"
                ),
                Vertical(
                    Label("📋 Analysis Log"),
                    Log(id="log-container"),
                    id="right-panel"
                ),
                id="main-container"
            ),
            Horizontal(
                Button("▶️  Analyze Now", id="btn-analyze", variant="primary"),
                Button("🔄 Refresh", id="btn-refresh", variant="default"),
                Button("⚙️  Settings", id="btn-settings", variant="default"),
                Button("❌ Quit", id="btn-quit", variant="error"),
                id="controls"
            )
        )

        yield Footer()

    async def on_mount(self):
        init_db()
        log = self.query_one(Log)
        log.write_line("✅ MarketPulse TUI started")
        log.write_line(f"📡 Sentiment Provider: {settings.sentiment_provider}")
        log.write_line(f"🗃️ Database: {settings.database_url}")
        log.write_line(f"📰 Active Sources: {len([s for s in self.news_sources if s.is_configured()])}")
        log.write_line("\n💡 Press 'a' to run analysis or click 'Analyze Now'")

        await self.load_recent_suggestions()

    async def load_recent_suggestions(self):
        log = self.query_one(Log)
        try:
            with get_db_session() as session:
                repo = Repository(session)
                suggestions_db = repo.get_suggestions_for_date(
                    datetime.now(),
                    min_score=settings.min_sentiment_score,
                    limit=settings.max_suggestions
                )

                if suggestions_db:
                    suggestions = [
                        {
                            "stock_symbol": s.stock_symbol,
                            "avg_sentiment": s.avg_sentiment_score,
                            "article_count": s.article_count
                        }
                        for s in suggestions_db
                    ]

                    table = self.query_one(StockSuggestionsTable)
                    table.update_suggestions(suggestions)
                    log.write_line(f"📈 Loaded {len(suggestions)} recent suggestions")
                else:
                    log.write_line("ℹ️  No recent suggestions found. Run analysis to generate new ones.")

        except Exception as e:
            log.write_line(f"❌ Error loading suggestions: {str(e)}")
            logger.error(f"Error loading suggestions: {e}")

    async def on_button_pressed(self, event: Button.Pressed):
        if event.button.id == "btn-analyze":
            await self.action_analyze()
        elif event.button.id == "btn-refresh":
            await self.action_refresh()
        elif event.button.id == "btn-settings":
            await self.action_settings()
        elif event.button.id == "btn-quit":
            await self.action_quit()

    async def action_analyze(self):
        if self.is_analyzing:
            return

        self.is_analyzing = True
        log = self.query_one(Log)

        try:
            log.write_line("\n🔍 Starting analysis...")
            log.write_line(f"⏰ {datetime.now().strftime('%H:%M:%S')}")

            all_articles = []
            for source in self.news_sources:
                if source.is_configured():
                    log.write_line(f"📰 Fetching from {source.source_name}...")
                    articles = await source.fetch_news(
                        query="indian stocks market NSE BSE",
                        days=settings.analysis_lookback_days,
                        limit=30
                    )
                    all_articles.extend(articles)
                    log.write_line(f"   ✓ Got {len(articles)} articles")

            log.write_line(f"\n📊 Total articles: {len(all_articles)}")

            if not all_articles:
                log.write_line("❌ No articles found")
                self.is_analyzing = False
                return

            log.write_line("🧠 Analyzing sentiment...")

            suggestions = await self.suggester.generate_suggestions(
                all_articles,
                min_score=settings.min_sentiment_score,
                max_suggestions=settings.max_suggestions
            )

            if suggestions:
                table = self.query_one(StockSuggestionsTable)
                table.update_suggestions(suggestions)
                log.write_line(f"\n✅ Analysis complete! Found {len(suggestions)} suggestions")

                for i, s in enumerate(suggestions[:5], 1):
                    log.write_line(f"   {i}. {s['stock_symbol']}: {s['avg_sentiment']:.2%}")
            else:
                log.write_line("⚠️  No stocks met your criteria")

        except Exception as e:
            log.write_line(f"\n❌ Error: {str(e)}")
            logger.error(f"Analysis error: {e}")
        finally:
            self.is_analyzing = False

    async def action_refresh(self):
        log = self.query_one(Log)
        log.write_line("\n🔄 Refreshing...")
        await self.load_recent_suggestions()

    async def action_settings(self):
        log = self.query_one(Log)
        log.write_line("\n⚙️  Current Settings:")
        log.write_line(f"   • Min Sentiment: {settings.min_sentiment_score:.2f}")
        log.write_line(f"   • Max Suggestions: {settings.max_suggestions}")
        log.write_line(f"   • Lookback Days: {settings.analysis_lookback_days}")
        log.write_line(f"   • Provider: {settings.sentiment_provider}")
        log.write_line("\n💡 Edit .env file to change settings")

    async def action_quit(self):
        self.exit()


def run_tui():
    app = MarketPulseTUI()
    app.run()


def main():
    run_tui()


if __name__ == "__main__":
    main()
