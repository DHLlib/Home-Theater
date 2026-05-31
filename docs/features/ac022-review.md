# AC-022 代码审查报告 — 播放器触摸交互与手势控制

**审查日期**: 2026-05-30
**审查范围**: 8 个文件（6 新建 + 2 修改）
**审查依据**: `ac022-atdd.md`、`ac022-architect.md`

---

## 总体评价

实现基本覆盖了 ATDD 的 7 个场景，手势状态机、全屏降级、控制栏 autoHide 三大核心模块均已落地。但存在 **5 处中高风险问题** 和 **7 处低风险改进项**，需在合并前修复或确认。

---

## 一、高风险问题

### R1. `usePlayerGestures.ts` 双击判定存在竞态条件 — 可能导致单击/双击行为错乱

**位置**: `frontend/src/hooks/usePlayerGestures.ts` 第 130-143 行

**问题描述**:
```typescript
// onTouchStart 中：
if (lastTapRef.current && touches.length === 1) {
  const dt = now - lastTapRef.current.time;
  const dist = getDistance(lastTapRef.current, getTouchPoint(touches[0]));
  if (dt < DOUBLE_TAP_INTERVAL && dist < DOUBLE_TAP_DISTANCE) {
    clearClickTimer();
    lastTapRef.current = null;
    setGestureState("recognized");
    handleRecognized("doubleTap");
    // ...
    return;
  }
}
// ... 后续代码继续执行，记录新的 startPoint 并设置 lastTapRef
```

当第二次 `touchstart` 不满足双击条件（如 `dt >= 300ms` 或 `dist >= 20px`）时，代码不会 `return`，而是继续往下执行，**覆盖** `dataRef.current` 为新的 tracking 状态，并将 `lastTapRef.current` 更新为新的触摸点。这意味着：

- 用户第一次单击后等待 350ms（超过 300ms 窗口），此时 `clickTimerRef` 已触发单击逻辑
- 用户第二次触摸时，`dt = 350ms > 300ms`，不满足双击，进入新的 tracking
- 但此时第一次的单击已经执行了，第二次的 `touchend` 又会启动新的单击定时器
- **结果**: 用户意图是"单击 + 单击"（两次独立单击），但第一次单击已经唤出控制栏，第二次又唤出一次（无视觉变化，但逻辑上多执行了一次 `onSingleTap`）

更严重的情况：
- 第一次 `touchend` 后 250ms 启动 `clickTimer`（尚未触发）
- 第二次 `touchstart` 时 `dt = 250ms`，但位移 `dist = 25px > 20px`
- 不满足双击，覆盖 `dataRef` 和 `lastTapRef`
- 第一次的 `clickTimer` 仍会在 50ms 后触发单击
- 第二次的 `touchend` 又会启动新的 `clickTimer`
- **结果**: 两次单击都被执行，控制栏闪现两次

**建议修复**:
在 `onTouchStart` 中，当 `lastTapRef.current` 存在但不满足双击条件时，应**取消**之前的单击定时器并清空 `lastTapRef`，然后按新的触摸处理：

```typescript
if (lastTapRef.current && touches.length === 1) {
  const dt = now - lastTapRef.current.time;
  const dist = getDistance(lastTapRef.current, getTouchPoint(touches[0]));
  if (dt < DOUBLE_TAP_INTERVAL && dist < DOUBLE_TAP_DISTANCE) {
    // 双击判定成功
    clearClickTimer();
    lastTapRef.current = null;
    setGestureState("recognized");
    handleRecognized("doubleTap");
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  // 不满足双击条件，取消之前 pending 的单击
  clearClickTimer();
  lastTapRef.current = null;
}
```

---

### R2. `onTouchEnd` 中滑动结束后 `dataRef` 未清理 — 可能导致下一次触摸误判

**位置**: `frontend/src/hooks/usePlayerGestures.ts` 第 238-241 行

**问题描述**:
```typescript
if (data.state === "swiping" && data.swipeFeedback) {
  handleRecognized("swipe", data.swipeFeedback.direction);
  e.stopPropagation();
  return;  // 直接 return，dataRef.current 未被清理
}
```

滑动结束后直接 `return`，`dataRef.current` 仍指向旧的 GestureData。虽然下一次 `touchstart` 会覆盖 `dataRef`，但如果 ckplayer 或其他组件在滑动结束后触发了额外的合成事件（如某些浏览器在 `touchend` 后触发 `mousedown`），可能导致状态错乱。

