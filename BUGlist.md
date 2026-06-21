# Home Theater v2 BUG 列表

> 生成时间：2026-06-20
> 范围：backend/ + frontend/ 源码通读 + 现有测试运行
> 说明：仅列可被代码/测试/规范验证的 BUG，未修改任何源码

---

## 严重（Critical）

### C1. SQLite 建表直接崩溃：模型使用 PostgreSQL 专属类型 TSVECTOR / ARRAY
- **位置**：`backend/app/models.py:5`、`backend/app/models.py:181`、`backend/app/models.py:224/231`
- **问题**：`VideoCache.search_vector` 声明为 `TSVECTOR`，`AggregatedVideo.types` 声明为 `ARRAY(String)`。`db.py::init_db()` 调用 `Base.metadata.create_all()` 时，SQLite 类型编译器无法渲染这两种类型，直接抛出 `CompileError`。
- **影响**：项目文档声称 SQLite 为默认/零配置方案，但实际上 SQLite 路径根本无法启动；已用 `sqlite:///:memory:` 验证确认崩溃。
- **证据**：
  ```
  sqlalchemy.exc.CompileError: (in table 'mv_aggregated_videos', column 'types'):
  Compiler <SQLiteTypeCompiler> can't render element of type ARRAY
  ```

### C2. SQLite 模式下 LISTEN/NOTIFY 强依赖 PostgreSQL，SSE 失效
- **位置**：`backend/app/main.py:195`、`backend/app/services/listen_manager.py:33-58`、`backend/app/services/notify_sender.py:27-45`、`backend/app/api/sse.py`
- **问题**：`main.py` 无条件调用 `await listen_manager.start()`；`listen_manager` 与 `notify_sender` 直接使用 `asyncpg.connect()` 建立 PostgreSQL LISTEN/NOTIFY 连接。当 `.env` 使用 SQLite 时，`asyncpg.connect` 会失败，SSE 事件总线完全不可用。
- **影响**：SQLite 下即使绕过 C1 的建表问题，下载进度 / 站点健康 / 站点删除等实时推送也会失败。
- **证据**：`listen_manager.py:58` `await asyncpg.connect(dsn=self.dsn)`；`notify_sender.py:37` 同样直接连接 asyncpg；两者均未判断 `settings.is_postgres` 或提供 SQLite 降级路径。

### C3. 配置默认值与文档矛盾：默认数据库非 SQLite
- **位置**：`backend/app/config.py:11`、`backend/.env.example:3`
- **问题**：`database_url: str = "postgresql+asyncpg://localhost:5432/home_theater"`，而 `CLAUDE.md`、`README.md` 均写明 "SQLite（默认）/ PostgreSQL（可选）"。
- **影响**：不手动改 `.env` 时项目按 PostgreSQL 启动，与文档描述的“零配置 SQLite 默认”行为不一致；测试配置（`backend/test/conftest.py:13`）也顺延使用 PostgreSQL。
- **证据**：`config.py:11` 默认值；`README.md:48-200` 明确 SQLite 为默认。

### C4. 聚合缓存刷新防抖导致待刷新的 norm_title 丢失
- **位置**：`backend/app/services/crawler.py:1179-1223`
- **问题**：`_refresh_aggregated_cache` 先把 `affected_norm_titles` 写入 `self._pending_norm_titles`（行 1181-1182），再获取 `_refresh_lock` 并检查 `aggregated_cache_computed_at`。若 60 秒内已有刷新完成，函数直接 `return`，但 `self._pending_norm_titles` 已被清空（行 1202），这些 title 永远不会再被刷新。
- **影响**：站点删除/增量刮削产生的新 pending title 在防抖窗口内会被静默丢弃，聚合表与 video_cache 不一致。
- **证据**：`crawler.py:1181-1204` 的时序：先 `update`，再 `async with lock`，再 `if not to_refresh: return`。

---

## 高（High）

