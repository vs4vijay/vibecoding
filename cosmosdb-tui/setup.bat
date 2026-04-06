@echo off
cls
echo.
echo ========================================================================
echo.
echo                      COSMOS DB TUI - SETUP WIZARD
echo.
echo ========================================================================
echo.
echo Welcome to Cosmos DB TUI! Let's get you set up.
echo.
echo This wizard will help you:
echo   1. Check if Bun is installed
echo   2. Install dependencies
echo   3. Configure your Cosmos DB connection
echo   4. Test the connection
echo   5. Launch the application
echo.
pause

echo.
echo [1/5] Checking Bun installation...
bun --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Bun is not installed!
    echo.
    echo Please install Bun first:
    echo   powershell -c "irm bun.sh/install.ps1|iex"
    echo.
    echo Or visit: https://bun.sh
    echo.
    pause
    exit /b 1
)
echo OK: Bun is installed
bun --version

echo.
echo [2/5] Installing dependencies...
call bun install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo OK: Dependencies installed

echo.
echo [3/5] Configuring Cosmos DB connection...
if not exist .env (
    echo Creating .env file from template...
    copy .env.example .env >nul
    echo.
    echo Please edit .env file with your Cosmos DB credentials:
    echo   COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/
    echo   COSMOS_KEY=your-primary-key-here
    echo.
    echo Opening .env in notepad...
    timeout /t 2 >nul
    notepad .env
    echo.
    echo Have you configured the .env file? (Y/N)
    set /p configured=
    if /i not "%configured%"=="Y" (
        echo.
        echo Please configure .env and run this script again.
        pause
        exit /b 0
    )
) else (
    echo OK: .env file already exists
)

echo.
echo [4/5] Testing Cosmos DB connection...
call bun run test-connection
if %errorlevel% neq 0 (
    echo.
    echo WARNING: Connection test failed!
    echo Please check your credentials in .env
    echo.
    echo Do you want to continue anyway? (Y/N)
    set /p continue=
    if /i not "%continue%"=="Y" (
        exit /b 1
    )
)

echo.
echo [5/5] Setup complete!
echo.
echo ========================================================================
echo                        READY TO LAUNCH
echo ========================================================================
echo.
echo Quick tips:
echo   - Press Tab to navigate between panels
echo   - Press ? for help
echo   - Press q to quit
echo.
echo Starting Cosmos DB TUI in 3 seconds...
timeout /t 3 >nul

call bun start
