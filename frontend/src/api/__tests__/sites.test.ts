import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../client";
import { probeSitesBatch } from "../sites";
import type { SiteProbeResult } from "../../types";

const encoder = new TextEncoder();

const makeResult = (site_id: number, ok = true): SiteProbeResult => ({
  site_id,
  site_name: `站点${site_id}`,
  url: `http://s${site_id}.test/api.php`,
  ok,
  latency_ms: ok ? 120 + site_id : null,
  error: ok ? null : "检测超时",
});

const line = (r: SiteProbeResult) => `${JSON.stringify(r)}\n`;

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function fakeResponse(
  body: ReadableStream<Uint8Array> | null,
  init: { status?: number; json?: unknown } = {}
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    json: () => Promise.resolve(init.json),
  } as unknown as Response;
}

describe("probeSitesBatch NDJSON 流式读取", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("跨 chunk 拆分的行也能按到达顺序逐条回调", async () => {
    const first = JSON.stringify(makeResult(1));
    const second = JSON.stringify(makeResult(2));
    // 第一条结果被拆到两个 chunk 中间，第二条紧随其后
    const chunks = [
      first.slice(0, 10),
      `${first.slice(10)}\n${second}\n`,
    ];
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(streamFromChunks(chunks)));
    vi.stubGlobal("fetch", fetchMock);

    const received: SiteProbeResult[] = [];
    await probeSitesBatch(undefined, (r) => received.push(r));

    expect(received.map((r) => r.site_id)).toEqual([1, 2]);
    expect(received[0]).toEqual(makeResult(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sites/probe-batch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ site_ids: null }),
      })
    );
  });

  it("首行到达时流尚未结束就触发回调", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(stream)));

    const received: SiteProbeResult[] = [];
    let settled = false;
    const promise = probeSitesBatch(null, (r) => received.push(r)).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    controller.enqueue(encoder.encode(line(makeResult(1))));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    // 流还开着：结果已回调，但 Promise 不应结束
    expect(settled).toBe(false);

    controller.enqueue(encoder.encode(line(makeResult(2, false))));
    controller.close();
    await promise;
    expect(received.map((r) => r.site_id)).toEqual([1, 2]);
    expect(received[1].ok).toBe(false);
    expect(settled).toBe(true);
  });

  it("末尾残留的无换行行在流结束时也会解析", async () => {
    const tail = JSON.stringify(makeResult(3));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse(streamFromChunks([line(makeResult(1)), tail]))
      )
    );

    const received: SiteProbeResult[] = [];
    await probeSitesBatch([1, 3], (r) => received.push(r));
    expect(received.map((r) => r.site_id)).toEqual([1, 3]);
  });

  it("空行跳过，不产生回调", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse(streamFromChunks([`\n${line(makeResult(1))}\n\n`]))
      )
    );

    const received: SiteProbeResult[] = [];
    await probeSitesBatch(null, (r) => received.push(r));
    expect(received).toHaveLength(1);
  });

  it("返回内容损坏时中止读取，不能静默丢失站点结果", async () => {
    const stream = streamFromChunks([line(makeResult(1)), "{broken}\n"]);
    const reader = stream.getReader();
    const cancel = vi.spyOn(reader, "cancel");
    const body = { getReader: () => reader } as unknown as ReadableStream<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(body)));

    const received: SiteProbeResult[] = [];
    await expect(
      probeSitesBatch(null, (r) => received.push(r))
    ).rejects.toThrow("批量检测返回了无法解析的结果");
    expect(received.map((r) => r.site_id)).toEqual([1]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("HTTP 非 2xx 时读取 detail 并拒绝", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          fakeResponse(null, { status: 500, json: { detail: "站点查询失败" } })
        )
    );

    const err = await probeSitesBatch(null, () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).detail).toBe("站点查询失败");
  });

  it("HTTP 非 2xx 时兼容 message 错误格式", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          fakeResponse(null, { status: 400, json: { message: "参数错误" } })
        )
    );

    const err = await probeSitesBatch(null, () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).detail).toBe("参数错误");
  });

  it("流传输中途失败时拒绝，但已回调的结果保留", async () => {
    // pull 模式：第一次读取交付一行，第二次读取时流才出错，
    // 模拟真实场景「已收到部分结果后连接中断」
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(encoder.encode(line(makeResult(1))));
        } else {
          controller.error(new TypeError("network down"));
        }
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(stream)));

    const received: SiteProbeResult[] = [];
    const err = await probeSitesBatch(null, (r) => received.push(r)).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(TypeError);
    expect(received.map((r) => r.site_id)).toEqual([1]);
  });

  it("AbortController 取消时以 AbortError 拒绝", async () => {
    const fetchMock = vi.fn().mockImplementation((_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(line(makeResult(1))));
          signal?.addEventListener("abort", () => {
            controller.error(
              new DOMException("The operation was aborted.", "AbortError")
            );
          });
        },
      });
      return Promise.resolve(fakeResponse(stream));
    });
    vi.stubGlobal("fetch", fetchMock);

    const received: SiteProbeResult[] = [];
    const abort = new AbortController();
    const promise = probeSitesBatch(null, (r) => received.push(r), abort.signal);

    await vi.waitFor(() => expect(received).toHaveLength(1));
    abort.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
