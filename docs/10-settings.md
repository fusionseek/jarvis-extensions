# 设置区段接入（第三部分）

## Overview

设置页多一个区段：**「扩展」**（`SettingsSectionKind.extensions`）。它是设置页唯一一个
内容随安装而变的区段，但索引栏里仍然只有一项——索引是一列条目数固定的目录，不给每个扩展
各开一项。

区段里两类面板：一块**扩展库**面板（来源、同步、开发者模式），然后**每个已安装扩展一块**面板。
manifest `settings: false` 的扩展也有面板——它至少要有启用开关、授权列表与卸载；
`settings.preferences` 只决定面板里有没有"偏好"那一段。

## Concepts

### 位置

排在「APK 导出目录」之后、「连接状态」之前。前面十二段是应用级偏好与工具链配置，
「扩展」是第三类；「连接状态」是页脚一样的东西，恒在最后。

`SettingsSectionKind` 多一个 case `extensions`，`title` 为「扩展」；索引、区段标题、滚动锚点、
VoiceOver 读出的名字全部从它取——一次写完。

### 扩展库面板

| 行 | 左 | 右 |
| --- | --- | --- |
| 来源 | 标题 15 semibold「扩展库」+ 说明 12「fusionseek/jarvis-extensions」+ 等宽状态行 11 `● 上次同步 12:30 · 12 个扩展` | 「立即同步」次 chip |
| 开发者模式 | 标题 14 semibold「从本地目录加载」+ 说明「把一个扩展目录当作已安装的扩展加载，改动即时生效」 | 玻璃开关 |
| 本地目录（子项，总控关着时 45% 灰） | 缩写路径 `~/Dev/…/my-ext`，未选时「未选择」 | 「选择…」chip |

状态行三种写法与颜色不许混用：同步过 `live` 绿；从没同步 `footnoteText`「尚未同步」；
离线 `footnoteText`「上次同步 昨天 18:02 · 离线」；解析失败 `alert`「最新快照无法解析」。

开发者模式见 [12](12-developer-guide.md)。它是一个单值开关 + 一条路径，留在 `UserDefaults`。

### 每个扩展一块面板

```text
┌ 玻璃面板 ──────────────────────────────────────────────────────┐
│ [井 26] 发到手机  v1.0.0        [已启用]              (开关)   │  ← 头行
│         把剪贴板里的东西推到手机 · fusionseek · 查看源码        │
├──────────────────────────────── 发丝线 ────────────────────────┤
│ 已授权                                                        │  ← 授权段
│   [doc.on.clipboard] 读取剪贴板     中风险  9-12 12:41 (开关) │
│   [antenna…] 开启 / 停止快传        高风险  9-12 12:41 (开关) │
│   …                                                           │
├──────────────────────────────── 发丝线 ────────────────────────┤
│ 偏好                                                          │  ← 偏好段（settings ≠ false 时）
│   去掉首尾空白                                       (开关)   │
│   发送前确认   点「发到手机」后先看一眼再发            (开关)   │
├──────────────────────────────── 发丝线 ────────────────────────┤
│ 本地 1.0.0 · 扩展库 1.1.0   [更新到 1.1.0] [日志] [卸载]        │  ← 页脚
└───────────────────────────────────────────────────────────────┘
```

