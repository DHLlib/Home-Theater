# Home Theater Start Script
# Usage: .\start.ps1           -> Production mode, keeps the terminal
# Usage: .\start.ps1 -Dev      -> Development mode, keeps the terminal
# Usage: .\start.ps1 -Detach   -> Run in background and return immediately
# Usage: .\start.ps1 -NoBuild  -> Skip frontend build in production mode

[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$Detach,
    [switch]$NoBuild
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$distDir = Join-Path $frontendDir "dist"
$pidFile = Join-Path $backendDir ".pid"
$pidFileFrontend = Join-Path $frontendDir ".pid"
$backendLogDir = Join-Path $backendDir "logs"
$frontendLogDir = Join-Path $frontendDir "logs"

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
$FRONTEND_DEV_PORT = 5173

function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Get-ProcessCommandLine($id) {
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue).CommandLine
    } catch {
        return $null
    }
}

function Confirm-HomeTheaterProcess($id, $pattern) {
    try {
        $proc = Get-Process -Id $id -ErrorAction Stop
        $cmd = Get-ProcessCommandLine $id
        if ($proc.ProcessName -notin @("python", "python3", "node")) { return $false }
        if ($pattern -eq "uvicorn") {
            return ($cmd -like "*uvicorn*app.main:app*")
        }
        if ($pattern -eq "vite") {
            return ($cmd -like "*vite*")
        }
        return $cmd -like "*$pattern*"
    } catch {
        return $false
    }
}

function Get-ProcessIdByPort($port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
        if ($conn -is [array]) { return $conn[0].OwningProcess }
        return $conn.OwningProcess
    } catch {
        return $null
    }
}

function Stop-HomeTheaterProcessOnPort($port, $pattern) {
    $pidOnPort = Get-ProcessIdByPort $port
    if (-not $pidOnPort) { return $false }
    if (Confirm-HomeTheaterProcess $pidOnPort $pattern) {
        Write-Host "[WARN] Stale Home Theater process on port $port (PID: $pidOnPort), terminating..." -ForegroundColor Yellow
        Stop-Process -Id $pidOnPort -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        return $true
    }
    Write-Host "[WARN] Port $port is used by an external process (PID: $pidOnPort), skipped" -ForegroundColor Yellow
    return $false
}

function Show-PostgresGuide() {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host "  PostgreSQL not detected. Please install it." -ForegroundColor Red
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  1. Install PostgreSQL 16+ from https://www.postgresql.org/download/windows/" -ForegroundColor White
    Write-Host "  2. Create database: CREATE DATABASE home_theater;" -ForegroundColor White
    Write-Host "  3. Create user and grant privileges" -ForegroundColor White
    Write-Host "  4. Update backend/.env DATABASE_URL" -ForegroundColor White
    Write-Host ""
}

function Test-PostgresConnection() {
    $dbUrl = Get-EnvValue "DATABASE_URL" ""
    if ($dbUrl -eq "") { return $false }
    $pgHost = "localhost"
    $pgPort = 5432
    if ($dbUrl -match "@([^:/]+)(?::(\d+))?/") {
        $pgHost = $matches[1]
        if ($matches[2]) { $pgPort = [int]$matches[2] }
    }
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect($pgHost, $pgPort)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

function Wait-ForHealth($port, $timeoutSeconds = 120) {
    $end = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $end) {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
            if ($resp.StatusCode -eq 200) { return $true }
        } catch {
            # 静默等待，避免刷屏
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# Environment checks
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

if (-not (Test-PostgresConnection)) {
    Show-PostgresGuide
    exit 1
}

Write-Host "[OK] PostgreSQL connection verified" -ForegroundColor Green

# Ensure log dirs exist
if (-not (Test-Path $backendLogDir)) { New-Item -ItemType Directory -Path $backendLogDir | Out-Null }
if (-not (Test-Path $frontendLogDir)) { New-Item -ItemType Directory -Path $frontendLogDir | Out-Null }

# Clean up stale processes by PID files
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile
    if (Confirm-HomeTheaterProcess $oldPid "uvicorn") {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/api/health" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            Write-Host "[INFO] Already running (PID: $oldPid, port: $PORT)" -ForegroundColor Cyan
            Write-Host "[INFO] URLs:"
            Write-Host "  http://localhost:$PORT  (or http://<lan-ip>:$PORT)" -ForegroundColor Green
            exit 0
        } catch {
            Write-Host "[WARN] Stale backend process (PID: $oldPid), terminating..." -ForegroundColor Yellow
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
            Remove-Item $pidFile -Force
            Start-Sleep -Seconds 1
        }
    } else {
        Write-Host "[WARN] Backend .pid points to a non-Home Theater process, removing..." -ForegroundColor Yellow
        Remove-Item $pidFile -Force
    }
}

if (Test-Path $pidFileFrontend) {
    $oldPid = Get-Content $pidFileFrontend
    if (Confirm-HomeTheaterProcess $oldPid "vite") {
        Write-Host "[WARN] Stale frontend process (PID: $oldPid), terminating..." -ForegroundColor Yellow
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "[WARN] Frontend .pid points to a non-Home Theater process, removing..." -ForegroundColor Yellow
    }
    Remove-Item $pidFileFrontend -Force
    Start-Sleep -Seconds 1
}

