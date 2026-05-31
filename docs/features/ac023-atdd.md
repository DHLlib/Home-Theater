# AC-023 ATDD 验收测试草案

## 背景

本验收测试覆盖「网络传输优化」的全部 Then 子项：

1. 后端启用 Gzip 压缩 JSON 响应
2. 列表 API 支持 `fields` 参数精简字段
3. 分页移动端默认 12 条
4. 前端封面图懒加载、虚拟滚动
5. 移动端缩小缓存 TTL

---

## 场景 1: 后端 Gzip 压缩

**Given** 客户端请求任意 JSON API（如 `GET /api/videos`）  
**When** 请求头包含 `Accept-Encoding: gzip`  
**Then** 响应头包含 `Content-Encoding: gzip`  
**Then** 响应体体积比未压缩减少 >= 50%

### 测试要点

- 在 `backend/app/main.py` 中注册 `GZipMiddleware`，最小压缩阈值建议 `minimum_size=500`（FastAPI 默认值 500 bytes，JSON 列表响应通常远超此值）
- 验证 `/api/videos`、`/api/videos/search`、`/api/videos/detail` 等核心 JSON 端点均返回压缩响应
- 静态文件（JS/CSS/图片）由 `CacheControlStaticFiles` 托管，GzipMiddleware 不处理静态文件；若需压缩静态文件，应由 nginx/CDN 层完成，本 AC 仅要求 JSON API
- 对比测试：同一请求带/不带 `Accept-Encoding: gzip`，验证体积差异 >= 50%

---

## 场景 2: fields 参数精简响应

**Given** 前端请求视频列表  
**When** URL 包含 `fields=id,title,year,poster_url`  
**Then** 响应中每条记录只包含指定字段  
**Then** 未指定字段（如 `actor`, `director`, `content`）不包含在响应中

### 测试要点

- **作用域**：`fields` 参数仅作用于 `GET /api/videos` 和 `GET /api/videos/search` 的列表响应（`AggregatedVideo` 结构）
- **设计模式**：采用**白名单模式**——只允许请求明确列出的字段，非法字段名直接忽略（不报错，不返回）
  - 理由：黑名单模式（`exclude=actors,director`）无法防御未来新增敏感字段的泄露风险；白名单模式让前端显式声明所需数据，天然最小化传输
- **合法字段清单**（基于 `AggregatedVideo` 模型）：`title`, `year`, `poster_url`, `sources`
  - `sources` 为嵌套数组，若请求 `fields=sources`，则返回完整的 `SourceRef[]`；暂不支持对 `sources` 做子字段过滤
- **未指定 fields 时**：保持向后兼容，返回完整 `AggregatedVideo` 全部字段
- **非法/未知字段名**：静默忽略，不抛 400，避免前端因拼写差异而崩溃
- **验证方式**：
  - 请求 `/api/videos?fields=title,year,poster_url`，断言响应每条记录仅含 3 个字段
  - 请求 `/api/videos?fields=title,foobar`，断言响应仅含 `title`，`foobar` 被忽略
  - 请求 `/api/videos`（无 fields），断言返回完整字段

---

## 场景 3: 移动端分页调整

**Given** 客户端 User-Agent 包含 "Mobile" 或前端通过查询参数 `?mobile=1` 标识  
**When** 请求视频列表不带 `pg_size` 参数  
**Then** 默认返回 12 条记录（桌面端保持 20 条）

### 测试要点

- **现状**：`backend/app/api/videos.py:122` 中 `per_page = 20` 为硬编码常量
- **移动端检测方式**：采用**双轨检测**——后端解析 User-Agent + 前端显式传参 `?device=mobile`，任一命中即视为移动端
  - 理由：纯 User-Agent 解析在代理/自定义浏览器场景下不可靠；纯前端传参在直接 curl/第三方调用场景下缺失。双轨互补。
  - 前端在发起列表/搜索请求时，通过 `window.matchMedia("(max-width: 768px)").matches` 或 UA 检测，自动追加 `?device=mobile`
- **参数设计**：
  - 新增可选查询参数 `pg_size`（整数），允许前端显式覆盖每页条数
  - 未传 `pg_size` 时：移动端默认 12，桌面端默认 20
  - 传了 `pg_size` 时：以传入值为准（需做上限保护，如最大 100）
- **影响范围**：`GET /api/videos` 和 `GET /api/videos/search` 的 `_query_and_aggregate` 函数
- **验证方式**：
  - 桌面 UA 请求 `/api/videos`，断言返回 <= 20 条
  - Mobile UA 请求 `/api/videos`，断言返回 <= 12 条
  - 请求 `/api/videos?pg_size=5`，断言返回 <= 5 条
  - 请求 `/api/videos?pg_size=200`，断言返回 <= 100 条（上限保护）

