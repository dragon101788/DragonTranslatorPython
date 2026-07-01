@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo   Dragon Translator - Build Script
echo ============================================
echo.

REM ---- Check for Python ----
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found in PATH
    exit /b 1
)

REM ---- Step 1: Build frontend ----
echo [1/3] Building frontend...
cd /d "%~dp0frontend"
if not exist "node_modules" (
    echo   Installing npm dependencies...
    call npm install
)
echo   Running Vite build...
call npx vite build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed
    exit /b 1
)
echo   Frontend build OK
echo.

REM ---- Step 2: Verify web output ----
cd /d "%~dp0"
if not exist "web\index.html" (
    echo [ERROR] web\index.html not found - frontend build may have failed
    exit /b 1
)
if not exist "web\bergamot" (
    echo [WARNING] web\bergamot not found - offline NMT translation won't work
)

REM ---- Step 3: Build with PyInstaller ----
echo [2/3] Building with PyInstaller...
pyinstaller DragonTranslator.spec
if %errorlevel% neq 0 (
    echo [ERROR] PyInstaller build failed
    exit /b 1
)
echo   PyInstaller build OK
echo.

REM ---- Step 4: Verify output ----
echo [3/3] Verifying output...
if exist "dist\DragonTranslator\龙腾翻译.exe" (
    echo   Output: dist\DragonTranslator\龙腾翻译.exe
    echo   Size:
    for %%F in ("dist\DragonTranslator\龙腾翻译.exe") do echo   %%~zF bytes
) else (
    echo [ERROR] Output exe not found
    exit /b 1
)

echo.
echo ============================================
echo   Build complete!
echo   Output: dist\DragonTranslator\
echo ============================================
echo.
echo To run: dist\DragonTranslator\龙腾翻译.exe
echo.

endlocal
