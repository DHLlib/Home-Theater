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
- **视频缓存**：详情元数据本地缓存，减少重复请求源站

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

### 1. 克隆与准备

```bash
cd "D:\workspace_py\Home Theater"
```

### 2. 后端

```bash
cd backend
pip install -e .
uvicorn app.main:app --host 0.0.0.0 --port 8181 --reload
```

后端启动后会自动创建 `backend/data/app.db`（SQLite）。

### 3. 前端（开发模式）

```bash
cd frontend
npm install
npm run dev
```

前端默认在 `http://localhost:5173` 启动，`/api` 请求会代理到 `http://localhost:8181`。

### 4. 生产部署

```bash
cd frontend && npm run build
cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port 8181
```

`vite build` 产物位于 `frontend/dist`，由 FastAPI 自动静态托管。访问 `http://<本机IP>:8181` 即可。

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
