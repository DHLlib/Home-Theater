# AC-022 ATDD 验收测试草案 — 播放器触摸交互与手势控制

## 分析结论

### 现有代码状态
- **VideoPlayer.tsx**（组件归属：frontend）：封装 ckplayer 实例，通过 `useImperativeHandle` 暴露 `seekTo` / `getCurrentTime` / `getDuration` 三个方法，供父组件调用。
- **Player.tsx**（组件归属：frontend）：播放页容器，已实现键盘快进快退（短按 15s、长按连续 5s/200ms）。触摸手势需在此层或 VideoPlayer 层新增实现。
- **ckplayer 版本**：当前依赖 `ckplayer` npm 包（v3.x），其内置 UI 可能已包含基础点击/触摸处理，但**未暴露手势 API**。新增手势逻辑需通过原生 TouchEvent 自行实现，并注意与 ckplayer 内置事件的冲突规避。

### 关键风险点
1. **ckplayer 内置事件冲突**：ckplayer 自身可能在播放器区域监听 `click` / `touchstart` / `touchend`，自定义手势层需使用 `capture` 阶段或判断事件目标，避免被 ckplayer 消费掉。
2. **全屏 API 兼容性**：iOS Safari 仅支持 `webkitEnterFullscreen`（作用于 `<video>` 元素），而标准 `Element.requestFullscreen()` 在 iOS 上受限。需双重降级策略。
3. **手势误触**：单击（意图唤出控制栏）与双击（意图暂停/播放）需通过 300ms 窗口期区分；滑动与点击需通过位移阈值（> 50px）区分。
4. **控制栏自动隐藏**：ckplayer 自带控制栏，若系统层也实现一套，需明确由谁负责。建议复用 ckplayer 控制栏的 `autoHide` 配置，或在其之上叠加透明触摸层统一接管。
5. **HLS 播放时 seek 精度**：HLS.js 的 `video.currentTime` 在部分浏览器上为近似值，测试时需允许 ±1s 误差。

---

## 场景 1: 双击暂停/播放

**Given** 视频正在播放，控制栏已隐藏或可见
**When** 用户在播放器区域快速双击（两次 `touchend` 间隔 < 300ms）
**Then** 视频暂停，ckplayer 显示暂停图标/遮罩
**When** 用户再次双击
**Then** 视频恢复播放

### 测试要点
- 双击区域：覆盖整个播放器容器（含视频画面），不包括选集面板和外部按钮。
- 误触防护：两次触摸位移 > 20px 时不视为双击，降级为滑动处理。
- 与 ckplayer 单击冲突：ckplayer 单击通常唤出/隐藏控制栏，双击逻辑应在 300ms 等待期内阻止单击事件冒泡到 ckplayer。
- 状态断言：通过 `video.paused` 属性断言暂停/播放状态。

---

## 场景 2: 左右滑动快进快退

**Given** 视频正在播放
**When** 用户在播放器区域水平向右滑动，位移 > 50px
**Then** 视频快进 10 秒（调用 `seekTo(currentTime + 10)`）
**When** 用户在播放器区域水平向左滑动，位移 > 50px
**Then** 视频快退 10 秒（调用 `seekTo(currentTime - 10)`）

### 测试要点
- 滑动识别：仅响应水平方向（|dx| > |dy| * 2），垂直滑动不触发快进快退（避免与页面滚动冲突）。
- 位移阈值：最小 50px，小于阈值视为点击/误触，不执行 seek。
- 视觉反馈：滑动时显示半透明提示层（如「快进 10s」/「快退 10s」），滑动结束后 800ms 自动消失。
- 边界处理：seek 目标时间 < 0 时 clamp 到 0；> duration 时 clamp 到 duration - 1。
- 与键盘快进区别：触摸滑动固定 10s/次，不区分短按长按（长按在触摸端由持续滑动替代）。

---

## 场景 3: 控制栏自动隐藏/唤出

**Given** 视频正在播放，用户 3 秒内未进行任何触摸操作
**Then** 播放器控制栏（进度条、播放按钮、全屏按钮等）自动隐藏
**When** 用户单击播放器区域
**Then** 控制栏重新显示
**When** 用户再次单击或 3 秒后无操作
**Then** 控制栏再次隐藏

