#!/bin/bash
set -e

echo "========================================="
echo "  Syncthing Wrapped - Build Script"
echo "========================================="
echo ""

# Check if we're in the correct directory
if [ ! -f "settings.gradle" ]; then
    echo "Error: Please run this script from the project root directory"
    exit 1
fi

# Step 1: Download Syncthing binaries if not present
if [ ! -d "app/src/main/assets" ] || [ -z "$(ls -A app/src/main/assets/syncthing-* 2>/dev/null)" ]; then
    echo "Step 1: Downloading Syncthing binaries..."
    ./scripts/download-syncthing.sh
else
    echo "Step 1: Syncthing binaries already downloaded, skipping..."
fi

echo ""
echo "Step 2: Building debug APK..."
./gradlew assembleDebug

echo ""
echo "========================================="
echo "  Build Complete!"
echo "========================================="
echo ""
echo "Debug APK location:"
echo "  app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "To install on a connected device, run:"
echo "  adb install app/build/outputs/apk/debug/app-debug.apk"
echo ""
