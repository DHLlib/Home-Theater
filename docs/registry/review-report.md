# Review Report — Home Theater Sprint-001

**审查日期**: 2026-05-27  
**审查范围**: backend (23 .py) + frontend (35 .ts/.tsx) + test (59 cases)  
**审查维度**: 架构 / 质量 / 安全 / 可运行性  
**基线**: alignment-report.md (Reverse 模式)

---

## 修复记录（2026-05-27）

以下 [CRITICAL] 问题已在 Review 阶段内修复并重新验证：

- [x] `sites.py:create_site` — 改为接收 `SiteCreate` Pydantic schema，禁止任意 dict 写入
- [x] `sites.py:update_site` — 改为接收 `SitePatch` Pydantic schema，使用 `model_dump(exclude_unset=True)` + 白名单更新，移除 `hasattr`/`setattr` 动态赋值
- [x] `downloads.py` — 路径 sanitize 后增加 `.` / `..` 检查，防止路径遍历跳出 `download_root`
- [x] `db.py` — `_ensure_columns` 改为内部 `_ALLOWED` 白名单字典，显式限定表名/列名/类型，避免无约束 SQL 拼接

**验证结果**: `59 passed, 0 failed`

---

## 严重问题 [CRITICAL]

- [CRITICAL] `backend/app/api/sites.py:21` — `create_site` 接收 `dict = Body(...)` 而非 Pydantic schema，用户可写入任意字段（包括 `id`、`created_at`），且无任何字段校验 [SECURITY]
- [CRITICAL] `backend/app/api/sites.py:29-39` — `update_site` 使用 `hasattr(db_site, key)` + `setattr` 批量赋值，可绕过业务规则修改任意 ORM 属性（如直接篡改 `id`），且缺少白名单过滤 [SECURITY]
- [CRITICAL] `backend/app/services/downloader.py:127` — `Path(task.file_path).parent.mkdir(...)` 中 `file_path` 来自用户可控输入（`DownloadTaskCreate.file_path` 由后端拼接，但 `title` 未经 sanitize），存在路径遍历写入风险 [SECURITY]
- [CRITICAL] `backend/app/db.py:34-56` — `_ensure_columns` 使用 f-string 拼接 `ALTER TABLE ... ADD COLUMN {col_name} {col_type}`，当前值虽为硬编码常量，但存在 SQL 拼接模式隐患 [SECURITY]

---

## 警告 [WARNING]

- [WARNING] `backend/app/api/videos.py:89-206` 与 `:213-328` — `list_videos` 和 `search_videos` 约 70% 代码重复（分类过滤、聚合去重、分页逻辑完全一致），建议提取公共函数 `_query_and_aggregate` [QUALITY]
- [WARNING] `backend/app/services/downloader.py:230-441` — `_run_m3u8_download` 函数超过 200 行，嵌套 4 层（函数→内部函数→async with→for），圈复杂度高，建议拆分为 `_parse_m3u8` / `_download_ts_segments` / `_merge_output` [QUALITY]
- [WARNING] `backend/app/services/downloader.py:597-612` — `_classify_http_error` / `_classify_network_error` 签名包含 `site_id, base_url, site_name` 但函数体完全未使用，应清理签名或恢复探测逻辑 [QUALITY]
- [WARNING] `backend/app/models.py` / `scheduler.py` / `videos.py` — 多处使用 `datetime.utcnow()`（SQLAlchemy 已报 DeprecationWarning），应统一替换为 `datetime.now(timezone.utc)` [QUALITY]
- [WARNING] `backend/app/services/scheduler.py:23-24` — `_failure_counts` / `_recovery_counts` 为模块级全局字典，若部署多进程（如 gunicorn workers）则状态隔离失效，站点健康计数会分散在各进程中 [ARCH]
- [WARNING] `backend/app/api/downloads.py` — `DownloadTaskCreate` 未校验 `suffix` 白名单（虽测试 `test_create_download_invalid_suffix_defaults_to_mp4` 覆盖了回退逻辑，但后端 schema 无枚举约束） [QUALITY]
- [WARNING] `frontend/src/api/client.ts:22-24` — 所有 HTTP 错误都调用 `toastError`，对于后台静默轮询或批量操作会导致弹窗风暴，建议按调用方需求选择是否 toast [QUALITY]
- [WARNING] `backend/app/main.py:66-75` — 路由硬编码 `include_router`，未按 `entry-point-contract.yaml` 声明的 `register_pattern` 动态扫描 `app.api.{domain}`，新增 domain 时容易遗漏注册 [ARCH]
- [WARNING] `backend/app/api/__init__.py` — 为空文件，未按 Assembly Rules 导出各 domain router，违背 `entry-point-contract.yaml` 的 `router` 导出要求 [ARCH]
- [WARNING] `backend/app/services/crawler.py` — 未在本次审查范围内读取，但 alignment-report 指出其为后台刮削核心模块，建议确认其 upsert 后是否也调用了 `_evict_video_cache_overflow`（AC-014 修复仅覆盖了 `videos.py` 的 detail upsert） [ARCH]

