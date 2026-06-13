import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Site, SystemCategory
import asyncio

import app.services.scheduler as scheduler_module

from app.constants import BATCH_PROBE_LIMIT, BATCH_PROBE_CONCURRENCY
from app.schemas import (
    CategoryMapping, CategoryMappingWithPid, CategoryGroup, SiteCategoriesOut,
    SiteCategoriesFetchOut, SiteCategoriesUpdate,
    SiteCreate, SitePatch, BatchProbeItem, BatchProbeResult, BatchProbeResponse,
    SmartMatchResponse,
    TemplateApplyResponse, TemplatePreviewResponse,
    SiteProbeResult, ProbeSitesBatchRequest,
)
from app.services.health import probe as health_probe
from app.services.source_client import SourceClient
from app.services.smart_matcher import match_site_categories
from app.services.category_mapping import (
    get_site_category_mappings,
    save_site_category_mappings,
)
from app.services.template_manager import apply_template, preview_template, load_templates

router = APIRouter(prefix="/sites", tags=["sites"])
logger = logging.getLogger(__name__)

_SEM = asyncio.Semaphore(BATCH_PROBE_CONCURRENCY)


@router.get("")
async def list_sites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Site).order_by(Site.sort, Site.id))
    return result.scalars().all()


@router.post("")
async def create_site(site: SiteCreate, db: AsyncSession = Depends(get_db)):
    db_site = Site(**site.model_dump())
    db.add(db_site)
    await db.commit()
    await db.refresh(db_site)
    logger.info("site_created site_id=%d name=%s url=%s", db_site.id, site.name, site.base_url)

    # 自动触发智能匹配（高置信度直接保存）
    if db_site.enabled:
        await _auto_match_and_save(db_site, db)

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
    """批量检测已有资源站连通性。不传 site_ids 时检测全部站点。"""
    site_ids = req.site_ids
    if site_ids:
        result = await db.execute(select(Site).where(Site.id.in_(site_ids)))
    else:
        result = await db.execute(select(Site))
    db_sites = result.scalars().all()

    async def _probe_one(site: Site) -> SiteProbeResult:
        async with _SEM:
            r = await health_probe(site_id=site.id, base_url=site.base_url, name=site.name)
        return SiteProbeResult(
            site_id=site.id,
            site_name=site.name,
            url=site.base_url,
            ok=r.ok,
            latency_ms=r.latency_ms,
            error=r.error,
        )

    results = await asyncio.gather(*[_probe_one(site) for site in db_sites])
    logger.info("probe_sites_batch count=%d ok=%d", len(results), sum(1 for r in results if r.ok))
    return results


