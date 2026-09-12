# Jarvis 开放平台 · 总览

## Overview

Jarvis 的工具箱今天装着十二件事：调色板、粘贴板、Base64、哈希、正则、URL、JSON、时间转换、
APK 扫描、数据导出、截图与标注、快传。它们全部是 Swift 写进 `jarvis-mac` 的**内置工具**，
加一件要走一次 Speckit、改四处 `switch`、发一版应用。

开放平台把「加一件工具」这件事交给应用之外的人：开发者在本仓库（`fusionseek/jarvis-extensions`）
里写一个**扩展**，合并进主干；Jarvis 的工具箱末尾那枚虚化的加号点进去就是**扩展库**，
装上之后它就是工具箱里的一行，点开就是 400×520 那块面板里的一屏——与内置工具**同一套 header、
同一套字阶、同一套色板、同一圈悬停时流动的炫彩光**，用户分不出哪一行是原生的。

这份文档回答的是**为什么**与**边界**。怎么做见后面十三篇。

## 开发者要回答的四件事

一个扩展就是一份 `extension.json` 加一个 JS bundle。manifest 里**四个部分必须显式回答**，
没有默认值——`settings: false` 与 `inbox: false` 都要写出来，因为「没想过」与「想过了，不要」
在审核时是两件事：

| # | 部分 | manifest 字段 | 用户在哪里看到 |
| --- | --- | --- | --- |
| 一 | 工具箱里的图标与名字 | `toolbox.symbol` / `toolbox.name` / `toolbox.subtitle` | 工具箱列表与宫格的那一行 / 那一格，扩展页面 header 的徽标与标题 |
| 二 | 点进去之后的功能，以及它要用到宿主的哪些能力 | `main` + `capabilities[]` | 面板里那一屏；第一次进入时的**统一授权弹窗** |
| 三 | 要不要出现在设置页 | `settings: false \| { preferences }` | 设置页「扩展」区段里属于它的那块玻璃面板 |
| 四 | 要不要往 Inbox 投递 | `inbox: false \| { cards, notifications }` | Inbox 顶部那一段的卡片，以及系统横幅 |

第二部分里的授权是这个平台与「在 App 里加一个工具」最大的差别：内置工具是 Jarvis 自己的一部分，
用户装 Jarvis 时就把权限给了它；扩展是别人写的，**它能碰到的每一项宿主能力都要用户点一次头**。
用户点头之前，扩展调用那项能力得到的是一个结构化的拒绝，不是弹窗、不是崩溃。

## 为什么是这条运行时路线

扩展的代码**跑在宿主进程里的 JavaScriptCore**（macOS 自带的系统框架，零第三方依赖），
**界面是一棵声明式节点树，由宿主用 SwiftUI 画出来**。扩展不画像素：它说「这里一段、一行输入框、
一颗主按钮」，宿主用内置工具用的那几份 tokens 与那几个视图把它画出来。

这是在四条路里挑出来的一条，另外三条各有一处走不通：

| 路线 | 走不通的地方 |
| --- | --- |
| **Swift 源码编进宿主** | 与"从 git 仓库罗列、点一下装上"直接冲突：装一个扩展等于发一版 Jarvis。它保留为内置工具的做法，不是扩展的做法 |
| **动态加载原生 `.bundle`** | 把陌生的原生代码 `dlopen` 进一个常驻、拿着屏幕录制与辅助功能权限的进程，签名、公证、ABI 冻结每一样都是独立工程；且一旦崩溃带走的是整个 Jarvis |
| **WKWebView 里跑 HTML** | 与仓库最硬的两条设计约束冲突——「用 SF Symbols、不复制 Web 组件外观」「全应用唯一字体出口 `Font.jarvis`」。网页画不出 SF Symbols，`controlFocusHighlight` 那圈光也只能用 CSS 再仿一份，而仿的那一份必然漂 |
| **JS 逻辑 + 声明式原生 UI（选定）** | 代价是组件目录是**封闭**的：扩展只能用宿主提供的 30 种节点。这正是「风格统一、交互一致」这条要求的代价，而不是缺陷 |

Raycast 的扩展走的就是这条路（TypeScript 逻辑 + 原生渲染的组件目录 + 一个 GitHub 仓库当商店），
它证明了这条路撑得起一个真实的生态。

