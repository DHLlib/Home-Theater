# AC-021 Review 报告

## 通过项

1. **响应式断点**：正确使用 768px 主断点（`max-width: 767px` / `min-width: 768px`），平板断点 `768px-1023px` 已覆盖（`grid` 3 列）。
2. **useViewport debounce**：`useViewport.ts` 使用 150ms debounce，符合架构要求。
3. **BottomNav 纯 CSS 显隐**：`global.css` 中 `@media (min-width: 768px) { .bottom-nav { display: none } }` 实现，零 JS 开销。
4. **路由兼容**：BottomNav 映射到 `/`、`/search`、`/favorites`、`/settings`，与现有路由一致。
5. **Player.tsx 与 AC-022 兼容**：Player 已使用 `useFullscreen` hook，移动端抽屉式选集面板（`episode-drawer`）与 AC-022 的播放器触摸交互无冲突。
6. **EpisodeList 触摸目标**：集数按钮显式设置 `minHeight: 44, minWidth: 44`，符合 >= 44px 要求。
7. **hover 替代方案**：`@media (hover: hover)` 和 `@media (hover: none)` 正确使用，触摸设备禁用 hover 改用 `:active`。
8. **主题兼容（大部分）**：BottomNav、BottomSheet、遮罩层等均使用 CSS 变量（`var(--card)`、`var(--border)` 等）。
9. **TypeScript 类型**：`useViewport.ts` 导出完整 `ViewportInfo` interface，`BottomSheetProps` 类型定义正确，无 `any` 滥用。
10. **代码风格**：匹配现有项目风格（函数组件、React.memo、内联 style 对象）。

---

## 问题项（按严重级别）

### 🔴 Critical

1. **SourcePicker 移动端和桌面端同时渲染导致事件穿透/双重弹窗**
   - `SourcePicker.tsx` 第 107-154 行：桌面端弹窗（`.source-picker-desktop`）和移动端 BottomSheet（`.source-picker-mobile`）**同时挂载到 DOM**，仅靠 CSS `display: none` 控制显隐。
   - 问题：当 `open=true` 时，桌面端弹窗的遮罩层（`position: fixed; inset: 0; zIndex: 1000`）即使 `display: none` 也可能在某些浏览器中拦截点击事件；且两个弹窗同时存在于 React 树中，可能导致焦点管理、ESC 关闭等冲突。
   - 修复建议：使用 `useIsMobile()` 条件渲染，只挂载一个弹窗实例。

2. **BottomNav 搜索 Tab 路由处理不一致**
   - `BottomNav.tsx` 第 102-107 行：搜索 Tab `to="/search"` 但 `onClick` 中 `e.preventDefault(); navigate("/?search=1")`。
   - 问题：`NavLink` 的 `to` 和实际 `navigate` 目标不一致；且 `/?search=1` 查询参数在 `Home.tsx` 中**没有任何处理逻辑**（Home 只读取 `wd` 参数），点击搜索 Tab 不会触发任何搜索 UI 变化。
   - ATDD 2.4 期望："进入搜索页面（全屏输入框 + 搜索结果）"或"首页顶部显示一个可点击的搜索栏"。当前实现两者都不满足。
   - 修复建议：搜索 Tab 直接导航到 `/search` 路由（已有 `Search.tsx` 页面），或在 Home 中处理 `search=1` 参数聚焦搜索栏。

3. **Player.tsx 使用独立的 `IS_MOBILE` 常量而非 `useIsMobile`**
   - `Player.tsx` 第 11 行：`const IS_MOBILE = typeof window !== "undefined" && window.innerWidth < 768;`
   - 问题：这是**构建时快照**（仅在模块加载时执行一次），如果用户调整浏览器窗口大小后刷新页面，此值不会动态更新。虽然第 29 行有 `useState(IS_MOBILE)` 和第 41-51 行有 resize 监听，但初始状态可能错误。
   - 修复建议：直接使用 `const isMobile = useIsMobile();` 替换整个自定义 resize 逻辑，与架构文档 3.6 节一致。

### 🟡 Major

