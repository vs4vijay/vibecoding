# Stock Symbols Management

## Overview

The `fetch_stock_symbols.py` script fetches and maintains a validated list of Indian stock ticker symbols from NSE (National Stock Exchange).

## Files

- **fetch_stock_symbols.py** - Standalone script to fetch NSE stock symbols
- **stock_symbols.json** - Generated file containing valid stock symbols with metadata
- **telegram_update_commands.py** - Telegram bot command updater (separate functionality)

## Usage

### Manual Update

```bash
cd scripts
python fetch_stock_symbols.py
```

### Custom Output Location

```bash
python fetch_stock_symbols.py --output ../data/stocks.json
```

### Use Manual Fallback Only

```bash
python fetch_stock_symbols.py --manual-only
```

## Automation with Cron

Update stock symbols daily at 6 AM:

```cron
0 6 * * * cd /path/to/alphastreet/scripts && python fetch_stock_symbols.py
```

Update weekly on Sunday at 8 AM:

```cron
0 8 * * 0 cd /path/to/alphastreet/scripts && python fetch_stock_symbols.py
```

## stock_symbols.json Format

```json
{
  "last_updated": "2026-02-18T20:31:00.180278Z",
  "total_stocks": 207,
  "stocks": {
    "RELIANCE": {
      "name": "Reliance Industries Ltd",
      "exchange": "NSE",
      "symbol": "RELIANCE"
    },
    "TCS": {
      "name": "Tata Consultancy Services Ltd",
      "exchange": "NSE",
      "symbol": "TCS"
    }
  }
}
```

## How It Works

1. **Fetches from NSE API**: Retrieves F&O stocks and broader indices from NSE India
2. **Fallback**: Uses manually curated list if API fails (50+ major stocks)
3. **Validation**: Only includes legitimate NSE-listed companies
4. **Timestamp**: Records when the list was last updated

## Integration

The `StockSuggester` class automatically loads `stock_symbols.json` on initialization:

- Validates extracted stock mentions against this list
- Maps company name variations to proper ticker symbols
- Only suggests stocks that exist in the validated list

This prevents false positives like "LARSON" and "TURBO" being suggested as separate stocks.

## Troubleshooting

### Script Fails to Fetch

If the NSE API is unavailable:
- The script automatically falls back to a manually curated list
- You can force manual-only mode with `--manual-only` flag

### Stock Not Recognized

If a valid stock isn't being recognized:
1. Check if it exists in `stock_symbols.json`
2. Run `fetch_stock_symbols.py` to update the list
3. The stock may not be in NSE F&O list (manually add if needed)

### Updating Stock List

Best practices:
- Update weekly for new IPOs and delistings
- Update before earnings season for accuracy
- Check after major market events

## Manual Additions

To manually add stocks, edit the `fetch_manual_top_stocks()` function in `fetch_stock_symbols.py`:

```python
"NEWSYMBOL": {
    "name": "New Company Ltd",
    "exchange": "NSE",
    "symbol": "NEWSYMBOL"
},
```

Then run the script to regenerate the JSON file.