@router.patch("/{site_id}")
async def update_site(site_id: int, patch: SitePatch, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    was_enabled = db_site.enabled
    for key, value in patch.model_dump(exclude_unset=True).items():
        setattr(db_site, key, value)
    await db.commit()
    await db.refresh(db_site)

    # 站点从禁用变为启用时，后台触发全量刮削即时补全
    if db_site.enabled and not was_enabled and scheduler_module.crawler:
        asyncio.create_task(
            scheduler_module.crawler.trigger_full_crawl(db_site.id)
        )

    return db_site


@router.delete("/{site_id}")
async def delete_site(site_id: int, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    await db.delete(db_site)
    await db.commit()
    logger.info("site_deleted site_id=%d name=%s", site_id, db_site.name)
    return {"ok": True}


@router.post("/{site_id}/probe")
async def probe_site(site_id: int, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    result = await health_probe(
        site_id=db_site.id,
        base_url=db_site.base_url,
        name=db_site.name,
    )
    logger.info("site_probe site_id=%d name=%s ok=%s", db_site.id, db_site.name, result.ok)
    return result


@router.get("/{site_id}/categories")
async def get_site_categories(site_id: int, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    cats = await get_site_category_mappings(db, db_site.id)
    return SiteCategoriesOut(
        site_id=db_site.id,
        categories=[CategoryMapping(**c) for c in cats],
    )


@router.put("/{site_id}/categories")
async def update_site_categories(
    site_id: int,
    body: SiteCategoriesUpdate,
    db: AsyncSession = Depends(get_db),
):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    # AC-002 gap fix: server-side mutual exclusion validation
    seen: dict[str, str] = {}
    for c in body.categories:
        if c.remote_id in seen:
            raise HTTPException(
                status_code=400,
                detail=f"remote_id '{c.remote_id}' 已分配到分类 '{seen[c.remote_id]}'",
            )
        seen[c.remote_id] = c.name

    await save_site_category_mappings(
        db, db_site.id, [c.model_dump() for c in body.categories]
    )
    await db.commit()
    cats = await get_site_category_mappings(db, db_site.id)
    return SiteCategoriesOut(
        site_id=db_site.id,
        categories=[CategoryMapping(**c) for c in cats],
    )


@router.post("/{site_id}/fetch-categories")
async def fetch_remote_categories(site_id: int, db: AsyncSession = Depends(get_db)):
    """从资源站自动拉取分类列表，返回层级分组格式（AC-027）。"""
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    async with SourceClient(
        site_id=db_site.id, base_url=db_site.base_url, name=db_site.name
    ) as client:
        try:
            data = await client._get({"ac": "list"})
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))
    class_list = data.get("class", [])
    if not isinstance(class_list, list):
        raise HTTPException(status_code=502, detail="资源站未返回 class 分类列表")

    # 1. 提取父分类
    parents: dict[str, str] = {}
    for raw in class_list:
        if isinstance(raw, dict):
            type_pid = raw.get("type_pid")
            if type_pid == 0 or type_pid == "0":
                pid = str(raw.get("type_id") or raw.get("id") or "")
                pname = str(raw.get("type_name") or raw.get("name") or "")
                if pid:
                    parents[pid] = pname

    # 2. 按父分类分组子分类
    groups: dict[str | None, list[CategoryMappingWithPid]] = {}
    for raw in class_list:
        if not isinstance(raw, dict):
            continue
        type_pid = raw.get("type_pid")
        if type_pid == 0 or type_pid == "0":
            continue  # 父分类不放入 groups

        remote_id = str(raw.get("type_id") or raw.get("id") or "")
        name = str(raw.get("type_name") or raw.get("name") or "")
        pid_str = str(type_pid) if type_pid is not None else None

        # 如果 type_pid 指向的父分类不存在，归入未分组
        parent_id = pid_str if pid_str in parents else None

        if parent_id not in groups:
            groups[parent_id] = []
        groups[parent_id].append(
            CategoryMappingWithPid(remote_id=remote_id, name=name, type_pid=pid_str)
        )

    # 2b. 智能分组兜底：如果站点没有提供 type_pid 层级（parents 为空），
    # 根据分类名称关键词推断父分类分组
    if not parents and groups.get(None):
        # 定义名称关键词 -> 父分类的映射规则
        _INFER_RULES: list[tuple[str, str, str]] = [
            ("综艺", "综艺", "3"),
            ("动漫", "动漫", "4"),
            ("动画", "动漫", "4"),
            ("短剧", "短剧", "5"),
            ("纪录", "纪录片", "6"),
            ("体育", "体育", "7"),
            ("其他", "其他", "8"),
        ]
        ungrouped = groups.pop(None)
        inferred: dict[str, list[CategoryMappingWithPid]] = {}
        for cat in ungrouped:
            assigned = False
            for keyword, parent_name, virtual_pid in _INFER_RULES:
                if keyword in cat.name:
                    if virtual_pid not in inferred:
                        inferred[virtual_pid] = []
                    inferred[virtual_pid].append(cat)
                    assigned = True
                    break
            if not assigned:
                # 未命中综艺/动漫/短剧/纪录/体育/其他：按「片」vs「剧」区分
                if "剧" in cat.name:
                    if "2" not in inferred:
                        inferred["2"] = []
                    inferred["2"].append(cat)
                elif "片" in cat.name:
                    if "1" not in inferred:
                        inferred["1"] = []
                    inferred["1"].append(cat)
                else:
                    # 兜底：其他
                    if "8" not in inferred:
                        inferred["8"] = []
                    inferred["8"].append(cat)
        # 将推断的分组合并到 groups
        _INFER_PARENTS = {
            "1": "电影",
            "2": "连续剧",
            "3": "综艺",
            "4": "动漫",
            "5": "短剧",
            "6": "纪录片",
            "7": "体育",
            "8": "其他",
        }
        for virtual_pid, cats in inferred.items():
            groups[virtual_pid] = cats
            parents[virtual_pid] = _INFER_PARENTS[virtual_pid]

    # 3. 构建响应
    result_groups: list[CategoryGroup] = []
    for parent_id, cats in groups.items():
        if not cats:
            continue
        result_groups.append(CategoryGroup(
            parent_id=parent_id,
            parent_name=parents.get(parent_id) if parent_id else None,
            categories=cats,
        ))

    # 4. 排序：有 parent_name 的在前，按 parent_name 字母序；无 parent 的在最后
    result_groups.sort(key=lambda g: (g.parent_name is None, g.parent_name or ""))

    logger.info("site_fetch_categories site_id=%d name=%s groups=%d total_categories=%d",
                db_site.id, db_site.name, len(result_groups),
                sum(len(g.categories) for g in result_groups))
    return SiteCategoriesFetchOut(site_id=db_site.id, groups=result_groups)


@router.post("/{site_id}/smart-match")
async def smart_match_categories(site_id: int, db: AsyncSession = Depends(get_db)):
    """对指定站点的远程分类执行智能匹配，返回推荐映射（AC-026）。"""
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    async with SourceClient(
        site_id=db_site.id, base_url=db_site.base_url, name=db_site.name
    ) as client:
        try:
            data = await client._get({"ac": "list"})
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))

    class_list = data.get("class", [])
    if not isinstance(class_list, list) or not class_list:
        raise HTTPException(status_code=502, detail="请先拉取远程分类列表")

    # 读取当前系统分类（子分类）用于动态规则生成
    sys_result = await db.execute(
        select(SystemCategory.name).where(SystemCategory.parent_id.isnot(None))
    )
    system_names = [row[0] for row in sys_result.all()]

    result = match_site_categories(
        site_id=site_id,
        remote_categories=class_list,
        existing_mappings=await get_site_category_mappings(db, db_site.id),
        system_category_names=system_names,
    )
    return result


