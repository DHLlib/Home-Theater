# 项目经验教训

## 2026-06-13：m3u8 并发下载报 "Could not refresh instance"

**现象**：
后端日志大量出现：

```
Could not refresh instance '<DownloadTask at 0x...>'
```

发生在 `app/services/downloader.py` 的 m3u8 `.ts` 并发下载阶段，具体在 `_check_paused()` 的 `await session.refresh(task)`。

**原因**：
`_run_m3u8_download` 内用 `asyncio.gather` 并发下载多个 `.ts` 片段，并通过 `_session_lock` 串行访问同一个 `AsyncSession`。虽然加锁后不再报 "concurrent operations are not permitted"，但 `session.refresh(task)` 在并发+多次 `commit` 后仍可能触发 `InvalidRequestError: Could not refresh instance`，说明 `task` 对象在会话中的状态已不一致（detached 或 identity map 异常）。

**解决**：
不再直接 `refresh(task)`，而是在每次需要提交或检查暂停状态时重新 `session.get(DownloadTask, task_id)` 加载对象，把内存中的计数复制到新对象上再 commit：

```python
async def _batch_commit(force: bool = False):
    fresh = await session.get(DownloadTask, task_id)
    if fresh is None:
        return
    fresh.downloaded_bytes = task.downloaded_bytes
    fresh.downloaded_segments = task.downloaded_segments
    fresh.total_segments = task.total_segments
    fresh.status = task.status
    await session.commit()
    ...

async def _check_paused() -> bool:
    fresh = await session.get(DownloadTask, task_id)
    if fresh is None:
        return False
    task.status = fresh.status
    ...
```

最终完成时也通过 `session.get` 重新加载对象再更新 `file_path` 和 `status`。

**教训**：
- `AsyncSession` 即使在显式加锁的情况下，也不宜长期把同一个 ORM 对象传给多个并发协程做 `refresh/commit`；对象状态可能在多次 commit 后变不稳定。
- 对高频并发更新，更安全的模式是：用内存变量做累加器，提交前重新 `session.get` 加载对象并复制状态，再 commit。
- 直接链式 `refresh(task) → commit()` 在并发下载场景下仍然脆弱，应优先使用 "重新加载 + 复制字段" 的写法。

---

## 2026-06-13：PostgreSQL NOTIFY 并发发送报 "another operation is in progress"

**现象**：
后端日志反复报错：

```
asyncpg.exceptions._base.InterfaceError: cannot perform operation: another operation is in progress
```

发生在 `app/services/notify_sender.py:36`：

```python
await self._conn.execute(f"NOTIFY {channel}, {self._dollar_quote(payload)}")
```

**原因**：
`NotifySender` 使用单条持久 asyncpg 连接执行 `NOTIFY`。当多个下载任务并发调用 `notify_sender.send()` 时，同一条连接上同时存在多个未完成的操作，asyncpg 不允许单连接并发执行，于是抛出该错误。

**解决**：
在 `NotifySender` 中增加 `asyncio.Lock`，串行所有连接使用：

```python
import asyncio

class NotifySender:
    def __init__(self):
        self._conn = None
        self._lock = asyncio.Lock()

    async def send(self, channel: str, event: Event) -> None:
        # ... 校验与序列化 ...
        async with self._lock:
            if self._conn is None or self._conn.is_closed():
                self._conn = await asyncpg.connect(dsn=self._dsn_for_asyncpg())
            await self._conn.execute(
                f"NOTIFY {channel}, {self._dollar_quote(payload)}"
            )
```

**教训**：
- asyncpg 的单个 `Connection` 不是协程安全的，同一时刻只能有一个操作在进行。
- 持久连接 + 并发写入时，必须用锁或队列串行访问；否则应改为每次发送新建连接（但性能较差）。
- 该问题在多下载并发（coordinator 同时运行多个任务）场景下必然出现，早锁优于后锁。

---

## 2026-06-13：PostgreSQL NOTIFY 不支持参数占位符

**现象**：
后端日志反复报错：

```
asyncpg.exceptions.PostgresSyntaxError: 语法错误 在 "$1" 或附近的
```

发生在 `app/services/notify_sender.py:35`：

```python
await self._conn.execute(f"NOTIFY {channel}, $1", payload)
```

**原因**：
PostgreSQL `NOTIFY channel, payload` 语句不支持参数占位符（`$1`、`?` 等）。它是纯 SQL 命令，payload 必须以内联字符串字面量形式写入语句。asyncpg 尝试 prepare 该语句时把 `$1` 当成语法错误。

**解决**：
改用 PostgreSQL dollar-quoting 把 payload 安全地嵌入 SQL：

```python
@staticmethod
def _dollar_quote(s: str) -> str:
    tag = "notify"
    while f"${tag}$" in s:
        tag += "x"
    return f"${tag}${s}${tag}$"

await self._conn.execute(f"NOTIFY {channel}, {self._dollar_quote(payload)}")
```

