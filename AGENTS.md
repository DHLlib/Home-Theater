# Home Theater — AI Agent 项目指南

> 本文档面向需要阅读、修改或扩展本项目的 AI 编程助手。项目主要文档与注释使用中文，本指南同样以中文撰写。
> 当前分支：`home-theater-v2-postgresql-version`（已完全 PostgreSQL 化，不再保留 SQLite 路径）。

---

## 1. 项目概述

Home Theater 是一个**个人视频聚合系统**。用户可配置多个 AppleCMS 风格的采集站（资源站），后端并发拉取元数据并按「规范化名称 + 年份」聚合去重，前端以卡片网格展示。播放与下载时要求用户**显式选择来源**，不允许自动挑选。

核心功能：
- 多源并发采集与按 `norm_title + year` 聚合去重
- 本地 `VideoCache` + 预聚合中间表（`aggregated_videos`/`aggregated_sources`），首页/搜索优先本地查询
- 显式选源播放 / 下载，xgplayer 支持 HLS/MP4/WebM
- 播放进度记忆、收藏、断点续传下载
- 分类映射、站点健康探测、自动禁用/恢复、后台自动刮削与增量更新
- 深黑影院主题，响应式布局（含移动端适配）

---

## 2. 仓库结构

```
Home-Theater-v2/
├── backend/              # FastAPI 后端
│   ├── app/
│   │   ├── main.py       # 应用入口、lifespan、路由挂载
│   │   ├── config.py     # Pydantic Settings（读取 .env）
│   │   ├── db.py         # 异步 SQLAlchemy engine / session
│   │   ├── models.py     # SQLAlchemy ORM 模型
│   │   ├── schemas.py    # Pydantic 请求/响应模型
│   │   ├── constants.py  # 业务常量（超时、重试、并发数等）
│   │   ├── logging_config.py
│   │   ├── api/          # FastAPI 路由（按领域拆分）
│   │   │   ├── sites.py
│   │   │   ├── videos.py
│   │   │   ├── play.py
│   │   │   ├── downloads.py
│   │   │   ├── progress.py
│   │   │   ├── favorites.py
│   │   │   ├── settings_api.py
│   │   │   ├── sse.py
│   │   │   └── system_categories.py
│   │   ├── services/     # 核心业务逻辑
│   │   │   ├── crawler.py          # 刮削器
│   │   │   ├── aggregator.py       # 聚合中间表重建
│   │   │   ├── downloader.py       # 下载器与调度协调
│   │   │   ├── source_client.py    # 资源站 HTTP 客户端
│   │   │   ├── parser.py           # 播放串解析
│   │   │   ├── resolver.py         # 分享页解析（feifan/dytt 等）
│   │   │   ├── scheduler.py        # 定时任务
│   │   │   ├── health.py           # 站点健康探测
│   │   │   ├── m3u8_sanitizer.py   # m3u8 去广告
│   │   │   ├── category_mapping.py
│   │   │   └── ...
│   │   └── sql/          # PostgreSQL 专用 DDL 脚本
│   ├── test/             # pytest 测试
│   ├── scripts/          # 辅助脚本（simulate_download.py 等）
│   ├── pyproject.toml
│   ├── requirements.txt
│   └── .env.example
├── frontend/             # React + Vite SPA
│   ├── src/
│   │   ├── main.tsx      # React 入口
│   │   ├── App.tsx       # 按 UA 区分桌面/移动端
│   │   ├── router.tsx    # react-router 路由（含 lazy split）
│   │   ├── types.ts      # 全局 TypeScript 类型
│   │   ├── api/          # HTTP 客户端封装
│   │   ├── pages/        # 桌面端页面
│   │   ├── components/   # 共享组件
│   │   ├── desktop/      # 桌面端壳层
│   │   ├── mobile/       # 移动端页面与组件
│   │   ├── hooks/
│   │   ├── utils/        # IndexedDB 缓存、全屏、toast 等
│   │   ├── lib/          # queryClient、theme
│   │   └── styles/
│   ├── package.json
│   ├── vite.config.ts
│   └── vitest.config.ts
├── docs/                 # 架构设计、验收条件、注册表、特性文档
│   ├── architecture/
│   ├── contracts/
│   ├── features/
│   ├── registry/
│   ├── setup.md          # 部署指南
│   └── lessons-learned.md
├── contracts/            # 活跃验收条件
├── start.ps1             # Windows 一键启动（生产/开发）
├── start-dev.ps1         # 开发模式快捷入口
├── stop.ps1              # Windows 一键停止
├── docker-compose.yml
├── Dockerfile
├── pytest.ini
├── README.md
├── DESIGN.md             # 设计系统规范
└── PRODUCT.md            # 产品定位
```

