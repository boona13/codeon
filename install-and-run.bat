@echo off
REM AI Code Agent Editor - Installation and Launch Script for Windows

echo.
echo ========================================
echo AI Code Agent Editor - Setup
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js v22.14.0 or higher from https://nodejs.org
    pause
    exit /b 1
)

echo [OK] Node.js detected:
node -v
echo [OK] npm detected:
npm -v
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo [INFO] Installing dependencies...
    echo This may take a few minutes...
    echo.
    call npm install

    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Installation failed!
        pause
        exit /b 1
    )

    echo.
    echo [OK] Dependencies installed successfully!
) else (
    echo [OK] Dependencies already installed
)

echo.
echo ========================================
echo Setup complete! Starting application...
echo ========================================
echo.

REM Launch the application
npm start

