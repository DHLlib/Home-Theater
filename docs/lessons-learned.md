# 错题本 — Home Theater 项目踩坑记录

> 遇到异常时，优先从本文档中搜索相似症状，再尝试新方案。

---

## 1. 端口冲突：WinError 10013

**症状**：`uvicorn app.main:app --host 0.0.0.0 --port 8000` 报错 `WinError 10013: 以一种访问权限不允许的方式做了一个访问套接字的尝试`。

**原因**：Windows 上其他进程已占用 8000 端口。

**解决**：更换端口。本项目最终统一使用 **8181**（前端 `vite.config.ts` 代理目标同步改为 `http://localhost:8181`）。

```bash
# 查找占用端口的进程
netstat -ano | grep 8000
# 强制终止
taskkill //PID <PID> //F
# 启动时使用新端口
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload
```

---

## 2. fetch-categories 返回 404

**症状**：`GET /api/sites/{id}/fetch-categories` 返回 `404 Not Found`。

**原因**：接口定义为 `POST`，但测试时误用 `GET`。

**解决**：使用 `POST`：
```bash
curl -X POST "http://localhost:8181/api/sites/3/fetch-categories"
```

---

## 3. 分类查询返回 0 条结果（父分类陷阱）

**症状**：`t=1`（电影片）查询返回 `total: 0`，但 `ac=list` 不带 `t` 能返回数万条。

**原因**：AppleCMS `class` 数组包含**父分类**（`type_pid=0`：电影片、连续剧、综艺片、动漫片）和**子分类**（`type_pid>0`：动作片、科幻片等）。`t` 参数**只能查询子分类**，父分类 ID 作为 `t` 永远返回空。

**验证**：
```bash
# 父分类 → 0 条
curl "https://cj.ffzyapi.com/api.php/provide/vod/?ac=list&t=1"
# 子分类 → 有数据
curl "https://cj.ffzyapi.com/api.php/provide/vod/?ac=list&t=6"  # 动作片
```

**解决**：`fetch_remote_categories` 中过滤 `type_pid=0`：
```python
type_pid = raw.get("type_pid")
if type_pid == 0 or type_pid == "0":
    continue
```

**教训**：站点返回的分类列表 ≠ 可直接查询的分类。必须用 `type_pid` 区分父子。

---

## 4. 360zy 分类参数：中文名 vs 数字 ID

**症状**：360zy `t=1` 返回 0 条，但 `t=电影`（URL 编码后）返回 20 条。

**原因**：360zy 的**父分类**支持中文名查询（`t=电影`），但**子分类**必须用数字 ID（`t=6`）。

**验证**：
```bash
# 父分类中文名 → 有效（但只返回少量数据）
curl "https://360zy.com/api.php/provide/vod/?ac=list&t=电影"
# 子分类数字 ID → 有效（返回完整列表）
curl "https://360zy.com/api.php/provide/vod/?ac=list&t=6"
```

**解决**：统一使用子分类的数字 ID 查询，不依赖中文名。`fetch-categories` 过滤父分类后，前端只映射子分类。

---

## 5. ffzy 分类参数行为误解

**症状**：误以为 ffzy 不支持 `t` 参数，因为 `t=1`、`t=电影`、`t=电影片` 都返回 0。

**原因**：
1. 测试时混用了不同域名（`cj.ffzyapi.com` vs `api.ffzyapi.com`）
2. 用了父分类 ID（`t=1`）而不是子分类 ID（`t=6`）

**验证**：
```bash
curl "https://cj.ffzyapi.com/api.php/provide/vod/?ac=list&t=6"  # 动作片 → 4468 条
```

**解决**：确认 ffzy 完全支持 `t` 参数，但必须是**子分类的数字 ID**。

---

## 6. 后端代码修改后 API 行为未变

**症状**：修改了 `backend/app/api/sites.py` 的 `fetch_remote_categories` 逻辑，但 API 仍返回旧数据（包含父分类）。

**原因**：旧 Python/uvicorn 进程仍在运行，没有加载新代码。Windows 上 `taskkill` 可能未彻底终止，或进程被自动重启。

**解决**：
```bash
# 1. 强制终止所有 Python 进程
taskkill //F //IM python.exe

# 2. 清理 Python 字节码缓存
rm -rf backend/app/api/__pycache__

# 3. 重新启动
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload
```

