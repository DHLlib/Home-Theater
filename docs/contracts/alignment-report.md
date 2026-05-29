# 逆向纳入对齐报告

## 项目概况
- 扫描日期: 2026-05-27
- 源码文件数: 58（后端 23 个 .py，前端 35 个 .ts/.tsx）
- API 端点数: 30（含 8 个 sites、6 个 videos、5 个 downloads 等）
- UI 组件/页面数: 17（9 个 components + 8 个 pages）
- 数据模型数: 7（Site、Favorite、PlayProgress、DownloadTask、VideoCache、AppConfig、Base）

---

## AC 对齐矩阵

### AC-001: 站点管理
- **状态**: fully_implemented
- **证据**:
  - `backend/app/api/sites.py` L14-49: 完整的 CRUD（list/create/update/delete）
  - `backend/app/models.py` L12-23: Site 模型含 `name`, `base_url`, `enabled`, `sort`, `categories`, `auto_disabled_at`
  - `frontend/src/pages/Settings.tsx` L328-663: 「采集站管理」Tab，支持 inline 新增/编辑/删除、启用/禁用切换、探测
  - `frontend/src/api/sites.ts`: 对应前端 API 封装
- **Gap**: 无
- **建议**: 无

### AC-002: 分类映射（互斥约束）
- **状态**: partially_implemented
- **证据**:
  - `backend/app/api/sites.py` L65-92: `get_site_categories` / `update_site_categories` / `fetch_remote_categories`
  - `frontend/src/components/CategorySettings.tsx` L86-266: UI 中通过 `buildOccupancy` 和 `isOccupied` 逻辑强制一个 `remote_id` 只能属于一个系统分类，并提供「释放」按钮
  - `backend/app/models.py` L21: `Site.categories` 为 JSON 字段，存储 `[{remote_id, name}]`
- **Gap**: **后端缺失互斥校验**。`update_site_categories` 直接写入客户端传来的数组，不校验同一站点内一个 `remote_id` 是否被重复分配到多个系统分类。互斥约束目前仅靠前端 UI 保证，可被 API 直接绕过。
- **建议**: 在 `backend/app/api/sites.py` 的 `update_site_categories` 中增加服务器端互斥校验

### AC-003: 首页视频聚合列表
- **状态**: partially_implemented
- **证据**:
  - `backend/app/api/videos.py` L89-206: `list_videos` 从本地 `VideoCache` 查询并按 `(normalize_title, year)` 聚合去重
  - `backend/app/services/aggregator.py` L11-17: `normalize_title` 归一化规则
  - `frontend/src/pages/Home.tsx` L125-711: 三区域展示（最新更新/热门视频/全部视频），支持分类筛选、时间筛选、无限滚动、源站模式切换
  - `frontend/src/utils/cache.ts` L77-98: 聚合列表 IndexedDB 缓存层
- **Gap**:
  1. **非实时并发拉取**：当前实现从本地 `VideoCache` 读取，而非 AC 描述的「跨多源并发拉取」。远程数据依赖 `Crawler` 后台刮削（`backend/app/services/crawler.py`）。
  2. **`failed_sources` 恒为空**：`list_videos` 返回 `AggregatedListResponse` 但 `failed_sources` 始终为 `[]`，接口契约保留但无实际数据。
- **建议**: 更新 AC 描述以匹配当前「缓存优先 + 后台刮削」架构；或补充实时回源兜底逻辑

### AC-004: 视频搜索
- **状态**: partially_implemented
- **证据**:
  - `backend/app/api/videos.py` L213-328: `search_videos` 基于本地 `VideoCache` 的 `LIKE` 查询并按相同规则聚合
  - `frontend/src/pages/Search.tsx`: 独立搜索页面；`Layout.tsx` L95-99 顶部搜索框跳转至首页带 `wd` 参数
- **Gap**: 同 AC-003，搜索为本地缓存 LIKE，非「跨所有源并发搜索」；`failed_sources` 恒为空。
- **建议**: 同 AC-003

