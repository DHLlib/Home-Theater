# QA Report: AC-033 (JSONB 查询优化) + AC-034 (批量导入优化)

**验证日期**: 2026-06-09
**验证人**: QA Agent
**代码基线**: home-theater-v2 分支，commit fccff7a

---

## 1. 测试套件

```bash
python -m pytest test/ -v --tb=short
```

| 指标 | 结果 |
|------|------|
| 通过 | 90 / 91 |
| 失败 | 1 |
| 警告 | 6 (DeprecationWarning: datetime.utcnow) |

**失败项分析**:
- `test_dytt_...` — `StepDefinitionNotFoundError: Given "有一个 dytt 详情页"`
- **结论**: 该失败属于 AC-006（播放地址解析）的 BDD feature 与 step defs 不匹配，**与 AC-033/034 无关**，不视为 regression。

---

## 2. Python 语法检查

| 文件 | 结果 |
|------|------|
| `backend/app/api/videos.py` | OK |
| `backend/app/services/crawler.py` | OK |
| `backend/app/db.py` | OK |

---

## 3. 逻辑验证

### AC-033: JSONB 参数化绑定

**文件**: `backend/app/api/videos.py` (第 343–357 行)

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 无 `text()` 拼接 | 通过 | 使用 `bindparam` + `JSONB` 类型 |
| 参数化绑定 | 通过 | `bindparam("site_id_filter", value=[{"site_id": site_id}], type_=JSONB)` |
| 运算符 | 通过 | `sources.op("@>")(jsonb_filter)` |

代码片段（第 345–357 行）：
```python
from sqlalchemy.dialects.postgresql import JSONB

jsonb_filter = bindparam(
    "site_id_filter",
    value=[{"site_id": site_id}],
    type_=JSONB,
)
count_query = count_query.where(
    AggregatedVideoModel.sources.op("@>")(jsonb_filter)
)
query = query.where(
    AggregatedVideoModel.sources.op("@>")(jsonb_filter)
)
```

### AC-034: 批量导入优化

#### 3.2.1 `backend/app/db.py` — 死代码清理

| 检查项 | 结果 |
|--------|------|
| `bulk_insert_video_cache` 已删除 | 通过 |

验证方式：`grep bulk_insert_video_cache backend/app/db.py` — 无匹配。

#### 3.2.2 `backend/app/services/crawler.py` — `_batch_upsert_list_fields`

| 检查项 | 结果 | 行号 |
|--------|------|------|
| 分块阈值 `>=` | 通过 | 第 621 行: `if len(entries) >= batch_size:` |
| 分块路径 `try/except` | 通过 | 第 624–647 行 |
| 单条路径执行顺序 `commit → evict → sleep(0)` | 通过 | 第 663–667 行 |
| 批量路径执行顺序 `commit → evict → sleep(0)` | 通过 | 第 640–642 行 |

#### 3.2.3 `backend/app/services/crawler.py` — `_batch_upsert_detail_fields`

| 检查项 | 结果 | 行号 |
|--------|------|------|
| 分块阈值 `>=` | 通过 | 第 674 行: `if len(entries) >= batch_size:` |
| 分块路径 `try/except` | 通过 | 第 677–706 行 |
| 单条路径执行顺序 `commit → evict → sleep(0)` | 通过 | 第 725–729 行 |
| 批量路径执行顺序 `commit → evict → sleep(0)` | 通过 | 第 697–699 行 |

---

## 4. 结论

| AC | 状态 |
|----|------|
| AC-033 | 通过 |
| AC-034 | 通过 |

- 全部 P0 修复项已正确落地。
- 测试套件中唯一的失败项与本次 AC 无关（AC-006 BDD step definition 缺失）。
- 无 regression。
