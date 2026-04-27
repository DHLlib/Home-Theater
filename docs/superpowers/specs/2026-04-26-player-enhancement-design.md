# Phase 1：播放器增强设计规格

> 日期：2026-04-26
> 来源：基于 MVP v0.1.0 的下一阶段规划

---

## 目标

将当前的播放器从占位状态升级为完整可用的视频播放组件，支持 ckplayer 真实接入、键盘快进快退、播放进度恢复与上报。

---

## 架构

```
Player.tsx（页面容器）
├── 路由参数解析（site_id, original_id, ep）
├── 集数列表状态管理（currentIndex, episodes）
├── 视频元数据状态（title, year, poster）
└── VideoPlayer.tsx（播放器组件）
    ├── ckplayer 实例生命周期（初始化 / 销毁）
    ├── 键盘事件处理（← → 单击 + 长按连续控制）
    ├── 缓冲状态监听（waiting / playing / seeking / seeked）
    └── 进度上报定时器（15s interval + sendBeacon 兜底）
```

---

## 功能详述

### 1. ckplayer 接入

- **安装**：`npm install ckplayer`
- **React 封装**：`VideoPlayer` 组件接收 `videoUrl`、`suffix`、`initialTime`、`onTimeUpdate`、`onEnded`
- **初始化**：`useEffect` 中 `new ckplayer({ container, video: videoUrl, autoplay: true, html5m3u8: true })`
- **销毁**：组件卸载或 URL 变化时调用 `player.remove()`

### 2. 上一集 / 下一集

- `Player.tsx` 本地维护 `currentIndex`
- 点击"上一集"/"下一集"仅修改 `currentIndex`，不重新请求后端
- URL 中 `?ep=N` 同步更新，支持深链与刷新恢复
- 边界：`currentIndex <= 0` 时禁用上一集，`>= episodes.length - 1` 时禁用下一集

### 3. 键盘快进快退

| 按键 | 短按（<2s 释放） | 长按（>2s） |
|------|------------------|-------------|
| `←` | 后退 15s | 连续快退，每 200ms 减 5s |
| `→` | 快进 15s | 连续快进，每 200ms 加 5s |

- 容器 `div` 设置 `tabIndex={0}` 确保能接收键盘事件
- `keydown`：启动 2s 定时器，**不立即执行跳转**
- `keyup`：
  - 如果 `< 2s`：执行对应方向 15s 跳转
  - 如果 `>= 2s`：已在连续模式中，停止 interval 即可（不额外执行 15s）
- 2s 定时器触发后：启动 `setInterval` 连续控制，**不再执行初始 15s**
- 释放按键时清除所有 timer/interval
- 快退到 `< 0` clamp 到 0，快进到 `> duration` clamp 到 duration

### 4. 缓冲等待提示

- 监听 ckplayer 底层 `<video>` 的 `waiting`、`playing`、`seeking`、`seeked` 事件
- `waiting` / `seeking`：显示居中加载圈（CSS 旋转动画）
- `playing` / `seeked`：隐藏加载圈

### 5. 播放进度恢复

- 页面进入时，`GET /api/progress?title=&year=`
- 有记录则 `player.video.currentTime = savedPosition`
- 无记录则从 0 开始

### 6. 进度上报

- `setInterval` 每 15s `POST /api/progress`
- 上报字段：`title`、`year`、`source_site_id`、`source_video_id`、`episode_index`、`episode_name`、`position_seconds`、`duration_seconds`
- `beforeunload`：`navigator.sendBeacon('/api/progress', blob)` 兜底

---

## 边界与错误处理

- ckplayer 初始化失败：显示错误提示，提供刷新按钮
- 视频 URL 无效：ckplayer 会触发 error 事件，显示"播放地址失效"
- 进度恢复跳转后缓冲：正常显示加载圈，用户等待
- 组件卸载时：必须清除所有 timer/interval，销毁 ckplayer 实例，防止内存泄漏

---

## 不在本 Phase

- 倍速选择 UI（ckplayer 自带，但不做自定义 UI）
- 画质切换（需要资源站支持多码率）
- 弹幕
- 画中画

---

## 验证清单

1. 安装 ckplayer 后 `npm run build` 通过
2. 播放器页面正常加载视频，自动播放
3. 按 `←`/`→` 单击快进快退 15s
4. 长按 `←`/`→` 超过 2s 触发连续控制
5. 拖动进度条到未加载区域，显示加载圈
6. 刷新页面，自动恢复到上次播放位置
7. 切换上下集，URL `?ep=` 同步更新
8. 页面关闭后重新进入，进度正确恢复
