#!/bin/bash

# ESP32 Wireless Android Auto Dongle - Build Script
# This script builds the ESP-IDF project and provides helpful status information

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}ESP32 Wireless Android Auto Dongle - Build Script${NC}"
echo "=================================================="

# Check if ESP-IDF environment is set up
if [ -z "$IDF_PATH" ]; then
    echo -e "${RED}Error: ESP-IDF environment not set up${NC}"
    echo "Please run:"
    echo "  source /path/to/esp-idf/export.sh"
    exit 1
fi

echo -e "${GREEN}ESP-IDF Path: $IDF_PATH${NC}"
echo -e "${GREEN}ESP-IDF Version: $(idf.py --version)${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "CMakeLists.txt" ]; then
    echo -e "${RED}Error: Not in ESP-IDF project directory${NC}"
    echo "Please run this script from the esp32_wireless_dongle directory"
    exit 1
fi

# Clean previous builds if requested
if [ "$1" = "clean" ]; then
    echo -e "${YELLOW}Cleaning previous build...${NC}"
    idf.py fullclean
    echo ""
fi

# Configure the project for ESP32-S3
echo -e "${BLUE}Configuring project for ESP32-S3...${NC}"
idf.py menuconfig --no-splash
echo ""

# Build the project
echo -e "${BLUE}Building project...${NC}"
idf.py build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Build successful!${NC}"
    echo ""
    
    # Show build artifacts
    echo -e "${BLUE}Build artifacts:${NC}"
    echo "Binary: build/esp32_wireless_dongle.bin"
    echo "Partition Table: build/partition-table/partition-table.bin"
    echo "Bootloader: build/bootloader/bootloader.bin"
    echo ""
    
    # Flash instructions
    echo -e "${BLUE}To flash to ESP32-S3:${NC}"
    echo "1. Connect ESP32-S3 to your computer"
    echo "2. Put the device in download mode (if required)"
    echo "3. Run: idf.py -p PORT flash monitor"
    echo ""
    echo -e "${GREEN}Build completed successfully!${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi