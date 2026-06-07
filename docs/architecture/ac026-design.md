# AC-026 智能分类映射 — 架构设计文档

## 文档信息

| 字段 | 值 |
|---|---|
| AC 编号 | AC-026 |
| 标题 | 智能分类映射 |
| 状态 | 架构设计 |
| 依赖 | AC-002（互斥约束） |
| 冲突关注 | AC-027（同改 CategorySettings）、AC-028（同改 CategorySettings） |

---

## 1. 组件拆分图

```
CategorySettings (容器，精简为协调层)
├── CategorySettingsToolbar (新增)
│   ├── [重新拉取各站分类] 按钮
│   ├── [加载默认分类] 按钮
│   ├── [自动匹配] 按钮          ← AC-026 触发入口
│   ├── [一键应用常见映射] 按钮   ← AC-028 触发入口
│   └── [保存映射] 按钮
├── SiteTabs (新增)
│   └── 站点 Tab 切换（一次只展示一个站点）
└── SiteCategoryPanel (新增)
    ├── CategoryGroupHeader (新增，AC-027)
    │   ├── parent_name + 折叠 toggle
    │   └── 折叠状态来自 localStorage
    └── CategoryMappingList (新增)
        └── CategoryMappingItem (新增)
            ├── remote 分类名
            ├── 系统分类下拉框 / 已映射标签
            ├── 置信度指示条 (AC-026)
            └── 状态色块 (auto_mapped/suggested/unrecognized/already_mapped)

SmartMatchResultModal (新增) — AC-026 专用
├── 摘要统计区
├── auto_mapped 列表（可勾选应用）
├── suggested 列表（需逐项确认）
├── unrecognized 列表（灰色，需手动选择）
└── [应用选中项] / [取消] 按钮
```

### 拆分策略说明

原 `CategorySettings.tsx`（575 行）是单文件大组件，三个 AC 都要修改它。按以下策略拆分：

1. **CategorySettings 退化为容器**：只保留 `sites` props 接收、子组件协调、全局状态（rows/occupancy）管理
2. **AC-026 独占组件**：`SmartMatchResultModal` — 纯展示 AC-026 匹配结果，不与其他 AC 共享 UI 空间
3. **AC-027 独占组件**：`CategoryGroupHeader` + 折叠逻辑 — 层级展示是布局层面的变更
4. **AC-028 独占组件**：模板应用走确认对话框，不新增常驻 UI 组件

---

## 2. 数据流图

### 2.1 智能匹配流程（AC-026）

```
用户点击 [自动匹配]
    │
    ▼
前端: POST /api/sites/{site_id}/smart-match
    │
    ▼
后端: app/services/smart_matcher.py::match_site_categories(site_id)
    │
    ├── 读取 Site.categories（已保存映射）
    ├── 读取该站点 fetch-categories 缓存（内存或重新拉取）
    ├── 遍历每个 remote 分类:
    │     ├── 已映射? → already_mapped
    │     ├── 成人黑名单? → unrecognized + adult_content flag
    │     └── 规则匹配 → exact(1.0) / keyword(0.6) / none(0.0)
    └── 按 confidence 阈值分档 → auto_mapped / suggested / unrecognized
    │
    ▼
后端返回 SmartMatchResponse
    │
    ▼
前端: SmartMatchResultModal 展示结果
    │
    ├── 用户勾选要应用的项（默认 auto_mapped 全选）
    ├── 用户可修改 suggested 项的目标分类
    └── 用户点击 [应用选中项]
    │
    ▼
前端: 更新本地 rows/occupancy 状态（不直接调 API）
    │
    ▼
用户点击 [保存映射] → PUT /api/sites/{site_id}/categories（已有接口）
```

### 2.2 与 AC-002 互斥约束的交互

```
smart-match 返回结果时:
    - already_mapped 项: 前端展示为蓝色标签，不可修改
    - 新推荐项: 前端检查 occupancy map
        - 若该 remote_id 在本站已被其他 system_name 占用 → 不可能发生（后端已排除）
        - 跨站点不互斥 → 无需检查

用户应用 smart-match 到本地 rows 时:
    - 直接写入 rows，occupancy 自动重算
    - 与手动勾选/释放走同一套 occupancy 逻辑

保存时:
    - 后端 PUT /categories 再次校验互斥（AC-002 已有逻辑）
    - 双重保险：前端 occupancy + 后端校验
```

