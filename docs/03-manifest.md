# `extension.json` 规范

## Overview

每个扩展目录里有且只有一份 `extension.json`。真源是
[`schemas/extension.v1.schema.json`](../schemas/extension.v1.schema.json)（Draft 2020-12，
`additionalProperties: false`，多一个键就不合法）；本文解释每个字段**为什么这样定**，
并列出 schema 表达不了的跨字段规则。

四个部分（工具箱条目 / 功能与能力 / 设置 / Inbox）在 manifest 里对应四组字段，
**全部必填**——`settings` 与 `inbox` 不要时写 `false`，不能省略。

## 一份完整的例子

```json
{
  "manifestVersion": 1,
  "id": "send-to-phone",
  "version": "1.0.0",
  "toolbox": {
    "symbol": "iphone.and.arrow.forward",
    "name": "发到手机",
    "subtitle": "把剪贴板里的东西推到手机",
    "keywords": ["phone", "手机", "快传"]
  },
  "description": "读一次剪贴板，经 Jarvis 快传把文字或链接推到已配对的手机上；快传没开时给一颗按钮替你打开。",
  "author": { "name": "fusionseek", "github": "fusionseek" },
  "main": "dist/extension.js",
  "sdk": "^1.0.0",
  "minimumJarvisVersion": "1.5.0",
  "capabilities": [
    { "id": "clipboard.read", "reason": "读取要发送的文字或链接" },
    { "id": "quickTransfer.status", "reason": "知道快传开没开、有没有手机连着" },
    { "id": "quickTransfer.control", "reason": "快传没开时替你打开" },
    { "id": "quickTransfer.send", "reason": "把内容推到手机" },
    { "id": "hotkeys.register", "reason": "全局快捷键一键发送" }
  ],
  "commands": [
    { "id": "send-clipboard", "title": "一键发送", "hotkey": { "default": "⌥⌘P" }, "presentation": "silent" }
  ],
  "settings": {
    "preferences": [
      { "key": "trimWhitespace", "type": "toggle", "title": "去掉首尾空白", "default": true },
      { "key": "confirmBeforeSend", "type": "toggle", "title": "发送前确认", "description": "点「发到手机」后先看一眼再发", "default": false }
    ]
  },
  "inbox": { "cards": true, "notifications": false },
  "background": false
}
```

最小的例子（一个不需要任何点头能力、不进设置、不进 Inbox 的纯工具）：

```json
{
  "manifestVersion": 1,
  "id": "lorem",
  "version": "0.1.0",
  "toolbox": { "symbol": "text.alignleft", "name": "占位文本", "subtitle": "生成几段 Lorem ipsum" },
  "description": "按段落数生成占位文本，一键复制。",
  "author": { "name": "someone" },
  "main": "dist/extension.js",
  "sdk": "^1.0.0",
  "minimumJarvisVersion": "1.5.0",
  "capabilities": [],
  "settings": false,
  "inbox": false
}
```

## 字段

### 身份

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `manifestVersion` | 恒为 `1` | 破坏性变化用新的 major，宿主按它选解析器 |
| `id` | `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`，3–40 字，**等于目录名** | 它同时是工具箱行 id、数据库里的隔离键、`OrbShortcutKind.panelContent("extension:<id>")` 的载荷。全小写是因为它会出现在路径与 URL 里 |
| `version` | 严格 semver（`1.2.3`，不带前缀不带预发布） | 扩展库靠比较它判断「更新到」；预发布版本不上主干 |

**保留 id**（与内置工具行 id 及宿主页面撞名）：`palette`、`clipboard`、`base64`、`hash`、`regex`、
`url`、`json`、`time`、`apk`、`datapull`、`screenshot`、`quicktransfer`、`gallery`、`extension`、
`extensions`、`jarvis`。校验脚本拒绝。

