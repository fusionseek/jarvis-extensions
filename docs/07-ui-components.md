# UI 组件目录（声明式节点 → 宿主实现）

## Overview

扩展的 `render()` 返回一棵 `UINode`；宿主的 `ExtensionRenderer` 把每种 `kind` 画成一个 SwiftUI 视图。
**每个节点视图只读 `JarvisDesign`**，并且逐项对应到某一块内置工具已经在用的构造——
这张目录的每一行都能在 `jarvis-mac` 里指出"它就是那个东西"。

因此扩展里没有颜色值、没有像素、没有字体：能选的只有语义。语义色 `Tint` 八档、文字 `TextStyle` 七档、
按钮两档尺寸——它们就是这块面板上已经存在的全部选项。

类型真源：[`sdk/src/ui.ts`](../sdk/src/ui.ts)。

## 语义表

### `Tint`

| 值 | 色 | 来源 | 语义 |
| --- | --- | --- | --- |
| `accent` | `#00D4FF` | `SettingsChrome.Palette.accent` | 已接通 / 主动作 / 选中 |
| `live` | `rgba(46,204,115,0.8)` | `Palette.live` | 运行中 / 成功 |
| `alert` | `#FF6B2C` | `Palette.alert` | 需要你做点什么 / 警告 |
| `danger` | `#FF4D5E` | `PanelChrome.danger` | 失败 / 破坏性动作 |
| `violet` | `#8B5CF6` | 建议徽标 / 球体渐变 | 第二方向（解码 / 压缩）/ 建议 |
| `blue` | `#4D99F7` | `JSONFormatter.Syntax.literal` | 第三类信息 |
| `amber` | `#F7AD1A` | `JSONFormatter.Syntax.string` | 瞬态提示 / 量词 |
| `neutral` | `#6B7280` | `Palette.footnoteText` | 次要 / 不可用 |

### `TextStyle`

| 值 | 字号 / 字重 / 色 | 来源 |
| --- | --- | --- |
| `sectionTitle` | 10pt bold、字距 1、`bodyText`，大写英文副标 | 快传 / 时间转换器的段标题 |
| `title` | 13pt semibold `rowTitle` | `Toolbox.titleSize` |
| `body` | 12pt regular `bodyText` | 工具正文 |
| `subtle` | 11pt regular `subtleText` | 说明 |
| `footnote` | 10pt regular `footnoteText` | 时刻、脚注 |
| `mono` | 11pt 等宽 semibold `titleText` | 读数、代码 |
| `readout` | 13pt 等宽 semibold 白 | 时间转换器读数 |

所有文字走 `Font.jarvis(size:weight:)`；`mono` / `readout` 走 `.system(design: .monospaced)`——
与内置工具一致：等宽字不跟用户挑的字体走。

## 节点目录

每一行：节点 → 宿主视图 → 借的是哪一处 tokens → 交互与无障碍规则。

### 布局

| 节点 | 宿主实现 | tokens | 规则 |
| --- | --- | --- | --- |
| `stack` | `VStack` / `HStack` | `spacing`: none 0 / tight 6 / regular 10 / loose 14 | `loose` 是段与段（工具面板的 14pt），`regular` 段内，`tight` 清单行距 |
| `scroll` | `ScrollView` + `.scrollBounceBehavior(.basedOnSize)`，内边距 16 | `Spacing.large` | **只允许在根上**；装得下时不回弹。根不是 `scroll` 时内容溢出会被裁剪并记警告 |
| `section` | 段标题行 + 内容 | 标题 `sectionTitle`；`trailing` 10pt 等宽 `footnoteText`；`actions` 22pt 行内动作 | 标题、读数与动作**同处一行**（Base64 那条：那两行 chip 占掉的 60pt 正是两块框缺的） |
| `hairline` | `SettingsHairline` | 白 8.2% / 1pt | 通栏 |
| `spacer` | `Spacer(minLength: 0)` | — | 只在 `stack` 里有意义 |

### 文字与读数

| 节点 | 宿主实现 | tokens | 规则 |
| --- | --- | --- | --- |
| `text` | `Text` | `TextStyle` 表 | `lines` 尾截断；`selectable` 开 `.textSelection(.enabled)`；单条 ≤ 20 000 字符 |
| `readout` | 带左侧 3pt 竖条的读数行，右端复制钮 | `TimeConverter.Readout`：行高 48、圆角 8、白 3% 底 / 白 8% 边、caption 10pt bold、读数 13pt 等宽 | `tint` 决定竖条色；四行以内的读数用它，再多用 `list` |
| `badge` | `SettingsStatusBadge` | 12pt semibold、`tint` 10% 底 / 16% 边、圆角 6 | 只换色不换形 |
| `keycap` | 键帽 | `Toolbox.Search.Shortcut`：17pt 高、圆角 5、9.5pt | 表示快捷键 |
| `symbol` | `Image(systemName:)` | small 12 / medium 16 / large 20 | 必须是 SF Symbol 名；不存在时画 `questionmark` 并记警告 |
| `swatch` | 色块 | `ColorPicker.Preview`：34pt / 圆角 8、外套白 4% 底 / 白 12% 边 | 外框不是装饰：当前色可能与面板底同色 |
| `qrcode` | `QuickTransferQRCode` | 122pt | 最多一个；文本 ≤ 1 KB |

