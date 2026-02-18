# Utility Scripts

Standalone, reusable scripts for Telegram bot management and other tasks.

## telegram_update_commands.py

Update your Telegram bot's command list programmatically. Works with any Telegram bot!

### Features

- ✅ Standalone - no dependencies on marketpulse project
- ✅ Works with any Telegram bot token
- ✅ Multiple input methods (CLI, JSON file, environment variable, presets)
- ✅ Preset command lists for common bot types
- ✅ Can clear all commands
- ✅ Cross-project reusable

### Requirements

```bash
pip install python-telegram-bot
# or
uv add python-telegram-bot
```

### Quick Start

#### 1. Using Environment Variable (Recommended)

```bash
export TELEGRAM_BOT_TOKEN="123456:ABC-DEF1234ghIkl..."
python telegram_update_commands.py
```

#### 2. Using Command Line Token

```bash
python telegram_update_commands.py --token "123456:ABC-DEF1234ghIkl..."
```

#### 3. Using JSON File

```bash
python telegram_update_commands.py --token "token" --commands example_commands.json
```

#### 4. Using Preset Commands

```bash
# List available presets
python telegram_update_commands.py --list-presets

# Use marketpulse preset
python telegram_update_commands.py --token "token" --preset marketpulse

# Use basic preset
python telegram_update_commands.py --token "token" --preset basic
```

#### 5. Adding Commands Inline

```bash
python telegram_update_commands.py --token "token" \
  --add "start:Get started with the bot" \
  --add "help:Show help message" \
  --add "settings:Configure your preferences" \
  --add "about:About this bot"
```

#### 6. Clearing All Commands

```bash
python telegram_update_commands.py --token "token" --clear
```

### JSON File Format

Two supported formats:

**Format 1: Array of objects (recommended)**
```json
{
  "commands": [
    {
      "command": "start",
      "description": "Start the bot"
    },
    {
      "command": "help",
      "description": "Show help"
    }
  ]
}
```

**Format 2: Simple key-value**
```json
{
  "start": "Start the bot",
  "help": "Show help",
  "settings": "View settings"
}
```

### Available Presets

**basic** - Common commands for any bot:
- `/start` - Start the bot
- `/help` - Show help message
- `/settings` - View settings
- `/cancel` - Cancel current operation

**marketpulse** - Stock sentiment analysis bot:
- `/start` - Register and get started
- `/help` - Show help message
- `/analyze` - Run sentiment analysis
- `/settings` - View preferences
- `/setfrequency` - Set analysis frequency
- `/settime` - Set analysis time
- `/setscore` - Set minimum sentiment score
- `/status` - Check bot status

### Usage Examples

#### For AlphaStreet Bot

```bash
cd scripts
export TELEGRAM_BOT_TOKEN="your_token_here"
python telegram_update_commands.py --preset marketpulse
```

#### For Custom Bot

```bash
# Create your commands.json
cat > my_commands.json << EOF
{
  "start": "Welcome to my bot",
  "menu": "Show main menu",
  "order": "Place an order",
  "status": "Check order status",
  "help": "Get help"
}
EOF

# Update bot
python telegram_update_commands.py --token "token" --commands my_commands.json
```

#### For E-commerce Bot

```bash
python telegram_update_commands.py --token "token" \
  --add "start:Start shopping" \
  --add "catalog:Browse products" \
  --add "cart:View shopping cart" \
  --add "checkout:Complete purchase" \
  --add "orders:View order history" \
  --add "track:Track delivery" \
  --add "support:Contact support"
```

### Using in Other Projects

Simply copy `telegram_update_commands.py` to your project:

```bash
# Copy to your project
cp scripts/telegram_update_commands.py /path/to/your/project/

# Use it
cd /path/to/your/project/
export TELEGRAM_BOT_TOKEN="your_token"
python telegram_update_commands.py --add "start:Get started"
```

### Integration with CI/CD

```yaml
# .github/workflows/deploy-bot.yml
- name: Update Telegram Bot Commands
  env:
    TELEGRAM_BOT_TOKEN: ${{ secrets.BOT_TOKEN }}
  run: |
    python scripts/telegram_update_commands.py --preset marketpulse
```

### Troubleshooting

**Problem:** "python-telegram-bot not installed"
```bash
pip install python-telegram-bot
```

**Problem:** "Bot token not provided"
```bash
# Set environment variable
export TELEGRAM_BOT_TOKEN="your_token"
# OR use --token flag
python telegram_update_commands.py --token "your_token"
```

**Problem:** Commands not showing in Telegram
- Restart your Telegram app completely
- Clear Telegram cache (Settings → Data and Storage → Clear Cache)
- Wait 1-2 minutes for Telegram servers to update

### Security Notes

- ⚠️ Never commit bot tokens to git
- ⚠️ Always use environment variables or secure vaults
- ⚠️ Add `.env` files to `.gitignore`

### Example Workflow

```bash
# 1. Create your commands
cat > my_bot_commands.json << EOF
{
  "start": "Start using the bot",
  "help": "Get help",
  "donate": "Support the project"
}
EOF

# 2. Update bot commands
export TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
python telegram_update_commands.py --commands my_bot_commands.json

# 3. Restart Telegram app
# 4. Test bot - commands should appear in menu
```

### Contributing

This is a standalone utility script. Feel free to:
- Copy to your own projects
- Modify for your needs
- Share with others
- Add more presets

### License

MIT License - Use freely in any project