dollar-quoting 比手动转义单引号更 robust，能避免 `standard_conforming_strings` 不同配置下的反斜杠转义差异。

**教训**：
- 不是所有 SQL 命令都支持参数化。`NOTIFY`、`LISTEN`、`COPY` 等命令需要单独处理字符串内联。
- 内联用户可控数据时，优先使用 dollar-quoting 或严格转义，不要直接拼接。

---

## 2026-06-13：下载后端逻辑 review 及修复

**现象**：
用户要求重新检查整个下载后端逻辑。review 后发现若干潜在问题。

**问题 1：m3u8 .ts 片段 URL 拼接可能产生双斜杠**
- 文件：`app/services/downloader.py`
- 原代码：`ts_base_url + ts_name`
- 当 `ts_base_url` 以 `/` 结尾、`ts_name` 以 `/` 开头时，会产生 `//`，导致 404

**修复**：
```python
from urllib.parse import urljoin
# ...
ts_url = (
    ts_name
    if ts_name.startswith(("http://", "https://"))
    else urljoin(ts_base_url, ts_name)
)
```

**问题 2：.ts 重试次数硬编码**
- 原代码：`if attempt < 2:`，与配置项 `RETRY_MAX_ATTEMPTS` 无关
- 当 `RETRY_MAX_ATTEMPTS` 调整时，实际重试次数不会跟随变化

**修复**：
```python
if attempt < RETRY_MAX_ATTEMPTS - 1:
    await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2 ** attempt))
else:
    return False
```

**问题 3：m3u8 ffmpeg 降级合并可能产生空文件并标记完成**
- 原代码：`_concat_ts_files` 不返回写入状态；即使没有任何 ts 片段被写入，后续也会把任务标记为 `done`

**修复**：
- `_concat_ts_files` 改为返回 `bool`，表示是否实际写入了数据
- `_run_m3u8_download` 在合并后校验最终文件是否存在且大小大于 0

**问题 4：直链下载未处理 Range 200/206/416 差异**
- 原代码：对所有 2xx 响应都直接追加写入（`"ab"` 模式）
- 若服务器不支持 Range 而返回 200，会把完整文件追加到已有的部分文件上，导致文件损坏
- 若服务器返回 416（Range Not Satisfiable），没有处理

**修复**：
- 200 + 已下载部分 > 0：重置 `downloaded_bytes = 0`，使用 `"wb"` 从头下载
- 416：直接标记为完成（通常意味着已下载完毕）
- 206：正常断点续传，`total_bytes = downloaded_bytes + content-length`
- 200：`total_bytes = content-length`

**改动文件**：
- `backend/app/services/downloader.py`
- `backend/app/services/notify_sender.py`（NOTIFY 参数化问题）

**验证**：
- `python -m py_compile app/services/downloader.py app/services/notify_sender.py app/api/downloads.py app/services/listen_manager.py` ✅

**教训**：
- HTTP Range 下载必须显式区分 200 和 206；盲目追加会损坏文件。
- 降级路径（如 ffmpeg 失败后的 concat）也要有明确的成功/失败返回值，不能静默产生空文件。
- 配置项 `RETRY_MAX_ATTEMPTS` 必须在循环条件中使用，不要硬编码数字。

---

## 2026-06-13：Phase 2 聚合中间表重建踩坑

**现象 1**：SQLite 通用路径下，全量重建聚合中间表时进程内存暴涨到约 8.7 GB，最终 OOM。

**原因**：
Python 端把 `video_cache` 全部记录（约 180 万条）读到内存做聚合，并保留了每条 source 引用，导致内存占用过高。

**解决**：
- PostgreSQL 路径改用 `INSERT ... SELECT` + CTE，在数据库端完成聚合，只写入结果。
- SQLite 路径保留 Python 流式聚合，但按 `norm_title` 首字符哈希分 16 个桶，逐桶读、逐桶写，避免全表驻留内存。

**教训**：
- 大数据量聚合尽量下推到数据库；Python 端只做数据库无法完成的逻辑。
- 如果必须在 Python 端聚合，使用流式/分区，控制同时驻留内存的数据量。

---

**现象 2**：给 `aggregated_videos` 加唯一约束 `(norm_title, year)` 后，重建报 `UniqueViolationError`。

**原因**：
物化视图聚合键实际上是 `(norm_title, year, title)`：同一个规范化名称+年份可能对应多个原始 title（例如标点、大小写差异清理后相同，但原 title 不同），所以 `(norm_title, year)` 不唯一。

**解决**：
去掉 `AggregatedVideoV3` 上的 `UniqueConstraint("norm_title", "year")`。

**教训**：
- 从物化视图迁移到普通表时，不能简单照搬“看起来唯一”的字段，必须核对物化视图的 `GROUP BY` 粒度。
- 预聚合表允许同一 `(norm_title, year)` 存在多行，只要读取时按排序取前 N 条即可。

---

**现象 3**：PostgreSQL CTE 重建 `aggregated_videos` 时偶发 `ERROR: mergejoin input data is out of order`。

