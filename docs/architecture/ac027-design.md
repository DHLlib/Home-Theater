# AC-027 分类层级展示 — 架构设计文档

## 文档信息

| 字段 | 值 |
|---|---|
| AC 编号 | AC-027 |
| 标题 | 分类层级展示 |
| 状态 | 架构设计 |
| 依赖 | AC-002（互斥约束）、现有 fetch-categories 接口 |
| 冲突关注 | AC-026（同改 CategorySettings）、AC-028（同改 CategorySettings） |

---

## 1. 组件拆分图

```
CategorySettings (容器，协调层)
├── CategorySettingsToolbar
│   └── [重新拉取] [加载默认] [自动匹配] [一键应用] [保存]
├── SiteTabs
│   └── Tab 列表（站点 1 | 站点 2 | ... | 站点 N）
└── SiteCategoryPanel (当前选中站点)
    ├── EmptyState (无分类时)
    └── CategoryGroup[] (按父分类分组)
        ├── CategoryGroupHeader (可折叠)
        │   ├── ▶/▼ 折叠图标
        │   ├── parent_name (如"电影"、"连续剧")
        │   └── 子分类计数 (如 "6个分类")
        └── CategoryList (折叠时不渲染)
            └── CategoryMappingItem[] (子分类行)
                ├── remote_name + remote_id
                ├── SystemCategorySelect (下拉框)
                │   └── 已占用项置灰 + 显示占用者
                └── OccupancyBadge (被哪个 system_name 占用)

// 无父分类的归入 "未分组" Group，parent_id=null
```

### 与现有组件的对比

| 维度 | 现有（AC-002） | AC-027 改造后 |
|---|---|---|
| 布局 | 大表格（system_name × sites） | 站点 Tab + 分组列表 |
| 数据展示 | 所有站点同时渲染 | 一次只展示一个站点 |
| 分类结构 | 扁平列表 | 按父分类分组折叠 |
| 互斥展示 | 表格单元格内 checkbox | 下拉框中已占用项置灰 |
| DOM 节点数 | 25 站 × 30 分类 = 750+ 行 | 1 站 × 分组数 = <100 节点 |

---

## 2. 数据流图

### 2.1 拉取与展示流程

```
用户进入分类设置页
    │
    ▼
Settings.tsx 传入 sites 列表
    │
    ▼
CategorySettings 初始化:
    ├── 对每个站点调用 fetchRemoteCategories(site_id)
    │     └── POST /api/sites/{site_id}/fetch-categories
    │           └── 返回新格式: { site_id, groups: CategoryGroup[] }
    ├── 对每个站点调用 getSiteCategories(site_id)
    │     └── GET /api/sites/{site_id}/categories
    │           └── 返回: { site_id, categories: CategoryMapping[] }
    └── 合并为本地状态: Record<site_id, SiteCategoryState>
    │
    ▼
用户点击站点 Tab → 切换 activeSiteId
    │
    ▼
SiteCategoryPanel 渲染该站点的 groups:
    ├── 读取 localStorage 获取折叠状态
    ├── 对每个 Group:
    │     ├── 渲染 CategoryGroupHeader
    │     └── 若未折叠: 渲染 CategoryList
    │           └── 对每个子分类:
    │                 ├── 显示 remote_name
    │                 └── SystemCategorySelect:
    │                       ├── 当前已映射? → 显示已选 system_name
    │                       ├── 被其他 system 占用? → 置灰 + 显示占用者
    │                       └── 未映射未占用? → 可选下拉
    │
    ▼
用户选择 system_category 映射
    │
    ▼
更新本地状态 → occupancy 重算 → 同站其他项实时更新置灰状态
    │
    ▼
用户点击 [保存映射]
    │
    ▼
PUT /api/sites/{site_id}/categories（已有接口，格式不变）
```

### 2.2 折叠状态持久化

```
CategoryGroupHeader 点击
    │
    ▼
更新组件内 collapsed: Set<string> 状态
    │
    ▼
同步写入 localStorage:
    key: `ht_category_collapsed_${site_id}`
    value: JSON.stringify([parent_id1, parent_id2, ...])
    │
    ▼
下次进入该站点 Tab 时读取 localStorage 恢复折叠状态
```

