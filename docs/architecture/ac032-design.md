> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。
>
# AC-032: PostgreSQL LISTEN/NOTIFY 事件推送架构设计

## 1. 设计目标

将当前基于内存 `asyncio.Queue` 的 SSE 事件推送机制，迁移至 PostgreSQL LISTEN/NOTIFY，以支持多实例部署下的跨进程/跨节点事件广播，同时保持 SSE 接口对外完全兼容（前端无感知）。

---

## 2. 组件交互图

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   downloader    │     │   health.py     │     │   SSE Endpoint  │
│   (NOTIFY 发送)  │     │   (NOTIFY 发送)  │     │  (LISTEN 接收)  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  NOTIFY 'download_events'                     │
         │  '{"type":"download_progress",...}'           │
         │ ─────────────────────────────────────────────>│
         │                       │                       │
         │                       │  NOTIFY 'health_events'│
         │                       │  '{"type":"site_health",...}'
         │                       │ ─────────────────────>│
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        PostgreSQL Server                         │
│  ┌─────────────────────┐    ┌─────────────────────┐             │
│  │  Channel: download_events                                    │
│  │  Payload: JSON string │    │  Channel: health_events         │
│  │                       │    │  Payload: JSON string           │
│  └─────────────────────┘    └─────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
         ▲                       ▲                       ▲
         │                       │                       │
         │ LISTEN                │ LISTEN                │ LISTEN
         │                       │                       │
┌────────┴────────┐     ┌────────┴────────┐     ┌────────┴────────┐
│   Instance A    │     │   Instance B    │     │   Instance C    │
│  ┌───────────┐  │     │  ┌───────────┐  │     │  ┌───────────┐  │
│  │ Dedicated │  │     │  │ Dedicated │  │     │  │ Dedicated │  │
│  │  LISTEN   │  │     │  │  LISTEN   │  │     │  │  LISTEN   │  │
│  │ Connection│  │     │  │ Connection│  │     │  │ Connection│  │
│  └─────┬─────┘  │     │  └─────┬─────┘  │     │  └─────┬─────┘  │
│        │        │     │        │        │     │        │        │
│        ▼        │     │        ▼        │     │        ▼        │
│  ┌───────────┐  │     │  ┌───────────┐  │     │  ┌───────────┐  │
│  │  SSE Hub  │  │     │  │  SSE Hub  │  │     │  │  SSE Hub  │  │
│  │ (per inst)│  │     │  │ (per inst)│  │     │  │ (per inst)│  │
│  └─────┬─────┘  │     │  └─────┬─────┘  │     │  └─────┬─────┘  │
│        │        │     │        │        │     │        │        │
│  ┌─────┴─────┐  │     │  ┌─────┴─────┐  │     │  ┌─────┴─────┐  │
│  │  Browser  │  │     │  │  Browser  │  │     │  │  Browser  │  │
│  │  Clients  │  │     │  │  Clients  │  │     │  │  Clients  │  │
│  └───────────┘  │     │  └───────────┘  │     │  └───────────┘  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 交互说明

1. **发送端**（downloader / health）：业务状态变化时，通过独立连接执行 `NOTIFY channel, 'payload'`
2. **PostgreSQL**：将通知广播给所有在该通道上执行了 `LISTEN` 的会话
3. **接收端**（SSE Endpoint）：每个实例维护一条独立的 LISTEN 连接，异步接收 NOTIFY 消息后转发给本实例内的 SSE 客户端
4. **关键特性**：同一事件可被多个实例同时接收，实现天然的多播

---

## 3. 通道设计

### 3.1 通道清单

| 通道名 | 发送者 | 接收者 | 说明 |
|--------|--------|--------|------|
| `download_events` | `downloader.py` | SSE Endpoint | 下载进度、状态变更事件 |
| `health_events` | `health.py` | SSE Endpoint | 站点健康状态变更事件 |

### 3.2 消息格式（JSON）

所有通道统一使用 JSON 字符串作为 payload，保持与现有 SSE 事件格式一致。

**download_events 消息格式：**

