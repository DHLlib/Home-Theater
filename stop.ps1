[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Home Theater Stop Script

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$pidFile = Join-Path $backendDir ".pid"

$stopped = $false

# Method 1: terminate by PID file
if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile
    try {
        Stop-Process -Id $pidValue -Force -ErrorAction Stop
        Write-Host "[OK] Stopped PID $pidValue" -ForegroundColor Green
        $stopped = $true
    } catch {
        Write-Host "[WARN] PID $pidValue not found" -ForegroundColor Yellow
    }
    Remove-Item $pidFile -Force
}

# Method 2: fallback - terminate by command line matching
$remaining = Get-Process python -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
        $cmd -like "*uvicorn*app.main:app*" -and $cmd -like "*$($projectRoot.Replace('\', '\\'))*"
    } catch {
        $false
    }
}

if ($remaining) {
    foreach ($p in $remaining) {
        Stop-Process -Id $p.Id -Force
        Write-Host "[OK] Stopped orphan PID $($p.Id)" -ForegroundColor Green
        $stopped = $true
    }
}

if ($stopped) {
    Write-Host "[OK] Stopped" -ForegroundColor Green
} else {
    Write-Host "[INFO] No running Home Theater process" -ForegroundColor Cyan
}
