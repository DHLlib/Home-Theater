# AC-021 ATDD 验收测试草案：移动端响应式布局与导航

## 分析摘要

基于对现有代码的审阅，识别出以下桌面端假设需要在移动端被覆盖：

| 组件/文件 | 桌面端假设 | 移动端需要 |
|---|---|---|
| `Layout.tsx` | 顶部水平导航栏 + 搜索框 + 主题切换 | `< 768px` 时隐藏顶部栏，显示底部 Tab 栏 |
| `global.css` `.grid` | `minmax(200px, 1fr)` 自动填充 | 手机端强制 2 列，平板端 3 列 |
| `VideoCard.tsx` | hover 触发 overlay（播放/详情/收藏按钮） | 触摸替代方案（长按或点击展开） |
| `Home.tsx` | 三区域布局（ScrollRow 横向滚动 + grid） | 保持可用，但卡片尺寸缩小 |
| `CategoryBar.tsx` | 分类按钮 flex-wrap 换行 | 手机端改为横向滚动条 |
| `Detail.tsx` | 两栏布局（海报 220px + 信息区） | 单栏堆叠，海报全宽 |
| `Player.tsx` | 左右分栏（播放器 + 220px 选集面板） | 选集面板变为底部抽屉或全屏覆盖 |
| `SourcePicker.tsx` | 居中弹窗 `min(420px, 92vw)` | 手机端底部 sheet 或全屏 |
| `EpisodeList.tsx` | 集数按钮 flex-wrap | 保持，但触摸目标需 >= 44px |

---

## 场景 1：首页响应式网格布局

### 1.1 手机端（375px）
**Given** 视口宽度 375px（iPhone SE 尺寸）  
**When** 用户打开首页  
**Then** `.grid` 容器渲染为 2 列，列间距 12px  
**Then** 视频卡片宽度约 160px，海报高度按 `aspect-ratio: 2/3` 等比缩放  
**Then** 卡片标题 `.card-title` 最多显示 2 行，字体大小 13px，行高 1.35  
**Then** 年份标签字体大小 12px  
**Then** 骨架屏同步缩小为 2 列布局

### 1.2 平板端（768px）
**Given** 视口宽度 768px（iPad 竖屏）  
**When** 用户打开首页  
**Then** `.grid` 容器渲染为 3 列，列间距 16px  
**Then** 视频卡片宽度约 220px

### 1.3 桌面端（>= 1024px）
**Given** 视口宽度 1024px  
**When** 用户打开首页  
**Then** 保持现有行为：`.grid` 为 `auto-fill, minmax(200px, 1fr)`  
**Then** 视频卡片 hover 效果正常工作

---

## 场景 2：导航栏折叠为底部 Tab 栏

### 2.1 小屏幕隐藏顶部导航
**Given** 视口宽度 < 768px  
**When** 页面加载完成  
**Then** `<nav>` 元素（顶部水平导航栏）不显示或 `display: none`  
**Then** 搜索框从顶部导航中移除

### 2.2 底部 Tab 栏显示
**Given** 视口宽度 < 768px  
**When** 页面加载完成  
**Then** 底部固定 Tab 栏可见，高度 56-64px  
**Then** Tab 栏包含 4 个入口：首页、搜索、收藏、设置（图标 + 文字）  
**Then** "最近"和"下载"合并到"我的"子页面或作为设置页入口  
**Then** 当前激活 Tab 有高亮样式（颜色/背景区分）  
**Then** 点击 Tab 正确路由跳转

### 2.3 触摸目标尺寸
**Given** 视口宽度 < 768px  
**When** 用户查看底部 Tab 栏  
**Then** 每个 Tab 项的触摸目标 >= 44x44px  
**Then** Tab 项之间的间距足够，避免误触

### 2.4 搜索入口适配
**Given** 视口宽度 < 768px  
**When** 用户点击底部 Tab 栏的"搜索"  
**Then** 进入搜索页面（全屏输入框 + 搜索结果）  
**Then** 或：首页顶部显示一个可点击的搜索栏（类似原生 App）

### 2.5 主题切换位置
**Given** 视口宽度 < 768px  
**When** 用户需要切换主题  
**Then** 主题切换按钮位于设置页面内，或底部 Tab 栏的"我的"页面中

---

## 场景 3：分类栏移动端适配

### 3.1 手机端横向滚动
**Given** 视口宽度 < 768px  
**When** 首页显示分类栏  
**Then** `CategoryBar` 的分类按钮从 flex-wrap 换行改为横向滚动  
**Then** 支持手指左右滑动浏览分类  
**Then** 隐藏滚动条但保持滚动功能  
**Then** "全部"按钮始终可见于最左侧