### H1. 播放地址解析器违反“恰好 3 段”硬规范
- **位置**：`backend/app/services/parser.py:19-48`
- **问题**：docstring 写明“每行用 '$' 切成恰好 3 段”，但代码只检查 `len(parts) < 3`，并用 `"$".join(parts[2:])` 作为 suffix。这意味着包含 4 个及以上 `$` 的行会被接受，且多余段被拼进 suffix。
- **影响**：与 `CLAUDE.md` 的硬约定“每行必须用 $ 切成三段，顺序固定”不一致；下游后缀判断（m3u8/yun/360zy 归一化）可能把非法行误判为合法格式。
- **证据**：`parser.py:35` `if len(parts) < 3`；`parser.py:40` `suffix = "$".join(parts[2:])`。

### H2. `source_client._get` 手动拼接 URL 导致参数未编码
- **位置**：`backend/app/services/source_client.py:82-83`
- **问题**：`url_with_params = f"{self.base_url}?{ '&'.join(f'{k}={v}' for k, v in params.items()) }"` 仅用于日志，但参数未做 URL 编码；当日志中的 URL 含中文或特殊字符时，实际请求由 httpx 内部编码，二者不一致，调试/排查时易产生误导。
- **影响**：日志 URL 与真实请求不符；若以后直接复用该拼接 URL 会触发编码错误。
- **证据**：`source_client.py:83` 使用 f-string 直接拼接，未调用 `urllib.parse.urlencode`。

### H3. `cleanup-expired` 绕过 `source_client.py` 硬规范直接请求资源站
- **位置**：`backend/app/api/videos.py:1306-1395`
- **问题**：清除失效资源接口内部新建 `httpx.AsyncClient` 并手写 `f"{site.base_url.rstrip('/')}?ac=videolist&ids={ids_str}"`。这违反了 `CLAUDE.md`“资源站请求参数构造唯一落点：backend/app/services/source_client.py” 的硬规范，且未复用重试、超时、User-Agent、Referer 等统一逻辑。
- **影响**：站点 URL 若带路径或已有查询参数，URL 拼接会出错；缺少统一重试和错误处理。
- **证据**：`videos.py:1347` 手写 URL；`videos.py:1331` 新建原始 httpx client。

### H4. 分类过滤产生 SQLAlchemy `SAWarning`（未来可能变错误）
- **位置**：`backend/app/api/videos.py:540-546`
- **问题**：`cat_subq = select(AggregatedSource.aggregated_video_id).where(...).subquery()` 被直接传入 `.in_(cat_subq)`，SQLAlchemy 警告 "Coercing Subquery object into a select() for use in IN()" 。
- **影响**：当前测试通过，但未来 SQLAlchemy 版本可能拒绝这种隐式转换，导致查询报错。
- **证据**：pytest 输出 8 条 `SAWarning` 均指向 `videos.py:545-546`。

### H5. 系统分类更新未检测深层循环依赖
- **位置**：`backend/app/api/system_categories.py:68-107`
- **问题**：`parent_id` 合法性检查只验证 `data["parent_id"] == cat_id` 和父分类存在，未递归检查祖先。用户可通过 A→B→C→A 的方式构造循环父子关系，导致树形 API 死循环或无限递归。
- **影响**：可构造异常数据，使 `list_system_categories` 的 `build_tree` 递归栈溢出。
- **证据**：`system_categories.py:90-95` 仅检查直接自环和父存在性。

### H6. `site_deleter._delete_in_batches` 的 SQL 在 SQLite 下可能不兼容
- **位置**：`backend/app/services/site_deleter.py:51-85`
- **问题**：批量删除使用 `DELETE FROM table WHERE site_id = ? AND id IN (SELECT id FROM table WHERE site_id = ? LIMIT ?)`。SQLite 对 DELETE 中的 LIMIT 子查询支持有限，且该写法在 SQLite 上通常会报语法错误或性能极差。
- **影响**：在 SQLite 默认路径下删除大站点时失败或极慢。
- **证据**：`site_deleter.py:63-70` 使用 `model.id.in_(select(...).limit(...))`。

### H7. 下载状态刷新后 `task` 对象跨会话脏读
- **位置**：`backend/app/api/downloads.py:217-234`
- **问题**：`pause_download`/`resume_download` 先获取 `task` 对象，然后调用 `dl_pause(task_id)`/`dl_resume(task_id)`，后者会打开新的 `async_session_factory()` 会话修改状态；回到原 API 会话后调用 `db.refresh(task)`。在并发场景下，`refresh` 可能拿到旧状态，返回给前端的状态与实际 DB 状态不一致。
- **影响**：前端点击暂停/继续，接口返回的状态可能仍是旧状态。
- **证据**：`downloads.py:217-234` 使用两个独立会话修改同一行，未使用显式锁或同一事务。