**建议修复**:
在滑动和 pinch 结束后显式清理 `dataRef.current = null`：

```typescript
if (data.state === "swiping" && data.swipeFeedback) {
  handleRecognized("swipe", data.swipeFeedback.direction);
  e.stopPropagation();
  dataRef.current = null;  // 显式清理
  return;
}
```

---

### R3. `fullscreen.ts` iOS 降级链中 `video.webkitEnterFullscreen()` 不返回 Promise — 导致调用方 await 永远挂起

**位置**: `frontend/src/utils/fullscreen.ts` 第 73-84 行

**问题描述**:
```typescript
// 5. iOS video 元素全屏降级
const video = element.querySelector("video");
if (video && (video as any).webkitEnterFullscreen) {
  try {
    (video as any).webkitEnterFullscreen();  // 不返回 Promise！
    return;  // 直接 return undefined，调用方 await 解析为 undefined
  } catch {
    // 最终失败
  }
}

throw new Error("Fullscreen API not supported");
```

`video.webkitEnterFullscreen()` 是同步 API，不返回 Promise。`requestFullscreen` 函数声明为 `async` 并返回 `Promise<void>`，当走到 iOS 降级分支时直接 `return`（等价于 `return undefined`），调用方 `await` 会立即解析。但问题在于：

1. **没有 `fullscreenchange` 事件**: iOS 的 `webkitEnterFullscreen` 不会触发标准的 `fullscreenchange` 事件，而是触发 `webkitbeginfullscreen` / `webkitendfullscreen`。`useFullscreen` hook 监听的是 `fullscreenchange` 和 `webkitfullscreenchange`，**iOS 视频全屏时状态不会同步**。
2. **无法通过 API 退出**: iOS 视频全屏只能通过用户点击系统提供的完成按钮或按 Home 键退出，没有对应的 `video.webkitExitFullscreen()` API。`fullscreen.exitFullscreen()` 中的降级链不包含视频元素的 `webkitCancelFullScreen`。

**建议修复**:
1. 将 `webkitEnterFullscreen()` 包装为 Promise，通过监听 `webkitendfullscreen` 事件来模拟状态同步：

```typescript
// iOS video 全屏降级
if (video && (video as any).webkitEnterFullscreen) {
  return new Promise<void>((resolve) => {
    const onEnd = () => {
      video.removeEventListener("webkitendfullscreen", onEnd);
      resolve();
    };
    video.addEventListener("webkitendfullscreen", onEnd);
    (video as any).webkitEnterFullscreen();
  });
}
```

2. 在 `exitFullscreen` 中添加视频元素的 `webkitCancelFullScreen` 降级：

```typescript
// iOS 退出视频全屏
const video = document.querySelector("video");
if (video && (video as any).webkitCancelFullScreen) {
  try {
    (video as any).webkitCancelFullScreen();
    return;
  } catch { /* */ }
}
```

3. 在 `useFullscreen` 的 `useEffect` 中补充监听 `webkitbeginfullscreen` / `webkitendfullscreen`：

```typescript
useEffect(() => {
  const handler = () => {
    const next = fullscreen.isFullscreen();
    setIsFullscreen(next);
    if (!next) fullscreen.unlockOrientation();
  };
  fullscreen.addChangeListener(handler);
  // 补充 iOS 视频全屏事件
  const videos = document.querySelectorAll("video");
  videos.forEach(v => {
    v.addEventListener("webkitbeginfullscreen", handler);
    v.addEventListener("webkitendfullscreen", handler);
  });
  return () => {
    fullscreen.removeChangeListener(handler);
    videos.forEach(v => {
      v.removeEventListener("webkitbeginfullscreen", handler);
      v.removeEventListener("webkitendfullscreen", handler);
    });
  };
}, []);
```

---

## 二、中风险问题

### M1. `GestureOverlay.tsx` 使用 React 合成事件的 Capture 阶段 — 与架构文档描述的"原生 addEventListener capture"不一致，且无法阻止 ckplayer 原生事件

**位置**: `frontend/src/components/GestureOverlay.tsx` 第 31-33 行

**问题描述**:
架构文档 1.1 节明确说明：
> 事件绑定：在 `touch-overlay` 上使用 `{ capture: true }` 监听 `touchstart` / `touchmove` / `touchend`

但实际实现使用的是 React 合成事件的 `onTouchStartCapture`：

```tsx
<div
  ref={overlayRef}
  className="gesture-overlay"
  onTouchStartCapture={onTouchStart}
  onTouchMoveCapture={onTouchMove}
  onTouchEndCapture={onTouchEnd}
>
```

