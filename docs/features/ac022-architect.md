# AC-022 架构设计 — 播放器触摸交互与手势控制

## 1. 手势事件系统架构

### 1.1 事件监听层

在 `VideoPlayer.tsx` 的容器 `div`（`containerRef`）之上叠加一层**透明触摸覆盖层**（`touch-overlay`），专门负责手势事件监听。

```
┌─────────────────────────────────────┐
│  touch-overlay (pointer-events: auto) │  ← 手势识别层，capture 阶段监听
│  ┌─────────────────────────────────┐ │
│  │  ckplayer container             │ │  ← ckplayer 自带 UI 在此
│  │  ┌───────────────────────────┐  │ │
│  │  │  <video>                  │  │ │
│  │  │  ┌─────────────────────┐  │  │ │
│  │  │  │ ckplayer 控制栏     │  │  │ │  ← 自带控制栏
│  │  │  └─────────────────────┘  │  │ │
│  │  └───────────────────────────┘  │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

- **DOM 元素**：在 `VideoPlayer.tsx` 返回的 JSX 中，`containerRef` 的同级位置增加一个绝对定位的 `div`（`touch-overlay`），`inset: 0`，`z-index` 高于 ckplayer 控制栏但低于自定义提示层。
- **事件绑定**：在 `touch-overlay` 上使用 `{ capture: true }` 监听 `touchstart` / `touchmove` / `touchend` / `touchcancel`。这样可以在事件到达 ckplayer 之前完成手势识别，按需 `stopPropagation()` 阻止 ckplayer 消费。
- **CSS**：`touch-action: none`（仅在手势识别期间临时设置，识别为垂直滑动时恢复为 `auto`，避免阻断页面滚动）。

### 1.2 手势识别器设计

使用**单文件状态机**实现，封装为 `frontend/src/hooks/usePlayerGestures.ts`。

#### 状态机

```
idle ──touchstart──→ tracking ──touchend──→ recognized ──execute──→ complete
                        │                        │
                        └─touchmove (双指)──→ pinch_tracking ──touchend──→ recognized
                        │
                        └─touchmove (位移>50px)──→ swipe_tracking
