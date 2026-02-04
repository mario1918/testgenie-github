@echo off
echo ============================================
echo TestCaseGenie - Check Running Servers
echo ============================================
echo.

set PROJECT_PATH=%~dp0
set FOUND=0

echo Checking for Node.js processes...
echo.
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    for /f "delims=" %%b in ('wmic process where "ProcessId=%%a" get CommandLine 2^>nul ^| find /I "%PROJECT_PATH%"') do (
        echo [Node.js] PID: %%a
        echo          %%b
        echo.
        set FOUND=1
    )
)

echo Checking for Python processes...
echo.
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq python.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    for /f "delims=" %%b in ('wmic process where "ProcessId=%%a" get CommandLine 2^>nul ^| find /I "%PROJECT_PATH%"') do (
        echo [Python] PID: %%a
        echo         %%b
        echo.
        set FOUND=1
    )
)

for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq py.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    for /f "delims=" %%b in ('wmic process where "ProcessId=%%a" get CommandLine 2^>nul ^| find /I "%PROJECT_PATH%"') do (
        echo [Python] PID: %%a
        echo         %%b
        echo.
        set FOUND=1
    )
)

echo ============================================
if %FOUND%==0 (
    echo No TestCaseGenie server processes found.
    echo Application is not running.
) else (
    echo Found running TestCaseGenie processes above.
    echo.
    echo To terminate them, run: cleanup-servers.bat
)
echo ============================================
echo.
pause
