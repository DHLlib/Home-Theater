# AC-028 分类映射模板预设 — 架构设计文档

## 文档信息

| 字段 | 值 |
|---|---|
| AC 编号 | AC-028 |
| 标题 | 分类映射模板预设 |
| 状态 | 架构设计 |
| 依赖 | AC-002（互斥约束）、AC-026（智能分类映射，可选） |
| 冲突关注 | AC-026（同改 CategorySettings）、AC-027（同改 CategorySettings） |

---

## 1. 组件拆分图

```
CategorySettings (容器)
├── CategorySettingsToolbar
│   ├── [重新拉取各站分类]
│   ├── [加载默认分类]
│   ├── [自动匹配]              ← AC-026
│   ├── [一键应用常见映射 ▼]     ← AC-028 触发入口
│   │   ├── 子菜单: [预览并应用]
│   │   └── 子菜单: [直接应用]
│   └── [保存映射]
├── SiteTabs
└── SiteCategoryPanel
    └── ... (AC-027 层级展示)

TemplateApplyModal (新增) — AC-028 专用
├── 模板匹配信息 (template_name)
├── 变更摘要统计卡片
│   ├── 新增映射数 (绿色)
│   ├── 跳过数 (蓝色)
│   └── 未识别数 (灰色)
├── 详情列表 (Tab 切换)
│   ├── applied 列表
│   ├── skipped 列表 (带原因)
│   └── unrecognized 列表
├── [使用智能匹配填充未识别] 按钮  ← 联动 AC-026
└── [确认应用] / [取消] 按钮
```

### AC-028 独占边界

AC-028 只新增以下前端组件：
- `TemplateApplyModal.tsx` — 模板应用结果确认弹窗
- `useTemplateMatch.ts` — 模板匹配状态 Hook

AC-028 不修改：
- CategorySettings 容器结构（由 AC-027 重构）
- SiteCategoryPanel 内部布局（由 AC-027 负责）
- 互斥约束逻辑（AC-002 已有）

---

## 2. 数据流图

### 2.1 模板应用流程

```
用户点击 [一键应用常见映射]
    │
    ▼
前端: GET /api/sites/{site_id}/template-preview（可选预览）
    │   或 POST /api/sites/{site_id}/apply-template（直接应用）
    │
    ▼
后端: app/services/template_manager.py
    │
    ├── 读取 backend/data/category_templates.json
    ├── match_template(site):
    │     ├── URL 关键词匹配（最高优先级）
    │     └── 站点名称关键词匹配
    ├── 若未匹配 → 返回 404
    └── 若匹配:
          ├── 读取站点当前已保存映射
          ├── 遍历模板 mappings:
          │     ├── remote_id 不在站点实际分类中? → 忽略
          │     ├── remote_id 已映射? → 加入 skipped
          │     └── remote_id 未映射? → 加入 applied
          └── 站点实际分类中模板未覆盖的 → 加入 unrecognized
    │
    ▼
后端返回 TemplateApplyResponse / TemplatePreviewResponse
    │
    ▼
前端展示 TemplateApplyModal:
    ├── 展示 summary 统计
    ├── 用户可查看 applied/skipped/unrecognized 详情
    ├── 用户可点击 [使用智能匹配填充未识别] → 调用 AC-026 smart-match
    └── 用户点击 [确认应用]
    │
    ▼
前端: 更新本地 rows/occupancy 状态（与 AC-026 应用逻辑共用）
    │
    ▼
用户点击 [保存映射] → PUT /categories
```

### 2.2 模板数据加载流程

```
后端启动时:
    │
    ▼
app/services/template_manager.py::load_templates()
    ├── 读取 backend/data/category_templates.json
    ├── 解析 JSON，验证结构
    ├── 若格式错误 → 记录 error 日志，templates = []
    └── 若成功 → 缓存到模块级变量 _TEMPLATES
    │
    ▼
运行期间:
    ├── apply-template / template-preview 请求 → 直接读内存缓存
    └── 文件修改后? → 下次请求重新加载（或提供 reload 接口）
```

---

## 3. 新增/修改文件清单

### 后端

| 文件 | 动作 | 说明 |
|---|---|---|
| `backend/data/category_templates.json` | 新增 | 模板配置文件 |
| `backend/app/services/template_manager.py` | 新增 | 模板加载、匹配、应用逻辑 |
| `backend/app/schemas.py` | 修改 | 新增 Template* schema |
| `backend/app/api/sites.py` | 修改 | 新增 apply-template、template-preview 端点 |

### 前端

