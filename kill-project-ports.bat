@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo ============================================
echo TestGenie - Kill Project Ports
echo ============================================
echo.
echo This script kills processes LISTENING on ports
echo that belong to this repo folder.
echo.

set "PROJECT_PATH=%~dp0"
if "%PROJECT_PATH:~-1%"=="\" set "PROJECT_PATH=%PROJECT_PATH:~0,-1%"

echo Project path:
echo   %PROJECT_PATH%
echo.

choice /M "Proceed to terminate listening processes for this project"
if errorlevel 2 (
  echo Aborted.
  exit /b 0
)

set "KILLED_ANY=0"

echo.
echo Scanning for LISTENING ports...
echo.

for /f "tokens=1,2,3,4,5" %%A in ('netstat -ano ^| findstr /R /C:":.* LISTENING"') do (
  set "PID=%%E"
  set "LOCAL=%%B"

  if not "!PID!"=="0" (
    set "CMDLINE="
    for /f "usebackq delims=" %%L in (`wmic process where "ProcessId=!PID!" get CommandLine 2^>nul ^| findstr /I /C:"%PROJECT_PATH%"`) do (
      set "CMDLINE=%%L"
      goto :__cmd_found
    )

    :__cmd_found
    if defined CMDLINE (
      echo [KILL] PID !PID! listening on !LOCAL!
      echo        !CMDLINE!
      taskkill /F /PID !PID! >nul 2>nul
      if not errorlevel 1 set "KILLED_ANY=1"
      echo.
    )
  )
)

echo ============================================
if "%KILLED_ANY%"=="0" (
  echo No LISTENING processes were found for this project.
) else (
  echo Done. Project LISTENING processes were terminated.
)
echo ============================================
echo.
pause
endlocal
exit /b 0