```json
{
  "type": "download_progress",
  "data": {
    "task_id": "uuid-string",
    "downloaded_bytes": 10485760,
    "total_bytes": 1073741824,
    "speed_bps": 5242880,
    "progress_percent": 0.98
  },
  "timestamp": "2026-06-09T10:30:00.000Z"
}
```

```json
{
  "type": "download_status",
  "data": {
    "task_id": "uuid-string",
    "status": "completed",
    "error_message": null
  },
  "timestamp": "2026-06-09T10:30:00.000Z"
}
```

**health_events 消息格式：**

```json
{
  "type": "site_health",
  "data": {
    "site_id": 1,
    "site_name": "ffzy",
    "status": "healthy",
    "response_time_ms": 234,
    "last_check": "2026-06-09T10:30:00.000Z"
  },
  "timestamp": "2026-06-09T10:30:00.000Z"
}
```

### 3.3 格式约束

- `type` 字段：与现有 SSE event type 保持一致（`download_progress`, `download_status`, `site_health`）
- `data` 字段：与现有 SSE data payload 结构完全一致
- `timestamp`：ISO 8601 格式，用于排障时序追踪
- Payload 总大小：PostgreSQL 限制为 8000 字节，事件消息应远小于此限制

---

## 4. 连接生命周期

### 4.1 连接模型

```
┌─────────────────────────────────────────────────────────────┐
│                      FastAPI Application                     │
│                                                              │
│  ┌─────────────────┐      ┌─────────────────────────────┐  │
│  │  SQLAlchemy ORM  │      │   LISTEN Connection Manager │  │
│  │   (业务读写)      │      │                             │  │
│  │   async session  │      │  ┌─────────────────────┐    │  │
│  │   connection pool│      │  │  Dedicated asyncpg  │    │  │
│  │                  │      │  │  connection (raw)   │    │  │
│  └─────────────────┘      │  │                     │    │  │
│                           │  │  ┌───────────────┐  │    │  │
│                           │  │  │ LISTEN loop   │  │    │  │
│                           │  │  │ (async for)   │  │    │  │
│                           │  │  └───────────────┘  │    │  │
│                           │  │                     │    │  │
│                           │  │  ┌───────────────┐  │    │  │
│                           │  │  │ Reconnect     │  │    │  │
│                           │  │  │ logic         │  │    │  │
│                           │  │  └───────────────┘  │    │  │
│                           │  └─────────────────────┘    │  │
│                           └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**核心原则**：LISTEN 连接与 ORM 连接完全隔离。
- ORM 连接池：使用 `asyncpg` 或 `aiosqlite` 驱动，连接生命周期由 SQLAlchemy 管理，事务结束后自动归还池中
- LISTEN 连接：使用底层 `asyncpg.connect()` 创建独立连接，长期持有，不归入 ORM 连接池

### 4.2 生命周期状态机

```
                    ┌─────────────┐
                    │   初始化     │
                    │  (startup)  │
                    └──────┬──────┘
                           │ 创建独立连接
                           │ 执行 LISTEN channel
                           ▼
                    ┌─────────────┐
         ┌─────────│   监听中     │◄────────────────┐
         │         │  (listening)│                 │
         │         └──────┬──────┘                 │
         │                │ 收到 NOTIFY            │
         │                │ 解析 JSON              │
         │                │ 写入 SSE Hub           │
         │                │                        │
         │                │ 连接断开/异常          │
         │                ▼                        │
         │         ┌─────────────┐                │
         │         │   断开中     │                │
         │         │ (disconnected)│              │
         │         └──────┬──────┘                │
         │                │ 等待 reconnect_delay   │
         │                │ (指数退避 1s ~ 30s)    │
         │                ▼                        │
         │         ┌─────────────┐                │
         └────────►│   重连中     │────────────────┘
                   │ (reconnecting)│  成功
                   └─────────────┘
                           │
                           │ 应用关闭 (shutdown)
                           ▼
                    ┌─────────────┐
                    │   已关闭     │
                    │  (closed)   │
                    └─────────────┘