### AC-005: 视频详情
- **状态**: fully_implemented
- **证据**:
  - `backend/app/api/videos.py` L335-509: `video_detail` 优先查 `VideoCache`（7 天 TTL），未命中则实时 `SourceClient.videolist`
  - `backend/app/api/videos.py` L49-82: `_normalize_episode_suffixes` 统一处理 `feifan` → `ffm3u8`、`360zy` → `ffm3u8`
  - `backend/app/services/resolver.py`: `resolve_feifan` 解析分享页获取真实 m3u8
  - `frontend/src/pages/Detail.tsx`: 详情页 UI，支持缓存优先渲染
- **Gap**: 无
- **建议**: 无

### AC-006: 播放地址解析
- **状态**: fully_implemented
- **证据**:
  - `backend/app/services/parser.py` L19-48: `parse_episodes` 严格按 `集数$地址$后缀` 解析，格式不足 3 段抛 `ValueError`
  - `backend/app/services/resolver.py`: `resolve_feifan` 正则提取 `const url = "..."` 并拼接完整 m3u8 URL
  - `backend/app/api/play.py` L39-62: 对 feifan/360zy 后缀进行解析和统一替换
  - `backend/app/services/source_client.py` L179-211: `_convert_play_url` 处理苹果 CMS 多播放器格式转统一格式
- **Gap**: 无
- **建议**: 无

### AC-007: 显式选源
- **状态**: fully_implemented
- **证据**:
  - `frontend/src/components/SourcePicker.tsx` L20-130: 硬契约注释「不允许默认选中」「确定按钮必须 disabled」；`picked` 初始为 `null`
  - `frontend/src/pages/Detail.tsx` L86-99: 播放/下载均先打开 `SourcePicker`，用户确认后才继续
- **Gap**: 无
- **建议**: 无

### AC-008: ckplayer 播放
- **状态**: fully_implemented
- **证据**:
  - `frontend/src/components/VideoPlayer.tsx` L27-266: 集成 `ckplayer` + `hls.js`，支持 m3u8/ffm3u8/mp4/webm
  - `frontend/src/pages/Player.tsx` L306-325: 「上一集」「下一集」按钮及禁用状态
  - `frontend/src/pages/Player.tsx` L103-123: 按进度恢复播放（`seekTo`）
  - `frontend/src/pages/Player.tsx` L180-257: 键盘事件监听（ArrowLeft/ArrowRight），短按 15s 跳转，长按 2s 后进入 5s 连续快进/快退
- **Gap**: 无
- **建议**: 无

### AC-009: 播放进度记录与恢复
- **状态**: fully_implemented
- **证据**:
  - `frontend/src/pages/Player.tsx` L125-168: `setInterval` 每 15 秒 `upsertProgress`；`beforeunload` 时 `navigator.sendBeacon` 兜底上报
  - `frontend/src/pages/Player.tsx` L103-123: 首次进入时 `getProgress` 恢复集数和秒数
  - `backend/app/api/progress.py` L12-42: `upsert_progress` 按 `(title, year)` 唯一键更新或插入
- **Gap**: 无
- **建议**: 无

### AC-010: 收藏管理
- **状态**: fully_implemented
- **证据**:
  - `backend/app/api/favorites.py` L12-36: list / add / remove
  - `backend/app/models.py` L26-34: `Favorite` 表含 `UniqueConstraint("title", "year")`
  - `frontend/src/pages/Favorites.tsx`: 收藏列表、删除、点击跳转详情
  - `frontend/src/components/VideoCard.tsx` L80-87: 卡片悬停层支持一键收藏
- **Gap**: 无
- **建议**: 无

### AC-011: 下载任务管理
- **状态**: fully_implemented
- **证据**:
  - `backend/app/api/downloads.py` L17-111: list / create / pause / resume / delete（含 `delete_file` 开关）
  - `backend/app/models.py` L60-86: `DownloadTask` 完整状态机字段
  - `frontend/src/pages/Downloads.tsx`: 任务列表、暂停/恢复/重试/删除、进度条、片段/字节双模式进度
  - `backend/app/api/settings_api.py` L14-48: 下载根目录一次性配置
  - `frontend/src/pages/Settings.tsx` L697-758: 下载根目录配置 UI
- **Gap**: 无
- **建议**: 无