| 文件 | 动作 | 说明 |
|---|---|---|
| `frontend/src/types.ts` | 修改 | 新增 TemplateApply* 类型 |
| `frontend/src/api/sites.ts` | 修改 | 新增 applyTemplate、previewTemplate API |
| `frontend/src/components/category-settings/TemplateApplyModal.tsx` | 新增 | 模板应用确认弹窗 |
| `frontend/src/components/category-settings/useTemplateMatch.ts` | 新增 | 模板应用状态管理 Hook |
| `frontend/src/components/category-settings/CategorySettingsToolbar.tsx` | 修改 | 新增 [一键应用常见映射] 按钮 |

---

## 4. 接口详细定义

### 4.1 后端 Pydantic Schema（新增）

```python
# backend/app/schemas.py

class TemplateMatchRules(BaseModel):
    site_name_keywords: list[str]
    url_keywords: list[str]


class CategoryTemplate(BaseModel):
    name: str
    match_rules: TemplateMatchRules
    mappings: dict[str, str]  # remote_id -> system_name


class TemplateApplyItem(BaseModel):
    remote_id: str
    name: str


class TemplateApplySkipped(BaseModel):
    remote_id: str
    name: str
    reason: str  # "already_mapped"
    existing_system_name: str


class TemplateApplyUnrecognized(BaseModel):
    remote_id: str
    name: str


class TemplateApplySummary(BaseModel):
    total_in_template: int
    applied_count: int
    skipped_count: int
    unrecognized_count: int


class TemplateApplyResponse(BaseModel):
    site_id: int
    template_matched: bool
    template_name: str | None
    applied: list[TemplateApplyItem]
    skipped: list[TemplateApplySkipped]
    unrecognized: list[TemplateApplyUnrecognized]
    summary: TemplateApplySummary


class TemplatePreviewResponse(BaseModel):
    site_id: int
    template_matched: bool
    template_name: str | None
    would_apply: int
    would_skip: int
    would_unrecognized: int
    preview: list[dict]  # {remote_id, name, action: "apply"|"skip", existing?: str}
```

### 4.2 模板管理器

```python
# backend/app/services/template_manager.py

import json
import logging
from pathlib import Path

from app.schemas import CategoryTemplate, TemplateApplyResponse, TemplateApplyItem
from app.schemas import TemplateApplySkipped, TemplateApplyUnrecognized, TemplateApplySummary

logger = logging.getLogger(__name__)

_TEMPLATES: list[CategoryTemplate] | None = None
_TEMPLATE_FILE = Path(__file__).parent.parent / "data" / "category_templates.json"


def load_templates(force: bool = False) -> list[CategoryTemplate]:
    """加载模板配置文件，结果缓存到内存。"""
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
    """按优先级匹配模板：URL 关键词 > 站点名称关键词。"""
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
    """应用模板到指定站点，返回变更详情。"""
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

    # 构建 lookup
    existing_map: dict[str, str] = {}
    for m in existing_mappings:
        rid = str(m.get("remote_id", ""))
        if rid:
            existing_map[rid] = m.get("name", "")

    # 站点实际分类 lookup
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

    applied: list[TemplateApplyItem] = []
    skipped: list[TemplateApplySkipped] = []
    unrecognized: list[TemplateApplyUnrecognized] = []

    # 遍历模板映射
    for remote_id, system_name in template.mappings.items():
        if remote_id not in remote_map:
            # 模板中有但站点实际没有该分类 → 忽略
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
            applied.append(TemplateApplyItem(
                remote_id=remote_id,
                name=remote_name,
            ))

    # 站点实际分类中模板未覆盖的 → unrecognized
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
```

### 4.3 后端 API 端点

```python
# backend/app/api/sites.py

from app.services.template_manager import apply_template, match_template


@router.post("/{site_id}/apply-template")
async def apply_site_template(site_id: int, db: AsyncSession = Depends(get_db)):
    """对指定站点应用分类映射模板。"""
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    # 检查是否有匹配模板
    template = match_template(db_site.name, db_site.base_url)
    if not template:
        raise HTTPException(status_code=404, detail="暂无该站点的预设模板")

    # 需要远程分类数据
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
        existing_mappings=db_site.categories or [],
    )

    if not result.template_matched:
        raise HTTPException(status_code=404, detail="暂无该站点的预设模板")

    return result


@router.get("/{site_id}/template-preview")
async def preview_site_template(site_id: int, db: AsyncSession = Depends(get_db)):
    """预览模板应用结果，不实际修改数据。"""
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

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
        existing_mappings=db_site.categories or [],
    )

    # 转换为 preview 格式
    preview = []
    for item in result.applied:
        preview.append({"remote_id": item.remote_id, "name": item.name, "action": "apply"})
    for item in result.skipped:
        preview.append({
            "remote_id": item.remote_id,
            "name": item.name,
            "action": "skip",
            "existing": item.existing_system_name,
        })

    return {
        "site_id": db_site.id,
        "template_matched": True,
        "template_name": result.template_name,
        "would_apply": len(result.applied),
        "would_skip": len(result.skipped),
        "would_unrecognized": len(result.unrecognized),
        "preview": preview,
    }
```