---

## 3. 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.11+（推荐 3.13）、FastAPI、SQLAlchemy 2.0（async）、asyncpg、httpx、aiofiles |
| 前端 | React 18、TypeScript 5、Vite 5、react-router-dom v6、TanStack Query、TanStack Virtual、framer-motion |
| 播放器 | xgplayer v3 + xgplayer-hls.js（hls.js） |
| 数据库 | PostgreSQL 16+ |
| 部署 | uvicorn / Docker / Windows PowerShell 脚本 |

---

## 4. 开发环境准备

### 4.1 必需依赖

- Python 3.11+
- Node.js 18+、npm
- PostgreSQL 16+
- ffmpeg（可选）：m3u8 下载完成后用于合并 TS 片段；未安装时降级为直接字节拼接

### 4.2 初始化数据库

```sql
CREATE DATABASE home_theater;
CREATE USER home_theater WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE home_theater TO home_theater;
```

### 4.3 配置环境变量

```powershell
cd backend
copy .env.example .env
```

关键字段：

```env
DATABASE_URL=postgresql+asyncpg://home_theater:your_password@localhost:5432/home_theater
PORT=8000
LOG_LEVEL=INFO
DEFAULT_DOWNLOAD_ROOT=D:\Downloads
USE_CATEGORY_MAPPING_TABLE=true
```

### 4.4 安装依赖

```bash
# 后端
cd backend
pip install -e ".[dev]"

# 前端
cd frontend
npm install
```

---

## 5. 构建与运行命令

### 5.1 Windows 一键脚本（推荐）

```powershell
# 生产模式：构建前端，后端 8000 端口托管前后端
.\start.ps1

# 开发模式：后端 8000 + 前端 5173 热更新
.\start.ps1 -Dev

# 后台运行
.\start.ps1 -Detach
.\start.ps1 -Dev -Detach

# 停止
.\stop.ps1
```

`start.ps1` 会自动：检测 `.venv`、检查 PostgreSQL 端口连通性、清理旧进程、生产模式下执行 `npm run build`、启动 uvicorn 并等待 `/api/health`。

### 5.2 手动启动

```bash
# 后端
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 前端
cd frontend
npm run dev
```

### 5.3 生产构建

```bash
cd frontend && npm run build
cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

生产模式下后端通过 `CacheControlStaticFiles` 托管 `frontend/dist`，访问 `http://<本机IP>:8000`。

> 注意：每次 `npm run build` 后 lazy chunk 的 content hash 会变，浏览器可能缓存旧 `index.html` 导致动态导入失败。构建后应强制刷新（Ctrl+F5）或清空缓存，且生产模式托管时建议重启后端进程。

### 5.4 Docker 部署

```bash
docker compose up --build -d
docker compose logs -f app
```

---

## 6. 测试

### 6.1 后端测试

```bash
cd backend
pytest
```

- 配置：`pytest.ini` 与 `pyproject.toml` 均设置 `asyncio_mode = auto`。
- 测试数据库默认使用 `DATABASE_URL` 中数据库名的 `_test` 后缀，可通过 `TEST_DB_URL` 覆盖。
- `conftest.py` 在 session 级别建表并安装 `pg_trgm`，每个测试前 `TRUNCATE` 所有业务表保证隔离。
- 现有测试：`test_crawler_upsert.py`、`test_videos_category_cache.py`。

