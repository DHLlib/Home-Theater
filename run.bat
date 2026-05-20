@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

if not exist "frontend\dist\index.html" (
    echo [HT] 前端未构建，正在编译...
    cd frontend
    call npm run build
    if errorlevel 1 (
        echo [HT] 前端构建失败
        exit /b 1
    )
    cd ..
)

echo [HT] 启动 Home Theater...
echo [HT] 访问地址: http://本机IP:8181

cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8181