---

## 场景 4: 封面图懒加载

**Given** 首页有 100 个视频卡片  
**When** 用户只滚动到前 10 个卡片可见区域  
**Then** 只有前 10-15 个卡片的 `poster_url` 被请求  
**Then** 其余卡片的图片加载被延迟

### 测试要点

- **现状**：`VideoCard.tsx:129` 已使用原生 `loading="lazy"` 属性，浏览器层面已具备懒加载能力
- **验收标准**：原生 `loading="lazy"` 已满足「延迟加载」要求，无需引入第三方库
- **验证方式（手动/自动化）**：
  - 打开首页，不滚动，检查 Network 面板，确认视口外图片无请求
  - 缓慢滚动，确认图片在进入视口附近时才触发请求
  - 100 张卡片初始加载时，图片请求数 <= 15（浏览器通常预留一定 buffer）
- **虚拟滚动（补充说明）**：
  - 当前首页使用 CSS Grid + 无限滚动（IntersectionObserver 触发加载更多），非虚拟滚动
  - 虚拟滚动（react-window / react-virtualized）对 100+ 长列表有显著性能提升，但实现成本较高（需固定行高、滚动位置同步）
  - **建议**：本 AC 先以 `loading="lazy"` 满足懒加载需求；若后续列表长度超过 500+ 再评估虚拟滚动

---

## 场景 5: 移动端缓存 TTL 调整

**Given** 用户通过移动网络访问  
**When** 前端 IndexedDB 缓存数据时  
**Then** 移动端缓存 TTL 缩短为桌面端的 1/3

### 测试要点

- **现状**：`frontend/src/utils/cache.ts:11-15` 中 TTL 为硬编码常量
  - `aggregated`: 5 分钟
  - `detail`: 10 分钟
  - `episodes`: 10 分钟
- **移动端 TTL 调整**：
  - `aggregated`: 5 分钟 → 约 1.5 分钟（建议取整 2 分钟 = 120 秒）
  - `detail`: 10 分钟 → 约 3 分钟（建议取整 3 分钟 = 180 秒）
  - `episodes`: 10 分钟 → 约 3 分钟（建议取整 3 分钟 = 180 秒）
- **移动端检测**：前端通过 `navigator.connection?.effectiveType`（`2g`/`3g`/`4g`）或屏幕宽度判断
  - `effectiveType` 为 `2g`/`3g` 时视为移动网络，缩短 TTL
  - 屏幕宽度 < 768px 时也视为移动端（WiFi 下的平板/手机同样适用）
- **实现方式**：
  - `cache.ts` 中 `TTL_MS` 改为函数 `getTTL(storeName: string): number`，内部根据移动端状态返回不同值
  - 移动端状态在应用启动时检测一次，存入内存变量（无需持久化）
- **验证方式**：
  - 模拟移动端 UA/窄视口，请求聚合列表，写入缓存，等待 2 分钟后再次请求，断言缓存已过期、重新发起 API 请求
  - 桌面端环境下，等待 2 分钟后再次请求，断言缓存仍有效（未过 5 分钟 TTL）

---

## 场景 6: 虚拟滚动（可选增强）

**Given** 视频列表超过 200 条  
**When** 用户快速滚动  
**Then** 滚动帧率保持 >= 30fps  
**Then** 内存中仅渲染视口内 + buffer 的 DOM 节点

### 测试要点

- **判定条件**：当前实现无虚拟滚动，纯 CSS Grid + 无限滚动。若性能测试发现 200+ 卡片滚动掉帧，则引入虚拟滚动
- **候选方案**：`react-window` 或 `@tanstack/react-virtual`
- **验收标准**：Chrome DevTools Performance 面板录制滚动，主线程帧率 >= 30fps
- **备注**：本场景为可选增强，优先级低于场景 1-5

---

## 实现优先级建议

| 优先级 | 场景 | 工作量 | 影响面 |
|-------|------|--------|--------|
| P0 | 场景 1: Gzip 压缩 | 1 行代码（加 Middleware） | 全局 JSON 响应 |
| P0 | 场景 2: fields 参数 | 中等（修改 `_query_and_aggregate` 返回结构） | 列表/搜索 API |
| P0 | 场景 3: 移动端分页 | 小（修改 per_page 计算逻辑） | 列表/搜索 API |
| P1 | 场景 4: 封面图懒加载 | 已存在（`loading="lazy"`），仅需验证 | VideoCard 组件 |
| P1 | 场景 5: 移动端缓存 TTL | 小（修改 TTL_MS 为动态函数） | cache.ts |
| P2 | 场景 6: 虚拟滚动 | 大（需重构列表渲染） | Home 页面 |
