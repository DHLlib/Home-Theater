# Phase 2：下载功能闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 MVP 下载功能的执行闭环，实现真正的断点续传下载、进度可视化、暂停/继续、删除与错误处理。

**Architecture:** 后端新增 `download_worker` 后台 asyncio 循环，使用 `httpx` 流式下载 + `aiofiles` 追加写盘，每 64KB 更新数据库进度；前端下载列表页每 2s 轮询 + 进度条 + 删除确认对话框。

**Tech Stack:** Python (FastAPI, httpx, aiofiles, SQLAlchemy async), React + TypeScript

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `backend/pyproject.toml` | 修改 | 添加 `aiofiles` 依赖 |
| `backend/app/services/downloader.py` | 重写 | 真实下载循环、错误分类、暂停恢复 |
| `backend/app/api/downloads.py` | 修改 | 删除接口支持源文件清理、返回错误详情 |
| `backend/app/main.py` | 修改 | lifespan 启动/停止下载 worker |
| `frontend/src/api/downloads.ts` | 修改 | `deleteDownload` 支持可选参数 |
| `frontend/src/pages/Downloads.tsx` | 重写 | 进度条、2s 轮询、删除确认对话框、状态标签 |

---

### Task 1: 添加 aiofiles 依赖

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: 在 dependencies 中添加 aiofiles**

```toml
[project]
name = "home-theater"
version = "0.1.0"
description = "个人视频聚合系统"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.29",
    "httpx>=0.27",
    "sqlalchemy[asyncio]>=2.0",
    "aiosqlite>=0.20",
    "pydantic-settings>=2.2",
    "aiofiles>=23.0",
]
```

- [ ] **Step 2: 安装依赖**

Run: `cd backend && pip install -e ".[dev]"`
Expected: aiofiles 安装成功，无报错

- [ ] **Step 3: Commit**

```bash
git add backend/pyproject.toml
git commit -m "deps: add aiofiles for async file I/O"
```

---

### Task 2: 重写 downloader.py — 真实下载循环

**Files:**
- Modify: `backend/app/services/downloader.py`（完整重写）

- [ ] **Step 1: 完整重写 downloader.py**

