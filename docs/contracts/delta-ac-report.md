# Delta AC 报告 — 批量站点嗅探

**变更描述**: 资源站管理增加批量嗅探功能
**分析日期**: 2026-06-07
**分析模式**: Delta 变更

---

## 新增 AC

### AC-025 批量站点嗅探

**Given** 用户在「设置 → 站点管理」页面
**When** 在批量嗅探区域粘贴 JSON 并点击「嗅探并添加」
**Then** 系统并发探测每个 URL，返回每个站点的探测结果（成功/失败 + 延迟），探测成功的自动添加到站点列表

**技术要点**:
- 后端新增 `POST /api/sites/batch-probe` API
- 复用 `health.py` 的 `probe` 函数进行单站点探测
- 并发探测需控制并发数（建议最多 5 个并发）
- 前端 Settings 页新增 JSON 输入框和批量嗅探按钮
- 输入格式：`[{ "name": "...", "url": "..." }]`
- 探测成功的站点自动调用 create_site 逻辑写入数据库
- 已有同名站点需跳过或提示

**impl_files**:
- backend/app/api/sites.py
- backend/app/services/health.py
- frontend/src/pages/Settings.tsx

---

## 影响范围总结

| 维度 | 影响 |
|------|------|
| 新增 AC | AC-025 |
| 修改 AC | 无 |
| 删除 AC | 无 |
| 受影响后端组件 | sites.py, health.py |
| 受影响前端组件 | Settings.tsx |
| 新增 API | POST /api/sites/batch-probe |
| 处理模式 | Delta 变更 |
| 回退阶段 | 新 AC 从 atdd 开始 |

---

## 风险点

1. **URL 格式校验**: 用户输入的 JSON 可能包含非法 URL，需校验格式
2. **并发控制**: 批量探测需限制并发数，避免对外部站点造成压力
3. **重复检测**: 需检查已有站点（按 name 或 base_url），避免重复创建
4. **安全性**: 防止 SSRF，限制 URL 协议和格式
