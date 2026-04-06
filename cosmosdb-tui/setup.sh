#!/bin/bash

clear
cat << "EOF"

========================================================================

                     COSMOS DB TUI - SETUP WIZARD

========================================================================

Welcome to Cosmos DB TUI! Let's get you set up.

This wizard will help you:
  1. Check if Bun is installed
  2. Install dependencies
  3. Configure your Cosmos DB connection
  4. Test the connection
  5. Launch the application

EOF

read -p "Press Enter to continue..."

echo ""
echo "[1/5] Checking Bun installation..."
if ! command -v bun &> /dev/null; then
    echo ""
    echo "ERROR: Bun is not installed!"
    echo ""
    echo "Please install Bun first:"
    echo "  curl -fsSL https://bun.sh/install | bash"
    echo ""
    echo "Or visit: https://bun.sh"
    echo ""
    exit 1
fi
echo "✓ OK: Bun is installed"
bun --version

echo ""
echo "[2/5] Installing dependencies..."
bun install
if [ $? -ne 0 ]; then
    echo "✗ ERROR: Failed to install dependencies"
    exit 1
fi
echo "✓ OK: Dependencies installed"

echo ""
echo "[3/5] Configuring Cosmos DB connection..."
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo ""
    echo "Please edit .env file with your Cosmos DB credentials:"
    echo "  COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/"
    echo "  COSMOS_KEY=your-primary-key-here"
    echo ""
    echo "Opening .env in default editor..."
    sleep 2
    ${EDITOR:-nano} .env
    echo ""
    read -p "Have you configured the .env file? (Y/n) " configured
    if [[ ! $configured =~ ^[Yy]$ ]]; then
        echo ""
        echo "Please configure .env and run this script again."
        exit 0
    fi
else
    echo "✓ OK: .env file already exists"
fi

echo ""
echo "[4/5] Testing Cosmos DB connection..."
bun run test-connection
if [ $? -ne 0 ]; then
    echo ""
    echo "⚠ WARNING: Connection test failed!"
    echo "Please check your credentials in .env"
    echo ""
    read -p "Do you want to continue anyway? (Y/n) " continue
    if [[ ! $continue =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "[5/5] Setup complete!"
echo ""
echo "========================================================================"
echo "                        READY TO LAUNCH"
echo "========================================================================"
echo ""
echo "Quick tips:"
echo "  - Press Tab to navigate between panels"
echo "  - Press ? for help"
echo "  - Press q to quit"
echo ""
echo "Starting Cosmos DB TUI in 3 seconds..."
sleep 3

bun start
