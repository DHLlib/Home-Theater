# System Context — Home Theater v0.1.1

**最后更新**: 2026-11-08  
**环境**: Python 3.13, FastAPI, React 18, Vite 5, PostgreSQL 16, xgplayer v3

---

## 基线 AC（23/23，均已实现）

| AC | 状态 | 后端文件 | 前端文件 |
|----|------|---------|---------|
| AC-001 站点管理 | ✅ | `api/sites.py` | `pages/Settings.tsx` |
| AC-002 分类映射 | ✅ | `api/sites.py`, `api/category_aliases.py` | `components/category-settings/AliasSettings.tsx` |
| AC-003 首页聚合 | ✅ | `api/videos.py`, `services/aggregator.py` | `pages/Home.tsx` |
| AC-004 视频搜索 | ✅ | `api/videos.py` | `pages/Home.tsx` |
| AC-005 视频详情 | ✅ | `api/videos.py`, `services/resolver.py` | `pages/DetailModal.tsx` |
| AC-006 播放地址解析 | ✅ | `services/parser.py`, `services/resolver.py` | — |
| AC-007 显式选源 | ✅ | — | `components/SourcePicker.tsx` |
| AC-008 xgplayer 播放 | ✅ | — | `components/VideoPlayer.tsx`, `pages/Player.tsx` |
| AC-009 播放进度 | ✅ | `api/progress.py` | `pages/Player.tsx` |
| AC-010 收藏管理 | ✅ | `api/favorites.py` | `pages/Favorites.tsx` |
| AC-011 下载任务管理 | ✅ | `api/downloads.py` | `pages/Downloads.tsx` |
| AC-012 断点续传下载 | ✅ | `services/downloader.py` | — |
| AC-013 站点健康监控 | ✅ | `services/scheduler.py`, `services/health.py` | — |
| AC-014 VideoCache | ✅ | `api/videos.py`, `models.py` | — |
| AC-015 前端 IndexedDB 缓存 | ✅ | — | `utils/cache.ts` |
| AC-016 SSE 推送 | ✅ | `api/sse.py`, `services/event_bus.py` | `api/sse.ts` |
| AC-017 局域网部署 | ✅ | `main.py`, `config.py` | — |
| AC-018 刮削日志 | ✅ | `services/crawler.py` | `pages/Settings.tsx` |
| AC-019 刮削看板 | ✅ | `api/videos.py` | `pages/Settings.tsx` |
| AC-020 手动触发刮削 | ✅ | `api/videos.py` | `pages/Settings.tsx` |
| AC-021 移动端响应式 | ✅ | — | `mobile/`, `styles/global.css` |
| AC-022 播放器手势控制 | ✅ | — | `components/VideoPlayer.tsx` |
| AC-023 网络传输优化 | ✅ | `main.py`, `api/videos.py` | `utils/cache.ts` |

## 2026-11 新增能力

| 能力 | 关键实现 | 说明 |
|---|---|---|
| 全局分类别名 | `services/category_alias.py`, `api/category_aliases.py` | 远程类名 → 系统分类，跨站共享；98 个别名覆盖 21 站 805 条旧映射 |
| 视频级分类 | `aggregated_videos.system_category` | 聚合时多数票；NULL = 「未分类」伪分类 |
| 体育 / 短剧 系统分类 | `main._ensure_late_categories` | 启动幂等补齐，共 48 个分类 |
| 站点例外 | `site_category_overrides` + `/overrides` API | 同名类名在某站点含义不同时覆盖 |
| 禁用站点隐藏内容 | `videos._hidden_video_filter` | 禁用站点从列表/搜索/分类计数中隐藏 |
| 浅色主题 | `styles/theme.css`, `lib/theme.ts` | 深色 `cinema` / 浅色 `light`，偏好持久化 |
| 启动自愈 | `main.CacheControlStaticFiles` + `lazyWithRetry` | 旧 HTML 引用失效 chunk 时自动重载，不再白屏 |
| 播放兜底 | `VideoPlayer` 12s 缓冲提示 / 30s 判定 + `play.py` 线路探测 | 无首帧先提示「线路较慢」，30 秒才报失败；不可达线路置灰并缓存 3 分钟 |
| 分类映射工作台 | `services/category_map.py`, `api/category_map.py` | 按站点聚类（≥0.75）+ 建议 + 批量 upsert + 撤销；分类页实测 258ms |
| 清除失效资源 | `videos.cleanup_expired` + `cleanup_candidates` 表 | 全站游标分页后台任务，连续两轮缺失才删；四档限速；可停止续跑 |
| 播放加速 | `services/stream_accel.py`, `api/play.py` | m3u8 分片经后端并发预取 + LRU 缓存，绕过 CDN 单连接限速；默认关闭 |
| 聚合并发保护 | `aggregator.py` advisory lock + upsert | 跨进程串行重建；增量写入 upsert，避免唯一键冲突整批失败 |
| 性能与可观测 | `services/tls.py`、共享客户端池、`event_loop_lag`、`slow_request` | 见 §15 性能检查清单 |

