import { toastError } from "../utils/toast";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  const opts: RequestInit = { method, headers: {}, signal: controller.signal };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  try {
    const resp = await fetch(path, opts);
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const err = new ApiError(resp.status, data.detail || `${resp.status} error`);
      toastError(err.detail);
      throw err;
    }
    return resp.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const get = <T>(path: string, timeoutMs?: number) => request<T>("GET", path, undefined, timeoutMs);
export const post = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  request<T>("POST", path, body, timeoutMs);
export const put = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  request<T>("PUT", path, body, timeoutMs);
export const patch = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  request<T>("PATCH", path, body, timeoutMs);
export const del = <T>(path: string, timeoutMs?: number) => request<T>("DELETE", path, undefined, timeoutMs);
