# AC-023 网络传输优化 — 架构设计方案

## 1. 后端 Gzip 压缩

### 1.1 GZipMiddleware 配置

在 `backend/app/main.py` 中注册 `GZipMiddleware`，配置如下：

```python
from fastapi.middleware.gzip import GZipMiddleware

app.add_middleware(
    GZipMiddleware,
    minimum_size=500,      # 低于 500 bytes 不压缩，避免小响应压缩后反而变大
    compresslevel=5,       # 压缩级别 1-9，5 为速度与压缩率的平衡值
)
```

**注册位置**：在 `CORSMiddleware` 之后、路由注册之前（或之后均可，FastAPI 中间件按添加顺序逆序执行）。建议放在 CORS 之后：

```python
app.add_middleware(CORSMiddleware, ...)          # 第 1 个 add
app.add_middleware(GZipMiddleware, ...)          # 第 2 个 add
# 实际执行顺序：GZip → CORS → 路由处理
```

### 1.2 与现有中间件的兼容性分析

| 组件 | 兼容性 | 说明 |
|------|--------|------|
| `CORSMiddleware` | 兼容 | CORS 处理在 GZip 之前，响应头（含 `Access-Control-*`）会被正常添加后再压缩 |
| `CacheControlStaticFiles` | 兼容 | 静态文件响应由 `StaticFiles` 直接处理，不走 GZipMiddleware（静态文件压缩由 nginx/CDN 层负责，本 AC 不处理） |
| SSE 端点 (`/api/sse`) | **需排除** | 流式响应不能被压缩，见第 5 节风险评估 |

### 1.3 压缩范围

**需要压缩的端点**：所有 JSON API 响应（`Content-Type: application/json`），包括：
- `GET /api/videos`
- `GET /api/videos/search`
- `POST /api/videos/detail`
- `GET /api/videos/crawler/*`
- `GET /api/play/episodes`
- `GET/POST /api/downloads/*`
- `GET/POST /api/favorites/*`
- `GET/POST /api/progress/*`
- `GET /api/sites/*`
- `GET /api/settings/*`
- `GET /api/health`

**不需要压缩的端点**：
- 静态文件（JS/CSS/图片/HTML）— 由 `CacheControlStaticFiles` 托管
- SSE 流式端点 (`/api/sse`) — 流式响应不能被缓冲压缩

> GZipMiddleware 自动根据 `Content-Type` 和响应大小判断是否压缩，无需手动排除静态文件（静态文件 Content-Type 不为 `application/json`，且通常由 StaticFiles 直接响应）。SSE 端点需特别处理，见风险评估。

---

## 2. fields 参数设计

### 2.1 白名单模式实现方案

采用**白名单模式**：前端显式声明所需字段，后端只返回白名单内字段；非法字段名静默忽略，不抛 400。

**理由**：
- 黑名单模式（`exclude=actors,director`）无法防御未来新增敏感字段的泄露风险
- 白名单模式让前端显式声明所需数据，天然最小化传输

### 2.2 合法字段清单

基于 `AggregatedVideo` schema（`backend/app/schemas.py:23-27`）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `title` | `str` | 视频标题 |
| `year` | `int \| None` | 年份 |
| `poster_url` | `str \| None` | 封面图 URL |
| `sources` | `list[SourceRef]` | 来源列表（嵌套对象） |

### 2.3 字段过滤实现位置

**实现位置：API 层（`_query_and_aggregate` 函数之后）**

理由：
- Schema 层（Pydantic 模型）做字段过滤需要自定义 `model_dump` 或 `Config.exclude`，侵入性大
- API 层在聚合完成后、返回前做字典过滤，逻辑清晰，不影响数据库查询

**实现方案**：

```python
# 在 _query_and_aggregate 返回后，由 list_videos / search_videos 调用

ALLOWED_FIELDS = {"title", "year", "poster_url", "sources"}

def _filter_fields(items: list[dict], fields: str | None) -> list[dict]:
    """白名单字段过滤。fields 为逗号分隔字段名，非法字段静默忽略。"""
    if not fields:
        return items  # 无 fields 参数，返回完整字段（向后兼容）

    requested = {f.strip() for f in fields.split(",")}
    valid = requested & ALLOWED_FIELDS
    if not valid:
        return items  # 无有效字段，返回完整字段（防御性处理）

    return [{k: v for k, v in item.items() if k in valid} for item in items]
```

