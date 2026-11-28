import logging

from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, delete, func, desc, Integer, cast
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import async_session_factory, get_db
from app.errors import site_not_found
from app.models import Site, SiteProbeLog, SiteCategoryMapping, _utcnow
import asyncio
import json

import app.services.scheduler as scheduler_module

from app.constants import BATCH_PROBE_LIMIT, BATCH_PROBE_CONCURRENCY, BATCH_PROBE_TIMEOUT
from app.schemas import (
    SiteCreate, SitePatch, BatchProbeItem, BatchProbeResult, BatchProbeResponse,
    SiteProbeResult, ProbeSitesBatchRequest, SiteHealthOut, SiteProbeLogEntry,
    SiteExportOut, SiteExportSite, SiteExportMapping,
    SiteImportIn, SiteImportResult,
)
from app.services.health import probe as health_probe
from app.services.site_urls import site_name_key, site_url_key
from app.services.category_links import refresh_site_remote_categories

router = APIRouter(prefix="/sites", tags=["sites"])
logger = logging.getLogger(__name__)

_SEM = asyncio.Semaphore(BATCH_PROBE_CONCURRENCY)


async def _persist_probe_log(
    site_id: int, ok: bool, error: str | None, latency_ms: int | None
) -> None:
    """把交互探测结果写入健康日志（独立 session；只记录，不触发自动禁用计数）。

    写日志失败不能影响探测响应/流式输出，异常收敛为 warning。
    """
    try:
        async with async_session_factory() as session:
            session.add(
                SiteProbeLog(
                    site_id=site_id,
                    ok=ok,
                    error=error,
                    response_time_ms=latency_ms,
                )
            )
            await session.commit()
    except Exception:
        logger.warning("写入站点探测日志失败 site_id=%d", site_id, exc_info=True)


@router.get("")
async def list_sites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Site).order_by(Site.sort, Site.id))
    return result.scalars().all()


@router.post("")
async def create_site(site: SiteCreate, db: AsyncSession = Depends(get_db)):
    # 判重：API 地址按归一化 key 比较（http/https、末尾斜杠不算不同），
    # 名称先按完全一致、再按去掉图标/标点后的宽松 key 比较
    existing_sites = (await db.execute(select(Site))).scalars().all()
    if any(s.name == site.name for s in existing_sites):
        raise HTTPException(status_code=409, detail=f"站点名称已存在：{site.name}")
    new_key = site_url_key(site.base_url)
    new_name_key = site_name_key(site.name)
    for existing in existing_sites:
        if site_url_key(existing.base_url) == new_key:
            raise HTTPException(
                status_code=409,
                detail=f"该 API 地址已存在：{existing.name}",
            )
        if site_name_key(existing.name) == new_name_key:
            raise HTTPException(
                status_code=409,
                detail=f"站点名称与「{existing.name}」重复（忽略图标/符号）",
            )

    db_site = Site(**site.model_dump())
    db.add(db_site)
    await db.commit()
    await db.refresh(db_site)
    logger.info("site_created site_id=%d name=%s url=%s", db_site.id, site.name, site.base_url)

    # 自动触发智能匹配（高置信度直接保存）
    if db_site.enabled:
        await _sync_site_remote_categories(db_site, db)

    # 新站点启用时，后台触发全量刮削即时补全
    if db_site.enabled and scheduler_module.crawler:
        asyncio.create_task(
            scheduler_module.crawler.trigger_full_crawl(db_site.id)
        )

    return db_site


@router.post("/probe-batch")
async def probe_sites_batch(
    req: ProbeSitesBatchRequest,
    db: AsyncSession = Depends(get_db),
):
    """批量检测已有资源站连通性（NDJSON 流式，每站完成立即返回一行）。

    不传 site_ids 时检测全部站点；空站点集合返回空流。
    """
    site_ids = req.site_ids
    if site_ids:
        result = await db.execute(select(Site).where(Site.id.in_(site_ids)))
    else:
        result = await db.execute(select(Site))
    # 查询后立即记录普通值，流式生成器里不使用请求 db session
    site_infos = [(s.id, s.name, s.base_url) for s in result.scalars().all()]
    logger.info("probe_sites_batch count=%d", len(site_infos))
    return StreamingResponse(
        _probe_batch_stream(site_infos),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "Content-Encoding": "identity",
            "X-Accel-Buffering": "no",
        },
    )