**教训**：修改后端代码后如果行为未变，**先怀疑进程是否真正重启**，不要反复检查代码逻辑。

---

## 7. 前端分类筛选用错 API 参数

**症状**：`GET /api/videos?t=动作片` 返回 20 条不相关的视频（如战争片）。

**原因**：`t` 参数是**透传给资源站的原始参数**，系统分类查询应该用 `category` 参数。

**解决**：
```bash
# 错误：t 直接透传，360zy 把"动作片"当成原始参数处理
curl "http://localhost:8181/api/videos?t=动作片"

# 正确：category 走系统分类映射逻辑
curl "http://localhost:8181/api/videos?category=动作片"
```

**教训**：前端分类筛选必须使用 `category=`，不是 `t=`。

---

## 8. curl 发送复杂 JSON 解析失败

**症状**：`curl -X PUT -d '{"categories": [...]}'` 返回 `There was an error parsing the body`。

**原因**：命令行直接传复杂 JSON，shell 对引号、特殊字符的转义容易出错。

**解决**：将 JSON 写入文件，用 `--data-binary @file`：
```bash
cat > /tmp/body.json << 'EOF'
{"categories":[{"remote_id":"6","name":"动作片"}]}
EOF
curl -X PUT -H "Content-Type: application/json" --data-binary @/tmp/body.json \
  "http://localhost:8181/api/sites/3/categories"
```

---

## 9. git init 位置错误

**症状**：在项目根目录执行 `git status` 显示 `not a git repository`，但 `frontend/.git` 存在。

**原因**：`git init` 误在前端子目录执行。

**解决**：
```bash
# 删除错误位置的仓库
rm -rf frontend/.git
# 在项目根目录重新初始化
cd "D:\workspace_py\Home Theater"
git init
```

---

## 10. CategoryBar 展开按钮跑到第二行

**症状**：分类折叠时，"⬇️ 展开更多" 按钮显示在第二行（被截断区域外）。

**原因**：展开按钮作为独立 DOM 元素放在 flex 容器下方，自然另起一行。

**解决**：按钮改为 `position: absolute` 定位到容器右上角，容器右侧预留 `paddingRight` 避免分类按钮被遮挡。

---

## 11. 数据库列缺失导致后端启动崩溃

**症状**：`scheduler.py` 报错 `sqlite3.OperationalError: no such column: sites.auto_disabled_at`。

**原因**：`models.py` 新增了 `auto_disabled_at` 列，但现有 SQLite 数据库文件没有该列。`_ensure_columns` 虽然会尝试补列，但某些场景下（如并发启动或字段类型不匹配）可能补列失败。

**解决**：
```bash
# 1. 停止后端进程
# 2. 删除旧数据库（数据会丢失，仅开发阶段适用）
rm backend/data/app.db
# 3. 重新启动后端，Base.metadata.create_all 会重建所有表
```

**教训**：开发阶段新增模型字段后，如果 `_ensure_columns` 未覆盖或补列失败，最直接的方式是删库重建。

---

## 12. SourceClient 改为 async context manager 后的语法陷阱

**症状**：修改 `source_client.py` 后，后端启动报错 `SyntaxError` 或运行时 `AttributeError: 'SourceClient' object has no attribute 'aclose'`。

**原因**：
1. `_get` 方法内部仍保留旧的 `async with httpx.AsyncClient(...) as client:` 块，与实例级 `_client` 冲突
2. 忘记实现 `__aenter__` / `__aexit__` / `aclose()`

**正确写法**：
```python
class SourceClient:
    def __init__(self, ...):
        self._client = httpx.AsyncClient(...)

    async def aclose(self):
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.aclose()

    async def _get(self, params):
        # 直接使用实例级 client，不要再 async with
        resp = await self._client.get(self.base_url, params=params)
        ...
```

**教训**：把 `httpx.AsyncClient` 从函数级移到实例级时，必须同时：
- 删除函数内部的 `async with httpx.AsyncClient(...)`
- 添加 `aclose` + `__aenter__` / `__aexit__`
- 所有调用处改为 `async with SourceClient(...) as client:`

---

## 13. health.py try/except 作用域外移

**症状**：修改 `health.py` 后，执行 probe 时报 `SyntaxError: 'try' block expected` 或运行时异常无法被捕获。

**原因**：使用 `Edit` 工具时，`try` 块被截断，`except` 跑到了 `async with` 外面。

