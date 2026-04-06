#!/bin/bash

# Cosmos DB TUI Launcher Script
# This script helps you quickly start the Cosmos DB TUI

echo "╔════════════════════════════════════════╗"
echo "║     Cosmos DB TUI - Quick Start        ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    echo "✅ Created .env file. Please edit it with your Cosmos DB credentials."
    echo ""
    echo "Required settings:"
    echo "  COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/"
    echo "  COSMOS_KEY=your-primary-key-here"
    echo ""
    read -p "Press Enter after configuring .env..."
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    bun install
fi

# Start the application
echo ""
echo "🚀 Starting Cosmos DB TUI..."
echo ""
bun start
