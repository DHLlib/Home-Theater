# Home Theater

个人视频聚合系统。配置多个采集站（资源站），后端并发拉取、按「名称 + 年份」聚合去重，前端以卡片网格展示。播放与下载时要求用户**显式选择来源**，禁止自动挑选。支持播放进度记录、收藏、断点续传下载。

本机或局域网访问，纯 Python 部署。

---

## 功能

- **首页聚合**：跨多源并发查询，同名同年合并为一张卡片
- **搜索**：以关键字跨所有源并发搜索
- **详情页**：封面、简介、年份、地区、演员表、导演、选集列表
- **播放**：xgplayer 播放（支持 HLS/m3u8、MP4），内置手势控制、自动隐藏控件，播放进度自动保存
- **下载**：HTTP Range 断点续传，支持暂停/继续，下载根目录一次性配置
- **收藏**：单用户收藏列表，保留来源信息
- **站点管理**：采集站 CRUD、连通性探测、远程分类抓取
- **分类映射**：将各站点的子分类映射到统一的扁平系统分类
- **本地聚合数据库**：后台自动刮削资源站数据到 VideoCache，首页/搜索纯本地查询
- **预聚合缓存**：PostgreSQL 物化视图（MATERIALIZED VIEW），首页查询从 ~8s 降至 ~26ms
- **刮削器**：首次启动自动全量刮削，日常 5 分钟检测增量更新，状态持久化
- **播放器格式兼容**：支持 M3U8/MP4/WebM，自动归一化 dytt/xlyun/155m3u8 等后缀
- **移动端适配**：响应式布局、手势操作、全屏适配（含夸克浏览器兼容）
- **日志分类**：按模块路由到独立日志文件（api/source/crawler/download）
- **性能优化**：
  - 后端：下载批量 commit、物化视图预聚合、PostgreSQL 连接池、刮削并发控制
  - 前端：IndexedDB 3 秒超时保护、API AbortController 超时、请求去重/并发限制

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.13, FastAPI, httpx, SQLAlchemy(async), asyncpg |
| 前端 | React 18, Vite, TypeScript, react-router-dom |
| 播放器 | xgplayer v3 + xgplayer-hls.js |
| 数据库 | PostgreSQL 16+ |
| 部署 | uvicorn + FastAPI 静态托管前端构建产物 / Docker |

---

## 快速开始

### 前提

- Python 3.11+（推荐 3.13）
- Node.js 18+ 及 npm
- PostgreSQL 16+（见下方安装教程）

### 1. 安装 PostgreSQL

**Windows（PowerShell）**

方式一 — 官网安装包（推荐）：
1. 访问 https://www.postgresql.org/download/windows/
2. 下载 PostgreSQL 16+ 安装包
3. 安装时记住密码，端口保持默认 `5432`

方式二 — Chocolatey：
```powershell
choco install postgresql
```

方式三 — Scoop：
```powershell
scoop install postgresql
```

**方式 A — 命令行（psql）**：
```powershell
psql -U postgres
```
```sql
CREATE DATABASE home_theater;
CREATE USER home_theater WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE home_theater TO home_theater;
\q
```

**方式 B — pgAdmin 4（图形化，推荐新手）**：

pgAdmin 4 安装 PostgreSQL 时默认已附带，在开始菜单搜索打开即可。

1. **连接服务器**
   - 左侧展开 `Servers` → 双击 `PostgreSQL 16`
   - 输入安装时设置的密码
   - 如未显示服务器，右键 `Servers` → `Register` → `Server`
     - General 标签：Name 填 `localhost`
     - Connection 标签：Host `localhost`，Port `5432`，Username `postgres`，Password 填安装密码，勾选 Save password

2. **创建数据库**
   - 展开 `Servers` → `localhost` → `Databases`
   - 右键 `Databases` → `Create` → `Database...`
   - Database 填 `home_theater`
   - Owner 选择 `postgres`
   - 点击 Save

3. **创建用户（可选）**
   - 展开 `Servers` → `localhost` → `Login/Group Roles`
   - 右键 `Login/Group Roles` → `Create` → `Login/Group Role...`
   - General 标签：Name 填 `home_theater`
   - Definition 标签：Password 填你的密码
   - Privileges 标签：勾选 `Can login?`
   - 点击 Save

4. **授权**
   - 右键 `home_theater` 数据库 → `Query Tool...`
   - 在右侧 SQL 编辑器粘贴：
     ```sql
     GRANT ALL PRIVILEGES ON DATABASE home_theater TO home_theater;
     ```
   - 按 F5 或点击上方闪电图标执行

> 个人使用可跳过创建独立用户，直接用 `postgres` 用户连接。此时 `.env` 中用户名写 `postgres` 即可。

### 2. 配置环境变量

复制示例配置文件并修改数据库密码：
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

### 3. 安装依赖

**后端**：
```bash
cd backend
pip install -e .
```

**前端**：
```bash
cd frontend
npm install
```

### 4. 一键启动（Windows）

```powershell
# 生产模式（单端口托管前后端）
.\start.ps1

# 开发模式（后端 8000 + 前端 5173 热更新）
.\start.ps1 -Dev

# 停止
.\stop.ps1
```

