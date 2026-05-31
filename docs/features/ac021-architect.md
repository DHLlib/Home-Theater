# AC-021 架构设计：移动端响应式布局与导航

## 1. 断点策略

### 1.1 断点数值

| 设备 | 断点 | 标识 |
|------|------|------|
| 手机 | `< 768px` | `mobile` |
| 平板 | `768px ~ 1023px` | `tablet` |
| 桌面 | `>= 1024px` | `desktop` |

### 1.2 CSS 媒体查询 vs JS 检测的分工边界

| 职责 | 技术方案 | 理由 |
|------|----------|------|
| 布局、字体、间距、显示/隐藏 | CSS 媒体查询 | 零 JS 开销，浏览器原生优化 |
| 组件条件渲染（如 Player sidebar 初始状态） | `useIsMobile()` hook | 需要 JS 逻辑判断初始状态 |
| hover 替代方案 | `@media (hover: none)` + `@media (hover: hover)` | 精准区分触摸/指针设备，不依赖视口宽度 |
| 底部 Tab 栏显隐 | CSS 媒体查询 (`display: none` / `display: flex`) | 纯样式切换，无需 JS |

### 1.3 断点常量定义

```typescript
// frontend/src/hooks/useViewport.ts
export const BREAKPOINTS = {
  MOBILE_MAX: 767,
  TABLET_MIN: 768,
  TABLET_MAX: 1023,
  DESKTOP_MIN: 1024,
} as const;
```

---

## 2. 新增/修改组件清单

| 组件名 | 类型 | 职责 | 依赖 | 新建/修改 |
|--------|------|------|------|-----------|
| `useViewport` | hook | 返回 `{ width, height, isMobile, isTablet, isDesktop }`，基于 `window.innerWidth` + resize 监听（debounce 150ms） | - | **新建** |
| `useIsMobile` | hook | 返回 `boolean`，`useViewport` 的简化版 | `useViewport` | **新建** |
| `BottomNav` | 组件 | 移动端底部固定 Tab 栏（首页/搜索/收藏/设置），图标+文字，高度 56px | `react-router-dom` | **新建** |
| `MobileSearchBar` | 组件 | 移动端首页顶部搜索栏（替代顶部 nav 中的搜索框），点击展开全屏搜索 | - | **新建** |
| `MobileSidebar` | 组件 | Player 页底部抽屉式选集面板，高度 50-60vh，支持滑动关闭 | - | **新建** |
| `BottomSheet` | 组件 | 通用底部滑出容器（SourcePicker、EpisodePicker 复用），支持拖拽指示条+下滑关闭 | - | **新建** |
| `Layout` | 组件 | 改造：`< 768px` 隐藏 `<nav>`，显示 `<BottomNav>`；`>= 768px` 保持现有行为 | `BottomNav` | **修改** |
| `VideoCard` | 组件 | 改造：移动端 `showOverlay={false}`，hover 效果在 `@media (hover: none)` 下禁用 | - | **修改** |
| `CategoryBar` | 组件 | 改造：移动端 `flex-wrap` 改为横向滚动（`overflow-x: auto`，隐藏滚动条） | - | **修改** |
| `Home` | 页面 | 改造：移动端 `.grid` 强制 2 列，骨架屏同步；添加 `MobileSearchBar` | `MobileSearchBar` | **修改** |
| `Detail` | 页面 | 改造：移动端单栏堆叠（海报 100% 宽度），操作按钮横向均分 | - | **修改** |
| `Player` | 页面 | 改造：移动端 sidebar 默认关闭，使用 `MobileSidebar` 抽屉；播放器 100% 宽度 | `useIsMobile`, `MobileSidebar` | **修改** |
| `SourcePicker` | 组件 | 改造：移动端使用 `BottomSheet` 替代居中弹窗 | `BottomSheet` | **修改** |
| `Favorites` | 页面 | 改造：移动端列表项垂直堆叠，触摸目标 >= 44px | - | **修改** |
| `Settings` | 页面 | 改造：移动端表单元素 100% 宽度，输入框 >= 44px，Tab 菜单保持可用 | - | **修改** |
| `global.css` | 样式 | 改造：新增响应式断点、移动端 grid 列数、触摸目标尺寸、hover 媒体查询覆盖 | - | **修改** |

---

## 3. 各页面改造方案

### 3.1 Layout.tsx（导航布局）