```

- **idle**：无触摸。
- **tracking**：单指按下，记录起始坐标和时间戳。启动 300ms 定时器等待双击判定。
- **pinch_tracking**：检测到 `touches.length >= 2`，计算双指距离，进入 pinch 追踪。
- **swipe_tracking**：单指位移超过 50px 且 `|dx| > |dy| * 2`，确认为水平滑动，立即阻止后续单击/双击判定。
- **recognized**：手势类型已确认，等待 `touchend` 执行动作。
- **complete**：动作执行完毕，回到 idle。

#### 手势判定逻辑

| 手势 | 判定条件 |
|------|---------|
| pinch | `e.touches.length >= 2`，且双指距离变化率 `> 15%` |
| 双击 | 两次 `touchend` 间隔 `< 300ms`，且两次触摸中心点距离 `< 20px` |
| 滑动 | 单指位移 `|dx| > 50px` 且 `|dx| > |dy| * 2` |
| 单击 | 以上均不匹配，且触摸持续时间 `< 500ms` |

### 1.3 与 ckplayer 内置事件隔离

- **capture 阶段拦截**：所有 touch 事件在 `touch-overlay` 上以 `capture: true` 监听。
- **选择性阻止**：仅在识别出手势（滑动、双击、pinch）后调用 `e.stopPropagation()` 和 `e.preventDefault()`；未识别时（如垂直滑动）不阻止，允许事件继续传递到 ckplayer 或页面滚动。
- **单击延迟策略**：第一次 `touchend` 后延迟 300ms 执行单击逻辑（唤出控制栏）。若 300ms 内收到第二次 `touchstart`，取消单击定时器，进入双击判定。

---

## 2. 手势优先级与冲突处理

| 手势 | 触发条件 | 优先级 | 阻止行为 |
|------|---------|--------|---------|
| pinch | 双指距离变化率 > 15% | 最高 | `preventDefault()` 阻止页面缩放；`stopPropagation()` 阻止 ckplayer 响应 |
| 双击 | 两次点击间隔 < 300ms 且位移 < 20px | 高 | 阻止单击事件（300ms 延迟期内取消）；`stopPropagation()` 阻止 ckplayer 单击 |
| 滑动 | 单指位移 > 50px 且 `|dx| > \|dy\| * 2` | 中 | `preventDefault()` 阻止页面滚动/返回手势；`stopPropagation()` 阻止 ckplayer 响应 |
| 单击 | 无双击/滑动匹配，持续时间 < 500ms | 低 | 唤出/隐藏控制栏；不阻止 ckplayer 自带控制栏的点击（若 ckplayer 控制栏可见且点击在控制栏区域内，优先让 ckplayer 处理） |
| 垂直滑动 | `|dy| > |dx|` | 忽略 | 不拦截，允许页面滚动 |

**关键冲突处理规则**：

1. **同一触摸序列只触发一种行为**：一旦进入 `swipe_tracking` 或 `pinch_tracking`，该序列的 `touchend` 不再执行单击/双击。
2. **双击与单击互斥**：第一次 `touchend` 启动 300ms 定时器；若定时器触发前收到第二次 `touchstart`，取消单击，进入双击判定。
3. **滑动期间不触发单击**：滑动判定成立后，`touchend` 直接执行 seek，不进入单击逻辑。
4. **ckplayer 控制栏区域豁免**：若触摸目标在 ckplayer 控制栏 DOM 内（通过 `e.target.closest('.ckplayer-controls')` 判断），手势层不拦截，让 ckplayer 自行处理（用户意图是操作控制栏按钮，不是手势）。

---

## 3. 全屏 API 兼容性层

封装为 `frontend/src/utils/fullscreen.ts`。

```typescript
// frontend/src/utils/fullscreen.ts
interface FullscreenAPI {
  requestFullscreen(element: HTMLElement | HTMLVideoElement): Promise<void>;
  exitFullscreen(): Promise<void>;
  isFullscreen(): boolean;
  getFullscreenElement(): Element | null;
  lockOrientation(): Promise<void>;
  unlockOrientation(): Promise<void>;
}
```

### 兼容性矩阵

| 浏览器/环境 | 首选 API | 降级方案 |
|------------|---------|---------|
| Chrome/Android | `Element.requestFullscreen()` | — |
| iOS Safari | `video.webkitEnterFullscreen()` | 容器 `requestFullscreen()`（若可用） |
| 旧版 Safari | `webkitRequestFullscreen()` | — |
| 微信内置浏览器 | `Element.requestFullscreen()` | 容器全屏失败时退到 `video.webkitEnterFullscreen()` |

### 实现要点

1. **优先容器全屏**：让整个播放器容器（含选集面板）进入全屏，保持选集可用。若容器全屏 API 不可用（如 iOS Safari），退到仅 `<video>` 元素全屏。
2. **iOS 特殊处理**：检测 `video.webkitSupportsFullscreen`，若支持则调用 `video.webkitEnterFullscreen()`；不支持时尝试容器全屏。
3. **方向锁定**：全屏成功后尝试 `screen.orientation?.lock('landscape')`，不支持时静默失败；退出全屏时解锁。
4. **状态同步**：监听 `fullscreenchange` / `webkitfullscreenchange` 事件，同步 React 状态。处理浏览器原生退出（如用户按 Home 键后返回）。
5. **微信环境**：微信内置浏览器可能拦截全屏，需在 `requestFullscreen` 失败时静默降级，不抛错误到 UI。

---

## 4. 控制栏 autoHide 策略

### 4.1 控制栏归属决策

**方案：复用 ckplayer 自带控制栏 + 自定义 autoHide 逻辑覆盖**

- ckplayer 自带控制栏包含播放/暂停、进度条、音量、全屏按钮，功能完整。
- 不额外实现一套控制栏，而是**在 ckplayer 之上通过手势层统一接管显示/隐藏触发**。
- ckplayer 的 `autoHide` 配置设为 `false`（或保持默认，由手势层覆盖），由手势层通过 ckplayer API 控制控制栏显隐（ckplayer v3.x 通常提供 `player.showControls()` / `player.hideControls()` 或可通过 CSS 控制）。

若 ckplayer 未暴露显隐 API，则通过 CSS 覆盖 `.ckplayer-controls` 的 `opacity` / `visibility` 实现。

### 4.2 计时器管理

```typescript
// 在 usePlayerGestures 或 Player.tsx 中管理
const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const AUTO_HIDE_DELAY = 3000;      // 普通模式 3s
const AUTO_HIDE_DELAY_FULLSCREEN = 5000;  // 全屏模式 5s
```

- **显示控制栏**：任何用户交互（单击、双击、滑动、选集切换、键盘操作）触发 `showControls()` 并重置计时器。
- **隐藏控制栏**：计时器到期后触发 `hideControls()`。
- **交互期间不隐藏**：用户正在拖动进度条、调节音量时（通过监听 ckplayer 控制栏的 `mousedown`/`touchstart`），暂停计时器，交互结束后再启动。
- **双击 300ms 窗口**：第一次触摸不立即显示控制栏，等待 300ms 判定是否为双击。若是双击，控制栏状态跟随视频暂停/播放状态（暂停时显示，播放时启动隐藏计时器）。

### 4.3 移动端 ckplayer 控制栏处理

- ckplayer 自带控制栏在移动端通常已做适配（按钮放大、触摸友好）。
- 无需隐藏 ckplayer 自带控制栏，只需通过手势层补充"触摸唤出/隐藏"能力。
- 若 ckplayer 控制栏在移动端过于占用空间，可通过 CSS 在 `@media (max-width: 768px)` 下缩小控制栏高度。

---

## 5. 选集面板移动端适配

### 5.1 布局改造

当前 `Player.tsx` 中右侧选集面板为固定宽度 `220px` 的 sidebar。移动端（`< 768px`）改造为**底部抽屉**或**右侧滑出面板**。

```
桌面端 (>= 768px):
┌────────────────────┬──────────┐
│  播放器            │ 选集面板 │  ← 固定 220px
│                    │ (sidebar)│
└────────────────────┴──────────┘