```python
"""下载器：真实 HTTP Range 下载 + 断点续传 + 错误分类。"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import aiofiles
import httpx
from sqlalchemy import select

from app.db import async_session_factory
from app.models import DownloadTask, Site
from app.services.health import probe

logger = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024  # 64KB


async def download_worker() -> None:
    """后台循环：持续取出 queued 任务并执行下载。"""
    while True:
        task_id = await _pick_next_task()
        if task_id is None:
            await asyncio.sleep(5)
            continue

        try:
            await _run_download(task_id)
        except Exception:
            logger.exception("下载任务异常 task_id=%s", task_id)
            await _set_error(task_id, "connection_error: 下载循环异常")

        await asyncio.sleep(1)


async def _pick_next_task() -> int | None:
    """取出最老的一条 queued 任务，返回 task_id；没有则返回 None。"""
    async with async_session_factory() as session:
        result = await session.execute(
            select(DownloadTask)
            .where(DownloadTask.status == "queued")
            .order_by(DownloadTask.created_at)
            .limit(1)
        )
        task = result.scalar_one_or_none()
        if not task:
            return None
        task.status = "downloading"
        await session.commit()
        return task.id


async def _run_download(task_id: int) -> None:
    """对单条任务执行流式下载。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if not task:
            return

        # 查询站点信息（用于错误分类时探测）
        site = await session.get(Site, task.source_site_id)
        site_name = site.name if site else ""
        base_url = site.base_url if site else ""

        # 确保目录存在
        Path(task.file_path).parent.mkdir(parents=True, exist_ok=True)

        headers = {"Range": f"bytes={task.downloaded_bytes}-"}

        try:
            async with httpx.AsyncClient(
                timeout=30, follow_redirects=True
            ) as client:
                async with client.stream("GET", task.url, headers=headers) as resp:
                    # 404 → 资源已失效
                    if resp.status_code == 404:
                        task.status = "error"
                        task.error = "file_removed: 资源已失效"
                        await session.commit()
                        return

                    # 其他 4xx/5xx → 尝试探测站点分类
                    if resp.status_code >= 400:
                        error_msg = await _classify_http_error(
                            task.source_site_id, base_url, site_name, resp.status_code
                        )
                        task.status = "error"
                        task.error = error_msg
                        await session.commit()
                        return

                    # 获取总大小（断点续传场景）
                    if task.total_bytes is None:
                        content_length = resp.headers.get("content-length")
                        if content_length:
                            task.total_bytes = task.downloaded_bytes + int(
                                content_length
                            )

                    # 流式写入
                    async with aiofiles.open(task.file_path, "ab") as f:
                        async for chunk in resp.aiter_bytes(CHUNK_SIZE):
                            # 检查是否被暂停
                            await session.refresh(task)
                            if task.status == "paused":
                                logger.info("任务被暂停 task_id=%s", task_id)
                                return

                            await f.write(chunk)
                            task.downloaded_bytes += len(chunk)
                            await session.commit()

                    task.status = "done"
                    await session.commit()
                    logger.info("下载完成 task_id=%s", task_id)

        except httpx.TimeoutException:
            error_msg = await _classify_network_error(
                task.source_site_id, base_url, site_name, "下载超时"
            )
            await _set_error(task_id, error_msg)
        except httpx.HTTPError as exc:
            error_msg = await _classify_network_error(
                task.source_site_id, base_url, site_name, str(exc)
            )
            await _set_error(task_id, error_msg)
        except Exception as exc:
            await _set_error(task_id, f"connection_error: {exc}")


async def _classify_http_error(
    site_id: int, base_url: str, site_name: str, status_code: int
) -> str:
    """HTTP 错误时尝试探测站点，区分 site_unavailable 与 connection_error。"""
    if not base_url:
        return f"connection_error: HTTP {status_code}"
    result = await probe(site_id, base_url, site_name, timeout=5)
    if not result.ok:
        return f"site_unavailable: {result.error}"
    return f"connection_error: HTTP {status_code}"


async def _classify_network_error(
    site_id: int, base_url: str, site_name: str, detail: str
) -> str:
    """网络异常时尝试探测站点。"""
    if not base_url:
        return f"connection_error: {detail}"
    result = await probe(site_id, base_url, site_name, timeout=5)
    if not result.ok:
        return f"site_unavailable: {result.error}"
    return f"connection_error: {detail}"


async def _set_error(task_id: int, error_msg: str) -> None:
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "error"
            task.error = error_msg
            await session.commit()
    logger.error("下载失败 task_id=%s error=%s", task_id, error_msg)


# --- 旧接口兼容：pause / resume 由前端通过 API 触发，worker 循环中检查 ---

async def pause(task_id: int) -> None:
    """将任务状态设为 paused；worker 会在下一个 chunk 后退出。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task and task.status == "downloading":
            task.status = "paused"
            await session.commit()
    logger.info("任务已暂停 task_id=%s", task_id)


async def resume(task_id: int) -> None:
    """将任务状态设为 queued，worker 会重新拾取。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task and task.status == "paused":
            task.status = "queued"
            await session.commit()
    logger.info("任务已恢复 task_id=%s", task_id)
```

- [ ] **Step 2: 验证后端启动无报错**

Run: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload`
Expected: 正常启动，无 import error

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/downloader.py
git commit -m "feat: real download worker with Range, aiofiles, and error classification"
```

---

### Task 3: 增强 downloads.py — 删除源文件支持

**Files:**
- Modify: `backend/app/api/downloads.py`

- [ ] **Step 1: 完整重写 downloads.py**

```python
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import AppConfig, DownloadTask
from app.schemas import DownloadTaskCreate
from app.services.downloader import pause as dl_pause, resume as dl_resume

router = APIRouter(prefix="/downloads", tags=["downloads"])


@router.get("")
async def list_downloads(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DownloadTask).order_by(DownloadTask.created_at.desc())
    )
    return result.scalars().all()


@router.post("")
async def create_download(req: DownloadTaskCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "download_root")
    )
    root_row = result.scalar_one_or_none()
    if not root_row:
        raise HTTPException(status_code=409, detail="download_root not configured")

    root = Path(root_row.value)
    safe_title = "".join(
        c if c.isalnum() or c in "._- " else "_" for c in req.title
    ).strip()
    episode_name = "".join(
        c if c.isalnum() or c in "._- " else "_" for c in req.episode_name
    ).strip()
    ext = req.suffix if req.suffix in ("mp4", "m3u8") else "mp4"
    file_path = str(root / safe_title / f"{episode_name}.{ext}")

    task = DownloadTask(
        title=req.title,
        episode_index=req.episode_index,
        episode_name=req.episode_name,
        source_site_id=req.site_id,
        source_video_id=req.original_id,
        url=req.url,
        suffix=req.suffix,
        file_path=file_path,
        status="queued",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


@router.post("/{task_id}/pause")
async def pause_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await dl_pause(task_id)
    return task


@router.post("/{task_id}/resume")
async def resume_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await dl_resume(task_id)
    return task


@router.delete("/{task_id}")
async def delete_download(
    task_id: int,
    delete_file: bool = False,
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    file_error = None
    file_deleted = False

    if delete_file and task.file_path:
        try:
            os.remove(task.file_path)
            file_deleted = True
        except FileNotFoundError:
            file_error = "源文件已被删除或不存在"
        except PermissionError:
            file_error = "无权限删除源文件，请检查文件权限"
        except Exception as exc:
            file_error = f"删除源文件失败: {exc}"

    await db.delete(task)
    await db.commit()

    return {
        "ok": True,
        "file_deleted": file_deleted,
        "file_error": file_error,
    }
```