**当前问题**：顶部水平导航栏 + 搜索框 + 主题切换，所有元素在移动端均不可用的宽度。

**改造策略**：
1. 保留现有 `<nav>` 结构不变，用 CSS 媒体查询在 `< 768px` 时 `display: none`
2. 在 `<div>` 底部插入 `<BottomNav>` 组件，用 CSS 媒体查询在 `>= 768px` 时 `display: none`
3. `main` 在移动端增加底部 padding（`padding-bottom: 72px`）避免内容被 BottomNav 遮挡

**新增/修改代码位置**：
- 修改 `frontend/src/components/Layout.tsx`：插入 BottomNav，调整 main padding
- 新建 `frontend/src/components/BottomNav.tsx`

### 3.2 Home.tsx（首页）

**当前问题**：
- `.grid` 使用 `auto-fill, minmax(200px, 1fr)`，在 375px 屏幕上只有 1 列且卡片极小
- 搜索框在顶部 nav 中，移动端不可见
- `ScrollRow` 的左右箭头依赖 hover 显示

**改造策略**：
1. `.grid` 在手机端强制 2 列（`grid-template-columns: repeat(2, 1fr)`），平板 3 列
2. 骨架屏同步使用相同的 grid 列数
3. 移动端在页面顶部添加 `MobileSearchBar`
4. `ScrollRow` 的箭头在移动端始终可见（`opacity: 1`）或隐藏（仅手指滑动）
5. 搜索结果网格同样适配 2 列

**新增/修改代码位置**：
- 修改 `frontend/src/pages/Home.tsx`：条件渲染 `MobileSearchBar`
- 修改 `frontend/src/styles/global.css`：响应式 `.grid` 规则

### 3.3 CategoryBar.tsx（分类栏）

**当前问题**：`flex-wrap` 换行导致分类栏高度不固定，移动端占用过多垂直空间。

**改造策略**：
1. 移动端：容器改为 `flex-wrap: nowrap`，`overflow-x: auto`，隐藏滚动条
2. 隐藏"更多/收起"按钮（横向滚动替代展开/收起）
3. "全部"按钮始终固定在左侧（`position: sticky; left: 0`）
4. 分类按钮 `min-height: 44px`

**新增/修改代码位置**：
- 修改 `frontend/src/components/CategoryBar.tsx`：添加移动端样式类
- 修改 `frontend/src/styles/global.css`：分类栏滚动样式

### 3.4 VideoCard.tsx（视频卡片）

**当前问题**：
- hover 触发 `scale(1.03)` 和阴影
- `.card-overlay` 悬停信息层在触摸设备无法触发
- 标题字体 14px，在移动端可能过大

**改造策略**：
1. 移动端传入 `showOverlay={false}`，overlay 不渲染
2. `@media (hover: none)` 下禁用 `.video-card:hover` 的 transform 和阴影
3. `@media (hover: none)` 下 `.card-overlay` 始终 `opacity: 0`（不显示）
4. 移动端标题字体改为 13px，行高 1.35
5. 卡片点击行为保持不变（直接进入详情页）

**新增/修改代码位置**：
- 修改 `frontend/src/components/VideoCard.tsx`：根据 `showOverlay` prop 控制 overlay
- 修改 `frontend/src/styles/global.css`：`@media (hover: none)` 覆盖 hover 规则

### 3.5 Detail.tsx（详情页）

**当前问题**：
- 两栏布局（海报 220px 固定宽度 + 信息区）
- 操作按钮横向排列但无移动端适配
- 集数选择弹窗（EpisodePicker）为居中弹窗

**改造策略**：
1. 移动端：海报区域 `width: 100%`，`max-height: 60vh`，信息区在下方堆叠
2. 平板：保持双栏或自动调整
3. 操作按钮（播放/下载/收藏）在移动端 `width: 100%` 或均分
4. EpisodePicker 弹窗在移动端使用 `BottomSheet`
5. `EpisodeList` 的集数按钮 `min-height: 44px`

**新增/修改代码位置**：
- 修改 `frontend/src/pages/Detail.tsx`：响应式布局调整
- 修改 `frontend/src/components/EpisodeList.tsx`：触摸目标尺寸

### 3.6 Player.tsx（播放器页）

**当前问题**：
- 左右分栏（播放器 + 220px 选集面板）
- `sidebarOpen` 默认 `true`
- 收起按钮为竖排文字