**原因**：
PostgreSQL 优化器在处理大规模排序+聚合的 CTE 时触发已知 bug，生成错误结果的 merge join 计划。

**解决**：
在重建 SQL 执行前设置 `SET LOCAL enable_mergejoin = off`，强制优化器避开 merge join。

**教训**：
- 大数据量聚合如果确认数据本身有序，但优化器报“out of order”，优先怀疑优化器计划 bug。
- 使用 `SET LOCAL` 限制会话级优化器开关，避免全局影响。

---

**现象 4**：`recommended_videos` 重建速度极慢，且日志长时间无输出。

**原因**：
`rebuild_recommended_videos()` 使用 `selectinload(AggregatedVideoV3.sources_rel)` 一次性加载全部聚合视频及其来源关系，数据量巨大时耗时久、内存高。

**解决**：
- 当前实现已能完成重建（本次约 180 万条聚合后产生 15 条推荐）。
- 后续若推荐重建成为瓶颈，可改为按父分类分批次 SQL 聚合，避免 ORM 全量加载。

**教训**：
- 全表 `selectinload` 只适用于小表；大数据量的预计算推荐应优先用 SQL 聚合或分页批量处理。

---

**现象**：
用户报告后端日志出现 `PermissionError: [WinError 32] 另一个程序正在使用此文件，进程无法访问。`，发生在 `RotatingFileHandler` 尝试轮转 `backend/logs/source.log` 时。

**原因**：
Claude 在调试过程中启动了 8181 端口的后端用于测试，测试完成后没有停止该进程。用户随后按自己的配置启动了 8000 端口的后端。两个 Python 进程同时写入同一个日志文件，当日志大小达到阈值需要轮转重命名时，一个进程持有文件句柄，另一个进程报 `PermissionError`。

**解决**：
1. 停止所有 Python 后端进程
2. 清理 `backend/logs/` 下的旧日志文件
3. 按 `.env` 配置重新启动单个后端

**教训**：
- 任何由调试/测试启动的后端、worker、服务器进程，在测试结束后必须立即清理
- 启动新实例前，先检查是否已有同类进程在运行（`tasklist | grep python`、`netstat`）
- 不要假设用户不会自己启动服务；测试端口应与用户配置保持一致，或测试后明确告知用户

---

## 2026-06-13：前端构建后进入详情页报动态导入失败

**现象**：
从前端页面跳转到详情页时，出现白屏错误：

```
Unexpected Application Error!
Failed to fetch dynamically imported module: http://localhost:8000/assets/Detail-BM5AW7Dg.js
TypeError: Failed to fetch dynamically imported module: ...
```

**原因**：
React Router 对 `Detail`、`Player` 等页面使用了 `React.lazy` 代码分割。每次执行 `npm run build` 后，`dist/assets/` 下的 chunk 文件名会带上新的 content hash（例如本次构建生成的是 `Detail-gDm1fT_Y.js`，而报错中的 `Detail-BM5AW7Dg.js` 是旧 hash）。浏览器若仍持有旧的 `index.html` 缓存，加载详情页时会请求已不存在的旧 chunk，导致 404/动态导入失败。

**解决**：
1. 浏览器端：对 `localhost:8000` 强制刷新（`Ctrl + F5`）或清空该站点缓存。
2. 服务端：确保 8000 端口服务的是最新的 `frontend/dist/` 产物；如果后端是生产模式托管静态文件，需要在 `npm run build` 后重启后端进程，以便读取新的 `dist/index.html`。

**教训**：
- 任何执行了 `npm run build` 的改动，都需要同步刷新浏览器缓存，否则 lazy chunk 的 hash 不匹配会直接崩溃。
- 生产模式（后端托管 `dist`）下，构建后必须重启后端服务，不能依赖旧进程继续服务新文件。

---

## 2026-06-13：下载后缀判断未与播放器对齐

**现象**：
用户问「现在的下载逻辑适合所有站点吗？」review 后发现下载器对 m3u8 类后缀的判断比播放器窄。

**原因**：
- 前端播放器用 `suffix.toLowerCase().endsWith("m3u8") || suffix.toLowerCase().endsWith("yun")` 检测 HLS。
- 后端 `downloader.py` 原来用 `M3U8_SUFFIXES = ("m3u8", "ffm3u8")` 做精确匹配，导致 `155m3u8`、`xlyun` 等被播放器当作 HLS 的后缀，在下载器里被当成直链下载。
- `downloads.py` 生成文件扩展名时也只用 `req.suffix in ("mp4", "m3u8")`，`ffm3u8`、`155m3u8` 会被存成 `.mp4`，语义错误。

**修复**：
1. `app/services/downloader.py` 改为后缀匹配函数：

```python
def _is_m3u8_suffix(suffix: str) -> bool:
    if not suffix:
        return False
    return suffix.lower().endswith(("m3u8", "yun"))
```

2. `app/api/downloads.py` 生成扩展名时同步处理 `m3u8`/`yun`、`mp4`、`webm`：

