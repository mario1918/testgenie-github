@echo off
echo ============================================
echo TestCaseGenie - Manual Server Cleanup
echo ============================================
echo.
echo This will terminate all TestCaseGenie server processes
echo (Node.js backends, Python uvicorn, Angular dev server)
echo.
pause
echo.

echo Searching for TestCaseGenie processes...
echo.

set PROJECT_PATH=%~dp0

REM Kill Node.js processes from this project
echo Terminating Node.js servers...
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST ^| find "PID:"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | find /I "%PROJECT_PATH%" >nul
    if not errorlevel 1 (
        echo   Killing process %%a
        taskkill /F /PID %%a >nul 2>nul
    )
)

REM Kill Python processes from this project
echo Terminating Python servers...
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq python.exe" /FO LIST ^| find "PID:"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | find /I "%PROJECT_PATH%" >nul
    if not errorlevel 1 (
        wmic process where "ProcessId=%%a" get CommandLine 2>nul | find /I "uvicorn" >nul
        if not errorlevel 1 (
            echo   Killing process %%a
            taskkill /F /PID %%a >nul 2>nul
        )
    )
)

for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq py.exe" /FO LIST ^| find "PID:"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | find /I "%PROJECT_PATH%" >nul
    if not errorlevel 1 (
        wmic process where "ProcessId=%%a" get CommandLine 2>nul | find /I "uvicorn" >nul
        if not errorlevel 1 (
            echo   Killing process %%a
            taskkill /F /PID %%a >nul 2>nul
        )
    )
)

echo.
echo ============================================
echo Cleanup Complete!
echo ============================================
echo.
echo All TestCaseGenie server processes have been terminated.
echo You can now restart the application safely.
echo.
pause
