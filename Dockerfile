# Home Theater - Production Build
# Multi-stage: build frontend → package backend

# ── Stage 1: Build frontend ─────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Backend runtime ────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir -e .

# 复制后端代码
COPY backend/app ./app

# 复制构建好的前端静态文件
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# 日志目录
RUN mkdir -p /app/logs

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
