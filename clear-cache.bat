@echo off
echo ============================================
echo TestCaseGenie - Clear Build Cache
echo ============================================
echo.
echo This will clear Angular build cache to ensure
echo the latest code is used on next startup.
echo.
pause
echo.

set PROJECT_PATH=%~dp0

echo Cleaning up old server processes...
echo.

REM Kill Node.js processes from this project
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    for /f "delims=" %%b in ('wmic process where "ProcessId=%%a" get CommandLine 2^>nul ^| find /I "%PROJECT_PATH%"') do (
        echo   Killing Node.js process %%a
        taskkill /F /PID %%a >nul 2>nul
    )
)

REM Kill Python processes from this project
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq python.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    for /f "delims=" %%b in ('wmic process where "ProcessId=%%a" get CommandLine 2^>nul ^| find /I "%PROJECT_PATH%"') do (
        wmic process where "ProcessId=%%a" get CommandLine 2^>nul | find /I "uvicorn" >nul
        if not errorlevel 1 (
            echo   Killing Python process %%a
            taskkill /F /PID %%a >nul 2>nul
        )
    )
)

for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq py.exe" /FO LIST 2^>nul ^| find "PID:"') do (
    for /f "delims=" %%b in ('wmic process where "ProcessId=%%a" get CommandLine 2^>nul ^| find /I "%PROJECT_PATH%"') do (
        wmic process where "ProcessId=%%a" get CommandLine 2^>nul | find /I "uvicorn" >nul
        if not errorlevel 1 (
            echo   Killing Python process %%a
            taskkill /F /PID %%a >nul 2>nul
        )
    )
)

echo.
echo Clearing Angular build cache...
echo.

REM Delete .angular/cache folder
if exist "%~dp0bin\front\angular-frontend\.angular\cache" (
    echo   Removing .angular\cache...
    rmdir /s /q "%~dp0bin\front\angular-frontend\.angular\cache" 2>nul
)

REM Delete node_modules/.cache folder
if exist "%~dp0bin\front\angular-frontend\node_modules\.cache" (
    echo   Removing node_modules\.cache...
    rmdir /s /q "%~dp0bin\front\angular-frontend\node_modules\.cache" 2>nul
)

REM Optional: Clear browser cache hint
echo.
echo ============================================
echo Cache Cleared Successfully!
echo ============================================
echo.
echo Next steps:
echo   1. Start TestCaseGenie normally
echo   2. If still seeing old code, press Ctrl+F5 in browser
echo      to force refresh and clear browser cache
echo.
echo The app will now use the latest code from your repository.
echo.
pause