React 合成事件的 capture 阶段**只在 React 事件系统内部**生效，无法阻止 ckplayer 通过原生 `addEventListener` 绑定的事件。ckplayer 如果也在容器上绑定了原生 touch 事件，React 合成事件的 `stopPropagation()` 无法阻止它们。

**建议修复**:
在 `GestureOverlay.tsx` 中使用 `useEffect` + 原生 `addEventListener(..., { capture: true })`：

```tsx
useEffect(() => {
  const el = overlayRef.current;
  if (!el) return;
  const opts = { capture: true, passive: false };
  el.addEventListener("touchstart", onTouchStart, opts);
  el.addEventListener("touchmove", onTouchMove, opts);
  el.addEventListener("touchend", onTouchEnd, opts);
  el.addEventListener("touchcancel", onTouchEnd, opts);
  return () => {
    el.removeEventListener("touchstart", onTouchStart, opts);
    el.removeEventListener("touchmove", onTouchMove, opts);
    el.removeEventListener("touchend", onTouchEnd, opts);
    el.removeEventListener("touchcancel", onTouchEnd, opts);
  };
}, [onTouchStart, onTouchMove, onTouchEnd]);
```

> 注意：这样改后 `onTouchStart` 等回调接收的是原生 `TouchEvent` 而非 `React.TouchEvent`，需要同步调整 `usePlayerGestures.ts` 的类型定义。

---

### M2. `useAutoHide.ts` 的 `resetTimer` 依赖项包含 `hideControls`，而 `hideControls` 依赖 `onHide` — 每次 `onHide` 引用变化会导致 `resetTimer` 重建，进而导致 `showControls` 重建

**位置**: `frontend/src/hooks/useAutoHide.ts` 第 50-56 行

**问题描述**:
```typescript
const resetTimer = useCallback(() => {
  clearTimer();
  const actualDelay = isFullscreen ? fullscreenDelay : delay;
  timerRef.current = setTimeout(() => {
    hideControls();  // 依赖 hideControls
  }, actualDelay);
}, [clearTimer, hideControls, isFullscreen, delay, fullscreenDelay]);
```

`hideControls` 的依赖链：`hideControls` -> `[onHide]` -> `onHide` 是外部传入的回调引用。如果父组件每次渲染都创建新的 `onHide` 函数（如内联箭头函数），则 `resetTimer` 和 `showControls` 都会重新创建，导致 autoHide 计时器行为不可预测。

**建议修复**:
使用 `useRef` 稳定回调引用：

```typescript
const onHideRef = useRef(onHide);
onHideRef.current = onHide;

const hideControls = useCallback(() => {
  if (visibleRef.current) {
    visibleRef.current = false;
    onHideRef.current();
  }
}, []);  // 空依赖
```

同理处理 `onShow`。

---

### M3. `Player.tsx` 键盘事件绑定在 `containerRef` 上，但 `GestureOverlay` 的鼠标事件可能与之冲突

**位置**: `frontend/src/pages/Player.tsx` 第 261-262 行

**问题描述**:
```typescript
container.addEventListener("keydown", handleKeyDown);
container.addEventListener("keyup", handleKeyUp);
```

键盘事件绑定在 `containerRef`（`.player-layout` div）上。`GestureOverlay` 的鼠标事件（`onMouseDown`/`onMouseMove`/`onMouseUp`）绑定在覆盖层上。当用户在播放器区域使用鼠标操作时：

1. 鼠标单击 -> `onMouseUp` 中触发 `onSingleTap` -> `autoHide.showControls()` / `autoHide.hideControls()`
2. 键盘 ArrowLeft/ArrowRight -> `handleKeyDown`/`handleKeyUp` -> `seek()`

两者目前互不干扰，但 `Player.tsx` 中没有将键盘操作也接入 `autoHide` 的 `showControls()`。按 ATDD 场景 3：
> 显示控制栏：任何用户交互（单击、双击、滑动、选集切换、**键盘操作**）触发 `showControls()` 并重置计时器。

**建议修复**:
在 `handleKeyDown` 和 `handleKeyUp` 中调用 `autoHide.showControls()`（如果 Player.tsx 要使用 autoHide），或者将键盘事件也视为交互来重置计时器。当前 `Player.tsx` 没有使用 `useAutoHide`，这个 hook 只在 `VideoPlayer.tsx` 中使用，而键盘逻辑在 `Player.tsx` 中，两者没有联动。