### H8. `toggle_favorite` 新增路径未处理并发唯一冲突
- **位置**：`backend/app/api/favorites.py:42-59`
- **问题**：`toggle_favorite` 先 `select` 判断是否存在，不存在再 `insert`，两条语句不在同一事务/锁内。并发请求可能导致两个线程都判断为不存在，同时插入相同 `(title, year)`，触发 `IntegrityError` 但未捕获。
- **影响**：并发收藏同一视频时 500 错误。
- **证据**：`favorites.py:45-58` 使用先读后写，无显式事务/唯一锁；仅 `add_favorite` 捕获了 IntegrityError。

### H9. `original_id` 为 `0` 时被误判为空字符串
- **位置**：`backend/app/services/source_client.py:175`、`backend/app/services/source_client.py:194`
- **问题**：`_normalize_list_item` 和 `_normalize_detail_item` 使用 `str(raw.get("vod_id") or raw.get("id") or "")`。由于 `0` 在 Python 中为 falsy，合法的 ID `0` 会被转成空字符串。
- **影响**：
  - 站点内所有 ID=0 的视频共享空 `original_id`，唯一索引 `(site_id, original_id)` 将它们合并为一条，造成数据丢失/静默覆盖。
  - `videolist(ids=[...])` 查询 ID=0 时无法匹配。
- **证据**：`source_client.py:175` / `194` 的 `or` 链把 `0` 当作缺失值。

### H10. `SourceClient` 未实现硬规范要求的 `h`（小时数）参数
- **位置**：`backend/app/services/source_client.py:60-80`、`backend/app/services/source_client.py:140-154`、`backend/app/services/source_client.py:156-169`
- **问题**：`CLAUDE.md` 硬规范明确 `h=<小时数>` 可用于 `ac=list` 和 `ac=videolist`，但 `_build_params` 只支持 `ac/t/pg/wd/by/ids`，`list()` 和 `videolist()` 也未暴露 `h`。
- **影响**：任何需要“最近 N 小时”查询的功能只能绕过 `SourceClient` 手写 URL，增加规范漂移和重复逻辑风险。
- **证据**：`_build_params` 签名和实现中均无 `h`。

---

## 中（Medium）

### M1. 播放器格式判断把未知后缀当作直接视频
- **位置**：`frontend/src/components/VideoPlayer.tsx:35-49`
- **问题**：`isDirectVideo = isM3u8 || suffixLower === "mp4" || suffixLower === "webm" || suffix === ""`。对于未列出的后缀（如纯数字后缀、自定义后缀），`isDirectVideo` 为 False，会提示“暂不支持播放该格式”；但某些资源站返回的合法后缀可能不在白名单内。
- **影响**：兼容性受限；`analyzeFormat` 与后端 `play.py` 的归一化逻辑不完全对齐。
- **证据**：`VideoPlayer.tsx:46-47` 硬编码后缀白名单。

### M2. `VideoPlayer` 的 `onReady` 在每次播放时都被触发
- **位置**：`frontend/src/components/VideoPlayer.tsx:208-210`
- **问题**：`player.on("playing", () => onReadyRef.current?.())` 把 "playing" 事件当作 ready。播放暂停后再恢复也会触发 `onReady`，语义错误。
- **影响**：父组件可能重复执行 ready 回调（如重复上报统计）。
- **证据**：`VideoPlayer.tsx:208-210` 未监听 ready/canplay 而监听 playing。

### M3. 收藏状态在 VideoCard 上是本地内存状态，不与后端同步
- **位置**：`frontend/src/components/VideoCard.tsx:76`、`frontend/src/components/VideoCard.tsx:111-122`
- **问题**：`favorited` 用 `useState(false)` 初始化，收藏成功后仅本地 setState；重新进入页面或从别的组件回来时状态丢失/不一致。
- **影响**：已收藏视频再次显示为未收藏；用户可能误操作取消/重复收藏。
- **证据**：`VideoCard.tsx:76` 默认 false；无查询后端收藏状态的逻辑。

