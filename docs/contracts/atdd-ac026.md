# ATDD — AC-026 智能分类映射

## 文档信息

| 字段 | 值 |
|---|---|
| AC 编号 | AC-026 |
| 标题 | 智能分类映射 |
| 状态 | ATDD 分析阶段 |
| 创建日期 | 2026-06-07 |
| 依赖 | AC-002（互斥约束） |

---

## 1. 验收场景（Given/When/Then）

### 场景 1：精确匹配自动映射（高置信度）

**Given** 用户已为站点 ffzy 拉取远程分类列表，其中包含 remote_id="1"、name="动作片"
**When** 系统调用 `POST /api/sites/{id}/smart-match`
**Then** 返回匹配结果中，remote_id="1" 的 `suggested_system_name` 为 "动作片"，`confidence` 为 1.0，`status` 为 "auto_mapped"

### 场景 2：关键词前缀/包含匹配（中置信度）

**Given** 用户已为站点 360zy 拉取远程分类列表，其中包含 remote_id="8"、name="恐怖片/惊悚片"
**When** 系统调用 `POST /api/sites/{id}/smart-match`
**Then** 返回匹配结果中，remote_id="8" 的 `suggested_system_name` 为 "恐怖片"，`confidence` 为 0.6，`status` 为 "suggested"

### 场景 3：无匹配项标记为未识别（低置信度）

**Given** 用户已为站点 爱蛋 拉取远程分类列表，其中包含 remote_id="30"、name="福利视频"
**When** 系统调用 `POST /api/sites/{id}/smart-match`
**Then** 返回匹配结果中，remote_id="30" 的 `suggested_system_name` 为 null，`confidence` 为 0.0，`status` 为 "unrecognized"

### 场景 4：用户手动覆盖自动推荐

**Given** 系统已对某站点返回 smart-match 结果，remote_id="5" 被自动推荐为 "科幻片"
**When** 用户在 UI 中将该 remote_id 手动修改为 "恐怖片"
**Then** 前端将该 remote_id 的 `status` 标记为 "manual_override"，保存时以用户选择为准

### 场景 5：已占用 remote_id 不参与自动匹配

**Given** 系统已有配置：站点 ffzy 的 remote_id="1" 已映射到 "动作片"
**When** 对同一站点再次调用 smart-match
**Then** 返回结果中 remote_id="1" 的 `status` 为 "already_mapped"，`suggested_system_name` 为当前已映射的分类名

### 场景 6：批量站点并发匹配性能

**Given** 系统配置了 25 个站点，每站平均 20 个分类
**When** 前端并发对所有站点调用 smart-match
**Then** 每个站点的匹配响应时间 <= 100ms，总并发处理时间 <= 500ms

### 场景 7：成人内容过滤

**Given** 某资源站返回分类中包含 "福利视频"、"三级伦理"、"网红主播"、"写真套图"
**When** 系统执行 smart-match
**Then** 这些分类的 `status` 为 "unrecognized" 且 `flag` 为 "adult_content"，不参与任何系统分类映射

---

## 2. API 接口契约

### 2.1 智能匹配 — POST /api/sites/{site_id}/smart-match

**请求**：
```http
POST /api/sites/{site_id}/smart-match
Content-Type: application/json
```

请求体为空（系统从该站点已拉取的远程分类 + 当前已保存映射自动计算）。

