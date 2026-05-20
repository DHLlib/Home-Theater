# Home Theater

个人视频聚合系统。配置多个采集站（资源站），后端并发拉取、按「名称 + 年份」聚合去重，前端以卡片网格展示。播放与下载时要求用户**显式选择来源**，禁止自动挑选。支持播放进度记录、收藏、断点续传下载。

本机或局域网访问，纯 Python 部署。

---

## 功能

- **首页聚合**：跨多源并发查询，同名同年合并为一张卡片
- **搜索**：以关键字跨所有源并发搜索
- **详情页**：封面、简介、年份、地区、演员表、导演、选集列表
- **播放**：ckplayer 播放，支持上一集/下一集切换，键盘快进快退，播放进度自动保存
- **下载**：HTTP Range 断点续传，支持暂停/继续，下载根目录一次性配置
- **收藏**：单用户收藏列表
- **站点管理**：采集站 CRUD、连通性探测、远程分类抓取
- **分类映射**：将各站点的子分类映射到统一的扁平系统分类
- **视频缓存**：详情元数据本地缓存（SQLite + IndexedDB），减少重复请求源站
- **性能优化**：下载批量 commit、前端请求去重/并发限制、全局 IntersectionObserver、静态文件缓存头

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.13, FastAPI, httpx, SQLAlchemy(async), aiosqlite |
| 前端 | React 18, Vite, TypeScript, react-router-dom |
| 播放器 | ckplayer |
| 数据库 | SQLite（启动时自动建表） |
| 部署 | uvicorn + FastAPI 静态托管前端构建产物 |

---

## 快速开始

### 前提

- Python 3.11+（推荐 3.13）
- Node.js 18+ 及 npm

### 1. 安装依赖

**后端**：
```bash
cd backend
pip install -e .
```

**前端**：
```bash
cd frontend
npm install
```

### 2. 开发模式（前后端分别启动）

**步骤 1：启动后端**（新开一个终端）
```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload
```

- 后端启动后会自动创建 `backend/data/app.db`（SQLite）
- API 地址：`http://localhost:8181`
- `--reload` 修改代码后自动重启，开发时开启

**步骤 2：启动前端**（再新开一个终端）
```bash
cd frontend
npm run dev
```

- 前端地址：`http://localhost:5173`
- `vite.config.ts` 中已配置代理：`/api` → `http://localhost:8181`
- 修改前端代码后浏览器自动热更新

**步骤 3：浏览器访问**
```
http://localhost:5173
```

### 3. 生产模式（单端口）

生产环境不需要启动前端开发服务器，前端构建为静态文件后由 FastAPI 托管。

**步骤 1：构建前端**
```bash
cd frontend
npm run build
```

构建产物位于 `frontend/dist/`，FastAPI 启动后会自动检测并托管。

**步骤 2：启动后端（不带 --reload）**
```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8181
```

**步骤 3：浏览器访问**
```
http://<本机IP>:8181
```

`0.0.0.0` 表示局域网内其他设备也可访问。

### 4. 局域网部署注意事项

- 确保防火墙允许 8181 端口入站（Windows：设置 → 系统 → 远程桌面 → 高级设置 → 入站规则）
- 如果端口被占用，换一个端口：`--port 8080`
- 终止占用端口的进程（Windows）：`taskkill /F /PID <PID>`

---

## 项目结构

```
Home Theater/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI 入口、路由挂载、静态托管、启动建表
│   │   ├── models.py         # ORM：Site / Favorite / PlayProgress / DownloadTask / VideoCache / AppConfig
│   │   ├── schemas.py        # Pydantic 请求/响应模型
│   │   ├── db.py             # async engine + session_factory
│   │   ├── api/              # 路由：sites / videos / play / downloads / progress / favorites / settings
│   │   └── services/         # 业务逻辑：source_client / parser / aggregator / downloader / health
│   ├── data/                 # SQLite 文件（运行时生成）
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── api/              # fetch 封装 + 各模块 API
│   │   ├── pages/            # Home / Search / Detail / Player / Downloads / Favorites / Progress / Settings
│   │   ├── components/       # VideoCard / EpisodeList / SourcePicker / VideoPlayer / CategorySettings / Layout
│   │   ├── utils/            # cache（IndexedDB）/ toast
│   │   └── types.ts          # TypeScript 类型
│   ├── public/ckplayer/      # 播放器资源（需手动放置）
│   └── vite.config.ts
├── docs/
│   ├── lessons-learned.md    # 排错/踩坑记录
│   └── superpowers/          # 设计规格与实施计划
└── CLAUDE.md                 # 项目硬规范（资源站参数、播放地址解析、分类映射）
```

---

## 核心规范速查

所有与采集站交互的代码必须遵守以下硬规范（详见 `CLAUDE.md`）：

| 规范 | 唯一落点 |
|------|---------|
| 资源站参数 `ac/t/pg/wd/h/ids` 构造 | `backend/app/services/source_client.py` |
| `集数$地址$后缀` 多行解析 | `backend/app/services/parser.py` |
| `名称+年份` 聚合去重 | `backend/app/services/aggregator.py` |
| 显式选源（无默认） | `frontend/src/components/SourcePicker.tsx` |
| 下载根目录一次性配置 | `backend/app/api/settings_api.py` + `frontend/src/pages/Settings.tsx` |
| 分类映射（扁平系统分类，互斥约束） | `frontend/src/components/CategorySettings.tsx` |

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload` | 后端开发 |
| `cd frontend && npm run dev` | 前端开发 |
| `cd frontend && npm run build` | 前端构建（产物由 FastAPI 托管） |
| `taskkill //F //IM python.exe` | 终止所有 Python 进程（Windows） |

---

## 排错优先顺序

遇到异常时：

1. **查 `docs/lessons-learned.md`** — 过往错误有很高的重复命中概率
2. **查 `CLAUDE.md`** — 核对硬规范（资源站参数、播放地址解析、分类映射）
3. **查代码** — 当前实现是否偏离上述规范

---

## 文档索引

- **设计规格**：`docs/superpowers/specs/`
- **实施计划**：`docs/superpowers/plans/`
- **踩坑记录**：`docs/lessons-learned.md`
- **项目规范**：`CLAUDE.md`