### 第一部分：`toolbox`

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `symbol` | SF Symbol 名，`^[A-Za-z0-9.-]+$` | 工具箱**一律 SF Symbols**，不接受 emoji、位图、自绘路径——emoji 接不住选中态那层青色染色，位图在选中时不会点亮。宿主加载时用 `NSImage(systemSymbolName:)` 验证；不存在的符号回落 `puzzlepiece.extension` 并在开发者模式里报错 |
| `name` | 1–12 字 | header 留给标题的宽度是 **144pt**（400 − 32 内边距 − 徽标 26 − 三道间距 36 − 五颗按钮 162），15pt SemiBold 下约 9 个汉字；宫格标题 86pt 宽、11pt，超过 6 个汉字尾部截断。12 是 schema 的硬上限，**6 以内**才两处都不截 |
| `subtitle` | 1–22 字 | 列表行说明 11pt，行宽扣掉图标井与记号约 270pt；宫格常态不显示、搜索命中时显示并单行截断 |
| `keywords` | ≤ 12 个，每个 ≤ 24 字 | 只装标题与说明里**没有**的词（英文名、别名）。已经在标题里的词再写一遍等于同一件事说两遍，两遍必然有一遍先过期 |

`symbol` 同时是扩展页面 header 徽标里的那枚 glyph：宿主按 `Toolbox.HeaderBadge.glyphSize − 3`（11pt）
画在 26pt 青色方片上，与 JSON / URL / 哈希那几块工具逐值相同——**徽标与列表行说的是同一件事**，
不允许两处用不同符号。

### 第二部分：`main`、`commands`、`capabilities`、`network`

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `main` | `dist/<name>.js`，单文件 | 宿主只 `evaluateScript` 这一个文件；没有模块加载器。ESM/IIFE 都行，但不能 `import` 别的文件 |
| `commands[]` | ≤ 8 条，每条 `{ id, title, description?, hotkey?, presentation }`；`id` 与扩展 id 同一套规则、扩展内唯一；`title` ≤ 12 字 | 页面之外的入口。快捷键、页面按钮、快捷环、Inbox 卡片触发，落到 `defineExtension({ commands })` 里同 id 的处理函数。**没有页面也可以**：SDK 会画一张列出全部命令的默认页 |
| `commands[].hotkey.default` | 修饰键按 `⌃⌥⇧⌘` 顺序 + 一个主键（`A`–`Z`、`0`–`9`、`F1`–`F12` 或 `- = [ ] ; ' , . /`），至少含 ⌃、⌥、⌘ 之一；例 `⌥⌘T` | 与 Jarvis 设置页显示的写法一致。它只是默认值，用户可以改；系统探测不到跨应用冲突，因此设置页会写明"按了没反应多半是别的应用占着" |
| `commands[].presentation` | `panel` / `silent` | `panel`：跑完展开面板到这个扩展的页面；`silent`：不碰面板，命令自己用剪贴板、横幅或 `jarvis.panel.present()` 交结果 |
| `capabilities[]` | ≤ 12 项，每项 `{ id, reason }`，`reason` 4–60 字 | `reason` 是授权弹窗那一行的第二句，**写给用户看**：说清拿它做什么，不写"为了更好的体验"。同一个 id 不能出现两次（校验脚本查） |
| `network.hosts` | 声明了 `network.https` 时**必填**，1–8 个主机名（不带协议与路径） | 宿主只放行这几个主机上的 HTTPS；授权弹窗把主机名逐条列给用户看 |

能力目录见 [06](06-capabilities.md)。隐式能力（`panel.*`、`storage.*`、`preferences.*`、`text.*`、
`time.*`、`color.*`、`environment`、`log`）**不在这里声明**：它们碰不到用户的数据。

跨字段规则：

- `network.https` 在 `capabilities` 里 ⇔ `network` 字段存在。少一边校验脚本拒绝。
- `inbox.cards: true` ⇒ 必须声明 `inbox.post`；`inbox.notifications: true` ⇒ 必须声明 `notifications.post`。
- `background: true` ⇒ 必须声明 `inbox.post` **或** 至少一项带 `observe` 的能力（`clipboard.read`、
  `quickTransfer.status`、`tasks.read`）。没有后台要做的事却常驻，审核不通过。
- 任一命令带 `hotkey` ⇔ 声明了 `hotkeys.register`。全局快捷键要用户点头，弹窗里那一行写的是「注册全局快捷键 ⌥⌘T」。
- `presentation: "silent"` 的命令必须至少声明 `clipboard.write`、`notifications.post`、`inbox.post` 之一：
  一条不开面板又不交结果的命令，用户按了只会以为坏了。
- 两条命令不能用同一个快捷键。

### 第三部分：`settings`

`false`，或 `{ "preferences": [ … ] }`（1–16 项）。每一项渲染成设置页「扩展」区段里该扩展面板内的一行，
控件由 `type` 决定：