---

## 3. 新增/修改文件清单

### 后端

| 文件 | 动作 | 说明 |
|---|---|---|
| `backend/app/services/smart_matcher.py` | 新增 | 智能匹配核心引擎（纯函数，无状态） |
| `backend/app/api/sites.py` | 修改 | 新增 `POST /{site_id}/smart-match` 端点 |
| `backend/app/schemas.py` | 修改 | 新增 SmartMatchItem/SmartMatchSummary/SmartMatchResponse |
| `backend/app/services/__init__.py` | 修改 | 导出 smart_matcher（如有需要） |

### 前端

| 文件 | 动作 | 说明 |
|---|---|---|
| `frontend/src/components/category-settings/index.ts` | 新增 | 组件包入口 |
| `frontend/src/components/category-settings/CategorySettings.tsx` | 新增（重构） | 容器组件，替代原单文件 |
| `frontend/src/components/category-settings/CategorySettingsToolbar.tsx` | 新增 | 工具栏按钮区 |
| `frontend/src/components/category-settings/SiteTabs.tsx` | 新增 | 站点 Tab 切换 |
| `frontend/src/components/category-settings/SiteCategoryPanel.tsx` | 新增 | 单站点分类面板 |
| `frontend/src/components/category-settings/SmartMatchResultModal.tsx` | 新增 | AC-026 匹配结果弹窗 |
| `frontend/src/components/category-settings/useCategoryRows.ts` | 新增 | rows/occupancy 状态管理 Hook |
| `frontend/src/components/category-settings/constants.ts` | 新增 | 系统分类清单、匹配规则常量 |
| `frontend/src/components/CategorySettings.tsx` | 删除 | 被重构替代 |
| `frontend/src/types.ts` | 修改 | 新增 SmartMatch 相关类型 |
| `frontend/src/api/sites.ts` | 修改 | 新增 smartMatch API 调用 |

---

## 4. 接口详细定义

### 4.1 后端 Pydantic Schema（新增）

```python
# backend/app/schemas.py

class SmartMatchItem(BaseModel):
    remote_id: str
    remote_name: str
    suggested_system_name: str | None
    confidence: float = Field(..., ge=0.0, le=1.0)
    status: str  # auto_mapped | suggested | unrecognized | already_mapped
    flag: str | None = None  # adult_content | None


class SmartMatchSummary(BaseModel):
    total: int
    auto_mapped: int
    suggested: int
    unrecognized: int
    already_mapped: int


class SmartMatchResponse(BaseModel):
    site_id: int
    matches: list[SmartMatchItem]
    summary: SmartMatchSummary
```

### 4.2 后端 API 端点

```python
# backend/app/api/sites.py

@router.post("/{site_id}/smart-match")
async def smart_match_categories(
    site_id: int,
    db: AsyncSession = Depends(get_db),
):
    """对指定站点的远程分类执行智能匹配，返回推荐映射。"""
    from app.services.smart_matcher import match_site_categories

    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    # 需要已拉取的远程分类数据
    # 策略：从 Site 的某个缓存字段读取，或要求前端先调 fetch-categories
    # 推荐：复用 fetch-categories 逻辑即时拉取（避免缓存一致性问题）
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

    result = match_site_categories(
        site_id=site_id,
        remote_categories=class_list,
        existing_mappings=db_site.categories or [],
    )
    return result
```

### 4.3 智能匹配引擎（核心算法）

