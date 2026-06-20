> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。

# ATDD: REFACTOR-DB-001 — 数据库引擎迁移（SQLite → PostgreSQL）

## 场景一：启动时连接到 PostgreSQL
**Given** 系统当前使用 SQLite 作为数据库引擎
**When** 启动后端服务
**Then** 成功连接到 PostgreSQL 数据库，日志输出 `Connected to PostgreSQL`

## 场景二：依赖变更验证
**Given** 检查项目依赖文件（requirements.txt / pyproject.toml）
**Then** `aiosqlite` 已移除，`asyncpg` 已添加且版本 >= 0.29.0

## 场景三：db.py 清理 SQLite 特有代码
**Given** 查看 `app/db.py`
**Then** 文件中不存在以下 SQLite 特有代码：
- 无 `PRAGMA journal_mode=WAL`
- 无 `PRAGMA busy_timeout=...`
- 无 `_ensure_columns` 动态列迁移逻辑
- 数据库 URL 构造不硬编码 `sqlite+aiosqlite`

## 场景四：config.py 返回 PostgreSQL URL
**Given** 查看 `app/config.py` 或配置模块
**Then** `db_url` 返回 `postgresql+asyncpg://...` 格式的连接字符串
**And** 支持通过环境变量覆盖（如 `DATABASE_URL`）

## 场景五：PostgreSQL 不可用时返回 503
**Given** PostgreSQL 服务停止或网络不可达
**When** 启动后端或执行数据库操作
**Then** 健康检查端点返回 503 Service Unavailable
**And** 响应体包含明确错误信息：`{"detail": "Database connection unavailable"}`

## 数据模型变更
- 所有 `JSON` 类型字段在 PostgreSQL 中映射为 `JSONB`（详见 AC-033）
- 移除 SQLite 特有的 `AggregatedVideoV1` / `AggregatedVideoV2` 双缓冲表
- 字符串类型统一使用 `VARCHAR` / `TEXT`，无需 SQLite 长度限制调整

## 性能验收指标
- 启动时数据库连接建立时间 < 500ms
- 健康检查端点响应时间 < 100ms

## 错误场景
| 场景 | 输入 | 期望结果 |
|------|------|----------|
| 数据库未启动 | `postgresql+asyncpg://localhost:5432/ht` | 启动失败，日志报错，健康检查 503 |
| 认证失败 | 错误的用户名/密码 | 启动失败，日志输出认证错误 |
| 数据库不存在 | 连接字符串中 dbname 不存在 | 启动失败，提示数据库不存在 |

## 依赖关系
- **blocks**: AC-030, AC-031, AC-032, AC-033, AC-034
- **无前置依赖**
