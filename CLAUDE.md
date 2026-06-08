# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

个人视频聚合系统，本机或局域网访问。核心思路：

- 用户配置多个采集站（资源站）；后端按统一接口规范向各站拉取列表/详情
- 首页展示「按名称 + 年份」聚合去重后的视频
- 详情 / 播放 / 下载 / 搜索时仍保留来源信息，由用户在操作时**显式选择**从哪个源播放或下载
- 单用户视角的播放进度记录、收藏；下载支持断点续传与暂停/继续

仓库已按 `backend/` + `frontend/` 两目录拆分 MVP 骨架落地；`backend/data/app.db` 由 SQLAlchemy `Base.metadata.create_all` 启动时自动建表。

### v1.1 刮削架构（新增）

从实时代理模式改为**本地聚合数据库**模式：

- **首次启动**：后端自动检测 VideoCache 是否为空，若为空则在后台启动**全量刮削**（遍历所有站点的所有分类），预计 20-40 分钟
- **日常更新**：每 5 分钟检测各站第一页，有新内容则自动触发**增量更新**（遇旧即停）
- **数据存储**：所有 list 字段 + videolist 详情字段全部写入 `VideoCache` 表，封面只存 `poster_url` 外链
- **首页/搜索**：纯本地 SQLite 查询，不再实时请求资源站
- **详情页**：优先读 VideoCache 缓存（7 天有效期），过期或缺失才实时 videolist

刮削状态 API：`GET /api/videos/crawler/status`
手动触发增量：`POST /api/videos/crawler/incremental/{site_id}`

### v1.2 预聚合缓存架构（新增）

为解决首页大数据量聚合查询缓慢（~8s）问题，引入**预聚合双缓冲表**：

- **表结构**：`AggregatedVideoV1` / `AggregatedVideoV2` 两张结构相同的表，通过 `AppConfig key="aggregated_active_version"` 原子切换活跃版本
- **刷新时机**：每次全量/增量刮削完成后触发 `_refresh_aggregated_cache()`，间隔控制 ≥5 分钟
- **聚合逻辑**：两阶段——先按 `(normalize_title, year)` 分组，再对 `year=None` 的桶回填同名记录中出现最频繁的非 None year，解决同名视频因年份缺失未聚合的问题
- **查询路由**：`GET /api/videos` 无 category 参数时直接读活跃预聚合表（O(1)），有 category 时走实时聚合
- **性能**：首页查询从 ~8s 降至 ~26ms

SQLite 配置：
- `PRAGMA journal_mode=WAL`：启用 WAL，读写并发
- `PRAGMA busy_timeout=30000`：锁等待 30 秒
- 全量刮削站点并发从 6 降到 2，批量写入从 100 提升到 500，commit 后 `asyncio.sleep(0)` 主动让出

## 技术栈（已定）

- **后端**：FastAPI（Python，async）；HTTP 客户端使用 `httpx.AsyncClient` 并发拉取多源
- **存储**：SQLite + SQLAlchemy（异步驱动 `aiosqlite`）；用户一次性配置的下载根目录持久化在配置表
- **前端**：React + Vite SPA，原生 CSS 变量主题系统（浅色/深色双主题）
- **播放器**：ckplayer（与资源站返回的 `$ckplayer` 后缀对齐）
- **部署**：纯 Python 脚本运行 —— `uvicorn` 起后端，前端 `vite build` 产物交由 FastAPI 静态文件路由托管；亦可通过 `start.ps1` / `stop.ps1` 一键启停

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

系统分类是**扁平**的，不存在"电影"这种聚合大类。可映射的条目是各资源站的**子分类**（`type_pid > 0`）。

### 设计原则

1. **扁平系统分类**：动作片、科幻片、喜剧片、剧情片、国产剧、大陆综艺、国产动漫……等叶子节点，没有"电影"、"连续剧"这种父级大类。
2. **多对一映射**：一个系统分类可以对应一个站点的多个子分类（如"恐怖片"同时映射 ffzy 恐怖片 + 360zy 恐怖片/惊悚片/灾难片）。
3. **互斥约束**：一个站点分类（remote_id）只能映射到一个系统分类。前端 `CategorySettings` 通过 occupancy map 实现置灰 + 释放机制。
4. **查询链路**：前端点击系统分类 → `GET /api/videos?category=系统分类名` → 后端 `_resolve_remote_categories` 映射为各站点 remote_id → 向各站点并发请求 `t=remote_id` → 聚合返回。

### 当前系统分类清单

