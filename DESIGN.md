---
name: Home Theater
description: 个人视频聚合系统的深黑影院主题界面
colors:
  primary: "#4ade80"
  bg: "#000000"
  bg-elevated: "#0a0a0a"
  text-primary: "#ffffff"
  text-secondary: "#a3a3a3"
  text-muted: "#525252"
  danger: "#fb7185"
  warning: "#fbbf24"
  success: "#4ade80"
typography:
  display:
    fontFamily: "'Cinzel', 'Noto Sans SC', serif"
    fontSize: "clamp(1.5rem, 4vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.02em"
  headline:
    fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.02em"
  title:
    fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  body:
    fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "'Noto Sans SC', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.04em"
rounded:
  sm: "2px"
  md: "4px"
  lg: "16px"
  full: "100px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "48px"
components:
  button-default:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  button-default-hover:
    textColor: "{colors.text-primary}"
  button-primary:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  input-default:
    backgroundColor: "rgba(255,255,255,0.03)"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  chip-category:
    backgroundColor: "rgba(255,255,255,0.05)"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.full}"
    padding: "6px 16px"
  chip-category-active:
    backgroundColor: "{colors.primary}"
    textColor: "#000000"
  card-video:
    backgroundColor: "transparent"
    rounded: "{rounded.md}"
    padding: "0"
---

# Design System: Home Theater

## 1. Overview

**Creative North Star: "The Private Cinema"**

Home Theater 的视觉系统像走进一间私人放映室：灯光熄灭，银幕亮起，所有装饰隐入黑暗，唯一的光来自内容本身和那一缕呼吸般的绿色。这不是仪表盘，也不是信息流；这是一个让人停下来、选一张海报、沉浸观看的空间。

系统极度克制。背景是绝对的黑色（`#000000`）， elevated 表面只比背景亮半步（`#0a0a0a`）。文字从纯白递减到深灰，像剧院里渐次暗下的观众席。唯一的色彩是绿色——不是霓虹绿，而是像放映机指示灯那样稳定、低饱和的呼吸绿（`#4ade80`），只在需要指引的地方出现。

界面语言是**精密仪器**的质感：直角、细边框、精确对齐。按钮和导航像设备面板上的开关，不是圆润可爱的糖果。玻璃效果（液态玻璃）用于需要浮出黑暗的控件，但它是有节制的，不是为了炫技。

**Key Characteristics:**
- 深黑底色，内容（海报/视频）是唯一主角
- 呼吸绿作为唯一强调色，极度克制
- 液态玻璃（backdrop-filter）替代传统阴影来表达层级
- 精密仪器般的直角组件，拒绝圆润装饰
- 动效缓慢而优雅，且必须响应 `prefers-reduced-motion`
- 移动端与桌面端是同一套视觉语言，只在密度和布局上调整

## 2. Colors

系统的调色板只有三个角色：**背景**、**文字**、**强调**。没有辅助色、没有渐变、没有装饰色。

### Primary
- **Breathing Green（呼吸绿）** (`#4ade80`): 唯一的强调色。用于 active 状态、进度条、分类 pill 的选中态、成功提示。它应该只出现在 ≤10% 的屏幕上；稀缺性就是它的力量。

### Neutral
- **Void Black（虚空黑）** (`#000000`): 页面主背景。让海报和视频在暗室中自己发光。
- **Elevated Black（微浮黑）** (`#0a0a0a`): 卡片、抽屉、 elevated 表面的背景。只比背景亮半步，避免明显的对比跳跃。
- **Projection White（投影白）** (`#ffffff`): 主标题和重要文字。在黑色上像银幕反光。
- **Silver Ash（银灰）** (`#a3a3a3`): 次要文字、描述、默认态的链接。
- **Dim Glow（暗光灰）** (`#525252`): 辅助文字、placeholder、禁用态、图标默认色。

### Functional
- **Warning Amber（琥珀黄）** (`#fbbf24`): 暂停、警告状态。
- **Danger Rose（蔷薇红）** (`#fb7185`): 删除、错误、危险操作。只在需要打断用户时出现。

### Named Rules
**The One Breath Rule.** 绿色只出现在用户需要被引导的地方。如果一片屏幕上绿色超过一处，说明你的视觉重点太多了。

**The Black Hole Rule.** 背景保持 `#000000`。不要让深灰、深蓝或任何其他暗色混入背景；任何非纯黑都会破坏暗室体验。

## 3. Typography

**Display Font:** Cinzel (with Noto Sans SC fallback)
**Body Font:** Noto Sans SC (with system sans-serif fallback)

Cinzel 是标题的点缀，只在少数地方出现（如品牌名、大标题），带来一种古典影院的庄重感。Noto Sans SC 承担所有正文和界面文字，清晰、中性、不抢戏。整体排版像电影字幕：低存在感，高可读性。

### Hierarchy
- **Display** (600 weight, clamp(1.5rem, 4vw, 3rem), line-height 1.1): 品牌标题、首屏大标题。Cinzel 字体，字间距略宽。
- **Headline** (500 weight, 18px, line-height 1.3): 区块标题、页面标题。Noto Sans SC。
- **Title** (500 weight, 16px, line-height 1.4): 卡片标题、视频名称。
- **Body** (400 weight, 14px, line-height 1.6): 描述、元信息、正文。最大行宽控制在 65–75ch。
- **Label** (500 weight, 12px, line-height 1.4, letter-spacing 0.04em): 按钮、导航、分类 pill、小标签。小写大写均可，保持清晰。

