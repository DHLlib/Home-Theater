# Home Theater Start Script
# Usage: .\start.ps1          -> Production mode (backend only, serves static frontend)
# Usage: .\start.ps1 -Dev     -> Development mode (backend + frontend dev server)

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

# Read key=value from backend/.env
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

function Stop-ProcessByPort($port) {
    $pidOnPort = Get-ProcessIdByPort $port
    if (-not $pidOnPort) { return $false }

    try {
        $proc = Get-Process -Id $pidOnPort -ErrorAction Stop
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$pidOnPort").CommandLine
        if ($proc.ProcessName -eq "python" -and $cmd -like "*uvicorn*") {
            Write-Host "[WARN] Stale backend detected on port $port (PID: $pidOnPort), terminating..." -ForegroundColor Yellow
            Stop-Process -Id $pidOnPort -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
            return $true
        } else {
            Write-Host "[WARN] Port $port is already used by a non-Home Theater process (PID: $pidOnPort)" -ForegroundColor Yellow
            return $false
        }
    } catch {
        return $false
    }
}

# PostgreSQL connection check
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

function Show-PostgresInstallGuide() {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host "  PostgreSQL not detected. Please install and configure it." -ForegroundColor Red
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "[Option 1] Official installer (recommended)" -ForegroundColor Cyan
    Write-Host "  1. Visit https://www.postgresql.org/download/windows/" -ForegroundColor White
    Write-Host "  2. Download PostgreSQL 16+ Windows installer" -ForegroundColor White
    Write-Host "  3. Keep the default port 5432 and remember your password" -ForegroundColor White
    Write-Host "  4. Open pgAdmin 4 or psql after installation" -ForegroundColor White
    Write-Host ""
    Write-Host "[Option 2] Chocolatey" -ForegroundColor Cyan
    Write-Host "  choco install postgresql" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "[Option 3] Scoop" -ForegroundColor Cyan
    Write-Host "  scoop install postgresql" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "----------------------------------------------" -ForegroundColor Gray
    Write-Host "[After installation, create the database]" -ForegroundColor Cyan
    Write-Host "  Open PowerShell or cmd and run:" -ForegroundColor White
    Write-Host "  psql -U postgres" -ForegroundColor Yellow
    Write-Host "  CREATE DATABASE home_theater;" -ForegroundColor Yellow
    Write-Host "  CREATE USER home_theater WITH PASSWORD 'your_password';" -ForegroundColor Yellow
    Write-Host "  GRANT ALL PRIVILEGES ON DATABASE home_theater TO home_theater;" -ForegroundColor Yellow
    Write-Host "  \q" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "[Then update backend/.env]" -ForegroundColor Cyan
    Write-Host "  Edit backend/.env and set DATABASE_URL to your password:" -ForegroundColor White
    Write-Host "  DATABASE_URL=postgresql+asyncpg://home_theater:your_password@localhost:5432/home_theater" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "----------------------------------------------" -ForegroundColor Gray
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

# PostgreSQL check
if (-not (Test-PostgresConnection)) {
    Show-PostgresInstallGuide
    exit 1
}

Write-Host "[OK] PostgreSQL connection verified" -ForegroundColor Green

# Ensure logs dir exists
$logsDir = Join-Path $backendDir "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# Clean up stale processes
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile
    try {
        $proc = Get-Process -Id $oldPid -ErrorAction Stop
        if ($proc.ProcessName -eq "python") {
            try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/api/health" -TimeoutSec 3 -ErrorAction Stop
                Write-Host "[INFO] Already running (PID: $oldPid, port: $PORT)" -ForegroundColor Cyan
                Write-Host "[INFO] URLs:"
                Write-Host "  http://localhost:$PORT  (or http://<lan-ip>:$PORT)" -ForegroundColor Green
                exit 0
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

# Port occupied but .pid missing/stale fallback cleanup
$pidOnPort = Get-ProcessIdByPort $PORT
if ($pidOnPort) {
    if (-not (Stop-ProcessByPort $PORT)) {
        Write-Host "[ERROR] Cannot start Home Theater on port $PORT because it is occupied by an external process" -ForegroundColor Red
        exit 1
    }
}

# Production: rebuild frontend every start
if (-not $Dev) {
    Write-Host "[INFO] Building frontend..." -ForegroundColor Cyan
    Set-Location $frontendDir
    npm run build
    if (-not (Test-Path (Join-Path $distDir "index.html"))) {
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

$procBackend = Start-Process python -ArgumentList $backendArgs `
    -WorkingDirectory $backendDir `
    -WindowStyle Normal -PassThru

$procBackend.Id | Set-Content $pidFile

# Dev mode: start frontend
if ($Dev) {
    Start-Sleep -Seconds 1
    $procFrontend = Start-Process "npm" -ArgumentList "run", "dev" `
        -WorkingDirectory $frontendDir `
        -WindowStyle Normal -PassThru
    $procFrontend.Id | Set-Content $pidFileFrontend
}

# Health check
Start-Sleep -Seconds 3

try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/api/health" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "[OK] Backend started, PID: $($procBackend.Id)" -ForegroundColor Green
    if ($Dev) {
        Write-Host "[OK] Frontend dev server started, PID: $($procFrontend.Id)" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "URLs:"
    Write-Host "  Backend API : http://localhost:$PORT/api/health" -ForegroundColor Green
    if ($Dev) {
        Write-Host "  Frontend Dev: http://localhost:5173" -ForegroundColor Green
    } else {
        Write-Host "  Web App     : http://localhost:$PORT" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "Stop: .\stop.ps1" -ForegroundColor Gray
} catch {
    Write-Host "[WARN] Backend starting, please visit http://127.0.0.1:$PORT later" -ForegroundColor Yellow
}