### 测试要点
- 隐藏延迟：建议 3000ms（可配置），与 ckplayer 默认行为对齐或覆盖。
- 隐藏范围：仅隐藏 ckplayer 控制栏 UI，视频画面持续播放，不暂停。
- 交互期间不隐藏：用户正在拖动进度条、调节音量时，隐藏计时器应重置。
- 全屏状态：全屏模式下隐藏延迟可延长至 5000ms，提升观影体验。
- 与双击的互斥：双击的 300ms 判定窗口内，控制栏不应因第一次触摸而闪现后立刻隐藏。

---

## 场景 4: 全屏切换

**Given** 视频处于内嵌播放状态
**When** 用户点击播放器右下角全屏按钮，或在播放器区域双指张开（pinch out）
**Then** 播放器进入全屏模式，视频画面占满整个屏幕
**When** 用户点击全屏状态下的退出按钮，或双指捏合（pinch in），或按 ESC 键
**Then** 播放器退出全屏，恢复内嵌布局

### 测试要点
- API 兼容性矩阵：
  | 浏览器 | 首选 API | 降级方案 |
  |---|---|---|
  | Chrome/Android | `Element.requestFullscreen()` | — |
  | iOS Safari | `video.webkitEnterFullscreen()` | 容器 `requestFullscreen()` |
  | 旧版 Safari | `webkitRequestFullscreen()` | — |
- 全屏元素：优先让整个播放器容器全屏（保留选集面板可用性），若容器全屏失败则退到仅 video 元素全屏。
- 状态同步：全屏切换后，`document.fullscreenElement` 与播放器内部状态保持一致；监听 `fullscreenchange` 事件处理浏览器原生退出（如用户按 Home 键后返回）。
- 方向锁定：移动端全屏时建议锁定为横屏（`screen.orientation.lock('landscape')`），退出时解锁。不支持时静默失败。
- 与系统手势冲突：iOS 从底部上滑退出全屏是系统行为，不应阻止。

---

## 场景 5: 手势冲突处理

**Given** 视频正在播放
**When** 用户快速连续进行多种触摸操作（单击、双击、滑动混合）
**Then** 系统按以下优先级正确识别，不产生错乱行为：
1. 双指操作 → 识别为 pinch，触发全屏进入/退出
2. 双击（两次触摸间隔 < 300ms 且位移 < 20px） → 暂停/播放
3. 水平滑动（|dx| > 50px 且 |dx| > |dy| * 2） → 快进/快退
4. 单击 → 唤出/隐藏控制栏
5. 垂直滑动 → 忽略（不拦截，允许页面滚动）

### 测试要点
- 事件节流：同一触摸序列（`touchstart` → `touchend`）只触发一种行为，不重复执行。
- 300ms 单击延迟：为区分双击，第一次 `touchend` 后延迟 300ms 再执行单击逻辑；若 300ms 内收到第二次触摸，取消单击并执行双击。
- 滑动期间禁用单击：滑动判定成立后，该触摸序列的 `touchend` 不触发单击/双击。
- ckplayer 内部事件隔离：在播放器容器上绑定 `touchstart`/`touchmove`/`touchend`（`capture: true`），识别完成后按需 `stopPropagation()`，避免 ckplayer 内部控制栏同时响应。

---

## 场景 6: 移动端选集面板交互

**Given** 用户在移动端播放页，选集面板处于展开状态
**When** 用户点击某集数按钮
**Then** 播放器切换至该集，控制栏短暂显示后自动隐藏
**When** 用户在播放器区域向左滑动（从右边缘滑入）
**Then** 若选集面板已收起，则展开选集面板；若已展开，则不做任何事（或收起）

### 测试要点
- 选集面板在移动端（< 768px）应默认收起，以最大化视频区域。
- 面板展开时从右侧滑入，占屏幕宽度 70%，背景遮罩可点击关闭。
- 面板展开期间，播放器区域的触摸手势仍应正常工作（事件委托到遮罩层之下的播放器层）。

---

## 场景 7: 不同浏览器/设备兼容性

**Given** 用户分别使用 iOS Safari、Chrome Android、微信内置浏览器播放视频
**When** 执行上述所有手势操作
**Then** 行为一致，无报错或功能缺失

### 测试要点
- iOS Safari：验证 `video.webkitEnterFullscreen()` 可用；验证 HLS 原生播放时 seek 正常。
- Chrome Android：验证标准 Fullscreen API 可用；验证滑动事件不被浏览器手势（如返回上一页）拦截。
- 微信内置浏览器：验证全屏 API 受限时的降级表现；验证触摸事件不被微信内置播放器覆盖。
- 低端设备：验证手势识别不引起明显掉帧（避免在 `touchmove` 中做重计算，使用 `requestAnimationFrame` 节流）。