**改造策略**：
1. 移动端：
   - 布局改为单栏（播放器 100% 宽度）
   - `sidebarOpen` 初始值通过 `useIsMobile()` 判断（移动端 `false`）
   - 右侧选集面板替换为 `MobileSidebar` 底部抽屉
   - 显示"选集"按钮触发抽屉
2. 播放器容器无左右边距（`margin: 0`）
3. 控制按钮（上一集/下一集）`min-height: 44px`
4. 键盘事件逻辑完全保留

**新增/修改代码位置**：
- 修改 `frontend/src/pages/Player.tsx`：条件渲染 MobileSidebar
- 新建 `frontend/src/components/MobileSidebar.tsx`

### 3.7 SourcePicker.tsx（源选择弹窗）

**当前问题**：居中弹窗 `width: min(420px, 92vw)`，在移动端体验不佳。

**改造策略**：
1. 移动端使用 `BottomSheet` 替代现有弹窗结构
2. 桌面端保持现有居中弹窗
3. 源选项 `padding >= 12px`（垂直方向），确保触摸目标 >= 44px

**新增/修改代码位置**：
- 修改 `frontend/src/components/SourcePicker.tsx`：条件渲染 BottomSheet
- 新建 `frontend/src/components/BottomSheet.tsx`

### 3.8 Favorites.tsx / Progress.tsx / Downloads.tsx（列表页）

**当前问题**：使用 `.grid` 布局，在移动端显示不佳。

**改造策略**：
1. 移动端改为垂直列表（每项高度 >= 64px）
2. 触摸目标 >= 44x44px
3. 保持现有功能不变

**新增/修改代码位置**：
- 修改 `frontend/src/pages/Favorites.tsx`
- 修改 `frontend/src/pages/Progress.tsx`
- 修改 `frontend/src/pages/Downloads.tsx`

### 3.9 Settings.tsx（设置页）

**当前问题**：
- Tab 菜单横向排列，在移动端可能溢出
- 表单元素宽度固定
- 日志表格列数多，在移动端横向溢出

**改造策略**：
1. Tab 菜单在移动端允许横向滚动（已有 `flex-wrap: wrap` 可保持）
2. 输入框/选择框 `width: 100%`，`min-height: 44px`
3. 日志表格在移动端改为卡片式列表（或横向滚动）
4. 按钮在移动端 `width: 100%`

**新增/修改代码位置**：
- 修改 `frontend/src/pages/Settings.tsx`

---

## 4. CSS 方案

### 4.1 断点位置

**所有响应式断点内联在 `global.css`**，原因：
- 现有项目已使用全局 CSS 文件管理样式
- 无 CSS-in-JS 或 CSS Modules 基础设施
- 集中管理便于维护，避免分散在各组件中遗漏

### 4.2 与现有主题系统兼容

所有新增响应式样式**必须使用 CSS 变量**，禁止硬编码颜色：

```css
/* 正确 */
@media (max-width: 767px) {
  .bottom-nav {
    background: var(--card);
    border-top: 1px solid var(--border);
  }
}

/* 错误 */
@media (max-width: 767px) {
  .bottom-nav {
    background: #fff; /* 不兼容深色主题 */
  }
}
```

特别注意：
- `card-overlay` 的 `linear-gradient(to top, rgba(0,0,0,0.9) ...)` 在深色主题下仍可接受（本身就是遮罩层），但需测试可读性
- `spinner-overlay` 的 `background: rgba(0, 0, 0, 0.5)` 是半透明黑色，两套主题均适用

### 4.3 hover 替代方案具体实现

```css
/* === 桌面端：保持 hover === */
@media (hover: hover) {
  .video-card:hover {
    transform: scale(1.03);
  }
  .video-card:hover .poster-wrap {
    box-shadow: 0 0 20px rgba(13, 148, 136, 0.15);
  }
  .video-card:hover .card-overlay {
    opacity: 1;
  }
  .scroll-row-wrap:hover .scroll-arrow {
    opacity: 1;
  }
}

/* === 触摸设备：禁用 hover，改用 active 反馈 === */
@media (hover: none) {
  .video-card:active {
    transform: scale(0.98);
  }
  .video-card .card-overlay {
    display: none; /* 触摸设备不显示 overlay */
  }
  .scroll-arrow {
    opacity: 1; /* 始终可见，或改为 display: none */
  }
}
```

### 4.4 新增 CSS 规则清单