### 4.4 前端 TypeScript 类型

```typescript
// frontend/src/types.ts

interface TemplateApplySkipped {
  remote_id: string;
  name: string;
  reason: "already_mapped";
  existing_system_name: string;
}

interface TemplateApplyUnrecognized {
  remote_id: string;
  name: string;
}

interface TemplateApplySummary {
  total_in_template: number;
  applied_count: number;
  skipped_count: number;
  unrecognized_count: number;
}

interface TemplateApplyResponse {
  site_id: number;
  template_matched: boolean;
  template_name: string | null;
  applied: CategoryMapping[];
  skipped: TemplateApplySkipped[];
  unrecognized: TemplateApplyUnrecognized[];
  summary: TemplateApplySummary;
}

interface TemplatePreviewItem {
  remote_id: string;
  name: string;
  action: "apply" | "skip";
  existing?: string;
}

interface TemplatePreviewResponse {
  site_id: number;
  template_matched: boolean;
  template_name: string | null;
  would_apply: number;
  would_skip: number;
  would_unrecognized: number;
  preview: TemplatePreviewItem[];
}
```

### 4.5 前端 API 客户端

```typescript
// frontend/src/api/sites.ts

export const applyTemplate = (id: number) =>
  post<TemplateApplyResponse>(`/api/sites/${id}/apply-template`);

export const previewTemplate = (id: number) =>
  get<TemplatePreviewResponse>(`/api/sites/${id}/template-preview`);
```

### 4.6 模板配置文件

```json
{
  "version": "1.0",
  "templates": [
    {
      "name": "ffzy",
      "match_rules": {
        "site_name_keywords": ["非凡", "ffzy"],
        "url_keywords": ["ffzy"]
      },
      "mappings": {
        "1": "动作片",
        "2": "喜剧片",
        "3": "爱情片",
        "4": "科幻片",
        "5": "恐怖片",
        "6": "剧情片",
        "7": "战争片",
        "8": "纪录片",
        "9": "动画片",
        "10": "国产剧",
        "11": "香港剧",
        "12": "韩国剧",
        "13": "欧美剧",
        "14": "台湾剧",
        "15": "日本剧",
        "16": "泰国剧",
        "17": "海外剧",
        "18": "大陆综艺",
        "19": "港台综艺",
        "20": "日韩综艺",
        "21": "欧美综艺",
        "22": "国产动漫",
        "23": "日韩动漫",
        "24": "欧美动漫",
        "25": "港台动漫",
        "26": "海外动漫",
        "27": "4K电影",
        "28": "邵氏电影",
        "29": "Netflix",
        "30": "短剧",
        "31": "体育"
      }
    },
    {
      "name": "360zy",
      "match_rules": {
        "site_name_keywords": ["360", "360zy"],
        "url_keywords": ["360zy"]
      },
      "mappings": {
        "1": "动作片",
        "2": "喜剧片",
        "3": "爱情片",
        "4": "科幻片",
        "5": "恐怖片",
        "6": "剧情片",
        "7": "战争片",
        "8": "动画片",
        "9": "纪录片",
        "10": "国产剧",
        "11": "香港剧",
        "12": "韩国剧",
        "13": "欧美剧",
        "14": "台湾剧",
        "15": "日本剧",
        "16": "泰国剧",
        "17": "海外剧",
        "18": "大陆综艺",
        "19": "港台综艺",
        "20": "日韩综艺",
        "21": "欧美综艺",
        "22": "国产动漫",
        "23": "日韩动漫",
        "24": "欧美动漫",
        "25": "港台动漫",
        "26": "海外动漫",
        "27": "短剧",
        "28": "其他",
        "29": "其他",
        "30": "体育",
        "31": "体育",
        "32": "体育",
        "33": "4K电影",
        "34": "邵氏电影"
      }
    },
    {
      "name": "wolong",
      "match_rules": {
        "site_name_keywords": ["卧龙", "wolong"],
        "url_keywords": ["wolong"]
      },
      "mappings": {
        "6": "动作片",
        "7": "喜剧片",
        "8": "爱情片",
        "9": "科幻片",
        "10": "恐怖片",
        "11": "剧情片",
        "12": "战争片",
        "13": "纪录片",
        "14": "动画片",
        "15": "国产剧",
        "16": "香港剧",
        "17": "韩国剧",
        "18": "欧美剧",
        "19": "台湾剧",
        "20": "日本剧",
        "21": "泰国剧",
        "22": "海外剧",
        "23": "大陆综艺",
        "24": "港台综艺",
        "25": "日韩综艺",
        "26": "欧美综艺",
        "27": "国产动漫",
        "28": "日韩动漫",
        "29": "欧美动漫",
        "30": "港台动漫",
        "31": "海外动漫",
        "32": "短剧",
        "33": "体育"
      }
    }
  ]
}
```

