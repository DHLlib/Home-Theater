# 项目经验教训

## 2026-06-13：Phase 2 聚合中间表重建踩坑

**现象 1**：SQLite 通用路径下，全量重建聚合中间表时进程内存暴涨到约 8.7 GB，最终 OOM。

**原因**：
Python 端把 `video_cache` 全部记录（约 180 万条）读到内存做聚合，并保留了每条 source 引用，导致内存占用过高。

**解决**：
- PostgreSQL 路径改用 `INSERT ... SELECT` + CTE，在数据库端完成聚合，只写入结果。
- SQLite 路径保留 Python 流式聚合，但按 `norm_title` 首字符哈希分 16 个桶，逐桶读、逐桶写，避免全表驻留内存。

**教训**：
- 大数据量聚合尽量下推到数据库；Python 端只做数据库无法完成的逻辑。
- 如果必须在 Python 端聚合，使用流式/分区，控制同时驻留内存的数据量。

---

**现象 2**：给 `aggregated_videos` 加唯一约束 `(norm_title, year)` 后，重建报 `UniqueViolationError`。

**原因**：
物化视图聚合键实际上是 `(norm_title, year, title)`：同一个规范化名称+年份可能对应多个原始 title（例如标点、大小写差异清理后相同，但原 title 不同），所以 `(norm_title, year)` 不唯一。

**解决**：
去掉 `AggregatedVideoV3` 上的 `UniqueConstraint("norm_title", "year")`。

**教训**：
- 从物化视图迁移到普通表时，不能简单照搬“看起来唯一”的字段，必须核对物化视图的 `GROUP BY` 粒度。
- 预聚合表允许同一 `(norm_title, year)` 存在多行，只要读取时按排序取前 N 条即可。

---

**现象 3**：PostgreSQL CTE 重建 `aggregated_videos` 时偶发 `ERROR: mergejoin input data is out of order`。

**原因**：
PostgreSQL 优化器在处理大规模排序+聚合的 CTE 时触发已知 bug，生成错误结果的 merge join 计划。

**解决**：
在重建 SQL 执行前设置 `SET LOCAL enable_mergejoin = off`，强制优化器避开 merge join。

**教训**：
- 大数据量聚合如果确认数据本身有序，但优化器报“out of order”，优先怀疑优化器计划 bug。
- 使用 `SET LOCAL` 限制会话级优化器开关，避免全局影响。

---

**现象 4**：`recommended_videos` 重建速度极慢，且日志长时间无输出。

**原因**：
`rebuild_recommended_videos()` 使用 `selectinload(AggregatedVideoV3.sources_rel)` 一次性加载全部聚合视频及其来源关系，数据量巨大时耗时久、内存高。

**解决**：
- 当前实现已能完成重建（本次约 180 万条聚合后产生 15 条推荐）。
- 后续若推荐重建成为瓶颈，可改为按父分类分批次 SQL 聚合，避免 ORM 全量加载。

**教训**：
- 全表 `selectinload` 只适用于小表；大数据量的预计算推荐应优先用 SQL 聚合或分页批量处理。

---

**现象**：
用户报告后端日志出现 `PermissionError: [WinError 32] 另一个程序正在使用此文件，进程无法访问。`，发生在 `RotatingFileHandler` 尝试轮转 `backend/logs/source.log` 时。

**原因**：
Claude 在调试过程中启动了 8181 端口的后端用于测试，测试完成后没有停止该进程。用户随后按自己的配置启动了 8000 端口的后端。两个 Python 进程同时写入同一个日志文件，当日志大小达到阈值需要轮转重命名时，一个进程持有文件句柄，另一个进程报 `PermissionError`。

**解决**：
1. 停止所有 Python 后端进程
2. 清理 `backend/logs/` 下的旧日志文件
3. 按 `.env` 配置重新启动单个后端

**教训**：
- 任何由调试/测试启动的后端、worker、服务器进程，在测试结束后必须立即清理
- 启动新实例前，先检查是否已有同类进程在运行（`tasklist | grep python`、`netstat`）
- 不要假设用户不会自己启动服务；测试端口应与用户配置保持一致，或测试后明确告知用户

**后续检查清单**：
- [ ] 测试完成后 `tasklist | grep python` 确认无残留
- [ ] `netstat -ano | grep -E "(8000|8181)"` 确认端口已释放
- [ ] 如必须保留后台进程，应写入 `.pid` 文件并明确告知用户
