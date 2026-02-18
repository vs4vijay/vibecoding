#!/usr/bin/env python3
"""
Standalone script to fetch and update Indian stock symbols (NSE/BSE).
Can be run manually or via cron to keep the stock list up-to-date.

Usage:
    python fetch_stock_symbols.py
    python fetch_stock_symbols.py --output custom_stocks.json
"""

import json
import argparse
from datetime import datetime
from pathlib import Path
import sys

# Try importing requests
try:
    import requests
except ImportError:
    print("ERROR: 'requests' library not installed!")
    print("Install with: pip install requests")
    sys.exit(1)


def fetch_nse_stocks():
    """Fetch NSE stock symbols from NSE India API."""
    stocks = {}

    try:
        # NSE India equity list
        url = "https://www.nseindia.com/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
        }

        # Get session cookies first
        session = requests.Session()
        session.get("https://www.nseindia.com", headers=headers, timeout=10)

        # Fetch the stock list
        response = session.get(url, headers=headers, timeout=10)

        if response.status_code == 200:
            data = response.json()
            if 'data' in data:
                for stock in data['data']:
                    symbol = stock.get('symbol', '').strip()
                    name = stock.get('meta', {}).get('companyName') or stock.get('symbol', '')
                    if symbol and symbol not in ['NIFTY', 'BANKNIFTY']:
                        stocks[symbol] = {
                            "name": name,
                            "exchange": "NSE",
                            "symbol": symbol
                        }
                print(f"[INFO] Fetched {len(stocks)} stocks from NSE F&O list")

        # Try to get broader list from equity list
        try:
            broad_url = "https://www.nseindia.com/api/allIndices"
            response = session.get(broad_url, headers=headers, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if 'data' in data:
                    for stock in data['data']:
                        symbol = stock.get('symbol', '').strip()
                        if symbol and symbol not in stocks and symbol not in ['NIFTY', 'BANKNIFTY']:
                            stocks[symbol] = {
                                "name": stock.get('symbol', ''),
                                "exchange": "NSE",
                                "symbol": symbol
                            }
                    print(f"[INFO] Total NSE stocks: {len(stocks)}")
        except Exception as e:
            print(f"[WARN] Could not fetch broader NSE list: {e}")

    except Exception as e:
        print(f"[ERROR] Failed to fetch NSE stocks: {e}")

    return stocks


def fetch_manual_top_stocks():
    """Fallback: Return manually curated list of top Indian stocks."""
    return {
        # Nifty 50 major stocks
        "RELIANCE": {"name": "Reliance Industries Ltd", "exchange": "NSE", "symbol": "RELIANCE"},
        "TCS": {"name": "Tata Consultancy Services Ltd", "exchange": "NSE", "symbol": "TCS"},
        "HDFCBANK": {"name": "HDFC Bank Ltd", "exchange": "NSE", "symbol": "HDFCBANK"},
        "INFY": {"name": "Infosys Ltd", "exchange": "NSE", "symbol": "INFY"},
        "ICICIBANK": {"name": "ICICI Bank Ltd", "exchange": "NSE", "symbol": "ICICIBANK"},
        "HINDUNILVR": {"name": "Hindustan Unilever Ltd", "exchange": "NSE", "symbol": "HINDUNILVR"},
        "ITC": {"name": "ITC Ltd", "exchange": "NSE", "symbol": "ITC"},
        "SBIN": {"name": "State Bank of India", "exchange": "NSE", "symbol": "SBIN"},
        "BHARTIARTL": {"name": "Bharti Airtel Ltd", "exchange": "NSE", "symbol": "BHARTIARTL"},
        "KOTAKBANK": {"name": "Kotak Mahindra Bank Ltd", "exchange": "NSE", "symbol": "KOTAKBANK"},
        "LT": {"name": "Larsen & Toubro Ltd", "exchange": "NSE", "symbol": "LT"},
        "AXISBANK": {"name": "Axis Bank Ltd", "exchange": "NSE", "symbol": "AXISBANK"},
        "ASIANPAINT": {"name": "Asian Paints Ltd", "exchange": "NSE", "symbol": "ASIANPAINT"},
        "MARUTI": {"name": "Maruti Suzuki India Ltd", "exchange": "NSE", "symbol": "MARUTI"},
        "TATAMOTORS": {"name": "Tata Motors Ltd", "exchange": "NSE", "symbol": "TATAMOTORS"},
        "SUNPHARMA": {"name": "Sun Pharmaceutical Industries Ltd", "exchange": "NSE", "symbol": "SUNPHARMA"},
        "ULTRACEMCO": {"name": "UltraTech Cement Ltd", "exchange": "NSE", "symbol": "ULTRACEMCO"},
        "TITAN": {"name": "Titan Company Ltd", "exchange": "NSE", "symbol": "TITAN"},
        "BAJFINANCE": {"name": "Bajaj Finance Ltd", "exchange": "NSE", "symbol": "BAJFINANCE"},
        "NESTLEIND": {"name": "Nestle India Ltd", "exchange": "NSE", "symbol": "NESTLEIND"},
        "WIPRO": {"name": "Wipro Ltd", "exchange": "NSE", "symbol": "WIPRO"},
        "HCLTECH": {"name": "HCL Technologies Ltd", "exchange": "NSE", "symbol": "HCLTECH"},
        "TECHM": {"name": "Tech Mahindra Ltd", "exchange": "NSE", "symbol": "TECHM"},
        "POWERGRID": {"name": "Power Grid Corporation of India Ltd", "exchange": "NSE", "symbol": "POWERGRID"},
        "NTPC": {"name": "NTPC Ltd", "exchange": "NSE", "symbol": "NTPC"},
        "ONGC": {"name": "Oil & Natural Gas Corporation Ltd", "exchange": "NSE", "symbol": "ONGC"},
        "TATASTEEL": {"name": "Tata Steel Ltd", "exchange": "NSE", "symbol": "TATASTEEL"},
        "ADANIPORTS": {"name": "Adani Ports and Special Economic Zone Ltd", "exchange": "NSE", "symbol": "ADANIPORTS"},
        "ADANIENT": {"name": "Adani Enterprises Ltd", "exchange": "NSE", "symbol": "ADANIENT"},
        "ADANIGREEN": {"name": "Adani Green Energy Ltd", "exchange": "NSE", "symbol": "ADANIGREEN"},
        "JSWSTEEL": {"name": "JSW Steel Ltd", "exchange": "NSE", "symbol": "JSWSTEEL"},
        "HINDALCO": {"name": "Hindalco Industries Ltd", "exchange": "NSE", "symbol": "HINDALCO"},
        "INDUSINDBK": {"name": "IndusInd Bank Ltd", "exchange": "NSE", "symbol": "INDUSINDBK"},
        "DIVISLAB": {"name": "Divi's Laboratories Ltd", "exchange": "NSE", "symbol": "DIVISLAB"},
        "BAJAJFINSV": {"name": "Bajaj Finserv Ltd", "exchange": "NSE", "symbol": "BAJAJFINSV"},
        "DRREDDY": {"name": "Dr. Reddy's Laboratories Ltd", "exchange": "NSE", "symbol": "DRREDDY"},
        "EICHERMOT": {"name": "Eicher Motors Ltd", "exchange": "NSE", "symbol": "EICHERMOT"},
        "CIPLA": {"name": "Cipla Ltd", "exchange": "NSE", "symbol": "CIPLA"},
        "GODREJCP": {"name": "Godrej Consumer Products Ltd", "exchange": "NSE", "symbol": "GODREJCP"},
        "BPCL": {"name": "Bharat Petroleum Corporation Ltd", "exchange": "NSE", "symbol": "BPCL"},
        "GRASIM": {"name": "Grasim Industries Ltd", "exchange": "NSE", "symbol": "GRASIM"},
        "COALINDIA": {"name": "Coal India Ltd", "exchange": "NSE", "symbol": "COALINDIA"},
        "SHREECEM": {"name": "Shree Cement Ltd", "exchange": "NSE", "symbol": "SHREECEM"},
        "VEDL": {"name": "Vedanta Ltd", "exchange": "NSE", "symbol": "VEDL"},
        "TATACHEM": {"name": "Tata Chemicals Ltd", "exchange": "NSE", "symbol": "TATACHEM"},
        "TATAPOWER": {"name": "Tata Power Company Ltd", "exchange": "NSE", "symbol": "TATAPOWER"},
        "TATACONSUM": {"name": "Tata Consumer Products Ltd", "exchange": "NSE", "symbol": "TATACONSUM"},

        # Popular new-age stocks
        "ZOMATO": {"name": "Zomato Ltd", "exchange": "NSE", "symbol": "ZOMATO"},
        "PAYTM": {"name": "One97 Communications Ltd", "exchange": "NSE", "symbol": "PAYTM"},
        "NYKAA": {"name": "FSN E-Commerce Ventures Ltd", "exchange": "NSE", "symbol": "NYKAA"},
        "DMART": {"name": "Avenue Supermarts Ltd", "exchange": "NSE", "symbol": "DMART"},
        "POLICYBZR": {"name": "PB Fintech Ltd", "exchange": "NSE", "symbol": "POLICYBZR"},
        "DELHIVERY": {"name": "Delhivery Ltd", "exchange": "NSE", "symbol": "DELHIVERY"},
    }


def save_stock_symbols(stocks, output_file):
    """Save stock symbols to JSON file with timestamp."""
    data = {
        "last_updated": datetime.utcnow().isoformat() + "Z",
        "total_stocks": len(stocks),
        "stocks": stocks
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\n[SUCCESS] Saved {len(stocks)} stock symbols to {output_file}")
    print(f"[INFO] Last updated: {data['last_updated']}")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch and update Indian stock symbols (NSE/BSE)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Fetch and save to default location
  python fetch_stock_symbols.py

  # Save to custom location
  python fetch_stock_symbols.py --output ../data/stocks.json

  # Use manual fallback list only
  python fetch_stock_symbols.py --manual-only

Cron example (update daily at 6 AM):
  0 6 * * * cd /path/to/alphastreet/scripts && python fetch_stock_symbols.py
        """
    )

    parser.add_argument(
        '--output', '-o',
        default='../data/stock_symbols.json',
        help='Output JSON file path (default: ../data/stock_symbols.json)'
    )

    parser.add_argument(
        '--manual-only',
        action='store_true',
        help='Use only manual curated list (no API calls)'
    )

    args = parser.parse_args()

    print("="*60)
    print("Indian Stock Symbols Fetcher")
    print("="*60)

    # Resolve output path
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = Path(__file__).parent / output_path

    print(f"\n[INFO] Output file: {output_path}")

    # Fetch stocks
    if args.manual_only:
        print("\n[INFO] Using manual curated list only")
        stocks = fetch_manual_top_stocks()
    else:
        print("\n[INFO] Fetching stocks from NSE...")
        stocks = fetch_nse_stocks()

        # If API fetch failed or returned too few, use manual fallback
        if len(stocks) < 50:
            print(f"\n[WARN] Only {len(stocks)} stocks fetched from API")
            print("[INFO] Using manual curated list as fallback")
            manual_stocks = fetch_manual_top_stocks()
            stocks.update(manual_stocks)

    # Save to file
    if stocks:
        save_stock_symbols(stocks, output_path)
    else:
        print("\n[ERROR] No stocks fetched!")
        sys.exit(1)


if __name__ == "__main__":
    main()
