import asyncio
import logging
import time
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response

from app.api import category_aliases, favorites, downloads, play, progress, settings_api, sites, sse, system_categories, videos
from app.config import settings
from app.db import async_session_factory, engine, init_db
from app.errors import ApiError, api_error_handler, generic_exception_handler, http_exception_handler
from app.logging_config import setup_logging
from app.services.downloader import download_coordinator
from app.services.scheduler import init_scheduler
from app.services.listen_manager import listen_manager
from app.services.tls import get_ssl_context
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

# 后补的两大类：已有数据库也要补齐，所以单独放一份并做幂等迁移。
# 体育/短剧是采集源里真实存在、但早期系统分类没覆盖的内容类型。
LATE_SYSTEM_CATEGORIES = [
    ("体育", 6, [
        ("足球", 1),
        ("篮球", 2),
        ("综合体育", 3),
    ]),
    ("短剧", 7, [
        ("古装短剧", 1),
        ("都市短剧", 2),
        ("穿越短剧", 3),
        ("恋爱短剧", 4),
        ("其他短剧", 5),
    ]),
]


async def check_db_connection() -> None:
    """启动前检查数据库连通性，graceful 启动。"""
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))


async def _init_default_categories():
    """首次启动时自动创建默认系统分类（含后来补的体育/短剧）。"""
    from sqlalchemy import select
    from app.models import SystemCategory
    from app.db import async_session_factory

    async with async_session_factory() as db:
        result = await db.execute(select(SystemCategory).limit(1))
        if result.scalar_one_or_none():
            return  # 已有数据，跳过

        for parent_name, parent_sort, children in (
            DEFAULT_SYSTEM_CATEGORIES + LATE_SYSTEM_CATEGORIES
        ):
            parent = SystemCategory(name=parent_name, sort=parent_sort)
            db.add(parent)
            await db.flush()  # 获取 parent.id
            for child_name, child_sort in children:
                db.add(SystemCategory(name=child_name, parent_id=parent.id, sort=child_sort))
        await db.commit()


async def _ensure_late_categories() -> int:
    """幂等补齐后来新增的系统分类族（体育 / 短剧）。

    只补缺失项，不重建、不改名、不复活用户删掉的旧分类。
    返回新增的分类数量（供调用方决定是否重跑别名播种）。
    """
    from sqlalchemy import select
    from app.models import SystemCategory
    from app.db import async_session_factory

    log = logging.getLogger(__name__)
    async with async_session_factory() as db:
        rows = (await db.execute(select(SystemCategory))).scalars().all()
        if not rows:
            return 0  # 空库交给 _init_default_categories

        added = 0
        for parent_name, parent_sort, children in LATE_SYSTEM_CATEGORIES:
            parent = next(
                (r for r in rows if r.parent_id is None and r.name == parent_name),
                None,
            )
            if parent is None:
                parent = SystemCategory(name=parent_name, sort=parent_sort)
                db.add(parent)
                await db.flush()
                rows.append(parent)
                added += 1

            existing_children = {r.name for r in rows if r.parent_id == parent.id}
            for child_name, child_sort in children:
                if child_name in existing_children:
                    continue
                db.add(
                    SystemCategory(
                        name=child_name, parent_id=parent.id, sort=child_sort
                    )
                )
                added += 1

        if added:
            await db.commit()
            log.info("补全系统分类 %d 个（体育 / 短剧）", added)
        return added


async def _fix_postgres_sequences() -> None:
    """修复 PostgreSQL 自增序列与表数据不同步的问题（常见于手动导入/迁移数据后）。"""
    if "postgresql" not in settings.database_url.lower():
        return

    from sqlalchemy import text
    from app.models import Base
    from app.db import engine

    logger = logging.getLogger(__name__)
    fixed: list[str] = []
    async with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if "id" not in table.columns:
                continue
            try:
                seq_row = await conn.execute(
                    text(
                        "SELECT pg_get_serial_sequence(:table_name, 'id') AS seq_name"
                    ),
                    {"table_name": table.name},
                )
                seq_name = seq_row.scalar()
                if not seq_name:
                    continue
                max_row = await conn.execute(
                    text(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table.name}")
                )
                next_val = max_row.scalar()
                await conn.execute(
                    text("SELECT setval(:seq_name, :next_val, false)"),
                    {"seq_name": seq_name, "next_val": next_val},
                )
                fixed.append(f"{table.name}({seq_name}={next_val})")
            except Exception as exc:
                logger.warning(f"同步 {table.name} 序列失败: {exc}")
    if fixed:
        logger.info("PostgreSQL 自增序列已同步: " + ", ".join(fixed))
    else:
        logger.info("PostgreSQL 自增序列无需同步")