**正确结构**：
```python
async with SourceClient(...) as client:
    try:
        data = await client._get({"ac": "list", "pg": 1})
        # ...
    except httpx.TimeoutException:
        return ProbeResult(ok=False, error="timeout")
    except Exception as exc:
        return ProbeResult(ok=False, error=str(exc))
```

**教训**：使用 Edit 工具修改嵌套结构时，务必读取修改后的完整文件，确认 `try/except` 的缩进和配对正确。

---

## 14. videos.py fetch_one try 块未闭合

**症状**：修改 `videos.py` 后，后端启动报 `SyntaxError`：`try` 块没有匹配的 `except`/`finally`。

**原因**：`Edit` 替换时，新字符串中的 `try` 块被意外截断或重复，导致 Python 语法错误。

**解决**：对复杂嵌套函数（如 `fetch_one` 闭包），宁可重写整个函数，也不要做局部字符串替换。

---

## 15. 多进程残留进程无法通过常规工具终止

**症状**：`netstat` 显示端口被占用，但 `taskkill`、`wmic`、`Stop-Process`、`os.kill` 都返回"找不到进程"或"拒绝访问"。

**原因**：uvicorn 以多进程模式（`--workers` 或 `multiprocessing`）启动时，父进程 PID 在某些 Windows 工具中不可见，子进程（`spawn_main` fork）才是真正的监听进程。

**解决**：终止子进程而非父进程：
```bash
# 1. 找到所有 Python 子进程
wmic process where "name='python.exe'" get ProcessId,CommandLine

# 2. 找到包含 "multiprocessing.spawn" 的子进程 PID
# 3. 用 taskkill 终止子进程
taskkill /F /PID <子进程PID>
```

**教训**：Windows 上 uvicorn 多进程的子进程才是真正的服务进程，kill 子进程才能释放端口。

---

## 16. VideoCard poster 加载策略反复

**症状**：先移除 `getDetail` 调用（期望列表 API 自带 poster_url），结果首页所有封面图消失；恢复后通过优化方案解决。

**原因**：
1. 列表 API 返回的 `poster_url` 大部分为空
2. 详情 API 才有完整的 `poster_url`
3. 完全依赖列表 API 的 poster 会导致大面积空白

**最终方案**：
- 保留 `IntersectionObserver` + `getDetail` 按需加载
- `rootMargin: "200px"` 提前预加载
- 失败时重试 1 次（2 秒后）
- `img onError` 兜底回退到占位图

**教训**：不要假设列表 API 和详情 API 的字段完整度相同。先分析数据分布，再决定加载策略。

---

## 快速检索表

| 关键词 | 对应问题 |
|--------|---------|
| 端口、8000、10013 | #1 端口冲突 |
| 404、fetch-categories | #2 404 + #3 父分类 |
| 分类、0 条、total:0 | #3 父分类陷阱 |
| 中文、电影、t= | #4 360zy 中文名 |
| 代码改了没效果 | #6 进程未重启 |
| 动作片、返回不对 | #7 用错参数 |
| curl、JSON、解析 | #8 curl JSON |
| git、not a repo | #9 git init 位置 |
| 展开、第二行 | #10 按钮位置 |
| auto_disabled_at、no such column | #11 数据库列缺失 |
| SourceClient、SyntaxError、aclose | #12 async context manager 语法陷阱 |
| try/except、SyntaxError | #13 + #14 作用域/闭合错误 |
| netstat、找不到进程、拒绝访问 | #15 多进程残留 |
| 封面、poster、空白 | #16 VideoCard poster 策略 |
| feifan、不支持播放、格式 | #17 feifan 后缀解析差异 |
| 下载、卡顿、DB 事务 | #18 下载批量 commit |

---

## 17. feifan 后缀：详情页播放 vs 直接刷新播放器行为不一致

**症状**：从详情页点击播放提示"暂不支持播放该格式 (feifan)"，但直接刷新播放器页面或从播放器内部切换却能正常播放。

**原因**：`video_detail` 接口（`POST /api/videos/detail`，详情页调用）返回的 episodes 中，`feifan` 后缀**没有被解析**成真实 m3u8 地址。而 `get_episodes` 接口（`GET /api/play/episodes`，播放器直接调用）会正确把 `feifan` 解析为 `ffm3u8`。

