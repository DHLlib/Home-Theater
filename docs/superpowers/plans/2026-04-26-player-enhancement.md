# Phase 1：播放器增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将播放器从原生 `<video>` 占位升级为 ckplayer 完整播放组件，支持键盘快进快退、缓冲提示、播放进度恢复与上报。

**Architecture:** 新增 `VideoPlayer` 组件封装 ckplayer 生命周期与缓冲监听；`Player` 页面容器负责路由解析、集数状态、键盘控制、进度恢复与定时上报。`Detail` 页面扩展跳转 URL，补充传递 title/year。

**Tech Stack:** React 18 + Vite + TypeScript + ckplayer(npm) + react-router-dom v6

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `frontend/package.json` | 修改 | 添加 `ckplayer` 依赖 |
| `frontend/src/ckplayer.d.ts` | 新建 | ckplayer UMD 模块类型声明 |
| `frontend/src/styles/global.css` | 修改 | 追加缓冲加载圈动画样式 |
| `frontend/src/components/VideoPlayer.tsx` | 新建 | ckplayer React 封装：初始化/销毁/缓冲监听/暴露 seekTo/getCurrentTime/getDuration |
| `frontend/src/pages/Player.tsx` | 重写 | 页面容器：路由参数、集数管理、键盘快进快退、进度恢复、15s 定时上报、sendBeacon 兜底 |
| `frontend/src/pages/Detail.tsx` | 修改 | 跳转 Player 的 URL 追加 `title` 和 `year` 参数 |

---

