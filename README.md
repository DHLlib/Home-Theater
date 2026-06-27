# Home Theater

个人视频聚合系统。配置多个采集站（资源站），后端并发拉取并按「名称 + 年份」聚合去重，前端以卡片网格展示。播放与下载时由用户**显式选择来源**。支持播放进度记录、收藏、断点续传下载。

本机或局域网访问，纯 Python 部署。

## 特性

- 多源并发采集，按「名称 + 年份」聚合去重
- 本地 `VideoCache` + 预聚合缓存（PostgreSQL），首页/搜索纯本地查询
- 显式选源播放 / 下载，xgplayer 支持 HLS/MP4/WebM
- 播放进度、收藏、断点续传下载
- 分类映射、站点健康探测、后台自动刮削与增量更新
- 深黑影院主题，响应式布局（含移动端适配）

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.13, FastAPI, SQLAlchemy(async), asyncpg, httpx |
| 前端 | React 18, Vite, TypeScript, react-router-dom, framer-motion |
| 播放器 | xgplayer v3 + xgplayer-hls.js |
| 数据库 | PostgreSQL 16+ |
| 部署 | uvicorn / Docker |

## 快速开始

前提：Python 3.11+、Node.js 18+、PostgreSQL 16+。

```powershell
# 1. 配置后端环境
cd backend
copy .env.example .env
# 编辑 .env，设置 DATABASE_URL

# 2. 安装依赖
cd backend && pip install -e .
cd frontend && npm install

# 3. 启动（Windows）
.\start.ps1        # 生产模式
.\start.ps1 -Dev   # 开发模式
.\stop.ps1         # 停止
```

Docker：

```bash
docker compose up --build -d
```

完整 PostgreSQL 安装、数据库初始化与部署细节见 [docs/setup.md](docs/setup.md)。

## 常用命令

| 命令 | 说明 |
|------|------|
| `cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload` | 后端开发 |
| `cd frontend && npm run dev` | 前端开发 |
| `cd frontend && npm run build` | 构建前端 |
| `cd backend && pip install -e ".[dev]" && pytest` | 后端测试 |
| `.\start.ps1` / `.\stop.ps1` | Windows 一键启停 |
| `docker compose up --build -d` | Docker 部署 |

## 项目结构

```
Home Theater/
├── backend/         # FastAPI + 业务逻辑 + PostgreSQL 初始化脚本
├── frontend/        # React + Vite SPA
├── docs/            # 文档（部署、踩坑、设计规格）
├── CLAUDE.md        # 项目硬规范
├── start.ps1        # Windows 一键启动
├── stop.ps1         # Windows 一键停止
└── docker-compose.yml
```

## 文档索引

- [部署与数据库配置](docs/setup.md)
- [踩坑记录](docs/lessons-learned.md)
- [项目规范](CLAUDE.md)
- [设计规格与计划](docs/superpowers/)

## 核心规范

采集站参数、播放地址解析、分类映射、显式选源等硬规范详见 [CLAUDE.md](CLAUDE.md)。