```python
suffix_lower = req.suffix.lower()
if suffix_lower.endswith(("m3u8", "yun")):
    ext = "m3u8"
elif suffix_lower in ("mp4", "webm"):
    ext = suffix_lower
else:
    ext = "mp4"
```

**教训**：
前后端对同一概念（「这是不是 HLS」）的判断逻辑必须保持一致，否则播放器能播的链接下载器会下错。

---

## 2026-06-13：暂停中的 m3u8 下载删除源文件失败

**现象**：
用户反馈：暂停下载后，勾选「同时删除本地源文件」删除任务，提示「源文件已被删除或不存在」，但磁盘上仍有未下载完的临时文件。

**原因**：
- m3u8 任务创建时 `file_path` 为 `.../剧集名.m3u8`。
- 下载器实际把 `.ts` 片段存在 `.../剧集名/.ts_{task_id}/` 临时目录。
- 任务完成前 `file_path` 不会更新为 `.mp4`，所以 `os.remove(task.file_path)` 始终找不到 `.m3u8` 文件，报 `FileNotFoundError`。
- 删除逻辑没有清理 `.ts_{task_id}/` 临时目录。

**修复**：
`app/api/downloads.py` 删除任务时，收集所有可能存在的目标并逐一清理：

1. `task.file_path` 本身
2. 若后缀是 `.m3u8`，同时尝试删除对应的 `.mp4`
3. 删除 `.ts_{task_id}/` 临时目录

只要任意目标被成功删除，即认为删除成功；全部不存在时才返回「源文件已被删除或不存在」。

**教训**：
m3u8 下载的文件路径在任务生命周期内会变化（创建时 `.m3u8` → 完成时 `.mp4`），并且存在独立的临时目录。删除逻辑不能只依赖数据库里的 `file_path`。

---

## 2026-06-13：直链下载进度条不更新

**现象**：
用户反馈下载进度条不会动。

**原因**：
- m3u8 下载在 `_run_m3u8_download` 里每次批量 commit 后都会发送 `download_progress` SSE 事件。
- 直链下载 `_run_direct_download` 虽然也会每 5 秒 / 每 100 个 chunk 做一次 DB commit，但**没有发送 `download_progress` 事件**。
- 结果：直链任务只有开始和结束两个 `download_status` 事件，中间进度不会推给前端，进度条卡在 0%。

**修复**：
`app/services/downloader.py` 的直链下载循环里，每次 commit 后追加 `download_progress` 事件推送：

```python
if now - last_commit >= DOWNLOAD_DB_COMMIT_INTERVAL or chunk_counter >= DOWNLOAD_BATCH_COMMIT_CHUNKS:
    await session.commit()
    await notify_sender.send("download_events", Event("download_progress", {
        "task_id": task_id,
        "downloaded_bytes": task.downloaded_bytes,
        "total_bytes": task.total_bytes,
        "downloaded_segments": task.downloaded_segments,
        "total_segments": task.total_segments,
        "status": task.status,
    }))
    last_commit = now
    chunk_counter = 0
```

**教训**：
DB commit 和前端进度推送是两件事。只 commit 不推送，用户界面就不会动。

---

## 2026-06-13：m3u8 并发下载触发 SQLAlchemy 会话并发错误

**现象**：
m3u8 下载时日志报：

```
sqlalchemy.exc.InvalidRequestError: This session is provisioning a new connection;
concurrent operations are not permitted
```

发生在 `download_one` 中的 `await session.refresh(task)`。

**原因**：
- `_run_m3u8_download` 里用 `asyncio.gather` 并发执行多个 `download_one`。
- 每个 `download_one` 都会调用 `session.refresh(task)` 和 `session.commit()`。
- SQLAlchemy 的 async session 不允许并发操作；多个协程同时访问同一个 session 就会报 `concurrent operations are not permitted`。
- 此外，`task.downloaded_bytes += len(resp.content)` 和 `task.downloaded_segments += 1` 在多协程下也存在竞态，可能导致计数丢失。

**修复**：
`app/services/downloader.py` 中引入一个 `_session_lock`（`asyncio.Lock`），串行所有 session 访问和计数器更新：

1. `_batch_commit` 改为要求调用方已持有锁。
2. 新增 `_check_paused` 辅助函数，在锁内执行 `session.refresh(task)`，若已暂停则 commit。
3. `download_one` 在需要刷新状态或更新进度时先获取 `_session_lock`。
4. `.ts` 文件写盘放在锁外，避免阻塞其他下载协程。

**教训**：
SQLAlchemy async session 不是协程安全的；多个协程不能同时对它调用 `refresh` / `commit`。并发下载时要么每个协程用独立 session，要么用锁串行所有 ORM 操作。

---

## 2026-06-13：m3u8 下载进度条不动，SSE 中 total_segments 为 null

**现象**：
SSE 能收到 `download_progress` 事件，但 `total_segments` 为 `null`，进度条始终 0%。例如：