```python
# backend/app/services/smart_matcher.py

from pydantic import BaseModel

# ===== 规则表 =====
MATCH_RULES: list[dict] = [
    {"system_name": "动作片",   "exact": ["动作片"],     "keywords": ["动作"],       "exclude": []},
    {"system_name": "科幻片",   "exact": ["科幻片"],     "keywords": ["科幻"],       "exclude": []},
    {"system_name": "喜剧片",   "exact": ["喜剧片"],     "keywords": ["喜剧"],       "exclude": []},
    {"system_name": "爱情片",   "exact": ["爱情片"],     "keywords": ["爱情"],       "exclude": []},
    {"system_name": "剧情片",   "exact": ["剧情片"],     "keywords": ["剧情"],       "exclude": []},
    {"system_name": "战争片",   "exact": ["战争片"],     "keywords": ["战争"],       "exclude": []},
    {"system_name": "恐怖片",   "exact": ["恐怖片"],     "keywords": ["恐怖", "惊悚", "灾难"], "exclude": []},
    {"system_name": "伦理片",   "exact": ["伦理片"],     "keywords": ["伦理"],       "exclude": ["福利", "三级", "主播", "写真", "套图"]},
    {"system_name": "纪录片",   "exact": ["纪录片"],     "keywords": ["纪录"],       "exclude": []},
    {"system_name": "动画片",   "exact": ["动画片"],     "keywords": ["动画"],       "exclude": []},
    {"system_name": "短片",     "exact": ["短片"],       "keywords": [],             "exclude": []},
    {"system_name": "4K电影",   "exact": ["4K电影", "4K"], "keywords": [],            "exclude": []},
    {"system_name": "邵氏电影", "exact": ["邵氏电影", "邵氏"], "keywords": [],          "exclude": []},
    {"system_name": "Netflix",  "exact": ["Netflix"],    "keywords": [],             "exclude": []},
    {"system_name": "国产剧",   "exact": ["国产剧"],     "keywords": ["国产电视", "国产连续"], "exclude": []},
    {"system_name": "香港剧",   "exact": ["香港剧", "港台剧"], "keywords": [],        "exclude": []},
    {"system_name": "韩国剧",   "exact": ["韩国剧"],     "keywords": ["韩剧"],       "exclude": []},
    {"system_name": "欧美剧",   "exact": ["欧美剧"],     "keywords": ["美国剧"],     "exclude": []},
    {"system_name": "台湾剧",   "exact": ["台湾剧"],     "keywords": ["台剧"],       "exclude": []},
    {"system_name": "日本剧",   "exact": ["日本剧"],     "keywords": ["日剧"],       "exclude": []},
    {"system_name": "泰国剧",   "exact": ["泰国剧"],     "keywords": ["泰剧"],       "exclude": []},
    {"system_name": "海外剧",   "exact": ["海外剧"],     "keywords": [],             "exclude": []},
    {"system_name": "大陆综艺", "exact": ["大陆综艺"],   "keywords": ["内地综艺", "国产综艺"], "exclude": []},
    {"system_name": "港台综艺", "exact": ["港台综艺"],   "keywords": ["香港综艺", "台湾综艺"], "exclude": []},
    {"system_name": "日韩综艺", "exact": ["日韩综艺"],   "keywords": ["韩国综艺", "日本综艺"], "exclude": []},
    {"system_name": "欧美综艺", "exact": ["欧美综艺"],   "keywords": [],             "exclude": []},
    {"system_name": "国产动漫", "exact": ["国产动漫"],   "keywords": ["国产动画"],   "exclude": []},
    {"system_name": "日韩动漫", "exact": ["日韩动漫"],   "keywords": ["日本动漫", "韩国动漫"], "exclude": []},
    {"system_name": "欧美动漫", "exact": ["欧美动漫"],   "keywords": [],             "exclude": []},
    {"system_name": "港台动漫", "exact": ["港台动漫"],   "keywords": [],             "exclude": []},
    {"system_name": "海外动漫", "exact": ["海外动漫"],   "keywords": [],             "exclude": []},
    {"system_name": "体育",     "exact": ["体育"],       "keywords": ["足球", "篮球", "NBA"], "exclude": []},
    {"system_name": "短剧",     "exact": ["短剧"],       "keywords": [],             "exclude": []},
    {"system_name": "其他",     "exact": ["预告片", "影视解说", "电视直播", "央视", "卫视"], "keywords": [], "exclude": []},
]

ADULT_BLACKLIST = [
    "福利", "三级伦理", "网红主播", "明星", "福利图片",
    "写真套图", "直播", "成人", "色情", "AV",
]

SYSTEM_CATEGORY_NAMES = [r["system_name"] for r in MATCH_RULES]


def _is_adult(name: str) -> bool:
    """检查分类名称是否命中成人内容黑名单。"""
    name_lower = name.lower()
    for kw in ADULT_BLACKLIST:
        if kw in name_lower:
            return True
    # 特殊规则："伦理" + (福利|三级|主播|写真|套图)
    if "伦理" in name_lower:
        for kw in ["福利", "三级", "主播", "写真", "套图"]:
            if kw in name_lower:
                return True
    return False


def _match_one(remote_name: str) -> tuple[str | None, float]:
    """对单个远程分类名执行匹配，返回 (system_name, confidence)。"""
    best_name: str | None = None
    best_conf: float = 0.0
    best_is_exact = False

    for rule in MATCH_RULES:
        # 排除关键词检查
        excluded = False
        for ex in rule["exclude"]:
            if ex in remote_name:
                excluded = True
                break
        if excluded:
            continue

        # 精确匹配
        if remote_name in rule["exact"]:
            if best_conf < 1.0 or (best_conf == 1.0 and not best_is_exact):
                best_name = rule["system_name"]
                best_conf = 1.0
                best_is_exact = True
            continue

        # 关键词匹配
        for kw in rule["keywords"]:
            if kw in remote_name:
                # 关键词匹配 confidence = 0.6
                # 若多个关键词命中同一条规则，不叠加，取规则固定值
                if best_conf < 0.6 or (best_conf == 0.6 and best_is_exact):
                    best_name = rule["system_name"]
                    best_conf = 0.6
                    best_is_exact = False
                break

    return best_name, best_conf


def match_site_categories(
    site_id: int,
    remote_categories: list[dict],
    existing_mappings: list[dict],
) -> SmartMatchResponse:
    """对站点所有远程分类执行智能匹配。"""
    # 构建已映射 lookup: remote_id -> name
    existing_map: dict[str, str] = {}
    for m in existing_mappings:
        rid = str(m.get("remote_id", ""))
        if rid:
            existing_map[rid] = m.get("name", "")

    matches: list[SmartMatchItem] = []
    summary = {"total": 0, "auto_mapped": 0, "suggested": 0, "unrecognized": 0, "already_mapped": 0}

    for raw in remote_categories:
        type_pid = raw.get("type_pid")
        if type_pid == 0 or type_pid == "0":
            continue  # 父分类不参与映射

        rid = str(raw.get("type_id") or raw.get("id") or "")
        name = str(raw.get("type_name") or raw.get("name") or "")
        if not rid:
            continue

        summary["total"] += 1

        # 1. 已映射检查
        if rid in existing_map:
            matches.append(SmartMatchItem(
                remote_id=rid,
                remote_name=name,
                suggested_system_name=existing_map[rid],
                confidence=1.0,
                status="already_mapped",
            ))
            summary["already_mapped"] += 1
            continue

        # 2. 成人内容过滤
        if _is_adult(name):
            matches.append(SmartMatchItem(
                remote_id=rid,
                remote_name=name,
                suggested_system_name=None,
                confidence=0.0,
                status="unrecognized",
                flag="adult_content",
            ))
            summary["unrecognized"] += 1
            continue

        # 3. 规则匹配
        suggested, conf = _match_one(name)

        if conf >= 0.7:
            status = "auto_mapped"
            summary["auto_mapped"] += 1
        elif conf >= 0.3:
            status = "suggested"
            summary["suggested"] += 1
        else:
            status = "unrecognized"
            summary["unrecognized"] += 1

        matches.append(SmartMatchItem(
            remote_id=rid,
            remote_name=name,
            suggested_system_name=suggested,
            confidence=conf,
            status=status,
        ))

    return SmartMatchResponse(
        site_id=site_id,
        matches=matches,
        summary=SmartMatchSummary(**summary),
    )
```