### AC-012: 断点续传下载（HTTP Range + m3u8 .ts）
- **状态**: fully_implemented
- **证据**:
  - `backend/app/services/downloader.py` L135-224: `_run_direct_download` 使用 `Range: bytes={downloaded_bytes}-` 并 `aiofiles.open(..., "ab")` 续写
  - `backend/app/services/downloader.py` L230-441: `_run_m3u8_download` 解析 m3u8、并发下载 `.ts`（`TS_CONCURRENCY=5`），跳过已存在片段实现续传
  - `backend/app/services/downloader.py` L536-573: `_merge_ts_files` 调用 `ffmpeg` 合并
  - `backend/app/services/downloader.py` L576-590: `_concat_ts_files` ffmpeg 不可用时降级为直接二进制拼接
- **Gap**: 无
- **建议**: 无

### AC-013: 站点健康监控与自动禁用
- **状态**: fully_implemented
- **证据**:
  - `backend/app/services/scheduler.py` L17-20: `PROBE_INTERVAL=600`（10 分钟）、`FAIL_THRESHOLD=3`、`RECOVER_THRESHOLD=2`
  - `backend/app/services/scheduler.py` L60-145: `_probe_loop` / `_on_probe_failure`（连续 3 次失败自动禁用）/ `_on_probe_success`（连续 2 次成功自动恢复）
  - `backend/app/services/health.py`: `probe` 探测实现
  - `backend/app/services/event_bus.py` + `backend/app/api/sse.py`: 健康状态通过 SSE 实时推送
- **Gap**: 无
- **建议**: 无

### AC-014: VideoCache 缓存管理
- **状态**: partially_implemented
- **证据**:
  - `backend/app/models.py` L89-115: `VideoCache` 模型含 `site_id` + `original_id` 唯一约束及丰富详情字段
  - `backend/app/api/videos.py` L480-498: `video_detail` 中使用 SQLite `upsert`（`on_conflict_do_update`）
  - `backend/app/api/videos.py` L541-544: `clear_video_cache` 手动清理接口
  - `frontend/src/pages/Settings.tsx` L762-821: 缓存管理 Tab，支持手动清除并显示删除条数
- **Gap**: **缺少 5000 行上限自动清理**。代码中无任何对 `VideoCache` 表行数上限的校验或自动淘汰逻辑。
- **建议**: 补充后台定时任务或写入时的上限检查（如按 `cached_at` 淘汰最旧记录）

### AC-015: 前端 IndexedDB 缓存
- **状态**: fully_implemented
- **证据**:
  - `frontend/src/utils/cache.ts` L1-173: `aggregated`（TTL 5 分钟）、`detail`（TTL 10 分钟）、`episodes`（TTL 10 分钟）三层缓存
  - `frontend/src/main.tsx` L7: 启动时调用 `clearExpiredCache()`
  - `frontend/src/utils/cache.ts` L130-172: 启动清理逻辑遍历所有 store 删除过期条目
- **Gap**: 无
- **建议**: 无

### AC-016: 下载进度实时推送（SSE）
- **状态**: fully_implemented
- **证据**:
  - `backend/app/api/sse.py` L11-38: `/api/sse` 端点，StreamingResponse 实现 SSE
  - `backend/app/services/event_bus.py`: 内存发布-订阅总线，基于 `asyncio.Queue`
  - `backend/app/services/downloader.py`: 多处 `publish(Event("download_progress", ...))` 和 `publish(Event("download_status", ...))`
  - `backend/app/services/scheduler.py` L120,L144: `publish(Event("site_health", ...))`
  - `frontend/src/api/sse.ts`: SSE 客户端封装，自动重连（3s），支持 `download_progress` / `download_status` / `site_health`
  - `frontend/src/pages/Downloads.tsx` L53-139: 订阅 SSE 事件实时更新任务列表和进度条
- **Gap**: 无
- **建议**: 无

### AC-017: 局域网部署与静态托管
- **状态**: fully_implemented
- **证据**:
  - `backend/app/config.py` L14: `host: str = "0.0.0.0"`
  - `backend/app/main.py` L58-64: `CORSMiddleware` 配置 `allow_origins=["*"]`
  - `backend/app/main.py` L83-87: `StaticFiles` 挂载 `frontend/dist`，`html=True` 支持 SPA fallback
  - `backend/app/main.py` L35-53: `CacheControlStaticFiles` 自定义缓存头——HTML 禁缓存、JS/CSS `max-age=60, must-revalidate`、静态资源 `max-age=86400`
- **Gap**: 无
- **建议**: 无

---

## 全局发现

