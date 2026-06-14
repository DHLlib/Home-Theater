# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

个人视频聚合系统，本机或局域网访问。核心思路：

- 用户配置多个采集站（资源站）；后端按统一接口规范向各站拉取列表/详情
- 首页展示「按名称 + 年份」聚合去重后的视频
- 详情 / 播放 / 下载 / 搜索时仍保留来源信息，由用户在操作时**显式选择**从哪个源播放或下载
- 单用户视角的播放进度记录、收藏；下载支持断点续传与暂停/继续

仓库已按 `backend/` + `frontend/` 两目录拆分 MVP 骨架落地；`backend/data/app.db`（SQLite，默认）由 SQLAlchemy `Base.metadata.create_all` 启动时自动建表。PostgreSQL 下需手动执行 SQL 初始化脚本（`backend/app/sql/*.sql`）创建物化视图和触发器。

### v1.1 刮削架构

从实时代理模式改为**本地聚合数据库**模式：

- **首次启动**：后端自动检测 VideoCache 是否为空，若为空则在后台启动**全量刮削**（遍历所有站点的所有分类），预计 20-40 分钟。开发环境下首次启动后首页可能为空，属正常。
- **日常更新**：每 5 分钟检测各站第一页，有新内容则自动触发**增量更新**（遇旧即停）
- **数据存储**：所有 list 字段 + videolist 详情字段全部写入 `VideoCache` 表，封面只存 `poster_url` 外链
- **首页/搜索**：本地数据库查询，不再实时请求资源站
- **详情页**：优先读 VideoCache 缓存（7 天有效期），过期或缺失才实时 videolist

刮削状态 API：`GET /api/videos/crawler/status`
手动触发增量：`POST /api/videos/crawler/incremental/{site_id}`

### v1.2 预聚合缓存架构

为解决首页大数据量聚合查询缓慢（~8s）问题，引入预聚合缓存：

**SQLite（默认）：预聚合双缓冲表**
- **表结构**：`AggregatedVideoV1` / `AggregatedVideoV2` 两张结构相同的表，通过 `AppConfig key="aggregated_active_version"` 原子切换活跃版本
- **刷新时机**：每次全量/增量刮削完成后触发 `_refresh_aggregated_cache()`，间隔控制 ≥5 分钟
- **聚合逻辑**：两阶段——先按 `(normalize_title, year)` 分组，再对 `year=None` 的桶回填同名记录中出现最频繁的非 None year，解决同名视频因年份缺失未聚合的问题
- **查询路由**：`GET /api/videos` 无 category 参数时直接读活跃预聚合表（O(1)），有 category 时走实时聚合
- **性能**：首页查询从 ~8s 降至 ~26ms

**PostgreSQL：物化视图（MATERIALIZED VIEW）**
- **视图**：`mv_aggregated_videos`，聚合逻辑直接在 SQL 中完成（与 SQLite 双缓冲逻辑等价）
- **刷新**：`REFRESH MATERIALIZED VIEW CONCURRENTLY`，不阻塞读（需唯一索引）
- **查询路由**：与 SQLite 一致，`GET /api/videos` 无 category 时读物化视图

**数据库配置**
- **SQLite**：`PRAGMA journal_mode=WAL` 启用 WAL 读写并发；`PRAGMA busy_timeout=30000` 锁等待 30 秒
- **PostgreSQL**：连接池 `pool_size=5, max_overflow=10, pool_pre_ping=True`
- **双路径切换**：`settings.is_postgres` 统一判断；所有 PostgreSQL 特性（tsvector、物化视图、LISTEN/NOTIFY、JSONB）均有 SQLite 降级路径
- 全量刮削站点并发从 6 降到 2，批量写入 SQLite 500 条/PG 2000 条，commit 后 `asyncio.sleep(0)` 主动让出

## 技术栈（已定）