---

## API 端点清单

### Sites (`/api/sites`)
- `GET    /api/sites` → list_sites
- `POST   /api/sites` → create_site（新增站点自动匹配分类并播种别名）
- `PATCH  /api/sites/{site_id}` → update_site（启用/禁用会失效隐藏缓存）
- `DELETE /api/sites/{site_id}` → delete_site
- `POST   /api/sites/{site_id}/probe` → probe_site
- `POST   /api/sites/probe-batch` → probe_sites（批量）
- `GET    /api/sites/{site_id}/categories` → get_site_categories
- `PUT    /api/sites/{site_id}/categories` → update_site_categories
- `POST   /api/sites/{site_id}/fetch-categories` → fetch_remote_categories
- `POST   /api/sites/{site_id}/smart-match` → smart_match
- `GET    /api/sites/export` / `POST /api/sites/import` → 站点配置导入导出
- `GET    /api/sites/templates` / `POST /api/sites/{site_id}/apply-template` → 分类模板
- `GET    /api/sites/category-map/summary` → 各站类名覆盖概况（默认选问题最多的站点）
- `GET    /api/sites/{site_id}/category-map` → 映射工作台数据（聚类/建议/样例）
- `POST   /api/sites/{site_id}/category-map` → 批量写入别名/站点例外（支持 fill_rest）
- `POST   /api/sites/{site_id}/category-map/undo` → 撤销最近一次写入

### Videos (`/api/videos`)
- `GET    /api/videos` → list_videos（聚合表，`category=`/`sort=`/`mode=`）
- `GET    /api/videos/search` → search_videos（短词前缀索引 + 回退）
- `GET    /api/videos/recommended` → recommended_videos（60s 缓存）
- `GET    /api/videos/categories/stats` → category_stats（仅非空分类，60s 缓存）
- `POST   /api/videos/detail` → video_detail（缓存优先，过期 stale-while-revalidate）
- `GET    /api/videos/crawler/status` → crawler_status
- `POST   /api/videos/crawler/full` → trigger_full
- `POST   /api/videos/crawler/incremental/{site_id}` → trigger_incremental
- `GET    /api/videos/crawler/stats` → crawler_stats
- `GET    /api/videos/crawler/logs` → crawler_logs
- `DELETE /api/videos/cache` → clear_video_cache
- `POST   /api/videos/cleanup-expired` → 启动全站失效清理后台任务（`speed=eco|normal|fast`，`dry_run`）
- `GET    /api/videos/cleanup-expired/status` → 清理进度（站点数/已检查/已删除/待确认/ETA）
- `POST   /api/videos/cleanup-expired/cancel` → 停止清理并保留游标

### Category Aliases (`/api/category-aliases`)
- `GET    /api/category-aliases` → 别名列表（含来源条数/站点数）
- `POST   /api/category-aliases` → 新增/修改别名（即时重算受影响视频）
- `DELETE /api/category-aliases/{name_key}` → 删除别名
- `GET    /api/category-aliases/unmapped` → 未归类远程类名
- `POST   /api/category-aliases/adopt` → 一键采纳
- `GET    /api/category-aliases/overrides` → 站点例外列表
- `POST   /api/category-aliases/overrides` → 新增站点例外
- `DELETE /api/category-aliases/overrides` → 删除站点例外

### System Categories (`/api/system-categories`)
- `GET    /api/system-categories` → 分类树
- `POST   /api/system-categories` / `PATCH` / `DELETE` → 维护（受保护分类不可删）

### Play (`/api/play`)
- `GET    /api/play/sources` → 播放源列表
- `GET    /api/play/episodes` → 集列表（含 `reachable` 探测结果，缓存 3 分钟）
- `GET    /api/play/proxy-m3u8` → m3u8 去广告代理
- `GET    /api/play/accel/m3u8` → 播放加速：改写 playlist 分片地址（需开启加速）
- `GET    /api/play/accel/segment` → 播放加速：分片代理（并发预取 + LRU 缓存 + Range 透传）

### Downloads (`/api/downloads`)
- `GET/POST /api/downloads`，`POST /{task_id}/pause|resume`，`DELETE /{task_id}`

### Progress (`/api/progress`)
- `POST /api/progress`，`GET /api/progress/recent`，`GET /api/progress`

