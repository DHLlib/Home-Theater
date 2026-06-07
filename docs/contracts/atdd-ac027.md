# ATDD — AC-027 分类层级展示

## 文档信息

| 字段 | 值 |
|---|---|
| AC 编号 | AC-027 |
| 标题 | 分类层级展示 |
| 状态 | ATDD 分析阶段 |
| 创建日期 | 2026-06-07 |
| 依赖 | AC-002（互斥约束）、现有 fetch-categories 接口 |

---

## 1. 验收场景（Given/When/Then）

### 场景 1：父分类分组展示

**Given** 资源站返回的分类数据中包含父分类（type_pid=0）和子分类（type_pid>0）
**When** 系统展示分类列表时
**Then** 子分类按所属父分类分组展示，每个父分类为一个可折叠的分组头部

### 场景 2：仅子分类可映射

**Given** 分类设置页展示了带层级结构的分类列表
**When** 用户尝试将某 remote_id 映射到系统分类时
**Then** 仅 type_pid > 0 的子分类可被选中/映射；父分类仅作为分组标题展示，不可交互

### 场景 3：分组折叠/展开

**Given** 分类设置页按父分类分组展示了子分类
**When** 用户点击父分类分组头部
**Then** 该分组下的子分类列表折叠/展开；折叠状态持久化到 localStorage

### 场景 4：折叠状态跨会话保持

**Given** 用户之前将「电影」分组折叠、「电视剧」分组展开
**When** 用户刷新页面或重新打开分类设置
**Then** 「电影」保持折叠，「电视剧」保持展开

### 场景 5：无父分类的扁平展示

**Given** 某资源站返回的分类数据中没有父分类（所有 type_pid=0 或缺失）
**When** 系统展示分类列表时
**Then** 所有分类以扁平列表展示，不显示分组头部

### 场景 6：大量分类性能测试

**Given** 系统配置了 25 个站点，每站平均 20 个分类，总计 500+ 分类条目
**When** 用户打开分类设置页面
**Then** 页面首屏渲染时间 <= 1s，滚动帧率 >= 30fps，无卡顿

### 场景 7：映射关系保持扁平

**Given** 用户在层级展示界面中配置了分类映射
**When** 系统保存映射配置时
**Then** 保存到数据库的映射关系仍为扁平结构（remote_id -> system_name），不存储层级信息

---

## 2. API 接口契约

### 2.1 获取远程分类（扩展）— POST /api/sites/{site_id}/fetch-categories

**变更说明**：当前接口已过滤 type_pid=0 的父分类，仅返回子分类。AC-027 需要**保留父分类信息**，改为返回完整层级数据。

**请求**：不变
```http
POST /api/sites/{site_id}/fetch-categories
```

**响应 200（新格式）**：
```json
{
  "site_id": 1,
  "groups": [
    {
      "parent_id": "1",
      "parent_name": "电影",
      "categories": [
        {"remote_id": "6", "name": "动作片", "type_pid": "1"},
        {"remote_id": "7", "name": "喜剧片", "type_pid": "1"},
        {"remote_id": "8", "name": "科幻片", "type_pid": "1"}
      ]
    },
    {
      "parent_id": "2",
      "parent_name": "连续剧",
      "categories": [
        {"remote_id": "12", "name": "国产剧", "type_pid": "2"},
        {"remote_id": "13", "name": "香港剧", "type_pid": "2"}
      ]
    },
    {
      "parent_id": null,
      "parent_name": null,
      "categories": [
        {"remote_id": "50", "name": "4K电影", "type_pid": "0"}
      ]
    }
  ]
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `groups` | array | 按父分类分组的数组 |
| `groups[].parent_id` | string \| null | 父分类 remote_id，无父分类时为 null |
| `groups[].parent_name` | string \| null | 父分类名称 |
| `groups[].categories` | array | 该父分类下的子分类列表 |
| `categories[].remote_id` | string | 子分类 ID |
| `categories[].name` | string | 子分类名称 |
| `categories[].type_pid` | string | 父分类 ID（>0 表示有父分类） |

**兼容性说明**：
- 旧格式中的 `categories` 字段被替换为 `groups`
- 前端 CategorySettings 组件需同步适配新数据结构
- 无父分类的条目归入 `parent_id=null` 的组

### 2.2 获取已保存映射 — GET /api/sites/{site_id}/categories（不变）

```json
{
  "site_id": 1,
  "categories": [
    {"remote_id": "6", "name": "动作片"}
  ]
}
```

映射数据保持扁平，不存储层级。

### 2.3 更新映射 — PUT /api/sites/{site_id}/categories（不变）

请求体格式不变，后端互斥校验逻辑不变。

---

## 3. 数据模型/类型定义

### 3.1 后端 Pydantic Schema（变更）

```python
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
```

**注意**：`SiteCategoriesOut`（GET /categories 响应）保持不变，继续使用扁平的 `CategoryMapping`。

### 3.2 前端 TypeScript 类型（变更）

```typescript
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

---

## 4. UI 交互设计

### 4.1 折叠/展开状态管理