移动端 (< 768px):
┌────────────────────┐
│  播放器 (全宽)     │
│                    │
├────────────────────┤
│  控制条            │
│  [选集] 按钮       │  ← 点击展开底部抽屉
└────────────────────┘
        ↓
┌────────────────────┐
│  播放器            │
│  ┌──────────────┐  │
│  │ 选集抽屉     │  │  ← 从底部滑出，占屏幕高度 60%
│  │  ┌──┬──┬──┐  │  │
│  │  │01│02│03│  │  │
│  │  └──┴──┴──┘  │  │
│  └──────────────┘  │
└────────────────────┘
```

### 5.2 状态管理

- `sidebarOpen` 初始值：在移动端（通过 `window.innerWidth < 768` 或 `matchMedia` 判定）应为 `false`，最大化视频区域。
- 抽屉展开时添加背景遮罩，点击遮罩关闭。
- 抽屉展开期间，播放器区域的触摸手势仍正常工作（遮罩层 `pointer-events: none` 或事件委托到播放器层）。

### 5.3 实现位置

改造在 `Player.tsx` 中进行，通过 CSS media query 切换布局：

```css
/* 桌面端：右侧 sidebar */
.player-layout { display: flex; flex-direction: row; }
.episode-sidebar { width: 220px; }

/* 移动端：底部抽屉 */
@media (max-width: 768px) {
  .player-layout { flex-direction: column; }
  .episode-sidebar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60vh;
    width: 100%;
    transform: translateY(100%);
    transition: transform 0.3s ease;
    z-index: var(--z-modal);
  }
  .episode-sidebar.open { transform: translateY(0); }
}
```

---

## 6. 新增/修改文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `frontend/src/hooks/usePlayerGestures.ts` | 手势识别状态机 hook，暴露 `gestureState`、`showControls`、`hideControls`、`seekOffset`、`togglePlay` 等 |
| `frontend/src/hooks/useFullscreen.ts` | 全屏 API 兼容性 hook，封装 `enterFullscreen` / `exitFullscreen` / `isFullscreen` |
| `frontend/src/hooks/useAutoHide.ts` | 控制栏 autoHide 计时器管理 hook |
| `frontend/src/utils/fullscreen.ts` | 全屏 API 兼容性工具函数 |
| `frontend/src/components/GestureOverlay.tsx` | 透明手势覆盖层组件，内部绑定 touch 事件 |
| `frontend/src/components/EpisodeDrawer.tsx` | 移动端选集抽屉组件（从底部滑出） |
| `frontend/src/components/SeekFeedback.tsx` | 滑动 seek 时的视觉反馈组件（半透明提示层「快进 10s」/「快退 10s」） |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `frontend/src/components/VideoPlayer.tsx` | 1. 新增 `GestureOverlay` 子组件；2. 暴露 `play()` / `pause()` 方法给 `useImperativeHandle`；3. 支持外部控制控制栏显隐（通过 ref 或 props） |
| `frontend/src/pages/Player.tsx` | 1. 引入 `usePlayerGestures`、`useFullscreen`、`useAutoHide`；2. 改造选集面板为响应式布局（桌面 sidebar / 移动端 drawer）；3. `sidebarOpen` 初始值根据屏幕宽度判定；4. 绑定手势回调到 `seekTo` 和播放控制；5. 添加全屏切换按钮 |
| `frontend/src/styles/global.css` | 1. 新增手势覆盖层样式；2. 新增选集抽屉动画样式；3. 新增 seek 反馈提示样式；4. 新增移动端播放器布局 media query |

---

## 7. 风险评估

### 7.1 ckplayer 事件冲突风险

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| ckplayer 内部监听 `click` 与手势层双击冲突 | 中 | capture 阶段拦截 + 300ms 单击延迟；识别为双击后 `stopPropagation()` |
| ckplayer 控制栏按钮被手势层误拦截 | 中 | 通过 `e.target.closest('.ckplayer-controls')` 判断，控制栏区域内不拦截 |
| ckplayer 自带 `autoHide` 与自定义逻辑冲突 | 低 | 初始化时通过 ckplayer 配置关闭 autoHide，或确保 ckplayer autoHide 延迟远大于自定义逻辑（如 10s vs 3s） |
| HLS.js 与手势层同时操作 `video.currentTime` | 低 | `seekTo` 通过 `playerRef.current.seek()` 调用 ckplayer 封装，不直接操作 video 元素 |

### 7.2 手势误触率

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 单击被误判为滑动（位移阈值过低） | 中 | 位移阈值设为 50px；水平滑动需满足 `|dx| > |dy| * 2` |
| 双击被误判为两次单击（时间窗口过短） | 低 | 时间窗口 300ms 是行业惯例（YouTube、Bilibili 均用 300ms） |
| 滑动 seek 方向与用户意图相反 | 低 | 统一采用「向右滑动 = 快进」（与主流视频 App 一致） |
| 误触导致频繁 seek | 低 | 每次滑动只 seek 一次（在 `touchend` 时执行，不在 `touchmove` 中连续 seek） |

### 7.3 浏览器 touch 事件差异

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| iOS Safari `touchmove` 默认阻止滚动 | 中 | 仅在确认水平滑动时 `preventDefault()`；垂直滑动不阻止 |
| Android Chrome 浏览器手势（返回上一页）与滑动冲突 | 中 | 水平滑动时 `preventDefault()` 阻止浏览器默认手势；仅在播放器区域内生效 |
| 微信内置浏览器覆盖触摸事件 | 中 | 测试验证；若微信拦截，通过 `capture: true` 确保优先响应 |
| 低端设备 `touchmove` 掉帧 | 低 | 手势识别计算极简（仅比较坐标差值），不使用 `requestAnimationFrame`；视觉反馈用 CSS transition |
| 部分浏览器不支持 `touch` 事件（如桌面鼠标） | 低 | 手势层同时监听 `mousedown`/`mousemove`/`mouseup` 做鼠标兼容，或保持现有键盘逻辑不受影响 |

### 7.4 其他风险

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 全屏 API 在部分浏览器上不可用 | 中 | 多层级降级（标准 API → webkit → video.webkitEnterFullscreen）；失败时静默处理，不阻断播放 |
| 方向锁定 API 不支持 | 低 | `screen.orientation.lock` 失败时静默捕获，不影响全屏功能 |
| 移动端选集抽屉与系统手势冲突（iOS 底部上滑） | 低 | 抽屉高度不超过 70vh，保留底部安全区域；不阻止系统手势 |

---

## 8. 接口契约

### 8.1 VideoPlayer 组件扩展

```typescript
// VideoPlayer.tsx 扩展后的 ref 接口
export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  play: () => void;      // 新增
  pause: () => void;     // 新增
  togglePlay: () => boolean;  // 新增，返回当前是否 paused
}