### M4. 搜索页无分页，仅返回第一页结果
- **位置**：`frontend/src/pages/Search.tsx`、`frontend/src/hooks/useVideos.ts:129-137`
- **问题**：`useSearchVideosQuery` 固定 `pg: 1`，Search 页无翻页或无限滚动。搜索结果超过一页时无法展示后续内容。
- **影响**：搜索命中大量结果时只能看到前 20/12 条。
- **证据**：`useVideos.ts:134` `searchVideos({ wd: q, pg: 1, mode: "aggregated" })`。

### M5. `getProgress` 使用 `PlayProgress.year == year` 对 NULL  year 的语义依赖 SQLAlchemy 隐式转换
- **位置**：`backend/app/api/progress.py:61-75`
- **问题**：`PlayProgress.year == year` 在 `year=None` 时依赖 SQLAlchemy 生成 `IS NULL`。虽然当前版本行为正确，但属于隐式约定，可读性差；与 `upsert_progress` 中显式 `.where(PlayProgress.year == req.year)` 一致，但均未显式使用 `.is_(None)`。
- **影响**：可维护性/可读性问题，未来若类型变更可能出错。
- **证据**：`progress.py:66-68`。

### M6. `m3u8_sanitizer._clean_ts_filename` 粗暴截断查询参数，可能丢失必要参数
- **位置**：`backend/app/services/m3u8_sanitizer.py:887-889`
- **问题**：`_clean_ts_filename(name)` 用 `name.split("?")[0]` 丢弃所有查询参数。某些 CDN 的 .ts URL 需要 token/sign 等参数，截断后返回 403。
- **影响**：去广告/代理模式下部分站点片段无法下载。
- **证据**：`m3u8_sanitizer.py:887-889` 无条件 strip query string。

### M7. 前端 API 封装仅 `get` 支持超时，其他方法无超时
- **位置**：`frontend/src/api/client.ts:9-46`
- **问题**：`request` 函数支持 `timeoutMs`，但 `post/put/patch/del` 的封装未暴露该参数。下载创建、收藏等 POST 请求无超时保护。
- **影响**：慢网络下 POST 请求可能挂起无响应。
- **证据**：`client.ts:40-45` 只定义单参数封装。

### M8. `settings_api.set_download_root` 在 Windows 网络路径/NAS 映射盘上可能误判
- **位置**：`backend/app/api/settings_api.py:27-39`
- **问题**：`Path(path).exists()` 和 `os.access(p, os.W_OK)` 对 UNC 路径或某些挂载盘可能返回不正确结果，导致合法的 NAS 下载根目录被拒绝。
- **影响**：局域网/NAS 部署场景下用户无法设置下载目录。
- **证据**：`settings_api.py:33-38` 未对网络路径做特殊处理。

### M9. 聚合缓存刷新在失败时会丢失已清空的 pending title
- **位置**：`backend/app/services/crawler.py:1201-1204`
- **问题**：`_refresh_aggregated_cache` 先把 `self._pending_norm_titles` 交换到局部变量并清空，然后才调用 `refresh_aggregated_view()`。若刷新抛出异常或返回 `False`，这些 title 已无法恢复。
- **影响**：瞬态 DB 错误会导致受影响的聚合键被静默丢弃，缓存保持陈旧直到下次全量重建。
- **证据**：`crawler.py:1201-1204` 先 `to_refresh = self._pending_norm_titles; self._pending_norm_titles = set()`，再执行刷新。

### M10. 站点 24 小时可用率实际按“UTC 当天午夜起”计算
- **位置**：`backend/app/api/sites.py:158`
- **问题**：`get_site_health` 使用 `_utcnow().replace(hour=0, minute=0, second=0, microsecond=0)` 作为统计起点，即 UTC 当天午夜，而非 `_utcnow() - timedelta(hours=24)`。
- **影响**：可用率忽略了前一日 23:59 至 00:00 UTC 窗口的探测记录，且对非 UTC 时区用户产生误导。
- **证据**：`sites.py:158` `since_24h = _utcnow().replace(...)`。