### 6.2 前端测试

```bash
cd frontend
npm run test        # vitest run
npm run typecheck   # tsc --noEmit
```

- 测试框架：Vitest + jsdom + `@testing-library/react`。
- 测试文件：`src/**/*.{test,spec}.{ts,tsx}`。
- `setupTests.ts` 中 mock 了 `matchMedia`。

---

## 7. 代码组织约定

### 7.1 后端

- **入口**：`backend/app/main.py`。所有 router 在 `main.py` 中以 `prefix="/api"` 挂载；router 本身不再带 `/api` 前缀。
- **启动工作目录**：脚本/命令通常在 `backend/` 目录下执行，因此 import 路径为 `app.api.xxx`、`app.services.xxx`。
- **分层**：
  - `api/`：只做参数校验、依赖注入、调用 service，不包含业务逻辑。
  - `services/`：核心业务；跨文件调用时优先通过函数参数传 session，不要直接引用全局 session。
  - `models.py`：所有 ORM 模型集中在此；新增字段后 PostgreSQL 会通过 `Base.metadata.create_all` 自动建表/列。
- **异步**：后端全链路使用 `async`/`await`。HTTP 客户端统一用 `httpx.AsyncClient`；数据库用 `AsyncSession`。
- **常量**：业务相关的固定数值必须写入 `backend/app/constants.py`，禁止在代码中散布魔法数字。

### 7.2 前端

- **入口**：`frontend/src/main.tsx` 渲染 `App`，`App` 按 UA 选择 `desktop/App` 或 `mobile/App`。
- **路由**：`frontend/src/router.tsx` 使用 `createBrowserRouter`，非首屏页面用 `React.lazy` 代码分割。
- **API 客户端**：`frontend/src/api/` 按领域拆分，统一错误处理在 `api/client.ts`。
- **状态管理**：服务端状态使用 TanStack Query；本地 UI 状态用 React `useState`/`useReducer`。
- **缓存**：`utils/cache.ts` 封装 IndexedDB，用于首页聚合、详情、剧集、海报成功状态的本地缓存，启动时清理过期项。
- **实时通讯**：`api/sse.ts` 维护单例 `EventSource`，`pages/Downloads.tsx` 通过 SSE 事件增量更新下载进度。

---

## 8. 代码风格与提交规范

### 8.1 Python

- 使用 Python 3.11+ 特性（如 `str | None`）。
- import 顺序：标准库 → 第三方 → 项目内；项目内按字母顺序排列。
- 类型注解：鼓励完整标注；注意 `from __future__ import annotations` 会延迟注解求值，**静态检查器仍需要正确的 import**，不要漏导入类型。
- 修改后建议手动运行一次静态检查：
  ```bash
  ruff check app --select F
  ```
  项目没有 CI lint，F821 等漏导入问题极易潜伏在冷门分支。

### 8.2 TypeScript

- `tsconfig.json` 启用 `strict`、`noUnusedLocals`、`noUnusedParameters`。
- React hooks 必须全部在任何 `return` 之前无条件调用；条件渲染只能放在所有 hook 之后。
- 错误提示文案处理 `data.detail` 时要做类型判断，避免 Toast 渲染对象导致白屏。

### 8.3 CSS / UI

- 设计系统见 `DESIGN.md`。
- 核心规则：
  - 背景保持 `#000000`（Black Hole Rule）。
  - 强调色只用 `#4ade80` 呼吸绿，同屏绿色不超过一处（One Breath Rule）。
  - 默认不用 `box-shadow` 表达层级，用液态玻璃 `backdrop-filter: blur(20px)` 或色调分层。
  - 所有动画必须响应 `prefers-reduced-motion`。
  - 触摸目标 ≥ 44×44 dp。
  - 多主题场景使用语义 CSS 变量（`--primary`、`--danger`、`--glass-border` 等），禁止硬编码绿/红色值。

---

## 9. 关键架构决策

### 9.1 数据流