### 清单与卡片

| 节点 | 宿主实现 | tokens | 规则 |
| --- | --- | --- | --- |
| `row` | 工具箱行 / 粘贴板行的骨架：图标井 + 标题 + 说明 + 记号 / 动作 | `Toolbox.Row`（圆角 12、12×10 内距、行距 6）、`IconWell`（32 / 圆角 8 / 白 4% 底 8% 边） | 常态**完全透明**（一列清单不是一叠卡片）；`selected` 换青 6% 底 + 青 25% 边 + `0 4 12` 青 10% 外发光、井点亮、记号换青点；`onPress` 存在才可点、才挂悬停光；`hoverCard` 指针停 320ms 才出、前半屏向下挂后半屏向上挂、Reduce Motion 直接出现 |
| `list` | `ScrollView` + `LazyVStack` | 行距 `tight` | 子节点必须带 `key`；`onLoadMore` 存在时底部画 22pt 定高哨兵（转圈 + 10pt 文字；Reduce Motion 只留文字），滚到它就调用；`emptyState` 在没有子节点时画 |
| `card` | `FloatingPanelCardBackground(tint:)` | 圆角 12、面板底 55% / 白 8% 边；带 `tint` 时 tint 10% 底 / 16% 边 | 带 `onPress` 时整卡可点 + 悬停光；不可点时不亮 |
| `note` | 语义说明卡（数据导出「访问受限」、Base64 报错那一类） | 同 `card` 带 tint；符号 15pt、标题 13pt semibold、正文 12pt、动作 22pt 行内 | 一屏解释，不是一句红字：拿不到什么、为什么、还剩哪几条路 |
| `empty` | `Toolbox.Empty` 那一屏 | 井 56 / glyph 20 / 标题 13 semibold / 提示 11 宽 260 / 按钮 28 高圆角 8 | 三种"空"各说各的话（没内容 / 没权限 / 没连上） |

### 输入

| 节点 | 宿主实现 | tokens | 规则 |
| --- | --- | --- | --- |
| `field` | 单行 `TextField` | `TimeConverter.Input`：白 3% 底 / 白 7% 边 / 圆角 8 / 10×4 内距；`mono` 12pt 等宽 | 有焦点时宿主自动 `hold`；`label` 必填；占位提示在光标落进来时让开（URL 解析那条） |
| `editor` | 多行 `TextEditor` + `plainTextEditing()` + 高度手柄 | `Base64.Editor`：默认 2 行 34pt、可拖 1…10 行、圆角 8、12,10×9 内距、12pt 等宽 semibold；手柄 28×3 白 28%（hover 60%）命中 12pt | 智能引号、破折号、拼写全部关掉；空时画 placeholder（`allowsHitTesting(false)`）；`error` 时描边与左竖条转红（`#FF5C4F`）；拖拽途中连续、松手对齐整行 |
| `search` | 工具箱搜索框 | `Toolbox.Search`：32 高 / 圆角 10 / 12.5pt | 聚焦青边 + 轻辉光；有内容时右端清除钮，空时 `⌘F` 键帽；`Esc` 只在有内容时清空，否则放行给面板收起 |
| `segmented` | 分段 | `compact`: `TimeConverter.Segmented`（白 6% 底 / 圆角 6 / 选中青 20% / 9pt bold）；`full`: `HashGenerator.Tab`（通栏两段各 26 高 / 圆角 8 / 选中青 7.8% 底 + 青边） | `compact` 挤在段标题右端（ms/s），`full` 是两块内容并列的入口（文本 / 文件）；档数 ≤ 5 |
| `toggle` | `SettingsGlassToggleStyle` | 56×30 玻璃开关 | 命中区是整颗轨道，不含标签；`disabled` 整体 45% 不隐藏 |
| `chip` | 紧凑 chip | `Base64.Options` 紧凑 chip：7×3 内距、10pt 等宽 bold；选中 `tint` 20% 底 + `tint` 边，未选白 3% 底 / 白 8% 边 | 文案压到最短，完整含义放 `help`（tooltip + VoiceOver） |
| `picker` | 下拉 | `TimeConverter.ZonePicker`：宽 320 / 圆角 10 / 选项行 27pt / 选中青 12% 底；`searchable` 时顶部搜索框；列表最高 174pt 后滚 | 选项 > 8 自动带搜索；勾在未选中时留位不隐藏 |
| `dropzone` | `HashGenerator.DropZone` | 高 88 / 圆角 10 / 青 30% 虚线 `[4,3]`；悬停底青 5% + 青 85% 虚线 1.5pt + 12pt 外发光 | 点也能选文件（键盘用户进得来）；文件夹在落下那一刻拒绝；多拖几个只算前 N 个并在屏幕上说出来 |

### 动作