### Task 1: 安装 ckplayer 并添加类型声明

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/ckplayer.d.ts`

- [ ] **Step 1: 在 package.json dependencies 中追加 ckplayer**

```json
"dependencies": {
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-router-dom": "^6.22.0",
  "ckplayer": "latest"
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd frontend && npm install`
Expected: `ckplayer` 出现在 `node_modules/ckplayer`，无报错。

- [ ] **Step 3: 创建 ckplayer 类型声明文件**

Create `frontend/src/ckplayer.d.ts`:

```typescript
declare module "ckplayer" {
  interface CKPlayerConfig {
    container: HTMLElement | string;
    video: string;
    autoplay?: boolean;
    html5m3u8?: boolean;
  }

  class CKPlayer {
    constructor(config: CKPlayerConfig);
    video: HTMLVideoElement;
    remove(): void;
  }

  export default CKPlayer;
}
```

- [ ] **Step 4: TypeScript 编译检查**

Run: `cd frontend && npm run typecheck`
Expected: 无报错。若报 `Cannot find module 'ckplayer'`，检查 `ckplayer.d.ts` 是否放在 `src/` 下且被 tsconfig 包含。

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/ckplayer.d.ts
git commit -m "deps: 安装 ckplayer 并添加类型声明"
```

---

### Task 2: 创建 VideoPlayer 组件

**Files:**
- Create: `frontend/src/components/VideoPlayer.tsx`

- [ ] **Step 1: 创建 VideoPlayer 组件**

Create `frontend/src/components/VideoPlayer.tsx`:

```tsx
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface VideoPlayerProps {
  videoUrl: string;
  suffix: string;
  initialTime: number;
  onTimeUpdate: (position: number, duration: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
}

export interface VideoPlayerHandle {
  seekTo: (time: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ videoUrl, suffix, initialTime, onTimeUpdate, onEnded, onError }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<any>(null);
    const [buffering, setBuffering] = useState(false);
    const [initError, setInitError] = useState(false);

    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        const video = playerRef.current?.video;
        if (video) video.currentTime = time;
      },
      getCurrentTime: () => playerRef.current?.video?.currentTime || 0,
      getDuration: () => playerRef.current?.video?.duration || 0,
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      let mounted = true;

      import("ckplayer")
        .then((mod) => {
          if (!mounted) return;
          const CK = (mod as any).default || mod;
          const player = new CK({
            container: containerRef.current,
            video: videoUrl,
            autoplay: true,
            html5m3u8: suffix === "m3u8" || suffix === "ckplayer",
          });
          playerRef.current = player;

          const video = player.video;
          if (!video) {
            onError("播放器初始化失败");
            setInitError(true);
            return;
          }

          const onWaiting = () => setBuffering(true);
          const onPlaying = () => setBuffering(false);
          const onSeeking = () => setBuffering(true);
          const onSeeked = () => setBuffering(false);
          const onVideoEnded = () => onEnded();
          const onVideoError = () => {
            setBuffering(false);
            onError("播放地址失效");
          };
          const onTimeUpdateHandler = () => {
            onTimeUpdate(video.currentTime, video.duration);
          };

          video.addEventListener("waiting", onWaiting);
          video.addEventListener("playing", onPlaying);
          video.addEventListener("seeking", onSeeking);
          video.addEventListener("seeked", onSeeked);
          video.addEventListener("ended", onVideoEnded);
          video.addEventListener("error", onVideoError);
          video.addEventListener("timeupdate", onTimeUpdateHandler);

          if (initialTime > 0) {
            const seekOnce = () => {
              video.currentTime = initialTime;
              video.removeEventListener("canplay", seekOnce);
            };
            video.addEventListener("canplay", seekOnce);
          }

          return () => {
            video.removeEventListener("waiting", onWaiting);
            video.removeEventListener("playing", onPlaying);
            video.removeEventListener("seeking", onSeeking);
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("ended", onVideoEnded);
            video.removeEventListener("error", onVideoError);
            video.removeEventListener("timeupdate", onTimeUpdateHandler);
          };
        })
        .catch(() => {
          if (!mounted) return;
          onError("播放器加载失败");
          setInitError(true);
        });

      return () => {
        mounted = false;
        if (playerRef.current) {
          try {
            playerRef.current.remove();
          } catch {
            // ignore
          }
          playerRef.current = null;
        }
      };
    }, [videoUrl, suffix]);

    if (initError) {
      return (
        <div
          style={{
            aspectRatio: "16/9",
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ opacity: 0.7 }}>播放器加载失败</div>
          <button className="btn" onClick={() => window.location.reload()}>
            刷新重试
          </button>
        </div>
      );
    }

    return (
      <div style={{ position: "relative", aspectRatio: "16/9", background: "#000" }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        {buffering && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div className="spinner" />
          </div>
        )}
      </div>
    );
  }
);

VideoPlayer.displayName = "VideoPlayer";
export default VideoPlayer;
```

- [ ] **Step 2: 在 global.css 追加 spinner 样式**

Modify `frontend/src/styles/global.css`，在末尾追加：

```css
.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255,255,255,0.2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `cd frontend && npm run typecheck`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/VideoPlayer.tsx frontend/src/styles/global.css
git commit -m "feat: 创建 VideoPlayer 组件（ckplayer 封装 + 缓冲状态）"
```

---

### Task 3: 重写 Player 页面（基础结构与进度恢复）

**Files:**
- Rewrite: `frontend/src/pages/Player.tsx`

- [ ] **Step 1: 重写 Player.tsx**

Rewrite `frontend/src/pages/Player.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getEpisodes } from "../api/play";
import { getProgress, upsertProgress } from "../api/progress";
import VideoPlayer from "../components/VideoPlayer";
import type { Episode } from "../types";
import type { VideoPlayerHandle } from "../components/VideoPlayer";

export default function Player() {
  const [searchParams, setSearchParams] = useSearchParams();
  const site_id = Number(searchParams.get("site_id"));
  const original_id = searchParams.get("original_id") || "";
  const title = searchParams.get("title") || "";
  const yearRaw = searchParams.get("year");
  const year = yearRaw ? Number(yearRaw) : null;
  const initialEp = Number(searchParams.get("ep") || "0");

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(initialEp);
  const [savedPosition, setSavedPosition] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const videoRef = useRef<VideoPlayerHandle>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = episodes[currentIndex];

  // 加载集数列表
  useEffect(() => {
    if (!site_id || !original_id) {
      setLoading(false);
      return;
    }
    getEpisodes(site_id, original_id)
      .then((eps) => {
        setEpisodes(eps);
        setLoading(false);
      })
      .catch(() => {
        setError("加载视频失败");
        setLoading(false);
      });
  }, [site_id, original_id]);

  // 恢复播放进度
  useEffect(() => {
    if (!title) return;
    getProgress(title, year)
      .then((progress) => {
        if (progress.episode_index === currentIndex && progress.position_seconds > 0) {
          setSavedPosition(progress.position_seconds);
        }
      })
      .catch(() => {
        // 无记录则忽略
      });
  }, [title, year, currentIndex]);

  // 上报进度（15s 定时 + beforeunload sendBeacon）
  useEffect(() => {
    if (!current || !title) return;

    const report = () => {
      const pos = Math.floor(videoRef.current?.getCurrentTime() || 0);
      const dur = Math.floor(videoRef.current?.getDuration() || 0);
      upsertProgress({
        title,
        year,
        source_site_id: site_id,
        source_video_id: original_id,
        episode_index: currentIndex,
        episode_name: current.ep_name,
        position_seconds: pos,
        duration_seconds: dur || null,
      }).catch(() => {});
    };

    progressTimer.current = setInterval(report, 15000);

    const handleBeforeUnload = () => {
      const pos = Math.floor(videoRef.current?.getCurrentTime() || 0);
      const dur = Math.floor(videoRef.current?.getDuration() || 0);
      const data = JSON.stringify({
        title,
        year,
        source_site_id: site_id,
        source_video_id: original_id,
        episode_index: currentIndex,
        episode_name: current.ep_name,
        position_seconds: pos,
        duration_seconds: dur || null,
      });
      navigator.sendBeacon("/api/progress", new Blob([data], { type: "application/json" }));
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [current, currentIndex, site_id, original_id, title, year]);

  // 切换集数时同步 URL
  const switchEpisode = (idx: number) => {
    setCurrentIndex(idx);
    setSavedPosition(0);
    const next = new URLSearchParams(searchParams);
    next.set("ep", String(idx));
    setSearchParams(next, { replace: true });
  };

  if (!site_id || !original_id) {
    return <div className="empty">参数缺失</div>;
  }

  if (loading) {
    return <div className="empty">加载中...</div>;
  }

  if (error) {
    return <div className="empty">{error}</div>;
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <VideoPlayer
        ref={videoRef}
        videoUrl={current?.url || ""}
        suffix={current?.suffix || ""}
        initialTime={savedPosition}
        onTimeUpdate={() => {}}
        onEnded={() => {
          if (currentIndex < episodes.length - 1) {
            switchEpisode(currentIndex + 1);
          }
        }}
        onError={(msg) => setError(msg)}
      />

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <button
          className="btn"
          disabled={currentIndex <= 0}
          onClick={() => switchEpisode(currentIndex - 1)}
        >
          上一集
        </button>
        <div style={{ fontSize: 14 }}>
          {current
            ? `${current.ep_name} (${current.suffix})`
            : "加载中..."}
        </div>
        <button
          className="btn"
          disabled={currentIndex >= episodes.length - 1}
          onClick={() => switchEpisode(currentIndex + 1)}
        >
          下一集
        </button>
      </div>

      <div>
        <h4 style={{ margin: "0 0 8px" }}>选集</h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {episodes.map((ep) => (
            <button
              key={ep.index}
              className="btn"
              style={{
                borderColor:
                  ep.index === currentIndex ? "var(--accent)" : undefined,
                color: ep.index === currentIndex ? "var(--accent)" : undefined,
              }}
              onClick={() => switchEpisode(ep.index)}
            >
              {ep.ep_name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npm run typecheck`
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Player.tsx
git commit -m "feat: 重写 Player 页面（ckplayer 接入 + 进度恢复与上报 + URL 同步）"
```

---

### Task 4: Player 键盘快进快退

**Files:**
- Modify: `frontend/src/pages/Player.tsx`

- [ ] **Step 1: 在 Player.tsx 中新增键盘控制逻辑**

在 Player.tsx 的 import 区下方、`export default function Player()` 内部，添加键盘状态 ref 和处理函数：

```tsx
  const keyState = useRef<{
    key: string | null;
    downAt: number;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    repeatInterval: ReturnType<typeof setInterval> | null;
    inLongPress: boolean;
  }>({
    key: null,
    downAt: 0,
    longPressTimer: null,
    repeatInterval: null,
    inLongPress: false,
  });
```

在 `switchEpisode` 函数之后、`if (!site_id ...)` 之前，添加 `useEffect` 绑定键盘事件：

```tsx
  useEffect(() => {
    const container = document.querySelector<HTMLElement>(".player-container");
    if (!container) return;
    container.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (keyState.current.key) return;

      e.preventDefault();
      keyState.current.key = e.key;
      keyState.current.downAt = Date.now();
      keyState.current.inLongPress = false;

      keyState.current.longPressTimer = setTimeout(() => {
        keyState.current.inLongPress = true;
        keyState.current.repeatInterval = setInterval(() => {
          const currentTime = videoRef.current?.getCurrentTime() || 0;
          const duration = videoRef.current?.getDuration() || 0;
          const delta = keyState.current.key === "ArrowLeft" ? -5 : 5;
          let target = currentTime + delta;
          target = Math.max(0, Math.min(target, duration));
          videoRef.current?.seekTo(target);
        }, 200);
      }, 2000);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== keyState.current.key) return;

      if (keyState.current.longPressTimer) {
        clearTimeout(keyState.current.longPressTimer);
        keyState.current.longPressTimer = null;
      }
      if (keyState.current.repeatInterval) {
        clearInterval(keyState.current.repeatInterval);
        keyState.current.repeatInterval = null;
      }

      const held = Date.now() - keyState.current.downAt;
      if (!keyState.current.inLongPress && held < 2000) {
        const currentTime = videoRef.current?.getCurrentTime() || 0;
        const duration = videoRef.current?.getDuration() || 0;
        const delta = e.key === "ArrowLeft" ? -15 : 15;
        let target = currentTime + delta;
        target = Math.max(0, Math.min(target, duration));
        videoRef.current?.seekTo(target);
      }

      keyState.current.key = null;
      keyState.current.inLongPress = false;
    };

    container.addEventListener("keydown", onKeyDown);
    container.addEventListener("keyup", onKeyUp);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("keyup", onKeyUp);
      if (keyState.current.longPressTimer) clearTimeout(keyState.current.longPressTimer);
      if (keyState.current.repeatInterval) clearInterval(keyState.current.repeatInterval);
    };
  }, []);
