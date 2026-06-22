[Console]::OutputEncoding = [System.Text.Encoding]::Encoding::UTF8

# Home Theater Development Start Script
# 开发模式快捷入口：同时启动后端（uvicorn）和前端（vite dev）
# Usage: .\start-dev.ps1           -> 前台运行，按 Ctrl+C 停止
# Usage: .\start-dev.ps1 -Detach   -> 后台运行，返回后用 .\stop.ps1 停止

[CmdletBinding()]
param(
    [switch]$Detach
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $scriptRoot "start.ps1"

& $startScript -Dev -Detach:$Detach
