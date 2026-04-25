# Phase 4：系统健壮性设计规格

> 日期：2026-04-26
> 来源：用户实时讨论确认

---

## 目标

增强系统在不稳定网络环境和站点故障下的自愈能力，减少人工干预，提升用户体验。

---

## 核心功能

### 1. 站点健康监控

- 后台定时任务：每 10 分钟对所有 `enabled=true` 的站点执行 `health.probe`
- 探测方式：`GET <base_url>?ac=list&pg=1`，校验 JSON 含 `list` 键，记录延时
- 探测结果写入内存/日志，不持久化到数据库

### 2. 自动禁用与恢复

**失败计数机制**：
- 每个站点维护 `consecutive_failures` 计数（内存中）
- 探测失败 → `consecutive_failures += 1`
- 探测成功 → `consecutive_failures = 0`

**自动禁用**：
- `consecutive_failures >= 3` 时，自动将站点 `enabled` 设为 `false`
- 同时记录 `auto_disabled_at` 时间戳

**自动恢复**：
- 对 `enabled=false` 且 `auto_disabled_at` 不为空的站点，继续探测
- 连续 2 次探测成功 → 自动将 `enabled` 恢复为 `true`，清空 `auto_disabled_at`

**前端表现**：
- 站点列表页显示「自动禁用」标签及禁用时间
- 用户可手动重新启用

### 3. 请求重试与指数退避

- `SourceClient` 中对每个资源站请求增加重试逻辑
- 最大重试 3 次
- 退避策略：1s → 2s → 4s（指数退避）
- 只对 `httpx` 网络异常重试，HTTP 4xx/5xx 不重试（视为协议级错误）
- 重试失败进入 `failed_sources`，不抛异常中断其他源

### 4. 日志系统

- 使用 Python 标准 `logging` + `RotatingFileHandler`
- 日志路径：`backend/logs/app.log`
- 单个文件最大 10MB，保留 5 个备份
- 日志级别：`INFO`
- 记录内容：
  - 每次资源站请求（URL、耗时、结果）
  - 探测结果（站点名、延时、成功/失败）
  - 自动禁用/恢复事件
  - 下载任务状态变更

### 5. 前端失败源详情面板

- 首页/搜索/详情页顶部 `failed_sources` 角标点击后展开详情面板
- 面板内容：失败站点名称、错误原因、失败时间
- 提供「立即重试」按钮：对失败站点单独触发一次探测
- 提供「忽略」按钮：本次会话中隐藏该失败提示

---

## 架构

```
backend/app/services/health.py
├── probe(site, timeout=5) → ProbeResult
└── 新增：retry_with_backoff(request_fn, max_retries=3)

backend/app/services/scheduler.py（新增）
├── 启动定时任务：asyncio.create_task(probe_loop())
├── probe_loop(): 每 600s 遍历 enabled 站点探测
└── auto_disable/enable 逻辑

backend/app/main.py
├── 启动时 init_scheduler()
└── 关闭时 cancel scheduler task

backend/app/logging_config.py（新增）
└── setup_logging() → RotatingFileHandler

frontend/src/components/FailedSourcesPanel.tsx（新增）
├── 展开/收起动画
├── 失败源列表
└── 重试/忽略操作
```

---

## 边界与异常

- 站点全部失败时，首页仍返回 200（空 items + all failed_sources），不 502
- 手动禁用的站点（`enabled=false` 但 `auto_disabled_at` 为空）不参与自动恢复探测
- 定时任务异常不中断主服务，记录 error 日志后继续
- 日志目录不可写时，降级为 console 输出

---

## 验证清单

1. 断开一个站点网络，连续 3 次探测后该站点自动禁用
2. 恢复网络，连续 2 次成功探测后自动启用
3. 请求超时触发指数退避重试，最终失败进入 failed_sources
4. 日志文件按规则轮转，内容包含请求耗时
5. 前端点击 failed_sources 角标，展开详情面板，点击「重试」可刷新状态
6. 手动禁用的站点不会被自动恢复