| `type` | 控件 | 字段 |
| --- | --- | --- |
| `toggle` | 玻璃开关 | `default: boolean` |
| `text` | 单行输入框 | `default`、`placeholder`、`maxLength`（≤ 200） |
| `number` | 单行输入框 + 范围校验 | `default`、`minimum`、`maximum`、`step` |
| `select` | 分段选择器（≤ 4 档）或下拉（5–8 档） | `default`、`options[]`（2–8 项） |
| `multiselect` | 一排可多选的 chip | `default: string[]`、`options[]`（2–8 项） |
| `secret` | 遮罩输入框 + 「已设置」徽标 | 无默认；`placeholder`。存 **Keychain**、不进 SQLite、不进日志、`preferences.all()` 里没有它、只能按 key 单独读 |
| `directory` | 「选择…」chip + 缩写路径 | 无默认；未选时显示「未选择」 |

规则：

- `key` `^[a-z][a-zA-Z0-9]*$`，≤ 32；`title` ≤ 24 字；`description` ≤ 80 字。设置页的行文本区上限 640pt，
  超过这个长度的说明读不下去。
- `secret` 是唯一一种不落 `extension_preferences` 的偏好：Keychain 条目按 `<extension id>/<key>` 命名，
  随卸载删除。扩展把它写进 `storage`、写进日志、发到白名单之外的主机，审核不通过。
- 值的读取走 `jarvis.preferences.get(key)`；用户在设置页改动后宿主发 `preferencesChanged`。
- 扩展**不能**在自己的页面里再画一份设置：同一个开关出现在两处，用户就得先判断哪个算数。

### 第四部分：`inbox`

`false`，或 `{ "cards": boolean, "notifications": boolean }`，两个键都必填。

| 组合 | 含义 |
| --- | --- |
| `false` | 不进 Inbox。`jarvis.inbox.*` 与 `jarvis.notifications.*` 即使声明了能力也拒绝 |
| `{ cards: true, notifications: false }` | 只投卡片，不弹横幅 |
| `{ cards: true, notifications: true }` | 投卡片时可以带横幅（`notify: true`） |
| `{ cards: false, notifications: true }` | 只弹横幅不投卡（静默命令的回执）：点横幅展开面板到这个扩展的页面 |
| `{ cards: false, notifications: false }` | **不合法**：两项都不要就写 `false` |

卡片的形态与规则见 [11 · Inbox 接入](11-inbox.md)。

### 其余

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `description` | 8–240 字 | 扩展库卡片正文，2 行显示、可展开。回答「它替我做什么」 |
| `author` | `name` 必填；`url`（https）、`github` 可选 | 卡片上署名 + 可点的源码链接。没有作者的扩展不上主干 |
| `repository` | https；省略时指向本仓库该目录 | 卡片上「查看源码」 |
| `sdk` | `^1.0.0` 形式 | 只认主版本；宿主拒绝不同主版本 |
| `minimumJarvisVersion` | semver | 用到的能力是哪一版宿主开始提供的，写那一版。宿主用 `AppVersion` 比较 |
| `background` | 布尔，默认 `false` | 见第二部分的跨字段规则 |

## 校验

```bash
node scripts/validate.mjs                 # 校验全部扩展
node scripts/validate.mjs extensions/foo  # 校验一个
```

脚本检查：schema、保留 id、目录名 = id、`main` 指向的文件存在且 ≤ 512 KB、bundle 不含
`__jarvisHost` 之外的宿主全局引用、跨字段规则、`version` 相对主干是否递增（CI 里）。
SF Symbol 是否存在**脚本查不了**（符号表只在 macOS 上），由宿主的开发者模式在加载时报。

## Gotchas

- `name` 与 `subtitle` 是**中文优先**的：这个应用的全部界面文案是中文，一行英文标题在工具箱里会读成漏翻。
  英文名放进 `keywords`。
- 改 `id` 等于换一个扩展：安装记录、授权、偏好、文档全部按 `id` 隔离，旧的不会迁移。
- `capabilities` 里多声明一项而代码里没用到，审核会问；少声明一项而代码里用到了，
  运行时得到 `capability.undeclared`——两个方向都会在 PR 里被看见。

## Related Links

- [`schemas/extension.v1.schema.json`](../schemas/extension.v1.schema.json)
- [05 · 能力授权模型](05-permissions.md)
- [06 · 能力接口目录](06-capabilities.md)
- [10 · 设置区段接入](10-settings.md)
- [11 · Inbox 接入](11-inbox.md)
