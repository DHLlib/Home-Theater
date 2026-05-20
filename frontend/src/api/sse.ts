type EventCallback = (data: unknown) => void;

interface EventRegistry {
  download_progress: EventCallback[];
  download_status: EventCallback[];
  site_health: EventCallback[];
}

class SseClient {
  private source: EventSource | null = null;
  private listeners: EventRegistry = {
    download_progress: [],
    download_status: [],
    site_health: [],
  };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private connected = false;

  constructor() {
    this.url = "/api/sse";
  }

  connect() {
    if (this.source?.readyState === EventSource.OPEN) return;
    if (this.source) {
      this.source.close();
    }

    this.source = new EventSource(this.url);

    this.source.onopen = () => {
      this.connected = true;
      console.log("[SSE] connected");
    };

    this.source.onmessage = (ev) => {
      if (ev.data.startsWith("heartbeat")) return;
      try {
        const parsed = JSON.parse(ev.data);
        const { type, payload } = parsed;
        if (type && this.listeners[type as keyof EventRegistry]) {
          this.listeners[type as keyof EventRegistry].forEach((cb) => cb(payload));
        }
      } catch {
        // ignore malformed
      }
    };

    this.source.onerror = () => {
      this.connected = false;
      this.source?.close();
      this.source = null;
      // auto reconnect after 3s
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
    this.connected = false;
  }

  on<T = unknown>(type: keyof EventRegistry, cb: (data: T) => void) {
    const wrapped = (data: unknown) => cb(data as T);
    this.listeners[type].push(wrapped);
    return () => {
      const idx = this.listeners[type].indexOf(wrapped);
      if (idx >= 0) this.listeners[type].splice(idx, 1);
    };
  }

  isConnected() {
    return this.connected;
  }
}

const sseClient = new SseClient();

export function connectSse() {
  sseClient.connect();
}

export function disconnectSse() {
  sseClient.disconnect();
}

export function onSseEvent<T = unknown>(
  type: "download_progress" | "download_status" | "site_health",
  cb: (data: T) => void
) {
  return sseClient.on(type, cb);
}
