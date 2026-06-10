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

# 从 .env 读取 key=value
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

# ── PostgreSQL 连接检查 ─────────────────────────────────────────
function Test-PostgresConnection() {
    $dbUrl = Get-EnvValue "DATABASE_URL" ""
    if ($dbUrl -eq "") { return $false }

    # 解析 host:port，支持 IPv6、域名、无端口等多种格式
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
    Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "║  PostgreSQL 未检测到，请先安装并配置数据库                     ║" -ForegroundColor Red
    Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Red
    Write-Host ""
    Write-Host "【方案一】官网安装包（推荐）" -ForegroundColor Cyan
    Write-Host "  1. 访问 https://www.postgresql.org/download/windows/" -ForegroundColor White
    Write-Host "  2. 下载 PostgreSQL 16+ Windows 安装包" -ForegroundColor White
    Write-Host "  3. 安装时记住密码，端口保持默认 5432" -ForegroundColor White
    Write-Host "  4. 安装完成后打开 pgAdmin 4 或 psql" -ForegroundColor White
    Write-Host ""
    Write-Host "【方案二】Chocolatey（命令行）" -ForegroundColor Cyan
    Write-Host "  choco install postgresql" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "【方案三】Scoop（命令行）" -ForegroundColor Cyan
    Write-Host "  scoop install postgresql" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    Write-Host "【安装后创建数据库】" -ForegroundColor Cyan
    Write-Host "  打开 PowerShell 或 cmd，执行：" -ForegroundColor White
    Write-Host "  psql -U postgres" -ForegroundColor Yellow
    Write-Host "  CREATE DATABASE home_theater;" -ForegroundColor Yellow
    Write-Host "  CREATE USER home_theater WITH PASSWORD 'your_password';" -ForegroundColor Yellow
    Write-Host "  GRANT ALL PRIVILEGES ON DATABASE home_theater TO home_theater;" -ForegroundColor Yellow
    Write-Host "  \q" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "【然后修改 .env】" -ForegroundColor Cyan
    Write-Host "  编辑 backend/.env，将 DATABASE_URL 中的密码改为实际密码：" -ForegroundColor White
    Write-Host "  DATABASE_URL=postgresql+asyncpg://home_theater:your_password@localhost:5432/home_theater" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
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

# ── PostgreSQL check ────────────────────────────────────────────
if (-not (Test-PostgresConnection)) {
    Show-PostgresInstallGuide
    exit 1
}

Write-Host "[OK] PostgreSQL connection verified" -ForegroundColor Green

# ── Ensure logs dir exists ──────────────────────────────────────
$logsDir = Join-Path $backendDir "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# ── Check if already running ────────────────────────────────────
$alreadyRunning = $false

if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile
    try {
        $proc = Get-Process -Id $oldPid -ErrorAction Stop
        if ($proc.ProcessName -eq "python") {
            try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/api/health" -TimeoutSec 3 -ErrorAction Stop
                Write-Host "[INFO] Already running (PID: $oldPid, port: $PORT)" -ForegroundColor Cyan
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

if (-not $alreadyRunning) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/api/health" -TimeoutSec 2 -ErrorAction Stop
        Write-Host "[INFO] Service already running on port $PORT (.pid file missing or stale)" -ForegroundColor Cyan
        $alreadyRunning = $true
    } catch {}
}

if ($alreadyRunning) {
    Write-Host "[INFO] URLs:"
    Write-Host "  http://localhost:$PORT  (or http://<lan-ip>:$PORT)" -ForegroundColor Green
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
Write-Host "[INFO] Starting Home Theater$(if ($Dev) { ' [DEV MODE]' }) on port $PORT..." -ForegroundColor Cyan

$backendArgs = @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "$PORT")
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