### 4.4 前端 TypeScript 类型

```typescript
// frontend/src/types.ts

interface SmartMatchItem {
  remote_id: string;
  remote_name: string;
  suggested_system_name: string | null;
  confidence: number;
  status: "auto_mapped" | "suggested" | "unrecognized" | "already_mapped";
  flag?: "adult_content" | null;
}

interface SmartMatchSummary {
  total: number;
  auto_mapped: number;
  suggested: number;
  unrecognized: number;
  already_mapped: number;
}

interface SmartMatchResponse {
  site_id: number;
  matches: SmartMatchItem[];
  summary: SmartMatchSummary;
}
```

### 4.5 前端 API 客户端

```typescript
// frontend/src/api/sites.ts

export const smartMatchCategories = (id: number) =>
  post<SmartMatchResponse>(`/api/sites/${id}/smart-match`);
```

---

## 5. 实现顺序建议

```
阶段 1: 基础设施（无依赖，可独立）
  ├── backend/app/schemas.py — 新增 SmartMatch* schema
  ├── frontend/src/types.ts — 新增 SmartMatch* 类型
  └── frontend/src/api/sites.ts — 新增 smartMatchCategories

阶段 2: 后端核心引擎（依赖阶段 1）
  └── backend/app/services/smart_matcher.py — 匹配算法实现
      └── 验证: 编写单元测试，覆盖所有规则表条目 + 边界条件

阶段 3: 后端 API（依赖阶段 2）
  └── backend/app/api/sites.py — 新增 POST /smart-match 端点
      └── 验证: curl 测试各站点返回结构正确

阶段 4: 前端组件（依赖阶段 1，可与阶段 2/3 并行）
  └── frontend/src/components/category-settings/ 目录创建
      ├── constants.ts — 提取 DEFAULT_SYSTEM_CATEGORIES、MATCH_RULES
      ├── useCategoryRows.ts — 提取 rows/occupancy/buildOccupancy 逻辑
      ├── CategorySettingsToolbar.tsx
      └── SmartMatchResultModal.tsx

阶段 5: 集成（依赖阶段 3+4）
  └── CategorySettings.tsx（重构后的容器）接入 SmartMatchResultModal
      └── 验证: 端到端测试 — 点击自动匹配 → 展示结果 → 应用 → 保存
```

