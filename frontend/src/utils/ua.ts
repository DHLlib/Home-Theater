/**
 * 根据 User-Agent 与设备特性判断是否为移动设备。
 * 用于在 App 入口处决定渲染桌面版还是移动版。
 */
export function isMobileUA(): boolean {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";

  // 常见移动设备 UA 关键字
  const mobileRegExp = /Mobi|Android|iPhone|iPod|Opera Mini|IEMobile|Mobile|webOS|BlackBerry|Windows Phone/i;
  if (mobileRegExp.test(ua)) return true;

  // iPad on iOS 13+ 默认报告为桌面 Safari，需额外判断
  const isIPad =
    /iPad/.test(ua) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIPad) return true;

  return false;
}