```

### 4.3 连接参数

```python
LISTEN_CONNECTION_CONFIG = {
    # 与主数据库相同的连接参数，但独立管理
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "user": os.getenv("DB_USER", "home_theater"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "home_theater"),
    
    # LISTEN 专用配置
    "command_timeout": 60,          # 单条命令超时
    "server_settings": {
        "application_name": "home-theater-listener"
    }
}

RECONNECT_CONFIG = {
    "initial_delay": 1.0,           # 首次重连等待（秒）
    "max_delay": 30.0,              # 最大重连等待（秒）
    "backoff_multiplier": 2.0,      # 退避倍数
    "max_retries": None,            # 无限重试（None）
}
```

### 4.4 核心代码结构（伪代码）

```python
# app/services/listen_manager.py

import asyncio
import json
import asyncpg
from typing import Callable, Set

class ListenConnectionManager:
    """管理独立的 PostgreSQL LISTEN 连接。"""
    
    def __init__(self, dsn: str, channels: Set[str]):
        self.dsn = dsn
        self.channels = channels
        self.connection: asyncpg.Connection | None = None
        self._listen_task: asyncio.Task | None = None
        self._handlers: list[Callable[[str, dict], None]] = []
        self._shutdown_event = asyncio.Event()
        self._reconnect_delay = 1.0
    
    def add_handler(self, handler: Callable[[str, dict], None]):
        """注册消息处理器。"""
        self._handlers.append(handler)
    
    async def start(self):
        """启动监听循环（带自动重连）。"""
        self._listen_task = asyncio.create_task(self._listen_loop())
    
    async def _listen_loop(self):
        """主监听循环：连接 -> LISTEN -> 接收 -> 断开 -> 重连。"""
        while not self._shutdown_event.is_set():
            try:
                await self._connect_and_listen()
                self._reconnect_delay = 1.0  # 连接成功，重置退避
            except Exception as e:
                logger.error(f"LISTEN connection error: {e}")
            
            if self._shutdown_event.is_set():
                break
            
            # 等待重连
            logger.info(f"Reconnecting in {self._reconnect_delay}s...")
            try:
                await asyncio.wait_for(
                    self._shutdown_event.wait(),
                    timeout=self._reconnect_delay
                )
            except asyncio.TimeoutError:
                pass
            
            # 指数退避
            self._reconnect_delay = min(
                self._reconnect_delay * 2.0,
                30.0
            )
    
    async def _connect_and_listen(self):
        """建立连接并进入监听状态。"""
        self.connection = await asyncpg.connect(self.dsn)
        
        # 注册所有通道
        for channel in self.channels:
            await self.connection.execute(f"LISTEN {channel}")
            logger.info(f"LISTEN on channel: {channel}")
        
        # 使用 asyncpg 的通知接口异步接收
        async for notification in self.connection.notifies():
            if self._shutdown_event.is_set():
                break
            
            # notification: (channel, payload, pid)
            channel, payload, _ = notification
            try:
                data = json.loads(payload)
                for handler in self._handlers:
                    handler(channel, data)
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON in NOTIFY payload: {e}")
    
    async def stop(self):
        """优雅关闭。"""
        self._shutdown_event.set()
        if self.connection:
            await self.connection.close()
        if self._listen_task:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
```

---

## 5. 代码变更清单

### 5.1 新增文件

| 文件路径 | 说明 |
|----------|------|
| `app/services/listen_manager.py` | LISTEN 连接管理器（独立连接、自动重连、多通道监听） |
| `app/services/notify_sender.py` | NOTIFY 发送封装（统一 JSON 序列化、错误处理） |

### 5.2 修改文件

| 文件路径 | 变更内容 |
|----------|----------|
| `app/services/downloader.py` | 1. 移除 `event_bus.put()` 调用<br>2. 在状态变更点插入 `notify_sender.send("download_events", {...})` |
| `app/services/health.py` | 1. 移除 `event_bus.put()` 调用<br>2. 在健康状态变更点插入 `notify_sender.send("health_events", {...})` |
| `app/api/downloads.py` | 1. SSE endpoint 改为从 listen_manager 接收事件<br>2. 移除对 `event_bus` 的引用 |
| `app/main.py` | 1. startup 事件：初始化并启动 listen_manager<br>2. shutdown 事件：优雅关闭 listen_manager |
| `app/core/config.py` | 新增 PostgreSQL 连接配置项（如当前未使用 PostgreSQL） |
| `requirements.txt` | 新增 `asyncpg>=0.29.0`（如尚未依赖） |

### 5.3 删除文件

| 文件路径 | 说明 |
|----------|------|
| `app/services/event_bus.py` | 内存事件总线，完全被 LISTEN/NOTIFY 替代 |

### 5.4 变更细节

#### 5.4.1 downloader.py 变更点

```python
# 变更前
from app.services.event_bus import event_bus

