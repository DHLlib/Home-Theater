# Home Theater Start Script
# Usage: .\start.ps1          → Production mode (backend only, serves static frontend)
# Usage: .\start.ps1 -Dev     → Development mode (backend + frontend dev server)

param(
    [switch]$Dev
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$distDir = Join-Path $frontendDir "dist"
$pidFile = Join-Path $backendDir ".pid"
$pidFileFrontend = Join-Path $frontendDir ".pid"

function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# ── Environment checks ──────────────────────────────────────────
if (-not (Test-Command "python")) {
    Write-Host "[ERROR] python not found in PATH" -ForegroundColor Red
    exit 1
}

$pyVersion = (python --version 2>&1)
if ($pyVersion -notmatch "Python 3\.(1[1-9]|[2-9][0-9])") {
    Write-Host "[WARN] Python 3.11+ recommended (found: $pyVersion)" -ForegroundColor Yellow
}

if (-not (Test-Command "npm")) {
    Write-Host "[ERROR] npm not found in PATH" -ForegroundColor Red
    exit 1
}

# ── Ensure data dirs exist ──────────────────────────────────────
$dataDir = Join-Path $backendDir "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

$logsDir = Join-Path $backendDir "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# ── Check if already running ────────────────────────────────────
$alreadyRunning = $false

# 1. 检查 .pid 文件：验证进程存在 + 是 python + health 接口可用
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile
    try {
        $proc = Get-Process -Id $oldPid -ErrorAction Stop
        if ($proc.ProcessName -eq "python") {
            try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8181/api/health" -TimeoutSec 3 -ErrorAction Stop
                Write-Host "[INFO] Already running (PID: $oldPid)" -ForegroundColor Cyan
                $alreadyRunning = $true
            } catch {
                Write-Host "[WARN] Stale process detected (PID: $oldPid), terminating..." -ForegroundColor Yellow
                Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
                Remove-Item $pidFile -Force
                Start-Sleep -Seconds 1
            }
        } else {
            Write-Host "[WARN] .pid points to non-python process (PID: $oldPid), removing..." -ForegroundColor Yellow
            Remove-Item $pidFile -Force
        }
    } catch {
        Remove-Item $pidFile -Force
    }
}

# 2. 兜底：直接访问 health 接口（.pid 丢失或指向错误进程时）
if (-not $alreadyRunning) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8181/api/health" -TimeoutSec 2 -ErrorAction Stop
        Write-Host "[INFO] Service already running on port 8181 (.pid file missing or stale)" -ForegroundColor Cyan
        $alreadyRunning = $true
    } catch {}
}

if ($alreadyRunning) {
    Write-Host "[INFO] URLs:"
    Write-Host "  http://localhost:8181  (or http://<lan-ip>:8181)" -ForegroundColor Green
    exit 0
}

# ── Production: rebuild frontend every start ────────────────────
if (-not $Dev) {
    Write-Host "[INFO] Building frontend..." -ForegroundColor Cyan
    Set-Location $frontendDir
    npm run build
    if (-not (Test-Path (Join-Path $distDir "index.html"))) {
        Write-Host "[ERROR] Frontend build failed" -ForegroundColor Red
        exit 1
    }
}

# ── Start backend ───────────────────────────────────────────────
Write-Host "[INFO] Starting Home Theater$(if ($Dev) { ' [DEV MODE]' })..." -ForegroundColor Cyan

$backendArgs = @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8181")
if ($Dev) {
    $backendArgs += "--reload"
}

$procBackend = Start-Process python -ArgumentList $backendArgs `
    -WorkingDirectory $backendDir `
    -WindowStyle Normal -PassThru

$procBackend.Id | Set-Content $pidFile

# ── Dev mode: start frontend ────────────────────────────────────
if ($Dev) {
    Start-Sleep -Seconds 1
    $procFrontend = Start-Process "npm" -ArgumentList "run", "dev" `
        -WorkingDirectory $frontendDir `
        -WindowStyle Normal -PassThru
    $procFrontend.Id | Set-Content $pidFileFrontend
}

# ── Health check ────────────────────────────────────────────────
Start-Sleep -Seconds 3

try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8181/api/health" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "[OK] Backend started, PID: $($procBackend.Id)" -ForegroundColor Green
    if ($Dev) {
        Write-Host "[OK] Frontend dev server started, PID: $($procFrontend.Id)" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "URLs:"
    Write-Host "  Backend API : http://localhost:8181/api/health" -ForegroundColor Green
    if ($Dev) {
        Write-Host "  Frontend Dev: http://localhost:5173" -ForegroundColor Green
    } else {
        Write-Host "  Web App     : http://localhost:8181" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "Stop: .\stop.ps1" -ForegroundColor Gray
} catch {
    Write-Host "[WARN] Backend starting, please visit http://127.0.0.1:8181 later" -ForegroundColor Yellow
}