播放器优先使用详情页传递过来的 `episodes`（避免重复请求），所以当详情页传了原始 `feifan` suffix 时，ckplayer 不认识这个格式。

**解决**：在 `video_detail` 返回前加入与 `play.py` 相同的后缀处理逻辑：
- `feifan` → 访问分享页解析真实 m3u8 地址，suffix 改为 `ffm3u8`
- `360zy` → suffix 统一改为 `ffm3u8`

```python
# 统一处理入口
for data in sources:
    if data.get("episodes"):
        data["episodes"] = await _normalize_episode_suffixes(data["episodes"])
```

**教训**：如果多个接口返回相同业务数据，务必确保它们的后处理逻辑一致。差异会导致"有时候能用有时候不能"的诡异现象。

---

## 18. 下载任务卡顿：数据库事务过于频繁

**症状**：下载大文件时，进度更新明显卡顿，CPU 占用不高但 IO 等待时间长。

**原因**：下载器每个 chunk（64KB）都 `await session.commit()` 一次。一个 1GB 文件会产生约 1.6 万次数据库事务，SQLite 成为瓶颈。

**解决**：改为批量 commit：
- 直接下载：每 5 秒或每 100 个 chunk commit 一次
- m3u8 .ts 下载：每 5 秒或每 10 个片段 commit 一次
- 暂停状态检查从每个 chunk 改为每 3 秒

```python
last_commit = time.monotonic()
chunk_counter = 0
async for chunk in resp.aiter_bytes(CHUNK_SIZE):
    # ...
    chunk_counter += 1
    if now - last_commit >= 5 or chunk_counter >= 100:
        await session.commit()
        last_commit = now
        chunk_counter = 0
```

**教训**：高频 IO 循环中不要把数据库事务放在热路径上。批量提交能显著提升吞吐量。

---

## 19. SSE 替代轮询：前后端实时通讯优化

**症状**：下载页面每 2 秒轮询 `listDownloads()`，产生大量不必要的 HTTP 请求；大文件下载时进度更新有延迟感。

**原因**：前端使用 `setInterval(() => listDownloads(), 2000)` 轮询，后端即使无变化也返回完整任务列表。并发下载多个文件时请求量倍增。

**解决**：引入 SSE（Server-Sent Events）替代轮询：
- 后端 `event_bus.py`：基于 `asyncio.Queue` 的内存发布-订阅，支持多客户端
- 后端 `sse.py`：`GET /api/sse` 返回 `text/event-stream`，30 秒心跳保活
- 下载器/调度器/下载 API 在状态变化时 `publish(Event(...))`
- 前端 `sse.ts`：单例 `EventSource`，自动重连，按事件类型订阅
- `Downloads.tsx`：首次加载调 API，后续由 SSE 事件驱动增量更新

```python
# 后端：下载进度变化时推送
publish(Event("download_progress", {
    "task_id": task_id,
    "downloaded_bytes": task.downloaded_bytes,
    "total_bytes": task.total_bytes,
    "downloaded_segments": task.downloaded_segments,
    "total_segments": task.total_segments,
    "status": task.status,
}))
```

```typescript
// 前端：监听事件增量更新
onSseEvent("download_progress", (ev) => {
  setTasks((prev) =>
    prev.map((t) =>
      t.id === ev.task_id
        ? { ...t, downloaded_bytes: ev.downloaded_bytes, /* ... */ }
        : t
    )
  );
});
```

**教训**：
1. SSE 是 HTTP 上的单向推送，比 WebSocket 轻量，适合"服务端主动通知客户端"场景
2. 内存中的 Queue 在单进程模式下足够；多实例部署时需替换为 Redis Pub/Sub
3. 心跳间隔不要太短（30 秒即可），避免不必要的网络流量
4. 前端首次加载仍需 REST API 获取完整状态，SSE 只负责后续增量更新

---

## 20. 首页每次刷新数据变化（排序抖动）

**症状**：首页每次刷新，视频列表顺序完全不同，不是同一批视频。

**原因**：首页查询 `ORDER BY cached_at DESC`，而 `cached_at` 在多种场景下被频繁刷新为当前时间：
1. **增量更新**：所有扫描到的记录（包括未变化的）都被 upsert，`cached_at` 刷为当前时间
2. **查看详情**：`video_detail` 回源后写入缓存，`cached_at` 刷为当前时间
3. **detail upsert 覆盖**：crawler 的 videolist 补全阶段覆盖 `cached_at`