- **后端**：FastAPI（Python，async）；HTTP 客户端使用 `httpx.AsyncClient` 并发拉取多源
- **存储**：SQLite（默认，异步驱动 `aiosqlite`）/ PostgreSQL（可选，异步驱动 `asyncpg`）；`settings.is_postgres` 统一切换；用户一次性配置的下载根目录持久化在配置表
- **前端**：React 18 + Vite SPA，原生 CSS 变量主题系统（**v2.1 深黑影院主题**，强制深黑，无浅色主题）
- **播放器**：xgplayer v3 + xgplayer-hls.js（M3U8/MP4/WebM），同时保留 ckplayer 兼容性入口
- **部署**：纯 Python 脚本运行 —— `uvicorn` 起后端，前端 `vite build` 产物交由 FastAPI 静态文件路由托管；亦可通过 `start.ps1` / `stop.ps1` 一键启停

## 核心架构数据流

### 首页列表查询流
```
前端 Home.tsx → GET /api/videos?page=&category=
  → videos.py
    → 无 category: 读预聚合缓存表（SQLite 双缓冲 / PG 物化视图）
    → 有 category: _resolve_remote_categories → 实时聚合查询 VideoCache
  → 返回聚合后的视频卡片数据
```

### 刮削数据流
```
main.py lifespan → init_scheduler() → scheduler.py _master_loop
  → crawler.start()        [首次全量刮削，后台独立运行]
  → _probe_loop()          [每 10 分钟探测站点健康]
  → _check_update_loop()   [每 5 分钟检测各站第一页]
  → _crawl_worker_loop()   [消费刮削队列，执行增量刮削]

crawler.py 内部：
  source_client.py (httpx) → 资源站 API → parser.py 解析 XML/JSON
  → VideoCache 表批量 upsert → refresh_aggregated_view() 刷新预聚合缓存
```

### 播放数据流
```
前端 Player.tsx → getEpisodes(site_id, original_id)
  → play.py get_episodes()
    → 读 VideoCache（优先）或实时 videolist
    → parser.py parse_episodes() 切分 "集数$地址$后缀"
    → 后缀归一化（feifan/360zy/dytt/*m3u8/*yun → ffm3u8）
  → 返回 episodes 到 VideoPlayer 组件

VideoPlayer.tsx：
  → xgplayer 初始化
  → 检测 suffix.endsWith("m3u8") || suffix.endsWith("yun") 决定用 HLS 或 MP4
```

### 下载数据流
```
前端 Downloads.tsx → POST /api/downloads
  → downloader.py 创建任务 → 写入 DownloadTask 表
  → download_worker() 后台协程消费队列
    → HTTP Range 请求 → 本地文件写入
    → 批量 commit（每 5 秒或 100 个 chunk）
    → SSE publish("download_progress") 推送进度
  → 前端 SSE 事件驱动增量更新 UI
```

## 资源站接口规范（硬约定，不可改）

所有采集站统一遵循以下查询协议；后端构造请求时**必须**严格使用这些参数名：

| 参数 | 含义 |
| --- | --- |
| `ac=list`        | 视频**列表**     |
| `ac=videolist`   | 视频**详情列表** |
| `t=<分类id>`     | 分类筛选        |
| `pg=<页数>`      | 分页            |
| `wd=<关键字>`    | 搜索            |
| `h=<小时数>`     | 最近 N 小时内更新 |
| `ids=<id1,id2>`  | 指定 ID 列表，逗号分隔多个 |

示例：

- `xxx.php?ac=list&t=1&pg=5` —— 分类 1 第 5 页
- `xxx.php?ac=videolist&ids=6,7` —— 拉取 ID=6,7 的详情
- `xxx.php?ac=list&h=24` —— 24 小时内更新的列表
- `xxx.php?ac=videolist&h=24` —— 24 小时内更新的详情

### 父分类与子分类（查询注意事项）

AppleCMS 站点的 `ac=list` 响应中，`class` 数组包含父分类（`type_pid=0`）和子分类（`type_pid>0`）。**`t` 参数只能查询子分类**，父分类 ID 作为 `t` 参数会返回空结果。

- `fetch-categories` 接口（`POST /api/sites/{id}/fetch-categories`）已自动过滤 `type_pid=0` 的父分类，只返回可查询的子分类。
- `ca=class` 与 `ac=list` 在这些站点上等价，均支持 `t` 参数。

## 播放/下载地址解析规范（硬约定，不可改）

资源站返回的播放/下载地址字段为多行字符串，每行一集，格式如下：

```
集数$地址$后缀
```

