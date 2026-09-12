# 设计体系（扩展版）

## Overview

扩展**没有自己的设计体系**。它画在与内置工具同一块 400×520 的霓虹玻璃面板里，用同一份
`JarvisDesign` tokens、同一个字体出口、同一套语义色与同一圈悬停光。这份文档是
`jarvis-mac/docs/uiux/floating-status/design-system.md` 面向扩展开发者的**投影**：
只列扩展会碰到的那一部分，并把"哪些你能选、哪些你碰不到"说清楚。

真源仍在 `jarvis-mac`：`Sources/Jarvis/UI/DesignTokens.swift`（`enum JarvisDesign`）与
Figma `hZeo5Kw9MxiE48AiOeRz1H` 页面 `9:78`。两处冲突时以代码为准——**代码是源，稿是镜像**。

## 你能选的与你碰不到的

| 你能选的（语义） | 你碰不到的（容器） |
| --- | --- |
| 段落怎么分、每段叫什么 | 面板尺寸 400×520、圆角 20、材质、那圈 16 秒绕行的彩虹边 |
| 30 种节点里用哪几种、怎么排 | header：徽标、标题、Server 状态行、右端五颗按钮 |
| 八档语义色 `Tint` 里用哪一档 | 任何颜色值、任何像素尺寸、任何字体 |
| 主按钮放哪一颗、哪些动作要两步确认 | 悬停光、选中光、聚焦态、Reduce Motion / Transparency / Contrast 的适配 |
| 文案（中文优先）、SF Symbol 名 | 15 秒自动收回、面板外点击收回、切走应用收回 |
| 空态 / 拒绝态 / 错误态各说什么 | 收放动画、拖动把手、贴边 |

"自定义样式"在这个平台的含义是**在语义里做选择**，不是在像素里做选择。

## 面板解剖

```text
<frame 400×520 "jarvis-ext-<id>">
  specular-highlight        2,2   396×24   顶部镜面高光（容器）
  panel-header              0,0   400×62   header（容器）
    header-badge            16,18 26×26    青色方片 + toolbox.symbol 11pt
    header-text             54,14          toolbox.name 15pt SemiBold / Server 状态 11pt
    actions                 …,18  26pt/颗  消息 · 速记⇄日历 · 常驻 · 工具箱 · 设置
  header-divider            12,62 376×1
  content                   0,63  400×457  ← 扩展的节点树画在这里
    padding 16 → 可用 368×425
```

- header 高 62 是**写死**的，装什么内容都不改变它；内容装不下的正解是根节点用 `scroll`。
- 内容区内边距 16（`Spacing.large`）由宿主加；节点树从 `(16, 79)` 开始画。
- header 留给标题的宽度 144pt：`toolbox.name` ≤ 6 个汉字两处都不截，12 是硬上限。

## Tokens

### 间距与圆角

| Token | 值 | 扩展里对应 |
| --- | --- | --- |
| `Spacing.xSmall` | 4 | 图标与文字的微间距（宿主内部） |
| `Spacing.small` | 8 | 控件间距（宿主内部） |
| `Spacing.medium` | 12 | 行内距 |
| `Spacing.large` | 16 | 内容区内边距 |
| 工具段间距 | 14 | `stack.spacing: "loose"` |
| 工具段内距 | 10 | `"regular"` |
| 清单行距 | 6 | `"tight"` |
| `Radius.panel` | 20 continuous | 容器 |
| `PanelChrome.cardRadius` | 12 | `card` / `note` / `row` |
| 行内控件圆角 | 6 / 8 | chip / 输入框 |

### 色板

面板锁定深色外观，**不跟随系统明暗**。所有色都按 `#0B0B14` 的底配平；扩展看不到浅色版，
因为不存在浅色版。

| 名 | 值 | 用在 |
| --- | --- | --- |
| `titleText` | `#FFFFFF` | header 标题、`readout` |
| `rowTitle` | `#F2F5F7` | 行标题、`title` |
| `bodyText` | `#9CA3AF` | 正文、段标题 |
| `subtleText` | `#8C919E` | 说明 |
| `footnoteText` | `#6B7280` | 脚注、时刻、失效态 |
| `accent` | `#00D4FF` | 已接通、主动作、选中 |
| `primaryText` | `#7FE9FF` | 压在 accent 底上的文字（比 accent 更亮才够读） |
| `endpoint` | `rgba(0,184,235,0.7)` | 等宽的参数行（它是参数不是状态） |
| `live` | `rgba(46,204,115,0.8)` | 运行中 / 成功 |
| `alert` | `#FF6B2C` | 需要你做点什么 / 警告 |
| `danger` | `#FF4D5E` | 失败 / 破坏性动作 |
| `violet` | `#8B5CF6` | 第二方向 / 建议 |
| `blue` | `#4D99F7` | 第三类信息 |
| `amber` | `#F7AD1A` | 瞬态提示 |
| 报错色 | `#FF5C4F` | `editor.error` / `result.error`（宿主用，扩展不选） |

**系统语义色（`.blue` / `.green` / `.secondary`）一个都不许用**：它们按会随明暗翻转的窗口底调，
压在这块玻璃上发荧光或糊进背景。扩展本来也选不到它们——`Tint` 里没有。

### 字阶

扩展页面用**工具那一档**（它是"打开、看一眼、抄走就关"的内容，不是 Inbox 那种反复扫的）：

| 位置 | 字号 / 字重 |
| --- | --- |
| 段标题 | 10 bold、字距 1、大写英文副标（`输入 · INPUT`） |
| 行标题 / `title` | 13 semibold |
| 正文 / `body` | 12 regular |
| 说明 / `subtle` | 11 regular |
| 时刻 / 脚注 / `footnote` | 10 regular |
| 读数 / `readout` | 13 等宽 semibold |
| 代码 / `mono` | 11–12 等宽 |

