@echo off
:: ═══════════════════════════════════════════════════════════
:: PTE SWT Practice Portal — LAN Server (Windows)
:: Run this on ONE office PC. All other PCs connect via browser.
:: ═══════════════════════════════════════════════════════════

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║  PTE SWT Practice Portal — LAN Server               ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    npm install
)

:: Get LAN IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LAN_IP=%%a
    goto :gotip
)
:gotip
set LAN_IP=%LAN_IP: =%

if not defined PORT set PORT=3001

echo.
echo ════════════════════════════════════════════════════════
echo   Access from THIS PC:    http://localhost:%PORT%
echo   Access from OTHER PCs:  http://%LAN_IP%:%PORT%
echo   Data stored in:         .\data\pte_data.json
echo ════════════════════════════════════════════════════════
echo.
echo 📋 Share this URL with your office:  http://%LAN_IP%:%PORT%
echo.
echo Press Ctrl+C to stop the server.
echo.

set PORT=%PORT%
node server.js

pause