4. **BottomSheet 缺少下滑关闭手势**
   - `BottomSheet.tsx` 有拖拽指示条（`.bottom-sheet-handle`）视觉元素，但**没有任何触摸事件处理**（`onTouchStart`/`onTouchMove`/`onTouchEnd`）。
   - ATDD 场景 7.1 明确要求"支持向下滑动关闭"，架构文档 3.7 节也提到"支持拖拽指示条+下滑关闭"。
   - 修复建议：为 `.bottom-sheet` 或 `.bottom-sheet-handle` 添加 touch 事件监听，检测向下滑动手势阈值（如 > 80px）后触发 `onClose`。

5. **Detail.tsx 的 EpisodePicker（集数选择弹窗）未使用 BottomSheet**
   - `Detail.tsx` 第 252-343 行：下载时的集数选择弹窗仍使用**居中弹窗**（`position: fixed; inset: 0;`），未适配移动端 BottomSheet。
   - ATDD 场景 5.3 和架构文档 3.5 节均要求 EpisodePicker 在移动端使用 BottomSheet。
   - 修复建议：复用 `BottomSheet` 组件包裹集数选择内容。

6. **MobileSidebar 组件缺失**
   - 架构文档 3.6 节要求新建 `MobileSidebar.tsx`（"播放器选集抽屉"），但实际代码中 Player 页面直接在 JSX 内联了移动端抽屉逻辑（第 445-520 行）。
   - 问题：内联实现导致代码重复（Player 和 BottomSheet 有相似的抽屉结构），且不符合架构文档的组件拆分规划。
   - 修复建议：将 Player 的移动端抽屉逻辑抽取为 `MobileSidebar.tsx` 组件，或明确说明不抽取的理由。

7. **Player.tsx 移动端选集按钮触摸目标不足**
   - `Player.tsx` 第 341-348 行：移动端"选集"按钮设置 `minHeight: 32`，低于 44px 要求。
   - 同文件第 351-356 行"全屏"按钮也是 `minHeight: 32`。
   - ATDD 场景 6.3 要求"上一集"/"下一集"按钮高度 >= 44px，场景 8.1 要求所有可交互元素 >= 44px。
   - 修复建议：将 `minHeight: 32` 改为 `minHeight: 44`。

8. **Search.tsx 页面与 Home.tsx 搜索逻辑重复**
   - `Search.tsx` 是一个独立页面，但 `Home.tsx` 已经通过 `wdFromUrl` 参数支持搜索（第 142 行、第 525-560 行）。
   - BottomNav 的搜索 Tab 导航到 `/?search=1` 而非 `/search`，导致 `Search.tsx` 页面实际上**无法从底部导航进入**。
   - 修复建议：统一搜索入口——要么删除 `Search.tsx` 让搜索完全由 Home 承载，要么让 BottomNav 搜索 Tab 导航到 `/search`。

9. **global.css 中 `nav:not(.bottom-nav)` 选择器过于宽泛**
   - `global.css` 第 880 行：`@media (max-width: 767px) { nav:not(.bottom-nav) { display: none; } }`
   - 问题：如果未来在页面内部添加其他 `<nav>` 元素（如面包屑导航、二级导航），它们也会在移动端被隐藏。
   - 修复建议：给顶部导航栏添加特定 class（如 `.top-nav`），用 `.top-nav { display: none; }` 替代。

### 🟢 Minor

10. **CategoryBar 移动端未隐藏"更多/收起"按钮**
    - `CategoryBar.tsx` 第 114-132 行：`overflow` 状态和 `expanded` 状态在移动端仍然有效，"更多/收起"按钮会继续显示。
    - ATDD 场景 3.2 要求："不显示'更多/收起'按钮（横向滚动替代）"。
    - 当前 CSS（`.category-bar-scroll`）确实将容器改为横向滚动，但按钮逻辑仍在。
    - 修复建议：在组件中通过 `useIsMobile()` 条件判断，移动端不渲染展开/收起按钮；或给按钮添加移动端隐藏样式。

