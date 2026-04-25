import { toastError } from "../utils/toast";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const opts: RequestInit = { method, headers: {} };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(path, opts);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const err = new ApiError(resp.status, data.detail || `${resp.status} error`);
    toastError(err.detail);
    throw err;
  }
  return resp.json();
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body?: unknown) =>
  request<T>("POST", path, body);
export const put = <T>(path: string, body?: unknown) =>
  request<T>("PUT", path, body);
export const patch = <T>(path: string, body?: unknown) =>
  request<T>("PATCH", path, body);
export const del = <T>(path: string) => request<T>("DELETE", path);