---

## 3. 新增/修改文件清单

### 后端

| 文件 | 动作 | 说明 |
|---|---|---|
| `backend/app/schemas.py` | 修改 | 新增 CategoryMappingWithPid、CategoryGroup、SiteCategoriesFetchOut |
| `backend/app/api/sites.py` | 修改 | fetch-categories 返回格式改为 groups |

### 前端

| 文件 | 动作 | 说明 |
|---|---|---|
| `frontend/src/types.ts` | 修改 | 新增 CategoryMappingWithPid、CategoryGroup、FetchCategoriesResponse |
| `frontend/src/api/sites.ts` | 修改 | fetchRemoteCategories 返回类型更新 |
| `frontend/src/components/category-settings/CategoryGroupHeader.tsx` | 新增 | 父分类分组头部（折叠/展开） |
| `frontend/src/components/category-settings/CategoryMappingItem.tsx` | 新增 | 单个子分类映射行 |
| `frontend/src/components/category-settings/SystemCategorySelect.tsx` | 新增 | 系统分类下拉选择器（含互斥置灰） |
| `frontend/src/components/category-settings/SiteCategoryPanel.tsx` | 新增 | 单站点分类面板（组合 GroupHeader + Item） |
| `frontend/src/components/category-settings/useCategoryState.ts` | 新增 | 分类状态管理 Hook（含折叠持久化） |
| `frontend/src/components/category-settings/CategorySettings.tsx` | 修改 | 容器接入 SiteTabs + SiteCategoryPanel |

---

## 4. 接口详细定义

### 4.1 后端 Pydantic Schema（变更）

```python
# backend/app/schemas.py

class CategoryMappingWithPid(BaseModel):
    """带子分类标记的分类映射"""
    remote_id: str
    name: str
    type_pid: str | None = None  # 父分类 ID


class CategoryGroup(BaseModel):
    """父分类分组"""
    parent_id: str | None = None
    parent_name: str | None = None
    categories: list[CategoryMappingWithPid]


class SiteCategoriesFetchOut(BaseModel):
    """fetch-categories 新响应格式"""
    site_id: int
    groups: list[CategoryGroup]


# 注意：SiteCategoriesOut（GET /categories）保持不变，继续使用扁平 CategoryMapping
```

### 4.2 后端 fetch-categories 改造

```python
# backend/app/api/sites.py

@router.post("/{site_id}/fetch-categories")
async def fetch_remote_categories(site_id: int, db: AsyncSession = Depends(get_db)):
    """从资源站自动拉取分类列表，返回层级分组格式。"""
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

    # 3. 构建响应
    result_groups: list[CategoryGroup] = []
    for parent_id, cats in groups.items():
        # 跳过空分组
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
```

### 4.3 前端 TypeScript 类型

```typescript
// frontend/src/types.ts

interface CategoryMappingWithPid {
  remote_id: string;
  name: string;
  type_pid?: string | null;
}

interface CategoryGroup {
  parent_id: string | null;
  parent_name: string | null;
  categories: CategoryMappingWithPid[];
}

interface FetchCategoriesResponse {
  site_id: number;
  groups: CategoryGroup[];
}

// GET /categories 响应保持不变
interface SiteCategoriesOut {
  site_id: number;
  categories: CategoryMapping[];
}
```

### 4.4 前端 API 客户端更新

```typescript
// frontend/src/api/sites.ts

export const fetchRemoteCategories = (id: number) =>
  post<FetchCategoriesResponse>(`/api/sites/${id}/fetch-categories`);
```

### 4.5 折叠状态管理 Hook

```typescript
// frontend/src/components/category-settings/useCategoryState.ts

const COLLAPSED_KEY = (siteId: number) => `ht_category_collapsed_${siteId}`;

function getCollapsedGroups(siteId: number): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY(siteId));
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set();
}

function saveCollapsedGroups(siteId: number, collapsed: Set<string>) {
  localStorage.setItem(COLLAPSED_KEY(siteId), JSON.stringify([...collapsed]));
}

export function useCollapsedGroups(siteId: number) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    getCollapsedGroups(siteId)
  );

  const toggleGroup = useCallback((parentId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      saveCollapsedGroups(siteId, next);
      return next;
    });
  }, [siteId]);

  return { collapsed, toggleGroup };
}
```

