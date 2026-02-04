@echo off
setlocal

rem Run from project root (folder of this .bat)
pushd "%~dp0"

if not exist "package.json" goto no_package_json

echo Project directory: "%CD%"
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
for /f "delims=" %%v in ('npm -v 2^>nul') do set "NPM_VER=%%v"
if not defined NODE_VER set "NODE_VER=(unknown)"
if not defined NPM_VER set "NPM_VER=(unknown)"
echo Node: %NODE_VER% ^| npm: %NPM_VER%

where node >nul 2>&1
if errorlevel 1 goto no_node

where npm.cmd >nul 2>&1
if errorlevel 1 goto no_npm

if not exist "node_modules" call :install_deps

echo.
echo Starting dev server...
start "JIRA-2-Playwright Dev" cmd /k "npm.cmd run dev"

echo Opening http://localhost:3000 ...
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

goto end

:install_deps
echo Installing dependencies (npm install)...
call npm.cmd install
if errorlevel 1 goto npm_install_failed
exit /b 0

:no_package_json
echo ERROR: package.json not found in "%CD%".
echo Make sure Start.bat is located in the project root.
goto end

:no_node
echo ERROR: Node.js is not installed or not in PATH.
echo Please install Node.js 18+ and re-run this script.
goto end

:no_npm
echo ERROR: npm is not available in PATH.
echo Please reinstall Node.js (includes npm) and re-run this script.
goto end

:npm_install_failed
echo ERROR: npm install failed.
goto end

:end
popd
endlocal
exit /b 0
