@echo off
REM Diagnostic script to identify startup issues
REM Run this before the startup script to verify your system is ready

echo.
echo ========================================
echo TestCaseGenie - System Diagnostic
echo ========================================
echo.

REM Check Git
echo Checking Git...
where git >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Git is installed
    git --version
) else (
    echo [ERROR] Git is NOT installed or not in PATH
    echo Please install Git from: https://git-scm.com/download/win
)
echo.

REM Check Node.js
echo Checking Node.js...
where node >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Node.js is installed
    node --version
) else (
    echo [ERROR] Node.js is NOT installed or not in PATH
    echo Please install Node.js from: https://nodejs.org/
)
echo.

REM Check npm
echo Checking npm...
where npm >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] npm is installed
    npm --version
) else (
    echo [ERROR] npm is NOT installed or not in PATH
)
echo.

REM Check Python
echo Checking Python...
where python >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Python (python) is installed
    python --version
) else (
    where py >nul 2>&1
    if %errorlevel% equ 0 (
        echo [OK] Python (py) is installed
        py --version
    ) else (
        echo [ERROR] Python is NOT installed or not in PATH
        echo Please install Python from: https://www.python.org/
    )
)
echo.

REM Check ports
echo Checking if ports are available...
netstat -ano | findstr ":4200 " >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARNING] Port 4200 is already in use
) else (
    echo [OK] Port 4200 is available
)

netstat -ano | findstr ":8000 " >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARNING] Port 8000 is already in use
) else (
    echo [OK] Port 8000 is available
)
echo.

REM Check if folders exist
echo Checking project structure...
if exist "bin\front\angular-frontend" (
    echo [OK] Angular frontend folder found
) else (
    echo [ERROR] Angular frontend folder NOT found at bin\front\angular-frontend
)

if exist "bin\system\model\Backend" (
    echo [OK] Node.js backend folder found
) else (
    echo [ERROR] Node.js backend folder NOT found at bin\system\model\Backend
)

if exist "bin\system\jira\TestGenie-BE" (
    echo [OK] Python backend folder found
) else (
    echo [ERROR] Python backend folder NOT found at bin\system\jira\TestGenie-BE
)
echo.

echo ========================================
echo Diagnostic complete!
echo ========================================
echo.
pause
