@echo off
chcp 65001 >nul
echo ============================================
echo   Dragon Translator
echo ============================================

REM ---- Build frontend ----
echo [1/2] Building frontend...
cd /d "%~dp0src\frontend"
if not exist "node_modules" (
    echo   Installing npm dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        exit /b 1
    )
)
call npx vite build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed
    exit /b 1
)
echo   Frontend build OK

REM ---- Run app ----
echo [2/2] Starting app...
cd /d "%~dp0"
python -m src
