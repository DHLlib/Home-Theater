/**
 * 全屏 API 兼容性工具函数
 * 标准 API → webkit 前缀 → iOS video.webkitEnterFullscreen 降级
 */

export interface FullscreenAPI {
  requestFullscreen(element: HTMLElement): Promise<void>;
  exitFullscreen(): Promise<void>;
  isFullscreen(): boolean;
  getFullscreenElement(): Element | null;
  lockOrientation(): Promise<void>;
  unlockOrientation(): Promise<void>;
  addChangeListener(handler: () => void): void;
  removeChangeListener(handler: () => void): void;
}

function getFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    null
  );
}

function isFullscreen(): boolean {
  return !!getFullscreenElement();
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

async function requestFullscreen(element: HTMLElement): Promise<void> {
  const video = element.querySelector("video");

  // iOS Safari：优先使用 video.webkitEnterFullscreen，系统级全屏会自动横屏
  if (isIOS() && video && (video as any).webkitEnterFullscreen) {
    try {
      (video as any).webkitEnterFullscreen();
      return;
    } catch {
      // 降级到容器全屏
    }
  }

  // Android 国产浏览器（夸克/微信/UC）：优先尝试 video 元素的全屏
  if (!isIOS() && video) {
    const videoEl = video as any;
    if (videoEl.requestFullscreen) {
      try {
        await videoEl.requestFullscreen();
        return;
      } catch {
        // 降级
      }
    }
    if (videoEl.webkitRequestFullscreen) {
      try {
        await videoEl.webkitRequestFullscreen();
        return;
      } catch {
        // 降级
      }
    }
  }

  // 1. 标准 API
  if (element.requestFullscreen) {
    try {
      await element.requestFullscreen();
      return;
    } catch {
      // 降级
    }
  }

  // 2. webkit 前缀
  const webkitReq = (element as any).webkitRequestFullscreen;
  if (webkitReq) {
    try {
      await webkitReq.call(element);
      return;
    } catch {
      // 降级
    }
  }

  // 3. moz 前缀
  const mozReq = (element as any).mozRequestFullScreen;
  if (mozReq) {
    try {
      await mozReq.call(element);
      return;
    } catch {
      // 降级
    }
  }

  // 4. ms 前缀
  const msReq = (element as any).msRequestFullscreen;
  if (msReq) {
    try {
      await msReq.call(element);
      return;
    } catch {
      // 降级
    }
  }

  // 5. 最终降级：video 元素 webkitEnterFullscreen（iOS 或非 iOS 都尝试）
  if (video && (video as any).webkitEnterFullscreen) {
    try {
      (video as any).webkitEnterFullscreen();
      return;
    } catch {
      // 最终失败
    }
  }

  throw new Error("Fullscreen API not supported");
}

async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;

  const doc = document as any;

  if (document.exitFullscreen) {
    try {
      await document.exitFullscreen();
      return;
    } catch {
      // 降级
    }
  }

  if (doc.webkitExitFullscreen) {
    try {
      await doc.webkitExitFullscreen();
      return;
    } catch {
      // 降级
    }
  }

  if (doc.mozCancelFullScreen) {
    try {
      await doc.mozCancelFullScreen();
      return;
    } catch {
      // 降级
    }
  }

  if (doc.msExitFullscreen) {
    try {
      await doc.msExitFullscreen();
      return;
    } catch {
      // 降级
    }
  }
}

async function lockOrientation(): Promise<void> {
  try {
    const lock = (screen as any).orientation?.lock;
    if (lock) {
      await lock.call((screen as any).orientation, "landscape");
    }
  } catch {
    // 静默失败
  }
}

async function unlockOrientation(): Promise<void> {
  try {
    const unlock = (screen as any).orientation?.unlock;
    if (unlock) {
      unlock.call((screen as any).orientation);
    }
  } catch {
    // 静默失败
  }
}

function addChangeListener(handler: () => void): void {
  document.addEventListener("fullscreenchange", handler);
  document.addEventListener("webkitfullscreenchange", handler);
  document.addEventListener("mozfullscreenchange", handler);
  document.addEventListener("MSFullscreenChange", handler);
  // iOS video 元素全屏事件（webkitEnterFullscreen 不会触发 fullscreenchange）
  document.addEventListener("webkitbeginfullscreen", handler);
  document.addEventListener("webkitendfullscreen", handler);
}

function removeChangeListener(handler: () => void): void {
  document.removeEventListener("fullscreenchange", handler);
  document.removeEventListener("webkitfullscreenchange", handler);
  document.removeEventListener("mozfullscreenchange", handler);
  document.removeEventListener("MSFullscreenChange", handler);
  document.removeEventListener("webkitbeginfullscreen", handler);
  document.removeEventListener("webkitendfullscreen", handler);
}

export const fullscreen: FullscreenAPI = {
  requestFullscreen,
  exitFullscreen,
  isFullscreen,
  getFullscreenElement,
  lockOrientation,
  unlockOrientation,
  addChangeListener,
  removeChangeListener,
};