@router.post("/{site_id}/apply-template")
async def apply_site_template(site_id: int, db: AsyncSession = Depends(get_db)):
    """对指定站点应用分类映射模板（AC-028）。"""
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    # 检查是否有匹配模板
    load_templates(force=True)  # 热更新：每次调用重新加载
    from app.services.template_manager import match_template
    template = match_template(db_site.name, db_site.base_url)
    if not template:
        raise HTTPException(status_code=404, detail="暂无该站点的预设模板")

    async with SourceClient(
        site_id=db_site.id, base_url=db_site.base_url, name=db_site.name
    ) as client:
        try:
            data = await client._get({"ac": "list"})
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))

    class_list = data.get("class", [])
    if not isinstance(class_list, list) or not class_list:
        raise HTTPException(status_code=502, detail="请先拉取远程分类列表")

    result = apply_template(
        site_id=db_site.id,
        site_name=db_site.name,
        site_url=db_site.base_url,
        remote_categories=class_list,
        existing_mappings=await get_site_category_mappings(db, db_site.id),
    )

    if not result.template_matched:
        raise HTTPException(status_code=404, detail="暂无该站点的预设模板")

    return result


@router.get("/{site_id}/template-preview")
async def preview_site_template(site_id: int, db: AsyncSession = Depends(get_db)):
    """预览模板应用结果，不实际修改数据（AC-028）。"""
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    load_templates(force=True)  # 热更新
    from app.services.template_manager import match_template
    template = match_template(db_site.name, db_site.base_url)
    if not template:
        raise HTTPException(status_code=404, detail="暂无该站点的预设模板")

    async with SourceClient(
        site_id=db_site.id, base_url=db_site.base_url, name=db_site.name
    ) as client:
        try:
            data = await client._get({"ac": "list"})
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))

    class_list = data.get("class", [])
    if not isinstance(class_list, list) or not class_list:
        raise HTTPException(status_code=502, detail="请先拉取远程分类列表")

    result = preview_template(
        site_id=db_site.id,
        site_name=db_site.name,
        site_url=db_site.base_url,
        remote_categories=class_list,
        existing_mappings=await get_site_category_mappings(db, db_site.id),
    )

    return result