示例：`第一集$http://www.xxx.com/video/1.mp4$ckplayer`

解析规则：

- 按换行符切行
- 每行**必须**用 `$` 切成三段，顺序固定为 `集数`、`地址`、`后缀`
- 后缀决定播放/下载行为（例如 `ckplayer`、`mp4`、`m3u8`）

任何与「播放/下载列表」交互的代码（解析、展示、点击跳转、下载任务入参）都必须严格按此切分；不要假设其它分隔符、字段顺序或字段数量。

## 关键功能契约

按用户原始需求落定，落地实现时不得偏离：

1. **首页**：跨多源聚合去重后的视频卡片列表
2. **详情**：简介 / 封面 / 年份 / 地区 / 演员表 + 选集；播放与下载入口要求**先选源**
3. **搜索**：以 `wd` 跨所有源并发查询，按聚合规则合并展示
4. **下载**：
   - 断点续传（HTTP `Range`）+ 暂停/继续
   - 下载根目录由用户**一次性设置**，持久化保存，不每次都问
5. **播放进度**：记录视频 + 集数（+ 进度时间），可点击记录恢复播放
6. **收藏**：单用户收藏列表

### 聚合 / 去重要点

- 聚合键以 `名称 + 年份` 为主，同名同年视为同一视频
- 列表去重**仅用于展示**；底层数据保留每个来源的原始记录，**不要**在采集层裁剪掉重复源
- 播放/下载入口必须让用户**显式选源**，禁止自动挑选

## 分类映射规范

系统分类采用**父子层级**结构：`SystemCategory` 表有 `parent_id`，`/api/system-categories` 返回树形结构，前端 `CategoryBar` 按父类分组展示子类。

### 设计原则

1. **父子层级系统分类**：存在"电影"、"连续剧"、"综艺"、"动漫"、"体育"、"短剧"等父分类，每个父分类下有若干叶子子分类（如"电影"下有动作片、科幻片、喜剧片等）。新增系统分类时可指定 `parent_id`。
2. **映射发生在叶子层**：各资源站的 `remote_id` 最终映射到系统分类的**叶子节点**（子分类），而不是父分类。父分类仅用于前端分组展示和推荐等聚合场景。
3. **多对一映射**：一个系统子分类可以对应一个站点的多个子分类（如"恐怖片"同时映射 ffzy 恐怖片 + 360zy 恐怖片/惊悚片/灾难片）。
4. **互斥约束**：一个站点分类（remote_id）只能映射到一个系统分类。前端 `CategorySettings` 通过 occupancy map 实现置灰 + 释放机制。
5. **禁用级联**：父分类 `enabled=False` 时，其下所有子分类在前端过滤和推荐查询中均视为禁用（见 `_video_has_enabled_source`）。删除父分类会级联删除子分类。
6. **查询链路**：前端点击系统子分类 → `GET /api/videos?category=系统分类名` → 后端 `_resolve_remote_categories` 映射为各站点 remote_id → 向各站点并发请求 `t=remote_id` → 聚合返回。

### 当前系统分类清单

| 父分类 | 子分类 |
|---|---|
| 电影 | 动作片、科幻片、喜剧片、爱情片、剧情片、战争片、恐怖片、伦理片、纪录片、动画片、短片、4K电影、邵氏电影、Netflix、悬疑片、犯罪片、奇幻片 |
| 连续剧 | 国产剧、香港剧、韩国剧、欧美剧、台湾剧、日本剧、泰国剧、海外剧 |
| 综艺 | 大陆综艺、港台综艺、日韩综艺、欧美综艺 |
| 动漫 | 国产动漫、日韩动漫、欧美动漫、港台动漫、海外动漫 |
| 体育 | 足球、篮球、综合体育 |
| 短剧 | 古装短剧、都市短剧、穿越短剧、恋爱短剧、其他短剧 |
| 其他 | 其他资源 |

## 主题系统（v2.1 深黑影院主题）

v2.1 已彻底重构为**深黑影院主题（Cinema Theme）**，不再支持浅色主题。