### 3.2 收起/展开按钮
**Given** 视口宽度 < 768px  
**When** 分类数量超过屏幕宽度  
**Then** 不显示"更多/收起"按钮（横向滚动替代）  
**Then** 或：显示一个指示器提示有更多分类

---

## 场景 4：视频卡片 hover 替代方案

### 4.1 触摸设备无 hover
**Given** 触摸设备（或视口 < 768px）  
**When** 用户与视频卡片交互  
**Then** `.video-card:hover` 的 scale 变换和阴影效果不触发（或改为 `:active` 短暂反馈）  
**Then** `.card-overlay`（悬停信息层）不在触摸时自动显示

### 4.2 卡片点击行为
**Given** 触摸设备  
**When** 用户点击视频卡片  
**Then** 直接进入详情页（保持现有行为）  
**Then** 不显示 overlay 中的播放/详情/收藏按钮

### 4.3 快速操作替代方案（可选增强）
**Given** 触摸设备  
**When** 用户长按视频卡片超过 500ms  
**Then** 显示操作菜单（播放 / 收藏 / 分享）  
**Then** 或：在卡片右下角固定显示一个小型收藏按钮（心形图标，>= 44x44px）

---

## 场景 5：详情页单栏堆叠布局

### 5.1 手机端单栏布局
**Given** 视口宽度 < 768px  
**When** 用户打开详情页  
**Then** 海报区域宽度 100%（不再是固定 220px）  
**Then** 海报最大高度限制为 60vh，避免过长  
**Then** 信息区（标题、演员、简介）在海报下方堆叠显示  
**Then** 操作按钮（播放/下载/收藏）横向排列，宽度均分或自适应

### 5.2 平板端适配
**Given** 视口宽度 768px ~ 1024px  
**When** 用户打开详情页  
**Then** 海报宽度 200px，信息区在右侧  
**Then** 或根据内容自动调整为单栏/双栏

### 5.3 源站选集区域
**Given** 视口宽度 < 768px  
**When** 详情页显示多个源站的选集  
**Then** `EpisodeList` 的集数按钮保持 flex-wrap  
**Then** 每个集数按钮触摸目标 >= 44x44px  
**Then** 按钮间距 >= 8px

---

## 场景 6：播放器页面适配

### 6.1 播放器全宽
**Given** 视口宽度 < 768px  
**When** 用户进入播放器页面  
**Then** 视频播放器宽度 100%，高度自适应（保持 16:9 或视频原始比例）  
**Then** 播放器容器无左右边距

### 6.2 选集面板移动端
**Given** 视口宽度 < 768px  
**When** 播放器页面加载  
**Then** 右侧选集面板默认隐藏（`sidebarOpen = false`）  
**Then** 显示"选集"按钮，点击后从底部弹出抽屉式面板  
**Then** 抽屉面板高度占屏幕 50-60%，支持上下滑动关闭  
**Then** 抽屉内集数列表可垂直滚动

### 6.3 播放控制按钮
**Given** 视口宽度 < 768px  
**When** 播放器页面显示控制按钮  
**Then** "上一集"/"下一集"按钮高度 >= 44px  
**Then** 按钮间距 >= 12px  
**Then** 当前集数信息文字大小 >= 14px，清晰可读

### 6.4 键盘事件保留
**Given** 任何视口宽度  
**When** 播放器容器获得焦点  
**Then** 左右方向键的快进/快退功能继续工作  
**Then** 长按连续快进/快退逻辑不受影响

---

## 场景 7：SourcePicker 弹窗适配

### 7.1 手机端底部 Sheet
**Given** 视口宽度 < 768px  
**When** SourcePicker 弹窗打开  
**Then** 弹窗从底部滑出（bottom sheet 样式），而非居中  
**Then** 弹窗宽度 100%，最大高度 80vh  
**Then** 顶部有拖拽指示条（可选）  
**Then** 支持向下滑动关闭

### 7.2 触摸目标
**Given** 视口宽度 < 768px  
**When** SourcePicker 显示源列表  
**Then** 每个源选项的触摸目标 >= 44px 高度  
**Then** 选项之间的间距 >= 8px

---

## 场景 8：触摸目标最小尺寸

