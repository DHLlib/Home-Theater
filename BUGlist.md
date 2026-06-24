# Home Theater v2 BUG 列表

> 生成时间：2026-06-20  
> 最后更新：2026-06-23（已复核【已修复】条目并清理）  
> 范围：backend/ + frontend/ 源码复核 + 测试运行  
> 分支上下文：**当前分支为 PG-only（仅支持 PostgreSQL）**  
> 说明：本次复核后，确认已修复的 BUG 已从列表中移除；**L5 已修复**，详情见下方补充说明。

---

## 仍未修复

### F11. 详情页分源剧集列表绕过 `SourcePicker`
- **位置**：`frontend/src/components/DetailContent.tsx:359-387`
- **问题**：详情页直接渲染每个来源的 `EpisodeList` 和“从此源播放”按钮，点击后直接 `navigate` 到 Player，未经过 `SourcePicker`。当只有一个来源时，用户也不会看到强制选源弹窗。
- **影响**：违反“无默认源，必须显式选源”的架构硬规范。

---

## 待后续复核项

以下问题由人工通读发现，尚未精确定位到可复现用例，建议后续复核：

1. `videos.py` 的 `_query_and_aggregate` 与 `aggregator.py` 的聚合/回填逻辑分散在两处，存在重复实现，长期维护易产生行为漂移。
2. `scheduler._seconds_until_next_run` 使用 `datetime.now()`（本地时间），但常量命名为 `CRAWLER_FILL_VIDEOLIST_HOUR/MINUTE`，跨时区部署或服务器时区非本地时会有偏差。

---

## 测试运行结果摘要

- **backend/test**：`8 passed, 8 warnings`（仅覆盖分类缓存新逻辑）。
- **frontend**：`29 passed`。
- **根目录 test**：`19 failed, 23 passed, 40 errors`，失败/错误均因默认 PostgreSQL 测试库连接失败（`asyncpg.exceptions.ConnectionDoesNotExistError`）；在 PG-only 分支下属于预期行为，需本地 PostgreSQL。

---

## 补充说明

本次复核除更新 BUG 状态外，还记录了以下改进（详见 `docs/lessons-learned.md`）：

- 分类设置（CategorySettings）UI 重构：站点标签页支持滚轮横向滚动、系统分类树增加键盘与开关交互、全部颜色使用 CSS 变量以适配深黑影院绿与绯红主题。
- `DetailContent.tsx` 播放链接在 `year` 为空时省略 `year` 参数，避免进度保存唯一键冲突。
- `backend/app/api/downloads.py` 批量创建下载任务时，`download_status` 事件已补齐 `source_site_id`、`source_video_id`、`url`、`suffix`，前端不再回退到占位值。
