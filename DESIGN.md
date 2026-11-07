---
name: Home Theater
description: 个人视频聚合系统的深色媒体库界面（品类标准件）
colors:
  bg: "#0A0A0B"
  bg-elevated: "#121214"
  bg-surface: "#17171A"
  text-primary: "#F5F5F7"
  text-secondary: "#A1A1AA"
  text-muted: "#8A8A93"
  border: "#232326"
  border-hover: "#303036"
  border-bright: "#43434B"
  primary: "#4ADE80"
  danger: "#F87171"
  warning: "#FBBF24"
typography:
  display:
    fontFamily: "'Cinzel', 'Noto Sans SC', serif"
    usage: "仅品牌字标（HOME THEATER），字距 0.16–0.2em"
  title:
    fontFamily: "'Noto Sans SC', -apple-system, sans-serif"
    size: "24px / 600"
    usage: "弹窗标题"
  headline:
    fontFamily: "'Noto Sans SC', sans-serif"
    size: "18px / 600"
    usage: "分区标题（推荐、全部视频、来源）"
  body:
    fontFamily: "'Noto Sans SC', sans-serif"
    size: "14px / 400"
    lineHeight: 1.7
    usage: "简介、来源行"
  meta:
    fontFamily: "'Noto Sans SC', sans-serif"
    size: "12px / 400"
    usage: "年份 · 分类 · 来源数；表格数字用 tabular-nums"
rounded:
  sm: "8px"
  card: "12px"
  dialog: "16px"
  pill: "999px"
---

# Design System: Home Theater（品类标准件）

## 1. 定位

一个**个人视频聚合库**的界面。参照系是 Plex / Emby / Netflix 的工艺水准：封面是主角，界面是容器。系统不追求奇观，追求「一眼可用、久看不累」。

**它不是**：管理后台（表格与表单堆叠）、短视频信息流（无限刷）、或某种视觉世界的仿制品（报纸、航站楼、放映室）。

## 2. 颜色

三级表面 + 一级强调，全部来自同一中性色带（略带蓝的深灰），只有绿色承担语义。

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#0A0A0B` | 页面底 |
| `--bg-elevated` | `#121214` | 卡片、弹窗、输入框 |
| `--bg-surface` | `#17171A` | 悬浮态、次级块 |
| `--border` / `-hover` / `-bright` | `#232326` / `#303036` / `#43434B` | 描边即层级 |
| `--text-primary` | `#F5F5F7` | 标题、正文（17.8:1） |
| `--text-secondary` | `#A1A1AA` | 说明（8.1:1） |
| `--text-muted` | `#8A8A93` | 元信息（5.6:1） |
| `--primary` | `#4ADE80` | 进度、选中、成功、新增 > 0 |
| `--danger` | `#F87171` | 删除、错误、未补全 |

**规则**
- **绿色只有一个工作**：表达「正在进行 / 已选中 / 有新增」。它不用于主操作按钮、不用于装饰、不做光晕。
- **主操作用白**：`#F5F5F7` 底 + `#0A0A0B` 字（播放、搜索、确认）。次操作透明 + 描边。危险操作红描边。
- 状态色只在**有值**时出现：日志里 `0` 用 `--text-muted`，`>0` 才点亮。

## 3. 排版

- 界面正文 Noto Sans SC；品牌字标 Cinzel（只出现在顶栏与移动首页页头）。
- 层级靠字重与字号，不靠颜色堆叠：24 弹窗标题 / 18 分区 / 14 正文 / 12 元信息。
- 数字（年份、集数、百分比、字节、耗时）一律 `font-variant-numeric: tabular-nums`，避免跳动。
- 标题最多 2 行（`-webkit-line-clamp`），简介 4 行截断；资源站简介先去标签再**解码 HTML 实体**。

## 4. 层级与圆角

- **描边即层级**：`1px` 描边 + 一档表面色。默认不用投影；只有真正浮起的层（弹窗、抽屉、Toast、选源浮层）允许一个大而软的投影，且不与描边重复声明。
- 圆角只有四档：`8px`（按钮、输入）、`12px`（封面、卡片、来源块）、`16px`（弹窗、抽屉）、`999px`（胶囊、状态点）。
- 不用发光、不用彩色 halo、不用渐变文字、不用玻璃拟态做装饰。

## 5. 组件

**顶栏**：品牌（Cinzel）+ 六个文字链接（当前项表面胶囊）+ 胶囊搜索 + 主题切换。播放页不挂顶栏。
**封面卡**：2:3 海报（12px 圆角、1px 描边）+ 卡下两行标题 + `年份 · N 个来源`；hover 只放大海报（1.045）并从底部压暗浮出「选择来源 / 收藏」。
**分类**：标签行，父类点击展开子类下拉（hover 仅增强），选中项绿色下划线。
**详情弹窗**：880px，左侧 176px 海报（`aspect-ratio: 2/3`），右侧标题/元信息/简介/操作；下方「来源」区，每行展开即选集。
**选源浮层**：Portal 挂 body，440px，行内给可比较信息（集数 · 分类 · 备注），点一行即开始；没有可比信息就不显示副标题，绝不暴露原始 ID。
**选集**：92px 网格、36px 高的小卡；多选态左侧勾选框。
**进度**：3–4px 轨道 + 绿色填充；阈值色：暂停黄、错误红。
**移动**：底部五项导航；首页 = 品牌 + 一行搜索 + 分类 + 推荐横条 + 两列封面墙；详情是整页，播放走选源抽屉。

## 6. 动效

`120 / 200 / 320ms`，缓动 `cubic-bezier(0.16, 1, 0.3, 1)`。只做三件事：页面淡入（200ms）、海报 hover 放大、弹窗进出。全部响应 `prefers-reduced-motion`。

## 7. Do / Don't

- **Do** 用描边和一档表面色分层；**Don't** 用阴影或发光表达层级。
- **Do** 让封面占满注意力；**Don't** 在海报上加角标堆叠（来源数放卡下）。
- **Do** 把强制步骤（选源）做成一屏内可比较的列表；**Don't** 为同一步骤叠两层弹窗。
- **Do** 用状态色表意（>0 才亮）；**Don't** 把 0 也染成成功色。
- **Do** 统一空态为 `.poster-empty`（图标 + 暂无封面）；**Don't** 让 `<img>` alt 文本直接上屏。
- **Don't** 使用 KPI 大数字卡、彩色顶边、eyebrow 小标题、01/02/03 编号。

## 8. 无障碍

正文对比度 ≥ 4.5:1（实测 8.1）；焦点环 2px 绿色、offset 2px；封面卡可 Tab + Enter 打开；触摸目标 ≥ 44dp；图表与状态不单靠颜色（配合文字与图标）。
