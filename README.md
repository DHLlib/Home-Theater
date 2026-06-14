# Home Theater

个人视频聚合系统。配置多个采集站（资源站），后端并发拉取、按「名称 + 年份」聚合去重，前端以卡片网格展示。播放与下载时要求用户**显式选择来源**，禁止自动挑选。支持播放进度记录、收藏、断点续传下载。

本机或局域网访问，纯 Python 部署。

---

## 功能

- **首页聚合**：跨多源并发查询，同名同年合并为一张卡片
- **搜索**：以关键字跨所有源并发搜索
- **详情页**：封面、简介、年份、地区、演员表、导演、选集列表
- **播放**：xgplayer 播放（支持 HLS/m3u8、MP4），内置手势控制、自动隐藏控件，播放进度自动保存
- **下载**：HTTP Range 断点续传，支持暂停/继续，m3u8 下载完成后可选 ffmpeg 合并为 MP4，下载根目录一次性配置
- **收藏**：单用户收藏列表，保留来源信息
- **站点管理**：采集站 CRUD、连通性探测、远程分类抓取、批量嗅探添加、站点健康自动禁用/恢复
- **数据完整性**：站点删除时级联清理关联数据，支持手动/每日定时批量补全缺失的 videolist 详情
- **分类映射**：将各站点的子分类映射到统一的层级系统分类，支持禁用/启用
- **本地聚合数据库**：后台自动刮削资源站数据到 VideoCache，首页/搜索纯本地查询
- **预聚合缓存**：PostgreSQL 物化视图（MATERIALIZED VIEW）/ SQLite 双缓冲表，首页查询从 ~8s 降至 ~26ms
- **刮削器**：首次启动自动全量刮削，日常 5 分钟检测增量更新，每日 04:00 自动全量补 videolist，状态持久化
- **播放器格式兼容**：支持 M3U8/MP4/WebM，自动归一化 dytt/xlyun/155m3u8 等后缀
- **移动端适配**：响应式布局、手势操作、全屏适配（含夸克浏览器兼容）
- **分类禁用**：系统分类和站点映射支持单独禁用，禁用后首页自动过滤
- **SSE 实时推送**：下载进度、站点健康状态实时推送到前端
- **清除失效资源**：一键清理远程已下架的幽灵视频
- **日志分类**：按模块路由到独立日志文件（api/source/crawler/download）
- **深黑影院主题（v2.1）**：强制深黑基底、Cinzel + Noto Sans SC 字体、液态玻璃导航、页面转场动画、海报悬停光晕
- **性能优化**：
  - 后端：下载批量 commit、物化视图预聚合、PostgreSQL 连接池、刮削并发控制
  - 前端：IndexedDB 3 秒超时保护、API AbortController 超时、请求去重/并发限制

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.13, FastAPI, httpx, SQLAlchemy(async), asyncpg |
| 前端 | React 18, Vite, TypeScript, react-router-dom, framer-motion |
| 播放器 | xgplayer v3 + xgplayer-hls.js |
| 数据库 | SQLite（默认）/ PostgreSQL 16+（可选） |
| 部署 | uvicorn + FastAPI 静态托管前端构建产物 / Docker |

---

## 部署前置：PostgreSQL 安装与配置（可选）

SQLite 为项目默认数据库，个人本机使用无需额外安装。如需使用 PostgreSQL 获得更高性能（特别是大数据量首页聚合），按以下流程安装配置。

### 系统要求

- PostgreSQL 16+（推荐最新稳定版）
- 至少 2GB 可用磁盘空间（数据增长取决于视频缓存量）
- 默认端口 `5432` 未被占用

### 安装方式

#### Windows

**方式一 — 官网安装包（推荐）**：
1. 访问 https://www.postgresql.org/download/windows/
2. 下载 PostgreSQL 16+ Windows 安装包（x64）
3. 运行安装向导，注意以下选项：
   - 安装目录：默认 `C:\Program Files\PostgreSQL\16`
   - 数据目录：默认即可
   - 密码：**务必记住**，安装程序会要求为 `postgres` 超级用户设置密码
   - 端口：保持默认 `5432`
   - Locale：保持默认或选择 `Chinese (Simplified), China`
4. 安装完成后，pgAdmin 4 和 psql 命令行工具已自动安装

**方式二 — Chocolatey**：
```powershell
choco install postgresql
```

**方式三 — Scoop**：
```powershell
scoop install postgresql
```

#### Linux（Ubuntu/Debian）

```bash
# 添加官方仓库
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -

# 安装
sudo apt update
sudo apt install postgresql-16

# 启动并设置开机自启
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

#### macOS

```bash
# 使用 Homebrew
brew install postgresql@16

# 启动服务
brew services start postgresql@16
```

#### Docker（快速体验，不推荐生产）

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

### 数据库初始化

安装完成后，需要创建数据库和用户。

**命令行方式（psql）**：

```powershell
# Windows：从开始菜单打开 "SQL Shell (psql)"，或直接运行
psql -U postgres
```

```sql
-- 创建数据库
CREATE DATABASE home_theater;

-- 创建用户（可选，可直接用 postgres 用户）
CREATE USER home_theater WITH PASSWORD 'your_password';

-- 授权
GRANT ALL PRIVILEGES ON DATABASE home_theater TO home_theater;

