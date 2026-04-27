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