async def _update_progress(self, task_id: str, downloaded: int, total: int):
    # ... 更新数据库 ...
    await event_bus.put({
        "type": "download_progress",
        "data": {...}
    })

# 变更后
from app.services.notify_sender import notify_sender

async def _update_progress(self, task_id: str, downloaded: int, total: int):
    # ... 更新数据库 ...
    await notify_sender.send("download_events", {
        "type": "download_progress",
        "data": {...},
        "timestamp": datetime.utcnow().isoformat()
    })
```

#### 5.4.2 SSE Endpoint 变更

```python
# 变更前
from app.services.event_bus import event_bus

@router.get("/events")
async def download_events(request: Request):
    async def event_generator():
        while True:
            event = await event_bus.get()
            yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")

# 变更后
from app.services.listen_manager import listen_manager

@router.get("/events")
async def download_events(request: Request):
    queue: asyncio.Queue[dict] = asyncio.Queue()
    
    def on_event(channel: str, data: dict):
        queue.put_nowait(data)
    
    listen_manager.add_handler(on_event)
    
    async def event_generator():
        try:
            while True:
                event = await queue.get()
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
        finally:
            listen_manager.remove_handler(on_event)
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

---

## 6. 与现有 event_bus 的替换策略

### 6.1 替换阶段

采用**直接替换**策略，不保留双轨运行期。原因：
- LISTEN/NOTIFY 与 event_bus 功能完全等价
- 变更范围有限（仅 3 个发送点 + 1 个接收端）
- 测试验证成本低

### 6.2 替换步骤

```
Step 1: 新增 listen_manager.py + notify_sender.py
        └── 独立开发，不影响现有代码

Step 2: 修改 downloader.py / health.py
        └── 将 event_bus.put() 替换为 notify_sender.send()
        └── 删除 event_bus 导入

Step 3: 修改 SSE endpoint
        └── 从 listen_manager 接收事件
        └── 删除 event_bus 导入

Step 4: 修改 main.py startup/shutdown
        └── 启动/关闭 listen_manager

Step 5: 删除 event_bus.py

Step 6: 测试验证
        └── 单实例：下载进度、状态变更、健康检查事件正常推送
        └── 多实例：事件跨实例广播
```

### 6.3 回滚方案

若上线后出现问题，回滚仅需：
1. 恢复 `event_bus.py`
2. 恢复 downloader.py / health.py / downloads.py 的 event_bus 引用
3. 移除 listen_manager 的启动逻辑

---

## 7. 多实例部署注意事项

### 7.1 事件广播行为

PostgreSQL LISTEN/NOTIFY 的语义是**广播到所有 LISTEN 会话**，天然满足多实例需求：

```
Instance A 执行 NOTIFY 'download_events', '...'
              │
              ▼
        PostgreSQL Server
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
 Instance A  Instance B  Instance C
 (也收到)    (收到)      (收到)
```

**注意**：发送者自身也会收到自己发出的通知（如果该实例也在 LISTEN）。SSE Hub 应做好去重或幂等处理，但当前场景下重复推送同一事件给前端不会造成问题（前端按事件 ID/时间戳去重或覆盖）。

### 7.2 数据库连接数估算

| 组件 | 每实例连接数 | 说明 |
|------|-------------|------|
| SQLAlchemy ORM 连接池 | 5 (默认) | 业务查询 |
| LISTEN 专用连接 | 1 | 长期持有 |
| NOTIFY 发送连接 | 复用 ORM 连接 | NOTIFY 可在任意连接上执行 |

**N 实例总连接数**：`N * (5 + 1) = 6N`