-- 退出
\q
```

**pgAdmin 4（图形化，推荐新手）**：

1. **连接服务器**
   - 打开 pgAdmin 4，左侧展开 `Servers` → 双击 `PostgreSQL 16`
   - 输入安装时设置的 `postgres` 密码
   - 如未显示服务器：右键 `Servers` → `Register` → `Server`
     - General 标签：Name 填 `localhost`
     - Connection 标签：Host `localhost`，Port `5432`，Username `postgres`

2. **创建数据库**
   - 展开 `Servers` → `localhost` → `Databases`
   - 右键 `Databases` → `Create` → `Database...`
   - Database 填 `home_theater`，Owner 选 `postgres`，点击 Save

3. **创建用户（可选）**
   - 展开 `Servers` → `localhost` → `Login/Group Roles`
   - 右键 → `Create` → `Login/Group Role...`
   - General：Name 填 `home_theater`
   - Definition：Password 填密码
   - Privileges：勾选 `Can login?`

4. **授权**
   - 右键 `home_theater` 数据库 → `Query Tool`
   - 粘贴 `GRANT ALL PRIVILEGES ON DATABASE home_theater TO home_theater;`
   - F5 执行

### 验证连接

```bash
# 使用 psql 验证
psql postgresql://home_theater:your_password@localhost:5432/home_theater -c "SELECT version();"
```

输出包含 `PostgreSQL 16.x` 即表示连接成功。

### 常见问题

| 问题 | 解决 |
|------|------|
| `psql: 连接被拒绝` | 检查 PostgreSQL 服务是否启动（Windows 服务管理器 / `systemctl status postgresql`） |
| `密码认证失败` | 确认 `.env` 中的密码与安装时设置的一致 |
| `数据库不存在` | 先执行 `CREATE DATABASE home_theater;` |
| `端口 5432 被占用` | 修改 PostgreSQL 端口后，`.env` 中的 `DATABASE_URL` 也要同步修改 |

---

## 快速开始

### 前提

- Python 3.11+（推荐 3.13）
- Node.js 18+ 及 npm
- 数据库：SQLite 为默认零配置方案；PostgreSQL 16+ 为可选高性能方案（见上方【部署前置】）
- **ffmpeg（可选）**：用于 m3u8 下载后的 TS 片段合并为 MP4；未安装时会自动降级为直接字节拼接，部分编码可能不兼容

### 1. 配置环境变量

复制示例配置文件并修改数据库密码：
```powershell
cd backend
copy .env.example .env
```

编辑 `.env`：
```env
# PostgreSQL（推荐用于大数据量）
DATABASE_URL=postgresql+asyncpg://home_theater:your_password@localhost:5432/home_theater

# 或 SQLite（零配置，适合个人本机使用）
# DATABASE_URL=sqlite+aiosqlite:///data/app.db

PORT=8000
LOG_LEVEL=INFO
DEFAULT_DOWNLOAD_ROOT=D:\Downloads
```

### 2. 安装依赖

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

### 3. 一键启动（Windows）

```powershell
# 生产模式（单端口托管前后端）
.\start.ps1

# 开发模式（后端 8000 + 前端 5173 热更新）
.\start.ps1 -Dev

# 停止
.\stop.ps1
```

`start.ps1` 会自动检测 PostgreSQL 连通性，未安装时会输出安装教程。

### 4. 手动启动（跨平台）

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

### 5. Docker 部署

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
│   │   ├── api/              # 路由：sites / videos / play / downloads / progress / favorites / settings / sse / system_categories
│   │   ├── services/         # 业务逻辑：source_client / parser / aggregator / downloader / health / crawler / scheduler / resolver / listen_manager / notify_sender / site_deleter
│   │   └── sql/              # PostgreSQL 初始化脚本（物化视图、全文搜索）
│   ├── .env.example          # 环境变量示例
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── api/              # fetch 封装 + 各模块 API
│   │   ├── pages/            # Home / Search / Detail / Player / Downloads / Favorites / Progress / Settings
│   │   ├── components/       # VideoCard / EpisodeList / SourcePicker / VideoPlayer / CategorySettings / Layout / BottomNav / CategoryBar / AddSiteDialog / BatchSniffDialog / SiteHealthDrawer
│   │   ├── utils/            # cache（IndexedDB）/ toast
│   │   └── types.ts          # TypeScript 类型
│   └── vite.config.ts
├── docker-compose.yml        # Docker 一键部署
├── Dockerfile                # 多阶段构建（前端 + 后端）
├── start.ps1                 # Windows 一键启动
├── stop.ps1                  # Windows 一键停止
├── docs/
│   ├── crawler-flow.html     # 刮削/数据完整性/站点健康业务流程图
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
| 分类禁用过滤 | `backend/app/api/videos.py` `_video_has_enabled_source` |
| 主题系统（深黑影院，CSS 变量） | `frontend/src/styles/global.css` + `frontend/src/App.tsx` |
| 刮削逻辑（全量/增量/状态持久化） | `backend/app/services/crawler.py` + `scheduler.py` |
| 站点删除与级联清理 | `backend/app/services/site_deleter.py` |
| 批量补 videolist / 每日定时补全 | `backend/app/services/crawler.py` `fill_missing_videolist` |
| 站点健康探测与自动禁用/恢复 | `backend/app/services/scheduler.py` `_probe_loop` / `_on_probe_*` |
| SSE 实时推送 | `backend/app/api/sse.py` + `listen_manager.py` |
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