async def _ensure_pg_trgm_indexes() -> None:
    """为搜索的 ILIKE 查询创建 pg_trgm GIN 索引（仅 PostgreSQL）。

    搜索走 VideoCache.title.ilike('%kw%')，前置通配在大表上必然全表扫描；
    pg_trgm + GIN 索引能让 PG 自动加速该模式。DDL 幂等，启动时执行一次即可。
    """
    if "postgresql" not in settings.database_url.lower():
        return

    from sqlalchemy import text
    from app.db import engine

    logger = logging.getLogger(__name__)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_video_cache_title_trgm "
                    "ON video_cache USING gin (title gin_trgm_ops)"
                )
            )
            # 搜索改走聚合表（18 万行 vs video_cache 中的冗余副本），同样需要 trgm 索引
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_aggregated_videos_title_trgm "
                    "ON aggregated_videos USING gin (title gin_trgm_ops)"
                )
            )
            # 分类分页：按分类 + 最新排序取前 N，缺这个复合索引会沿「最新」索引
            # 扫过大量不匹配的行（实测 67ms → 1ms 级别）
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_aggregated_videos_cat_updated "
                    "ON aggregated_videos (system_category, latest_updated_at DESC)"
                )
            )
            # 1–2 字搜索走 lower(title) LIKE 'kw%'，需要 text_pattern_ops 才能用上索引
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_aggregated_videos_title_lower_pattern "
                    "ON aggregated_videos (lower(title) text_pattern_ops)"
                )
            )
        logger.info("pg_trgm 标题索引已就绪")
    except Exception as exc:
        logger.warning(f"创建 pg_trgm 标题索引失败: {exc}")


async def _ensure_progress_unique_index() -> None:
    """把 play_progress 的 (title, year) 唯一索引升级为 NULLS NOT DISTINCT。

    旧约束对 year IS NULL 不生效（NULL 互不相等），无年份的片每次上报都会新插入
    一行，攒出重复后 GET /api/progress 的 scalar_one_or_none 直接 500。
    PG 15+ 支持 NULLS NOT DISTINCT，这里幂等地补一次：先去重，再重建索引。
    """
    if "postgresql" not in settings.database_url.lower():
        return

    from sqlalchemy import text

    log = logging.getLogger(__name__)
    try:
        async with engine.begin() as conn:
            flag = await conn.execute(
                text(
                    "SELECT i.indnullsnotdistinct FROM pg_index i "
                    "JOIN pg_class c ON c.oid = i.indexrelid "
                    "WHERE c.relname = 'uix_progress_title_year'"
                )
            )
            row = flag.first()
            if row is not None and row[0]:
                return

            # 保留每个 (title, year) 的最新一行
            deleted = await conn.execute(
                text(
                    "DELETE FROM play_progress a USING play_progress b "
                    "WHERE a.title = b.title "
                    "AND a.year IS NOT DISTINCT FROM b.year "
                    "AND (a.updated_at < b.updated_at "
                    "     OR (a.updated_at = b.updated_at AND a.id < b.id))"
                )
            )
            await conn.execute(
                text(
                    "ALTER TABLE play_progress "
                    "DROP CONSTRAINT IF EXISTS uix_progress_title_year"
                )
            )
            await conn.execute(text("DROP INDEX IF EXISTS uix_progress_title_year"))
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX uix_progress_title_year "
                    "ON play_progress (title, year) NULLS NOT DISTINCT"
                )
            )
        log.info(
            "play_progress 唯一索引已升级为 NULLS NOT DISTINCT（清理重复 %s 行）",
            deleted.rowcount,
        )
    except Exception as exc:
        log.warning(f"升级 play_progress 唯一索引失败: {exc}")


async def _ensure_aggregate_category_column() -> None:
    """给 aggregated_videos 增加 system_category 列并回填（幂等）。"""
    from sqlalchemy import text

    from app.db import engine
    from app.services.category_alias import backfill_video_categories

    log = logging.getLogger(__name__)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "ALTER TABLE aggregated_videos "
                    "ADD COLUMN IF NOT EXISTS system_category VARCHAR"
                )
            )
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_aggregated_videos_category "
                    "ON aggregated_videos (system_category)"
                )
            )
        async with async_session_factory() as db:
            filled = await backfill_video_categories(db)
        if filled:
            log.info("视频级分类回填 %d 条", filled)
    except Exception as exc:
        log.warning(f"初始化视频级分类失败: {exc}")


async def _ensure_category_aliases(force: bool = False) -> None:
    """首次启动时把现有「站点 × 远程分类」映射聚合成全局别名（幂等）。

    之后新增站点命中别名即自动生效，无需再逐站点配置。
    force=True 时即使已有别名也重跑（新增系统分类后需要）。
    """
    from sqlalchemy import func, select

    from app.models import CategoryAlias
    from app.services.category_alias import seed_aliases_from_data

    log = logging.getLogger(__name__)
    try:
        async with async_session_factory() as db:
            if not force:
                count = (
                    await db.execute(select(func.count()).select_from(CategoryAlias))
                ).scalar_one()
                if count > 0:
                    return
            summary = await seed_aliases_from_data(db)
        log.info("首次生成分类别名: %s", summary)
    except Exception as exc:
        log.warning(f"生成分类别名失败: {exc}")