---

## 6. 风险点和回退方案

| 风险 | 影响 | 概率 | 回退方案 |
|---|---|---|---|
| 匹配规则覆盖不全，大量分类 unrecognized | 用户体验差，需手动配置多 | 中 | 随用随补规则表；AC-028 模板预设作为补充 |
| 规则冲突（一个 remote_name 命中多条规则） | 推荐结果不稳定 | 低 | 算法已处理：exact 优先于 keyword；同类型取最长匹配 |
| 成人内容误判（正常分类被标 adult） | 正常分类无法映射 | 低 | 黑名单可配置化；误报时用户可手动覆盖 |
| 前端 CategorySettings 重构引入回归 bug | 分类设置功能不可用 | 中 | 保留原 CategorySettings.tsx 备份；出问题快速切回 |
| 与 AC-027/028 并行开发冲突 | 代码合并困难 | 高 | 三个 AC 统一走重构后的组件目录；各自只改自己的子组件 |
| 25 站点并发 smart-match 超时 | 前端卡死 | 低 | 前端改为串行或限流（最多 5 并发）；后端响应 < 100ms 可承受 |

### 关键回退决策点

1. **重构失败回退**：如果 CategorySettings 重构过程中出现无法快速修复的 bug，直接回退到原单文件组件，AC-026 的后端 API 仍可用，前端匹配结果通过 alert/简单列表展示。

2. **规则表热更新**：MATCH_RULES 硬编码在 Python 文件中，修改需重启后端。若未来需要频繁调整，可改为从 JSON 文件加载（类似 AC-028 模板机制）。

3. **AC-026 与 AC-028 的优先级**：若资源有限，优先实现 AC-028（模板预设），因为模板准确率 100%，AC-026 智能匹配作为未知站点的 fallback。
