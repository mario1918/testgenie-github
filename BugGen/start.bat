@echo off
setlocal

echo Starting BugGenAI...
echo.

set "AI_BE_PORT=4000"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%AI_BE_PORT%" ^| findstr LISTENING') do (
  set "AI_BE_PID=%%a"
  goto :port_checked
)

:port_checked
if defined AI_BE_PID (
  echo Port %AI_BE_PORT% is already in use by PID %AI_BE_PID%.
  choice /M "Kill this process now?"
  if errorlevel 2 (
    echo Aborted. Close the process using port %AI_BE_PORT% or change AI_BE_PORT in .env, then re-run.
    goto :eof
  )
  taskkill /F /PID %AI_BE_PID% >nul 2>&1
  timeout /t 1 /nobreak >nul
)

start "BugGenAI - AI Backend" cmd /k "npm run dev:ai-backend"
start "BugGenAI - AI Frontend" cmd /k "npm run dev:ai-frontend"

echo Done.
endlocal