### 8.1 全局检查
**Given** 视口宽度 < 768px  
**When** 检查页面所有可交互元素  
**Then** 所有按钮、链接、Tab 项的触摸目标 >= 44x44px  
**Then** 所有输入框高度 >= 44px  
**Then** 所有表单控件间距 >= 8px

### 8.2 具体元素清单
- `.btn` 类按钮：`min-height >= 44px`
- `.nav-link` 导航链接：`min-height >= 44px`
- `EpisodeList` 集数按钮：`min-height >= 44px`
- `CategoryBar` 分类按钮：`min-height >= 44px`
- `SourcePicker` 源选项：`padding >= 12px`（垂直方向）
- `scroll-arrow` 滚动箭头：`width/height >= 44px`

---

## 场景 9：消除 hover 依赖

### 9.1 全局 hover 检查
**Given** 触摸设备（`hover: none` 或 `@media (hover: none)`）  
**When** 用户浏览页面  
**Then** 所有功能不依赖 hover 状态触发  
**Then** 需要 hover 显示的内容（如 `card-overlay`、`scroll-arrow`）有替代交互方式

### 9.2 滚动箭头替代
**Given** 视口宽度 < 768px  
**When** 用户浏览横向滚动区域（如"最新更新"）  
**Then** 左右滚动箭头始终可见（不依赖 hover）  
**Then** 或：隐藏箭头，仅支持手指滑动

### 9.3 链接/按钮状态
**Given** 触摸设备  
**When** 用户点击链接或按钮  
**Then** `:active` 状态提供视觉反馈（短暂高亮或缩放）  
**Then** 无 hover 状态下的颜色变化不影响可用性

---

## 场景 10：其他页面适配

### 10.1 搜索页
**Given** 视口宽度 < 768px  
**When** 用户进入搜索页  
**Then** 搜索输入框宽度 100%，高度 >= 44px  
**Then** 搜索结果使用 2 列网格  
**Then** 无结果提示居中显示

### 10.2 收藏页 / 最近页 / 下载页
**Given** 视口宽度 < 768px  
**When** 用户进入列表页  
**Then** 列表项垂直堆叠，每项高度 >= 64px  
**Then** 触摸目标 >= 44x44px  
**Then** 滑动删除/操作支持（可选增强）

### 10.3 设置页
**Given** 视口宽度 < 768px  
**When** 用户进入设置页  
**Then** 表单元素宽度 100%  
**Then** 输入框/选择框高度 >= 44px  
**Then** 按钮宽度 100% 或足够大

---

## 建议新增的工具/Hooks

### `useViewport()` Hook
```typescript
// 返回当前视口信息，用于条件渲染
interface ViewportInfo {
  width: number;
  height: number;
  isMobile: boolean;      // < 768px
  isTablet: boolean;      // 768px ~ 1024px
  isDesktop: boolean;     // >= 1024px
}
```

### `useIsMobile()` Hook
```typescript
// 简化版，仅返回是否移动端
function useIsMobile(): boolean;
// 基于 matchMedia('(max-width: 767px)') 或 window.innerWidth
```

### CSS 媒体查询断点（建议）
```css
/* 手机 */
@media (max-width: 767px) { ... }

/* 平板 */
@media (min-width: 768px) and (max-width: 1023px) { ... }

/* 桌面 */
@media (min-width: 1024px) { ... }

/* 触摸设备（无 hover） */
@media (hover: none) { ... }

/* 支持 hover 的设备 */
@media (hover: hover) { ... }
```

---

## 关键实现注意事项

1. **不要修改路由结构**：底部 Tab 栏的入口应映射到现有路由（`/`、`/favorites`、`/settings`），搜索可复用首页搜索逻辑。

2. **VideoCard 的 `showOverlay` 属性**：现有 `showOverlay` prop 可用于移动端控制 overlay 行为。移动端可传入 `showOverlay={false}` 或改为点击触发。

3. **Player 的 `sidebarOpen` 状态**：移动端初始值应设为 `false`，通过用户点击展开。

4. **主题系统兼容**：所有响应式样式必须同时兼容浅色/深色主题，检查硬编码颜色（如 `rgba(0,0,0,0.55)`）在移动端是否仍然适用。

5. **性能考虑**：使用 CSS 媒体查询而非 JS 监听 resize（减少重渲染）。`useViewport` 仅在需要 JS 逻辑判断时使用（如 Player 的 sidebar 初始状态）。

6. **测试优先级**：
   - P0：导航栏折叠、首页网格、触摸目标尺寸
   - P1：详情页单栏、播放器选集面板
   - P2：hover 替代、SourcePicker 底部 sheet
