export type ToastType = "error" | "success" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let listeners: ((toasts: ToastItem[]) => void)[] = [];
let toasts: ToastItem[] = [];
let nextId = 1;

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
  const id = nextId++;
  toasts.push({ id, type, message });
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
