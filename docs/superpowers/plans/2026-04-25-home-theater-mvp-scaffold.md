# Home Theater MVP Scaffold Implementation Plan

> **更新注记（2026-04-26）**：本计划已执行完毕。后续变更未反向同步到本文档：
> - 开发/联调端口由 `8000` 改为 `8181`（与 `frontend/vite.config.ts` 代理对齐）
> - 新增「分类映射」功能（互斥约束、occupancy map、扁平系统分类），详见 `CLAUDE.md`
> - 仓库已初始化 Git（计划原文假设"仓库非 git"）
> - 当前事实文档：`CLAUDE.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `2026-04-25-home-theater-mvp-design.md` 落地 `backend/` + `frontend/` MVP 骨架，让两边都能 dev 跑起来；硬契约（资源站参数构造 / 播放地址解析 / 聚合去重 / 显式选源 / 下载根目录守门）真实可调。

**Architecture:** FastAPI(async) + httpx + SQLAlchemy(aiosqlite) 单进程后端，对外只暴露 `/api/*` 与 SPA 静态托管；React+Vite+TS SPA 通过 fetch 封装直连后端，开发期 Vite 反代 `/api` 到 8000，构建期产物由 FastAPI 静态托管。所有外部资源站请求集中在 `services/source_client.py`，所有播放/下载地址解析集中在 `services/parser.py`。

**Tech Stack:** Python 3.11+ / FastAPI / httpx / SQLAlchemy 2.x async + aiosqlite / pydantic-settings / uvicorn ｜ Node 18+ / React 18 / Vite 5 / TypeScript / react-router v6 / 原生 CSS+CSS Modules / ckplayer (placeholder)。

**用户级裁剪（覆盖 writing-plans skill 默认值）：**
- 仓库非 git，不写 `git add` / `git commit` 步骤
- spec 明确「不写自动化测试」，不写 TDD 三件套（write failing test → run-fail → run-pass）
- 每个任务保留两段式：**Write file（含完整代码）→ Smoke verify（人工或单条命令）**

**关键契约文件（完整代码必须落地，禁止 TODO 占位）：**
- `backend/app/services/source_client.py`
- `backend/app/services/parser.py`
- `backend/app/services/aggregator.py`
- `backend/app/services/health.py`
- `frontend/src/components/SourcePicker.tsx`

**显式 TODO 留空区（spec 同意延后）：**
- ckplayer 真实接入（`Player.tsx` 仅渲染原生 `<video>` + 占位脚本钩子）
- 下载断点续传循环（`downloader.py` 仅状态机骨架）
- 下载任务真实启动/暂停/继续（`api/downloads.py` 仅 CRUD + 状态切换）

---

## Phase 1 — 后端骨架基础

### Task 1.1: 写入 `backend/pyproject.toml`

**Files:**
- Create: `backend/pyproject.toml`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。

- [ ] **Step 2: Verify**

```bash
cd backend && python -m pip install -e . 2>&1 | tail -n 5
```

Expected: `Successfully installed home-theater-...`，无依赖冲突报错。

### Task 1.2: 写入 `backend/.env.example` 与 `backend/data/.gitkeep`

**Files:**
- Create: `backend/.env.example`
- Create: `backend/data/.gitkeep`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。

- [ ] **Step 2: Verify**

```bash
ls backend/data backend/.env.example
```

Expected: 两个文件均存在。

### Task 1.3: 写入 `backend/app/__init__.py` 与 `backend/app/config.py`

**Files:**
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。

- [ ] **Step 2: Verify**

```bash
cd backend && python -c "from app.config import settings; print(settings.host, settings.port, settings.db_path)"
```

Expected: 打印 `0.0.0.0 8000 backend/data/app.db`（或来自 `.env` 的覆盖值）。

### Task 1.4: 写入 `backend/app/db.py`

**Files:**
- Create: `backend/app/db.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。

- [ ] **Step 2: Verify**

```bash
cd backend && python -c "import asyncio; from app.db import init_db; asyncio.run(init_db())"
```

Expected: `backend/data/app.db` 文件被创建，无报错。

### Task 1.5: 写入 `backend/app/models.py`

**Files:**
- Create: `backend/app/models.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。

- [ ] **Step 2: Verify**

```bash
cd backend && python -c "from app.models import Site, Favorite, PlayProgress, DownloadTask, AppConfig; print('models import ok')"
```

Expected: `models import ok`。

### Task 1.6: 写入 `backend/app/schemas.py`

**Files:**
- Create: `backend/app/schemas.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。

- [ ] **Step 2: Verify**

```bash
cd backend && python -c "from app.schemas import Episode, AggregatedVideo, SourceDetail, DetailRequest, ProbeResult; print('schemas import ok')"
```

Expected: `schemas import ok`。

### Task 1.7: 写入最小可启动 `backend/app/main.py`（暂不挂业务路由）

**Files:**
- Create: `backend/app/main.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入（Phase 3 末再追加业务路由挂载与 SPA 静态托管）。

- [ ] **Step 2: Verify**

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 &
sleep 2 && curl -s http://localhost:8000/api/health && kill %1
```

Expected: `{"status":"ok"}`。

---

## Phase 2 — 后端核心服务（硬契约 / 必须完整代码）

### Task 2.1: 写入 `backend/app/services/__init__.py`

**Files:**
- Create: `backend/app/services/__init__.py`

- [ ] **Step 1: Write file（空文件）**

```python
```

- [ ] **Step 2: Verify**

```bash
test -f backend/app/services/__init__.py && echo OK
```

Expected: `OK`。

### Task 2.2: 写入 `backend/app/services/parser.py` ⚠️ 关键契约

> 解析 `集数$地址$后缀\n...` 多行播放/下载字符串。纯函数、无 IO、无 DB；不足三段抛 `ValueError`。

**Files:**
- Create: `backend/app/services/parser.py`

- [ ] **Step 1: Write file**

```python
"""集数$地址$后缀 多行播放/下载地址解析器（硬契约）。

资源站约定：每行一集，格式严格为 集数$地址$后缀。
解析失败必须抛 ValueError，不允许吞掉或猜测。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Episode:
    ep_name: str
    url: str
    suffix: str
    index: int


def parse_episodes(raw: str) -> list[Episode]:
    """把 '集数$地址$后缀\\n...' 多行字符串解析为 Episode 列表。

    - 按 '\\n' 切行，跳过空行
    - 每行用 '$' 切成恰好 3 段；不足 3 段抛 ValueError
    - 字段顺序固定：ep_name / url / suffix
    - index 从 0 开始，按出现顺序赋值
    """
    if raw is None:
        return []
    episodes: list[Episode] = []
    for lineno, line in enumerate(raw.splitlines()):
        s = line.strip()
        if not s:
            continue
        parts = s.split("$")
        if len(parts) < 3:
            raise ValueError(
                f"播放/下载行格式不合规（第 {lineno + 1} 行）：'{s}'，"
                f"期望 '集数$地址$后缀'"
            )
        ep_name, url, suffix = parts[0], parts[1], "$".join(parts[2:])
        episodes.append(
            Episode(
                ep_name=ep_name.strip(),
                url=url.strip(),
                suffix=suffix.strip(),
                index=len(episodes),
            )
        )
    return episodes
```

- [ ] **Step 2: Verify**

```bash
cd backend && python -c "from app.services.parser import parse_episodes; eps = parse_episodes('第一集\$http://x/1.mp4\$ckplayer\n第二集\$http://x/2.mp4\$ckplayer'); print(eps)"
```

Expected: 打印两条 `Episode(ep_name='第一集', url='http://x/1.mp4', suffix='ckplayer', index=0)` / `(... index=1)`。

### Task 2.3: 写入 `backend/app/services/aggregator.py` ⚠️ 关键契约

> 按 `名称归一 + 年份` 聚合去重；归一规则：去 `《》`/首尾空白/`casefold()`。不接 DB；调用方喂数据进来。

**Files:**
- Create: `backend/app/services/aggregator.py`

- [ ] **Step 1: Write file**

```python
"""按 (归一title, year) 聚合多源列表（硬契约）。

归一规则：去 《 》 / 首尾空白 / casefold()。
不接 DB；调用方喂数据进来。
"""
from __future__ import annotations

from typing import Any, Iterable


def normalize_title(title: str) -> str:
    if title is None:
        return ""
    s = title.strip()
    for ch in ("《", "》", "<", ">"):
        s = s.replace(ch, "")
    return s.strip().casefold()


def aggregate_lists(per_source: Iterable[Iterable[dict[str, Any]]]) -> list[dict[str, Any]]:
    """把多个来源的列表合并去重。

    入参：[[item, ...], [item, ...], ...]，每个 item 至少包含 title / year / site_id / original_id
    出参：去重后的列表，每条形如：
        {title, year, poster_url, sources: [{site_id, original_id, ...}], ... }
    """
    bucket: dict[tuple[str, int | None], dict[str, Any]] = {}
    for source_items in per_source:
        for item in source_items:
            title = item.get("title", "")
            year = item.get("year")
            key = (normalize_title(title), year)
            existing = bucket.get(key)
            source_ref = {
                "site_id": item.get("site_id"),
                "original_id": item.get("original_id"),
            }
            extra_keys = ("type", "category", "remarks", "updated_at")
            for ek in extra_keys:
                if ek in item:
                    source_ref[ek] = item[ek]
            if existing is None:
                bucket[key] = {
                    "title": title.strip(),
                    "year": year,
                    "poster_url": item.get("poster_url"),
                    "sources": [source_ref],
                }
            else:
                if not existing.get("poster_url") and item.get("poster_url"):
                    existing["poster_url"] = item.get("poster_url")
                existing["sources"].append(source_ref)
    return list(bucket.values())
```

- [ ] **Step 2: Verify**

```bash
cd backend && python -c "from app.services.aggregator import normalize_title, aggregate_lists; print(normalize_title('《Foo》 ')); print(len(aggregate_lists([[{'title':'a','year':2020,'site_id':1,'original_id':'x'}],[{'title':'A','year':2020,'site_id':2,'original_id':'y'}]])))"
```

Expected: `foo` / `1`（被聚合成 1 条）。

### Task 2.4: 写入 `backend/app/services/source_client.py` ⚠️ 关键契约

> 唯一外部出口；按 `ac/t/pg/wd/h/ids` 拼参；`response.json()` 失败或缺 `list` 键则抛 `SourceProtocolError`。

**Files:**
- Create: `backend/app/services/source_client.py`

- [ ] **Step 1: Write file**

```python
"""资源站访问唯一出口（硬契约）。

参数协议（不可改）：
    ac=list|videolist
    t=<分类id>
    pg=<页数>
    wd=<关键字>
    h=<小时数>
    ids=<逗号分隔>

调用方禁止自拼 URL；任何路由都必须经过本模块。
"""
from __future__ import annotations

from typing import Any

import httpx


class SourceProtocolError(Exception):
    """资源站返回不符合 ac=list / videolist 协议时抛出。"""


class SourceClient:
    def __init__(self, site_id: int, base_url: str, name: str = "", timeout: float = 8.0):
        self.site_id = site_id
        self.base_url = base_url
        self.name = name or str(site_id)
        self.timeout = timeout

    @staticmethod
    def _build_params(
        ac: str,
        *,
        t: int | str | None = None,
        pg: int | None = None,
        wd: str | None = None,
        h: int | None = None,
        ids: list[str | int] | None = None,
    ) -> dict[str, str]:
        params: dict[str, str] = {"ac": ac}
        if t is not None:
            params["t"] = str(t)
        if pg is not None:
            params["pg"] = str(pg)
        if wd is not None:
            params["wd"] = str(wd)
        if h is not None:
            params["h"] = str(h)
        if ids:
            params["ids"] = ",".join(str(i) for i in ids)
        return params

    async def _get(self, params: dict[str, str]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(self.base_url, params=params)
        try:
            data = resp.json()
        except Exception as exc:
            raise SourceProtocolError(
                f"site={self.name} 返回非 JSON：{resp.text[:200]}"
            ) from exc
        if not isinstance(data, dict) or not isinstance(data.get("list"), list):
            raise SourceProtocolError(
                f"site={self.name} 返回缺少 'list' 列表字段"
            )
        return data

    async def list(
        self,
        *,
        t: int | str | None = None,
        pg: int | None = None,
        wd: str | None = None,
        h: int | None = None,
    ) -> list[dict[str, Any]]:
        params = self._build_params("list", t=t, pg=pg, wd=wd, h=h)
        data = await self._get(params)
        items: list[dict[str, Any]] = []
        for raw in data["list"]:
            items.append(self._normalize_list_item(raw))
        return items

    async def videolist(
        self,
        *,
        ids: list[str | int] | None = None,
        t: int | str | None = None,
        pg: int | None = None,
        h: int | None = None,
    ) -> list[dict[str, Any]]:
        params = self._build_params("videolist", t=t, pg=pg, h=h, ids=ids)
        data = await self._get(params)
        items: list[dict[str, Any]] = []
        for raw in data["list"]:
            items.append(self._normalize_detail_item(raw))
        return items

    def _normalize_list_item(self, raw: dict[str, Any]) -> dict[str, Any]:
        return {
            "site_id": self.site_id,
            "original_id": str(raw.get("vod_id") or raw.get("id") or ""),
            "title": raw.get("vod_name") or raw.get("name") or "",
            "year": _safe_int(raw.get("vod_year") or raw.get("year")),
            "poster_url": raw.get("vod_pic") or raw.get("pic"),
            "type": raw.get("type_name") or raw.get("type"),
            "remarks": raw.get("vod_remarks"),
            "updated_at": raw.get("vod_time") or raw.get("last"),
        }

    def _normalize_detail_item(self, raw: dict[str, Any]) -> dict[str, Any]:
        return {
            "site_id": self.site_id,
            "original_id": str(raw.get("vod_id") or raw.get("id") or ""),
            "title": raw.get("vod_name") or raw.get("name") or "",
            "year": _safe_int(raw.get("vod_year") or raw.get("year")),
            "poster_url": raw.get("vod_pic") or raw.get("pic"),
            "intro": raw.get("vod_content") or raw.get("vod_blurb"),
            "area": raw.get("vod_area"),
            "actors": raw.get("vod_actor"),
            "director": raw.get("vod_director"),
            "play_url_raw": raw.get("vod_play_url") or "",
            "download_url_raw": raw.get("vod_down_url") or "",
        }


def _safe_int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None
```

- [ ] **Step 2: Verify**

```bash
cd backend && python -c "from app.services.source_client import SourceClient, SourceProtocolError; print(SourceClient, SourceProtocolError)"
```

Expected: 类引用打印；网络调用留到 Settings 页 probe 时再验证。

### Task 2.5: 写入 `backend/app/services/health.py` ⚠️ 关键契约

> `async def probe(site, timeout=5) -> ProbeResult{ok, latency_ms, error}`；调 `<base_url>?ac=list&pg=1`，校验 JSON 含 `list` 键，记延时。

**Files:**
- Create: `backend/app/services/health.py`

- [ ] **Step 1: Write file**

```python
"""站点连通性 probe（硬契约）。

GET <base_url>?ac=list&pg=1，校验返回 JSON 含 list 键并测延时；
失败原因尽量明确，供 Settings 页直接展示。
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from app.services.source_client import SourceClient, SourceProtocolError


@dataclass
class ProbeResult:
    ok: bool
    latency_ms: int | None
    error: str | None


async def probe(site_id: int, base_url: str, name: str = "", timeout: float = 5.0) -> ProbeResult:
    client = SourceClient(site_id=site_id, base_url=base_url, name=name, timeout=timeout)
    started = time.perf_counter()
    try:
        items = await client.list(pg=1)
    except httpx.TimeoutException as exc:
        return ProbeResult(ok=False, latency_ms=None, error=f"超时：{exc!s}")
    except httpx.HTTPError as exc:
        return ProbeResult(ok=False, latency_ms=None, error=f"网络错误：{exc!s}")
    except SourceProtocolError as exc:
        latency = int((time.perf_counter() - started) * 1000)
        return ProbeResult(ok=False, latency_ms=latency, error=str(exc))
    except Exception as exc:
        return ProbeResult(ok=False, latency_ms=None, error=f"未知错误：{exc!s}")
    latency = int((time.perf_counter() - started) * 1000)
    if not items:
        return ProbeResult(ok=True, latency_ms=latency, error="list 为空，但响应合规")
    return ProbeResult(ok=True, latency_ms=latency, error=None)
```

- [ ] **Step 2: Verify**

```bash
cd backend && python -c "from app.services.health import probe; print(probe)"
```

Expected: `<function probe at 0x...>`。

### Task 2.6: 写入 `backend/app/services/downloader.py`（状态机骨架，留 TODO）

**Files:**
- Create: `backend/app/services/downloader.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入；只暴露 `start(task_id)` / `pause(task_id)` / `resume(task_id)` 三个 async 函数，内部实现仅记 log 后切状态，注释明确写 `TODO: 真实下载循环（HTTP Range + 写盘 + 进度回调）`。

- [ ] **Step 2: Verify**

```bash
cd backend && python -c "from app.services.downloader import start, pause, resume; print(start, pause, resume)"
```

Expected: 三个函数对象打印。

---

## Phase 3 — 后端 API 路由 + main 装配

### Task 3.1: 写入 `backend/app/api/__init__.py`

**Files:**
- Create: `backend/app/api/__init__.py`

- [ ] **Step 1: Write file（空文件）**

```python
```

- [ ] **Step 2: Verify**

```bash
test -f backend/app/api/__init__.py && echo OK
```

Expected: `OK`。

### Task 3.2: 写入 `backend/app/api/sites.py`（CRUD + sort + enabled + probe）

**Files:**
- Create: `backend/app/api/sites.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。包含 5 个端点：`GET /api/sites`、`POST /api/sites`、`PATCH /api/sites/{id}`、`DELETE /api/sites/{id}`、`POST /api/sites/{id}/probe`（调 `health.probe`）。

- [ ] **Step 2: Verify**

> 留到 Task 3.10 main 装配后做端到端 verify。

### Task 3.3: 写入 `backend/app/api/settings_api.py`

**Files:**
- Create: `backend/app/api/settings_api.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`GET /api/settings/download-root` 返回 `{value}` 或 404；`PUT /api/settings/download-root` 校验路径存在且可写后写 `AppConfig`。

### Task 3.4: 写入 `backend/app/api/videos.py`（list 聚合 / detail / search）

**Files:**
- Create: `backend/app/api/videos.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。三端点：
> - `GET /api/videos?t=&pg=&h=` —— 多源 `asyncio.gather` + `aggregator.aggregate_lists`，顶层带 `failed_sources`
> - `POST /api/videos/detail` body `DetailRequest{title, year, sources:[{site_id, original_id}]}` —— 多源 `videolist` + `parser.parse_episodes`
> - `GET /api/videos/search?wd=&pg=` —— 复用聚合管道
> - 全部源失败时抛 `HTTPException(502)`。

### Task 3.5: 写入 `backend/app/api/play.py`

**Files:**
- Create: `backend/app/api/play.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`GET /api/play/episodes?site_id=&original_id=` —— 单源 `videolist` + `parser` 解析后返回 `episodes:[Episode]`；解析阶段 `ValueError` → 502。

### Task 3.6: 写入 `backend/app/api/downloads.py`（CRUD + pause/resume，循环留 TODO）

**Files:**
- Create: `backend/app/api/downloads.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`POST /api/downloads` 创建前必须检查 `AppConfig.download_root` 存在，否则 409；任务入库 status=queued。`POST /api/downloads/{id}/pause`、`/resume`、`DELETE` 走状态机；`GET /api/downloads` 列任务。

### Task 3.7: 写入 `backend/app/api/progress.py`

**Files:**
- Create: `backend/app/api/progress.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`POST /api/progress` upsert（按 `(title, year)` 唯一键）；`GET /api/progress/recent` 列最近播放；`GET /api/progress?title=&year=` 取单条。

### Task 3.8: 写入 `backend/app/api/favorites.py`

**Files:**
- Create: `backend/app/api/favorites.py`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`POST /api/favorites`、`GET /api/favorites`、`DELETE /api/favorites/{id}`。

### Task 3.9: 更新 `backend/app/main.py` —— 挂业务路由 + CORS + SPA 静态托管 + 启动建表

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Edit file**

> 在 `app = FastAPI(...)` 后挂 7 个 router，加 CORS（`http://localhost:5173`），加 `lifespan` 在启动时调 `init_db()`，并把 `frontend/dist` 静态托管在 `/`（生产期）；开发期目录不存在就跳过。

- [ ] **Step 2: Verify (端到端)**

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 &
sleep 2
curl -s http://localhost:8000/api/sites
curl -s http://localhost:8000/api/settings/download-root -o /dev/null -w "%{http_code}\n"
kill %1
```

Expected: 第一条返回 `[]`；第二条返回 `404`。

### Task 3.10: 验证 `parser.py` 集数解析（人工 smoke）

- [ ] **Step 1: Run smoke**

```bash
cd backend && python -c "from app.services.parser import parse_episodes; print(parse_episodes('第一集\$http://x/1.mp4\$ckplayer\n第二集\$http://x/2.mp4\$ckplayer'))"
```

Expected: 两条 `Episode`，`index` 分别为 0 和 1。

```bash
cd backend && python -c "from app.services.parser import parse_episodes; parse_episodes('坏行只有两段\$http://x/1.mp4')" 2>&1 | tail -n 3
```

Expected: 抛出 `ValueError`，提示行格式不合规。

---

## Phase 4 — 前端骨架基础

### Task 4.1: 写入 `frontend/package.json`

**Files:**
- Create: `frontend/package.json`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。依赖：`react`, `react-dom`, `react-router-dom`；devDeps：`vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`。脚本：`dev` / `build` / `preview` / `typecheck`。

- [ ] **Step 2: Verify**

```bash
cd frontend && npm install 2>&1 | tail -n 3
```

Expected: `added N packages`，无 ERR。

### Task 4.2: 写入 `frontend/tsconfig.json` 与 `frontend/tsconfig.node.json`

**Files:**
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`tsconfig.json` 启用 `strict`、`jsx: react-jsx`、`moduleResolution: bundler`、`baseUrl`/`paths` 暂不配。

### Task 4.3: 写入 `frontend/vite.config.ts`

**Files:**
- Create: `frontend/vite.config.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`server.proxy['/api'] = http://localhost:8000`；`server.host = '0.0.0.0'`；`build.outDir = 'dist'`。

### Task 4.4: 写入 `frontend/index.html`

**Files:**
- Create: `frontend/index.html`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`<div id="root"></div>` + `<script type="module" src="/src/main.tsx"></script>`；预留 `<script src="/ckplayer/ckplayer.js"></script>` 注释行（实际启用待 Player 接入时打开）。

### Task 4.5: 写入 `frontend/public/ckplayer/.gitkeep`

**Files:**
- Create: `frontend/public/ckplayer/.gitkeep`

- [ ] **Step 1: Write file（空文件 + README 注释）**

```
# 用户手工把 ckplayer 资源（ckplayer.js / swf / 图片）放进本目录。
# Player.tsx 暂时以原生 <video> 兜底；接入 ckplayer 时再切换。
```

### Task 4.6: 写入 `frontend/src/main.tsx`

**Files:**
- Create: `frontend/src/main.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`createRoot(document.getElementById('root')!).render(<App />)` + 全局 CSS import。

### Task 4.7: 写入 `frontend/src/types.ts`（与后端 schemas.py 一一对应）

**Files:**
- Create: `frontend/src/types.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。导出 `Site`、`Episode`、`AggregatedVideo`、`SourceRef`、`SourceDetail`、`AggregatedListResponse`、`DetailRequest`、`DetailResponse`、`DownloadTask`、`PlayProgress`、`Favorite`、`ProbeResult`。

### Task 4.8: 写入 `frontend/src/api/client.ts`

**Files:**
- Create: `frontend/src/api/client.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。导出 `request<T>(method, path, body?)`、`ApiError`；非 2xx 抛 `ApiError(status, detail)`；导出便捷 `get/post/put/patch/del`。

### Task 4.9: 写入 `frontend/src/styles/global.css`

**Files:**
- Create: `frontend/src/styles/global.css`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。暗色主题 CSS 变量（`--bg`, `--fg`, `--accent`, `--card`, `--border`）+ reset + flex/grid utility class（`.row`, `.col`, `.grid`, `.btn`, `.btn-primary`, `.empty`）。

### Task 4.10: 写入 `frontend/src/router.tsx`

**Files:**
- Create: `frontend/src/router.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`createBrowserRouter` 路由表：`/` Home / `/search` Search / `/detail` Detail / `/player` Player / `/downloads` Downloads / `/favorites` Favorites / `/progress` Progress / `/settings` Settings；外层 Layout。

### Task 4.11: 写入 `frontend/src/App.tsx`

**Files:**
- Create: `frontend/src/App.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`<RouterProvider router={router} />` + Toast 容器（极简，自实现 stateful list）。

### Task 4.12: 写入 `frontend/src/components/Layout.tsx`

**Files:**
- Create: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。顶部导航：首页 / 搜索 / 收藏 / 最近 / 下载 / 设置；`<Outlet />` 渲染子路由。

- [ ] **Step 2: Verify (前端可启动)**

```bash
cd frontend && npm run dev &
sleep 3 && curl -s http://localhost:5173 | head -n 3
kill %1
```

Expected: HTML 中含 `<div id="root"></div>`，无编译报错。

---

## Phase 5 — 前端 API 模块（薄包装）

### Task 5.1: 写入 `frontend/src/api/sites.ts`

**Files:**
- Create: `frontend/src/api/sites.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。导出 `listSites`, `createSite`, `updateSite`, `deleteSite`, `probeSite(id)`。

### Task 5.2: 写入 `frontend/src/api/settings.ts`

**Files:**
- Create: `frontend/src/api/settings.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`getDownloadRoot()`、`setDownloadRoot(path)`。`getDownloadRoot` 把 404 转 `null`。

### Task 5.3: 写入 `frontend/src/api/videos.ts`

**Files:**
- Create: `frontend/src/api/videos.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`listVideos({t?, pg?, h?})`、`searchVideos({wd, pg?})`、`getDetail(req: DetailRequest)`。

### Task 5.4: 写入 `frontend/src/api/play.ts`

**Files:**
- Create: `frontend/src/api/play.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`getEpisodes(site_id, original_id)` → `Episode[]`。

### Task 5.5: 写入 `frontend/src/api/downloads.ts`

**Files:**
- Create: `frontend/src/api/downloads.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`createDownload(body)`、`listDownloads()`、`pauseDownload(id)`、`resumeDownload(id)`、`deleteDownload(id)`。

### Task 5.6: 写入 `frontend/src/api/progress.ts`

**Files:**
- Create: `frontend/src/api/progress.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`upsertProgress(body)`、`listRecent()`、`getProgress(title, year?)`。

### Task 5.7: 写入 `frontend/src/api/favorites.ts`

**Files:**
- Create: `frontend/src/api/favorites.ts`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`addFavorite(body)`、`listFavorites()`、`removeFavorite(id)`。

---

## Phase 6 — 前端组件与页面

### Task 6.1: 写入 `frontend/src/components/VideoCard.tsx`

**Files:**
- Create: `frontend/src/components/VideoCard.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。展示封面 / 标题 / 年份；点击带 `state={item}` 跳 `/detail`。

### Task 6.2: 写入 `frontend/src/components/EpisodeList.tsx`

**Files:**
- Create: `frontend/src/components/EpisodeList.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。接收 `episodes: Episode[]` 与 `onPick(index)` 回调。

### Task 6.3: 写入 `frontend/src/components/SourcePicker.tsx` ⚠️ 关键契约

> 强制点击；无默认选中；用户必须显式点选源后才发起后续动作。

**Files:**
- Create: `frontend/src/components/SourcePicker.tsx`

- [ ] **Step 1: Write file**

```tsx
import { useState } from "react";
import type { SourceRef } from "../types";

type SourcePickerProps = {
  sources: SourceRef[];
  open: boolean;
  title?: string;
  onCancel: () => void;
  onConfirm: (source: SourceRef) => void;
  /** 显示在每个源下方的副标题（可选，例如展示集数 / 备注） */
  formatSubtitle?: (source: SourceRef) => string | undefined;
};

