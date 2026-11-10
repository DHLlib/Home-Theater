@echo off
rem Home Theater stop wrapper: double-click or run "stop.cmd".
rem Same reason as start.cmd: bypass the unsigned-script execution policy.
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo [ERROR] stop.ps1 exited with code %RC%
)

endlocal & exit /b %RC%