### 循环依赖
- 未发现显式循环依赖。`backend/app/api/videos.py` 以模块对象方式引用 `app.services.scheduler`（L22,L519,L531），用于查询/触发刮削器状态，属松散引用，不构成循环导入。

### 未测试模块
- **全部模块均无测试覆盖**。项目配置了 `pytest`（`tech-stack.yaml` L11），但 `test/` 目录下无任何测试文件。
- 高风险未覆盖模块：
  - `backend/app/services/downloader.py`（断点续传、m3u8 合并逻辑复杂）
  - `backend/app/services/parser.py`（格式解析硬契约）
  - `backend/app/services/scheduler.py`（健康监控阈值逻辑）
  - `backend/app/api/videos.py`（缓存 upsert 与回源并发）

### 接口契约缺失
1. **分类映射互斥约束（AC-002）**: 仅前端 UI 保障，后端 API 契约未声明互斥规则，存在绕过风险。
2. **列表/搜索 API 的 `failed_sources`（AC-003/004）**: 字段保留在响应 schema 中，但当前实现恒为空数组。若未来恢复实时回源，需重新定义该字段语义。
3. **下载任务状态机**: `status` 为自由字符串（`queued/downloading/paused/done/error`），无枚举校验或状态流转约束（如 `done` 不应直接转 `paused`）。
4. **`SourceRef` 与 `SourceDetail` 的 `category` 字段**: `types.ts` 和 `schemas.py` 中声明了 `category`，但当前聚合逻辑主要使用 `type`/`type_name`，`category` 未在核心流程中填充。

---

## 沉默约定扫描（Reverse 模式）

基于代码实际实现，检查以下隐性需求是否已在代码中体现：

- [x] **错误降级 / 功能开关**
  - 站点级 `enabled` 开关（`Site.enabled`）
  - 下载错误分类（`connection_error` / `site_unavailable` / `file_removed`）并在 UI 展示不同提示
  - 播放器不支持的格式直接报错降级（`VideoPlayer.tsx` L67-73）
  - m3u8 下载 ffmpeg 合并失败降级为直接拼接（`downloader.py` L411-416）

- [ ] **操作审计 / 日志轨迹**
  - 仅有应用级日志（`logging_config.py`），无用户操作审计（谁收藏、谁删除下载、谁修改站点配置均无记录）

- [x] **配置页面 / 系统设置**
  - `Settings.tsx` 提供采集站管理、分类设置、下载根目录、缓存管理四大配置板块

- [ ] **数据导出 / 批量操作**
  - 无导出功能；无批量操作（如批量删除下载、批量修改站点分类）

- [ ] **并发冲突处理**
  - 无乐观锁或版本号机制；`PlayProgress` 和 `Favorite` 等按 `(title, year)` 维度的 upsert 在高并发下可能产生覆盖竞争
  - `VideoCache` upsert 在多线程/多进程写入场景下依赖 SQLite 行锁，无应用层冲突处理

---

## 结论

- **可直接进入 TDD 的 AC**（共 11 个）：
  AC-001, AC-005, AC-006, AC-007, AC-008, AC-009, AC-010, AC-011, AC-012, AC-013, AC-015, AC-016, AC-017

- **需要补充实现的 AC**（共 3 个）：
  - **AC-002**: 后端增加分类映射互斥校验
  - **AC-014**: 补充 `VideoCache` 5000 行上限自动清理机制
  - **AC-003 / AC-004**（归为一组架构决策）: 需确认是否保留「实时并发回源」还是接受「缓存优先」架构；若接受后者，需更新 AC 描述并移除/重新定义 `failed_sources`

- **需要调整描述的 AC**（共 2 个）：
  - **AC-003**: 实际为「本地缓存聚合列表」而非「跨多源并发拉取」
  - **AC-004**: 实际为「本地缓存 LIKE 搜索」而非「跨所有源并发搜索」

- **建议优先处理顺序**:
  1. **AC-002** 后端互斥校验（安全/数据完整性，改动小，收益高）
  2. **AC-014** VideoCache 上限机制（防止磁盘无限膨胀）
  3. **AC-003/004** 架构描述对齐（避免后续 TDD 基于错误假设编写测试）
  4. **全局补充测试**：优先覆盖 `parser.py`、`downloader.py`、`scheduler.py` 三个核心服务
