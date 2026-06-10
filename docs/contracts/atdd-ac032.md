# ATDD: AC-032 — LISTEN/NOTIFY 事件推送

## 场景一：下载状态变更发送 NOTIFY
**Given** 一个下载任务状态发生变化（如从"downloading"变为"completed"）
**When** 后端更新数据库中该任务的状态
**Then** 执行 `NOTIFY download_events, '{"task_id": 123, "status": "completed", "timestamp": "..."}'`
**And** 消息负载为 JSON 格式，包含 task_id、status、progress、timestamp 字段

## 场景二：前端 SSE 实时接收
**Given** 前端已建立 SSE 连接到 `/api/downloads/events`
**When** 后端收到 PostgreSQL NOTIFY 消息
**Then** 消息通过 SSE 实时推送给前端
**And** 前端事件流中收到 `event: download_update\ndata: {...}` 格式数据
**And** 延迟 < 100ms（数据库通知到前端接收）

## 场景三：SSE 连接断开自动重连
**Given** 前端 SSE 连接因网络原因断开
**When** 网络恢复后
**Then** 前端自动重新建立 SSE 连接
**And** 连接成功后立即收到当前所有进行中的任务状态（或保持静默等待新事件）

## 场景四：无事件时保持连接
**Given** 前端 SSE 连接已建立
**When** 长时间（> 5 分钟）无下载事件
**Then** 连接保持存活（通过 SSE 心跳或 TCP keepalive）
**And** 不自动断开

## 场景五：多客户端同时监听
**Given** 3 个浏览器标签页同时打开，各建立 SSE 连接
**When** 一个下载任务状态变化
**Then** 3 个客户端均收到相同的 NOTIFY 推送
**And** 各客户端独立维护连接，互不影响

## 场景六：移除内存 event_bus
**Given** 查看代码
**When** 检查事件推送实现
**Then** 不存在内存中的 `event_bus` 或 `asyncio.Queue` 事件总线
**And** 所有事件流通过 PostgreSQL LISTEN/NOTIFY 通道传递
**And** 后端启动时执行 `LISTEN download_events`

## 数据模型变更
- 无表结构变更
- 新增数据库通道：`download_events`
- 移除代码中的内存 event_bus 实例

## 性能验收指标
| 指标 | 目标值 |
|------|--------|
| NOTIFY 到 SSE 推送延迟 | < 100ms |
| 单通道并发监听客户端数 | >= 10 |
| SSE 连接存活时间（无事件） | > 30 分钟 |
| 重连时间 | < 3s |

## 错误场景
| 场景 | 输入 | 期望结果 |
|------|------|----------|
| PostgreSQL 断开 | 数据库连接丢失 | SSE 连接保持，重连数据库后恢复监听 |
| 消息格式错误 | NOTIFY 负载非 JSON | 丢弃消息，记录错误日志，不影响后续消息 |
| 客户端网络抖动 | 短暂断网（< 10s） | 前端自动重连，不丢失事件 |
| 大量并发事件 | 100 个任务同时完成 | 消息按序推送，不丢消息 |

## 依赖关系
- **blockedBy**: REFACTOR-DB-001
- **replaces**: AC-016（事件推送功能，从内存 event_bus 改为 LISTEN/NOTIFY）