1. 用户添加资源站（`api/sites.py`）。
2. 后台调度器（`services/scheduler.py`）触发刮削器（`services/crawler.py`）拉取 `ac=list` 和 `ac=videolist`，写入 `video_cache`。
3. 刮削完成后通知聚合器（`services/aggregator.py`）重建/增量更新 `aggregated_videos` + `aggregated_sources` 中间表。
4. 首页/搜索默认从聚合中间表读取；分类筛选带映射时也可走预聚合路径。
5. 详情页优先读 `video_cache` 缓存（7 天 TTL），未命中或需要最新选集时实时回源。
6. 播放/下载时，后端解析原始播放串（`parser.py`/`resolver.py`），将 `*m3u8`、`*yun`、`360zy`、`dytt` 等后缀统一归一化为 `ffm3u8`；前端 `VideoPlayer.tsx` 按后缀选择播放器。

### 9.2 聚合去重

- 去重键：`normalize_title(title) + year`。
- 预聚合表：`aggregated_videos`（视频维度） + `aggregated_sources`（来源维度），替代早期物化视图。
- 首页排序按 `source_updated_at DESC`（资源站实际更新时间），不是 `cached_at`。

### 9.3 下载器

- 协调器：`download_coordinator` 单协程轮询 `download_tasks`，通过 `UPDATE ... RETURNING` 原子取任务。
- 直链下载：HTTP Range 断点续传，区分 200 / 206 / 416。
- m3u8 下载：并发 5 个协程下载 `.ts` 片段，跳过已存在片段；合并优先 ffmpeg，失败降级为直接拼接字节。
- 暂停/删除：内存级 `_task_stop_events` + 数据库状态双重信号；删除时清理 `.ts_{task_id}/` 临时目录。
- 进度推送：SSE `download_progress` / `download_status` 事件；DB commit 与 SSE 推送是两件独立的事。

### 9.4 分类映射

- 系统分类：`system_categories` 表，父子层级（电影/连续剧/综艺/动漫/其他）。
- 站点分类映射：`site_category_mappings` 表，`(site_id, remote_id)` 唯一。
- 读路径通过 `USE_CATEGORY_MAPPING_TABLE` 控制，默认走数据库表。
- 前端分类筛选用 `category=` 参数，不是 `t=`（后者直接透传给资源站）。

### 9.5 前端 IndexedDB 缓存

- 缓存类型：aggregated、detail、episodes、poster_success。
- TTL 与过期清理由 `utils/cache.ts` 管理；所有 IndexedDB 操作带 3 秒超时，避免阻塞 UI。
- 首页写入缓存采用 fire-and-forget，不能放在影响 loading 状态的 `try/finally` 中。

---

## 10. 安全与运维注意事项

### 10.1 环境变量

- `.env` 文件不上库（已加入 `.gitignore`）。
- `DATABASE_URL` 包含密码，不要提交到版本控制或日志。
- 生产部署应设置强密码，避免使用默认 `home_theater_pass`。

### 10.2 SQL 注入防护

- 除 `pg_trgm` 索引创建、`NOTIFY` 等 PG 原生命令外，所有数据库查询使用 SQLAlchemy ORM/参数化查询。
- `NOTIFY` payload 使用 dollar-quoting 内联，避免字符串拼接风险。

### 10.3 外部资源

- 资源站 API、播放地址、海报图片均来自第三方，存在不稳定、失效、被墙风险。
- 海报图床失败是常态，任何「按候选列表 fallback」的组件都要确保候选耗尽时不破坏 React hooks 顺序。

### 10.4 并发与状态

- SQLAlchemy `AsyncSession` 不是协程安全的；多个协程不能同时 `refresh`/`commit` 同一个 session。
- 下载 worker 中所有 ORM 操作通过 `_session_lock` 串行，或重新 `session.get()` 加载对象。
- 站点健康计数器是内存字典，多进程部署时不共享状态。

### 10.5 日志

- 后端日志写入 `backend/logs/`（按领域拆分：`api.log`、`crawler.log`、`download.log` 等）。
- 不要同时启动多个后端进程写入同一日志文件，否则 `RotatingFileHandler` 轮转时会报 `PermissionError`。
- 调试/测试启动的临时进程，结束后必须清理。

