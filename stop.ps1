[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Home Theater Stop Script

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$pidFile = Join-Path $backendDir ".pid"
$pidFileFrontend = Join-Path $frontendDir ".pid"

$stopped = $false

# ── Stop backend by PID file ────────────────────────────────────
if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile
    try {
        Stop-Process -Id $pidValue -Force -ErrorAction Stop
        Write-Host "[OK] Stopped backend PID $pidValue" -ForegroundColor Green
        $stopped = $true
    } catch {
        Write-Host "[WARN] Backend PID $pidValue not found" -ForegroundColor Yellow
    }
    Remove-Item $pidFile -Force
}

# ── Stop frontend dev server by PID file ────────────────────────
if (Test-Path $pidFileFrontend) {
    $pidValue = Get-Content $pidFileFrontend
    try {
        Stop-Process -Id $pidValue -Force -ErrorAction Stop
        Write-Host "[OK] Stopped frontend PID $pidValue" -ForegroundColor Green
        $stopped = $true
    } catch {
        Write-Host "[WARN] Frontend PID $pidValue not found" -ForegroundColor Yellow
    }
    Remove-Item $pidFileFrontend -Force
}

# ── Fallback: terminate backend by command line matching ────────
$remainingBackend = Get-Process python -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
        $cmd -like "*uvicorn*app.main:app*" -and $cmd -like "*$($projectRoot.Replace('\', '\\'))*"
    } catch {
        $false
    }
}

if ($remainingBackend) {
    foreach ($p in $remainingBackend) {
        Stop-Process -Id $p.Id -Force
        Write-Host "[OK] Stopped orphan backend PID $($p.Id)" -ForegroundColor Green
        $stopped = $true
    }
}

# ── Fallback: terminate frontend dev server by command line ─────
$remainingFrontend = Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
        $cmd -like "*vite*" -and $cmd -like "*$($projectRoot.Replace('\', '\\'))*"
    } catch {
        $false
    }
}

if ($remainingFrontend) {
    foreach ($p in $remainingFrontend) {
        Stop-Process -Id $p.Id -Force
        Write-Host "[OK] Stopped orphan frontend PID $($p.Id)" -ForegroundColor Green
        $stopped = $true
    }
}

if ($stopped) {
    Write-Host "[OK] All processes stopped" -ForegroundColor Green
} else {
    Write-Host "[INFO] No running Home Theater process" -ForegroundColor Cyan
}