**更根本的问题**：`Player.tsx` 和 `VideoPlayer.tsx` 各自管理控制栏显隐，没有统一。`Player.tsx` 的键盘操作不会触发 `VideoPlayer.tsx` 中 `autoHide` 的计时器重置，导致键盘 seek 后控制栏可能不会自动隐藏。

---

## 三、低风险改进项

### L1. `usePlayerGestures.ts` 中 `handleRecognized` 的依赖数组缺少 `setGestureState` 和 `setSwipeFeedback`

**位置**: `frontend/src/hooks/usePlayerGestures.ts` 第 98-114 行

`setGestureState` 和 `setSwipeFeedback` 是 React 的 dispatch 函数，引用稳定，ESLint 不会报错。但为代码可读性考虑，建议显式包含或加注释说明。

---

### L2. `VideoPlayer.tsx` 中 `seek` 边界处理未 clamp 到 `duration - 1`

**位置**: `frontend/src/components/VideoPlayer.tsx` 第 124-129 行

```typescript
const next = Math.max(
  0,
  Math.min(video.currentTime + delta, video.duration || 0)
);
```

ATDD 场景 2 要求：
> 边界处理：seek 目标时间 < 0 时 clamp 到 0；> duration 时 clamp 到 duration - 1。

当前实现 clamp 到 `duration` 而非 `duration - 1`。虽然对于绝大多数视频来说 `seekTo(duration)` 会被浏览器自动处理为接近结尾的位置，但严格按 ATDD 应改为 `duration - 1`。

---

### L3. `SeekFeedback.tsx` 中 `direction` 为 `null` 时仍有 800ms 延迟消失

**位置**: `frontend/src/components/SeekFeedback.tsx` 第 15-22 行

```typescript
useEffect(() => {
  if (visible && direction) {
    setShow(true);
  } else {
    const timer = setTimeout(() => setShow(false), 800);
    return () => clearTimeout(timer);
  }
}, [visible, direction]);
```

当 `visible` 从 `true` 变为 `false` 时，组件会等待 800ms 后才 `setShow(false)`，这是预期的淡出效果。但当 `direction` 变为 `null` 时（如组件即将卸载），也走同样的延迟路径。如果组件在 800ms 内卸载，定时器回调会在已卸载的组件上调用 `setShow`，虽然 React 18 的并发模式下不会报错，但建议增加 mounted ref 保护。

---

### L4. `global.css` 中 `:fullscreen` 伪类选择器未覆盖 `:-ms-fullscreen`

**位置**: `frontend/src/styles/global.css` 第 699-724 行

```css
:fullscreen .player-layout,
:-webkit-full-screen .player-layout,
:-moz-full-screen .player-layout {
  height: 100dvh !important;
}
```

缺少 `:-ms-fullscreen`（IE11/Edge 旧版）。虽然项目目标浏览器可能不包含 IE11，但 `fullscreen.ts` 中确实处理了 `msRequestFullscreen`，CSS 也应保持一致。

---

### L5. `VideoPlayer.tsx` 中 `controlsVisible` 的 CSS 同步使用 `querySelector` — ckplayer 控制栏类名可能变化

**位置**: `frontend/src/components/VideoPlayer.tsx` 第 321-332 行

```typescript
const controls = container.querySelector(
  ".ckplayer-controls, .ck-control-bar, .ck-controls"
) as HTMLElement | null;
```

这种防御性选择器是好的，但如果 ckplayer 版本升级后控制栏类名变化，控制栏显隐功能会静默失效。建议增加 fallback：如果找不到控制栏元素，至少记录一个 warning。

---

### L6. `usePlayerGestures.ts` 鼠标事件中 `onMouseMove` 滑动触发后直接调用 `onSwipe`，未经过 `handleRecognized` 状态机

**位置**: `frontend/src/hooks/usePlayerGestures.ts` 第 284-304 行

```typescript
if (Math.abs(dx) > SWIPE_THRESHOLD && ...) {
  const direction = dx > 0 ? "right" : "left";
  mouse.down = false;
  onSwipe(direction);  // 直接调用，未走 handleRecognized
  mouseRef.current = null;
}
```

鼠标滑动直接调用 `onSwipe`，没有设置 `gestureState` 为 `"recognized"` 再回 `"idle"`，也没有清理 `swipeFeedback`。虽然鼠标事件是辅助功能，但状态机不一致可能导致调试困难。

---

### L7. `Player.tsx` 中 `IS_MOBILE` 在模块加载时计算一次 — 服务端渲染或热更新时可能不准确