---

## 信息 [INFO]

- [INFO] `backend/app/schemas.py` — `DownloadTaskOut.status` 为自由字符串，`data-schema.yaml` 已建议引入 `StrEnum` 校验，当前未实施 [STYLE]
- [INFO] `docs/registry/data-schema.yaml` — `SiteCreate` / `SitePatch` schema 已定义，但 `sites.py` 实际使用 `dict = Body(...)`，schema 与实现不同步 [STYLE]
- [INFO] `alignment-report.md` — 已标记 "操作审计 / 日志轨迹" 缺失（谁收藏、谁删除下载等无记录），属于已知沉默约定缺口，不影响当前 Sprint 发布 [INFO]
- [INFO] `alignment-report.md` — 已标记 "并发冲突处理" 缺失（`PlayProgress` / `Favorite` 等 upsert 无乐观锁），在高并发下可能产生覆盖竞争，当前单机 asyncio 场景风险较低 [INFO]
- [INFO] `frontend/src/components/FailedSourcesPanel.tsx` — `data-schema.yaml` 与 `alignment-report.md` 均标记为 deprecated，但组件文件仍存在，建议在下个 Sprint 清理 [STYLE]

---

## 按 AC 映射

| AC | 关联问题 |
|----|---------|
| AC-001 | [CRITICAL] sites.py 输入无校验；[WARNING] 路由硬编码 |
| AC-002 | [CRITICAL] sites.py update_site 动态 setattr 风险 |
| AC-003/004 | [WARNING] list_videos / search_videos 大量重复代码 |
| AC-006 | [INFO] parser.py 与 resolver.py 实现清晰，无额外问题 |
| AC-010 | [CRITICAL] 已修复 IntegrityError → 409；无新增问题 |
| AC-011 | [CRITICAL] downloader 路径遍历风险；[WARNING] suffix 无枚举校验 |
| AC-012 | [WARNING] _run_m3u8_download 过长；[WARNING] 未使用参数 |
| AC-013 | [WARNING] scheduler 全局字典多进程失效 |
| AC-014 | [WARNING] crawler.py upsert 可能未触发淘汰（待确认） |
| AC-015 | [INFO] cache.ts 实现完整 |
| AC-016 | [INFO] SSE 事件总线与前端订阅实现完整 |
| AC-017 | [WARNING] main.py 路由未动态扫描 |

---

## 处理建议

1. **[CRITICAL] 安全项**：建议立即修复 `sites.py` 的 `dict = Body(...)` 和 `setattr` 问题，改为使用已定义的 `SiteCreate` / `SitePatch` Pydantic schema。
2. **[CRITICAL] 路径遍历**：在 `downloads.py` 创建任务时对 `title` 做 sanitize（去除路径分隔符），或在拼接 `file_path` 时强制限定在 `download_root` 目录下。
3. **[WARNING] 重复代码**：提取 `videos.py` 的公共查询逻辑，减少 `list_videos` / `search_videos` 维护成本。
4. **[WARNING] 全局状态**：如计划多进程部署，需将 `_failure_counts` / `_recovery_counts` 迁移到数据库或 Redis；当前单机部署可延后。
5. **[INFO] 废弃清理**：下个 Sprint 移除 `FailedSourcesPanel` 和 `failed_sources` 相关类型定义。