这导致"最近被缓存"的视频浮到顶部，而非"最近被资源站更新"的视频。

**排查过程**：
1. 先验证后端查询本身是否稳定 → 多次运行结果一致 ✓
2. 检查数据库写入 → 发现 `check_updates` 触发增量更新，site 1 写入约 900 条新记录
3. 检查 `source_updated_at` 分布 → 1920 条为 NULL（被 detail upsert 覆盖导致）

**解决**：
1. 首页排序从 `cached_at DESC` 改为 `source_updated_at DESC`（资源站实际更新时间）
2. 增量更新时跳过 `source_updated_at` 未变化的记录，避免不必要更新 `cached_at`
3. `video_detail` 和 `_batch_upsert_detail_fields` 中，不将 `source_updated_at` 覆盖为 None

**教训**：
- 缓存表的 `cached_at` 只应代表"何时写入缓存"，不应作为业务排序依据
- 批量 upsert 时，未变化记录应跳过，避免产生大量无意义的写入
- detail 阶段补充的字段不应覆盖 list 阶段已正确写入的元数据

---

## 21. SQLAlchemy `scalars()` 在 SELECT 多列时只返回第一列

**症状**：`crawler_stats` API 返回 500 错误，`site_map = {s.id: s.name for s in sites_result.scalars().all()}` 报 `AttributeError: 'int' object has no attribute 'id'`。

**原因**：`select(Site.id, Site.name)` 配合 `.scalars().all()` 时，SQLAlchemy 的 `scalars()` 只返回结果集的第一列（即 `id` 整数），而非行对象。

**解决**：多列查询使用 `.all()` 获取完整行元组：
```python
site_map = {sid: name for sid, name in sites_result.all()}
```

**教训**：`scalars()` 只对单列 `SELECT` 或 ORM 实体查询有意义；多列查询必须用 `.all()` 然后解包元组。

---

## 22. VideoCache 5000 行上限导致分类覆盖不全

**症状**：资源站有几万个视频，但某些分类（如纪录片、短片）只显示寥寥几条，甚至为空。

**原因**：全局 5000 条 LRU 淘汰策略下，热门分类（国产剧、综艺等）更新频繁，不断刷新 `cached_at`，挤占了冷门分类的配额。全量刮削遍历了所有分类，但最终只保留"最新的 5000 条"，导致冷门分类数据被提前淘汰。

**解决**：取消 5000 行上限。`_evict_if_overflow` 和 `_evict_video_cache_overflow` 改为空操作。

**教训**：
- 缓存上限必须结合**实际使用场景**来设定，不能拍脑袋定一个数字
- 本机/局域网部署，SQLite 处理几十万条记录性能完全可接受，不应人为限制数据量
- 如果必须设上限，应按"分类"或"站点"分别限制，而不是全局一刀切
- 用户体验（数据完整）比磁盘空间节省更重要

---

## 快速检索表

| 关键词 | 对应问题 |
|--------|---------|
| 端口、8000、10013 | #1 端口冲突 |
| 404、fetch-categories | #2 404 + #3 父分类 |
| 分类、0 条、total:0 | #3 父分类陷阱 |
| 中文、电影、t= | #4 360zy 中文名 |
| 代码改了没效果 | #6 进程未重启 |
| 动作片、返回不对 | #7 用错参数 |
| curl、JSON、解析 | #8 curl JSON |
| git、not a repo | #9 git init 位置 |
| 展开、第二行 | #10 按钮位置 |
| auto_disabled_at、no such column | #11 数据库列缺失 |
| SourceClient、SyntaxError、aclose | #12 async context manager 语法陷阱 |
| try/except、SyntaxError | #13 + #14 作用域/闭合错误 |
| netstat、找不到进程、拒绝访问 | #15 多进程残留 |
| 封面、poster、空白 | #16 VideoCard poster 策略 |
| feifan、不支持播放、格式 | #17 feifan 后缀解析差异 |
| 下载、卡顿、DB 事务 | #18 下载批量 commit |
| SSE、轮询、实时 | #19 SSE 替代轮询 |
| 首页刷新、数据变化、排序 | #20 首页排序抖动 |
| scalars、多列、AttributeError | #21 SQLAlchemy scalars 陷阱 |
| 5000、上限、分类不全 | #22 VideoCache 上限导致分类覆盖不全 |
| 全屏、横屏、夸克 | #23 夸克浏览器不支持 screen.orientation.lock |
| 模糊、画质、HLS | #24 HLS ABR 自动降码率 |

