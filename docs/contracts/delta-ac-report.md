# Delta AC 报告 — 移动端适配

**变更描述**: 新增移动端适配需求，需考虑移动端网络传输问题
**分析日期**: 2026-05-30
**分析模式**: Delta 变更

---

## 新增 AC

### AC-021 移动端响应式布局与导航

**Given** 用户通过手机/平板访问系统
**When** 打开任意页面时
**Then** 页面布局自适应屏幕宽度：
- 首页：网格从 5-6 列降至 2-3 列（手机）/ 3-4 列（平板），卡片尺寸缩小
- 详情页：两栏布局变为单栏堆叠，海报上方/简介下方
- 播放器：播放器全宽，控制条触摸友好（按钮 >= 44px）
- 搜索/收藏/下载/设置/进度页：表格/列表在小屏幕下转为卡片或横向滚动
- 导航栏：屏幕宽度 < 768px 时折叠为底部 Tab 栏或汉堡菜单
- 全局：字体大小适配，触摸目标最小 44x44px，消除 hover 依赖的交互

**技术要点**:
- global.css 新增 `@media (max-width: 768px)` 断点
- Layout.tsx 新增移动端导航检测与切换
- 所有页面组件引入响应式样式
- VideoCard 缩小海报尺寸、简化信息展示

**impl_files**:
- frontend/src/styles/global.css
- frontend/src/components/Layout.tsx
- frontend/src/components/VideoCard.tsx
- frontend/src/pages/Home.tsx
- frontend/src/pages/Detail.tsx
- frontend/src/pages/Player.tsx
- frontend/src/pages/Search.tsx
- frontend/src/pages/Downloads.tsx
- frontend/src/pages/Favorites.tsx
- frontend/src/pages/Progress.tsx
- frontend/src/pages/Settings.tsx

---

### AC-022 播放器触摸交互与手势控制

**Given** 用户在移动端播放视频
**When** 使用触摸操作播放器时
**Then** 支持以下手势：
- 双击屏幕：暂停/播放切换
- 左右滑动：快进/快退（短滑 10s，长滑 30s）
- 上下滑动左侧：亮度调节（如浏览器支持）
- 上下滑动右侧：音量调节（如浏览器支持）
- 全屏按钮：点击后进入全屏模式（requestFullscreen API）
- 控制栏：3秒无操作自动隐藏，点击屏幕唤出

**技术要点**:
- VideoPlayer.tsx 增加 touchstart/touchmove/touchend 事件处理
- 需要防抖/节流避免误触
- 手势冲突处理（滑动 vs 页面滚动）
- 全屏 API 兼容不同浏览器前缀

**impl_files**:
- frontend/src/components/VideoPlayer.tsx
- frontend/src/pages/Player.tsx

---

### AC-023 网络传输优化

**Given** 用户通过移动网络访问（可能弱网/流量敏感）
**When** 系统传输数据时
**Then** 采取以下优化措施：

**后端**:
- 启用 GzipMiddleware，压缩 JSON 响应（通常减少 60-80% 体积）
- 列表 API 支持 `fields` 查询参数，允许前端指定仅需字段（精简响应）
- 分页默认每页从 24 条调整为移动端 12 条（减少单次传输量）

**前端**:
- 封面图懒加载：使用 `loading="lazy"` + Intersection Observer
- 首页/搜索使用虚拟滚动或分页加载，避免一次性渲染大量卡片
- IndexedDB 缓存策略调整：移动端缩小缓存 TTL（列表 3 分钟 vs 桌面 5 分钟）
- 图片使用 `srcset` 适配不同分辨率屏幕
- 非关键 CSS/JS 懒加载（如设置页、分类配置）

**技术要点**:
- backend/app/main.py 增加 GzipMiddleware
- backend/app/api/videos.py 增加 `fields` 参数支持
- frontend/src/components/VideoCard.tsx 增加懒加载
- frontend/src/utils/cache.ts 增加移动端检测与 TTL 调整
- 可能需要新增 hook: frontend/src/hooks/useIsMobile.ts

**impl_files**:
- backend/app/main.py
- backend/app/api/videos.py
- backend/app/schemas.py
- frontend/src/components/VideoCard.tsx
- frontend/src/utils/cache.ts
- frontend/src/pages/Home.tsx
- frontend/src/pages/Search.tsx
- frontend/src/hooks/useIsMobile.ts（新增）

---

## 影响范围总结

| 维度 | 影响 |
|------|------|
| 新增 AC | AC-021, AC-022, AC-023 |
| 修改 AC | 无 |
| 删除 AC | 无 |
| 受影响前端组件 | Layout, VideoCard, VideoPlayer, 所有 pages/*, global.css, cache.ts |
| 受影响后端组件 | main.py, videos.py, schemas.py |
| 新增 API 参数 | `fields` 查询参数（AC-023） |
| 新增文件 | frontend/src/hooks/useIsMobile.ts |
| 处理模式 | Delta 变更 |
| 回退阶段 | 新 AC 从 atdd 开始 |

---

## 风险点

1. **CSS 断点冲突**: 现有样式无响应式设计，大量硬编码尺寸需调整，可能引入回归
2. **播放器手势冲突**: ckplayer 可能有内置触摸处理，手势叠加需注意事件冒泡控制
3. **Gzip 压缩兼容性**: 需确认 httpx 客户端与 FastAPI GzipMiddleware 兼容
4. **性能回归**: 移动端检测和响应式计算可能增加渲染开销
