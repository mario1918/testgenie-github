@echo off
echo ============================================
echo TestCaseGenie - FORCE FRESH START
echo ============================================
echo.
echo This will completely clean everything and force
echo a fresh build from your current code.
echo.
pause
echo.

set PROJECT_PATH=%~dp0
set LOG_FILE=%PROJECT_PATH%startup.log

echo %date% %time% - ========== Force Fresh Start ========== >> "%LOG_FILE%"

echo [1/6] Killing ALL TestCaseGenie processes...
echo %date% %time% - Killing all TestCaseGenie processes... >> "%LOG_FILE%"
echo.

REM Kill all Node.js processes from this project
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2^>nul | find /I "%PROJECT_PATH%" >nul
    if not errorlevel 1 (
        echo   Killing Node.js PID %%a
        echo %date% %time% - Killed Node.js PID %%a >> "%LOG_FILE%"
        taskkill /F /PID %%a >nul 2>nul
    )
)

REM Kill all Python processes from this project
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq python.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2^>nul | find /I "%PROJECT_PATH%" >nul
    if not errorlevel 1 (
        echo   Killing Python PID %%a
        echo %date% %time% - Killed Python PID %%a >> "%LOG_FILE%"
        taskkill /F /PID %%a >nul 2>nul
    )
)

for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq py.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2^>nul | find /I "%PROJECT_PATH%" >nul
    if not errorlevel 1 (
        echo   Killing Python PID %%a
        echo %date% %time% - Killed Python PID %%a >> "%LOG_FILE%"
        taskkill /F /PID %%a >nul 2>nul
    )
)

timeout /t 3 /nobreak >nul

echo.
echo [2/6] Deleting Angular cache...
echo %date% %time% - Deleting Angular cache... >> "%LOG_FILE%"
echo.

if exist "%~dp0bin\front\angular-frontend\.angular" (
    echo   Removing .angular folder...
    echo %date% %time% - Removed .angular folder >> "%LOG_FILE%"
    rmdir /s /q "%~dp0bin\front\angular-frontend\.angular" 2>nul
)

if exist "%~dp0bin\front\angular-frontend\node_modules\.cache" (
    echo   Removing node_modules\.cache...
    echo %date% %time% - Removed node_modules\.cache >> "%LOG_FILE%"
    rmdir /s /q "%~dp0bin\front\angular-frontend\node_modules\.cache" 2>nul
)

echo.
echo [3/6] Deleting Angular dist folder...
echo %date% %time% - Deleting Angular dist folder... >> "%LOG_FILE%"
echo.

if exist "%~dp0bin\front\angular-frontend\dist" (
    echo   Removing dist folder...
    echo %date% %time% - Removed dist folder >> "%LOG_FILE%"
    rmdir /s /q "%~dp0bin\front\angular-frontend\dist" 2>nul
)

echo.
echo [4/6] Clearing browser cache instructions...
echo.
echo IMPORTANT: After starting the app, you MUST:
echo   - Close the browser completely
echo   - Open Task Manager and end all Chrome/Edge processes
echo   - Then reopen the browser and navigate to localhost:4200
echo.
pause

echo.
echo [5/6] Reinstalling all dependencies...
echo %date% %time% - Reinstalling all dependencies... >> "%LOG_FILE%"
echo.
echo Installing Angular frontend dependencies...
echo %date% %time% - Installing Angular frontend dependencies... >> "%LOG_FILE%"
cd /d "%~dp0bin\front\angular-frontend"
call npm install >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Angular npm install failed!
    echo %date% %time% - ERROR: Angular npm install failed with exit code %errorlevel% >> "%LOG_FILE%"
    pause
    exit /b 1
)
echo %date% %time% - Angular npm install successful >> "%LOG_FILE%"
echo.
echo Installing Node.js backend dependencies...
echo %date% %time% - Installing Node.js backend dependencies... >> "%LOG_FILE%"
cd /d "%~dp0bin\system\model\Backend"
call npm install >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js backend npm install failed!
    echo %date% %time% - ERROR: Node.js backend npm install failed with exit code %errorlevel% >> "%LOG_FILE%"
    pause
    exit /b 1
)
echo %date% %time% - Node.js backend npm install successful >> "%LOG_FILE%"
echo.
echo Setting up Python environment...
echo %date% %time% - Setting up Python environment... >> "%LOG_FILE%"
cd /d "%~dp0bin\system\jira\TestGenie-BE"
if not exist "venv" (
    echo Creating Python virtual environment...
    echo %date% %time% - Creating Python virtual environment... >> "%LOG_FILE%"
    py -m venv venv >> "%LOG_FILE%" 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: Failed to create Python virtual environment!
        echo %date% %time% - ERROR: Python venv creation failed with exit code %errorlevel% >> "%LOG_FILE%"
        pause
        exit /b 1
    )
    echo %date% %time% - Python venv created successfully >> "%LOG_FILE%"
) else (
    echo %date% %time% - Python venv already exists >> "%LOG_FILE%"
)
echo Installing Python dependencies...
echo %date% %time% - Installing Python dependencies... >> "%LOG_FILE%"
call venv\Scripts\activate && pip install -r requirements.txt >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python pip install failed!
    echo %date% %time% - ERROR: Python pip install failed with exit code %errorlevel% >> "%LOG_FILE%"
    pause
    exit /b 1
)
echo %date% %time% - Python pip install successful >> "%LOG_FILE%"

echo.
echo [6/6] Starting servers with fresh build...
echo %date% %time% - Starting servers... >> "%LOG_FILE%"
echo.

cd /d "%PROJECT_PATH%"
start "" "%~dp0Start TestCaseGenie.bat"

echo.
echo ============================================
echo Fresh Start Initiated!
echo ============================================
echo.
echo The app is starting with a completely clean build.
echo.
echo IMPORTANT FINAL STEPS:
echo   1. Wait for the browser to open
echo   2. Close the browser COMPLETELY
echo   3. Open Task Manager (Ctrl+Shift+Esc)
echo   4. End all Chrome or Edge processes
echo   5. Wait 10 seconds
echo   6. Reopen browser and go to: http://localhost:4200
echo.
echo This ensures NO cached files from the browser are used.
echo.
echo If something goes wrong, check startup.log for details.
echo.
echo %date% %time% - ========== Force Fresh Start Complete ========== >> "%LOG_FILE%"
pause