---

## 23. 夸克浏览器全屏后不会自动横屏

**症状**：在夸克浏览器中播放视频并点击全屏按钮，画面仍保持竖屏，两侧留有巨大黑边。

**原因**：夸克浏览器（以及微信内置浏览器等部分国产 Android 浏览器）**不支持** `screen.orientation.lock()` API。标准全屏 API 只能把元素铺满屏幕，但无法改变设备的物理方向。

**解决**：使用 CSS 伪横屏作为降级方案：

1. `useFullscreen.ts` 中检测 `supportsOrientationLock()`，不支持时设置 `isFakeLandscape = true`
2. `Player.tsx` 从 `useFullscreen` 解构 `isFakeLandscape`，条件添加 `fake-landscape` 类
3. `global.css` 中定义 `.fake-landscape`：

```css
.fake-landscape {
  position: fixed !important;
  top: 0 !important;
  left: 100vw !important;
  width: 100vh !important;
  height: 100vw !important;
  transform: rotate(90deg) !important;
  transform-origin: top left !important;
  z-index: 9999 !important;
}
```

原理：元素初始位置放在屏幕右上角外侧 (`left: 100vw`)，宽高交换后绕左上角旋转 90°，正好填满整个屏幕。

**教训**：
- 国产浏览器（夸克、微信、UC 等）对 Web API 的支持度参差不齐，全屏/方向/触摸事件都可能与 Chrome 不同
- 必须准备降级方案，不能依赖单一 API
- iOS Safari 的 `video.webkitEnterFullscreen()` 系统级全屏会自动横屏，不需要伪横屏

---

## 快速检索表

| 关键词 | 对应问题 |
|--------|---------|
| 端口、8000、10013 | #1 端口冲突 |
| 404、fetch-categories | #2 404 + #3 父分类 |
| 分类、0 条、total:0 | #3 父分类陷阱 |
| 中文、电影、t= | #4 360zy 中文名 |
| 代码改了没效果 | #6 进程未重启 |
| 动作片、返回不对 | #7 用错参数 |
| curl、JSON、解析 | #8 curl JSON |
| git、not a repo | #9 git init 位置 |
| 展开、第二行 | #10 按钮位置 |
| auto_disabled_at、no such column | #11 数据库列缺失 |
| SourceClient、SyntaxError、aclose | #12 async context manager 语法陷阱 |
| try/except、SyntaxError | #13 + #14 作用域/闭合错误 |
| netstat、找不到进程、拒绝访问 | #15 多进程残留 |
| 封面、poster、空白 | #16 VideoCard poster 策略 |
| feifan、不支持播放、格式 | #17 feifan 后缀解析差异 |
| 下载、卡顿、DB 事务 | #18 下载批量 commit |
| SSE、轮询、实时 | #19 SSE 替代轮询 |
| 首页刷新、数据变化、排序 | #20 首页排序抖动 |
| scalars、多列、AttributeError | #21 SQLAlchemy scalars 陷阱 |
| 5000、上限、分类不全 | #22 VideoCache 上限导致分类覆盖不全 |
| 全屏、横屏、夸克 | #23 夸克浏览器不支持 screen.orientation.lock |
| 模糊、画质、HLS | #24 HLS ABR 自动降码率 |

---

## 24. HLS ABR 自动降码率导致播放中画面变模糊

**症状**：播放过程中（尤其是画面复杂、运动剧烈时），视频会突然变模糊，过一会儿又恢复清晰，反复切换。

**原因**：hls.js 默认启用 ABR（Adaptive Bitrate，自适应码率）。当网络波动或 buffer 不足时，ABR 算法会自动切换到低码率流（level 0），导致画质骤降。画面复杂时码率需求更高，更容易触发降级。

**解决**：播放器初始化后获取 hls.js 实例，强制锁定最高级别：

