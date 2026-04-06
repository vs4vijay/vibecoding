@echo off
REM Cosmos DB TUI Launcher Script for Windows
REM This script helps you quickly start the Cosmos DB TUI

echo ========================================
echo      Cosmos DB TUI - Quick Start
echo ========================================
echo.

REM Check if .env exists
if not exist .env (
    echo WARNING: No .env file found. Creating from template...
    copy .env.example .env
    echo Created .env file. Please edit it with your Cosmos DB credentials.
    echo.
    echo Required settings:
    echo   COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/
    echo   COSMOS_KEY=your-primary-key-here
    echo.
    pause
)

REM Check if node_modules exists
if not exist node_modules (
    echo Installing dependencies...
    call bun install
)

REM Start the application
echo.
echo Starting Cosmos DB TUI...
echo.
call bun start
