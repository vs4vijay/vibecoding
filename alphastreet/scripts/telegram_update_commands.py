#!/usr/bin/env python3
"""
Standalone utility to update Telegram bot commands.
Can be used for any Telegram bot project.

Usage:
    # Using environment variable
    export TELEGRAM_BOT_TOKEN="your_bot_token_here"
    python telegram_update_commands.py

    # Using command line argument
    python telegram_update_commands.py --token "your_bot_token_here"

    # Using custom commands from JSON file
    python telegram_update_commands.py --token "token" --commands commands.json

    # Inline commands
    python telegram_update_commands.py --token "token" --add "start:Get started" --add "help:Show help"
"""

import asyncio
import sys
import os
import json
import argparse
from typing import List, Tuple


async def update_bot_commands(token: str, commands: List[Tuple[str, str]]):
    """
    Update Telegram bot commands.

    Args:
        token: Telegram bot token
        commands: List of (command, description) tuples
    """
    try:
        # Import here so script works without telegram package initially
        from telegram import BotCommand
        from telegram.ext import Application
    except ImportError:
        print("ERROR: python-telegram-bot not installed!")
        print("Install with: pip install python-telegram-bot")
        sys.exit(1)

    if not token:
        print("ERROR: Bot token not provided!")
        print("Set TELEGRAM_BOT_TOKEN environment variable or use --token")
        sys.exit(1)

    # Convert to BotCommand objects
    bot_commands = [BotCommand(cmd, desc) for cmd, desc in commands]

    # Create application
    app = Application.builder().token(token).build()

    try:
        print(f"Updating commands for bot (token: {token[:20]}...)")
        print(f"Total commands: {len(bot_commands)}")
        print()

        # Update commands
        await app.bot.set_my_commands(bot_commands)

        print("[SUCCESS] Commands updated on Telegram!")
        print()
        print("Registered commands:")
        for cmd in bot_commands:
            print(f"  /{cmd.command:20} - {cmd.description}")
        print()
        print("[TIP] Restart your Telegram app to see the updated commands")
        print()

    except Exception as e:
        print(f"[ERROR] Failed to update commands: {e}")
        sys.exit(1)


def load_commands_from_json(filepath: str) -> List[Tuple[str, str]]:
    """Load commands from JSON file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Support two formats:
        # 1. {"commands": [{"command": "start", "description": "..."}]}
        # 2. {"start": "Get started", "help": "Show help"}

        if "commands" in data:
            return [(cmd["command"], cmd["description"]) for cmd in data["commands"]]
        else:
            return [(cmd, desc) for cmd, desc in data.items()]
    except Exception as e:
        print(f"[ERROR] Failed to load commands from {filepath}: {e}")
        sys.exit(1)


# Default commands for common bot types
DEFAULT_COMMANDS = {
    "basic": [
        ("start", "Start the bot"),
        ("help", "Show help message"),
        ("settings", "View settings"),
        ("cancel", "Cancel current operation"),
    ],
    "alphastreet": [
        ("start", "Register and get started"),
        ("help", "Show help message"),
        ("analyze", "Run sentiment analysis and get stock suggestions"),
        ("recent", "Get the most recent analysis instantly"),
        ("settings", "View your current preferences"),
        ("setfrequency", "Set analysis frequency (daily/twice_daily/hourly/weekly)"),
        ("settime", "Set analysis time in IST (HH:MM format)"),
        ("setscore", "Set minimum sentiment score (0.0-1.0)"),
        ("status", "Check bot status and configuration"),
    ],
}


def main():
    parser = argparse.ArgumentParser(
        description="Update Telegram bot commands",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Use environment variable for token
  export TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
  python telegram_update_commands.py

  # Use command line token
  python telegram_update_commands.py --token "123456:ABC-DEF..."

  # Load commands from JSON file
  python telegram_update_commands.py --token "token" --commands commands.json

  # Add commands inline
  python telegram_update_commands.py --token "token" \\
    --add "start:Get started" \\
    --add "help:Show help" \\
    --add "settings:View settings"

  # Use preset commands
  python telegram_update_commands.py --token "token" --preset alphastreet

  # Clear all commands
  python telegram_update_commands.py --token "token" --clear

JSON file format:
  {
    "commands": [
      {"command": "start", "description": "Get started"},
      {"command": "help", "description": "Show help"}
    ]
  }

  OR simply:

  {
    "start": "Get started",
    "help": "Show help"
  }
        """
    )

    parser.add_argument(
        "--token",
        help="Telegram bot token (or set TELEGRAM_BOT_TOKEN env var)",
        default=os.environ.get("TELEGRAM_BOT_TOKEN", "")
    )

    parser.add_argument(
        "--commands", "-c",
        help="JSON file with commands",
        metavar="FILE"
    )

    parser.add_argument(
        "--add", "-a",
        action="append",
        help="Add command (format: 'command:description')",
        metavar="CMD:DESC"
    )

    parser.add_argument(
        "--preset", "-p",
        choices=list(DEFAULT_COMMANDS.keys()),
        help="Use preset command list"
    )

    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear all bot commands"
    )

    parser.add_argument(
        "--list-presets",
        action="store_true",
        help="List available presets"
    )

    args = parser.parse_args()

    # List presets
    if args.list_presets:
        print("Available presets:")
        for name, cmds in DEFAULT_COMMANDS.items():
            print(f"\n{name}:")
            for cmd, desc in cmds:
                print(f"  /{cmd:15} - {desc}")
        sys.exit(0)

    # Determine command list
    commands = []

    if args.clear:
        # Empty command list to clear
        pass
    elif args.preset:
        commands = DEFAULT_COMMANDS[args.preset]
    elif args.commands:
        commands = load_commands_from_json(args.commands)
    elif args.add:
        for cmd_str in args.add:
            if ":" not in cmd_str:
                print(f"[ERROR] Invalid command format: {cmd_str}")
                print("Use format: command:description")
                sys.exit(1)
            cmd, desc = cmd_str.split(":", 1)
            commands.append((cmd.strip(), desc.strip()))
    else:
        # Default: use alphastreet commands
        print("[INFO] No commands specified, using 'alphastreet' preset")
        print("      Use --help to see other options")
        print()
        commands = DEFAULT_COMMANDS["alphastreet"]

    # Run update
    asyncio.run(update_bot_commands(args.token, commands))


if __name__ == "__main__":
    main()