async def _probe_one_bounded(site_id: int, name: str, url: str) -> dict:
    """单站检测：信号量限流 + 有界总超时；异常隔离为 ok=false，取消继续抛出。

    无论 ok 与否都把结果写入健康日志（独立 session，不计入自动禁用），
    持久化失败不影响流式输出。
    """
    try:
        async with _SEM:
            r = await asyncio.wait_for(
                health_probe(
                    site_id=site_id, base_url=url, name=name,
                    max_attempts=1,
                ),
                timeout=BATCH_PROBE_TIMEOUT,
            )
        payload = SiteProbeResult(
            site_id=site_id, site_name=name, url=url,
            ok=r.ok, latency_ms=r.latency_ms, error=r.error,
        ).model_dump()
    except asyncio.CancelledError:
        raise
    except asyncio.TimeoutError:
        payload = SiteProbeResult(
            site_id=site_id, site_name=name, url=url,
            ok=False, latency_ms=None, error="检测超时",
        ).model_dump()
    except Exception:
        logger.exception("site_probe_failed site_id=%d name=%s", site_id, name)
        payload = SiteProbeResult(
            site_id=site_id, site_name=name, url=url,
            ok=False, latency_ms=None, error="检测失败",
        ).model_dump()
    await _persist_probe_log(
        site_id, payload["ok"], payload["error"], payload["latency_ms"]
    )
    return payload


async def _probe_batch_stream(site_infos: list[tuple[int, str, str]]):
    """按完成顺序逐站 yield 一行 NDJSON；清理时取消并等待未完成任务。"""

    async def _line(info: tuple[int, str, str]) -> str:
        payload = await _probe_one_bounded(*info)
        return json.dumps(payload, ensure_ascii=False) + "\n"

    tasks = [asyncio.create_task(_line(info)) for info in site_infos]
    try:
        for future in asyncio.as_completed(tasks):
            yield await future
    finally:
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


