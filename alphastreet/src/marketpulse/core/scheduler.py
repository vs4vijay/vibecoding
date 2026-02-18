import schedule
import asyncio
from datetime import datetime
from typing import Optional, Callable
from ..config import settings
from ..utils import get_logger

logger = get_logger(__name__)


class AnalysisScheduler:
    def __init__(self, analysis_callback: Callable):
        self.analysis_callback = analysis_callback
        self.is_running = False

    def schedule_daily_analysis(self, time_str: Optional[str] = None):
        time_str = time_str or settings.default_analysis_time
        logger.info(f"Scheduling daily analysis at {time_str} IST")

        schedule.every().day.at(time_str).do(self._run_analysis_sync)

    def schedule_custom_frequency(self, frequency: str, time_str: Optional[str] = None):
        time_str = time_str or settings.default_analysis_time

        if frequency == "daily":
            self.schedule_daily_analysis(time_str)
        elif frequency == "twice_daily":
            schedule.every().day.at("09:00").do(self._run_analysis_sync)
            schedule.every().day.at("15:30").do(self._run_analysis_sync)
        elif frequency == "hourly":
            schedule.every().hour.do(self._run_analysis_sync)
        elif frequency == "weekly":
            schedule.every().monday.at(time_str).do(self._run_analysis_sync)
        else:
            logger.warning(f"Unknown frequency: {frequency}, defaulting to daily")
            self.schedule_daily_analysis(time_str)

        logger.info(f"Scheduled analysis with frequency: {frequency}")

    def _run_analysis_sync(self):
        try:
            logger.info("Running scheduled analysis")
            asyncio.run(self.analysis_callback())
        except Exception as e:
            logger.error(f"Error in scheduled analysis: {e}")

    async def run_forever(self):
        self.is_running = True
        logger.info("Scheduler started, waiting for scheduled tasks...")

        while self.is_running:
            schedule.run_pending()
            await asyncio.sleep(60)

    def stop(self):
        self.is_running = False
        schedule.clear()
        logger.info("Scheduler stopped")

    def run_now_async(self):
        try:
            asyncio.create_task(self.analysis_callback())
        except Exception as e:
            logger.error(f"Error running immediate analysis: {e}")
