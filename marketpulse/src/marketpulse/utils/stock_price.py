from dataclasses import dataclass
from typing import Optional
import yfinance as yf
from ..utils import get_logger

logger = get_logger(__name__)


@dataclass
class StockPrice:
    symbol: str
    current_price: float
    previous_close: float
    change: float
    change_percent: float
    day_high: float
    day_low: float
    volume: int
    currency: str = "INR"


class StockPriceFetcher:
    def __init__(self):
        pass

    def get_price(self, symbol: str) -> Optional[StockPrice]:
        ticker_symbol = self._format_symbol(symbol)
        try:
            ticker = yf.Ticker(ticker_symbol)
            info = ticker.info
            
            current_price = info.get('currentPrice') or info.get('regularMarketPrice')
            previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose')
            
            if current_price is None:
                logger.warning(f"No price data found for {symbol}")
                return None

            change = current_price - previous_close if previous_close else 0
            change_percent = (change / previous_close * 100) if previous_close else 0

            return StockPrice(
                symbol=symbol.upper(),
                current_price=current_price,
                previous_close=previous_close or current_price,
                change=change,
                change_percent=change_percent,
                day_high=info.get('dayHigh', current_price),
                day_low=info.get('dayLow', current_price),
                volume=info.get('volume', 0),
                currency=info.get('currency', 'INR')
            )
        except Exception as e:
            logger.error(f"Error fetching price for {symbol}: {e}")
            return None

    def get_prices(self, symbols: list[str]) -> dict[str, StockPrice]:
        results = {}
        for symbol in symbols:
            price = self.get_price(symbol)
            if price:
                results[symbol.upper()] = price
        return results

    def _format_symbol(self, symbol: str) -> str:
        symbol = symbol.strip().upper()
        if '.' in symbol:
            return symbol
        known_tickers = {
            'TATAMOTORS': 'TATAMOTORS.NS',
            'M&M': 'M&M.NS',
            'L&TFH': 'L&TFH.NS',
        }
        if symbol in known_tickers:
            return known_tickers[symbol]
        return f"{symbol}.NS"