**调用点**：
- `list_videos` 函数：在 `await _query_and_aggregate(...)` 返回后，对 `response.items` 做过滤
- `search_videos` 函数：同上

### 2.4 嵌套字段（sources）的处理策略

- 若请求 `fields=sources`，返回完整的 `SourceRef[]` 数组（不做子字段过滤）
- 暂不支持对 `sources` 做子字段过滤（如 `fields=sources.site_id`），理由：
  - 增加复杂度，收益有限（SourceRef 本身字段不多）
  - 前端通常需要 sources 的完整信息用于选源/跳转

### 2.5 非法字段的静默忽略策略

- 非法/未知字段名：直接忽略，不抛 400
- 全部字段均非法（如 `fields=foobar,baz`）：防御性返回完整字段（避免前端因拼写错误得到空对象）
- 空字符串（`fields=`）：视为未传，返回完整字段

### 2.6 向后兼容

- 无 `fields` 参数时：保持现有行为，返回完整 `AggregatedVideo` 全部字段
- 有 `fields` 参数时：返回白名单交集字段

---

## 3. 移动端分页策略

### 3.1 移动端检测方式

采用**双轨检测**：

1. **后端 User-Agent 解析**：检查 `User-Agent` 头是否包含 `"Mobile"`、`"Android"`、`"iPhone"`、`"iPad"` 等关键字
2. **前端显式传参**：前端通过查询参数 `?device=mobile` 显式声明

**判定逻辑**：任一方式命中即视为移动端。

**理由**：
- 纯 User-Agent 解析在代理/自定义浏览器场景下不可靠
- 纯前端传参在直接 curl/第三方调用场景下缺失
- 双轨互补，覆盖更多场景

**前端自动传参逻辑**：
```typescript
// 前端请求封装层中自动追加 device 参数
const isMobile = window.matchMedia("(max-width: 768px)").matches 
              || /Mobi|Android|iPhone/i.test(navigator.userAgent);
const deviceParam = isMobile ? "mobile" : undefined;
```

### 3.2 pg_size 查询参数设计

新增可选查询参数：

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `pg_size` | `int` | 移动端 12 / 桌面端 20 | 每页条数 |
| `device` | `str` | 无 | 显式设备类型：`mobile` 或 `desktop` |

**优先级**：`pg_size` 显式传值 > 设备类型默认值 > 桌面端默认值（20）

### 3.3 默认值与上限保护

```python
MAX_PAGE_SIZE = 100
DEFAULT_DESKTOP_PAGE_SIZE = 20
DEFAULT_MOBILE_PAGE_SIZE = 12

def _detect_mobile(request) -> bool:
    """双轨检测移动端。"""
    ua = request.headers.get("User-Agent", "")
    device_param = request.query_params.get("device", "")
    return (
        device_param == "mobile"
        or "Mobile" in ua
        or "Android" in ua
        or "iPhone" in ua
        or "iPad" in ua
    )

def _get_page_size(request, pg_size: int | None) -> int:
    if pg_size is not None:
        return min(max(pg_size, 1), MAX_PAGE_SIZE)
    if _detect_mobile(request):
        return DEFAULT_MOBILE_PAGE_SIZE
    return DEFAULT_DESKTOP_PAGE_SIZE
```

### 3.4 _query_and_aggregate 函数参数签名修改

```python
# 修改前
async def _query_and_aggregate(
    db: AsyncSession,
    filters: list[tuple[int, int | None]],
    wd: str | None,
    mode: str,
    pg: int | None = 1,
) -> AggregatedListResponse:

# 修改后
async def _query_and_aggregate(
    db: AsyncSession,
    filters: list[tuple[int, int | None]],
    wd: str | None,
    mode: str,
    pg: int | None = 1,
    per_page: int = 20,  # 新增：由调用方传入计算后的分页大小
) -> AggregatedListResponse:
```