**响应 200**：
```json
{
  "site_id": 1,
  "matches": [
    {
      "remote_id": "1",
      "remote_name": "动作片",
      "suggested_system_name": "动作片",
      "confidence": 1.0,
      "status": "auto_mapped"
    },
    {
      "remote_id": "8",
      "remote_name": "恐怖片/惊悚片",
      "suggested_system_name": "恐怖片",
      "confidence": 0.6,
      "status": "suggested"
    },
    {
      "remote_id": "25",
      "remote_name": "短剧",
      "suggested_system_name": "短剧",
      "confidence": 1.0,
      "status": "auto_mapped"
    },
    {
      "remote_id": "30",
      "remote_name": "福利视频",
      "suggested_system_name": null,
      "confidence": 0.0,
      "status": "unrecognized",
      "flag": "adult_content"
    },
    {
      "remote_id": "2",
      "remote_name": "喜剧片",
      "suggested_system_name": "喜剧片",
      "confidence": 1.0,
      "status": "already_mapped"
    }
  ],
  "summary": {
    "total": 30,
    "auto_mapped": 20,
    "suggested": 3,
    "unrecognized": 5,
    "already_mapped": 2
  }
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `remote_id` | string | 资源站原始分类 ID |
| `remote_name` | string | 资源站分类名称 |
| `suggested_system_name` | string \| null | 推荐的系统分类名，未识别时为 null |
| `confidence` | float | 匹配置信度 0.0 ~ 1.0 |
| `status` | string | 见下方状态枚举 |
| `flag` | string \| null | 额外标记，如 "adult_content" |

**status 枚举**：
- `auto_mapped` — 高置信度（>= 0.7），可直接应用
- `suggested` — 中置信度（0.3 ~ 0.7），需用户确认
- `unrecognized` — 低置信度（< 0.3），需用户手动选择
- `already_mapped` — 该 remote_id 已被映射到某系统分类

**错误响应**：

| 状态码 | 场景 | 响应体 |
|---|---|---|
| 404 | site_id 不存在 | `{"detail": "Site not found"}` |
| 502 | 站点未拉取远程分类 | `{"detail": "请先拉取远程分类列表"}` |

### 2.2 应用智能匹配结果 — PUT /api/sites/{site_id}/categories（扩展）

前端在展示 smart-match 结果后，用户可一键应用所有 `auto_mapped` 项，或逐项确认 `suggested` 项。

最终通过现有的 `PUT /api/sites/{site_id}/categories` 保存，请求体格式不变：
```json
{
  "categories": [
    {"remote_id": "1", "name": "动作片"},
    {"remote_id": "8", "name": "恐怖片"}
  ]
}
```

---

## 3. 匹配规则表

### 3.1 规则格式

每条规则定义一个系统分类的匹配逻辑：

```python
class MatchRule:
    system_name: str           # 系统分类名
    exact_matches: list[str]   # 精确匹配（confidence = 1.0）
    keywords: list[str]        # 关键词包含匹配（confidence = 0.6）
    exclude_keywords: list[str]  # 排除关键词（命中则 confidence = 0）
