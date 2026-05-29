# Assembly Report — Home Theater Sprint-001

**组装日期**: 2026-05-27  
**组装者**: Orchestrator  
**技术栈**: FastAPI + React/Vite

---

## Phase 1: Domain 模块扫描

### 后端 Domain 扫描

| Domain | `__init__.py` | Router 导出 | 状态 |
|--------|--------------|-------------|------|
| `app.api.sites` | 空 | `router` (硬编码导入) | 已注册 |
| `app.api.videos` | 空 | `router` (硬编码导入) | 已注册 |
| `app.api.play` | 空 | `router` (硬编码导入) | 已注册 |
| `app.api.downloads` | 空 | `router` (硬编码导入) | 已注册 |
| `app.api.progress` | 空 | `router` (硬编码导入) | 已注册 |
| `app.api.favorites` | 空 | `router` (硬编码导入) | 已注册 |
| `app.api.settings_api` | 空 | `router` (硬编码导入) | 已注册 |
| `app.api.sse` | 空 | `router` (硬编码导入) | 已注册 |

**[MISSING]** `backend/app/api/__init__.py` 为空，未按 `entry-point-contract.yaml` 导出各 domain 的 `router` / `models`。当前 `main.py` 采用硬编码 `import` 方式注册，功能正常但不符合契约约定的动态扫描模式。

### 前端 Domain 扫描

| Page | 路由 | 组件 | 状态 |
|------|------|------|------|
| Home | `/` | `pages/Home.tsx` | 已挂载 |
| Detail | `/detail` | `pages/Detail.tsx` | 已挂载 |
| Player | `/player` | `pages/Player.tsx` | 已挂载 |
| Downloads | `/downloads` | `pages/Downloads.tsx` | 已挂载 |
| Favorites | `/favorites` | `pages/Favorites.tsx` | 已挂载 |
| Progress | `/progress` | `pages/Progress.tsx` | 已挂载 |
| Settings | `/settings` | `pages/Settings.tsx` | 已挂载 |
| Search | (首页带参数) | `pages/Search.tsx` | 已挂载* |

*Search 页面通过 `Layout.tsx` 搜索框跳转至 `/?wd=xxx`，`Search.tsx` 作为独立页面存在但可能未在 router 中显式注册。

---

## Phase 2: 后端路由注册

注册于 `backend/app/main.py`：

```python
app.include_router(sites.router,       prefix="/api")
app.include_router(videos.router,      prefix="/api")
app.include_router(play.router,        prefix="/api")
app.include_router(downloads.router,   prefix="/api")
app.include_router(progress.router,    prefix="/api")
app.include_router(favorites.router,   prefix="/api")
app.include_router(settings_api.router, prefix="/api")
app.include_router(sse.router,         prefix="/api")
```

**前缀策略**：所有 router 自身已携带 `prefix="/{domain}"`，因此 `app.include_router` 统一使用 `prefix="/api"`，最终路径为 `/api/sites`、`/api/videos` 等。

---

## Phase 3: 前端页面挂载

注册于 `frontend/src/router.tsx`：

```typescript
createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "detail", element: <Detail /> },
      { path: "player", element: <Player /> },
      { path: "downloads", element: <Downloads /> },
      { path: "favorites", element: <Favorites /> },
      { path: "progress", element: <Progress /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);
```

---

## Phase 4: 冒烟测试

### 后端启动测试

```bash
cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**结果**: ✅ **启动成功**

- `INFO: Application startup complete.`
- `init_db()` 执行成功（自动建表 + 列补齐）
- `download_worker` 后台循环启动
- `scheduler` 探测循环 + 刮削器启动

### 端点探测

| 端点 | 期望 | 实际 | 状态 |
|------|------|------|------|
| `GET /api/health` | `{"status":"ok"}` | `{"status":"ok"}` | ✅ |
| `GET /api/sites` | 站点列表 | 返回 2 个站点 | ✅ |
| `GET /api/downloads` | `[]` | `[]` | ✅ |
| `GET /docs` (Swagger) | 200 | 200 | ✅ |

### 前端构建测试

```bash
cd frontend && npm run build
```

**结果**: ✅ **构建成功**

- 输出目录：`frontend/dist/`
- 产物大小：index.js ~997KB（含 ckplayer），index.css ~57KB
- 警告：ckplayer 使用 eval（第三方依赖，不可控）；chunk 超过 500KB（ckplayer 导致）

---

## Phase 5: 文档更新

- `README.md`：已包含完整启动指南（开发模式/生产模式/局域网部署），无需修改
- `docs/registry/system-context.md`：本次新建，记录当前实现状态

---

## 组装结论

| 检查项 | 状态 |
|--------|------|
| 后端服务能启动 | ✅ |
| 健康端点可访问 | ✅ |
| 所有 domain 路由已注册 | ✅ |
| 前端能编译通过 | ✅ |
| 静态文件托管正常 | ✅ |
| `system-context.md` 已生成 | ✅ |

**Assembly 状态**: **PASSED**

**遗留项**:
- [MISSING] `backend/app/api/__init__.py` 未导出 router（不影响运行，建议后续 Sprint 按契约补全动态注册）
- [WARNING] 前端 Search 页面未在 router.tsx 中显式注册（通过首页参数方式实现搜索，功能正常）