```json
{"type": "download_progress", "payload": {"task_id": 9, "downloaded_bytes": 107210572, "total_bytes": null, "downloaded_segments": 200, "total_segments": null, "status": "downloading"}}
```

**原因**：
- m3u8 解析后设置了 `task.total_segments = len(ts_names)`，但只在「存在已下载片段」时才 `await session.commit()`。
- 无断点续传时，`total_segments` 只存在于内存中，未写入数据库。
- 并发下载协程中的 `session.refresh(task)` 会从数据库重新加载对象，把内存里的 `total_segments` 刷回 `null`。
- 前端进度计算依赖 `total_segments > 0`，所以百分比一直为 0。

**修复**：
`app/services/downloader.py` 中，无论是否存在已下载片段，都在进入并发下载前提交一次 `total_segments`：

```python
total_ts = len(ts_names)
task.total_segments = total_ts

# ... 统计已下载片段 ...

await session.commit()
```

**教训**：
`session.refresh(task)` 会丢弃未提交的内存修改。在并发读取/刷新 ORM 对象前，务必先把关键字段提交到数据库。

---

## 2026-06-13：点击暂停后下载仍在继续，延迟明显

**现象**：
在下载页面点击暂停后，任务状态显示"已暂停"，但网络流量/日志显示后端仍在下载 ts 片段或文件字节。

**原因**：
- 当前暂停机制是**轮询式**：下载器每 `DOWNLOAD_PAUSE_CHECK_INTERVAL` 秒通过 `session.refresh(task)` 查询一次数据库中的 `status`。
- 如果用户点击暂停时，当前刚好发起了一个 HTTP 请求，这个请求会直到完成才结束；下一次轮询时才会发现已暂停。
- 原间隔为 3 秒，意味着最坏情况下要等待「3 秒 + 当前请求耗时」才真正停下来。

**修复**：
`backend/app/constants.py` 中将轮询间隔从 3 秒改为 1 秒：

```python
DOWNLOAD_PAUSE_CHECK_INTERVAL = 1
```

**限制**：
轮询间隔再小，也无法立即中断已经发出去的 HTTP 请求。要实现"秒停"，需要引入请求取消机制（如 `asyncio.Event` + `httpx` 流式读取超时/取消），改动较大，当前版本未实现。

**教训**：
- 轮询式暂停实现简单，但响应有上限
- 用户对暂停的直觉是"立即停止"，实际只能做到"尽快停止"

---

## 2026-06-13：不勾选任务直接批量暂停，部分任务未暂停

**现象**：
下载页点击卡片上的【暂停】（未勾选任何子任务，即对该视频下全部可暂停任务批量暂停），偶尔仍有任务继续下载，刷新后状态仍是 `downloading`。

**原因**：
1. 前端 `handleBatchPause` 对同一视频下的所有 `queued`/`downloading` 任务并发调用 `pauseDownload`。
2. 后端 `pause()` 虽然会把 DB 状态改为 `paused` 并 `request_stop(task_id)`，但 `request_stop` 只对**已经运行**的 worker（在 `_task_stop_events` 中注册了事件）生效；对于状态还是 `queued` 的任务，事件尚未注册。
3. 后端 `coordinator` 的 `_pick_next_task` 是 `select` → `update` 两步，存在竞态窗口：
   - pause API 读取到任务状态为 `queued`；
   - 同一时刻 coordinator 也读取到 `queued` 并把它更新为 `downloading`、启动 worker；
   - pause API 随后把状态改回 `paused`，但 worker 新注册的事件覆盖了原事件（`_register_task` 原来会创建全新 `asyncio.Event`），导致暂停信号丢失；
   - worker 继续运行，最终状态可能又变回 `downloading`。

**解决**：
1. `_register_task` 改为保留已有事件，若 API 层已经设置过停止事件则不再覆盖：
   ```python
   def _register_task(task_id: int) -> asyncio.Event:
       event = _task_stop_events.get(task_id)
       if event is None:
           event = asyncio.Event()
           _task_stop_events[task_id] = event
       return event
   ```
2. `_pick_next_task` 改用单条 `UPDATE ... RETURNING` 原子取任务并设为 `downloading`，消除 select-then-update 的竞态窗口：
   ```python
   subq = (
       select(DownloadTask.id)
       .where(DownloadTask.status == "queued")
       .order_by(DownloadTask.created_at)
       .limit(1)
       .scalar_subquery()
   )
   stmt = (
       update(DownloadTask)
       .where(DownloadTask.id == subq)
       .values(status="downloading")
       .returning(DownloadTask.id)
   )
   ```
3. worker 启动时若发现 `stop_event.is_set()`，立即把任务置为 `paused` 并退出，避免 coordinator 抢到任务后仍继续下载。
4. 直链下载的 chunk 循环和 m3u8 的 `_check_paused` 都把「`stop_event.is_set()`」视为暂停信号，不再只看 DB 状态，确保 pause API 请求一定能被运行中的 worker 响应。

