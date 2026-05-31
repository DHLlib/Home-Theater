# AC-023「网络传输优化」Code Review 报告

**审查日期**: 2026-05-30  
**审查范围**: `backend/app/main.py`, `backend/app/api/videos.py`, `frontend/src/utils/cache.ts`, `frontend/src/api/videos.ts`, `docs/registry/api-contract.yaml`  
**参考文档**: `docs/features/ac023-atdd.md`, `docs/features/ac023-architect.md`

---

## 审查结论

| 项目 | 结果 |
|------|------|
| 后端（5项） | 4 项通过，1 项需关注（SSE 兼容性） |
| 前端（3项） | 3 项通过 |
| 文档（1项） | 1 项通过 |
| **总体** | **通过，附带 1 条低风险建议** |

---

## 后端审查

### 1. GzipMiddleware 注册位置与顺序

**结果：通过**

`backend/app/main.py:66`：

```python
app.add_middleware(CORSMiddleware, ...)   # 第 1 个 add
app.add_middleware(GZipMiddleware, ...)   # 第 2 个 add
```

- 注册在 `CORSMiddleware` 之后，符合架构文档建议。
- FastAPI 中间件按添加顺序**逆序**执行，实际请求处理链为：GZip → CORS → 路由处理。CORS 响应头会在 GZip 压缩前正确添加。
- `StaticFiles` 通过 `app.mount("/", ...)` 注册（L89），在路由注册之后，不走中间件链，不受 GZipMiddleware 影响，符合预期。

### 2. fields 过滤白名单逻辑

**结果：通过**

`backend/app/api/videos.py:35-52`：

- 白名单 `ALLOWED_FIELDS = {"title", "year", "poster_url", "sources"}` 与 ATDD 和架构文档一致。
- 非法字段静默忽略：`_filter_fields` 中 `valid = requested & ALLOWED_FIELDS` 只保留交集，非法字段自然被过滤。
- 空字符串处理：`if not fields:` 在空字符串时返回完整字段（防御性处理），符合 ATDD 场景 2 要求。
- 全部字段非法时返回完整字段：`if not valid: return items`，防御性处理正确。
- 调用点仅在 `list_videos`（L283）和 `search_videos`（L331），未影响其他端点。

### 3. 分页逻辑

**结果：通过**

`backend/app/api/videos.py:55-74`：

- **双轨检测**：`_detect_mobile` 同时检查 `device=mobile` 查询参数和 User-Agent（含 Mobile/Android/iPhone/iPad），任一命中即视为移动端，与 ATDD 一致。
- **上限/下限保护**：`_get_page_size` 中 `min(max(pg_size, 1), MAX_PAGE_SIZE)` 确保结果在 `[1, 100]` 范围内。
- **向后兼容**：未传 `pg_size` 时按设备类型取默认值（桌面 20 / 移动 12），未传 `device` 时按 UA 判断，无参时行为与之前一致。
- `_query_and_aggregate` 已新增 `per_page` 参数（L144），内部 `raw_limit = per_page * 20` 放大倍数不变，逻辑正确。

### 4. API 变更范围

**结果：通过**

- 仅 `GET /api/videos` 和 `GET /api/videos/search` 新增了 `fields`、`pg_size` 参数。
- 其他端点（detail、play、downloads、favorites、progress、sites、settings、health）均未修改，无影响。
- 详情 API (`POST /api/videos/detail`) 未引入 fields 过滤，符合 ATDD "仅作用于列表响应" 的约定。

### 5. SSE 兼容性

**结果：需关注（低风险）**

- `backend/app/main.py:66` 注册的 `GZipMiddleware` 是全局中间件，会作用于所有路由，包括 `/api/sse`。
- 架构文档风险评估（第 7.1 节）指出：Starlette 的 `GZipMiddleware` 默认不压缩 `text/event-stream`，但建议 ATDD 阶段验证。
- **建议**：在 ATDD 测试阶段增加一项验证——请求 `/api/sse` 时确认响应头不含 `Content-Encoding: gzip`，且事件流能正常接收。若发现问题，可在 SSE 路由中通过 `response.headers["Content-Encoding"] = "identity"` 显式排除。

