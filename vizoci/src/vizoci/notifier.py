"""Telegram notification client."""
import httpx

from vizoci.config import TelegramConfig


class TelegramNotifier:
    def __init__(self, config: TelegramConfig):
        self.config = config

    def is_supported(self) -> bool:
        return bool(self.config.bot_api_key and self.config.user_id)

    def notify(self, message: str) -> dict:
        """Send a notification via Telegram."""
        if not self.is_supported():
            return {"ok": False, "error": "Telegram not configured"}

        url = f"https://api.telegram.org/bot{self.config.bot_api_key}/sendMessage"

        data = {
            "chat_id": self.config.user_id,
            "text": message,
            "parse_mode": "Markdown",
        }

        with httpx.Client(timeout=10.0) as client:
            response = client.post(url, data=data)

        result = response.json()
        if not result.get("ok"):
            raise Exception(f"Telegram API error: {result}")
        return result