**验证**：
- `python scripts/simulate_download.py` 通过（含暂停/继续/删除运行中任务场景）。

**教训**：
- 对 `queued` → `downloading` 的状态转换必须原子化，否则批量暂停会与调度器产生抢任务 race。
- 内存级 stop signal 必须被 worker 注册时保留，否则“先 pause、后启动 worker”会让信号被新事件覆盖。
- 运行中 worker 应把 stop event 本身当作暂停请求，而不是仅依赖刷新后的 DB 状态；这能覆盖 coordinator 与 pause API 并发写状态的各种时序。



**背景**：
为验证下载模块在「创建 → 下载 → 暂停 → 继续 → 删除」完整生命周期内的行为，编写了独立脚本 `backend/scripts/simulate_download.py`。

**模拟覆盖**：
1. 在临时目录初始化 SQLite 数据库（只创建 `sites`、`download_tasks` 两张表，跳过 PostgreSQL 物化视图）。
2. 启动本地 HTTP 服务，提供直链文件与 m3u8 playlist + `.ts` 片段。
3. 直链下载：验证 `status=done`、`total_bytes` 与文件存在。
4. m3u8 下载：验证 `total_segments=5`、`downloaded_segments=5`、最终输出 `.mp4`。
5. 暂停 / 继续：调小 `DOWNLOAD_PAUSE_CHECK_INTERVAL`，在首个 chunk 写入后暂停，恢复后继续下载至完成，验证断点续传路径。
6. 删除任务与文件：模拟 API 删除逻辑，清理数据库记录与磁盘文件。

**遇到的问题与处理**：
- `Site` 模型没有 `api_url` 字段；脚本中只使用 `name` 与 `base_url`。
- SQLite 下 `Base.metadata.create_all()` 会尝试创建含 `ARRAY(String)` 的 `mv_aggregated_videos`，导致编译错误；改为只创建需要的两张表。
- `NotifySender` 在 SQLite 环境下会尝试用 asyncpg 连接，报错但不影响下载；脚本将其 `send` 替换为 no-op。
- 本地 `SimpleHTTPRequestHandler` 默认不支持 `Range`，暂停后继续下载会触发代码里的“服务器不支持 Range”降级路径；为提升模拟真实度，自定义了支持 `Range` 的 handler。
- 模拟用的 `.ts` 片段是占位字节，ffmpeg 合并会失败，但下载器会降级为直接拼接 `.ts` 文件，最终仍能生成 `.mp4`。

**验证结果**：
脚本最终输出：

```
✅ 下载功能逻辑模拟全部通过
```

**教训**：
- 端到端模拟能暴露模块与外部依赖（数据库方言、HTTP Range、ffmpeg）的边界行为。
- 用 SQLite 跑 PostgreSQL 项目的全量建表时，要注意物化视图/数组类型等 PG 专属特性。
- 下载器的降级路径（ffmpeg 失败 → 直接拼接）在模拟中得到了验证，说明降级逻辑是生效的。

---

## 2026-06-13：批量暂停后批量删除，worker 仍在写入 `.ts` 目录

**现象**：
用户反馈：「不勾选，直接点击视频的批量暂停，然后点击批量删除」，后端持续报错：

```
ts 下载失败 ... No such file or directory: '...\\.ts_{task_id}\\...'
ts 下载失败 ... Cannot send a request, as the client has been closed.
```

**原因**：
1. m3u8 下载 worker 在 `_run_m3u8_download` 内通过 `asyncio.gather` 并发下载 `.ts` 片段，每个 `download_one` 不断重试写入本地 `.ts_{task_id}/seg{i}.ts`。
2. 前端批量暂停只把 DB 状态改为 `paused`，worker 在下次 `_check_paused()` 时才会退出循环；如果用户紧接着批量删除任务，DB 记录被删掉、磁盘 `.ts_{task_id}` 目录也被清理。
3. 正在运行的 worker 尚未检查到状态变化，继续尝试下载并写入已被删除的目录，于是报 `No such file or directory`。
4. 当某个子任务检测到删除/暂停并抛出 `TaskDeletedError` 后，`asyncio.gather` 会取消其余子任务；但 `async with httpx.AsyncClient(...) as client` 上下文在 `gather` 返回/异常传播时就关闭 client，被取消的子任务尚未完全退出，继续用已关闭的 client 发请求，于是大量报 `Cannot send a request, as the client has been closed.` 并在重试循环里反复重试。
6. 另一个竞速：worker 外层 session 已经加载了 `DownloadTask` 对象，但在它第一次 `session.commit()` 前，删除 API 在另一个 session 里把 DB 行删掉了。此时外层 session 提交会抛 `StaleDataError: UPDATE statement on table 'download_tasks' expected to update 1 row(s); 0 were matched.`，并被外层 `except Exception` 捕获为 `connection_error`，留下错误状态。