### M11. `NotifySender` / `ListenManager` 将 channel 名插进 SQL 字符串
- **位置**：`backend/app/services/notify_sender.py:39-40`、`backend/app/services/listen_manager.py:68`
- **问题**：`NOTIFY {channel}, ...` 和 `LISTEN {ch}` 使用 f-string 拼接 channel 名。虽然当前 channel 来自硬编码白名单，但这仍是不安全的 SQL 构造模式，未来若支持动态 channel 则存在注入风险。
- **影响**：事件总线中存在 SQL 注入模式，目前仅靠白名单缓解。
- **证据**：`notify_sender.py:39` `f"NOTIFY {channel}, {self._dollar_quote(payload)}"`。

---

## 低（Low）

### L1. `crawler.py` 同一事务内重复 `commit`
- **位置**：`backend/app/services/crawler.py:1221-1222`
- **问题**：`await db.commit()` 连续调用两次，第二次无实际作用，属于笔误。
- **证据**：`crawler.py:1221-1222` 连续两个 `await db.commit()`。

### L2. `main.py` 启动聚合重建任务的异常未被捕获
- **位置**：`backend/app/main.py:179-193`
- **问题**：`_bootstrap_aggregated_tables` 作为 `asyncio.create_task` 后台运行，任务内部异常不会传播到 lifespan，仅记录日志（`refresh_aggregated_view` 内部已捕获）。但若 `async_session_factory()` 本身异常，则未处理。
- **影响**：首次启动重建失败时无明显告警，首页可能长期为空。
- **证据**：`main.py:193` `asyncio.create_task(_bootstrap_aggregated_tables())` 无 `add_done_callback` 或 try/except。

### L3. 多处前端事件处理未捕获 Promise 异常
- **位置**：
  - `frontend/src/components/VideoCard.tsx:118-121`（收藏）
  - `frontend/src/pages/Player.tsx:75-78`（获取集数）
  - `frontend/src/components/DetailContent.tsx:88-95`（收藏）
  - `frontend/src/pages/Settings.tsx:218-220`、`279-282`、`304-307` 等
- **问题**：`.then(...)` 缺少 `.catch(...)`，API 失败时产生未捕获的 Promise rejection，可能触发 React 错误边界或白屏。
- **影响**：错误处理不完整，用户体验差。

### L4. `play.py._parse_source_info` 仅用第一行判断 suffix
- **位置**：`backend/app/api/play.py:42-54`
- **问题**：取 `lines[0]` 的 suffix 作为整个视频源的代表 suffix。若多集后缀不一致（如部分 mp4 部分 m3u8），返回的 `suffix` 不具代表性。
- **影响**：`/api/play/sources` 返回的 suffix 可能误导前端。
- **证据**：`play.py:49-52` 只解析 lines[0]。

### L5. `Downloads.tsx` 新建任务 SSE 占位数据字段缺失
- **位置**：`frontend/src/pages/Downloads.tsx:748-770`
- **问题**：收到 `download_status` 新增任务时，`source_site_id`、`source_video_id`、`url`、`suffix` 等字段被硬编码为占位值（0/空串），直到用户手动刷新才拿到真实数据。
- **影响**：新增任务瞬间列表显示不完整。

### L6. `Search.tsx` 输入框样式硬编码而非使用 CSS 变量
- **位置**：`frontend/src/pages/Search.tsx:36-48`
- **问题**：输入框背景、边框颜色直接写死 `rgba(...)`，未使用 `var(--input-bg)`/`var(--glass-border)` 等主题变量。
- **影响**：与深黑影院主题系统不一致，若主题变量调整，搜索页样式不跟随。

---

## 测试/环境相关

### T1. 根目录 `test/` 默认需要 PostgreSQL，未提供 SQLite 测试路径
- **位置**：`test/conftest.py:10-12`、`backend/test/conftest.py:12-15`
- **问题**：两套测试的默认 `TEST_DB_URL` 都指向 PostgreSQL，与项目“SQLite 默认”矛盾；在没有本地 PostgreSQL 时根目录测试全部 ERROR/FAIL。
- **影响**：新用户/CI 按文档使用 SQLite 时无法运行完整测试套件。
- **证据**：运行 `python -m pytest test/` 报 `asyncpg.exceptions.ConnectionDoesNotExistError`。

