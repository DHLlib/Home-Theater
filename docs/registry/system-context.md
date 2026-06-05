# System Context — Home Theater v0.1.0

**最后更新**: 2026-06-05（Sprint-006 完成）  
**环境**: Python 3.13, FastAPI, React 18, Vite, SQLite, xgplayer v3

---

## 已实现的 AC（23/23）

| AC | 状态 | 后端文件 | 前端文件 |
|----|------|---------|---------|
| AC-001 站点管理 | ✅ | `api/sites.py` | `pages/Settings.tsx` |
| AC-002 分类映射 | ✅ | `api/sites.py` | `components/CategorySettings.tsx` |
| AC-003 首页聚合 | ✅ | `api/videos.py`, `services/aggregator.py` | `pages/Home.tsx` |
| AC-004 视频搜索 | ✅ | `api/videos.py` | `pages/Home.tsx`, `pages/Search.tsx` |
| AC-005 视频详情 | ✅ | `api/videos.py`, `services/resolver.py` | `pages/Detail.tsx` |
| AC-006 播放地址解析 | ✅ | `services/parser.py`, `services/resolver.py` | — |
| AC-007 显式选源 | ✅ | — | `components/SourcePicker.tsx` |
| AC-008 xgplayer 播放 | ✅ | — | `components/VideoPlayer.tsx`, `pages/Player.tsx` |
| AC-009 播放进度 | ✅ | `api/progress.py` | `pages/Player.tsx` |
| AC-010 收藏管理 | ✅ | `api/favorites.py` | `pages/Favorites.tsx` |
| AC-011 下载任务管理 | ✅ | `api/downloads.py`, `api/settings_api.py` | `pages/Downloads.tsx`, `pages/Settings.tsx` |
| AC-012 断点续传下载 | ✅ | `services/downloader.py` | — |
| AC-013 站点健康监控 | ✅ | `services/scheduler.py`, `services/health.py` | — |
| AC-014 VideoCache | ✅ | `api/videos.py`, `models.py` | `pages/Settings.tsx` |
| AC-015 前端 IndexedDB 缓存 | ✅ | — | `utils/cache.ts` |
| AC-016 SSE 推送 | ✅ | `api/sse.py`, `services/event_bus.py` | `api/sse.ts`, `pages/Downloads.tsx` |
| AC-017 局域网部署 | ✅ | `main.py`, `config.py` | — |
| AC-018 刮削日志 | ✅ | `services/crawler.py`, `api/videos.py` | `pages/Settings.tsx` |
| AC-019 刮削看板 | ✅ | `api/videos.py` | `pages/Settings.tsx` |
| AC-020 手动触发刮削 | ✅ | `api/videos.py` | `pages/Settings.tsx` |
| AC-021 移动端响应式布局 | ✅ | — | `styles/global.css`, `components/Layout.tsx` 等 |
| AC-022 播放器手势控制 | ✅ | — | `components/VideoPlayer.tsx` |
| AC-023 网络传输优化 | ✅ | `main.py`, `api/videos.py` | `components/VideoCard.tsx`, `utils/cache.ts` |

---

## API 端点清单

### Sites (`/api/sites`)
- `GET    /api/sites`                          → list_sites
- `POST   /api/sites`                          → create_site
- `PATCH  /api/sites/{site_id}`                → update_site
- `DELETE /api/sites/{site_id}`                → delete_site
- `POST   /api/sites/{site_id}/probe`          → probe_site
- `GET    /api/sites/{site_id}/categories`     → get_site_categories
- `PUT    /api/sites/{site_id}/categories`     → update_site_categories
- `POST   /api/sites/{site_id}/fetch-categories` → fetch_remote_categories

### Videos (`/api/videos`)
- `GET    /api/videos`                         → list_videos
- `GET    /api/videos/search`                  → search_videos
- `POST   /api/videos/detail`                  → video_detail
- `GET    /api/videos/crawler/status`          → crawler_status
- `POST   /api/videos/crawler/full`            → trigger_full
- `POST   /api/videos/crawler/incremental/{site_id}` → trigger_incremental
- `GET    /api/videos/crawler/stats`           → crawler_stats
- `GET    /api/videos/crawler/logs`            → crawler_logs
- `DELETE /api/videos/cache`                   → clear_video_cache

### Play (`/api/play`)
- `GET    /api/play/episodes`                  → get_episodes

### Downloads (`/api/downloads`)
- `GET    /api/downloads`                      → list_downloads
- `POST   /api/downloads`                      → create_download
- `POST   /api/downloads/{task_id}/pause`      → pause_download
- `POST   /api/downloads/{task_id}/resume`     → resume_download
- `DELETE /api/downloads/{task_id}`            → delete_download

### Progress (`/api/progress`)
- `POST   /api/progress`                       → upsert_progress
- `GET    /api/progress/recent`                → list_recent_progress
- `GET    /api/progress`                       → get_progress_by_title_year

### Favorites (`/api/favorites`)
- `GET    /api/favorites`                      → list_favorites
- `POST   /api/favorites`                      → add_favorite
- `DELETE /api/favorites/{fav_id}`             → remove_favorite

### Settings (`/api/settings`)
- `GET    /api/settings/download-root`         → get_download_root
- `PUT    /api/settings/download-root`         → set_download_root

### SSE (`/api/sse`)
- `GET    /api/sse`                            → sse_stream

### System
- `GET    /api/health`                         → health

---

## 前端路由清单

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | Home | 聚合列表，支持分类/时间筛选 |
| `/detail` | Detail | 视频详情，选集，显式选源 |
| `/player` | Player | xgplayer 播放，进度恢复 |
| `/downloads` | Downloads | 下载任务列表，SSE 实时进度 |
| `/favorites` | Favorites | 收藏列表 |
| `/progress` | Progress | 最近播放记录 |
| `/settings` | Settings | 站点管理、分类映射、下载根目录、缓存清理 |

---

## 数据库模型

| 模型 | 表名 | 核心约束 |
|------|------|---------|
| Site | `sites` | `name` UNIQUE, `enabled` + `sort` 索引 |
| Favorite | `favorites` | `(title, year)` UNIQUE |
| PlayProgress | `play_progress` | `(title, year)` UNIQUE, `updated_at` 索引 |
| DownloadTask | `download_tasks` | `status` 索引, `created_at` 索引 |
| VideoCache | `video_cache` | `(site_id, original_id)` UNIQUE, 完整保留（取消 LRU 上限） |
| AppConfig | `app_config` | `key` PK |

---

## 关键业务规则（当前实现）

1. **显式选源**: 播放/下载前必须弹出 `SourcePicker`，无默认选中，确定按钮在未选择时 disabled
2. **聚合去重**: 按 `normalize_title(title) + year` 去重，保留多个 `SourceRef`
3. **缓存优先**: 列表/搜索走本地 `VideoCache`，非实时回源；详情优先读缓存（7 天 TTL）
4. **断点续传**: 直接下载用 HTTP Range + `ab` 模式；m3u8 用 `.ts` 片段并发下载（TS_CONCURRENCY=5），跳过已存在片段
5. **健康监控**: 每 10 分钟探测，连续 3 次失败禁用，连续 2 次成功恢复（内存计数器）
6. **播放进度**: 每 15 秒上报，`beforeunload` 时 `sendBeacon` 兜底

---

## 已知限制

- 前端无自动化测试（jest/playwright），依赖手工验证
- 前端无自动化测试（jest/playwright），依赖手工验证
- `_failure_counts` / `_recovery_counts` 为内存字典，多进程部署时状态不共享
- `failed_sources` 字段已废弃但代码中仍保留（兼容）