```typescript
// localStorage key: category_settings_collapsed_{site_id}
// value: string[] — 被折叠的 parent_id 列表

function getCollapsedGroups(siteId: number): string[] {
  const raw = localStorage.getItem(`category_settings_collapsed_${siteId}`);
  return raw ? JSON.parse(raw) : [];
}

function setCollapsedGroups(siteId: number, collapsed: string[]) {
  localStorage.setItem(
    `category_settings_collapsed_${siteId}`,
    JSON.stringify(collapsed)
  );
}
```

### 4.2 组件结构

```
CategorySettings
├── SiteCategoryPanel (per site)
│   ├── GroupHeader (collapsible)
│   │   ├── parent_name
│   │   └── collapse toggle icon
│   └── CategoryList (when expanded)
│       └── CategoryItem (checkbox + name + occupancy status)
```

### 4.3 虚拟滚动方案

由于 25 站点 × 每站多分组可能产生大量 DOM 节点，采用以下策略：

1. **站点级 Tab 切换**：一次只展示一个站点的分类，避免同时渲染所有站点
2. **分组内虚拟滚动**：单个分组下子分类超过 50 个时启用虚拟滚动
3. **懒渲染**：折叠的分组不渲染子分类 DOM

```typescript
// 虚拟滚动阈值
const VIRTUAL_SCROLL_THRESHOLD = 50;

// 使用 CSS contain 优化渲染
const categoryListStyle = {
  contain: "layout style paint",
  contentVisibility: "auto",
};
```

---

## 5. 边界条件和异常场景

| 场景 | 预期行为 |
|---|---|
| 资源站返回的 type_pid 指向不存在的父分类 | 该子分类归入 `parent_id=null` 的未分组区域 |
| 父分类下没有子分类 | 不显示该父分类分组 |
| 所有分类都是父分类（无子分类） | 展示空列表，提示「该站点无可映射的子分类」 |
| localStorage 被清除 | 所有分组默认展开 |
| 父分类名称重复 | 按 parent_id 区分，展示为独立分组 |
| 站点返回的分类数据格式异常 | 后端返回 502，前端展示错误提示 |

---

## 6. 性能约束指标

| 指标 | 目标值 | 测试方法 |
|---|---|---|
| 单站点首屏渲染 | <= 300ms | Lighthouse |
| 25 站点切换 Tab | <= 100ms | 已加载数据的站点间切换 |
| 滚动帧率 | >= 30fps | Chrome DevTools FPS |
| 折叠/展开动画 | <= 200ms | 视觉感知 |
| 内存占用（500+ 分类） | <= 20MB | Chrome DevTools Memory |

---

## 7. 后端实现要点

### 7.1 fetch-categories 改造

```python
@router.post("/{site_id}/fetch-categories")
async def fetch_remote_categories(site_id: int, db: AsyncSession = Depends(get_db)):
    # ... 获取 data ...
    class_list = data.get("class", [])

    # 1. 先提取所有父分类
    parents: dict[str, str] = {}
    for raw in class_list:
        type_pid = raw.get("type_pid")
        if type_pid == 0 or type_pid == "0":
            pid = str(raw.get("type_id") or raw.get("id") or "")
            parents[pid] = str(raw.get("type_name") or raw.get("name") or "")

    # 2. 按父分类分组子分类
    groups: dict[str | None, list] = {}
    for raw in class_list:
        type_pid = raw.get("type_pid")
        if type_pid == 0 or type_pid == "0":
            continue  # 父分类不放入 groups

        remote_id = str(raw.get("type_id") or raw.get("id") or "")
        name = str(raw.get("type_name") or raw.get("name") or "")
        pid_str = str(type_pid) if type_pid else None

        # 如果 type_pid 指向的父分类不存在，归入未分组
        parent_id = pid_str if pid_str in parents else None

        if parent_id not in groups:
            groups[parent_id] = []
        groups[parent_id].append(CategoryMappingWithPid(
            remote_id=remote_id, name=name, type_pid=pid_str
        ))

    # 3. 构建响应
    result_groups = []
    for parent_id, cats in groups.items():
        result_groups.append(CategoryGroup(
            parent_id=parent_id,
            parent_name=parents.get(parent_id) if parent_id else None,
            categories=cats,
        ))

    return SiteCategoriesFetchOut(site_id=site_id, groups=result_groups)
```

### 7.2 兼容性处理

- 旧版前端（未适配 groups 格式）调用 fetch-categories 时会因字段不匹配报错
- 建议采用**版本协商**或**渐进式迁移**：
  - 方案 A：新增查询参数 `?format=hierarchy`，默认保持旧格式
  - 方案 B：前端同步改造，一次性切换
- 推荐方案 B（前端 CategorySettings 同步改造）

---

## 8. 迁移 checklist

- [ ] 后端：修改 fetch-categories 返回格式（categories → groups）
- [ ] 后端：新增 CategoryMappingWithPid、CategoryGroup、SiteCategoriesFetchOut schema
- [ ] 前端：更新 types.ts 中的 FetchCategoriesResponse
- [ ] 前端：更新 api/sites.ts 中的 fetchRemoteCategories 返回类型
- [ ] 前端：重构 CategorySettings 组件，支持分组展示
- [ ] 前端：实现折叠/展开状态持久化（localStorage）
- [ ] 前端：实现站点 Tab 切换（一次只展示一个站点）
- [ ] 测试：验证 25 站点 × 20 分类的性能表现
