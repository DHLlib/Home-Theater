import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response

from app.api import favorites, downloads, play, progress, settings_api, sites, sse, videos
from app.db import init_db
from app.logging_config import setup_logging
from app.services.downloader import download_worker
from app.services.scheduler import init_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    await init_db()
    worker_task = asyncio.create_task(download_worker())
    scheduler_task = await init_scheduler()
    yield
    worker_task.cancel()
    scheduler_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass


class CacheControlStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope) -> Response:
        is_fallback = False
        try:
            response = await super().get_response(path, scope)
        except Exception as exc:
            if getattr(exc, "status_code", None) == 404:
                # 静态资源文件（JS/CSS/图片等）不存在时，不要 fallback 到 index.html，
                # 否则浏览器会把 HTML 当 JS/CSS 解析导致白屏
                if "." in path and not path.endswith(".html"):
                    raise
                response = await super().get_response("index.html", scope)
                is_fallback = True
            else:
                raise
        if is_fallback or path == "" or path.endswith(".html"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, proxy-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        elif path.endswith(".js") or path.endswith(".css"):
            # JS/CSS 用短缓存 + must-revalidate，避免构建产物更新后浏览器仍用旧缓存
            response.headers["Cache-Control"] = "public, max-age=60, must-revalidate"
        elif "." in path:
            response.headers["Cache-Control"] = "public, max-age=86400"
        return response


app = FastAPI(title="Home Theater", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=5)

app.include_router(sites.router, prefix="/api")
app.include_router(videos.router, prefix="/api")
app.include_router(play.router, prefix="/api")
app.include_router(downloads.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(favorites.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")
app.include_router(sse.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


_frontend_dist = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "dist"
)
if os.path.isdir(_frontend_dist):
    app.mount("/", CacheControlStaticFiles(directory=_frontend_dist, html=True), name="static")