---

## 前端审查

### 6. 缓存 TTL

**结果：通过**

`frontend/src/utils/cache.ts:38-46`：

- `getTTL()` 函数根据 `_isMobile` 状态返回差异化 TTL：
  - `aggregated`: 桌面 5 分钟 → 移动 2 分钟
  - `detail`/`episodes`: 桌面 10 分钟 → 移动 3 分钟
- `get()` 函数（L85）正确调用 `getTTL(storeName)` 判断过期。
- `clearExpiredCache()` 函数（L169）同样正确调用 `getTTL(storeName)` 判断过期。
- 两处调用点均已更新，无遗漏。

### 7. 移动端检测

**结果：通过**

`frontend/src/utils/cache.ts:19-34`：

- **三轨检测**：
  1. `navigator.connection?.effectiveType`（2g/3g）
  2. `window.innerWidth < 768`
  3. `navigator.userAgent` 正则匹配
- 任一命中即视为移动端，覆盖场景全面。
- 启动时只检测一次：`const _isMobile = isMobileDevice()`（L36），结果存入内存变量，后续 `getTTL()` 直接读取，无重复检测开销。

### 8. API 请求 device 参数

**结果：通过**

`frontend/src/api/videos.ts:10-22`：

- `isMobile()` 函数通过视口宽度 + UA 检测移动端。
- `appendDeviceParam()` 在检测到移动端时自动追加 `device=mobile` 参数。
- `listVideos`（L39）和 `searchVideos`（L49）均在构造 URLSearchParams 后调用 `appendDeviceParam(qs)`，参数正确追加。
- 检测逻辑与后端 `_detect_mobile` 的 UA 关键字（Mobile/Android/iPhone）对齐，双轨互补。

---

## 文档审查

### 9. api-contract.yaml 参数描述

**结果：通过**

`docs/registry/api-contract.yaml`：

- `API-VIDEO-LIST`（L108-121）和 `API-VIDEO-SEARCH`（L148-161）均新增了三个参数：
  - `fields`: 描述为 "逗号分隔的字段白名单，合法值 title,year,poster_url,sources" —— 准确。
  - `pg_size`: 描述为 "每页条数，最大 100"，默认值标注为 "20（桌面端）/ 12（移动端）" —— 准确。
  - `device`: 描述为 "显式声明设备类型，用于分页默认值计算"，枚举 `[mobile, desktop]` —— 准确。
- 参数类型、必填性、默认值均与实现代码一致。

---

## 发现的问题与建议

| 优先级 | 问题 | 位置 | 建议 |
|--------|------|------|------|
| P2 | SSE 流式响应未被显式排除 Gzip | `backend/app/main.py:66` | ATDD 阶段增加 SSE 压缩验证；若失败，在 SSE 路由响应中设置 `Content-Encoding: identity` |

---

## 附录：实现与文档对照表

| 需求项 | ATDD 场景 | 架构文档 | 实现文件 | 状态 |
|--------|-----------|----------|----------|------|
| Gzip 压缩 JSON 响应 | 场景 1 | 第 1 节 | `main.py:66` | 已实现 |
| fields 白名单过滤 | 场景 2 | 第 2 节 | `videos.py:35-52` | 已实现 |
| 移动端分页（双轨检测） | 场景 3 | 第 3 节 | `videos.py:55-74` | 已实现 |
| 封面图懒加载 | 场景 4 | 第 4.1 节 | `VideoCard.tsx`（已有） | 已存在 |
| 移动端缓存 TTL | 场景 5 | 第 4.3 节 | `cache.ts:17-46` | 已实现 |
| api-contract.yaml 更新 | — | 第 5.2 节 | `api-contract.yaml` | 已更新 |