def _maybe_enable_stack_dump() -> None:
    """调试开关：DEBUG_LOOP_LAG=1 时每 3 秒 dump 所有线程栈，用于定位事件循环卡顿。

    faulthandler 的看门狗是独立线程，即使主线程卡在 C 调用里也能抓到栈。
    """
    if os.environ.get("DEBUG_LOOP_LAG") != "1":
        return
    import faulthandler
    import sys

    faulthandler.dump_traceback_later(3, repeat=True, file=sys.stderr)


async def _loop_lag_watchdog(threshold: float = 2.0) -> None:
    """事件循环卡顿看门狗：正常 1 秒一跳，超出阈值就告警。

    网络/数据库都是 await，不该卡住循环；一旦出现数秒级 lag，说明有同步代码
    在阻塞（历史问题：Windows 上大量连接重置时 Proactor 的 shutdown 会卡住）。
    """
    log = logging.getLogger(__name__)
    last = time.monotonic()
    while True:
        await asyncio.sleep(1.0)
        now = time.monotonic()
        lag = now - last - 1.0
        last = now
        if lag >= threshold:
            log.warning("event_loop_lag %.1fs", lag)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    # 启动时先把 TLS 上下文建好：Windows 上首次建上下文可能要几秒到几十秒，
    # 放在请求路径里会直接卡住事件循环（曾导致整站 45 秒无响应）。
    await asyncio.to_thread(get_ssl_context)
    await check_db_connection()
    await init_db()
    await _fix_postgres_sequences()
    await _ensure_progress_unique_index()
    await _ensure_category_aliases()
    await _ensure_aggregate_category_column()
    await _ensure_pg_trgm_indexes()
    async with async_session_factory() as db:
        await migrate_categories_to_mapping_table(db)
        await migrate_video_cache_norm_title(db)
    await _init_default_categories()
    added_categories = await _ensure_late_categories()
    if added_categories:
        # 新增了系统分类（体育/短剧）→ 立刻重跑一次别名播种，
        # 让原本「目标分类不存在」而被跳过的远程类名能落到新分类上。
        await _ensure_category_aliases(force=True)

    # Phase 2: 首次启动或表为空时，后台重建聚合中间表
    async def _bootstrap_aggregated_tables():
        try:
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
        except Exception:
            logging.getLogger(__name__).exception("后台聚合中间表重建失败")

    asyncio.create_task(_bootstrap_aggregated_tables())
    _maybe_enable_stack_dump()
    loop_lag_task = asyncio.create_task(_loop_lag_watchdog())

    await listen_manager.start()
    sse.reset_streams()
    worker_task = asyncio.create_task(download_coordinator())
    scheduler_task = await init_scheduler()
    yield
    # 先让 SSE 流退出，否则 uvicorn 会一直等这条永不结束的响应
    sse.shutdown_streams()
    worker_task.cancel()
    scheduler_task.cancel()
    loop_lag_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass
    try:
        await loop_lag_task
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
                # 旧 index.html（浏览器/云加速缓存了 HTML）会去要已经被构建删掉的 chunk。
                # 这时不返回 404，而是回一段自愈脚本：清缓存参数重载一次，把用户拉回新版本。
                # 必须带 no-store，否则这段脚本本身也会被缓存住。
                # 注意：挂载在 "/" 时 path 可能带前导斜杠；Windows 上还可能被 normpath
                # 换成反斜杠，这里统一归一化后再判断。
                rel = path.replace("\\", "/").lstrip("/")
                if rel.startswith("assets/") and rel.endswith((".js", ".mjs")):
                    return Response(
                        content=(
                            "(function(){"
                            'var k="ht-missing-asset",n=0;'
                            'try{n=Number(sessionStorage.getItem(k)||0);}catch(e){}'
                            "if(Date.now()-n<15000){return;}"
                            "try{sessionStorage.setItem(k,String(Date.now()));}catch(e){}"
                            "try{var u=new URL(location.href);"
                            'u.searchParams.set("_r",String(Date.now()));'
                            "location.replace(u.toString());}catch(e){location.reload();}"
                            "})();"
                        ),
                        media_type="text/javascript",
                        headers={
                            "Cache-Control": "no-store, must-revalidate",
                            "Pragma": "no-cache",
                            "Expires": "0",
                        },
                    )
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

# 注册全局异常处理器（顺序：先具体后通用）
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

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
app.include_router(category_aliases.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


_frontend_dist = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "dist"
)
if os.path.isdir(_frontend_dist):
    app.mount("/", CacheControlStaticFiles(directory=_frontend_dist, html=True), name="static")