```typescript
const lockMax = () => {
  try {
    const hlsPlugin = player.getPlugin?.("hlsJs") || player.plugins?.hlsJs;
    const hls = hlsPlugin?.hls || hlsPlugin?.core;
    if (hls && Array.isArray(hls.levels) && hls.levels.length > 1) {
      hls.currentLevel = hls.levels.length - 1; // 锁定最高码率
      return true;
    }
  } catch { /* 单码率流忽略 */ }
  return false;
};

// ready 时尝试，失败则轮询最多 5 秒
if (!lockMax()) {
  let attempts = 0;
  const timer = setInterval(() => {
    if (lockMax() || ++attempts > 50) clearInterval(timer);
  }, 100);
}
```

**教训**：
- hls.js 的 `startLevel: -1` 不是"最高级别"，而是"自动选择"
- `capLevelToPlayerSize: false` 只能防止窗口尺寸限制，不能阻止带宽自适应
- 要彻底避免降码率，必须在 manifest 解析后显式设置 `currentLevel`
- 单码率流（levels.length === 1）不存在此问题，安全忽略

---

## 25. SQLite `database is locked` — 刮削期间前端请求报错

**症状**：首次启动全量刮削时，前端请求 `/api/sites`、`/api/play/progress` 等接口报 500，`OperationalError: database is locked`。

**原因**：
1. SQLite 默认 journal 模式为 DELETE，写入时独占整个数据库文件
2. 6 个站点并发刮削 + 每 100 条 commit 一次，写入队列堆积
3. 前端请求的读写操作与刮削任务争抢锁，没有 busy_timeout 时立即报错

**解决**：三层防线
1. **WAL 模式**：`PRAGMA journal_mode=WAL`，读写并发，写入不阻塞读取
2. **busy_timeout**：`PRAGMA busy_timeout=30000` + `connect_args={"timeout": 30.0}`，锁等待 30 秒
3. **降低刮削争用**：
   - 全量刮削站点并发 6 → 2
   - 批量写入 100 条 → 500 条，减少 commit 频率
   - commit 后 `await asyncio.sleep(0)` 主动让出事件循环
   - 预聚合缓存刷新拆分为"只读聚合 + 短写事务"两阶段

```python
# db.py 引擎配置
engine = create_async_engine(
    settings.db_url,
    echo=False,
    connect_args={"timeout": 30.0},
    pool_pre_ping=True,
)

# init_db 中启用 WAL
await conn.execute(text("PRAGMA journal_mode=WAL"))
await conn.execute(text("PRAGMA busy_timeout=30000"))
```

**教训**：
- SQLite 不是 PostgreSQL，并发写入能力有限，不能照搬多站点并发设计
- WAL 模式是 SQLite 并发的基础，但写入仍串行，高频 commit 会产生排队
- `asyncio.sleep(0)` 在 async/await 程序中是让出事件循环的有效手段
- 长事务必须拆分为"计算在内存 + 写入最小化"

---

## 26. 首页导航冻结 — IndexedDB 阻塞 UI 状态更新

**症状**：首次启动后，从详情页点击【首页】返回，页面卡死在骨架屏，无网络请求发出，浏览器标签页无响应。

**原因**：`Home.tsx` `loadPage` 中 `setCachedAggregated` 放在 `try` 块内：
1. 如果 IndexedDB 被锁（如另一个标签页正在清理过期缓存），`getCachedAggregated` 卡住
2. 即使请求成功，`setCachedAggregated` 卡住会阻止 `finally` → `setLoading(false)` 执行
3. 用户看到无限骨架屏，且无法交互

**解决**：
1. `cache.ts`：所有 IndexedDB 操作加 `withTimeout(..., 3000)`，3 秒超时后静默失败
2. `Home.tsx`：`setCachedAggregated` 移出 `try` 块，改为 fire-and-forget
3. `client.ts`：`listVideos`/`searchVideos` 添加 15 秒 `AbortController` 超时

```typescript
// cache.ts：超时包装
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("IndexedDB timeout")), ms)
    ),
  ]);
}

// Home.tsx：fire-and-forget
if (cacheResult) {
  setCachedAggregated(cacheParams, { items: cacheResult.items }).catch(() => {});
}
```

**教训**：
- IndexedDB 是异步但非确定性的，可能被其他标签页/进程阻塞
- 缓存写入是锦上添花，绝不能阻塞核心 UI 状态更新
- `try/finally` 中不要放非关键路径的异步操作

---

## 27. 新站点播放提示"暂不支持播放该格式"

**症状**：添加新站点后，点击播放提示 `暂不支持播放该格式 (dytt)` / `(155m3u8)` / `(xlyun)` 等。