```css
/* global.css 新增内容 */

/* --- 响应式 Grid --- */
@media (max-width: 767px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
}

/* --- 底部导航栏 --- */
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: var(--card);
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: space-around;
  align-items: center;
  z-index: var(--z-nav);
}

.bottom-nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 100%;
  min-width: 44px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 11px;
  transition: color var(--transition-fast);
}

.bottom-nav-item.active {
  color: var(--primary);
}

/* --- 移动端 main padding --- */
@media (max-width: 767px) {
  main {
    padding: 12px 12px 72px 12px; /* 底部预留 BottomNav 高度 */
  }
}

/* --- 底部抽屉 --- */
.bottom-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--card);
  border-radius: 16px 16px 0 0;
  border-top: 1px solid var(--border);
  max-height: 60vh;
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
}

.bottom-sheet-handle {
  width: 36px;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  margin: 8px auto;
  flex-shrink: 0;
}

.bottom-sheet-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
}

/* --- 遮罩层 --- */
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: calc(var(--z-modal) - 1);
}

/* --- 触摸目标最小尺寸 --- */
@media (max-width: 767px) {
  .btn,
  .nav-link,
  input[type="text"],
  input[type="search"],
  select,
  textarea {
    min-height: 44px;
  }
}

/* --- 分类栏横向滚动 --- */
@media (max-width: 767px) {
  .category-bar-scroll {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    flex-wrap: nowrap;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .category-bar-scroll::-webkit-scrollbar {
    display: none;
  }
}
```

---

## 5. 路由与导航映射

### 5.1 底部 Tab 栏 4 个入口

| Tab 图标+文字 | 路由 | 说明 |
|--------------|------|------|
| 首页 | `/` | 直接映射 |
| 搜索 | `/?search=1` 或 `/` 顶部搜索栏 | 点击后首页顶部显示搜索输入框，或进入全屏搜索状态 |
| 收藏 | `/favorites` | 直接映射 |
| 设置 | `/settings` | 直接映射 |

### 5.2 "最近"和"下载"的收纳方案

**方案：收纳到设置页内**

在 `Settings.tsx` 的 Tab 菜单中新增两个入口：

```
设置页 Tab 菜单（移动端扩展）：
├─ 采集站管理
├─ 分类设置
├─ 下载根目录
├─ 缓存管理
├─ 刮削日志
├─ 我的下载  ← 新增（路由跳转 /downloads）
├─ 播放记录  ← 新增（路由跳转 /progress）
└─ 主题切换  ← 新增（从顶部 nav 移入）
```

理由：
- "最近"和"下载"使用频率低于首页/收藏
- 设置页已有 Tab 菜单基础设施，新增入口成本低
- 底部 Tab 保持 4 个（业界惯例，避免过多）

### 5.3 搜索交互流程（移动端）

```
用户点击底部 Tab "搜索"
  → 当前在首页：滚动到顶部，聚焦搜索输入框
  → 当前不在首页：导航到 /，然后聚焦搜索输入框
  → 输入搜索词后：显示搜索结果（2 列网格）
```

---

## 6. 风险评估

### 6.1 最大改造量页面

| 排名 | 页面 | 改造量 | 原因 |
|------|------|--------|------|
| 1 | `Player.tsx` | 高 | 布局从左右分栏改为单栏+抽屉，sidebar 状态逻辑需重构 |
| 2 | `Settings.tsx` | 中高 | 日志表格在移动端需大改，新增"我的下载"/"播放记录"入口 |
| 3 | `Layout.tsx` | 中 | 需新增 BottomNav 组件，导航逻辑需适配 |
| 4 | `Detail.tsx` | 中 | 两栏改单栏，EpisodePicker 改 BottomSheet |

### 6.2 最可能回归的交互

| 交互 | 风险 | 缓解措施 |
|------|------|----------|
| Player 键盘事件（左右快进/快退） | 布局改动可能导致 `containerRef` 焦点丢失 | 确保 `tabIndex={0}` 和 `autoFocus` 逻辑不变，改造后手动测试键盘事件 |
| VideoCard 点击跳转详情 | overlay 移除后点击区域变化 | 保持卡片整体为点击区域，确保 `stopPropagation` 逻辑正确 |
| SourcePicker 源选择确认 | 改为 BottomSheet 后状态管理需同步 | 保持 `picked` state 和 `onConfirm` 回调不变，仅改渲染方式 |
| 主题切换 | 从顶部 nav 移入设置页后用户找不到 | 在设置页 Tab 菜单中高亮显示主题切换入口 |
| 无限滚动 sentinel | 底部 padding 增加可能导致触发时机变化 | 确保 `rootMargin: "300px"` 仍然有效，测试加载更多 |