- `global.css` 中 `:root` 定义深黑变量：`--bg: #000000`，`--primary: #4ade80`（呼吸绿）
- `App.tsx` 强制深黑主题：移除 `data-theme` 属性、清除 localStorage 中的旧主题设置
- 所有组件使用 CSS 变量，禁止硬编码 `rgba(0,0,0,...)` 或 `#fff` 等不与主题一致的颜色
- 字体：`Cinzel`（英文标题）+ `Noto Sans SC`（中文正文）

> 注：如果修改颜色，只需改 `global.css` 中的 CSS 变量；组件中的 `var(--xxx)` 引用会自动生效。

## 局域网访问注意事项

- 后端启动绑定 `0.0.0.0`，不要写死 `127.0.0.1`
- 推送给前端的视频 / 下载 URL 必须是局域网可达的真实地址，避免出现 `localhost` 或仅本机可解析的主机名
- 下载根目录配置需允许写入 NAS 路径或映射盘

## 常用命令

### 开发模式（前后端分别启动）

1. **启动后端**（终端 1）：
   ```bash
   cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

2. **启动前端**（终端 2）：
   ```bash
   cd frontend && npm run dev
   ```

3. **浏览器访问**：`http://localhost:5173`

### 生产模式（单端口）

1. **构建前端**：
   ```bash
   cd frontend && npm run build
   ```

2. **启动后端**（静态托管 dist）：
   ```bash
   cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8181
   ```

3. **浏览器访问**：
   - `http://<本机IP>:8181` — 局域网内所有设备可用
   - `http://localhost.com:8181` — 本机访问，不用记 IP

> 注：`frontend/vite.config.ts` 开发代理目标为 `http://localhost:8000`，与后端默认端口保持一致。若修改 `.env` 中的 `PORT`，需同步修改 `vite.config.ts` 中的代理目标。

### 测试

**前端测试**（Vitest）：
```bash
cd frontend && npm test
```

**后端测试**（pytest）：
```bash
# 先安装 dev 依赖（若未安装）
cd backend && pip install -e ".[dev]"
# 运行全部测试
pytest
# 运行单个测试文件
pytest test/test_videos.py
# 运行特定测试函数
pytest test/test_videos.py::test_list_videos
```

后端测试使用独立测试数据库（默认 `postgresql+asyncpg://localhost:5432/home_theater_test`），每个测试后自动 truncate 所有表保证隔离。可通过 `TEST_DB_URL` 环境变量覆盖。

### Windows 一键启动（PowerShell）

```powershell
# 启动（自动构建前端 + 起后端）
.\start.ps1

# 停止
.\stop.ps1
```

### Docker 部署

```bash
# 一键启动（含 PostgreSQL + 应用）
docker compose up --build -d

# 查看日志
docker compose logs -f app

# 停止
docker compose down
```

## 数据模型变更（v1.1）

### VideoCache 表扩展字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `type_id` | INTEGER | 资源站原始分类 ID（remote_id） |
| `type_name` | VARCHAR | 分类名称（如"港台综艺"） |
| `remarks` | VARCHAR | 更新状态（如"更新至06集"） |
| `play_from` | VARCHAR | 播放器类型（如"360zy"、"feifan"） |
| `has_detail` | BOOLEAN | 是否已 videolist（有 play_url_raw） |

`source_updated_at` 存资源站返回的 `vod_time`（字符串格式），用于增量更新时判断记录是否变更。

## 给未来 Claude 的提醒