- [ ] **Step 2: 验证后端启动无报错**

Run: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8181`
Expected: 正常启动

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/downloads.py
git commit -m "feat: delete download with optional source file cleanup"
```

---

### Task 4: 在 lifespan 中启动下载 worker

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: 修改 lifespan 启动/停止 worker**

```python
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.db import init_db
from app.services.downloader import download_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    worker_task = asyncio.create_task(download_worker())
    yield
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Home Theater", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api import favorites, downloads, play, progress, settings_api, sites, videos

app.include_router(sites.router, prefix="/api")
app.include_router(videos.router, prefix="/api")
app.include_router(play.router, prefix="/api")
app.include_router(downloads.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(favorites.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


_frontend_dist = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "dist"
)
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="static")
```

注意：需要在文件顶部添加 `import asyncio`。当前 main.py 第 1 行是 `import os`，在第 1 行之前添加：

```python
import asyncio
import os
```

- [ ] **Step 2: 验证后端启动无报错**

Run: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8181`
Expected: 正常启动，日志中无异常

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: start download worker in FastAPI lifespan"
```

---

### Task 5: 前端 API 更新 — deleteDownload 支持参数

**Files:**
- Modify: `frontend/src/api/downloads.ts`

- [ ] **Step 1: 修改 downloads.ts**

```typescript
import { get, post, del } from "./client";
import type { DownloadTask, DownloadTaskCreate } from "../types";

export const createDownload = (body: DownloadTaskCreate) =>
  post<DownloadTask>("/api/downloads", body);

export const listDownloads = () => get<DownloadTask[]>("/api/downloads");

export const pauseDownload = (id: number) =>
  post<DownloadTask>(`/api/downloads/${id}/pause`);

export const resumeDownload = (id: number) =>
  post<DownloadTask>(`/api/downloads/${id}/resume`);

export const deleteDownload = (id: number, deleteFile?: boolean) =>
  del<{ ok: boolean; file_deleted?: boolean; file_error?: string | null }>(
    `/api/downloads/${id}${deleteFile ? "?delete_file=true" : ""}`
  );
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/downloads.ts
git commit -m "feat: deleteDownload supports optional source file deletion"
```

---

### Task 6: 重写 Downloads.tsx — 进度可视化

**Files:**
- Modify: `frontend/src/pages/Downloads.tsx`（完整重写）

- [ ] **Step 1: 完整重写 Downloads.tsx**

