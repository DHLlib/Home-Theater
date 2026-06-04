@echo off
chcp 65001 >nul
title Home Theater - Stop

where powershell >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] PowerShell not found
    pause
    exit /b 1
)

powershell -ExecutionPolicy Bypass -File "%~dp0stop.ps1"

pause
