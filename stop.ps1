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
$FRONTEND_DEV_PORT = 5173

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

function Stop-IfHomeTheater($id, $pattern, $description) {
    if (Confirm-HomeTheaterProcess $id $pattern) {
        try {
            Stop-Process -Id $id -Force -ErrorAction Stop
            Write-Host "[OK] Stopped $description (PID: $id)" -ForegroundColor Green
            return $true
        } catch {
            Write-Host "[WARN] Failed to stop $description (PID: $id)" -ForegroundColor Yellow
            return $false
        }
    }
    return $false
}

$stopped = @()

# Stop by PID files
if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile
    if (Stop-IfHomeTheater $pidValue "uvicorn" "backend") {
        $stopped += "backend PID $pidValue"
    } else {
        Write-Host "[WARN] Backend .pid does not point to a Home Theater process, removing" -ForegroundColor Yellow
    }
    Remove-Item $pidFile -Force
}

if (Test-Path $pidFileFrontend) {
    $pidValue = Get-Content $pidFileFrontend
    if (Stop-IfHomeTheater $pidValue "vite" "frontend dev server") {
        $stopped += "frontend PID $pidValue"
    } else {
        Write-Host "[WARN] Frontend .pid does not point to a Home Theater process, removing" -ForegroundColor Yellow
    }
    Remove-Item $pidFileFrontend -Force
}

# Stop by ports
$backendPid = Get-ProcessIdByPort $PORT
if ($backendPid -and (Stop-IfHomeTheater $backendPid "uvicorn" "backend on port $PORT")) {
    $stopped += "backend on port $PORT (PID $backendPid)"
}

$frontendPid = Get-ProcessIdByPort $FRONTEND_DEV_PORT
if ($frontendPid -and (Stop-IfHomeTheater $frontendPid "vite" "frontend dev server on port $FRONTEND_DEV_PORT")) {
    $stopped += "frontend dev server on port $FRONTEND_DEV_PORT (PID $frontendPid)"
}

# Fallback: scan for orphan processes in the project directory
$orphanBackend = Get-Process python -ErrorAction SilentlyContinue | Where-Object {
    Confirm-HomeTheaterProcess $_.Id "uvicorn*app.main:app"
}
foreach ($p in $orphanBackend) {
    if (Stop-IfHomeTheater $p.Id "uvicorn*app.main:app" "orphan backend") {
        $stopped += "orphan backend PID $($p.Id)"
    }
}

$orphanFrontend = Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    Confirm-HomeTheaterProcess $_.Id "vite"
}
foreach ($p in $orphanFrontend) {
    if (Stop-IfHomeTheater $p.Id "vite" "orphan frontend dev server") {
        $stopped += "orphan frontend PID $($p.Id)"
    }
}

if ($stopped.Count -gt 0) {
    Write-Host "[OK] All Home Theater processes stopped" -ForegroundColor Green
} else {
    Write-Host "[INFO] No running Home Theater process found" -ForegroundColor Cyan
}
