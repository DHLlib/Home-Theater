@echo off
cd /d "%~dp0"

if not exist "frontend\dist\index.html" (
    echo [HT] frontend not built, building...
    cd frontend
    call npm run build
    if errorlevel 1 (
        echo [HT] build failed
        exit /b 1
    )
    cd ..
)

echo [HT] Starting Home Theater on port 8181...

cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8181
