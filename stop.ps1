[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Home Theater Stop Script

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$pidFile = Join-Path $backendDir ".pid"
$pidFileFrontend = Join-Path $frontendDir ".pid"

function Get-EnvValue($key, $defaultValue) {
    $envFile = Join-Path $backendDir ".env"
    if (-not (Test-Path $envFile)) { return $defaultValue }
    foreach ($line in Get-Content $envFile -Encoding UTF8) {
        if ($line -match "^\s*$key\s*=\s*(.*?)\s*$") {
            return $matches[1]
        }
    }
    return $defaultValue
}

$PORT = [int](Get-EnvValue "PORT" "8000")

function Get-ProcessIdByPort($port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
        return $conn.OwningProcess
    } catch {
        return $null
    }
}

$stopped = $false

# 鈹€鈹€ Stop backend by PID file 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

# 鈹€鈹€ Stop frontend dev server by PID file 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

# 鈹€鈹€ Fallback: terminate backend by port 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
$pidOnPort = Get-ProcessIdByPort $PORT
if ($pidOnPort) {
    try {
        $proc = Get-Process -Id $pidOnPort -ErrorAction Stop
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$pidOnPort").CommandLine
        if ($proc.ProcessName -eq "python" -and $cmd -like "*uvicorn*") {
            Stop-Process -Id $pidOnPort -Force
            Write-Host "[OK] Stopped orphan backend PID $pidOnPort on port $PORT" -ForegroundColor Green
            $stopped = $true
        } else {
            Write-Host "[WARN] Port $PORT is occupied by a non-Home Theater process (PID: $pidOnPort), skipped" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[WARN] Could not stop process on port $PORT" -ForegroundColor Yellow
    }
}

# 鈹€鈹€ Fallback: terminate backend by command line matching 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

# 鈹€鈹€ Fallback: terminate frontend dev server by command line 鈹€鈹€鈹€鈹€鈹€
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