**调用方修改**：
- `list_videos`：接收 `pg_size` 和 `device` 参数，计算 `per_page` 后传入
- `search_videos`：同上

**内部逻辑调整**：
```python
# 原硬编码
per_page = 20
# 改为参数传入
per_page = per_page  # 使用传入值
raw_limit = per_page * 20  # 放大倍数不变
```

---

## 4. 前端懒加载与缓存

### 4.1 封面图懒加载

**现状**：`VideoCard.tsx:129` 已使用原生 `loading="lazy"` 属性：

```tsx
<img src={poster} alt={item.title} loading="lazy" ... />
```

**验证结果**：原生 `loading="lazy"` 已满足需求，无需引入 IntersectionObserver 或第三方库。

**浏览器支持**：
- Chrome 76+、Firefox 75+、Safari 16+、Edge 79+ 均原生支持
- 不支持的老浏览器会回退到立即加载（渐进增强，无负面影响）

**验收标准**：
- 首页加载时，视口外图片不发起请求
- 缓慢滚动时，图片在进入视口附近时触发请求
- 100 张卡片初始加载时，图片请求数 <= 15（浏览器预留 buffer）

### 4.2 IntersectionObserver 增强评估

**结论：不需要。**

理由：
- `loading="lazy"` 底层已由浏览器使用 IntersectionObserver 实现
- 手动引入 IntersectionObserver 不会带来额外收益
- 增加代码复杂度，无必要性

### 4.3 移动端缓存 TTL 动态调整

**检测方式**：

```typescript
// cache.ts 中新增移动端检测
function isMobileDevice(): boolean {
  // 方式 1: 网络类型
  const conn = (navigator as any).connection;
  if (conn?.effectiveType === "2g" || conn?.effectiveType === "3g") {
    return true;
  }
  // 方式 2: 屏幕宽度
  if (window.innerWidth < 768) {
    return true;
  }
  // 方式 3: User-Agent
  if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
    return true;
  }
  return false;
}
```

**TTL 调整数值**：

| storeName | 桌面端 TTL | 移动端 TTL | 调整比例 |
|-----------|-----------|-----------|---------|
| `aggregated` | 5 分钟 (300s) | 2 分钟 (120s) | ~40% |
| `detail` | 10 分钟 (600s) | 3 分钟 (180s) | ~30% |
| `episodes` | 10 分钟 (600s) | 3 分钟 (180s) | ~30% |

**实现位置**：`cache.ts` 中新增 `getTTL()` 函数

```typescript
// 移动端状态在应用启动时检测一次，存入内存变量
const _isMobile = isMobileDevice();

function getTTL(storeName: string): number {
  const base = TTL_MS[storeName as keyof typeof TTL_MS] || 5 * 60 * 1000;
  if (_isMobile) {
    // 移动端缩短为桌面端的约 1/3 ~ 2/5
    if (storeName === "aggregated") return 2 * 60 * 1000;   // 2 分钟
    if (storeName === "detail") return 3 * 60 * 1000;       // 3 分钟
    if (storeName === "episodes") return 3 * 60 * 1000;     // 3 分钟
  }
  return base;
}
```

**修改点**：
- `get()` 函数中 `const ttl = TTL_MS[storeName...]` 改为 `const ttl = getTTL(storeName)`
- `clearExpiredCache()` 函数中同理

---

## 5. API 契约变更清单

### 5.1 端点变更汇总

| 端点 | 变更 | 向后兼容 |
|------|------|---------|
| `GET /api/videos` | 新增 `fields`（可选，逗号分隔字段名）<br>新增 `pg_size`（可选，整数，1-100）<br>新增 `device`（可选，`mobile`/`desktop`） | 是（无参时保持现有行为） |
| `GET /api/videos/search` | 同上 | 是（无参时保持现有行为） |

### 5.2 api-contract.yaml 更新

在 `API-VIDEO-LIST` 和 `API-VIDEO-SEARCH` 的 `query_params` 中新增：