---

## 11. 常见踩坑速查

项目积累了大量实战经验，详见：

- `docs/lessons-learned.md`：前端/后端具体 bug 与修复。
- `lesson_learn.md`：下载器、聚合中间表重建、PostgreSQL NOTIFY 等深度复盘。

下面列出最高频的几个：

| 问题 | 关键点 |
|------|--------|
| 端口冲突 | 默认后端 8000，前端开发 5173；旧版本曾因冲突改为 8181，当前以 `.env` 中 `PORT` 为准。 |
| 分类查询 0 条 | 资源站 `t` 参数只接受**子分类**数字 ID，父分类（`type_pid=0`）必须过滤掉。 |
| 首页数据排序抖动 | 排序字段是 `source_updated_at`，不是 `cached_at`；批量 upsert 要跳过未变化记录。 |
| 预聚合分页重复/回弹 | 扫描窗口放大时，`offset` 必须按放大后的窗口步进，不能按输出条数步进。 |
| React #300 白屏 | hooks 必须全部在任意 `return` 之前无条件调用；生产构建 minified 栈先用 `build.sourcemap: true` 定位。 |
| 播放格式不支持 | 后端 `play.py` 与前端 `VideoPlayer.tsx` 的 HLS 检测逻辑必须一致；统一用 `.endsWith("m3u8") \|\| .endsWith("yun")`。 |
| 暂停/删除运行中任务 | 仅靠 DB 轮询有延迟；必须配合内存 stop event，删除时同步清理 `.ts_{task_id}/` 临时目录。 |
| 下载进度不更新 | 直链/m3u8 每次批量 commit 后必须发送 `download_progress` SSE 事件。 |

---

## 12. 修改代码时的检查清单

1. 后端修改后，确认没有遗留 Python 语法错误：
   ```bash
   python -m py_compile backend/app/xxx.py
   ```
2. 前端修改后，运行类型检查与测试：
   ```bash
   cd frontend && npm run typecheck && npm run test
   ```
3. 涉及数据库模型字段变更时，确保 `models.py` 已正确导入/导出；PostgreSQL 下启动会自动建列。
4. 涉及前后端共同概念（如「是否为 m3u8」）时，两端判断逻辑必须同步修改。
5. 新增 UI 颜色/样式时，检查是否使用了主题 CSS 变量，是否同时适配 `:root` 与 `[data-theme="crimson"]`。
6. 涉及并发/协程时，确认 SQLAlchemy session 不跨协程共享，下载器状态竞争用条件 UPDATE 或锁保护。
7. 修改后若服务行为未变，优先检查是否有残留 Python/uvicorn 进程：
   ```powershell
   .\stop.ps1
   # 或手动
   taskkill //F //IM python.exe
   ```

---

## 13. 扩展方向提示

- 新增资源站支持：通常只需调整 `source_client.py`、`parser.py`、`resolver.py` 中的后缀/分享页解析逻辑。
- 新增前端页面：在 `frontend/src/pages/` 创建组件，在 `router.tsx` 中注册路由；移动端同步在 `mobile/pages/` 添加。
- 新增后端 API：在 `backend/app/api/` 新增文件，导出 `router`，在 `main.py` 中 `app.include_router(..., prefix="/api")`。
- 新增定时任务：在 `services/scheduler.py` 中注册。
- 新增分类/映射模板：参考 `services/template_manager.py` 与 `CategoryTemplate` schema。

---

## 14. 参考文档索引

- `README.md`：快速开始与常用命令
- `docs/setup.md`：PostgreSQL 安装、初始化、部署细节
- `DESIGN.md`：深黑影院设计系统
- `PRODUCT.md`：产品定位与用户画像
- `docs/lessons-learned.md`：踩坑记录
- `lesson_learn.md`：深度复盘
- `docs/registry/system-context.md`：已实现 AC、API/路由/模型清单
- `contracts/acceptance-criteria.md`：活跃验收条件