// VideoPlayerProps 扩展
interface VideoPlayerProps {
  src: string;
  suffix?: string;
  autoplay?: boolean;
  onError?: (message: string) => void;
  onReady?: () => void;
  onEnded?: () => void;
  controlsVisible?: boolean;  // 新增：外部控制控制栏显隐
}
```

### 8.2 usePlayerGestures 返回值

```typescript
interface UsePlayerGesturesReturn {
  // 绑定到 overlay 的事件处理器
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;

  // 当前手势状态（用于 UI 反馈）
  gestureState: 'idle' | 'tracking' | 'pinching' | 'swiping' | 'recognized';

  // 滑动反馈
  swipeFeedback: { direction: 'left' | 'right'; offset: number } | null;

  // 控制栏状态
  controlsVisible: boolean;
  showControls: () => void;
  hideControls: () => void;
}
```

### 8.3 useFullscreen 返回值

```typescript
interface UseFullscreenReturn {
  isFullscreen: boolean;
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
}
```

---

## 9. 实施顺序建议

1. **Step 1**：实现 `utils/fullscreen.ts` 和 `hooks/useFullscreen.ts`，验证全屏 API 在各浏览器可用性。
2. **Step 2**：实现 `hooks/usePlayerGestures.ts` 核心状态机，在桌面浏览器用 DevTools 模拟 touch 事件测试。
3. **Step 3**：实现 `GestureOverlay.tsx` 和 `SeekFeedback.tsx`，集成到 `VideoPlayer.tsx`。
4. **Step 4**：实现 `hooks/useAutoHide.ts`，绑定控制栏显隐逻辑。
5. **Step 5**：改造 `Player.tsx` 选集面板为响应式布局，实现 `EpisodeDrawer.tsx`。
6. **Step 6**：端到端测试（iOS Safari、Chrome Android、微信内置浏览器）。