---

## 5. 实现顺序建议

```
阶段 1: 后端 Schema + API（可独立）
  ├── backend/app/schemas.py
  │     └── 新增 CategoryMappingWithPid、CategoryGroup、SiteCategoriesFetchOut
  └── backend/app/api/sites.py
        └── 修改 fetch-categories 返回 groups 格式
        └── 验证: curl 测试返回结构正确，parent/child 关系正确

阶段 2: 前端类型 + API 更新（依赖阶段 1）
  ├── frontend/src/types.ts — 新增类型
  └── frontend/src/api/sites.ts — 更新 fetchRemoteCategories 返回类型

阶段 3: 子组件开发（依赖阶段 2，可与阶段 1 并行设计）
  ├── CategoryGroupHeader.tsx — 折叠/展开 UI
  ├── SystemCategorySelect.tsx — 下拉框 + 互斥置灰
  ├── CategoryMappingItem.tsx — 单行布局
  └── useCategoryState.ts — 折叠状态持久化

阶段 4: 组装 SiteCategoryPanel（依赖阶段 3）
  └── SiteCategoryPanel.tsx — 组合 GroupHeader + MappingItem
      └── 接入 useCollapsedGroups

阶段 5: 重构 CategorySettings 容器（依赖阶段 4）
  └── CategorySettings.tsx（新）
      ├── 接入 SiteTabs（站点切换）
      ├── 接入 SiteCategoryPanel（当前站点内容）
      └── 保留 rows/occupancy 全局状态（与 AC-002 兼容）

阶段 6: 端到端验证
  └── 25 站点 × 20 分类性能测试
      └── Chrome DevTools: FPS >= 30, 首屏 < 1s
```

---

## 6. 风险点和回退方案

| 风险 | 影响 | 概率 | 回退方案 |
|---|---|---|---|
| fetch-categories 返回格式变更破坏现有前端 | 分类设置页无法使用 | 中 | 采用版本协商：后端同时支持新旧格式，前端通过 Accept 头或查询参数选择 |
| 父分类分组导致用户找不到子分类 | 用户体验差 | 低 | 默认所有分组展开；搜索过滤功能（快速定位 remote 分类） |
| 站点 Tab 切换延迟 | 25 站点间切换卡顿 | 低 | Tab 切换只是改 activeSiteId，数据已预加载；若仍卡，加 React.memo + useMemo |
| 与 AC-026/028 组件拆分冲突 | 合并困难 | 高 | **统一约定**：CategorySettings 容器由 AC-027 负责重构；AC-026/028 只新增自己的子组件，不改容器结构 |
| localStorage 折叠状态损坏 | 所有分组异常 | 低 | try/catch 包裹读取逻辑，损坏时重置为全部展开 |
| 父分类 type_pid 指向不存在的 ID | 子分类丢失 | 低 | 后端已处理：归入 parent_id=null 的未分组 |

### 关键兼容性决策

**fetch-categories 格式变更的兼容性**：

- 方案 A（渐进式）：后端同时支持新旧格式，通过查询参数 `?format=flat|hierarchy` 切换，默认 flat。前端逐步迁移。
- 方案 B（一次性）：后端直接改 groups 格式，前端同步改造。

**推荐方案 B**。原因：
1. 当前系统只有 CategorySettings 一个消费者
2. 一次性切换减少维护两套格式的负担
3. AC-027 是前端核心重构，必然同步改造

若方案 B 在测试阶段发现问题，可在 1 小时内回退到方案 A（后端加 `format` 参数，前端不传则走旧格式）。

### 性能保障措施

1. **站点级懒加载**：进入分类设置页时，只拉取当前 active 站点的分类；其他站点按需拉取
2. **折叠即不渲染**：`{!collapsed.has(parentId) && <CategoryList ... />}` — 折叠的分组不创建 DOM
3. **React.memo**：CategoryMappingItem 用 memo 包裹，避免无关更新触发重渲染
4. **CSS 优化**：列表容器加 `contain: layout style paint`