```yaml
      - name: fields
        type: str
        required: false
        description: 逗号分隔的字段白名单，合法值 title,year,poster_url,sources
      - name: pg_size
        type: int
        required: false
        default: 20（桌面端）/ 12（移动端）
        description: 每页条数，最大 100
      - name: device
        type: str
        required: false
        enum: [mobile, desktop]
        description: 显式声明设备类型，用于分页默认值计算
```

---

## 6. 新增/修改文件清单

### 后端

| 文件 | 操作 | 变更内容 |
|------|------|---------|
| `backend/app/main.py` | 修改 | 注册 `GZipMiddleware` |
| `backend/app/api/videos.py` | 修改 | 1. `_query_and_aggregate` 新增 `per_page` 参数<br>2. `list_videos` 新增 `fields`、`pg_size`、`device` 参数处理<br>3. `search_videos` 同上<br>4. 新增 `_filter_fields` 辅助函数<br>5. 新增 `_detect_mobile`、`_get_page_size` 辅助函数 |
| `docs/registry/api-contract.yaml` | 修改 | 更新 `API-VIDEO-LIST` 和 `API-VIDEO-SEARCH` 的 query_params |

### 前端

| 文件 | 操作 | 变更内容 |
|------|------|---------|
| `frontend/src/utils/cache.ts` | 修改 | 1. `TTL_MS` 常量保留作为桌面端基准<br>2. 新增 `isMobileDevice()` 检测函数<br>3. 新增 `getTTL()` 动态 TTL 函数<br>4. `get()` 和 `clearExpiredCache()` 中改用 `getTTL()` |
| `frontend/src/api/videos.ts`（或请求封装层） | 修改 | 自动追加 `device=mobile` 参数（若检测到移动端） |

---

## 7. 风险评估

### 7.1 GzipMiddleware 与 SSE 的兼容性

**风险**：GzipMiddleware 可能尝试压缩 SSE 流式响应，导致事件推送延迟或客户端解析失败。

**缓解措施**：
- SSE 端点 `/api/sse` 的响应 `Content-Type` 为 `text/event-stream`
- Starlette 的 `GZipMiddleware` 默认不压缩 `text/event-stream`（通过 `media_type` 判断，流式响应通常不会被缓冲压缩）
- **验证**：ATDD 测试阶段需确认 SSE 响应头不含 `Content-Encoding: gzip`

### 7.2 fields 参数对查询性能的影响

**风险**：字段过滤在聚合后、序列化前进行，对数据库查询无影响，但增加了一层字典遍历。

**评估**：
- 每页最多 20 条记录，字典过滤开销可忽略（O(n) 遍历，n=20）
- 无 fields 参数时无额外开销
- **缓解**：无需特别优化

### 7.3 分页默认值变更对前端分页逻辑的影响

**风险**：移动端默认 12 条 vs 桌面端 20 条，前端分页逻辑（如页码计算、"加载更多"按钮）可能受影响。

**评估**：
- 当前前端使用"无限滚动"（IntersectionObserver 触发加载更多），无显式页码计算
- 每页条数变化不影响前端逻辑（前端只关心是否有下一页，不关心每页具体条数）
- **缓解**：ATDD 验证移动端和桌面端滚动加载行为一致

### 7.4 移动端检测的准确性

**风险**：User-Agent 解析可能误判（如桌面浏览器开移动端模拟模式）。

**评估**：
- 前端 `device=mobile` 显式传参优先级高于 UA 解析，可覆盖误判场景
- 平板设备（iPad）屏幕宽度 >= 768px 时不会被判定为移动端，符合预期（平板通常有 WiFi，无需缩小分页）
- **缓解**：双轨检测已足够覆盖主要场景

---

## 8. 实现优先级

| 优先级 | 项 | 工作量 | 影响面 |
|-------|---|--------|--------|
| P0 | GzipMiddleware 注册 | 极小（2 行代码） | 全局 JSON 响应 |
| P0 | fields 参数 | 中等 | 列表/搜索 API |
| P0 | 移动端分页 | 小 | 列表/搜索 API |
| P1 | 封面图懒加载验证 | 极小（已存在） | VideoCard 组件 |
| P1 | 移动端缓存 TTL | 小 | cache.ts |
| P2 | api-contract.yaml 更新 | 极小 | 文档 |