### 6.3 与现有主题系统的兼容性风险

| 风险点 | 等级 | 说明 |
|--------|------|------|
| BottomNav / BottomSheet 背景色 | 低 | 使用 `var(--card)` 和 `var(--border)`，两套主题均有定义 |
| 遮罩层 `rgba(0,0,0,0.55)` | 低 | 半透明黑色，在浅色/深色背景上均有效 |
| 移动端新增硬编码颜色 | 中 | 需代码审查确保无 `#fff`、`#000` 等硬编码 |
| `card-overlay` 渐变遮罩 | 低 | 本身就是黑色渐变，不依赖主题变量 |
| 焦点环颜色 | 低 | 使用 `var(--primary)`，已兼容两套主题 |

### 6.4 性能风险

| 风险点 | 等级 | 说明 |
|--------|------|------|
| `useViewport` resize 监听 | 低 | debounce 150ms 足够，且仅在需要 JS 判断的组件使用 |
| CSS 媒体查询开销 | 无 | 浏览器原生优化，零运行时开销 |
| BottomSheet 动画 | 低 | 使用 CSS `transform` 和 `transition`，GPU 加速 |

---

## 7. 实现顺序建议

按依赖关系和验收优先级排序：

```
Phase 1（P0 - 核心可用性）
  1. global.css：新增响应式断点、grid 列数、触摸目标尺寸
  2. useViewport / useIsMobile hooks
  3. BottomNav 组件
  4. Layout.tsx：集成 BottomNav，隐藏顶部 nav
  5. Home.tsx：适配 grid、添加 MobileSearchBar
  6. CategoryBar.tsx：移动端横向滚动

Phase 2（P1 - 详情与播放）
  7. VideoCard.tsx：移动端禁用 overlay
  8. Detail.tsx：单栏堆叠布局
  9. BottomSheet 组件
  10. MobileSidebar 组件
  11. Player.tsx：单栏 + 抽屉式选集面板

Phase 3（P2 - 弹窗与列表页）
  12. SourcePicker.tsx：移动端 BottomSheet
  13. Favorites / Progress / Downloads：列表适配
  14. Settings.tsx：表单适配 + 新增入口

Phase 4（验证）
  15. 按 ATDD 场景逐项验证
  16. 主题切换测试（浅色/深色）
  17. 键盘事件回归测试
```

---

## 8. 文件变更清单

| 文件路径 | 操作 | 说明 |
|----------|------|------|
| `frontend/src/hooks/useViewport.ts` | 新建 | 视口检测 hook |
| `frontend/src/components/BottomNav.tsx` | 新建 | 底部 Tab 栏 |
| `frontend/src/components/MobileSearchBar.tsx` | 新建 | 移动端搜索栏 |
| `frontend/src/components/MobileSidebar.tsx` | 新建 | 播放器选集抽屉 |
| `frontend/src/components/BottomSheet.tsx` | 新建 | 通用底部滑出容器 |
| `frontend/src/components/Layout.tsx` | 修改 | 集成 BottomNav |
| `frontend/src/components/VideoCard.tsx` | 修改 | 移动端 overlay 控制 |
| `frontend/src/components/CategoryBar.tsx` | 修改 | 横向滚动 |
| `frontend/src/components/SourcePicker.tsx` | 修改 | BottomSheet 适配 |
| `frontend/src/components/EpisodeList.tsx` | 修改 | 触摸目标尺寸 |
| `frontend/src/pages/Home.tsx` | 修改 | 响应式适配 |
| `frontend/src/pages/Detail.tsx` | 修改 | 单栏布局 |
| `frontend/src/pages/Player.tsx` | 修改 | 抽屉式选集 |
| `frontend/src/pages/Favorites.tsx` | 修改 | 列表适配 |
| `frontend/src/pages/Progress.tsx` | 修改 | 列表适配 |
| `frontend/src/pages/Downloads.tsx` | 修改 | 列表适配 |
| `frontend/src/pages/Settings.tsx` | 修改 | 表单适配 + 新入口 |
| `frontend/src/styles/global.css` | 修改 | 响应式样式 |