async def _auto_match_and_save(db_site: Site, db: AsyncSession) -> dict:
    """对新站点自动执行智能匹配，高置信度结果直接保存。
    返回匹配摘要 {total, auto_mapped, suggested, unrecognized}。"""
    try:
        async with SourceClient(
            site_id=db_site.id, base_url=db_site.base_url, name=db_site.name
        ) as client:
            data = await client._get({"ac": "list"})
    except Exception:
        return {"total": 0, "auto_mapped": 0, "suggested": 0, "unrecognized": 0}

    class_list = data.get("class", [])
    if not isinstance(class_list, list) or not class_list:
        return {"total": 0, "auto_mapped": 0, "suggested": 0, "unrecognized": 0}

    # 读取当前系统分类（子分类）用于动态规则生成
    sys_result = await db.execute(
        select(SystemCategory.name).where(SystemCategory.parent_id.isnot(None))
    )
    system_names = [row[0] for row in sys_result.all()]

    result = match_site_categories(
        site_id=db_site.id,
        remote_categories=class_list,
        existing_mappings=await get_site_category_mappings(db, db_site.id),
        system_category_names=system_names,
    )

    # 只保存高置信度（auto_mapped）的结果
    auto_mappings = []
    for m in result.matches:
        if m.status == "auto_mapped" and m.suggested_system_name:
            auto_mappings.append({
                "remote_id": m.remote_id,
                "name": m.suggested_system_name,
            })

    if auto_mappings:
        existing = await get_site_category_mappings(db, db_site.id)
        # 合并：保留已有映射，添加新的 auto_mapped
        existing_ids = {str(c.get("remote_id", "")) for c in existing}
        for am in auto_mappings:
            if am["remote_id"] not in existing_ids:
                existing.append(am)
        await save_site_category_mappings(db, db_site.id, existing)

    summary = result.summary.model_dump()
    logger.info(
        "site_auto_matched site_id=%d name=%s auto=%d suggested=%d unrecognized=%d",
        db_site.id, db_site.name,
        summary.get("auto_mapped", 0),
        summary.get("suggested", 0),
        summary.get("unrecognized", 0),
    )
    return summary


async def _probe_one(item: BatchProbeItem) -> BatchProbeResult:
    url = item.url.strip()
    if not url.startswith(("http://", "https://")):
        return BatchProbeResult(name=item.name, url=url, ok=False, latency_ms=None, error="URL 必须以 http:// 或 https:// 开头", added=False)
    result = await health_probe(site_id=0, base_url=url, name=item.name)
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

    # 获取已有站点（用于去重）
    existing = await db.execute(select(Site))
    existing_sites = existing.scalars().all()
    existing_urls = {s.base_url.rstrip("/") for s in existing_sites}
    existing_names = {s.name for s in existing_sites}

    async def _probe_with_limit(item: BatchProbeItem) -> BatchProbeResult:
        async with _SEM:
            return await _probe_one(item)

    results = await asyncio.gather(*[_probe_with_limit(item) for item in items])

    # 自动添加探测成功的站点
    new_sites: list[Site] = []
    for r in results:
        if r.ok:
            url_normalized = r.url.rstrip("/")
            if url_normalized in existing_urls or r.name in existing_names:
                continue
            db_site = Site(name=r.name, base_url=r.url, enabled=True, sort=0)
            db.add(db_site)
            new_sites.append(db_site)
            existing_urls.add(url_normalized)
            existing_names.add(r.name)

    if new_sites:
        await db.commit()
        # 刷新以获取 id
        for s in new_sites:
            await db.refresh(s)
        # 自动触发智能匹配
        for s in new_sites:
            await _auto_match_and_save(s, db)

    added_urls = {s.base_url.rstrip("/") for s in new_sites}
    added_names = {s.name for s in new_sites}

    # 重新标记 added 字段
    final = []
    for r in results:
        url_normalized = r.url.rstrip("/")
        is_added = r.ok and (url_normalized in added_urls or r.name in added_names)
        final.append(BatchProbeResult(
            name=r.name, url=r.url, ok=r.ok,
            latency_ms=r.latency_ms, error=r.error, added=is_added,
        ))

    logger.info("batch_probe total=%d success=%d added=%d", len(items), sum(1 for r in results if r.ok), len(new_sites))
    return BatchProbeResponse(results=final)
