# ATDD — AC-028 分类映射模板预设

## 文档信息

| 字段 | 值 |
|---|---|
| AC 编号 | AC-028 |
| 标题 | 分类映射模板预设 |
| 状态 | ATDD 分析阶段 |
| 创建日期 | 2026-06-07 |
| 依赖 | AC-002（互斥约束）、AC-026（智能分类映射，可选） |

---

## 1. 验收场景（Given/When/Then）

### 场景 1：已知站点一键应用模板

**Given** 用户添加了一个名为 "非凡资源"、URL 包含 "ffzy" 的站点
**When** 用户点击「一键应用常见映射」按钮
**Then** 系统匹配到 ffzy 模板，自动填充所有已知分类的映射
**And** 返回变更摘要：新增映射数 = 模板中未映射的分类数

### 场景 2：不覆盖用户已手动配置的映射

**Given** 站点 360zy 中 remote_id="1" 已手动映射到 "动作片"
**When** 用户点击「一键应用常见映射」
**Then** remote_id="1" 保持 "动作片" 不变
**And** 仅填充该站点中未映射的分类

### 场景 3：未知站点无匹配模板

**Given** 用户添加了一个名为 "未知资源站" 的站点，无匹配模板
**When** 用户点击「一键应用常见映射」
**Then** 返回 404，提示「暂无该站点的预设模板，请手动配置或使用智能匹配」

### 场景 4：部分匹配模板（URL 匹配）

**Given** 用户添加了一个 URL 为 "https://wolongzyw.com/api.php/provide/vod" 的站点，名称为 "我的卧龙"
**When** 用户点击「一键应用常见映射」
**Then** 系统通过 URL 关键词 "wolong" 匹配到卧龙模板
**And** 自动填充该站点的分类映射

### 场景 5：模板应用后展示变更摘要

**Given** 用户对某站点应用了模板预设
**When** 模板应用完成
**Then** 系统展示变更摘要弹窗/Toast：
- 新增映射数：23
- 已存在映射（跳过）：2
- 未识别分类数：5

### 场景 6：模板与现有互斥约束冲突

**Given** 用户已配置：站点 A 的 remote_id="1" 映射到 "动作片"
**When** 对站点 B 应用模板，模板中 remote_id="1" 映射到 "喜剧片"
**Then** 站点 B 的 remote_id="1" 正常映射到 "喜剧片"（互斥约束是站点内的，跨站点不互斥）

### 场景 7：模板数据热更新

**Given** 系统运行中，管理员更新了模板 JSON 文件
**When** 用户下次点击「一键应用常见映射」
**Then** 系统读取最新的模板数据，无需重启服务

---

## 2. API 接口契约

### 2.1 应用模板 — POST /api/sites/{site_id}/apply-template

**请求**：
```http
POST /api/sites/{site_id}/apply-template
Content-Type: application/json
```

请求体为空（系统根据站点名称/URL 自动匹配模板）。

**响应 200**：
```json
{
  "site_id": 1,
  "template_matched": true,
  "template_name": "ffzy",
  "applied": [
    {"remote_id": "1", "name": "动作片"},
    {"remote_id": "2", "name": "喜剧片"}
  ],
  "skipped": [
    {"remote_id": "3", "name": "爱情片", "reason": "already_mapped", "existing_system_name": "爱情片"}
  ],
  "unrecognized": [
    {"remote_id": "30", "name": "福利视频"}
  ],
  "summary": {
    "total_in_template": 30,
    "applied_count": 23,
    "skipped_count": 2,
    "unrecognized_count": 5
  }
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `template_matched` | boolean | 是否成功匹配到模板 |
| `template_name` | string | 匹配到的模板标识名 |
| `applied` | array | 成功应用的映射列表 |
| `skipped` | array | 跳过的映射（已存在） |
| `skipped[].reason` | string | 跳过原因：already_mapped |
| `skipped[].existing_system_name` | string | 当前已映射的系统分类 |
| `unrecognized` | array | 模板中未定义的分类 |
| `summary` | object | 变更摘要 |

**错误响应**：

| 状态码 | 场景 | 响应体 |
|---|---|---|
| 404 | site_id 不存在 | `{"detail": "Site not found"}` |
| 404 | 无匹配模板 | `{"detail": "暂无该站点的预设模板"}` |
| 502 | 站点未拉取远程分类 | `{"detail": "请先拉取远程分类列表"}` |

### 2.2 预览模板（可选）— GET /api/sites/{site_id}/template-preview

**请求**：
```http
GET /api/sites/{site_id}/template-preview
```

**响应 200**：
```json
{
  "site_id": 1,
  "template_matched": true,
  "template_name": "ffzy",
  "would_apply": 23,
  "would_skip": 2,
  "would_unrecognized": 5,
  "preview": [
    {"remote_id": "1", "name": "动作片", "action": "apply"},
    {"remote_id": "3", "name": "爱情片", "action": "skip", "existing": "爱情片"}
  ]
}
```

此接口用于用户点击「一键应用」前预览变更，不实际修改数据。

---

## 3. 模板数据格式

### 3.1 存储位置

```
backend/
  data/
    category_templates.json    # 模板配置文件
