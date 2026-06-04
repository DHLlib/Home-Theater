@echo off
chcp 65001 >nul
title Home Theater

REM 检查 PowerShell 可用性
where powershell >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] PowerShell not found
    pause
    exit /b 1
)

REM 传递所有参数给 start.ps1
echo [INFO] Starting via PowerShell...
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*

pause