`start.ps1` 会自动检测 PostgreSQL 连通性，未安装时会输出安装教程。

### 5. 手动启动（跨平台）

**开发模式（前后端分别启动）**

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

**生产模式（单端口）**

```bash
cd frontend && npm run build
cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

浏览器访问：`http://<本机IP>:8000`（局域网可用）或 `http://localhost.com:8000`（本机）

### 6. Docker 部署

```bash
# 一键启动（含 PostgreSQL + 应用）
docker compose up --build -d

# 查看日志
docker compose logs -f app

# 停止
docker compose down
```

数据通过 Docker volume 持久化，重启不丢失。

---

## 局域网部署注意事项

- 确保防火墙允许 `8000` 端口入站（Windows：设置 → 系统 → 远程桌面 → 高级设置 → 入站规则）
- 如果端口被占用，修改 `.env` 中的 `PORT` 后重新启动
- `localhost.com` 已解析到 `127.0.0.1`，本机可直接访问。断网时若无法解析，在 `C:\Windows\System32\drivers\etc\hosts` 添加：`127.0.0.1 localhost.com`

---

## 项目结构

```
Home Theater/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI 入口、路由挂载、静态托管（含缓存头）、启动建表
│   │   ├── constants.py      # 项目级常量（HTTP 超时、重试策略、下载/刮削/日志参数）
│   │   ├── models.py         # ORM：Site / Favorite / PlayProgress / DownloadTask / VideoCache / mv_aggregated_videos / AppConfig
│   │   ├── schemas.py        # Pydantic 请求/响应模型
│   │   ├── db.py             # async engine + session_factory
│   │   ├── config.py         # 配置读取（Pydantic Settings，从 .env 加载）
│   │   ├── logging_config.py # 日志分类路由（api/source/crawler/download）
│   │   ├── api/              # 路由：sites / videos / play / downloads / progress / favorites / settings / sse
│   │   └── services/         # 业务逻辑：source_client / parser / aggregator / downloader / health / crawler / scheduler / resolver
│   ├── .env.example          # 环境变量示例
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── api/              # fetch 封装 + 各模块 API
│   │   ├── pages/            # Home / Search / Detail / Player / Downloads / Favorites / Progress / Settings
│   │   ├── components/       # VideoCard / EpisodeList / SourcePicker / VideoPlayer / CategorySettings / Layout / BottomNav
│   │   ├── utils/            # cache（IndexedDB）/ toast
│   │   └── types.ts          # TypeScript 类型
│   └── vite.config.ts
├── docker-compose.yml        # Docker 一键部署
├── Dockerfile                # 多阶段构建（前端 + 后端）
├── start.ps1                 # Windows 一键启动
├── stop.ps1                  # Windows 一键停止
├── docs/
│   ├── lessons-learned.md    # 排错/踩坑记录
│   └── superpowers/          # 设计规格与实施计划
└── CLAUDE.md                 # 项目硬规范（资源站参数、播放地址解析、分类映射）
```

---

## 核心规范速查

所有与采集站交互的代码必须遵守以下硬规范（详见 `CLAUDE.md`）：

| 规范 | 唯一落点 |
|------|---------|
| 资源站参数 `ac/t/pg/wd/h/ids` 构造 | `backend/app/services/source_client.py` |
| `集数$地址$后缀` 多行解析 | `backend/app/services/parser.py` |
| `名称+年份` 聚合去重 | `backend/app/services/aggregator.py` |
| 显式选源（无默认） | `frontend/src/components/SourcePicker.tsx` |
| 下载根目录一次性配置 | `backend/app/api/settings_api.py` + `frontend/src/pages/Settings.tsx` |
| 预聚合缓存（物化视图） | `backend/app/services/aggregator.py` `refresh_aggregated_view` |
| 分类映射（扁平系统分类，互斥约束） | `frontend/src/components/CategorySettings.tsx` |
| 刮削逻辑（全量/增量/状态持久化） | `backend/app/services/crawler.py` + `scheduler.py` |
| 项目常量（禁止魔法数字） | `backend/app/constants.py` |

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload` | 后端开发 |
| `cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000` | 后端生产 |
| `cd frontend && npm run dev` | 前端开发 |
| `cd frontend && npm run build` | 前端构建（产物由 FastAPI 托管） |
| `.\start.ps1` | Windows 一键启动（生产模式） |
| `.\start.ps1 -Dev` | Windows 一键启动（开发模式） |
| `.\stop.ps1` | Windows 一键停止 |
| `docker compose up --build -d` | Docker 部署 |
| `taskkill //F //IM python.exe` | 终止所有 Python 进程（Windows） |

---

## 排错优先顺序

遇到异常时：

1. **查 `docs/lessons-learned.md`** — 过往错误有很高的重复命中概率
2. **查 `CLAUDE.md`** — 核对硬规范（资源站参数、播放地址解析、分类映射）
3. **查代码** — 当前实现是否偏离上述规范

---

## 文档索引

- **设计规格**：`docs/superpowers/specs/`
- **实施计划**：`docs/superpowers/plans/`
- **踩坑记录**：`docs/lessons-learned.md`
- **项目规范**：`CLAUDE.md`
