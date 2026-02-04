@echo off
echo ============================================
echo TestCaseGenie - Update Diagnosis
echo ============================================
echo.

set PROJECT_PATH=%~dp0

echo [1] Checking Git status...
echo.
cd /d "%PROJECT_PATH%"
git status
echo.
echo Current branch:
git branch --show-current
echo.
echo Last commit:
git log -1 --oneline
echo.
echo Remote tracking:
git rev-parse HEAD
git rev-parse origin/main
echo.

pause
echo.

echo [2] Checking for running server processes...
echo.

set FOUND=0

for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    for /f "delims=" %%b in ('wmic process where "ProcessId=%%a" get CommandLine 2^>nul ^| find /I "%PROJECT_PATH%"') do (
        echo [Node.js] PID: %%a
        echo %%b
        echo.
        set FOUND=1
    )
)

for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq python.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    for /f "delims=" %%b in ('wmic process where "ProcessId=%%a" get CommandLine 2^>nul ^| find /I "%PROJECT_PATH%"') do (
        echo [Python] PID: %%a
        echo %%b
        echo.
        set FOUND=1
    )
)

if %FOUND%==0 (
    echo No TestCaseGenie processes found.
)

pause
echo.

echo [3] Checking specific file content...
echo.
echo Checking if the code is commented in:
echo   bin\front\angular-frontend\src\app\app.component.html
echo.

findstr /C:"<!-- <div class=\"dropdown\">" "%~dp0bin\front\angular-frontend\src\app\app.component.html" >nul
if %errorlevel%==0 (
    echo [FOUND] The code IS commented in your local file!
    echo The HTML comment opening tag was found.
) else (
    echo [NOT FOUND] The code is NOT commented in your local file!
    echo The HTML comment opening tag was not found.
)

echo.
findstr /C:"<div class=\"dropdown\">" "%~dp0bin\front\angular-frontend\src\app\app.component.html" | findstr /V "<!--" >nul
if %errorlevel%==0 (
    echo [FOUND] Uncommented dropdown div exists!
) else (
    echo [NOT FOUND] No uncommented dropdown div found.
)

echo.
pause
echo.

echo [4] Recommendations:
echo.

echo Option 1: Force pull from remote
echo   cd "%PROJECT_PATH%"
echo   git fetch origin
echo   git reset --hard origin/main
echo.

echo Option 2: Check if you're on the correct branch
echo   You should be on 'main' branch
echo.

echo Option 3: Verify changes were pushed to remote
echo   Check Bitbucket web interface to confirm changes are there
echo.

echo Option 4: Full clean restart
echo   1. Run cleanup-servers.bat
echo   2. Delete .angular\cache folder manually
echo   3. git pull origin main
echo   4. Start TestCaseGenie normally
echo.
pause