/**
 * 强制让用户显式选择视频源。
 * 硬契约：
 *   - 不允许默认选中
 *   - 「确定」按钮在用户未点击源前必须 disabled
 *   - 用户没有点选源就不能触发 onConfirm
 */
export default function SourcePicker(props: SourcePickerProps) {
  const { sources, open, title, onCancel, onConfirm, formatSubtitle } = props;
  const [picked, setPicked] = useState<SourceRef | null>(null);

  if (!open) return null;

  return (
    <div
      className="source-picker-mask"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: "var(--card, #1c1c1e)",
          color: "var(--fg, #f5f5f7)",
          padding: 20,
          borderRadius: 8,
          width: "min(420px, 92vw)",
          border: "1px solid var(--border, #2d2d2f)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>{title ?? "请选择来源"}</h3>
        <p style={{ opacity: 0.7, fontSize: 13 }}>
          每个源由不同采集站提供，请显式点选一个再确认。
        </p>

        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0", maxHeight: 320, overflowY: "auto" }}>
          {sources.length === 0 && (
            <li style={{ opacity: 0.7, padding: 12 }}>无可用源</li>
          )}
          {sources.map((s) => {
            const key = `${s.site_id}-${s.original_id}`;
            const isPicked =
              picked != null &&
              picked.site_id === s.site_id &&
              picked.original_id === s.original_id;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setPicked(s)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    margin: "4px 0",
                    border: isPicked
                      ? "1px solid var(--accent, #0a84ff)"
                      : "1px solid var(--border, #2d2d2f)",
                    background: isPicked
                      ? "rgba(10,132,255,0.12)"
                      : "transparent",
                    borderRadius: 6,
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 500 }}>
                    站点 #{s.site_id} · 原始 ID {s.original_id}
                  </div>
                  {formatSubtitle && (
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      {formatSubtitle(s)}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={picked == null}
            onClick={() => picked && onConfirm(picked)}
            title={picked == null ? "请先选择一个源" : undefined}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Task 6.4: 写入 `frontend/src/pages/Home.tsx`

**Files:**
- Create: `frontend/src/pages/Home.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。挂载时 `listSites()`：空数组渲染 EmptyState（"先去设置页加站点"）；非空才 `listVideos()`；`failed_sources` 角标提示。

### Task 6.5: 写入 `frontend/src/pages/Settings.tsx`

**Files:**
- Create: `frontend/src/pages/Settings.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。两块：站点 CRUD（含 probe 按钮，结果展示 ok / latency_ms / error）+ 下载根目录 PUT/GET。

### Task 6.6: 写入 `frontend/src/pages/Search.tsx`

**Files:**
- Create: `frontend/src/pages/Search.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。顶部搜索框（`wd`）+ 卡片网格复用 VideoCard。

### Task 6.7: 写入 `frontend/src/pages/Detail.tsx`

**Files:**
- Create: `frontend/src/pages/Detail.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。`useLocation().state` 读首页传入的 `AggregatedVideo`；挂载时 `getDetail({title, year, sources})`；展示简介 / 封面 / 演员 / 选集；播放与下载入口都先弹 SourcePicker，下载前先 `getDownloadRoot()`。

### Task 6.8: 写入 `frontend/src/pages/Player.tsx`（含上一集 / 下一集）

**Files:**
- Create: `frontend/src/pages/Player.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。读 query `site_id, original_id, ep`；挂载 `getEpisodes()` 一次性拉整源；本地维护 `currentIndex`；上一集/下一集按钮（边界禁用）；ckplayer 占位（注释 + 原生 `<video>`）；每 15 秒 `upsertProgress`，卸载时 `navigator.sendBeacon` 兜底一次。

### Task 6.9: 写入 `frontend/src/pages/Downloads.tsx`

**Files:**
- Create: `frontend/src/pages/Downloads.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。任务列表 + 暂停 / 继续 / 删除按钮；状态文案。

### Task 6.10: 写入 `frontend/src/pages/Favorites.tsx`

**Files:**
- Create: `frontend/src/pages/Favorites.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。卡片网格 + 删除按钮。

### Task 6.11: 写入 `frontend/src/pages/Progress.tsx`

**Files:**
- Create: `frontend/src/pages/Progress.tsx`

- [ ] **Step 1: Write file**

> 完整代码后续 Edit 注入。最近播放列表，点击跳 `/player?site_id=&original_id=&ep=N`。

- [ ] **Step 2: Verify (前后端联调)**

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 &
cd ../frontend && npm run dev &
sleep 4
curl -s http://localhost:5173/ | grep -q 'id="root"' && echo "前端 OK"
curl -s http://localhost:5173/api/sites && echo
kill %1 %2
```

Expected: 「前端 OK」+ 后端 sites 接口返回 `[]`（经 Vite 反代）。

---

## Phase 7 — 联调收口 + CLAUDE.md 命令章节回填

### Task 7.1: 前端构建产物 + FastAPI 静态托管联调

- [ ] **Step 1: Build**

```bash
cd frontend && npm run build
```

Expected: `dist/index.html` 等产物存在。

- [ ] **Step 2: Verify**

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 &
sleep 2
curl -s http://localhost:8000/ | grep -q 'id="root"' && echo "静态托管 OK"
curl -s http://localhost:8000/api/sites
kill %1
```

Expected: 「静态托管 OK」+ `[]`。

### Task 7.2: 走通验证清单 1–5

- [ ] **Step 1: 按 spec 验证清单逐条 smoke**

逐条对照 spec `2026-04-25-home-theater-mvp-design.md` 「验证清单」节：
1. 后端 install + 启动 + `GET /api/sites` 返回 `[]` ✅
2. 前端 install + dev + 首页 EmptyState ✅
3. Settings 新增站点 + probe 失败回 `{ok:false, error}` ✅
4. `PUT /api/settings/download-root` + 未设置时 `POST /api/downloads` → 409 ✅
5. `parser.parse_episodes` 双行返回两条 ✅

Expected: 5 条全过。

### Task 7.3: 修改 `CLAUDE.md` —— 用真实命令替换「常用命令」章节 + 目录概览补 1-2 行

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Edit file**

> 把「常用命令」节占位替换为：
> - 后端开发：`cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
> - 前端开发：`cd frontend && npm run dev`
> - 前端构建：`cd frontend && npm run build`
> - 联调启动（生产形态）：先 `npm run build` 再 `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000`
>
> 同时在文件首部「项目概览」节后追加 2 行：
> - 仓库布局：`backend/`（FastAPI app）、`frontend/`（Vite SPA）；前端构建产物由后端静态托管
> - 数据库：`backend/data/app.db` 由 SQLAlchemy `create_all` 启动时建表

- [ ] **Step 2: Verify**

```bash
grep -n "uvicorn app.main:app" CLAUDE.md
```

Expected: 命中至少 2 行。

---

## 自检清单

写完上面所有文件后，回头核对：

- [ ] 5 个关键契约文件（`source_client.py` / `parser.py` / `aggregator.py` / `health.py` / `SourcePicker.tsx`）都有完整代码，无 TODO 占位
- [ ] 所有 API 字段命名统一 snake_case（`site_id`, `original_id`, `episode_index`, `download_root`...）
- [ ] 详情接口形态：请求 `{title, year, sources:[{site_id, original_id}]}`，响应 `{title, year, sources:[SourceDetail]}`
- [ ] 任何一处都没有「自动选源 / 默认选第一个源」的逻辑
- [ ] 后端不在代码里硬编码 `0.0.0.0`；启动绑定通过 uvicorn 命令行
- [ ] CLAUDE.md「常用命令」章节真实可执行，与 plan 一致