---

## 5. 实现顺序建议

```
阶段 1: 模板数据（可独立）
  └── backend/data/category_templates.json
        └── 填充 ffzy / 360zy / wolong 三个模板
        └── 验证: JSON 格式正确

阶段 2: 后端模板管理器（依赖阶段 1）
  └── backend/app/services/template_manager.py
        ├── load_templates() — 文件加载 + 缓存
        ├── match_template() — 站点匹配
        └── apply_template() — 应用逻辑
        └── 验证: 单元测试覆盖匹配逻辑、应用逻辑

阶段 3: 后端 Schema + API（依赖阶段 2）
  ├── backend/app/schemas.py — 新增 Template* schema
  └── backend/app/api/sites.py
        ├── POST /apply-template
        └── GET /template-preview
        └── 验证: curl 测试各端点

阶段 4: 前端类型 + API（依赖阶段 3，可与阶段 2 并行设计）
  ├── frontend/src/types.ts
  └── frontend/src/api/sites.ts

阶段 5: 前端组件（依赖阶段 4）
  ├── useTemplateMatch.ts — 调用 API + 管理弹窗状态
  ├── TemplateApplyModal.tsx — 结果展示 + 确认应用
  └── CategorySettingsToolbar.tsx — 新增按钮入口

阶段 6: 集成验证
  └── 端到端: 添加 ffzy 站点 → 拉取分类 → 一键应用 → 验证映射正确
```

---

## 6. 风险点和回退方案

| 风险 | 影响 | 概率 | 回退方案 |
|---|---|---|---|
| 模板数据不准确（remote_id 变更） | 映射错误，用户需手动修正 | 中 | 模板版本化管理；定期校验模板与实际分类的一致性 |
| 模板文件损坏/丢失 | 模板功能不可用 | 低 | load_templates 捕获异常，返回空列表；前端收到 404 提示 |
| 与 AC-026/027 组件冲突 | 合并困难 | 高 | **统一约定**：AC-028 只改 Toolbar（加一个按钮）和新增 Modal；不改容器和面板 |
| 未知站点无模板，用户体验差 | 用户每次都要手动配置 | 中 | 无模板时按钮置灰 + hover 提示；联动 AC-026 智能匹配作为 fallback |
| 模板匹配错误（站点改名/改 URL） | 匹配到错误模板 | 低 | URL 匹配优先级最高，相对稳定；用户可手动选择模板（未来扩展） |
| 模板与现有映射冲突 | 用户已手动配置的映射被意外覆盖 | 低 | 设计已规避：模板应用时跳过 already_mapped；预览接口让用户确认 |

### 关键设计决策

1. **模板存储位置**：`backend/data/category_templates.json`（JSON 文件）vs 数据库表
   - 选择 JSON 文件：模板是静态配置，不频繁变更；JSON 便于版本控制和人工编辑；无需迁移脚本。

2. **模板热更新**：文件修改后是否需要重启？
   - 阶段 1 实现：启动时加载，修改后需重启（简单）。
   - 未来扩展：每次请求检查文件 mtime，变更则重新加载。

3. **apply-template 是否直接修改数据库？**
   - **否**。与 AC-026 保持一致：只返回变更建议，由前端确认后通过 PUT /categories 保存。这样：
     - 与现有保存流程统一
     - 用户有撤销机会（不点保存即可）
     - 互斥校验只在 PUT /categories 一处执行

4. **AC-026 与 AC-028 的优先级策略**：
   - 已知站点（有模板）→ 优先用 AC-028（100% 准确）
   - 未知站点（无模板）→  fallback 到 AC-026（智能匹配）
   - UI 体现：无模板时 [一键应用] 按钮置灰，提示「暂无模板，可使用自动匹配」
