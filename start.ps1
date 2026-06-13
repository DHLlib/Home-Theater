# Home Theater Start Script
# Usage: .\start.ps1          鈫?Production mode (backend only, serves static frontend)
# Usage: .\start.ps1 -Dev     鈫?Development mode (backend + frontend dev server)

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

# 浠?.env 璇诲彇 key=value
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

# 鈹€鈹€ PostgreSQL 杩炴帴妫€鏌?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function Test-PostgresConnection() {
    $dbUrl = Get-EnvValue "DATABASE_URL" ""
    if ($dbUrl -eq "") { return $false }

    # 瑙ｆ瀽 host:port锛屾敮鎸?IPv6銆佸煙鍚嶃€佹棤绔彛绛夊绉嶆牸寮?    $pgHost = "localhost"
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
    Write-Host "鈺斺晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晽" -ForegroundColor Red
    Write-Host "鈺? PostgreSQL 鏈娴嬪埌锛岃鍏堝畨瑁呭苟閰嶇疆鏁版嵁搴?                    鈺? -ForegroundColor Red
    Write-Host "鈺氣晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暆" -ForegroundColor Red
    Write-Host ""
    Write-Host "銆愭柟妗堜竴銆戝畼缃戝畨瑁呭寘锛堟帹鑽愶級" -ForegroundColor Cyan
    Write-Host "  1. 璁块棶 https://www.postgresql.org/download/windows/" -ForegroundColor White
    Write-Host "  2. 涓嬭浇 PostgreSQL 16+ Windows 瀹夎鍖? -ForegroundColor White
    Write-Host "  3. 瀹夎鏃惰浣忓瘑鐮侊紝绔彛淇濇寔榛樿 5432" -ForegroundColor White
    Write-Host "  4. 瀹夎瀹屾垚鍚庢墦寮€ pgAdmin 4 鎴?psql" -ForegroundColor White
    Write-Host ""
    Write-Host "銆愭柟妗堜簩銆慍hocolatey锛堝懡浠よ锛? -ForegroundColor Cyan
    Write-Host "  choco install postgresql" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "銆愭柟妗堜笁銆慡coop锛堝懡浠よ锛? -ForegroundColor Cyan
    Write-Host "  scoop install postgresql" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣" -ForegroundColor Gray
    Write-Host "銆愬畨瑁呭悗鍒涘缓鏁版嵁搴撱€? -ForegroundColor Cyan
    Write-Host "  鎵撳紑 PowerShell 鎴?cmd锛屾墽琛岋細" -ForegroundColor White
    Write-Host "  psql -U postgres" -ForegroundColor Yellow
    Write-Host "  CREATE DATABASE home_theater;" -ForegroundColor Yellow
    Write-Host "  CREATE USER home_theater WITH PASSWORD 'your_password';" -ForegroundColor Yellow
    Write-Host "  GRANT ALL PRIVILEGES ON DATABASE home_theater TO home_theater;" -ForegroundColor Yellow
    Write-Host "  \q" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "銆愮劧鍚庝慨鏀?.env銆? -ForegroundColor Cyan
    Write-Host "  缂栬緫 backend/.env锛屽皢 DATABASE_URL 涓殑瀵嗙爜鏀逛负瀹為檯瀵嗙爜锛? -ForegroundColor White
    Write-Host "  DATABASE_URL=postgresql+asyncpg://home_theater:your_password@localhost:5432/home_theater" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣鈹佲攣" -ForegroundColor Gray
}

# 鈹€鈹€ Environment checks 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

# 鈹€鈹€ PostgreSQL check 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
if (-not (Test-PostgresConnection)) {
    Show-PostgresInstallGuide
    exit 1
}

Write-Host "[OK] PostgreSQL connection verified" -ForegroundColor Green

# 鈹€鈹€ Ensure logs dir exists 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
$logsDir = Join-Path $backendDir "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# 鈹€鈹€ Clean up stale processes 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

# 绔彛琚崰鐢ㄤ絾 .pid 涓㈠け/杩囨湡鐨勫厹搴曟竻鐞?$pidOnPort = Get-ProcessIdByPort $PORT
if ($pidOnPort) {
    if (-not (Stop-ProcessByPort $PORT)) {
        Write-Host "[ERROR] Cannot start Home Theater on port $PORT because it is occupied by an external process" -ForegroundColor Red
        exit 1
    }
}

# 鈹€鈹€ Production: rebuild frontend every start 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
if (-not $Dev) {
    Write-Host "[INFO] Building frontend..." -ForegroundColor Cyan
    Set-Location $frontendDir
    npm run build
    if (-not (Test-Path (Join-Path $distDir "index.html"))) {
        Write-Host "[ERROR] Frontend build failed" -ForegroundColor Red
        exit 1
    }
}

# 鈹€鈹€ Start backend 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
Write-Host "[INFO] Starting Home Theater$(if ($Dev) { ' [DEV MODE]' }) on port $PORT..." -ForegroundColor Cyan

$backendArgs = @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "$PORT")
if ($Dev) {
    $backendArgs += "--reload"
}

$procBackend = Start-Process python -ArgumentList $backendArgs `
    -WorkingDirectory $backendDir `
    -WindowStyle Normal -PassThru

$procBackend.Id | Set-Content $pidFile

# 鈹€鈹€ Dev mode: start frontend 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
if ($Dev) {
    Start-Sleep -Seconds 1
    $procFrontend = Start-Process "npm" -ArgumentList "run", "dev" `
        -WorkingDirectory $frontendDir `
        -WindowStyle Normal -PassThru
    $procFrontend.Id | Set-Content $pidFileFrontend
}

# 鈹€鈹€ Health check 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
