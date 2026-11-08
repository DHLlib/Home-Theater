export type ToastType = "error" | "success" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let listeners: ((toasts: ToastItem[]) => void)[] = [];
let toasts: ToastItem[] = [];
let nextId = 1;

// 同一条错误在短时间内反复出现时（例如后端卡顿导致多个请求一起超时），
// 只保留一条并刷新计时，避免右上角堆成一片
let lastKey = "";
let lastAt = 0;
const DEDUPE_WINDOW_MS = 4000;
const MAX_TOASTS = 3;

function notify() {
  listeners.forEach((fn) => fn([...toasts]));
}

export function subscribe(fn: (toasts: ToastItem[]) => void) {
  listeners.push(fn);
  fn([...toasts]);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function toast(type: ToastType, message: string, duration = 3000) {
  const now = Date.now();
  const key = `${type}:${message}`;
  if (key === lastKey && now - lastAt < DEDUPE_WINDOW_MS) {
    // 同一条消息短时间内重复：刷新时间戳，不追加新条目
    lastAt = now;
    return;
  }
  lastKey = key;
  lastAt = now;

  const id = nextId++;
  toasts = [...toasts, { id, type, message }].slice(-MAX_TOASTS);
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, duration);
}

export function toastError(message: string) {
  toast("error", message);
}

export function toastSuccess(message: string) {
  toast("success", message);
}