```

将最外层 `div` 的 className 改为 `col player-container`，并增加 `tabIndex`：

找到：
```tsx
  return (
    <div className="col" style={{ gap: 16 }}>
```
改为：
```tsx
  return (
    <div
      className="col player-container"
      style={{ gap: 16, outline: "none" }}
      tabIndex={0}
    >
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npm run typecheck`
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Player.tsx
git commit -m "feat: Player 页面支持键盘快进快退（短按 15s / 长按连续 5s）"
```

---

### Task 5: Detail 页面跳转参数扩展

**Files:**
- Modify: `frontend/src/pages/Detail.tsx`

- [ ] **Step 1: 修改 Detail.tsx 中两处跳转到 Player 的 navigate 调用**

第一处：在 `onConfirmSource` 函数内，找到：
```tsx
      navigate(
        `/player?site_id=${source.site_id}&original_id=${encodeURIComponent(
          source.original_id
        )}&ep=0`
      );
```
替换为：
```tsx
      navigate(
        `/player?site_id=${source.site_id}&original_id=${encodeURIComponent(
          source.original_id
        )}&ep=0&title=${encodeURIComponent(item.title)}&year=${
          item.year ?? ""
        }`
      );
```

第二处：在 `detail.map(...)` 内部的 `EpisodeList` 的 `onPick` 回调中，找到：
```tsx
              navigate(
                `/player?site_id=${s.site_id}&original_id=${encodeURIComponent(
                  s.original_id
                )}&ep=${idx}`
              );
```
替换为：
```tsx
              navigate(
                `/player?site_id=${s.site_id}&original_id=${encodeURIComponent(
                  s.original_id
                )}&ep=${idx}&title=${encodeURIComponent(item.title)}&year=${
                  item.year ?? ""
                }`
              );
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npm run typecheck`
Expected: 无报错。

- [ ] **Step 3: 手动验证**

1. `cd frontend && npm run dev`
2. 从首页进入详情页，点击「播放」按钮选源后跳转
3. 检查浏览器地址栏，确认 URL 包含 `title=` 和 `year=` 参数
4. 在详情页 EpisodeList 中点击某一集，确认 URL 同样包含 `title=` 和 `year=`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Detail.tsx
git commit -m "feat: Detail 跳转 Player 时携带 title 和 year 参数"
```

---

### Task 6: 端到端验证与构建

**Files:**
- 无新增/修改，纯验证

- [ ] **Step 1: 完整 TypeScript 编译检查**

Run: `cd frontend && npm run typecheck`
Expected: 无报错。

- [ ] **Step 2: 生产构建验证**

Run: `cd frontend && npm run build`
Expected: `dist/` 目录生成，无报错。

- [ ] **Step 3: 启动开发服务器进行人工 smoke 测试**

Run (两个终端):
```bash
# 终端 1
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload

# 终端 2
cd frontend && npm run dev
```

Smoke 测试清单：
1. 从首页进入详情 → 播放 → ckplayer 加载并自动播放
2. 按 `←`/`→` 单击，视频快进/快退约 15s
3. 长按 `←`/`→` 超过 2s，观察连续快进/快退（每 200ms 5s）
4. 拖动进度条到未加载区域，观察缓冲加载圈出现
5. 播放一段时间后刷新页面，观察是否恢复到上次位置
6. 点击「下一集」，观察 URL 中 `ep=` 同步更新
7. 关闭页面后重新进入同一视频，观察进度是否正确恢复
8. 网络断开或无效 URL，观察错误提示和刷新按钮

- [ ] **Step 4: Commit 构建产物（若需要）**

如果构建产物需要提交到仓库用于 FastAPI 静态托管：
```bash
git add frontend/dist
git commit -m "build: 前端构建产物更新（Phase 1 播放器增强）"
```

---

## Self-Review

**1. Spec coverage:**

| Spec 要求 | 对应 Task |
|-----------|-----------|
| ckplayer 接入（npm install + React 封装） | Task 1, Task 2 |
| 上一集/下一集 + URL `?ep=` 同步 | Task 3 |
| 键盘快进快退（短按 15s / 长按连续 5s） | Task 4 |
| 缓冲等待提示（waiting/playing/seeking/seeked + 加载圈） | Task 2 |
| 播放进度恢复（GET /api/progress） | Task 3 |
| 进度上报（15s interval + sendBeacon） | Task 3 |
| 错误处理（初始化失败、地址失效） | Task 2 |
| 验证清单：build 通过、自动播放、键盘控制、缓冲圈、恢复、URL 同步 | Task 6 |

无遗漏。

**2. Placeholder scan:**

- 无 "TBD"/"TODO"/"implement later"。
- 所有代码块均为可直接复制的完整实现。
- 类型声明、事件监听、清理逻辑均已包含。

**3. Type consistency:**

- `VideoPlayerHandle.seekTo/getCurrentTime/getDuration` 与 `Player.tsx` 中的使用一致。
- `Episode` 类型沿用 `frontend/src/types.ts` 已有定义。
- `PlayProgressIn` / `PlayProgress` 类型与 `api/progress.ts` 已有接口一致。
- `getProgress(title, year)` 的 year 参数类型（`number | null`）与 API 函数签名一致。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-player-enhancement.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**
