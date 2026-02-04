@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Starting TestCaseGenie Project
echo ========================================
echo.

REM Start Backend (Node.js AI endpoint) - Minimized
echo Starting Backend Server...
start "Backend-NodeJS" /MIN /D "c:\My Data\Web Development\TestCaseGenie_Final\bin\system\model\Backend" cmd /c "node server.js"

REM Start Angular Frontend - Minimized
echo Starting Angular Frontend...
start "Frontend-Angular" /MIN /D "c:\My Data\Web Development\TestCaseGenie_Final\bin\front\angular-frontend" cmd /c "npm start"

REM Start Python Backend (TestGenie-BE with virtual environment) - Minimized
echo Starting Python Backend...
start "Backend-Python" /MIN /D "c:\My Data\Web Development\TestCaseGenie_Final\bin\system\jira\TestGenie-BE" cmd /c "call venv\Scripts\activate && py -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

echo.
echo ========================================
echo All servers are starting...
echo Waiting 15 seconds for servers to initialize...
echo ========================================
echo.

REM Wait for servers to start (adjust time as needed)
timeout /t 15 /nobreak

REM Open browser
echo Opening browser at http://localhost:4200...
start http://localhost:4200

echo.
echo ========================================
echo Project started successfully!
echo ========================================
echo.
echo Servers are running in the background.
echo.
echo Press any key to STOP all servers and exit...
pause > nul

REM Kill all server processes
echo.
echo Stopping all servers...
taskkill /FI "WINDOWTITLE eq Backend-NodeJS*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend-Angular*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Backend-Python*" /T /F >nul 2>&1

echo All servers stopped.
timeout /t 2 /nobreak >nul