11. **VideoCard.tsx 的 `showOverlay` prop 在移动端被硬编码忽略**
    - `VideoCard.tsx` 第 140 行：`{showOverlay && !isMobile && (...)}`
    - 问题：即使调用方显式传入 `showOverlay={true}`，移动端仍然不显示 overlay。这与 prop 的语义（调用方控制）不完全一致。
    - 建议：更清晰的语义是 `showOverlay={showOverlay && !isMobile}` 在调用处处理，或重命名 prop 为 `showOverlay` 但文档说明移动端自动禁用。

12. **SourcePicker 桌面端弹窗未使用 CSS 变量**
    - `SourcePicker.tsx` 第 115 行：遮罩层使用硬编码 `rgba(0,0,0,0.55)`。
    - 虽然半透明黑色在两种主题下都可用，但项目主题系统已定义 `--border` 等变量，应保持一致性。
    - 修复建议：改为 `background: rgba(0, 0, 0, 0.5)`（与 `sheet-mask` 一致）或使用 CSS 变量。

13. **useViewport 未使用 `matchMedia`（性能优化点）**
    - `useViewport.ts` 使用 `window.addEventListener("resize", ...)` 而非 `window.matchMedia(...).addEventListener("change", ...)`。
    - `matchMedia` 在不需要像素级精确度时性能更好（不会每帧触发），且与 CSS 媒体查询使用相同的浏览器机制。
    - 架构文档未强制要求 `matchMedia`，但这是推荐的优化方向。

14. **Settings.tsx 快捷入口缺少"主题切换"图标颜色**
    - `Settings.tsx` 第 1375 行：`{theme === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}`
    - 图标未设置颜色，在深色主题下可能不可见（取决于 SVG 默认 fill/stroke）。
    - 修复建议：确保图标继承父元素颜色（已设置 `stroke="currentColor"`，但需确认实际渲染）。

15. **Player.tsx 移动端抽屉内集数按钮 `minHeight: 36`**
    - `Player.tsx` 第 508 行：移动端抽屉中的集数按钮 `minHeight: 36`，低于 44px 要求。
    - ATDD 场景 6.3 要求播放控制按钮 >= 44px，场景 8.1 要求全局可交互元素 >= 44px。
    - 修复建议：改为 `minHeight: 44`。

16. **Favorites.tsx 列表项缺少 `role="button"` 和键盘事件**
    - `Favorites.tsx` 第 18-42 行：收藏列表项可点击但缺少 `role="button"`、`tabIndex` 和 `onKeyDown` 处理。
    - 对比 `Progress.tsx`（第 18-52 行）已正确实现这些无障碍属性。
    - 修复建议：添加 `role="button"`、`tabIndex={0}` 和 `onKeyDown` 键盘导航支持。

---

## 建议修复

### 优先级 P0（阻塞发布）

1. **SourcePicker 条件渲染**：使用 `useIsMobile()` 在桌面端/移动端之间二选一渲染，避免 DOM 中同时存在两个弹窗。
2. **BottomNav 搜索路由**：统一为 `/search` 或实现 `/?search=1` 在 Home 中的处理逻辑。
3. **Player.tsx 使用 `useIsMobile`**：替换自定义 `IS_MOBILE` 常量和 resize 监听，消除初始状态错误风险。

### 优先级 P1（重要）

4. **BottomSheet 添加下滑关闭**：为 `.bottom-sheet` 添加 touch 事件监听，实现手势关闭。
5. **Detail.tsx EpisodePicker 使用 BottomSheet**：复用 `BottomSheet` 组件替换居中弹窗。
6. **Player 移动端按钮触摸目标**："选集"、"全屏"、抽屉内集数按钮统一改为 `minHeight: 44`。
7. **CategoryBar 移动端隐藏展开按钮**：通过 `useIsMobile()` 或 CSS 在移动端隐藏"更多/收起"。

### 优先级 P2（优化）

8. **抽取 MobileSidebar**：将 Player 移动端抽屉逻辑抽取为独立组件。
9. **顶部导航栏添加 class**：给 `<nav>` 添加 `.top-nav` class，避免选择器过于宽泛。
10. **Favorites 无障碍属性**：补充 `role`、`tabIndex` 和键盘事件。
11. **考虑使用 `matchMedia`** 替代 resize 监听优化性能。
