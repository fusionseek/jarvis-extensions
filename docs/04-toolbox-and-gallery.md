# 工具箱接入、「添加扩展」与扩展库页面

## Overview

用户与扩展打交道的三个地方：工具箱目录里**多出来的行**、目录末尾那枚**虚化的加号**、
点加号进去的**扩展库页面**。三者全在 400×520 那块面板里，header 由容器画，
内容遵守 [08 · 设计体系](08-design-system.md)。

设计源：Figma `hZeo5Kw9MxiE48AiOeRz1H` 页面 `9:78`，新板 `jarvis-extension-gallery`
（状态帧 `gallery-01-list` / `gallery-02-detail` / `gallery-03-empty` / `gallery-04-offline`）
与 `toolbox-03-add-extension`；节点号在实现后回填到 [14](14-host-integration-plan.md)。
每张面板帧恒为 400×520。

## Concepts

### 目录的三段：内置 · 扩展 · 加号

```text
调色板 / 粘贴板 / Base64 / 哈希生成 / 正则测试 / URL 解析 / JSON 格式化 / 时间转换
APK 扫描 / 数据导出 / 截图与标注 / 快传            ← 内置，顺序不变
发到手机 / 占位文本 / …                              ← 已安装且启用的扩展，按安装先后
＋ 添加扩展                                          ← 虚化的加号，恒在末尾
```

**扩展一律排在内置工具之后**，按 `installed_at` 升序。不插进内置工具中间：那份清单是被人排过的，
一行扩展插进"把手上这段东西换个样子看"那八行里会让层次读不出来（与 APK / 数据导出排队尾同一条理由）。
v1 不做用户拖动排序——排序是一个独立的 feature，且要连快捷环一起想。

目录的合并是 `Domain` 的纯函数：

```swift
/// 工具箱此刻要画的目录：内置 + 已装且启用的扩展 + 末尾的加号。
enum ExtensionCatalogPolicy {
    static func items(builtIn: [JarvisToolboxItem], installed: [InstalledExtension]) -> [JarvisToolboxItem]
}
```

扩展行的 `JarvisToolboxItem`：`id = "extension:<id>"`、`symbolName = toolbox.symbol`、
`title = toolbox.name`、`subtitle = toolbox.subtitle`、`keywords = toolbox.keywords`。
带 `extension:` 前缀是为了与内置行 id 隔开命名空间——同 `UnreadItemKey` 那条理由：
一个恰好叫 `json` 的扩展不能与内置 JSON 格式化撞成同一行。

路由表 `FloatingToolboxRoutingPolicy.row(for:)` 多一支：`extension:<id>` →
`.content(.extension)` 并由调用方设置 `activeExtensionID`。加号不是目录项，
它是 `FloatingToolboxView` 里目录之后的一个**尾随构件**（`galleryAffordance`），
点它 `onOpen(.extensionGallery)`。

**搜索**：扩展行照常参与（标题 / 说明 / 别名，与内置行同一条 `FloatingToolboxSearchPolicy`）。
**加号不参与**：它不是一件工具；搜索态不画它，`↑↓` 的线性序列里也没有它。空态那一屏的提示句
改成「搜索会同时看标题、说明和英文名。试试 JSON、时间 或 APK；没有的话去扩展库找找」，
末尾「扩展库」是一颗 link 按钮。

**禁用的扩展不在目录里**，也不在搜索里：一行点下去进错误屏的东西比没有更糟。它只留在设置页。

### 那枚虚化的加号

用户的原话：「最后一个功能后面需要有一个虚化的图标，表示添加扩展」。

