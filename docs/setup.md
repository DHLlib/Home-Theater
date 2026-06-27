# Home Theater 部署指南

本分支已完全 PostgreSQL 化，不再保留 SQLite 路径。部署前请先安装并初始化 PostgreSQL。

## 系统要求

- Python 3.11+（推荐 3.13）
- Node.js 18+ 及 npm
- PostgreSQL 16+
- ffmpeg（可选）：用于 m3u8 下载后的 TS 片段合并；未安装时会降级为直接字节拼接

## 安装 PostgreSQL

### Windows

**方式一 — 官网安装包（推荐）**：
1. 访问 https://www.postgresql.org/download/windows/
2. 下载 PostgreSQL 16+ 安装包
3. 按向导安装，记住为 `postgres` 用户设置的密码，端口保持默认 `5432`

**方式二 — Chocolatey**：
```powershell
choco install postgresql
```

**方式三 — Scoop**：
```powershell
scoop install postgresql
```

### Linux（Ubuntu/Debian）

```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt update
sudo apt install postgresql-16
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### macOS

```bash
brew install postgresql@16
brew services start postgresql@16
```

### Docker（快速体验）

```bash
docker run -d \
  --name home-theater-pg \
  -e POSTGRES_DB=home_theater \
  -e POSTGRES_USER=home_theater \
  -e POSTGRES_PASSWORD=your_password \
  -p 5432:5432 \
  -v pgdata:/var/lib/postgresql/data \
  postgres:16
```

## 初始化数据库

使用 psql：

```powershell
psql -U postgres
```

```sql
CREATE DATABASE home_theater;
CREATE USER home_theater WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE home_theater TO home_theater;
\q
```

验证连接：

```bash
psql postgresql://home_theater:your_password@localhost:5432/home_theater -c "SELECT version();"
```

## 配置环境变量

```powershell
cd backend
copy .env.example .env
```

编辑 `.env`：

```env
DATABASE_URL=postgresql+asyncpg://home_theater:your_password@localhost:5432/home_theater
PORT=8000
LOG_LEVEL=INFO
DEFAULT_DOWNLOAD_ROOT=D:\Downloads
```

## 安装依赖

后端：

```bash
cd backend
pip install -e .
```

前端：

```bash
cd frontend
npm install
```

## 启动

### Windows 一键脚本

```powershell
# 生产模式（单端口托管前后端）
.\start.ps1

# 开发模式（后端 8000 + 前端 5173 热更新）
.\start.ps1 -Dev

# 停止
.\stop.ps1
```

### 手动启动

后端（终端 1）：

```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

前端（终端 2）：

```bash
cd frontend
npm run dev
```

浏览器访问：`http://localhost:5173`

### 生产模式

```bash
cd frontend && npm run build
cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

浏览器访问：`http://<本机IP>:8000`（局域网可用）或 `http://localhost.com:8000`（本机）

### Docker 一键部署

```bash
docker compose up --build -d
docker compose logs -f app
docker compose down
```

数据通过 Docker volume 持久化。

## 局域网访问

- 确保防火墙允许 `8000` 端口入站
- `localhost.com` 已解析到 `127.0.0.1`，本机可直接访问；断网无法解析时，在 `hosts` 文件添加 `127.0.0.1 localhost.com`

## 常见问题

| 问题 | 解决 |
|------|------|
| `psql: 连接被拒绝` | 检查 PostgreSQL 服务是否启动 |
| `密码认证失败` | 确认 `.env` 中的密码与安装时设置的一致 |
| `数据库不存在` | 先执行 `CREATE DATABASE home_theater;` |
| `端口 5432 被占用` | 修改 PostgreSQL 端口后，同步修改 `.env` 中的 `DATABASE_URL` |
