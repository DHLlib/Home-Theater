#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if [ ! -f "frontend/dist/index.html" ]; then
    echo "[HT] 前端未构建，正在编译..."
    (cd frontend && npm run build)
fi

echo "[HT] 启动 Home Theater..."
echo "[HT] 访问地址: http://$(hostname -I | awk '{print $1}'):8181"

cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8181