# Port cleanup (also covers missing .pid files)
[void](Stop-HomeTheaterProcessOnPort $PORT "uvicorn")
if ($Dev) {
    [void](Stop-HomeTheaterProcessOnPort $FRONTEND_DEV_PORT "vite")
}

# Port occupied by external process check
$remainingBackendPid = Get-ProcessIdByPort $PORT
if ($remainingBackendPid -and -not (Confirm-HomeTheaterProcess $remainingBackendPid "uvicorn")) {
    Write-Host "[ERROR] Port $PORT is occupied by an external process, cannot start" -ForegroundColor Red
    exit 1
}

# Production: rebuild frontend every start
if (-not $Dev -and -not $NoBuild) {
    Write-Host "[INFO] Building frontend..." -ForegroundColor Cyan
    Push-Location $frontendDir
    npm run build
    $buildExit = $LASTEXITCODE
    Pop-Location
    if ($buildExit -ne 0 -or -not (Test-Path (Join-Path $distDir "index.html"))) {
        Write-Host "[ERROR] Frontend build failed" -ForegroundColor Red
        exit 1
    }
}

# Start backend
Write-Host "[INFO] Starting Home Theater$(if ($Dev) { ' [DEV MODE]' }) on port $PORT..." -ForegroundColor Cyan

$backendArgs = @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "$PORT")
if ($Dev) {
    $backendArgs += "--reload"
}

$backendLog = Join-Path $backendLogDir "uvicorn.log"
$backendErrLog = Join-Path $backendLogDir "uvicorn.err.log"

if ($Detach) {
    $procBackend = Start-Process python -ArgumentList $backendArgs `
        -WorkingDirectory $backendDir `
        -WindowStyle Hidden -RedirectStandardOutput $backendLog -RedirectStandardError $backendErrLog -PassThru
} else {
    $procBackend = Start-Process python -ArgumentList $backendArgs `
        -WorkingDirectory $backendDir `
        -NoNewWindow -PassThru
}

$procBackend.Id | Set-Content $pidFile

# Dev mode: start frontend
if ($Dev) {
    Start-Sleep -Seconds 2
    $frontendLog = Join-Path $frontendLogDir "vite.log"
    $frontendErrLog = Join-Path $frontendLogDir "vite.err.log"
    if ($Detach) {
        $procFrontend = Start-Process "npm" -ArgumentList "run", "dev" `
            -WorkingDirectory $frontendDir `
            -WindowStyle Hidden -RedirectStandardOutput $frontendLog -RedirectStandardError $frontendErrLog -PassThru
    } else {
        $procFrontend = Start-Process "npm" -ArgumentList "run", "dev" `
            -WorkingDirectory $frontendDir `
            -NoNewWindow -PassThru
    }
    $procFrontend.Id | Set-Content $pidFileFrontend
}

# Wait for backend health check
Write-Host "[INFO] Waiting for backend health check (up to 120s)..." -ForegroundColor Cyan
$healthOk = Wait-ForHealth $PORT -timeoutSeconds 120
if (-not $healthOk) {
    Write-Host "[WARN] Backend health check did not pass within 120 seconds" -ForegroundColor Yellow
    if ($Detach) {
        Write-Host "[ERROR] Check logs:" -ForegroundColor Red
        Write-Host "  $backendLog" -ForegroundColor Red
        Write-Host "  $backendErrLog" -ForegroundColor Red
        exit 1
    }
    Write-Host "[WARN] The backend process is still starting; logs will appear below" -ForegroundColor Yellow
}

Write-Host "[OK] Backend started, PID: $($procBackend.Id)" -ForegroundColor Green
if ($Dev) {
    Write-Host "[OK] Frontend dev server started, PID: $($procFrontend.Id)" -ForegroundColor Green
}
Write-Host ""
Write-Host "URLs:"
Write-Host "  Backend API : http://localhost:$PORT/api/health" -ForegroundColor Green
if ($Dev) {
    Write-Host "  Frontend Dev: http://localhost:$FRONTEND_DEV_PORT" -ForegroundColor Green
} else {
    Write-Host "  Web App     : http://localhost:$PORT" -ForegroundColor Green
}
Write-Host ""

if ($Detach) {
    Write-Host "Detached mode. Logs:" -ForegroundColor Gray
    Write-Host "  Backend: $backendLog" -ForegroundColor Gray
    if ($Dev) {
        Write-Host "  Frontend: $frontendLog" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Stop: .\stop.ps1" -ForegroundColor Gray
} else {
    Write-Host "Running in this terminal. Press Ctrl+C to stop." -ForegroundColor Gray
    try {
        while ($true) {
            Start-Sleep -Seconds 1
            if ($procBackend.HasExited) {
                Write-Host "[WARN] Backend process exited" -ForegroundColor Yellow
                break
            }
            if ($Dev -and $procFrontend.HasExited) {
                Write-Host "[WARN] Frontend process exited" -ForegroundColor Yellow
                break
            }
        }
    } finally {
        if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
        if (Test-Path $pidFileFrontend) { Remove-Item $pidFileFrontend -Force }
    }
}