**解决**：
1. 新增 `TaskDeletedError`：任务在下载过程中被删除时，worker 立即退出。
2. 所有需要读取或提交任务状态的地方，改用独立的 `async_session_factory()` 新会话，而不是复用 worker 持有的 session。
3. `_batch_commit`、`_check_paused`、最终结果提交都使用新会话；任务不存在时立即抛 `TaskDeletedError`。
4. `download_one` 在每次重试前、写入 `.ts` 文件前都检查 `ts_dir.exists()`，若目录已被删除则静默返回 `"deleted"`。
5. `download_one` 捕获异常时：若目录已不存在返回 `"deleted"`；若 `client.is_closed` 则主动抛出 `asyncio.CancelledError()`，避免在 client 已关闭的情况下继续重试刷屏。
6. 将 `asyncio.gather(*download_tasks)` 改为显式创建 Task 列表，在异常时先 `cancel()` 所有子任务并 `await` 它们完成，再离开 `async with client` 上下文，避免 client 先关闭导致子任务报 `client has been closed`。
7. 直链下载 worker 同样在每次状态刷新时用新会话读取任务，不存在则退出。
8. 顶层异常处理捕获 `TaskDeletedError` 并记录平静的 `任务已被删除，worker 退出` 日志。
9. 增加内存级停止信号 `_task_stop_events`：
   - `pause()` 和删除 API 先 `request_stop(task_id)` 设置事件，再改 DB / 删文件。
   - worker `_run_download` 启动时注册事件，退出时注销。
   - 直链 worker 每个 chunk 检查 `stop_event.is_set()`，一旦被请求就立即刷新 DB 状态并退出。
   - m3u8 每个 `.ts` 下载协程在每次重试前检查 `stop_event.is_set()`，立即调用 `_check_paused()` 判断暂停或删除，不必等到 1 秒轮询。
10. m3u8 检测到任务被删除时，worker 退出前再用 `shutil.rmtree(ts_dir, ignore_errors=True)` 清理一次临时目录，减少 `.ts_{task_id}` 残留。
11. 新增 `_safe_commit(session, task_id)`：外层 session 提交时捕获 `StaleDataError`，说明任务已被其它会话删除，转换为 `TaskDeletedError` 让 worker 平静退出，而不是报 `connection_error`。

**验证**：
- `backend/scripts/simulate_download.py` 已加入「删除运行中任务」场景：在 worker 已写入部分进度后删除 DB 记录与文件，验证 worker 能在 10 秒内正常退出。
- 脚本最终输出 `✅ 下载功能逻辑模拟全部通过`。

**教训**：
- 运行中的后台 worker 必须能在任何时刻感知任务被删除，否则用户操作与后台状态会错位。
- 不要依赖同一个 `AsyncSession` 读取外部变更；SQLAlchemy 的 identity map 会隐藏最新状态，关键状态检查应使用新会话。
- 删除任务时不仅要清理 DB 记录，还要清理临时目录；worker 端也要检测目录是否存在，避免写入已不存在的路径。
- 并发子任务共享一个 `httpx.AsyncClient` 时，异常退出路径必须先取消并等待所有子任务，再关闭 client，否则会产生大量 `client has been closed` 噪音。
- Windows 下运行中的下载文件可能被 worker 占用，导致删除文件时报 `PermissionError`；API 层应捕获该错误并继续删除 DB。更优的做法是先通知 worker 释放句柄（内存事件），再执行文件删除。
- 对「暂停/删除运行中任务」这类操作，仅靠 DB 轮询有延迟；增加内存级 stop signal 可以把响应延迟降到下一个 chunk/segment，显著降低文件占用和残留概率。

---

## 2026-06-13：点击【确定下载】弹窗仍等待 / 第二次下载任务创建超时失败

**现象**：
1. 用户反馈点击详情页【确定下载】后，弹窗仍要等一段时间才关闭。
2. 第一个下载任务创建成功后，再创建第二个任务时，后端 `/api/play/episodes` 报 500：
   ```
   httpx.ReadTimeout
   app.services.source_client.SourceProtocolError: site=360资源 请求重试后仍失败
   ```

**原因 1（弹窗等待）**：
- 之前虽然把 `setEpisodePickerOpen(false)` 放到 `await getEpisodes(...)` 之前，但整个 `handleConfirmBatchDownload` 仍是 `async` 函数，事件处理器内包含 `await`。
- React 在异步事件处理器中会把状态更新批量处理，某些情况下界面重绘仍会被后续的网络请求阻塞，导致用户感知“弹窗还没关”。

**修复 1**：
`frontend/src/pages/Detail.tsx` 把弹窗关闭和后台任务彻底分离：
- `handleConfirmBatchDownload` 只负责关闭弹窗、清空选择、toast 提示；
- 真正的 `getEpisodes + createDownloadBatch` 放到 `createTasksAsync` 里 fire-and-forget 执行，不再在事件处理器中 `await`。
这样点击确认后弹窗立即消失，网络请求在后台跑。