| 排布 | 形态 | 值 | 为什么 |
| --- | --- | --- | --- |
| 列表 | 与工具行同高同内距的一行：图标井 32pt / 圆角 8 **虚线**描边 `[4,3]`、白 30%，井里 `plus` 16pt；标题「添加扩展」13pt semibold、说明「浏览扩展库，装到工具箱」11pt；行末**无**记号 | 整行不透明度 **0.55**，悬停 1.0 | 虚线是"一处留白的入口"的通行记号（哈希生成的拖拽框、URL 解析的「添加参数」都是它）；0.55 让它退到目录之后，读作"这里还能长"，而不是第十三件工具 |
| 宫格 | 86×86 一格：图标井 36pt 虚线同上，`plus` 17pt；标题「添加扩展」11pt | 同上 | 与格子等大等距，网格不因它错位 |
| 悬停 | 沿用 `controlFocusHighlight`；不透明度升到 1.0；虚线不变 | `Motion.feedback` 0.16s | 它是可点的，光的语言与别的行相同；虚线保留是因为它**仍然**不是一件工具 |
| 搜索态 | 不画 | — | 见上 |
| VoiceOver | 「添加扩展，打开扩展库」，`.isButton` | — | 不透明度是视觉层级，不是信息 |

**它不是目录项、不进 `JarvisToolboxCatalog.items`**：`FloatingToolboxSearchPolicy.summary` 报的
「共 N 个工具」不该把它数进去，`ToolboxSearchTests` 那些逐条钉目录的断言也不该为它改。

tokens：`JarvisDesign.Toolbox.AddExtension`（`dash: [4, 3]`、`strokeOpacity: 0.30`、
`restingOpacity: 0.55`、`glyphSize` 与井尺寸引用 `IconWell` / `Grid`，不另写数）。

### 扩展库页面

内容模式 `FloatingPanelContentMode.extensionGallery`，主线 `.toolbox`。header：徽标 = 26pt 青色方片 +
`puzzlepiece.extension` 11pt，标题「扩展库」，工具箱那颗按钮读作「返回工具箱」——与进入任何工具
逐字相同。内容区 400×457，内边距 16。

```text
┌ header ─────────────────────────────────────────┐
│ [拼图] 扩展库                 消息 记 常 工 设   │
├─────────────────────────────────────────────────┤
│ ● 上次同步 12:30 · fusionseek/jarvis-extensions   [刷新] │  ← 状态条 32pt
│ ┌─────────────────────────────────────────────┐ │
│ │ [井] 发到手机                    [安装]    │ │  ← 卡片
│ │      把剪贴板里的东西推到手机…              │ │
│ │      v1.0.0 · fusionseek · 4 项能力         │ │
│ ├─────────────────────────────────────────────┤ │
│ │ [井] 占位文本                    [已安装 · 打开] │
│ │      …                                      │ │
│ └─────────────────────────────────────────────┘ │
│ 扩展来自公开仓库，安装前会请你逐项授权。      │  ← 脚注
└─────────────────────────────────────────────────┘
```

| 元素 | 规格 | 为什么 |
| --- | --- | --- |
| 状态条 | 32pt 高，左：5pt 状态点 + 11pt `footnoteText`「上次同步 HH:mm」+ 仓库名（`endpoint` 色等宽 10.5pt）；右：「刷新」22pt 行内 chip | 与快传收起态那条 topbar 同一种语言：一行答出"数据是什么时候的、从哪来"。刷新中状态点换成转圈（Reduce Motion 下换文字「同步中…」） |
| 卡片 | 圆角 12、白 3% 底 / 白 7% 边、内距 12、卡距 6；图标井 32pt（与工具箱行同一枚）；名 13pt semibold `rowTitle`、描述 11pt `bodyText` 2 行尾截断、元信息行 10pt `footnoteText`；右端一颗 22pt 行内动作 | 借工具箱行与粘贴板行的构造，不新造卡片 |
| 元信息行 | `v1.0.0 · 作者 · N 项能力`；N = 0 时写「不需要授权」 | "需要几项能力"是用户装之前最该知道的一件事，与版本并列 |
| 动作 | 未装：「安装」主 chip；已装：「已安装 · 打开」次 chip；有新版本：「更新到 x.y.z」主 chip；不兼容：chip 失效但不隐藏 + 卡片脚注写原因 | 失效不隐藏：隐藏会让用户以为扩展库少了一个 |
| 点卡片本体 | 进入卡片的**详情态**（同一内容模式内的第二屏，不是新 case）：完整描述、能力逐条（图标 + 名称 + `reason` + 档位标签）、偏好项摘要、「查看源码」link、安装 / 打开 / 更新 / 卸载 | 判据同正则的铁路图：做成 case 会在返回时重建列表、丢掉滚动位置 |
| 空态（仓库为空） | `Toolbox.Empty` 那一屏：`puzzlepiece.extension` 井 + 「扩展库还是空的」+ 「第一个扩展可以是你写的：README 里有脚手架」 | 一块什么都没有的面板分不清是没内容还是坏了 |
| 离线且无缓存 | 同一屏：`wifi.slash` + 「还没同步过扩展库」+ 「需要连一次网把扩展列表拉下来」+ 「重试」 | 三种"空"各说各的话 |
| 离线但有缓存 | 照常画缓存那一份，状态条写「上次同步 昨天 18:02 · 离线」，状态点 `footnoteText` 灰 | 旧列表比空白有用，但要说清它旧 |
| 快照解析失败 | 状态条 `alert` 橙：「最新快照无法解析，显示的是上一份」 | 不猜、不部分采用 |

