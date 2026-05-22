[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Home Theater Start Script
# Production mode: static frontend + FastAPI backend

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$distDir = Join-Path $frontendDir "dist"
$pidFile = Join-Path $backendDir ".pid"

# Check if frontend is built
if (-not (Test-Path (Join-Path $distDir "index.html"))) {
    Write-Host "[WARN] Frontend not built, running npm run build..." -ForegroundColor Yellow
    Set-Location $frontendDir
    npm run build
    if (-not (Test-Path (Join-Path $distDir "index.html"))) {
        Write-Host "[ERROR] Frontend build failed" -ForegroundColor Red
        exit 1
    }
}

# Check if already running
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile
    try {
        $proc = Get-Process -Id $oldPid -ErrorAction Stop
        Write-Host "[INFO] Already running (PID: $oldPid)" -ForegroundColor Cyan
        Write-Host "[INFO] URLs:"
        Write-Host "       http://localhost.com:8181       (local)" -ForegroundColor Green
        exit 0
    } catch {
        Remove-Item $pidFile -Force
    }
}

Write-Host "[INFO] Starting Home Theater..." -ForegroundColor Cyan

$proc = Start-Process python -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8181" `
    -WorkingDirectory $backendDir `
    -WindowStyle Normal -PassThru

$proc.Id | Set-Content $pidFile

Start-Sleep -Seconds 2

try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8181/api/health" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "[OK] Started, PID: $($proc.Id)" -ForegroundColor Green
    Write-Host ""
    Write-Host "URLs:"
    Write-Host "  http://localhost.com:8181       (local)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Stop: .\stop.ps1" -ForegroundColor Gray
} catch {
    Write-Host "[WARN] Starting, please visit http://127.0.0.1:8181 later" -ForegroundColor Yellow
}
