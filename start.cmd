@echo off
rem Home Theater startup wrapper: double-click or run "start.cmd [args]".
rem Wraps powershell with -ExecutionPolicy Bypass because this machine blocks
rem unsigned .ps1 files ("is not digitally signed"). Bypass applies to this
rem process only and does not change any system setting.
rem Supported args are the same as start.ps1: -Dev / -Detach / -NoBuild
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo [ERROR] start.ps1 exited with code %RC%
    if "%~1"=="" pause
)

endlocal & exit /b %RC%
