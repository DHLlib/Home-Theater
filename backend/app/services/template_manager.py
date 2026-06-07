"""AC-028 分类映射模板管理器。

模板数据从 backend/data/category_templates.json 加载，支持热更新。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from app.schemas import (
    CategoryMapping,
    CategoryTemplate,
    TemplateApplyResponse,
    TemplateApplySkipped,
    TemplateApplyUnrecognized,
    TemplateApplySummary,
    TemplatePreviewItem,
    TemplatePreviewResponse,
)

logger = logging.getLogger(__name__)

_TEMPLATES: list[CategoryTemplate] | None = None
_TEMPLATE_FILE = Path(__file__).parent.parent.parent / "data" / "category_templates.json"


def load_templates(force: bool = False) -> list[CategoryTemplate]:
    """加载模板配置文件，结果缓存到内存。

    Args:
        force: 是否强制重新读取文件（用于热更新）

    Returns:
        模板列表，加载失败时返回空列表
    """
    global _TEMPLATES
    if _TEMPLATES is not None and not force:
        return _TEMPLATES

    if not _TEMPLATE_FILE.exists():
        logger.warning("category_templates.json not found at %s", _TEMPLATE_FILE)
        _TEMPLATES = []
        return _TEMPLATES

    try:
        with open(_TEMPLATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        templates = []
        for t in data.get("templates", []):
            templates.append(CategoryTemplate(**t))

        _TEMPLATES = templates
        logger.info("Loaded %d category templates", len(templates))
        return templates
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.error("Failed to load category_templates.json: %s", exc)
        _TEMPLATES = []
        return _TEMPLATES


def match_template(site_name: str, site_url: str) -> CategoryTemplate | None:
    """按优先级匹配模板：URL 关键词 > 站点名称关键词。

    Args:
        site_name: 站点名称
        site_url: 站点 URL

    Returns:
        匹配到的模板，无匹配时返回 None
    """
    templates = load_templates()
    site_url_lower = site_url.lower()
    site_name_lower = site_name.lower()

    for template in templates:
        # URL 匹配（最高优先级）
        for kw in template.match_rules.url_keywords:
            if kw.lower() in site_url_lower:
                return template
        # 名称匹配
        for kw in template.match_rules.site_name_keywords:
            if kw.lower() in site_name_lower:
                return template

    return None


def apply_template(
    site_id: int,
    site_name: str,
    site_url: str,
    remote_categories: list[dict],
    existing_mappings: list[dict],
) -> TemplateApplyResponse:
    """应用模板到指定站点，返回变更详情（不实际修改数据库）。

    Args:
        site_id: 站点 ID
        site_name: 站点名称（用于模板匹配）
        site_url: 站点 URL（用于模板匹配）
        remote_categories: 资源站返回的 class 列表
        existing_mappings: 当前已保存的映射列表

    Returns:
        TemplateApplyResponse: 应用结果
    """
    template = match_template(site_name, site_url)
    if not template:
        return TemplateApplyResponse(
            site_id=site_id,
            template_matched=False,
            template_name=None,
            applied=[],
            skipped=[],
            unrecognized=[],
            summary=TemplateApplySummary(
                total_in_template=0,
                applied_count=0,
                skipped_count=0,
                unrecognized_count=0,
            ),
        )

    # 构建已映射 lookup: remote_id -> system_name
    existing_map: dict[str, str] = {}
    for m in existing_mappings:
        rid = str(m.get("remote_id", ""))
        if rid:
            existing_map[rid] = m.get("name", "")

    # 站点实际分类 lookup（只取子分类）
    remote_map: dict[str, str] = {}
    for raw in remote_categories:
        if not isinstance(raw, dict):
            continue
        type_pid = raw.get("type_pid")
        if type_pid == 0 or type_pid == "0":
            continue
        rid = str(raw.get("type_id") or raw.get("id") or "")
        name = str(raw.get("type_name") or raw.get("name") or "")
        if rid:
            remote_map[rid] = name

    applied: list[CategoryMapping] = []
    skipped: list[TemplateApplySkipped] = []
    unrecognized: list[TemplateApplyUnrecognized] = []

    # 遍历模板映射
    for remote_id, system_name in template.mappings.items():
        if remote_id not in remote_map:
            # 模板中有但站点实际没有该分类 -> 忽略
            continue

        remote_name = remote_map[remote_id]

        if remote_id in existing_map:
            skipped.append(TemplateApplySkipped(
                remote_id=remote_id,
                name=remote_name,
                reason="already_mapped",
                existing_system_name=existing_map[remote_id],
            ))
        else:
            applied.append(CategoryMapping(
                remote_id=remote_id,
                name=system_name,
            ))

    # 站点实际分类中模板未覆盖的 -> unrecognized
    template_remote_ids = set(template.mappings.keys())
    for rid, rname in remote_map.items():
        if rid not in template_remote_ids:
            unrecognized.append(TemplateApplyUnrecognized(
                remote_id=rid,
                name=rname,
            ))

    return TemplateApplyResponse(
        site_id=site_id,
        template_matched=True,
        template_name=template.name,
        applied=applied,
        skipped=skipped,
        unrecognized=unrecognized,
        summary=TemplateApplySummary(
            total_in_template=len(template.mappings),
            applied_count=len(applied),
            skipped_count=len(skipped),
            unrecognized_count=len(unrecognized),
        ),
    )


def preview_template(
    site_id: int,
    site_name: str,
    site_url: str,
    remote_categories: list[dict],
    existing_mappings: list[dict],
) -> TemplatePreviewResponse:
    """预览模板应用结果，不实际修改数据。

    Args:
        site_id: 站点 ID
        site_name: 站点名称
        site_url: 站点 URL
        remote_categories: 资源站返回的 class 列表
        existing_mappings: 当前已保存的映射列表

    Returns:
        TemplatePreviewResponse: 预览结果
    """
    result = apply_template(
        site_id=site_id,
        site_name=site_name,
        site_url=site_url,
        remote_categories=remote_categories,
        existing_mappings=existing_mappings,
    )

    if not result.template_matched:
        return TemplatePreviewResponse(
            site_id=site_id,
            template_matched=False,
            template_name=None,
            would_apply=0,
            would_skip=0,
            would_unrecognized=0,
            preview=[],
        )

    preview: list[TemplatePreviewItem] = []
    for item in result.applied:
        preview.append(TemplatePreviewItem(
            remote_id=item.remote_id,
            name=item.name,
            action="apply",
        ))
    for item in result.skipped:
        preview.append(TemplatePreviewItem(
            remote_id=item.remote_id,
            name=item.name,
            action="skip",
            existing=item.existing_system_name,
        ))

    return TemplatePreviewResponse(
        site_id=site_id,
        template_matched=True,
        template_name=result.template_name,
        would_apply=len(result.applied),
        would_skip=len(result.skipped),
        would_unrecognized=len(result.unrecognized),
        preview=preview,
    )