```

### 3.2 完整规则表

| 系统分类 | 精确匹配 | 关键词匹配 | 排除关键词 |
|---|---|---|---|
| 动作片 | 动作片 | 动作 | |
| 科幻片 | 科幻片 | 科幻 | |
| 喜剧片 | 喜剧片 | 喜剧 | |
| 爱情片 | 爱情片 | 爱情 | |
| 剧情片 | 剧情片 | 剧情 | |
| 战争片 | 战争片 | 战争 | |
| 恐怖片 | 恐怖片 | 恐怖、惊悚、灾难 | |
| 伦理片 | 伦理片 | 伦理 | 福利、三级、主播、写真、套图 |
| 纪录片 | 纪录片 | 纪录 | |
| 动画片 | 动画片 | 动画 | |
| 短片 | 短片 | | |
| 4K电影 | 4K电影、4K | | |
| 邵氏电影 | 邵氏电影、邵氏 | | |
| Netflix | Netflix | | |
| 国产剧 | 国产剧 | 国产电视、国产连续 | |
| 香港剧 | 香港剧、港台剧 | | |
| 韩国剧 | 韩国剧 | 韩剧 | |
| 欧美剧 | 欧美剧 | 美国剧 | |
| 台湾剧 | 台湾剧 | 台剧 | |
| 日本剧 | 日本剧 | 日剧 | |
| 泰国剧 | 泰国剧 | 泰剧 | |
| 海外剧 | 海外剧 | | |
| 大陆综艺 | 大陆综艺 | 内地综艺、国产综艺 | |
| 港台综艺 | 港台综艺 | 香港综艺、台湾综艺 | |
| 日韩综艺 | 日韩综艺 | 韩国综艺、日本综艺 | |
| 欧美综艺 | 欧美综艺 | | |
| 国产动漫 | 国产动漫 | 国产动画 | |
| 日韩动漫 | 日韩动漫 | 日本动漫、韩国动漫 | |
| 欧美动漫 | 欧美动漫 | | |
| 港台动漫 | 港台动漫 | | |
| 海外动漫 | 海外动漫 | | |
| 体育 | 体育 | 足球、篮球、NBA | |
| 短剧 | 短剧 | | |
| 其他 | 预告片、影视解说、电视直播、央视、卫视 | | |

### 3.3 成人内容黑名单

以下关键词出现在分类名称中时，直接标记为 adult_content：

```
福利、三级伦理、网红主播、明星、福利图片、写真套图、直播、
成人、色情、AV、伦理（当同时包含福利/三级/主播/写真/套图时）
```

---

## 4. 置信度计算逻辑

```
对于每个远程分类 (remote_id, remote_name):
    1. 如果 remote_id 已被映射 → status=already_mapped, confidence=1.0
    2. 检查成人内容黑名单 → 命中则 status=unrecognized, confidence=0.0, flag=adult_content
    3. 遍历所有系统分类的匹配规则:
        a. 如果 remote_name 在 exact_matches 中 → confidence=1.0
        b. 如果 remote_name 包含某个 keyword → confidence=0.6
        c. 如果命中 exclude_keywords → confidence=0.0, 跳过
    4. 取最高 confidence 的规则作为推荐
    5. 根据 confidence 阈值确定 status:
        - >= 0.7 → auto_mapped
        - 0.3 ~ 0.7 → suggested
        - < 0.3 → unrecognized
```

---

## 5. 数据模型/类型定义

### 5.1 后端 Pydantic Schema（新增）

```python
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

### 5.2 前端 TypeScript 类型（新增）

```typescript
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

---

## 6. 边界条件和异常场景

| 场景 | 预期行为 |
|---|---|
| 远程分类名称为空字符串 | confidence=0.0, status=unrecognized |
| 多个规则同时命中同一分类 | 取最高 confidence 的规则；若相同则取精确匹配优先于关键词匹配 |
| 站点未先调用 fetch-categories | 返回 502，提示先拉取分类 |
| 所有分类均无法识别 | summary.unrecognized == summary.total，正常返回 200 |
| 分类名称含特殊字符/emoji | 正常参与匹配，按字符串包含规则处理 |
| 系统分类名被用户自定义修改 | 匹配规则基于标准系统分类名，不受用户自定义影响 |

---

## 7. 性能约束指标

| 指标 | 目标值 | 测试方法 |
|---|---|---|
| 单站点匹配耗时 | <= 100ms | 单站 30 个分类，本地测试 |
| 25 站点并发总耗时 | <= 500ms | 并发调用 25 个 smart-match |
| 内存占用 | 无额外持久化存储 | 纯内存计算，不写入数据库 |
| 前端渲染 30 条匹配结果 | <= 16ms | Chrome DevTools Performance |

---

## 8. UI 交互设计要点

1. **匹配结果展示**：每个 remote 分类卡片展示名称、推荐系统分类、confidence 进度条
2. **颜色编码**：
   - auto_mapped（绿色）— 可直接应用
   - suggested（黄色）— 需用户确认
   - unrecognized（灰色）— 需手动选择下拉框
   - already_mapped（蓝色）— 已配置，不可修改
3. **一键应用**：顶部提供「应用所有高置信度映射」按钮，仅应用 auto_mapped 项
4. **批量确认**：suggested 项提供「全部确认」复选框
5. **成人内容**：adult_content 标记的分类折叠到「未识别分类」区域，半透明展示