示例：4 实例部署 = 24 个连接，远低于 PostgreSQL 默认 `max_connections=100`。

### 7.3 实例发现

不需要服务发现机制。各实例独立连接到同一 PostgreSQL，通过 LISTEN/NOTIFY 自动形成事件网络。

---

## 8. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| LISTEN 连接断开导致事件丢失 | 中 | 高 | 1. 自动重连（指数退避）<br>2. 前端 SSE 自带 3 秒重连，重连后自动恢复<br>3. 关键状态（下载完成）由数据库持久化，前端可主动轮询补全 |
| NOTIFY payload 超过 8000 字节 | 低 | 中 | 1. 当前事件消息远小于限制（约 200-500 字节）<br>2. 在 notify_sender 中添加 payload 大小检查，超限则截断或记录错误 |
| PostgreSQL 未启用/不可用 | 低 | 高 | 1. 当前项目使用 SQLite，需先迁移到 PostgreSQL<br>2. 如暂不迁移，可保留 event_bus 作为 fallback（增加复杂度，不推荐） |
| 多实例下同一事件重复推送给前端 | 中 | 低 | 1. 前端 SSE 客户端已按 event type + task_id 做状态覆盖<br>2. 无需额外去重逻辑 |
| LISTEN 连接长期持有导致资源泄漏 | 低 | 中 | 1. 连接配置 `command_timeout`<br>2. shutdown 时显式 close 连接<br>3. 连接异常时自动重建 |
| 数据库驱动从 aiosqlite 切换成本 | 中 | 中 | 1. 当前项目使用 SQLite，需评估是否引入 PostgreSQL<br>2. 若保持 SQLite，本方案需改为其他跨进程机制（如 Redis Pub/Sub） |

### 8.1 特别说明：SQLite 兼容性

当前项目使用 SQLite 作为数据库。SQLite **不支持** LISTEN/NOTIFY。实施本方案前需确认：

1. **方案 A（推荐）**：将数据库迁移至 PostgreSQL。SQLite 的 WAL 模式虽支持一定并发，但多实例写入仍受限；PostgreSQL 是生产多实例部署的合理选择。

2. **方案 B（替代）**：若保持 SQLite，需改用其他跨进程事件机制，如：
   - Redis Pub/Sub（需引入 Redis）
   - 文件系统信号（如 inotify，平台依赖）
   - HTTP 回调（实例间互相推送，需服务发现）

**建议**：如项目计划支持多实例部署，优先迁移至 PostgreSQL；LISTEN/NOTIFY 是此迁移的附加收益，而非独立引入成本。

---

## 9. 附录：与现有方案的对比

| 维度 | 内存 event_bus（现有） | PostgreSQL LISTEN/NOTIFY（目标） |
|------|----------------------|----------------------------------|
| 单实例 | 支持 | 支持 |
| 多实例 | 不支持（事件仅限本进程） | 支持（天然广播） |
| 持久化 | 无（进程重启丢失） | 无（通知不持久化，但连接恢复后继续接收新通知） |
| 延迟 | 微秒级 | 毫秒级（网络往返） |
| 复杂度 | 低 | 中（需管理独立连接） |
| 依赖 | 无 | PostgreSQL |
| 前端兼容性 | — | 完全兼容（SSE 接口不变） |

---

## 10. 决策记录

**ADR-032-1：使用独立连接而非 ORM 连接池**
- 决策：LISTEN 使用独立 `asyncpg.connect()`，不归入 SQLAlchemy 连接池
- 理由：LISTEN 需要长期持有连接，与连接池"用完即还"的语义冲突；ORM 连接可能因事务结束而关闭

**ADR-032-2：不保留 event_bus 作为 fallback**
- 决策：完全替换，不保留双轨
- 理由：变更范围小，测试成本低；保留双轨增加维护负担和潜在行为不一致

**ADR-032-3：发送端直接执行 NOTIFY，不通过 LISTEN 连接转发**
- 决策：downloader/health 直接通过业务连接发送 NOTIFY
- 理由：NOTIFY 可在任意连接上执行，无需与 LISTEN 连接共享；降低耦合
