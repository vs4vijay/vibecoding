#!/bin/bash

echo "╔═══════════════════════════════════════╗"
echo "║   MarketPulse Quick Start Script     ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "✅ .env created! Please edit it with your API keys."
    echo ""
fi

# Install dependencies
echo "Installing dependencies with uv..."
uv sync
echo ""

# Create data directory
mkdir -p data
echo "✅ Data directory created"
echo ""

# Initialize database
echo "Initializing database..."
uv run python -c "from marketpulse.data import init_db; init_db(); print('✅ Database initialized')"
echo ""

echo "╔═══════════════════════════════════════╗"
echo "║          Setup Complete!              ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your API keys"
echo "2. Run: uv run marketpulse-tui  (for Terminal UI)"
echo "3. Run: uv run marketpulse-bot  (for Telegram Bot)"
echo ""
