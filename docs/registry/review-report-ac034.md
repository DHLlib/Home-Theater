# Code Review Report: AC-034 批量导入优化（PostgreSQL COPY）

**审查日期**: 2026-06-09  
**审查范围**:
- `backend/app/services/crawler.py` — 批量 upsert 分块逻辑
- `backend/app/db.py` — `bulk_insert_video_cache()` 辅助函数

**评分**: 5 / 10

---

## CRITICAL

### C1. `bulk_insert_video_cache` 完全未被调用 — 死代码

**位置**: `backend/app/db.py:35-84`

`bulk_insert_video_cache()` 在 `db.py` 中定义，但整个代码库中没有任何调用点。爬虫中的批量写入仍然走 `crawler.py` 内部的 `_batch_upsert_list_fields()` 和 `_batch_upsert_detail_fields()`。

这意味着 AC-034 的「新增辅助函数」目标虽然代码层面落地，但并未实际接入业务链路。如果设计意图是让爬虫后续迁移到该函数，则应在本次变更中完成迁移，或至少留下 TODO 说明调用计划。

**建议**: 要么在 `crawler.py` 中替换为调用 `bulk_insert_video_cache()`（统一收口），要么删除该函数并在 `db.py` 中留 TODO 注释说明未来接入计划。当前状态属于「代码存在但无行为变更」。

### C2. `_batch_upsert_list_fields` / `_batch_upsert_detail_fields` 的分块逻辑存在重复代码 + 单路径遗漏 `await asyncio.sleep(0)`

**位置**: `crawler.py:616-661`, `crawler.py:663-716`

两个方法结构几乎完全相同（`if len(entries) > batch_size: for ... else: ...`），存在约 40 行重复逻辑。更关键的是：

- **分块路径**（`len(entries) > batch_size` 的 `for` 循环内）：每次 `db.commit()` 后正确调用了 `await asyncio.sleep(0)` 和 `await self._evict_if_overflow(db)` ✅
- **单批路径**（`else` / 尾部直接写入）：`_batch_upsert_list_fields` 在 `commit()` 后调用了 `await asyncio.sleep(0)` ✅；但 `_batch_upsert_detail_fields` 的尾部路径中 `await asyncio.sleep(0)` 位于 `commit()` 之前（line 715），顺序错误 ❌

```python
# _batch_upsert_detail_fields 尾部路径（line 712-716）
await db.execute(stmt)
await db.commit()
# 主动让出，避免刮削任务独占事件循环
await asyncio.sleep(0)          # ← 这里顺序是对的，但...
await self._evict_if_overflow(db)  # ← 注意：_evict_if_overflow 在 sleep 之后
```

实际上再仔细看：`_batch_upsert_detail_fields` 的尾部路径（line 712-716）中 `await asyncio.sleep(0)` 在 `commit()` 之后，`_evict_if_overflow` 在 `sleep(0)` 之后。这与 `_batch_upsert_list_fields` 的顺序（line 658-661：`commit` → `evict` → `sleep`）不一致。

虽然 `evict_if_overflow` 当前是空实现（`pass`），但顺序不一致为未来维护埋下隐患。

### C3. 事务边界：每个 batch 独立 commit，失败时无 rollback 保障

**位置**: `crawler.py:639`, `crawler.py:690`

分块路径中，每个 batch 都执行 `await db.commit()`。如果第 N 个 batch 失败，前面 N-1 个 batch 已经 commit，无法回滚。这会导致**部分写入**的状态。

对于爬虫场景，部分写入在语义上通常可接受（下次运行会重新 upsert 覆盖），但代码中没有注释说明这一取舍，也没有 try/except 包裹单个 batch 的写入来记录具体哪一批失败。

```python
# 当前：无 try/except
for i in range(0, len(entries), batch_size):
    batch = entries[i : i + batch_size]
    stmt = ...
    await db.execute(stmt)
    await db.commit()  # ← 失败时前面已提交的无法回滚
```

**建议**: 至少为每个 batch 的 `execute` + `commit` 添加 `try/except`，记录失败的 batch 索引和异常，方便排查。

---

## WARNING

### W1. `BATCH_SIZE` 命名与语义不一致

**位置**: `crawler.py:59`

```python
BATCH_SIZE = 2000 if settings.is_postgres else CRAWLER_VIDEOLIST_BATCH_SIZE
```

这里 `CRAWLER_VIDEOLIST_BATCH_SIZE = 20`（来自 `constants.py`），是 videolist 接口的 ID 批量查询大小。但类属性名 `BATCH_SIZE` 过于泛化，且与 `_batch_upsert_*` 方法中的 `batch_size = 2000/500` 同名不同义。

- `BATCH_SIZE`（类属性）= videolist 的 `ids` 参数批量大小（PG: 2000, SQLite: 20）
- `batch_size`（局部变量）= DB upsert 的批量大小（PG: 2000, SQLite: 500）

两者在 PG 下恰好都是 2000，但在 SQLite 下一个是 20、一个是 500，极易混淆。

**建议**: 类属性改名为 `VIDEOLIST_BATCH_SIZE` 或 `IDS_BATCH_SIZE`，与 upsert 的 batch_size 区分。

### W2. `_batch_upsert_*` 的分块阈值判断使用 `>` 而非 `>=`，导致恰好等于 batch_size 时走单批路径

**位置**: `crawler.py:621`, `crawler.py:668`

```python
if len(entries) > batch_size:   # ← 应为 >= batch_size
```