全部经 `Font.jarvis(size:weight:)`：用户可以分别选拉丁与汉字两个 family，按 x-height 光学对齐字号。
等宽字走系统等宽——它是读数，不跟用户挑的字体走。**扩展没有字号选项**，只有档位。

### 材质与深度

| 层 | 值 |
| --- | --- |
| 面板底 | `rgba(18,18,32,0.88)`；Reduce Transparency 下不透明 `#0B0B14` |
| 轮廓 | 1.5pt 彩虹闭环（白 → 蓝 → 青 → 紫 → 琥珀 → 白），绕轮廓 16s 一周 |
| 卡片 | 面板底 55% + 白 8% 边，圆角 12；带语义色时 tint 10% 底 / 16% 边 |
| 输入控件 | 白 3% 底 / 白 7–8% 边 |
| 输出框 | 黑 20% 底（比输入更沉，读成"输出"） |
| 控件玻璃底 | 白 6% |

**同一条轮廓上只允许存在一条边。** 扩展的节点不带自己的边——`card` 的边由宿主画，`row` 常态没有边。

### 动效

| 场景 | 动效 | Reduce Motion |
| --- | --- | --- |
| 节点增删 / 内容切换 | `Motion.feedback` 0.16s ease-out 淡入淡出 | `reducedPanel` 0.12s |
| 悬停光进出 | 0.12s ease-out | 0.08s |
| 悬停光绕行 | 4s 一周 | 停转，保留色带 |
| 两步确认复原 | 4s 后直接换回 | 同 |
| 转圈 | `ProgressView` 缩到 0.6 | 换成文字 |

动效**只用于解释状态变化**，不用于装饰。扩展没有动画 API。

## 一屏工具的构造规则

来自内置工具的共同教训，宿主已经在节点里做了一半，另一半靠扩展的判断：

1. **段标题行三合一**：标题 + 读数 + 动作同处一行。独占一行的 chip 与读数是排版稿上的对称，
   不是使用中的对称。
2. **一块面板上只有一颗实心 accent 按钮**——这一段唯一的主动作。第二颗用 `secondary` 或 `link`。
3. **两选一只有一种长相**：`segmented compact`。同一块玻璃上不许一处分段、一处开关地表达同一件事。
4. **失效不隐藏**：位置固定的入口才形成得了肌肉记忆；忽隐忽现会让底栏在最后一条被删掉的瞬间跳一下版。
5. **破坏性动作就地两步确认**（`button.confirm`），不弹 modal：面板 15 秒会自动收回，modal 会被截断。
6. **空输入不出结果**：`md5("")` 当然算得出来，但摆在一块还没输入任何东西的面板上读起来是"它已经算了什么"。
7. **坏了就说坏了**：pattern 无效就写「格式无效」并让复制钮失效，绝不静默退回一个看起来正常的假结果。
8. **状态不能只靠颜色**：每个状态同时有符号或文字。色觉障碍用户读不到颜色，VoiceOver 读不到颜色。
9. **每一屏答得出「我在哪、能做什么」**：拒绝态、离线态、空态各自一屏说明，不是一句红字。
10. **中文优先**：界面文案中文；英文名进 `keywords`；段标题的英文副标是装饰不是翻译。

## 无障碍（宿主替你做的，与你要配合的）

| 项 | 宿主 | 扩展 |
| --- | --- | --- |
| Reduce Motion | 光停转、淡入淡出缩短、转圈换文字 | `environment.reduceMotion` 为真时别每秒刷新一次动态文案 |
| Reduce Transparency | 材质换实底 | — |
| Increase Contrast | 边 1 → 1.5pt、光晕拉满 | — |
| VoiceOver | 行合并成一个元素、装饰层隐藏、图标按钮读 `label` | 给每个 `iconButton` / 带 `symbol` 的动作写 `label` / `help`；`field` / `editor` 写 `label` |
| 键盘 | Tab 遍历输入框、空格触发按钮、Esc 收面板 | 任何只靠悬停才出现的东西（`hoverCard`）必须有一条键盘路径能到同样的信息 |

## Figma

扩展的设计稿画在 `9:78` 页面上，命名 `jarvis-ext-<id>`，内部状态帧 `<id>-NN-<state>`
（例：`send-to-phone-01-idle`、`send-to-phone-02-sent`、`send-to-phone-03-denied`）。
每张面板帧恒为 **400×520**，header 与 62pt 那条线照抄容器，只画内容区。

出稿只是为了审核时对齐意图，**不是必需的**：节点目录本身已经限定了所有能画出来的东西。
从稿子抄数值的人是宿主的开发者，不是扩展的开发者——扩展里没有数值可抄。

## Gotchas

- 稿子上画了一种目录里没有的控件，正确的路是给 [07](07-ui-components.md) 提 PR，不是在扩展里拼。
- 面板 15 秒会自动收回；在你的 `render()` 里没有任何办法阻止它，只有 `panel.hold` 与输入框焦点。
- 不要把段标题当标题用：它是 10pt 的 eyebrow，跟着正文涨会让它开始跟自己统辖的那些行抢注意力。

## Related Links

- [07 · UI 组件目录](07-ui-components.md)
- [09 · 鼠标感知系统](09-pointer-awareness.md)
- `jarvis-mac/docs/uiux/floating-status/design-system.md`（全文）、`jarvis-mac/CLAUDE.md`（Figma ↔ 代码规则）