| 系统分类 | 典型映射 |
|---------|---------|
| 动作片、科幻片、喜剧片、爱情片、剧情片、战争片、恐怖片、伦理片 | 电影类子分类 |
| 纪录片、动画片、短片 | 360zy 特有电影子类 |
| 国产剧、香港剧、韩国剧、欧美剧、台湾剧、日本剧、泰国剧、海外剧 | 连续剧子分类 |
| 大陆综艺、港台综艺、日韩综艺、欧美综艺 | 综艺子分类 |
| 国产动漫、日韩动漫、欧美动漫、港台动漫、海外动漫 | 动漫子分类 |
| 体育 | 360zy 足球/篮球/NBA |
| 短剧 | ffzy 短剧 + 360zy 各短剧子类 |

## 局域网访问注意事项

- 后端启动绑定 `0.0.0.0`，不要写死 `127.0.0.1`
- 推送给前端的视频 / 下载 URL 必须是局域网可达的真实地址，避免出现 `localhost` 或仅本机可解析的主机名
- 下载根目录配置需允许写入 NAS 路径或映射盘

## 常用命令

### 开发模式（前后端分别启动）

1. **启动后端**（终端 1）：
   ```bash
   cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload
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

> 注：`frontend/vite.config.ts` 开发代理目标为 `http://localhost:8181`，与后端开发端口保持一致。

### Windows 一键启动（PowerShell）

```powershell
# 启动（自动构建前端 + 起后端）
.\start.ps1

# 停止
.\stop.ps1
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
- **分类映射**：系统分类是扁平的，禁止新增"电影""连续剧"等父级大类；新增分类时应映射到叶子子分类
- **fetch-categories**：后端已过滤 `type_pid=0` 的父分类，不要修改此逻辑让父分类重新进入可选列表
- **CategorySettings 互斥**：一个 remote_id 只能属于一个系统分类，前端用 occupancy map 维护此约束；如需改动映射逻辑，需同步更新 occupancy 计算和 releaseRemoteId 逻辑
- **feifan/360zy 后缀处理**：`video_detail` 和 `play.py` 都要对 episodes 做后缀归一化（`feifan` → 解析为真实 m3u8 后 suffix 改为 `ffm3u8`；`360zy` → `ffm3u8`）。只改一处会导致详情页播放和直接刷新播放器行为不一致（见 `docs/lessons-learned.md` #17）
- **主题系统**：`global.css` 中 `:root` 为浅色主题（`#f9e9cd` 暖米色背景），`[data-theme="dark"]` 为深色主题。新增主题变量或修改颜色时必须同步更新两套变量；组件中的硬编码颜色（如 `rgba(0,0,0,...)`、`#fff`）需检查在另一主题下是否可读。主题切换逻辑在 `App.tsx`（初始化）和 `Layout.tsx`（切换按钮）。
- **刮削模块**：`app/services/crawler.py` 负责全量/增量刮削；`app/services/scheduler.py` 负责定时调度。修改刮削逻辑时需同步更新状态持久化（AppConfig key="crawler_state"）。
- **列表排序**：`app/api/videos.py` 的 list/search 查询必须带二级排序 `desc(VideoCache.id)`，否则 `cached_at` 相同时返回顺序不稳定。
- **crawler 导入**：`app/api/videos.py` 中不能写 `from app.services.scheduler import crawler`（快照导入），必须用 `import app.services.scheduler as scheduler_module` 然后通过 `scheduler_module.crawler` 访问（模块引用）。
- **SQLite 并发**：WAL 模式 + busy_timeout 是底线，但写入仍串行。刮削任务 commit 后必须 `await asyncio.sleep(0)` 让出，避免独占事件循环。预聚合缓存刷新必须读写分阶段，写事务保持亚秒级。
- **IndexedDB 超时**：`cache.ts` 中所有 IndexedDB 操作（`get`/`set`/`clearExpired`）已包裹 `withTimeout(..., 3000)`。前端 `Home.tsx` 的 `setCachedAggregated` 必须放在 `try` 块外 fire-and-forget，避免阻塞 `setLoading(false)`。
- **播放器后缀检测**：VideoPlayer 使用 `suffix.toLowerCase().endsWith("m3u8") || suffix.toLowerCase().endsWith("yun")` 检测 M3U8 流。新增站点后缀如 `155m3u8`、`xlyun`、`dytt` 都通过此规则覆盖，不需要逐个硬编码。
- **预聚合缓存**：`_refresh_aggregated_cache` 读取阶段使用只读事务，聚合到内存后关闭；写入阶段开启新事务执行清空+插入+版本切换。不要在同一个事务中既读全表又写目标表。

## 排错优先顺序

遇到异常时，按以下顺序排查：

1. **优先查错题本** → `docs/lessons-learned.md`（本项目历史踩坑记录，含症状/原因/解决）
2. **再查本文件** → 核对硬规范章节（资源站参数、播放地址解析、分类映射）
3. **最后查代码** → 当前实现是否偏离上述规范

> 不要跳过第 1 步直接调试代码。过往错误（如父分类陷阱、端口占用、进程未重启）有很高的重复命中概率。