**原因**：
1. 后端 `play.py` 只对 `feifan` 做了解析，新站点的 `dytt`、`155m3u8`、`xlyun` 等后缀未处理
2. 前端 `VideoPlayer.tsx` 的 M3U8 检测只匹配固定后缀（`m3u8`、`ffm3u8`、`ckplayer`）

**解决**：
1. 后端 `play.py` 后缀归一化：所有 `*m3u8`、`*yun`、`360zy`、`dytt` → `ffm3u8`
2. 前端 VideoPlayer 放宽检测：`suffix.endsWith("m3u8") || suffix.endsWith("yun")`

```python
# play.py
for i, e in enumerate(episodes):
    suffix_lower = e.suffix.lower()
    if suffix_lower.endswith("m3u8") or suffix_lower.endswith("yun"):
        episodes[i] = replace(e, suffix="ffm3u8")
    elif suffix_lower == "360zy":
        episodes[i] = replace(e, suffix="ffm3u8")
```

```typescript
// VideoPlayer.tsx
const isM3u8 =
  suffixLower.endsWith("m3u8") ||
  suffixLower.endsWith("yun") ||
  urlLower.endsWith(".m3u8") ||
  urlLower.includes(".m3u8?");
```

**教训**：
- 站点后缀命名没有统一规范，不能假设只有已知后缀存在
- 用 `.endsWith()` 匹配模式比白名单枚举更鲁棒
- 后端和前端的格式检测逻辑必须保持一致，否则会出现"后端返回了但前端不认识"的情况

---

## 28. ffmpeg 是可选依赖

**说明**：
m3u8 下载完成后，后端会尝试把 `.ts` 片段合并为 MP4。优先使用 `ffmpeg -f concat -safe 0 -i concat.txt -c copy output.mp4`，如果 ffmpeg 未安装、不在 PATH 中或执行失败，则自动降级为**按顺序直接拼接 `.ts` 文件字节**。

**影响**：
- 有 ffmpeg：合并更稳，能处理多数标准/非标准 MPEG-TS 流
- 无 ffmpeg：仅对编码参数完全一致的 TS 片段有效；若片段间编码不同，拼出的 MP4 可能无法播放

**结论**：
ffmpeg 是**可选依赖**，不安装也能跑，但建议安装以获得最佳 m3u8 下载体验。

---

## 快速检索表

| 关键词 | 对应问题 |
|--------|---------|
| 端口、8000、10013 | #1 端口冲突 |
| 404、fetch-categories | #2 404 + #3 父分类 |
| 分类、0 条、total:0 | #3 父分类陷阱 |
| 中文、电影、t= | #4 360zy 中文名 |
| 代码改了没效果 | #6 进程未重启 |
| 动作片、返回不对 | #7 用错参数 |
| curl、JSON、解析 | #8 curl JSON |
| git、not a repo | #9 git init 位置 |
| 展开、第二行 | #10 按钮位置 |
| auto_disabled_at、no such column | #11 数据库列缺失 |
| SourceClient、SyntaxError、aclose | #12 async context manager 语法陷阱 |
| try/except、SyntaxError | #13 + #14 作用域/闭合错误 |
| netstat、找不到进程、拒绝访问 | #15 多进程残留 |
| 封面、poster、空白 | #16 VideoCard poster 策略 |
| feifan、不支持播放、格式 | #17 feifan 后缀解析差异 |
| 下载、卡顿、DB 事务 | #18 下载批量 commit |
| SSE、轮询、实时 | #19 SSE 替代轮询 |
| 首页刷新、数据变化、排序 | #20 首页排序抖动 |
| scalars、多列、AttributeError | #21 SQLAlchemy scalars 陷阱 |
| 5000、上限、分类不全 | #22 VideoCache 上限导致分类覆盖不全 |
| 全屏、横屏、夸克 | #23 夸克浏览器不支持 screen.orientation.lock |
| 模糊、画质、HLS | #24 HLS ABR 自动降码率 |
| database is locked、sqlite | #25 SQLite 并发锁 |
| 首页、无响应、骨架屏 | #26 导航冻结（IndexedDB） |
| 不支持播放、格式、dytt | #27 新站点播放格式兼容 |
| ffmpeg、m3u8、合并 | #28 ffmpeg 是可选依赖 |
