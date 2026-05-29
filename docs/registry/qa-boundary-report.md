# QA Boundary Report — Home Theater Sprint-001

**日期**: 2026-05-27  
**说明**: 以下边界测试建议不阻塞当前 Sprint 发布，建议在下个迭代或技术债务清理日补充。

---

## 后端边界测试建议

### 1. AC-001 站点管理 — 输入边界
- **空字符串 name/base_url**: `create_site` 传入 `name=""` 或 `base_url=""`，应返回 422（Pydantic 非空约束）
- **超长 name**: 传入 256 字符以上的 name，验证数据库/String 约束行为
- **非法 URL**: `base_url="not-a-url"`，当前仅按字符串存储，无 URL 格式校验
- **排序边界**: `sort=-1` 或极大值，验证排序稳定性

### 2. AC-002 分类映射 — 互斥边界
- **空 categories 数组**: `PUT /api/sites/{id}/categories` 传 `[]`，应正确清空
- **remote_id 为空字符串**: 验证是否被当作有效 remote_id 处理
- **重复 remote_id 跨不同站点**: 当前互斥校验仅限制**同一站点内**，跨站点重复是允许的，需确认业务预期

### 3. AC-003/004 列表/搜索 — 查询边界
- **wd 为特殊字符**: `wd="%_%"`（SQL LIKE 通配符），验证是否被转义（当前 `contains()` 行为）
- **category 不存在**: 传不存在的分类名，应返回空列表而非 500
- **pg 为 0 或负数**: 当前 `(page - 1) * per_page` 会产生负数 slice，应验证行为
- **极大 pg**: `pg=999999`，验证空列表响应性能

### 4. AC-005 视频详情 — 缓存边界
- **缓存恰好 7 天过期**: 构造 `cached_at = now - 7 days` 的记录，验证是否被判定为过期
- **所有源同时失败**: `req.sources` 包含 3 个站点，全部返回异常，验证 502 响应
- **play_url_raw 为空字符串**: 验证 `parse_episodes("")` 返回空列表而非抛异常

### 5. AC-010 收藏管理 — 并发边界
- **并发重复添加**: 两个请求同时添加 `(title="X", year=2020)`，验证第二个是否稳定返回 409
- **year 为 0 或负数**: `year=0` 或 `year=-100`，验证数据库约束和去重逻辑

### 6. AC-011 下载任务 — 状态机边界
- **非法状态流转**: 从数据库直接修改 `status="done"` 后再调用 `pause`，应拒绝或静默处理
- **suffix 为路径遍历字符串**: `suffix="../../../etc/passwd"`，验证 sanitize 后是否降级为 `.mp4`
- **download_root 为相对路径**: `root="./downloads"`，验证最终 file_path 是否为绝对路径

### 7. AC-012 断点续传 — 网络边界
- **Range 请求返回 200 而非 206**: 某些服务器不支持 Range，直接返回完整内容，验证追加写入不会重复
- **m3u8 子流选择无 BANDWIDTH 标签**: master playlist 缺少带宽信息，验证默认选择行为
- **ts 片段返回 0 字节**: 验证是否被当作下载成功（当前仅检查 `status_code >= 400`）

### 8. AC-013 站点健康 — 阈值边界
- **恰好 3 次失败**: 验证第 3 次失败触发禁用，第 2 次不触发
- **恰好 2 次成功恢复**: 验证自动禁用后第 2 次成功触发恢复，第 1 次不触发
- **探测返回 200 但响应体异常**: 验证是否被判定为成功（当前仅检查 HTTP 状态）

### 9. AC-014 VideoCache — 容量边界
- **恰好 5000 行**: upsert 后保持 5000 行，不删除
- **恰好 5001 行**: 删除最旧 1 条，剩 5000
- **全部记录 cached_at 相同**: 验证淘汰稳定性（子查询 ORDER BY cached_at ASC LIMIT ?）
- **手动清理后 upsert**: `DELETE /videos/cache` 后立即请求详情，验证缓存重建

---

## 前端边界测试建议

### 10. AC-007 显式选源 — 交互边界
- **sources 为空数组**: 验证 SourcePicker 显示「无可用源」且确定按钮 disabled
- **快速连续点击确定**: 验证不会触发多次 onConfirm

### 11. AC-008 播放器 — 状态边界
- **视频总时长为 0 或 undefined**: 验证进度条和键盘跳转不抛异常
- **最后一集点击「下一集」**: 验证按钮禁用或提示
- **m3u8 直播流（无结束时间）**: 验证播放器不尝试 seek 到不存在的时长

### 12. AC-009 播放进度 — 存储边界
- **LocalStorage/IndexedDB 已满**: 验证 `sendBeacon` 和 `upsertProgress` 不崩溃
- **进度为视频末尾**: `position_seconds == duration_seconds`，验证恢复时是否从头播放或显示「已看完」

### 13. AC-015 前端缓存 — TTL 边界
- **系统时间回拨**: 本地时间从 10:00 调到 09:00，验证缓存是否被错误判定为未过期
- **IndexedDB 版本升级**: 修改 cache schema 后验证旧数据清理

---

## 集成/端到端边界测试建议

### 14. 全链路异常降级
- **创建下载任务后站点被禁用**: 验证下载 worker 是否继续尝试（当前依赖 `source_site_id` 外键，站点禁用不影响已有任务）
- **详情请求时站点已删除**: `Site` 记录被删除，`video_detail` 中 `sites.get(source_ref.site_id)` 返回 None，验证 FailedSource 响应

### 15. 性能边界
- **1000 个站点同时探测**: 验证 `_probe_all_sites` 的并发 gather 是否导致连接池耗尽
- **VideoCache 10000 条聚合查询**: 当前无索引覆盖 `LIKE '%wd%'`，大数据量搜索性能待验证