## 平台的五条原则

它们全部继承自 `jarvis-mac` 的既有约束，不是本平台新造的：

1. **面板是容器，内容才是模式。** 扩展只是又一块内容。窗口几何、收放动画、四条收回路径、
   15 秒倒计时、header 骨架在扩展页面上与内置工具**完全相同**；扩展一个字都碰不到它们。
2. **同一条轮廓上只允许存在一条边。** 扩展不能自带底色、圆角、描边或投影；它能选的只有语义
   （`tint` / `variant` / `style`）。两块内容各画各的边，切过去的那一下就会看见它跳一下。
3. **可点的东西自己会亮。** 每一颗可交互节点由宿主自动挂 `controlFocusHighlight`；
   失效的控件一律不亮，亮起来等于承诺"点我有反应"。扩展不能画自己的悬停态。
4. **没有点头就没有能力。** 能力闸门在宿主侧、每一次调用都过；扩展拿不到别的扩展的数据，
   也拿不到用户没同意的东西。系统权限（屏幕录制、辅助功能）是 Jarvis 的，扩展只能借用，
   借不到时得到的是 `permission.unavailable`。
5. **结构化数据只有一个库。** 扩展的安装记录、授权、偏好、文档、Inbox 卡片全部进
   `jarvis.sqlite3`，每张表有保留策略；扩展自己没有文件系统。

## 不做什么

- **不做第二种运行时。** 没有 Swift 扩展、没有 WebView 扩展。内置工具继续是 Swift，
  它们是组件目录的参考实现，不是扩展。
- **不做应用内商店的账号、评分、付费。** 扩展库就是这个仓库的一份快照，上架靠 PR 审核。
- **不做任意命令执行。** `terminal.run` 一类能力不在 v1；`net.fetch` 只放行 manifest 白名单里的
  HTTPS 主机。
- **不做自定义像素。** 没有颜色值、没有像素尺寸、没有字体选择。想要一种新控件，正确的路是
  给组件目录提 PR，而不是在扩展里画一个。
- **不改既有 WebSocket ingress 的任何一条 schema。** 扩展与 CLI 投递互不知道对方存在。

## 术语

| 词 | 含义 |
| --- | --- |
| 宿主 | `jarvis-mac` 里承载扩展的那一层：`Sources/Jarvis/Extensions/`（运行时、渲染器、能力闸门、扩展库、安装记录） |
| 扩展 | `extensions/<id>/` 一个目录：`extension.json` + `dist/extension.js` + 源码与 README |
| 扩展库 | 面板里的一屏（`FloatingPanelContentMode.extensionGallery`），罗列本仓库快照里的全部扩展 |
| 快照 | 宿主从 GitHub 拉下来、解开放在本机缓存目录里的一份仓库归档；`registry.json` 与各扩展的产物都从这里读 |
| 能力 | `jarvis.*` 上一个需要用户点头的命名空间（`clipboard.read` …）；隐式能力不需要点头 |
| 授权弹窗 | 第一次进入扩展时宿主弹的那一扇，逐条列出 manifest 声明的能力 |
| 节点树 | `render()` 返回的那棵 `UINode`；宿主按 `key` diff 后用 SwiftUI 渲染 |

## 仓库地图

```text
jarvis-extensions/
├── README.md                  开发者第一入口
├── AGENTS.md                  本仓库的规范与门禁
├── registry.json              扩展库索引（生成物，宿主只读它）
├── docs/                      本套文档
├── schemas/                   manifest 与 registry 的 JSON Schema（真源）
├── sdk/                       @fusionseek/jarvis-extension-sdk
├── templates/hello-extension/ 脚手架
├── scripts/                   校验与生成 registry
└── extensions/<id>/           每个扩展一个目录
```

## Related Links

- [02 · 框架层级设计](02-architecture.md)
- [03 · manifest 规范](03-manifest.md)
- [12 · 开发手册](12-developer-guide.md)
- [14 · jarvis-mac 侧实施方案](14-host-integration-plan.md)
- 设计与治理真源：`jarvis-mac/AGENTS.md`、`jarvis-mac/CLAUDE.md`、
  `jarvis-mac/docs/uiux/floating-status/design-system.md`