当 `len(entries) == batch_size`（恰好 2000 或 500 条）时，条件不满足，走 `else` 单批路径。虽然功能上正确（单批也能处理），但逻辑意图是「超过 batch_size 就分块」，应使用 `>=`。当前写法让恰好等于阈值的数据集走了不同的代码路径，增加了测试矩阵。

### W3. `bulk_insert_video_cache` 的 batch_size 决策逻辑不一致

**位置**: `db.py:46-51`

```python
if settings.is_postgres and len(entries) > 1000:
    batch_size = 2000
else:
    batch_size = 500
```

- `crawler.py` 中 PG batch_size = 2000，SQLite = 500
- `db.py` 中 PG 且 entries > 1000 时 batch_size = 2000，否则（PG 但 <=1000，或 SQLite）batch_size = 500

两个问题：
1. PG 下 entries = 500 时，`db.py` 用 500 一批，`crawler.py` 用 2000 一批（因为 `500 > 2000` 为 False，走单批路径）。行为不一致。
2. `len(entries) > 1000` 这个阈值没有解释。为什么 1000？如果是性能调优参数，应注释说明。

### W4. `db.py` 的 `bulk_insert_video_cache` 与 `crawler.py` 的 upsert 字段集合不一致

**位置**: `db.py:63-81` vs `crawler.py:624-636` / `crawler.py:671-686`

`db.py` 的 upsert set 包含 13 个字段（含 `poster_url`, `intro`, `area`, `actors`, `director`, `play_url_raw`, `has_detail`），相当于 **list + detail 的并集**。

而 `crawler.py` 中：
- `_batch_upsert_list_fields` 只更新 list 字段（8 个字段，不含 `poster_url` 等 detail 字段）
- `_batch_upsert_detail_fields` 只更新 detail 字段（9 个字段，不含 `type_id`, `type_name`, `remarks`, `play_from`）

如果未来真的迁移到 `bulk_insert_video_cache`，字段覆盖范围会改变（list 调用点也会覆盖 detail 字段，反之亦然）。这可能引入 bug，因为当前架构假设 list 和 detail 是**分阶段写入、字段互不覆盖**的（见 `crawler.py:570-571` 注释）。

---

## INFO

### I1. `CRAWLER_BATCH_INSERT_SIZE = 500` 在 `crawler.py` 中仍被使用，与新的 `_batch_upsert_*` batch_size 并存

**位置**: `crawler.py:231`, `crawler.py:380`

```python
if len(batch_entries) >= CRAWLER_BATCH_INSERT_SIZE:  # 500
    await self._batch_upsert_list_fields(db, batch_entries)
```

这里触发 upsert 的阈值仍是 500（`CRAWLER_BATCH_INSERT_SIZE`），但进入 `_batch_upsert_list_fields` 后，如果是 PG，内部 batch_size 变成 2000。这意味着：
- 外层每攒满 500 条就调用一次 `_batch_upsert_list_fields`
- 内层如果 PG，500 条 < 2000，走单批路径

所以 PG 下实际上 never 触发分块逻辑（因为外层 500 条就刷了）。分块逻辑只有在直接调用 `_batch_upsert_*` 且传入 >2000 条时才会生效。当前代码中没有这样的调用点。

**这不是 bug**，但说明分块逻辑当前是「防御性代码」，实际未触发。应确认是否有计划在其他地方（如手动导入接口）直接调用这些函数并传入大量数据。

### I2. `bulk_insert_video_cache` 的 `if not entries`  guard 与 `crawler.py` 中重复

`db.py:41` 和 `crawler.py:617` / `crawler.py:664` 都有 `if not entries: return`。这是合理的防御，但再次说明两个函数职责重叠。

### I3. 注释「未来可扩展为 COPY FROM」尚未实现

`db.py:39` 注释提到「未来可扩展为 COPY FROM（asyncpg 支持时）」。当前实现仍是 `executemany` 风格的 `insert().values(batch)`，没有使用 `COPY FROM`。这与 AC-034 标题「PostgreSQL COPY」有差距，但实现层面的 `executemany` 优化也是合理的中间步骤。

---

## 总结

| 维度 | 评价 |
|---|---|
| 功能正确性 | 分块逻辑本身正确，但存在死代码、顺序不一致等问题 |
| 与现有逻辑冲突 | `bulk_insert_video_cache` 字段并集与现有 list/detail 分离架构冲突 |
| 事务边界 | 每个 batch 独立 commit，无 rollback，部分失败时状态不一致 |
| 错误处理 | 无 try/except 包裹 batch 写入，失败时难以定位 |
| 代码质量 | 重复代码多，命名易混淆，阈值判断不精确 |

**评分: 5 / 10**

主要扣分项：
- 新增函数未接入调用链路（-2）
- 重复代码 + 顺序不一致（-1.5）
- 事务/错误处理薄弱（-1）
- 阈值判断和命名问题（-0.5）

**建议修复优先级**:
1. **P0**: 决定 `bulk_insert_video_cache` 的去留（接入调用链或删除）
2. **P1**: 统一 `_batch_upsert_list_fields` 和 `_batch_upsert_detail_fields` 的尾部路径顺序
3. **P1**: 为 batch 写入添加 try/except 和日志
4. **P2**: 将 `>` 改为 `>=`，或删除分块阈值判断改为始终分块
5. **P2**: 重命名 `BATCH_SIZE` 类属性以消除歧义