| 元素 | 规格 | 为什么 |
| --- | --- | --- |
| 头行 | 图标井 26 / 圆角 7（`Modal.iconSize` 那一枚）+ 名 15 semibold + 版本 11 等宽 footnote；`SettingsStatusBadge` 已启用 accent / 已禁用 footnote / 加载失败 alert；右端玻璃开关 | 与集成行（Codex / Claude）同构：标题 + 徽标 + 开关 |
| 第二行 | 描述 12 `bodyText` 单行截断 · 作者 · 「查看源码」link 12 semibold | 用户要知道这是谁写的 |
| 授权段 | 每项一行 20pt 行距：18pt 符号列 + 标题 13 + 档位徽标 + `decided_at`（等宽 11 footnote）+ 玻璃开关 | 与授权弹窗逐项对应，关掉即撤销，运行中的扩展收到 `permissionsChanged` |
| 授权段为空 | 一句 11 footnote「这个扩展不需要任何授权」 | 空着不写读起来像没加载完 |
| 偏好段 | 按 manifest 顺序，每项一行：标题 14 semibold + 说明 12 + 右端控件 | 控件映射见下 |
| 禁用态 | 授权段与偏好段整体 45% 不透明度、不可交互；**不隐藏** | 藏起来会让用户以为设置丢了 |
| 页脚 | 等宽 11 footnote 版本对照；「更新到 x.y.z」主 chip（有新版本才出现）；「日志」次 chip（开发者模式开着才出现）；「卸载」`danger` chip，**就地两步确认**：第一次点变「确认卸载」，旁边多出一颗「同时删除数据」toggle（默认关），4 秒复原 | 卸载不弹 modal；数据删不删是用户的决定 |
| 加载失败 | 头行徽标 alert「加载失败」，第二行换成原因（`errorTint` 色），页脚多一颗「重新加载」 | 与集成行「不可用」同一种语言 |

### 偏好控件映射

| `type` | 控件 | 行为 |
| --- | --- | --- |
| `toggle` | `SettingsGlassToggleStyle` | 切换即写 `extension_preferences`，发 `preferencesChanged` |
| `text` | 单行 `TextField`，白 3% 底 / 7% 边 / 圆角 8，宽 220 | 回车或失焦提交；超过 `maxLength` 拒绝并回填生效值 |
| `number` | 同上 + 等宽字 | 越界**拒绝并回填**，不静默夹取（夹取的表现是你填了 70000、屏幕上出现 65535，而没有任何一处解释） |
| `select` | ≤ 4 档 `SettingsSegmentedPicker`；5–8 档下拉 | 分段控件没有滚动与省略，档数多到一行放不下时换下拉 |
| `directory` | 「选择…」`SettingsChipButton` + 缩写路径 + 「重置」link | 走 `NSOpenPanel`，只能选目录；路径存为字符串 |

偏好值的默认值来自 manifest；`extension_preferences` 里没有行时读默认。**用户改过的值在扩展更新后保留**，
manifest 里删掉的 key 对应的行留着不读（下次卸载一并删）。

### 与扩展页面的关系

- 扩展页面里**不许再画一份设置**。`jarvis.preferences` 只读；扩展想改自己的偏好，只能引导用户去设置页。
- 扩展页面可以有一颗 `link` 按钮「在设置里调整」→ `jarvis.system.openSettings()`（v1 暂无此方法；
  用 `note` 写一句「去 设置 › 扩展 › 发到手机 里调整」）。
- 设置页改动偏好时如果扩展页面正开着，宿主发 `preferencesChanged` 并自动重画。

### 日志抽屉

开发者模式开着时页脚多一颗「日志」：点开在面板下方展开一块 200pt 高的等宽区（11pt、黑 20% 底），
按时间倒序列最近 200 条 `jarvis.log`，每行 `HH:mm:ss.SSS [level] message`，右上角「清空」「复制全部」。
只在内存里，退出即清。

## Lifecycle / Disposal

- 关掉启用开关：销毁上下文、目录行消失、活动的 Inbox 卡撤走、订阅撤销；授权与偏好原样留着。
- 卸载：删目录、删 `extension_installs` / `extension_grants` / `extension_inbox_cards`；
  勾了「同时删除数据」才删 `extension_preferences` / `extension_documents`。

## Gotchas

- 索引栏里「扩展」只有一项；区段内部按扩展名滚动定位由用户自己滚。装了十几个扩展时这一段会很长——
  那是设置页的正常长相，与 APK 工具链那一段一样。
- 「更新到 x.y.z」是设置页与扩展库两处都有的动作，两处走同一个 `ExtensionCenterModel.update(id)`。
- 偏好里没有机密类型；扩展要 API key 的话，v1 不收。

## Related Links

- [03 · manifest 规范](03-manifest.md)（第三部分）
- [05 · 能力授权模型](05-permissions.md)（撤销）
- `jarvis-mac/Sources/Jarvis/UI/SettingsIndex.swift`、`SettingsChrome.swift`、`SettingsView.swift`