**原因 2（第二次下载超时）**：
- `backend/app/api/play.py` 的 `get_episodes` 每次都实时向资源站请求 `ac=videolist`。
- 资源站（如 360资源）响应慢或偶发超时，`HTTP_TIMEOUT_DEFAULT=8s` 下容易失败。
- 用户在详情页已经加载过该视频详情（会写入 `VideoCache`），但播放/下载接口没有利用这份缓存。

**修复 2**：
- `get_episodes` 改为**缓存优先**：先查 `VideoCache`（要求 `has_detail=True`、`cached_at` 在 7 天内、有 `play_url_raw`），命中直接返回解析后的集数。
- 缓存未命中时再用 `SourceClient` 实时请求，并把超时从默认 8 秒提高到 `HTTP_TIMEOUT_RESOLVE=15` 秒。
- 实时请求成功后顺手把 `play_url_raw` 写回/更新 `VideoCache`，后续请求直接命中缓存。

**验证**：
- `cd frontend && npm run typecheck` ✅
- `python -m py_compile backend/app/api/play.py` ✅

**教训**：
- 对“点击后需要立即反馈”的 UI 操作，不要把 `await` 留在事件处理器里；先完成界面状态更新，再 fire-and-forget 后续异步工作。
- 播放/下载地址解析应尽量复用 `VideoCache` 详情缓存，避免对同一视频重复请求慢资源站。
- 慢资源站的读取超时要比普通 API 更宽松；缓存命中是最好的超时解决方案。

---

## 2026-06-13：批量暂停仍有任务未暂停 / 第二个视频批量下载任务消失

**现象 1**：
用户在下载管理页点击【批量暂停】（不勾选任何任务，即暂停全部），仍有部分任务状态停留在 `downloading`。截图显示 4 个任务中 2 个未暂停，且 pause API 返回体中 `status` 仍为 `downloading`。

**原因 1（初诊）**：
`backend/app/services/downloader.py` 的下载 worker 会定期批量提交进度，提交逻辑把本地状态 `downloading` 直接写回 DB。
如果用户在提交间隙调用 pause API，DB 状态先变为 `paused`，但随后 worker 的进度提交又把它覆盖回 `downloading`。

**修复 1（初诊）**：
引入 `_commit_progress()` 统一 helper：
- 提交前先读取 DB 最新状态；
- 如果 `force_status` 指定，则按指定值写入；
- 如果 DB 状态是 `downloading`，则只更新字节/分段数，不写状态；
- 如果 DB 状态是 `paused` / `error` / `deleted` 等外部变更，则把本地 `task.status` 同步为 DB 状态，worker 随即停止。
所有原先直接 `commit()` 进度的地方都改用 `_commit_progress()`。

**原因 1（复诊，真正根因）**：
初诊的“先读后写”仍然存在 lost update 窗口：
1. worker 读取到 `downloading`；
2. pause API 写入 `paused` 并提交；
3. worker 再提交，`downloading` 覆盖 `paused`。
因为读和写不是原子操作，只靠“读最新状态”无法避免并发写覆盖。

**修复 1（复诊）**：
把 worker 进度提交改为**条件 UPDATE**：
```sql
UPDATE download_task
SET downloaded_bytes=..., downloaded_segments=..., total_segments=...
WHERE id = ? AND status = 'downloading'
```
- 只有 DB 状态仍是 `downloading` 时才更新进度；
- 若 `rowcount == 0`，说明外部已改为 `paused` / `error`，立即同步本地 `task.status` 并退出；
- `force_status`（完成/出错/强制暂停）仍走无条件更新。
`_commit_progress()` 与 m3u8 内部的 `_batch_commit()` 都改为条件 UPDATE。
同时修复 `backend/app/api/downloads.py` 的 `pause_download` / `resume_download` API：调用 `dl_pause` / `dl_resume` 后执行 `db.refresh(task)`，避免返回 stale task。

**现象 2**：
第一个视频批量下载任务创建成功后，紧接着对第二个视频发起批量下载，第二个视频的任务在 UI 上不显示（或短暂出现后消失）。

**当前排查进展**：
根因尚未确认。已在关键路径上加日志，方便下次复现时定位：
- `frontend/src/pages/Detail.tsx` 的 `createTasksAsync` 记录：开始创建、解析到集数、批量创建结果、异常。
- `backend/app/api/downloads.py` 的 `create_download_batch` 记录：请求进入、创建结果、异常。

**相关修复**：
- 加固了 `_get_batch_lock` 的锁创建过程，避免并发创建 `asyncio.Lock` 时出现竞态。

**验证**：
- `cd frontend && npm run typecheck` ✅
- `python -m py_compile backend/app/services/downloader.py backend/app/api/downloads.py` ✅
- `python scripts/simulate_download.py` ✅

**教训**：
- worker 写 DB 时不能假设本地状态始终优先；必须先读最新状态，尊重外部操作。
- 对“状态竞争”类 bug，先加可观测日志再猜测根因，能避免无效修改。
- 批量创建的并发锁必须用独立的创建锁保护，否则 `asyncio.Lock` 本身的初始化也会竞态。