| 节点 | 宿主实现 | tokens | 规则 |
| --- | --- | --- | --- |
| `button` | 文字按钮 | `bar` 26 高 / `inline` 22 高；`primary` accent 底 12% + accent 1pt 实边 / 圆角 6（时间转换器那颗「转换」）；`secondary` 白 5% / 10%；`link` 无底、12pt semibold accent；`danger` `danger` 14% 底 / 1pt 边 | **一块面板上只该有一颗实心 accent 按钮**——它是这一段唯一的主动作；`confirm` 走就地两步确认（第一次按变文案、4 秒或视图消失复原），不弹 modal；`disabled` 失效不隐藏、不亮悬停光 |
| `iconButton` | 图标按钮 | `bar`: header 那排的玻璃圆片 26pt、白 6% 底 / 白 8% 边；`inline`: 22pt 命中区里 12pt glyph | `label` 必填（tooltip + VoiceOver）；`active` 整片点亮成青色（开关语义） |
| `copy` | 复制钮 | `chip`: `HashGenerator` 复制 chip 15 高 / 圆角 4 / 青 10% 底 + 青 28% 边，「已复制」青 22% + 青 70%；`icon`: 22pt 行内 `doc.on.clipboard` → 一秒对勾 | 宿主写剪贴板，不需要能力；同一屏多颗复制钮的「已复制」由宿主用一个可选值表达，同时亮两颗在类型上不可能 |
| `ActionSpec`（段与行上的小动作） | 22pt 行内 | 同 `iconButton inline` / `button inline` | 有 `symbol` 时 `help` 必填 |

### 反馈

| 节点 | 宿主实现 | tokens | 规则 |
| --- | --- | --- | --- |
| `result` | 输出框 | `TimeConverter.Result`：黑 20% 底 / 白 8% 边 / 圆角 8 / p8；`mono` 12pt 等宽 | 底色比输入控件更沉，读成"输出"；`empty` 那句用被动语态（「结果会实时出现在这里」）；`error` 时描边转红、文字用报错色 |
| `progress` | `ProgressView(.linear)` | 3pt、`tint` | 读完就撤（留一条满格的进度条用户会以为它还在动）；`value` 省略 = 不确定，Reduce Motion 下不确定态换成文字 |

## 全局规则（宿主替每个节点做的事）

| 规则 | 实现 |
| --- | --- |
| 可点的东西自己会亮 | `onPress` / `onChange` 存在且未 `disabled` 的节点挂 `controlFocusHighlight(shape:)`，轮廓与节点自己的底一致 |
| 选中不是失效 | `selected` 走 `selectionChroma`；`disabled` 走 `.disabled` + 45% 不透明度，**不隐藏** |
| 输入框有焦点就 hold | `field` / `editor` / `search` 聚焦期间 `isHeldOpen`，与快传输入框同一条 |
| 三档辅助功能 | Reduce Motion：光停转、转圈换文字、翻转换直切；Reduce Transparency：材质换实底；Increase Contrast：边 1 → 1.5pt、光晕拉满 |
| VoiceOver | 每个可交互节点必须有 `label`（图标类必填，文字类从标题推）；`row` 合并成一个元素；装饰层 `accessibilityHidden` |
| 键盘 | `field` / `editor` / `search` 可 Tab 到；`button` 可空格触发；`Esc` 收面板（`search` 有内容时例外） |
| 动画 | 节点增删走 `Motion.feedback`（0.16s 淡入淡出）；Reduce Motion 下 `reducedPanel` |
| 限制 | 节点 ≤ 500、`qrcode` ≤ 1、`scroll` 只在根、`list` 子节点必须有 `key` |

## 一屏工具的推荐骨架

内置工具的共同解剖是"段 → 段 → 段"，每段一个标题行（标题 + 读数 + 动作）：

```ts
ui.scroll({
  children: [
    ui.section({ title: "模式 · MODE", children: [ui.segmented({ … })] }),
    ui.section({ title: "输入 · INPUT", trailing: `${n} 字符`, actions: [paste, clear], children: [ui.editor({ … })] }),
    ui.section({ title: "输出 · OUTPUT", actions: [copy], children: [ui.result({ … })] }),
  ],
});
```

判据（`design-system.md`「面板内容模式」）：段间 14、段内 10；一屏放得完就不滚；
装不下的正解是滚动或分阶段，不是放大面板。

## Gotchas

- 没有 `image` 节点：面板上几乎没有位图，图标一律 SF Symbols。要显示截图结果用 `note` + 「在访达中显示」。
- 没有 `modal` / `sheet`：面板 15 秒会自动收回，modal 会被截断；确认走 `button.confirm`。
- 没有 `spacing: number`：四档是全部。想要"再密一点"多半是想少画一段。
- `key` 不是可选的礼貌：列表里没有 `key` 的行在增删时会被整块重建，正在输入的框会丢焦点。

## Related Links

- [08 · 设计体系](08-design-system.md)
- [09 · 鼠标感知系统](09-pointer-awareness.md)
- [`sdk/src/ui.ts`](../sdk/src/ui.ts)
- `jarvis-mac/Sources/Jarvis/UI/DesignTokens.swift`、`ControlFocusHighlight.swift`