@router.patch("/{site_id}")
async def update_site(site_id: int, patch: SitePatch, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise site_not_found(site_id)

    was_enabled = db_site.enabled
    for key, value in patch.model_dump(exclude_unset=True).items():
        setattr(db_site, key, value)
    await db.commit()
    await db.refresh(db_site)

    if "enabled" in patch.model_fields_set:
        from app.api.videos import (
            invalidate_category_filter_cache,
            invalidate_hidden_video_cache,
        )

        invalidate_hidden_video_cache()
        # 统计与分类过滤缓存都依赖站点启用状态
        invalidate_category_filter_cache()

    # 站点从禁用变为启用时，后台触发全量刮削即时补全
    if db_site.enabled and not was_enabled and scheduler_module.crawler:
        asyncio.create_task(
            scheduler_module.crawler.trigger_full_crawl(db_site.id)
        )

    return db_site


@router.delete("/{site_id}")
async def delete_site(site_id: int, db: AsyncSession = Depends(get_db)):
    from app.services.site_deleter import delete_site_background

    db_site = await db.get(Site, site_id)
    if not db_site:
        raise site_not_found(site_id)

    # 标记为删除中并立即返回，实际删除在后台执行
    asyncio.create_task(delete_site_background(site_id, db_site.name))
    logger.info("site_delete_scheduled site_id=%d name=%s", site_id, db_site.name)
    return {"ok": True, "site_id": site_id, "status": "running"}


@router.post("/{site_id}/probe")
async def probe_site(site_id: int, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise site_not_found(site_id)
    result = await health_probe(
        site_id=db_site.id,
        base_url=db_site.base_url,
        name=db_site.name,
    )
    logger.info("site_probe site_id=%d name=%s ok=%s", db_site.id, db_site.name, result.ok)
    # 无论 ok 与否都写入健康日志（只记录，不触发自动禁用计数）
    await _persist_probe_log(db_site.id, result.ok, result.error, result.latency_ms)
    return result


@router.get("/{site_id}/health", response_model=SiteHealthOut)
async def get_site_health(site_id: int, db: AsyncSession = Depends(get_db)):
    """获取站点健康视图：最近探测日志与 24 小时可用率。"""
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise site_not_found(site_id)

    # 最近 50 条探测日志
    logs_result = await db.execute(
        select(SiteProbeLog)
        .where(SiteProbeLog.site_id == site_id)
        .order_by(desc(SiteProbeLog.created_at))
        .limit(50)
    )
    logs = logs_result.scalars().all()

    # 24 小时内可用率
    since_24h = _utcnow() - timedelta(hours=24)
    agg_result = await db.execute(
        select(
            func.count(SiteProbeLog.id).label("total"),
            func.coalesce(
                func.sum(cast(SiteProbeLog.ok, Integer)), 0
            ).label("ok_count"),
        )
        .where(
            SiteProbeLog.site_id == site_id,
            SiteProbeLog.created_at >= since_24h,
        )
    )
    row = agg_result.one_or_none()
    availability = 0.0
    if row and row.total and row.total > 0:
        availability = round(row.ok_count / row.total * 100, 1)

    def _to_entry(log: SiteProbeLog) -> SiteProbeLogEntry:
        return SiteProbeLogEntry(
            id=log.id,
            site_id=log.site_id,
            ok=log.ok,
            error=log.error,
            latency_ms=log.response_time_ms,
            created_at=log.created_at.isoformat() if log.created_at else None,
        )

    return SiteHealthOut(
        site_id=db_site.id,
        site_name=db_site.name,
        enabled=db_site.enabled,
        auto_disabled_at=db_site.auto_disabled_at.isoformat() if db_site.auto_disabled_at else None,
        latest_probe=_to_entry(logs[0]) if logs else None,
        recent_logs=[_to_entry(log) for log in logs],
        availability_24h=availability,
    )


async def _sync_site_remote_categories(db_site: Site, db: AsyncSession) -> dict:
    """新增站点后拉取一次远程分类快照；失败不影响站点创建。"""
    try:
        stats = await refresh_site_remote_categories(db, db_site)
        logger.info(
            "site_remote_categories_synced site_id=%d name=%s stats=%s",
            db_site.id,
            db_site.name,
            stats,
        )
        return stats
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "site_remote_categories_sync_failed site_id=%d name=%s: %s",
            db_site.id,
            db_site.name,
            exc,
        )
        return {"added": 0, "updated": 0, "total": 0}


async def _probe_one(item: BatchProbeItem) -> BatchProbeResult:
    """嗅探单个候选站点：单次尝试 + 有界总预算，超时按失败处理。"""
    url = item.url.strip()
    if not url.startswith(("http://", "https://")):
        return BatchProbeResult(name=item.name, url=url, ok=False, latency_ms=None, error="URL 必须以 http:// 或 https:// 开头", added=False)
    try:
        result = await asyncio.wait_for(
            health_probe(site_id=0, base_url=url, name=item.name, max_attempts=1),
            timeout=BATCH_PROBE_TIMEOUT,
        )
    except asyncio.CancelledError:
        raise
    except asyncio.TimeoutError:
        return BatchProbeResult(
            name=item.name, url=url, ok=False,
            latency_ms=None, error="检测超时", added=False,
        )
    return BatchProbeResult(
        name=item.name, url=url, ok=result.ok,
        latency_ms=result.latency_ms, error=result.error, added=False,
    )


@router.post("/batch-probe")
async def batch_probe(
    items: list[BatchProbeItem],
    db: AsyncSession = Depends(get_db),
):
    if len(items) > BATCH_PROBE_LIMIT:
        raise HTTPException(status_code=400, detail=f"一次最多探测 {BATCH_PROBE_LIMIT} 个站点")

    # 获取已有站点（用于去重）：
    # - 地址按归一化 key 比较，http/https、末尾斜杠不同不算新站；
    # - 名称先比完全一致，再比去掉 🎬/🔞、空格、标点后的宽松 key
    existing = await db.execute(select(Site))
    existing_sites = existing.scalars().all()
    existing_url_keys = {site_url_key(s.base_url): s for s in existing_sites}
    existing_names = {s.name: s for s in existing_sites}
    existing_name_keys = {site_name_key(s.name): s for s in existing_sites}

    async def _probe_with_limit(item: BatchProbeItem) -> BatchProbeResult:
        async with _SEM:
            return await _probe_one(item)

    results = await asyncio.gather(*[_probe_with_limit(item) for item in items])

    # 自动添加探测成功的站点；命中去重的记录跳过原因
    new_sites: list[Site] = []
    added_indexes: set[int] = set()
    skip_reasons: dict[int, str] = {}
    for index, r in enumerate(results):
        if not r.ok:
            continue
        url_key = site_url_key(r.url)
        name_key = site_name_key(r.name)
        hit = (
            existing_url_keys.get(url_key)
            or existing_names.get(r.name)
            or existing_name_keys.get(name_key)
        )
        if hit is not None:
            skip_reasons[index] = f"已存在：{hit.name}"
            continue
        db_site = Site(name=r.name, base_url=r.url, enabled=True, sort=0)
        db.add(db_site)
        new_sites.append(db_site)
        added_indexes.add(index)
        existing_url_keys[url_key] = db_site
        existing_names[r.name] = db_site
        existing_name_keys[name_key] = db_site

    if new_sites:
        await db.commit()
        # 刷新以获取 id
        for s in new_sites:
            await db.refresh(s)
        # 自动触发智能匹配
        for s in new_sites:
            await _sync_site_remote_categories(s, db)
        # 嗅探添加的站点与单站添加一致：立即提交全量刮削（lifecycle），
        # 不再出现「嗅探添加后没有刮削」的不一致
        await _submit_lifecycle_crawl(new_sites)

    # 重新标记 added 字段；跳过的给出「已存在：谁」，不再只显示泛泛的「已存在」
    final = []
    for index, r in enumerate(results):
        is_added = index in added_indexes
        skip_reason = skip_reasons.get(index)
        final.append(BatchProbeResult(
            name=r.name, url=r.url, ok=r.ok,
            latency_ms=r.latency_ms,
            error=skip_reason or r.error,
            added=is_added,
        ))

    # 记录一次站点嗅探历史（统一维护任务 site.discover，短任务 run 等待落库）；
    # 记录失败不影响已经完成的探测与添加
    try:
        from app.services.maintenance import maintenance_coordinator

        results_payload = [r.model_dump() for r in final]

        async def _record(ctx):
            return {"details": {"results": results_payload}}

        await maintenance_coordinator.run(
            "site.discover", _record, trigger="manual"
        )
    except Exception:
        logger.exception("记录站点嗅探历史失败")

    logger.info("batch_probe total=%d success=%d added=%d", len(items), sum(1 for r in results if r.ok), len(new_sites))
    return BatchProbeResponse(results=final)


async def _submit_lifecycle_crawl(new_sites: list[Site]) -> None:
    """为嗅探添加的站点提交全量刮削（lifecycle）。

    crawl.full 是全局同类型去重：单站走 trigger_full_crawl，多站合并为
    一个带站点集合的任务，避免后续站点被去重丢弃而漏抓。
    """
    if scheduler_module.crawler is None:
        logger.info("crawler 未运行，嗅探添加的 %d 个站点留待启动刮削", len(new_sites))
        return
    crawler = scheduler_module.crawler
    try:
        if len(new_sites) == 1:
            await crawler.trigger_full_crawl(new_sites[0].id)
            return

        from app.services.maintenance import maintenance_coordinator

        new_ids = [s.id for s in new_sites]

        async def _batch_full(ctx, _ids: list[int] = new_ids):
            active = scheduler_module.crawler
            if active is None:
                return {"state": "skipped", "error": "刮削器未运行"}
            return await active.run_full_crawl(
                site_ids=_ids,
                stop_event=ctx.cancel_event,
                progress=ctx.progress,
            )

        job = await maintenance_coordinator.submit(
            "crawl.full", _batch_full, trigger="lifecycle"
        )
        if job.get("deduplicated"):
            logger.info(
                "嗅探添加的 %d 个站点全量刮削被去重：已有任务 %s 在运行",
                len(new_ids),
                job["id"],
            )
        else:
            logger.info(
                "嗅探添加的 %d 个站点已提交全量刮削 job=%s", len(new_ids), job["id"]
            )
    except Exception:
        logger.exception("提交嗅探站点全量刮削失败")


@router.get("/export", response_model=SiteExportOut)
async def export_sites(db: AsyncSession = Depends(get_db)):
    """导出所有站点及其分类映射，用于迁移到其他环境。"""
    result = await db.execute(select(Site).order_by(Site.sort, Site.id))
    sites = result.scalars().all()

    exported_sites = []
    for site in sites:
        mappings_result = await db.execute(
            select(SiteCategoryMapping)
            .where(SiteCategoryMapping.site_id == site.id)
            .order_by(SiteCategoryMapping.remote_id)
        )
        mappings = mappings_result.scalars().all()
        exported_sites.append(SiteExportSite(
            name=site.name,
            base_url=site.base_url,
            enabled=site.enabled,
            sort=site.sort,
            categories=site.categories,
            mappings=[
                SiteExportMapping(
                    remote_id=m.remote_id,
                    remote_name=m.remote_name,
                    system_name=m.system_name,
                    enabled=m.enabled,
                )
                for m in mappings
            ],
        ))

    return SiteExportOut(
        exported_at=_utcnow().isoformat(),
        sites=exported_sites,
    )


@router.post("/import", response_model=SiteImportResult)
async def import_sites(req: SiteImportIn, db: AsyncSession = Depends(get_db)):
    """从导出的 JSON 导入站点及其分类映射。"""
    if req.mode not in {"skip", "overwrite"}:
        raise HTTPException(status_code=400, detail="mode 必须是 skip 或 overwrite")

    # 预加载现有站点用于去重
    existing_result = await db.execute(select(Site))
    existing_sites = existing_result.scalars().all()
    existing_by_name = {s.name: s for s in existing_sites}
    existing_by_url = {site_url_key(s.base_url): s for s in existing_sites}

    result = SiteImportResult()

    for item in req.sites:
        try:
            url_key = site_url_key(item.base_url)
            existing = existing_by_name.get(item.name) or existing_by_url.get(url_key)

            if existing and req.mode == "skip":
                result.skipped += 1
                continue

            if existing and req.mode == "overwrite":
                existing.name = item.name
                existing.base_url = item.base_url
                existing.enabled = item.enabled
                existing.sort = item.sort
                existing.categories = item.categories
                db_site = existing
                existing_by_url[url_key] = db_site
                # 删除旧映射，后续重建
                await db.execute(
                    delete(SiteCategoryMapping).where(
                        SiteCategoryMapping.site_id == db_site.id
                    )
                )
                result.updated += 1
            else:
                db_site = Site(
                    name=item.name,
                    base_url=item.base_url,
                    enabled=item.enabled,
                    sort=item.sort,
                    categories=item.categories,
                )
                db.add(db_site)
                await db.flush()
                await db.refresh(db_site)
                existing_by_name[db_site.name] = db_site
                existing_by_url[site_url_key(db_site.base_url)] = db_site
                result.created += 1

            # 重建分类映射
            if item.mappings:
                seen_remote_ids = set()
                for m in item.mappings:
                    if m.remote_id in seen_remote_ids:
                        continue
                    seen_remote_ids.add(m.remote_id)
                    db.add(SiteCategoryMapping(
                        site_id=db_site.id,
                        remote_id=m.remote_id,
                        remote_name=m.remote_name,
                        system_name=m.system_name,
                        enabled=m.enabled,
                    ))
        except Exception as exc:
            logger.exception("site_import_failed name=%s", item.name)
            result.errors.append(f"{item.name}: {exc}")

    await db.commit()
    logger.info(
        "sites_import created=%d updated=%d skipped=%d errors=%d",
        result.created, result.updated, result.skipped, len(result.errors),
    )
    return result
