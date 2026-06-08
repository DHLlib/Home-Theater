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
- **预聚合缓存**：双缓冲表（V1/V2）+ 原子版本切换，首页查询从 ~8s 降至 ~26ms
- **刮削器**：首次启动自动全量刮削，日常 5 分钟检测增量更新，状态持久化
- **播放器格式兼容**：支持 M3U8/MP4/WebM，自动归一化 dytt/xlyun/155m3u8 等后缀
- **移动端适配**：响应式布局、手势操作、全屏适配（含夸克浏览器兼容）
- **日志分类**：按模块路由到独立日志文件（api/source/crawler/download）
- **性能优化**：
  - 后端：下载批量 commit、预聚合双缓冲、SQLite WAL 模式、刮削并发控制
  - 前端：IndexedDB 3 秒超时保护、API AbortController 超时、请求去重/并发限制

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.13, FastAPI, httpx, SQLAlchemy(async), aiosqlite |
| 前端 | React 18, Vite, TypeScript, react-router-dom |
| 播放器 | xgplayer v3 + xgplayer-hls.js |
| 数据库 | SQLite（WAL 模式，启动时自动建表） |
| 部署 | uvicorn + FastAPI 静态托管前端构建产物 |

---

## 快速开始

### 前提

- Python 3.11+（推荐 3.13）
- Node.js 18+ 及 npm

### 1. 安装依赖

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

### 2. 开发模式（前后端分别启动）

**步骤 1：启动后端**（新开一个终端）
```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload
```

- 后端启动后会自动创建 `backend/data/app.db`（SQLite）
- API 地址：`http://localhost:8181`
- `--reload` 修改代码后自动重启，开发时开启

**步骤 2：启动前端**（再新开一个终端）
```bash
cd frontend
npm run dev
```

- 前端地址：`http://localhost:5173`
- `vite.config.ts` 中已配置代理：`/api` → `http://localhost:8181`
- 修改前端代码后浏览器自动热更新

**步骤 3：浏览器访问**
```
http://localhost:5173
```

### 3. 生产模式（单端口）

生产环境不需要启动前端开发服务器，前端构建为静态文件后由 FastAPI 托管。

**步骤 1：构建前端**
```bash
cd frontend
npm run build
```

构建产物位于 `frontend/dist/`，FastAPI 启动后会自动检测并托管。

**步骤 2：启动后端（不带 --reload）**
```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8181
```

**步骤 3：浏览器访问**

方式 A — 本机 IP（局域网内其他设备也可用）：
```
http://<本机IP>:8181
```

方式 B — `localhost.com`（仅限本机，不用记 IP）：
```
http://localhost.com:8181
```

`localhost.com` 已解析到 `127.0.0.1`，直接访问即可。如果断网时无法解析，在 `C:\Windows\System32\drivers\etc\hosts` 添加一行：
```
127.0.0.1  localhost.com
```

`0.0.0.0` 表示监听所有接口，包括 127.0.0.1 和局域网 IP。

### 4. 局域网部署注意事项

- 确保防火墙允许 8181 端口入站（Windows：设置 → 系统 → 远程桌面 → 高级设置 → 入站规则）
- 如果端口被占用，换一个端口：`--port 8080`
- 终止占用端口的进程（Windows）：`taskkill /F /PID <PID>`

---

## 项目结构

```
Home Theater/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI 入口、路由挂载、静态托管（含缓存头）、启动建表
│   │   ├── constants.py      # 项目级常量（HTTP 超时、重试策略、下载/刮削/日志参数）
│   │   ├── models.py         # ORM：Site / Favorite / PlayProgress / DownloadTask / VideoCache / AggregatedVideoV1/V2 / AppConfig
│   │   ├── schemas.py        # Pydantic 请求/响应模型
│   │   ├── db.py             # async engine + session_factory + 列迁移
│   │   ├── logging_config.py # 日志分类路由（api/source/crawler/download）
│   │   ├── api/              # 路由：sites / videos / play / downloads / progress / favorites / settings / sse
│   │   └── services/         # 业务逻辑：source_client / parser / aggregator / downloader / health / crawler / scheduler / resolver
│   ├── data/                 # SQLite 文件（运行时生成）
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── api/              # fetch 封装 + 各模块 API
│   │   ├── pages/            # Home / Search / Detail / Player / Downloads / Favorites / Progress / Settings
│   │   ├── components/       # VideoCard / EpisodeList / SourcePicker / VideoPlayer / CategorySettings / Layout / BottomNav
│   │   ├── utils/            # cache（IndexedDB）/ toast
│   │   └── types.ts          # TypeScript 类型
│   └── vite.config.ts
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
| 预聚合缓存（双缓冲） | `backend/app/services/crawler.py` `_refresh_aggregated_cache` |
| 分类映射（扁平系统分类，互斥约束） | `frontend/src/components/CategorySettings.tsx` |
| 刮削逻辑（全量/增量/状态持久化） | `backend/app/services/crawler.py` + `scheduler.py` |
| 项目常量（禁止魔法数字） | `backend/app/constants.py` |

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload` | 后端开发 |
| `cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8181` | 后端生产 |
| `cd frontend && npm run dev` | 前端开发 |
| `cd frontend && npm run build` | 前端构建（产物由 FastAPI 托管） |
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