### T2. `test/conftest.py` 使用独立 FastAPI 应用，未测试真实 `main.py` 的 lifespan/中间件/静态文件
- **位置**：`test/conftest.py:44-58`
- **问题**：测试应用手动挂载路由，未导入 `app.main:app`，因此启动生命周期（WAL、pg_trgm、默认分类、聚合表重建、scheduler、download worker）均未被测试。
- **影响**：集成测试覆盖度不足，C1、C2 等启动相关问题无法在测试中暴露。

---

## 前端子代理复核补充（已验证）

### F1. `ProgressCard` 恢复播放未传 `title`/`year`，导致源切换与进度记录失效
- **位置**：`frontend/src/pages/Progress.tsx:91-97`
- **问题**：最近播放卡片跳转到 Player 时只带 `site_id`、`original_id`、`ep`，未带 `title` 和 `year`。而 `Player.tsx` 依赖这两个参数加载可用源、恢复保存的进度、以及向服务端上报进度。
- **影响**：从“最近播放”恢复时，无法换源、无法恢复历史进度、且保存的进度 title 为空。
- **证据**：`Progress.tsx:92-96` navigate 字符串缺少 `title`/`year`；`Player.tsx:21-23` 读取 `title`/`year`。

### F2. `VideoPlayer.lockMaxQuality` 立即锁码率时未清理旧 interval
- **位置**：`frontend/src/components/VideoPlayer.tsx:51-83`
- **问题**：`tryLock()` 首次成功即 `return`，不会执行后续 `clearInterval(timerRef.current)`。若前一个源已启动 interval，切源后旧 interval 仍指向旧的 HLS 实例。
- **影响**：内存泄漏，且可能在切源后误改已销毁播放器的码率状态。
- **证据**：`VideoPlayer.tsx:67` `if (tryLock()) return;` 跳过了 69-72 行的清理。

### F3. 切换到不支持格式时旧视频仍在后台播放
- **位置**：`frontend/src/components/VideoPlayer.tsx:248-254`
- **问题**：player 已存在、新 suffix 不支持时，仅设置本地 `error` 状态并 `return`，没有暂停或销毁现有播放器。
- **影响**：错误遮罩层后，上一个源的音视频继续播放。
- **证据**：`VideoPlayer.tsx:249-254` 检测到 `!isDirectVideo` 后仅 `setError` 即返回。

### F4. `useVideosInfinite` 裁剪分页时 `pageParams` 长度错误
- **位置**：`frontend/src/hooks/useVideos.ts:113-117`
- **问题**：内存封顶裁剪后，`pageParams` 被切片为 `newPages.length + 1`，但 React Query 中 `pageParams.length` 应等于 `pages.length`。
- **影响**：无限分页状态不一致，可能触发错误页码请求。
- **证据**：`useVideos.ts:117` `pageParams: old.pageParams.slice(0, newPages.length + 1)`。

### F5. iOS 全屏事件监听挂载到 `document` 而非 `<video>`
- **位置**：`frontend/src/utils/fullscreen.ts:187-194`
- **问题**：`webkitbeginfullscreen` / `webkitendfullscreen` 实际在 `<video>` 元素上触发，但代码注册到了 `document`。
- **影响**：iOS 进入/退出原生视频全屏后，`useFullscreen` 状态不同步，假横屏/CSS 和按钮状态错误。
- **证据**：`fullscreen.ts:193-194` `document.addEventListener("webkitbeginfullscreen", handler)`。

### F6. 批量下载在任务真正创建前已提示成功
- **位置**：`frontend/src/components/DetailContent.tsx:193-206`
- **问题**：`handleConfirmBatchDownload` 先关闭弹窗并 `toastSuccess("已开始创建下载任务")`，再以 fire-and-forget 方式调用 `createTasksAsync`。若后续创建失败，成功提示已发出。
- **影响**：误导用户；失败仅通过通用 API 错误 toast 暴露。
- **证据**：`DetailContent.tsx:203-205` 先 toast 再异步创建。