### Named Rules
**The Subtitle Rule.** 正文和说明文字永远用 `text-secondary` 或更暗的灰，不要用纯白写大段文字。纯白在黑色上只适合短暂出现的标题。

## 4. Elevation

系统**不使用传统阴影**来表达深度。在纯黑背景上，阴影会消失或显得脏。取而代之的是：

1. **色调分层**：`bg` → `bg-elevated` 的微小区分
2. **液态玻璃**：`backdrop-filter: blur(20px) saturate(1.2)` 让浮层从背景中轻微分离
3. **半透明边框**：`rgba(255,255,255,0.06)` 的细线勾勒边缘
4. **白色微光**：hover 时卡片边缘的 `rgba(255,255,255,0.08)` 光晕

### Glass Vocabulary
- **Navigation Glass** (`rgba(0,0,0,0.65)` + `blur(20px)`): 顶部导航、底部导航。
- **Toast Glass** (`rgba(0,0,0,0.65)` + `blur(16px)`): Toast 提示。
- **Dropdown Glass** (`#000000` + `blur(20px)`): 分类下拉菜单，需要更实心的背景以保证可读性。

### Named Rules
**The No-Shadow Rule.** 默认状态下不使用 `box-shadow`。只有当用户与元素交互（hover）时，才允许出现微妙的白色光晕。

**The Glass Is a Tool Rule.** 液态玻璃只用于需要浮在内容之上的控件（导航、toast、下拉），不要把它当作卡片的默认样式。

## 5. Components

### Buttons
- **Shape:** 小圆角（4px），细边框，直角气质。
- **Default:** 透明背景，`text-secondary`，1px `glass-border` 边框。hover 时边框变亮、文字变白。
- **Primary:** 透明背景，`primary` 文字，底部有一条 subtle 的绿色下划线。hover 时下划线变亮。没有填充背景，保持克制。
- **Danger:** 透明背景，`danger` 文字，`danger` 色调的边框。hover 时填充 `danger-dim`。
- **Disabled:** 透明度降至 0.3，cursor 为 not-allowed。
- **Focus:** 绿色 outline，outline-offset 2px。

### Chips / Category Pills
- **Style:** 完全圆角（100px），`rgba(255,255,255,0.05)` 背景，`text-muted` 文字。
- **Hover:** 背景略亮，文字变 `text-secondary`。
- **Active:** 填充 `primary`，文字变黑。这是绿色最集中的使用场景之一。

### Cards / Video Cards
- **Shape:** 4px 圆角，2:3 的 poster 比例。
- **Background:** 透明。卡片本身没有背景，海报就是内容。
- **Border:** poster 上方叠加 1px `rgba(255,255,255,0.05)` 内阴影边框，hover 时变亮。
- **Hover:** 整体 scale(1.05)，poster 边缘出现白色微光，标题变成绿色。
- **Overlay:** hover 时从底部上升的渐变遮罩，显示元信息和操作按钮。
- **Mobile:** 无 hover 覆盖层，点击时 scale(0.98) 反馈。

### Inputs / Fields
- **Style:** `rgba(255,255,255,0.03)` 背景，1px `glass-border` 边框，4px 圆角。
- **Text:** `text-primary`。
- **Placeholder:** `text-muted`。
- **Focus:** 边框变亮为 `rgba(255,255,255,0.2)`，无 outline（避免双重 focus 环）。

### Navigation
- **Top Nav:** 粘性顶部，液态玻璃，`glass-border` 底边，内部带 subtle 的横向渐变线。
- **Bottom Nav:** 移动端固定底部，液态玻璃，`glass-border` 顶边，图标 + 文字垂直排列。
- **Nav Link:** 默认 `text-muted`，hover `text-secondary`，active `text-primary`。
- **Active Indicator:** 底部 2px 绿色短线，带 `primary-glow` 光晕。

### Signature Component: Video Player Shell
- 播放器容器为纯黑背景，4px 圆角，1px 白色微边框。
- 桌面端右侧为选集侧边栏；移动端侧边栏变为底部抽屉或独立页面。
- 全屏时去除所有圆角和 chrome，让视频充满屏幕。

## 6. Do's and Don'ts

### Do:
- **Do** 使用 `#000000` 作为任何全屏或沉浸式页面的背景。
- **Do** 使用 `text-secondary` 写说明文字，保持纯白只用于最重要的标题。
- **Do** 用 `primary` 绿来指示 active 状态、进度、成功——但只在必要处。
- **Do** 用液态玻璃（`backdrop-filter: blur(20px)`）处理浮层控件。
- **Do** 保持 4px 的小圆角一致性，除非是大面积底部抽屉（16px）。
- **Do** 为所有动画提供 `prefers-reduced-motion` 降级。
- **Do** 确保文字对比度 ≥ 4.5:1（`text-muted` 在 `#000000` 上约为 5.6:1，已满足）。

### Don't:
- **Don't** 使用大投影（`box-shadow`）作为默认 elevation 手段。阴影在纯黑上会失效或显脏。
- **Don't** 引入除绿色以外的强调色。黄色和红色只用于功能状态，不能作为装饰。
- **Don't** 让绿色超过屏幕的 10%。稀缺性是它的力量。
- **Don't** 使用渐变文字（`background-clip: text`）。这是 AI 设计的常见痕迹。
- **Don't** 让文字溢出容器或忽略移动端触摸目标（最小 44px）。
- **Don't** 把这套 UI 做得像传统 CMS/管理后台（密密麻麻的表单、表格、按钮）。这不是管理工具，是观影入口。
- **Don't** 使用短视频信息流的无限滚动和密集信息架构。用户来这里是为了静下来选片，不是为了刷。