- 改动到「资源站请求参数」或「播放地址解析」相关代码时，回头核对本文件的硬规范章节
- 新增任何「自动选源」「按某源默认播放」之类的逻辑前，先与用户确认 —— 这与现有契约相反
- 下载根目录的获取应从配置层读，不要在调用点硬编码或重复询问用户
- **分类映射**：系统分类是父子层级结构，资源站 `remote_id` 映射到叶子子分类；父分类用于展示分组和推荐聚合。新增分类时应映射到叶子子分类，并正确设置 `parent_id`。
- **fetch-categories**：后端已过滤 `type_pid=0` 的资源站父分类，只返回可查询的子分类；不要把资源站父分类重新加入可选列表。
- **CategorySettings 互斥**：一个 remote_id 只能属于一个系统分类，前端用 occupancy map 维护此约束；如需改动映射逻辑，需同步更新 occupancy 计算和 releaseRemoteId 逻辑
- **feifan/360zy 后缀处理**：`video_detail` 和 `play.py` 都要对 episodes 做后缀归一化（`feifan` → 解析为真实 m3u8 后 suffix 改为 `ffm3u8`；`360zy` → `ffm3u8`）。只改一处会导致详情页播放和直接刷新播放器行为不一致（见 `docs/lessons-learned.md` #17）
- **主题系统**：v2.1 为强制深黑影院主题，`global.css` 中不再有浅色主题变量；`App.tsx` 会清除旧主题设置。新增组件时使用 `var(--bg)`、`var(--text-primary)` 等变量，不要硬编码颜色。
- **刮削模块**：`app/services/crawler.py` 负责全量/增量刮削；`app/services/scheduler.py` 负责定时调度。修改刮削逻辑时需同步更新状态持久化（AppConfig key="crawler_state"）。
- **列表排序**：`app/api/videos.py` 的 list/search 查询必须带二级排序 `desc(VideoCache.id)`，否则 `cached_at` 相同时返回顺序不稳定。
- **crawler 导入**：`app/api/videos.py` 中不能写 `from app.services.scheduler import crawler`（快照导入），必须用 `import app.services.scheduler as scheduler_module` 然后通过 `scheduler_module.crawler` 访问（模块引用）。
- **数据库并发**：SQLite 下 WAL 模式 + busy_timeout 是底线，但写入仍串行，刮削任务 commit 后必须 `await asyncio.sleep(0)` 让出。PostgreSQL 下利用连接池真正读写并发，但预聚合缓存刷新仍需读写分阶段，写事务保持亚秒级。
- **IndexedDB 超时**：`cache.ts` 中所有 IndexedDB 操作（`get`/`set`/`clearExpired`）已包裹 `withTimeout(..., 3000)`。前端 `Home.tsx` 的 `setCachedAggregated` 必须放在 `try` 块外 fire-and-forget，避免阻塞 `setLoading(false)`。
- **播放器后缀检测**：VideoPlayer 使用 `suffix.toLowerCase().endsWith("m3u8") || suffix.toLowerCase().endsWith("yun")` 检测 M3U8 流。新增站点后缀如 `155m3u8`、`xlyun`、`dytt` 都通过此规则覆盖，不需要逐个硬编码。
- **预聚合缓存（SQLite）**：`_refresh_aggregated_cache` 读取阶段使用只读事务，聚合到内存后关闭；写入阶段开启新事务执行清空+插入+版本切换。不要在同一个事务中既读全表又写目标表。
- **预聚合缓存（PostgreSQL）**：`refresh_aggregated_view()` 使用 `REFRESH MATERIALIZED VIEW CONCURRENTLY`（需唯一索引）；fallback 到普通 `REFRESH MATERIALIZED VIEW`。不要在同一个事务中既读 video_cache 全表又写 mv_aggregated_videos。
- **分享页解析缓存**：`app/services/resolver.py` 的 `resolve_share_page` 已带 1 小时 TTL 内存缓存，避免同一分享页 URL 重复解析。解析失败时短暂缓存 30 秒防止高频重试。
- **移动端播放器层级**：xgplayer 的 `cssFullscreen` 已禁用，避免退出全屏后残留 fixed 定位；`.player-video-wrap` 使用 `z-index: 1` + `transform: translateZ(0)` 创建层叠上下文，将 xgplayer 内部高 z-index 元素锁在播放器层内，确保选集抽屉能覆盖其上。
- **工作目录与 worktree**：仓库使用多个 git worktree（`Home Theater` = master，`Home Theater v2` = home-theater-v2-postgresql-version）。修改文件时务必确认当前工作目录，避免改动落在非预期的 worktree。

## 排错优先顺序

遇到异常时，按以下顺序排查：

1. **优先查错题本** → `docs/lessons-learned.md`（本项目历史踩坑记录，含症状/原因/解决）
2. **再查本文件** → 核对硬规范章节（资源站参数、播放地址解析、分类映射）
3. **最后查代码** → 当前实现是否偏离上述规范

> 不要跳过第 1 步直接调试代码。过往错误（如父分类陷阱、端口占用、进程未重启）有很高的重复命中概率。
