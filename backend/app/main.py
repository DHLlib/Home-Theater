import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response

from app.api import favorites, downloads, play, progress, settings_api, sites, sse, system_categories, videos
from app.db import async_session_factory, engine, init_db
from app.logging_config import setup_logging
from app.services.downloader import download_coordinator
from app.services.scheduler import init_scheduler
from app.services.listen_manager import listen_manager
from app.services.category_mapping import migrate_categories_to_mapping_table
from app.services.aggregator import migrate_video_cache_norm_title, refresh_aggregated_view


DEFAULT_SYSTEM_CATEGORIES = [
    # (父分类名, 排序, [子分类])
    ("电影", 1, [
        ("动作片", 1),
        ("科幻片", 2),
        ("喜剧片", 3),
        ("爱情片", 4),
        ("剧情片", 5),
        ("战争片", 6),
        ("恐怖片", 7),
        ("伦理片", 8),
        ("纪录片", 9),
        ("动画片", 10),
        ("短片", 11),
        ("4K电影", 12),
        ("邵氏电影", 13),
        ("Netflix", 14),
    ]),
    ("连续剧", 2, [
        ("国产剧", 1),
        ("香港剧", 2),
        ("韩国剧", 3),
        ("欧美剧", 4),
        ("台湾剧", 5),
        ("日本剧", 6),
        ("泰国剧", 7),
        ("海外剧", 8),
    ]),
    ("综艺", 3, [
        ("大陆综艺", 1),
        ("港台综艺", 2),
        ("日韩综艺", 3),
        ("欧美综艺", 4),
    ]),
    ("动漫", 4, [
        ("国产动漫", 1),
        ("日韩动漫", 2),
        ("欧美动漫", 3),
        ("港台动漫", 4),
        ("海外动漫", 5),
    ]),
    ("其他", 5, [
        ("其他资源", 1),
        ("成人", 2),
    ]),
]


async def check_db_connection() -> None:
    """启动前检查数据库连通性，graceful 启动。"""
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))


async def _init_default_categories():
    """首次启动时自动创建默认系统分类。"""
    from sqlalchemy import select
    from app.models import SystemCategory
    from app.db import async_session_factory

    async with async_session_factory() as db:
        result = await db.execute(select(SystemCategory).limit(1))
        if result.scalar_one_or_none():
            return  # 已有数据，跳过

        for parent_name, parent_sort, children in DEFAULT_SYSTEM_CATEGORIES:
            parent = SystemCategory(name=parent_name, sort=parent_sort)
            db.add(parent)
            await db.flush()  # 获取 parent.id
            for child_name, child_sort in children:
                db.add(SystemCategory(name=child_name, parent_id=parent.id, sort=child_sort))
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    await check_db_connection()
    await init_db()
    async with async_session_factory() as db:
        await migrate_categories_to_mapping_table(db)
        await migrate_video_cache_norm_title(db)
    await _init_default_categories()

    # Phase 2: 首次启动或表为空时，后台重建聚合中间表
    async def _bootstrap_aggregated_tables():
        async with async_session_factory() as db:
            from app.models import AggregatedVideoV3
            from sqlalchemy import func, select

            count = await db.execute(
                select(func.count()).select_from(AggregatedVideoV3)
            )
            if count.scalar_one() == 0:
                logger = logging.getLogger(__name__)
                logger.info("聚合中间表为空，启动后台重建")
                await refresh_aggregated_view(db)

    asyncio.create_task(_bootstrap_aggregated_tables())

    await listen_manager.start()
    worker_task = asyncio.create_task(download_coordinator())
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
    await listen_manager.stop()


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
app.include_router(system_categories.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


_frontend_dist = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "dist"
)
if os.path.isdir(_frontend_dist):
    app.mount("/", CacheControlStaticFiles(directory=_frontend_dist, html=True), name="static")