### Favorites (`/api/favorites`)
- `GET/POST /api/favorites`，`DELETE /api/favorites/{fav_id}`，`GET /api/favorites/status`

### Settings (`/api/settings`)
- `GET/PUT /api/settings/download-root`
- `GET/PUT /api/settings/ad-filter-enabled` → m3u8 去广告开关
- `GET/PUT /api/settings/stream-accel` → 播放加速开关与档位（1/2/3/4 → 2/4/8/16 并发）
- `GET/PUT /api/settings/max-concurrent-downloads`

### SSE / Health
- `GET /api/sse`，`GET /api/health`

---

## 前端路由清单

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | Home | 聚合列表 + 分类栏 + 推荐 + 详情弹窗 |
| `/search` | Search | 搜索结果 |
| `/dashboard` | Dashboard | 统计看板 |
| `/favorites` | Favorites | 收藏 |
| `/progress` | Progress | 最近播放 |
| `/downloads` | Downloads | 下载任务，SSE 实时进度 |
| `/settings` | Settings | 站点、分类别名、下载目录、缓存（`?tab=categories`） |
| `/player` | Player | xgplayer 播放、进度恢复、换源 |

移动端在 `frontend/src/mobile/` 下另有一套页面与路由，共用 `hooks/`、`api/`。

---

## 数据库模型

| 模型 | 表名 | 核心约束 |
|------|------|---------|
| Site | `sites` | `name` UNIQUE，`enabled+sort` 索引 |
| VideoCache | `video_cache` | `(site_id, original_id)` UNIQUE，`norm_title+year` 索引，`title` trgm GIN |
| AggregatedVideoV3 | `aggregated_videos` | `(norm_title, COALESCE(year,-1))` UNIQUE（`uix_aggregated_videos_norm_year`），`system_category`，`latest_updated_at` 索引 |
| AggregatedSource | `aggregated_sources` | `(aggregated_video_id, site_id)` UNIQUE，`type_name` 索引 |
| RecommendedVideo | `recommended_videos` | 首页推荐，定期重建 |
| SystemCategory | `system_categories` | 名称 UNIQUE，父子层级 |
| CategoryAlias | `category_aliases` | `name_key` PK，`raw_names` 数组 |
| SiteCategoryOverride | `site_category_overrides` | `(site_id, name_key)` UNIQUE |
| SiteCategoryMapping | `site_category_mappings` | 旧映射，仅实时回退路径使用 |
| Favorite | `favorites` | `(title, year)` UNIQUE |
| PlayProgress | `play_progress` | `(title, year)` UNIQUE（NULLS NOT DISTINCT），`updated_at` 索引 |
| DownloadTask | `download_tasks` | `status`/`created_at` 索引 |
| SiteProbeLog | `site_probe_logs` | 探测记录 |
| CleanupCandidate | `cleanup_candidates` | `(site_id, original_id)` PK；记录连续缺失轮次，两轮确认后才删除 |
| AppConfig | `app_config` | `key` PK；含 `cleanup_cursor:<site_id>`、`stream_accel_enabled`、`stream_accel_level`、`ad_filter_enabled` |

---

## 关键业务规则（当前实现）

1. **显式选源**：播放/下载前必须选来源，无默认选中。
2. **聚合去重**：`normalize_title(title) + year`；排序用资源站 `source_updated_at`。
3. **分类决策**：站点例外 > 别名 > 多数票 > 排序小者；别名变更先失效缓存再重算。
4. **未分类**：`system_category IS NULL`，前端用「未分类」伪分类筛选。
5. **禁用站点**：从列表/搜索/分类计数中隐藏（id 列表缓存 60s，>1 万回退子查询）。
6. **缓存优先**：列表/搜索走聚合表；详情有缓存即返回，过期则后台刷新。
7. **播放探测**：交互请求超时 4s、不重试；每来源 6s 硬超时；探测结果缓存 3 分钟。
8. **健康监控**：每 10 分钟探测，连续 3 次失败禁用、连续 2 次成功恢复。
9. **进度上报**：每 15 秒，`beforeunload` 用 `sendBeacon` 兜底。

---

## 已知限制

- `_failure_counts` / `_recovery_counts` 为内存字典，多进程部署不共享。
- `failed_sources` 字段保留用于兼容旧前端。
- SSE 为单例 EventSource，每客户端 1 秒心跳；规模再大需换 WebSocket。
- 全量重建聚合表时的 Python 回填仍可能造成秒级 lag（待压测验证）。
- 2 字标题中间命中搜索需子串扫描（~300ms），前缀命中为 20ms 级。