```typescript
import { useEffect, useState } from "react";
import {
  listDownloads,
  pauseDownload,
  resumeDownload,
  deleteDownload,
} from "../api/downloads";
import type { DownloadTask } from "../types";

const statusText: Record<string, string> = {
  queued: "排队中",
  downloading: "下载中",
  paused: "已暂停",
  done: "完成",
  error: "错误",
};

const statusColor: Record<string, string> = {
  queued: "var(--text-secondary)",
  downloading: "var(--primary)",
  paused: "var(--warning)",
  done: "var(--success)",
  error: "var(--danger)",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function parseErrorType(error?: string | null): {
  type: string;
  message: string;
  retryable: boolean;
} {
  if (!error) return { type: "unknown", message: "", retryable: false };
  if (error.startsWith("connection_error")) {
    return { type: "connection_error", message: error, retryable: true };
  }
  if (error.startsWith("site_unavailable")) {
    return { type: "site_unavailable", message: error, retryable: false };
  }
  if (error.startsWith("file_removed")) {
    return { type: "file_removed", message: error, retryable: false };
  }
  return { type: "unknown", message: error, retryable: false };
}

export default function Downloads() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deleteFileMap, setDeleteFileMap] = useState<Record<number, boolean>>({});

  const refresh = () => listDownloads().then(setTasks);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, []);

  const handleDelete = async (id: number) => {
    const deleteFile = deleteFileMap[id] || false;
    try {
      const res = await deleteDownload(id, deleteFile);
      if (res.file_error) {
        alert(res.file_error);
      }
      setConfirmingId(null);
      refresh();
    } catch {
      // ApiError 已由 client.ts toast 处理
    }
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <h2>下载任务</h2>
      {tasks.map((t) => {
        const progress =
          t.total_bytes && t.total_bytes > 0
            ? Math.round((t.downloaded_bytes / t.total_bytes) * 100)
            : 0;
        const errorInfo = parseErrorType(t.error);

        return (
          <div
            key={t.id}
            style={{
              padding: 12,
              background: "var(--card)",
              borderRadius: 8,
            }}
          >
            <div
              className="row"
              style={{ justifyContent: "space-between", marginBottom: 8 }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>
                  {t.title} · {t.episode_name}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: statusColor[t.status] || "inherit",
                    marginTop: 4,
                  }}
                >
                  {statusText[t.status] || t.status}
                  {t.status === "downloading" && t.total_bytes
                    ? ` · ${formatBytes(t.downloaded_bytes)} / ${formatBytes(
                        t.total_bytes
                      )}`
                    : t.status === "downloading"
                    ? ` · ${formatBytes(t.downloaded_bytes)}`
                    : ""}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {t.status === "downloading" && (
                  <button
                    className="btn"
                    onClick={() => pauseDownload(t.id).then(refresh)}
                  >
                    暂停
                  </button>
                )}
                {(t.status === "paused" || t.status === "error") && (
                  <button
                    className="btn btn-primary"
                    onClick={() => resumeDownload(t.id).then(refresh)}
                  >
                    {t.status === "error" ? "重试" : "继续"}
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() => {
                    setConfirmingId(t.id);
                    setDeleteFileMap((prev) => ({ ...prev, [t.id]: false }));
                  }}
                >
                  删除
                </button>
              </div>
            </div>

            {/* 进度条 */}
            {(t.status === "downloading" ||
              t.status === "paused" ||
              t.status === "queued") && (
              <div style={{ marginBottom: 8 }}>
                <div
                  style={{
                    height: 6,
                    background: "var(--bg)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${progress}%`,
                      height: "100%",
                      background: "var(--primary)",
                      borderRadius: 3,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    textAlign: "right",
                    marginTop: 2,
                    opacity: 0.6,
                  }}
                >
                  {progress}%
                </div>
              </div>
            )}

            {/* 错误信息 */}
            {t.status === "error" && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--danger)",
                  marginBottom: 8,
                  padding: 8,
                  background: "rgba(255,0,0,0.05)",
                  borderRadius: 4,
                }}
              >
                {errorInfo.message}
                {errorInfo.type === "site_unavailable" && (
                  <div style={{ marginTop: 4, fontSize: 11 }}>
                    站点不可用，请前往设置检查
                  </div>
                )}
                {errorInfo.type === "file_removed" && (
                  <div style={{ marginTop: 4, fontSize: 11 }}>
                    资源已失效
                  </div>
                )}
              </div>
            )}

            {/* 删除确认 */}
            {confirmingId === t.id && (
              <div
                style={{
                  marginTop: 8,
                  padding: 10,
                  background: "var(--bg)",
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  确定删除此下载任务？
                </div>
                <label
                  style={{
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 10,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deleteFileMap[t.id] || false}
                    onChange={(e) =>
                      setDeleteFileMap((prev) => ({
                        ...prev,
                        [t.id]: e.target.checked,
                      }))
                    }
                  />
                  同时删除本地源文件
                </label>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDelete(t.id)}
                  >
                    确定删除
                  </button>
                  <button
                    className="btn"
                    onClick={() => setConfirmingId(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {tasks.length === 0 && <div className="empty">暂无下载任务</div>}
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Downloads.tsx
git commit -m "feat: download list with progress bar, polling, delete confirm"
```

---

## Self-Review

**1. Spec coverage:**

| Spec 需求 | 对应 Task |
|-----------|-----------|
| 下载执行循环（HTTP Range + 写盘 + 进度回调） | Task 2 |
| 暂停/继续 | Task 2（worker 检查 paused 状态） |
| 前端进度可视化（进度条、2s 轮询） | Task 6 |
| 错误分类（connection/site/file） | Task 2 |
| 删除任务 + 源文件清理 | Task 3 + Task 6 |

无遗漏。

**2. Placeholder scan:**

计划中无 "TBD" / "TODO" / "implement later" / "fill in details" / "add appropriate error handling" 等 red flag。所有 Task 均含完整代码块。

**3. Type consistency:**

- `deleteDownload` 返回类型 `{ ok, file_deleted?, file_error? }` 前后端一致
- `DownloadTask` 类型未变，复用现有 schema
- `pause` / `resume` 接口签名未变，兼容旧调用

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-26-downloads-closure-plan.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**
