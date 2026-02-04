@echo off

REM Change to the project directory
cd /d "%~dp0"

REM Open loading page in Chrome/Edge with cache completely disabled
start chrome.exe --app="file:///%~dp0bin\front\loading.html" --window-size=1400,900 --incognito --disable-cache --disk-cache-size=0 --disable-application-cache --disable-gpu-shader-disk-cache
if %errorlevel% neq 0 (
    start msedge.exe --app="file:///%~dp0bin\front\loading.html" --window-size=1400,900 --inprivate --disable-cache --disk-cache-size=0 --disable-application-cache --disable-gpu-shader-disk-cache
)

REM Run git operations and start servers in hidden mode
wscript "%~dp0start-with-update.vbs"