```

### 3.2 模板 JSON 结构

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

### 3.3 模板匹配逻辑

```python
def match_template(site: Site) -> Template | None:
    """
    按优先级匹配模板：
    1. URL 关键词匹配（最高优先级）
    2. 站点名称关键词匹配
    3. 返回第一个匹配到的模板
    """
    site_url = site.base_url.lower()
    site_name = site.name.lower()

    for template in templates:
        # URL 匹配
        for kw in template.match_rules.url_keywords:
            if kw.lower() in site_url:
                return template
        # 名称匹配
        for kw in template.match_rules.site_name_keywords:
            if kw.lower() in site_name:
                return template

    return None
```

---

## 4. 数据模型/类型定义

### 4.1 后端 Pydantic Schema（新增）

```python
class TemplateMatchRules(BaseModel):
    site_name_keywords: list[str]
    url_keywords: list[str]

class CategoryTemplate(BaseModel):
    name: str
    match_rules: TemplateMatchRules
    mappings: dict[str, str]  # remote_id -> system_name

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
    applied: list[CategoryMapping]
    skipped: list[TemplateApplySkipped]
    unrecognized: list[TemplateApplyUnrecognized]
    summary: TemplateApplySummary
```

### 4.2 前端 TypeScript 类型（新增）

```typescript
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
```

---

## 5. 边界条件和异常场景

| 场景 | 预期行为 |
|---|---|
| 模板中 remote_id 不在站点实际分类中 | 忽略该条目，不计入 summary |
| 站点实际分类中有模板未覆盖的条目 | 归入 unrecognized |
| 模板 JSON 文件损坏/格式错误 | 启动时记录 error 日志，模板功能不可用，不影响其他功能 |
| 模板文件缺失 | 视为无模板，所有站点返回 404 |
| 同时匹配多个模板 | 按模板数组顺序，返回第一个匹配 |
| 用户修改站点名称后再次应用模板 | 重新匹配，行为与首次一致 |
| 模板中映射到不存在的系统分类 | 后端允许保存（系统分类无校验），前端展示时按名称匹配 |

---

## 6. 性能约束指标

| 指标 | 目标值 | 测试方法 |
|---|---|---|
| 模板匹配耗时 | <= 10ms | 单次匹配 |
| 模板应用耗时（30 条映射） | <= 100ms | 含数据库写入 |
| 模板文件加载 | 启动时一次性加载 | 文件大小 < 50KB |
| 内存占用 | 模板常驻内存 | < 1MB |

---

## 7. 模板维护指南

### 7.1 新增站点模板

1. 调研该站点的分类列表（通过 fetch-categories 获取）
2. 在 `data/category_templates.json` 中新增模板对象
3. 填写 match_rules（名称关键词 + URL 关键词）
4. 填写 mappings（remote_id -> system_name）
5. 重启后端或等待热重载

### 7.2 模板版本管理

- JSON 中 `version` 字段用于未来格式升级时做兼容性判断
- 当前版本 "1.0"，未来如需扩展格式，递增版本号

### 7.3 已确认模板覆盖的站点

| 模板名 | 覆盖站点特征 | 状态 |
|---|---|---|
| ffzy | 非凡资源、ffzy 域名 | 已确认 |
| 360zy | 360 资源、360zy 域名 | 已确认 |
| wolong | 卧龙资源、wolong 域名 | 已确认 |
| 爱蛋 | 爱蛋资源 | 待补充（含成人内容过滤） |
| hongniu | 红牛资源 | 待调研 |
| lzi | 量子资源 | 待调研 |
| tianyi | 天翼资源 | 待调研 |

---

## 8. UI 交互设计要点

1. **按钮位置**：在 CategorySettings 组件的按钮区新增「一键应用常见映射」按钮
2. **确认对话框**：点击后弹出确认框，展示 `template-preview` 返回的预览摘要
3. **应用后反馈**：Toast 通知展示 `summary` 信息
4. **未识别分类处理**：展示未识别分类列表，提供「使用智能匹配」快捷入口（联动 AC-026）
5. **无模板提示**：未知站点按钮置灰，hover 提示「暂无该站点的预设模板」

```
[重新拉取各站分类] [加载默认分类] [自动匹配] [一键应用常见映射 ▼] [保存映射]
                                          │
                                          ▼
                                    ┌─────────────┐
                                    │ 确认应用模板？  │
                                    │ ffzy 模板      │
                                    │ 将应用 23 条映射 │
                                    │ 跳过 2 条（已配置）│
                                    │ 5 条未识别      │
                                    │ [取消] [确认应用]│
                                    └─────────────┘
```
