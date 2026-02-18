# Quick Usage Guide

## For MarketPulse Project

If you need to update the bot commands for MarketPulse:

```bash
cd scripts

# Option 1: Use environment variable
export TELEGRAM_BOT_TOKEN="your_token"
python telegram_update_commands.py --preset marketpulse

# Option 2: Direct token
python telegram_update_commands.py --token "your_token" --preset marketpulse
```

## For Other Projects

Copy the script to your project:

```bash
cp telegram_update_commands.py /path/to/your/project/
```

Then use it standalone:

```bash
# Method 1: Inline commands
python telegram_update_commands.py --token "token" \
  --add "start:Welcome message" \
  --add "menu:Show menu" \
  --add "help:Get help"

# Method 2: JSON file
python telegram_update_commands.py --token "token" --commands commands.json

# Method 3: Use basic preset
python telegram_update_commands.py --token "token" --preset basic
```

## See Full Documentation

Read `README.md` in this directory for complete documentation including:
- All usage examples
- JSON file formats
- Preset commands
- CI/CD integration
- Troubleshooting tips