### F7. 收藏页删除按钮仅在 hover 时显示（触屏/键盘不可访问）
- **位置**：`frontend/src/pages/Favorites.tsx:112-137`
- **问题**：删除按钮 `opacity` 和 `transform` 受 hover 状态控制，无 focus-visible 或触屏兜底。
- **影响**：移动端和键盘用户无法取消收藏。

### F8. `SiteHealthDrawer` 直接修改 prop 且未同步父组件
- **位置**：`frontend/src/components/SiteHealthDrawer.tsx:116-125`
- **问题**：`toggleSite` 直接修改 `site.enabled = !site.enabled`，且未通知父组件 `Settings` 更新 `sites` 数组。
- **影响**：关闭再打开抽屉后，启用状态回退为旧值。

### F9. 进度恢复请求可能覆盖用户显式选集
- **位置**：`frontend/src/pages/Player.tsx:129-155`
- **问题**：`getProgress` 不可取消。若用户在恢复请求返回前点击某集，`setCurrentIndex(res.episode_index)` 和延迟 `seekTo` 会覆盖用户选择。
- **影响**：用户点了第 X 集，又被跳回历史进度所在集。

### F10. Player 全局监听 ArrowLeft/ArrowRight，过度拦截
- **位置**：`frontend/src/pages/Player.tsx:235-279`
- **问题**：快捷键挂载在 `window` 上，只要目标不是 input/textarea 就 `preventDefault()`。这会劫持页面上其他可获得焦点元素的箭头键导航。
- **影响**：可访问性受损，焦点在菜单/滑块上时箭头键失效。

### F11. 详情页分源剧集列表绕过 `SourcePicker`
- **位置**：`frontend/src/components/DetailContent.tsx:360-379`
- **问题**：详情页直接渲染每个来源的 `EpisodeList`，点击集数直接 `navigate` 到 Player。当只有一个来源时，用户不会看到强制选源弹窗。
- **影响**：违反“无默认源，必须显式选源”的架构硬规范。

### F12. `RecommendedCarousel` 轮播项不可键盘访问
- **位置**：`frontend/src/components/RecommendedCarousel.tsx:265-366`
- **问题**：轮播项是 `<div onClick>`，无 `role`、`tabIndex`、键盘事件和 ARIA 标签。
- **影响**：键盘和屏幕阅读器用户无法选择推荐视频。

### F13. 播放器正常退出时最多丢失约 15 秒进度
- **位置**：`frontend/src/pages/Player.tsx:157-200`
- **问题**：进度仅在 15 秒定时器和 `beforeunload` 时保存，正常路由跳转（如点击返回）不会强制最终保存。
- **影响**：用户正常离开播放器时可能丢失最近 15 秒进度。

---

## 已由后台子代理复核并合并的项

- SQLite 建表崩溃（PostgreSQL 专属类型 TSVECTOR/ARRAY）
- `original_id=0` 被误判为空字符串
- `SourceClient` 缺少硬规范要求的 `h` 参数
- 聚合缓存刷新失败时丢失 pending title
- 站点 24 小时可用率按 UTC 午夜计算
- `NOTIFY`/`LISTEN` 的 channel 名 SQL 字符串插值

---

## 待后续复核项

以下问题由人工通读发现，尚未精确定位到可复现用例，建议后续复核：

1. `source_client._convert_play_url` 对“已规范格式”的判断使用 `ln.count("$") >= 2`，与 `parser.py` 的“恰好 3 段”要求不一致，可能把 `a$b$c$d` 这类非法行当作合法格式直接透传。
2. `videos.py` 的 `_query_and_aggregate` 与 `aggregator.py` 的聚合/回填逻辑分散在两处，存在重复实现，长期维护易产生行为漂移。
3. `scheduler._seconds_until_next_run` 使用 `datetime.now()`（本地时间），但常量命名为 `CRAWLER_FILL_VIDEOLIST_HOUR/MINUTE`，跨时区部署或服务器时区非本地时会有偏差。

---

## 测试运行结果摘要

- **backend/test/**：`8 passed, 8 warnings`（仅覆盖分类缓存新逻辑）。
- **frontend**：`2 test files, 7 tests passed`。
- **根目录 test/**：`19 failed, 23 passed, 40 errors`，失败/错误均因默认 PostgreSQL 测试库连接失败（`asyncpg.exceptions.ConnectionDoesNotExistError`）。