**安装是一次动作，不是一个流程。** 点「安装」：校验哈希 → 拷贝 → 写库 → 卡片当场变「已安装 · 打开」，
目录多一行。**不弹授权弹窗**：授权发生在**第一次进入**扩展时（用户的要求是"在第一次进入时发起授权"），
不在安装时——装了没用过的扩展不该拿着任何能力。

### 扩展页面（宿主视图）

内容模式 `.extension` + `AppModel.activeExtensionID`。header：徽标 = 26pt 青色方片 + `toolbox.symbol` 11pt，
标题 = `toolbox.name`，工具箱那颗按钮「返回工具箱」。header 第二行照旧是 Server 状态（容器的一部分，
扩展改不了）。

内容区交给 `ExtensionRenderer`。**四个宿主态**扩展碰不到，由 `FloatingExtensionHostView` 画：

| 态 | 屏幕 |
| --- | --- |
| 加载中（第一次 `evaluateScript` 与 `activate` 未返回） | 空白 + 220ms 后才出现的转圈（一次普通加载 60–120ms，第 0 帧就转会每次闪一下） |
| 授权未决 | 弹窗盖在面板上（见 [05](05-permissions.md)），面板内容为加载中态 |
| 错误 | 一张 `danger` 语义 `note`：标题「这个扩展出了问题」、正文 = 异常一句话、动作「重新加载」「查看日志」（开发者模式）「去扩展库」 |
| 不兼容 | 一张 `alert` 语义 `note`：「需要 Jarvis ≥ 1.6.0」/「需要 SDK 2」+ 「检查更新」 |

面板尺寸门禁照旧：扩展的内容装不下时**滚动**（根节点用 `ui.scroll`），面板不长。

### 记忆与快捷环

- `FloatingPanelSectionMemory` 的工具箱那一格记 `(mode, extensionID?)`：离开时停在某个扩展里，
  下次没有未读展开就落回那个扩展——与内置工具逐字同一条规则。扩展被禁用或卸载后记忆回落工具箱首页。
- 快捷环：`OrbShortcutKind.panelContent("extension:<id>")`。加号球的菜单里，扩展列在内置工具之后，
  与目录同序；扩展被卸载后那颗球按既有的"失效项"规则显示并 tooltip 写原因。

## Usage

1. 工具箱滚到底，点那枚虚化的加号 → 扩展库。
2. 看卡片；点本体看详情与它要哪几项能力；点「安装」。
3. 返回工具箱，目录末尾多了一行；点它 → 第一次进入弹授权 → 允许 → 扩展页面。
4. 想拿掉：设置 › 扩展 › 该扩展 › 「卸载」。

## Gotchas

- 目录里的扩展行**只在启用时存在**；禁用是设置页的事，扩展库不管。
- 「共 N 个工具」的计数包含扩展行、不包含加号。
- 扩展库与扩展页面属于工具箱主线，因此 header 上工具箱那颗按钮在这两屏上读作「返回工具箱」，
  点亮态与在任何工具里相同。

## Related Links

- [02 · 框架层级设计](02-architecture.md)（快照、安装记录）
- [05 · 能力授权模型](05-permissions.md)
- [08 · 设计体系](08-design-system.md)
- `jarvis-mac/Sources/Jarvis/UI/FloatingToolboxView.swift`、`FloatingPanelContentMode.swift`