**位置**: `frontend/src/pages/Player.tsx` 第 11 行

```typescript
const IS_MOBILE = typeof window !== "undefined" && window.innerWidth < 768;
```

模块级常量只在加载时计算一次。如果用户旋转屏幕或调整窗口大小，`IS_MOBILE` 不会更新。虽然组件内有 `useEffect` 监听 resize 并维护 `isMobile` state，但 `sidebarOpen` 的初始值使用了这个可能过时的常量：

```typescript
const [sidebarOpen, setSidebarOpen] = useState(!IS_MOBILE);
```

建议直接使用 `window.innerWidth < 768` 的实时值作为初始 state，或接受当前行为（resize effect 会在首次渲染后修正）。

---

## 四、审查清单逐项结论

| # | 检查项 | 结论 | 说明 |
|---|--------|------|------|
| 1 | 手势状态机 | **部分通过** | 状态转换基本正确，但存在 R1（双击竞态）和 R2（滑动后未清理 dataRef）问题 |
| 2 | ckplayer 冲突 | **未通过** | 使用 React 合成事件 capture 而非原生 capture（M1），且未处理 `touchcancel` |
| 3 | 双击/单击互斥 | **部分通过** | 300ms 定时器管理基本正确，但 R1 竞态条件可能导致互斥失效 |
| 4 | 全屏降级 | **部分通过** | 降级链完整（标准→webkit→moz→ms→video），但 iOS 视频全屏存在 R3 问题 |
| 5 | 控制栏 autoHide | **部分通过** | 计时器清理正确，但 `onHide`/`onShow` 引用不稳定导致重建风险（M2） |
| 6 | TypeScript 类型 | **通过** | 无 `any`（除与 ckplayer 交互的 `playerRef.current?.seek()` 等必要位置），手势事件类型使用 `React.TouchEvent` 正确 |
| 7 | 内存泄漏 | **部分通过** | `useEffect` cleanup 基本正确，但 `usePlayerGestures.ts` 中滑动/pinch 后直接 `return` 未清理 dataRef（R2）；`SeekFeedback` 的定时器在快速切换时可能堆积（L3） |
| 8 | 键盘逻辑 | **通过** | ArrowLeft/ArrowRight 逻辑在 `Player.tsx` 中独立实现，未受手势系统影响 |
| 9 | 性能 | **通过** | 手势识别仅比较坐标差值，无 `requestAnimationFrame` 滥用；`touchmove` 中无重计算 |

---

## 五、修复优先级建议

### P0（阻塞合并）
1. **R1**: `usePlayerGestures.ts` 双击判定竞态条件 — 影响核心交互正确性
2. **R3**: `fullscreen.ts` iOS 视频全屏 Promise 和状态同步 — 影响 iOS 全屏体验

### P1（建议合并前修复）
3. **M1**: `GestureOverlay.tsx` 改用原生 addEventListener capture — 影响 ckplayer 事件隔离效果
4. **M2**: `useAutoHide.ts` 使用 ref 稳定回调引用 — 影响计时器稳定性
5. **R2**: `usePlayerGestures.ts` 滑动/pinch 后显式清理 dataRef — 影响状态机健壮性

### P2（可后续迭代）
6. **M3**: `Player.tsx` 键盘操作接入 autoHide 计时器重置
7. **L2**: `VideoPlayer.tsx` seek 边界 clamp 到 `duration - 1`
8. **L3-L7**: 其他低风险改进项

---

## 六、架构符合度评估

| 架构章节 | 符合度 | 偏差说明 |
|----------|--------|----------|
| 1.1 事件监听层 | 70% | 未使用原生 addEventListener capture；未处理 touchcancel |
| 1.2 手势识别器 | 85% | 状态机实现正确，但缺少 R1/R2 的边界处理 |
| 1.3 ckplayer 隔离 | 60% | 控制栏豁免正确（`.ckplayer-controls, .ck-control`），但 capture 阶段实现方式不对 |
| 2. 手势优先级 | 90% | 优先级判定逻辑正确，垂直滑动正确忽略 |
| 3. 全屏 API | 75% | 降级链完整，但 iOS 特殊处理有缺陷 |
| 4. autoHide | 80% | 计时器管理正确，但引用稳定性待改进 |
| 5. 选集面板 | 95% | 桌面 sidebar + 移动端 drawer 实现与架构一致 |
| 8. 接口契约 | 90% | `VideoPlayerHandle` 扩展了 `play`/`pause`/`togglePlay`，与契约一致 |
