# `extension.json` 规范（v2）

## Overview

每个扩展目录里有且只有一份 `extension.json`。真源是
[`schemas/extension.v2.schema.json`](../schemas/extension.v2.schema.json)（Draft 2020-12，
`additionalProperties: false`，多一个键就不合法）；本文解释每个字段**为什么这样定**，
并列出 schema 表达不了的跨字段规则——`scripts/validate.mjs` 与宿主的 `ExtensionManifest.validate()` 查的是**同一份清单**。

v2 按**域**组织（[01](01-overview.md)）：身份与能力在顶层，入驻哪几个域写在 `contributes` 里。
**必填**：`manifestVersion`、`id`、`version`、`name`、`symbol`、`description`、`author`、`main`、`sdk`、
`minimumJarvisVersion`、`capabilities`、`contributes`、`inbox`；`contributes` 至少要有 `toolbox` / `window` / `commands` / `services` / `menuBar` 之一
（`settings` 与 `git` 都不是入口）。
`inbox` 不要时写 `false`，不能省略——「没想过」与「想过了，不要」在审核里是两件事。

## Concepts

### 一份完整的例子（工具箱 + 窗口 + 指令 + 设置）

```json
{
  "manifestVersion": 2,
  "id": "http-status",
  "version": "1.0.0",
  "name": "HTTP 状态码",
  "symbol": "number.circle",
  "description": "输入状态码或关键词，给出这个码的读法、语义、常见成因、怎么处理与 RFC 出处。",
  "author": { "name": "fusionseek", "github": "fusionseek" },
  "main": "dist/extension.js",
  "sdk": "^2.0.0",
  "minimumJarvisVersion": "3.0.3",
  "capabilities": [
    { "id": "clipboard.read", "reason": "⌥⌘/ 按下时读一次剪贴板，从里面找状态码" },
    { "id": "system.openURL", "reason": "点「打开原文」时用默认浏览器打开 RFC / MDN" },
    { "id": "hotkeys.register", "reason": "两条命令的全局快捷键" }
  ],
  "contributes": {
    "toolbox": { "subtitle": "查一个码：含义、成因、怎么处理", "keywords": ["status", "rfc"] },
    "window": { "subtitle": "在窗口里查状态码：含义、成因、怎么处理、出处" },
    "commands": [
      { "id": "lookup", "title": "查状态码", "hotkey": "⌥⌘H", "presentation": "toolbox" },
      { "id": "explain-clipboard", "title": "解释剪贴板里的码", "hotkey": "⌥⌘/", "presentation": "popover" },
      {
        "id": "explain",
        "title": "解释状态码",
        "slash": { "keyword": "http", "aliases": ["状态码"], "argument": "状态码或关键词" },
        "presentation": "popover"
      }
    ],
    "settings": {
      "preferences": [
        { "key": "includeUnofficial", "type": "toggle", "title": "搜索包含非标准码", "default": true }
      ]
    }
  },
  "inbox": false
}
```

### 一个服务扩展（只入驻服务域）

```json
{
  "manifestVersion": 2,
  "id": "mole-clean",
  "version": "1.0.0",
  "name": "Mole 深度清理",
  "symbol": "bubbles.and.sparkles",
  "description": "给 Jarvis 清理换一台更深的引擎：开着时，晃球、/clean 与工具箱清理改走你装好的 Mole。",
  "author": { "name": "fusionseek", "github": "fusionseek" },
  "main": "dist/extension.js",
  "sdk": "^2.0.0",
  "minimumJarvisVersion": "3.0.3",
  "capabilities": [
    { "id": "process.run", "reason": "调用你装好的 mo clean 与 mo --version，它继承 Jarvis 的完全磁盘访问" },
    { "id": "files.read", "reason": "读 Mole 的操作日志，逐项显示正在删什么" },
    { "id": "terminal.run", "reason": "没装 mo 时在终端里替你安装" }
  ],
  "process": {
    "executables": [{ "name": "mo", "arguments": [["clean"], ["--version"]] }],
    "terminal": [{ "id": "install", "title": "安装 Mole", "script": ["if command -v brew >/dev/null 2>&1; then", "    brew install mole", "fi"] }]
  },
  "files": { "read": ["~/Library/Logs/mole/operations.log"] },
  "contributes": {
    "services": [
      {
        "point": "junkClean.engine",
        "id": "mole",
        "title": "深度清理（Mole）",
        "subtitle": "调用 mo clean，覆盖浏览器、开发工具与各类应用的更多缓存",
        "notes": ["系统级部分需要管理员权限，Mole 会自动跳过，不会向你要密码"],
        "preferences": [
          { "key": "command", "type": "text", "title": "mo 命令", "default": "mo", "placeholder": "mo", "monospaced": true }
        ]
      }
    ]
  },
  "inbox": false
}
```

### 一个项目引擎（服务域 + Git 域 + Git 操作域）

```json
{
  "manifestVersion": 2,
  "id": "github-project",
  "version": "1.0.0",
  "name": "GitHub 项目",
  "symbol": "tablecells",
  "description": "给 Jarvis「项目」接上 GitHub Projects v2：读 Project 的字段与条目，把需求 / 迭代 / 缺陷页上的修改写回 GitHub。",
  "author": { "name": "fusionseek", "github": "fusionseek" },
  "main": "dist/extension.js",
  "sdk": "^2.1.0",
  "minimumJarvisVersion": "3.2.2",
  "capabilities": [
    { "id": "git.hosting.read", "reason": "读 Project 的字段、条目与 Issue 关系" },
    { "id": "git.hosting.write", "reason": "把你在项目页上的修改写回 GitHub" }
  ],
  "git": { "mutations": ["updateProjectV2ItemFieldValue", "closeIssue"] },
  "contributes": {
    "services": [
      { "point": "project.engine", "id": "github", "title": "GitHub Project", "subtitle": "读写 GitHub Projects v2" }
    ],
    "git": { "hosting": ["github"], "summary": "Git 设置「Project 关联」与 Projects 分组" }
  },
  "inbox": false
}
```

`git.mutations` 这里只留两个示意；真实的 [`extensions/github-project`](../extensions/github-project/extension.json) 把代码里会发的 18 个变更都写出来。

### 一个常驻进程扩展（菜单栏 + 常驻进程 + 系统代理 + 按用户填的地址联网，SDK 2.9）

```json
{
  "manifestVersion": 2,
  "id": "proxy",
  "version": "1.0.0",
  "name": "代理",
  "symbol": "network",
  "description": "用 sing-box 跑你的订阅：菜单栏一枚图标开关代理、切节点，开着时把系统代理指向它。",
  "author": { "name": "fusionseek", "github": "fusionseek" },
  "main": "dist/extension.js",
  "sdk": "^2.9.0",
  "minimumJarvisVersion": "3.2.7",
  "capabilities": [
    { "id": "process.daemon", "reason": "在后台常驻运行 sing-box" },
    { "id": "system.proxy", "reason": "开着时把系统代理指向本机的 sing-box" },
    { "id": "network.https", "reason": "拉取你填的订阅地址" }
  ],
  "network": { "preferenceHosts": ["subscriptions"] },
  "process": {
    "daemons": [
      { "id": "sing-box", "executable": "sing-box", "arguments": ["run", "-c", "{config}", "-D", "{workdir}"], "config": { "fileName": "config.json" } }
    ]
  },
  "contributes": {
    "menuBar": { "title": "代理", "symbol": "network" },
    "settings": {
      "preferences": [{ "key": "subscriptions", "type": "urlList", "title": "订阅地址", "maxItems": 10 }]
    }
  },
  "inbox": false
}
```

这是示意，不是 [`extensions/proxy`](../extensions/proxy) 的全文（它还入驻工具箱、窗口与指令）。版本号随宿主那一版落地时定。

### 身份

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `manifestVersion` | 恒为 `2` | 宿主只认这一版；v1 的形状读下去只会在第一个缺的字段上报一句不相干的话，因此先看版本 |
| `id` | `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`，3–40 字，**等于目录名** | 它同时是工具箱行 id（`extension:<id>`）、数据库与钥匙串的隔离键、服务引擎 id 的前缀 |
| `version` | 严格 semver（`1.2.3`） | 商店靠比较它判断「更新到」 |
| `name` | 1–12 字 | 工具箱那一行、窗口标签、面板 header、设置面板、Inbox 消息标题前缀共用。header 留给标题的宽度只有 **144pt**，6 个汉字以内两处都不截 |
| `symbol` | SF Symbol 名，`^[A-Za-z0-9.-]+$` | 一律 SF Symbols：emoji 接不住选中态的青色染色，位图在选中时不会点亮。宿主验证不存在的符号回落 `puzzlepiece.extension` |
| `description` | 8–240 字 | 商店卡片正文。回答「它替我做什么」 |
| `author` | `name` 必填；`url`（https）、`github` 可选 | 卡片署名 |
| `repository` | https；省略时指向本仓库该目录 | 「查看源码」 |
| `main` | `dist/<name>.js`，单文件 | 宿主只 `evaluateScript` 这一个文件 |
| `sdk` | `^2.0.0` 形式 | 只认主版本；宿主的 SDK 主版本是 2 |
| `minimumJarvisVersion` | semver | 用到的能力是哪一版宿主开始提供的，写那一版 |

**保留 id**（与内置工具行与宿主页面撞名）：`palette`、`clipboard`、`base64`、`hash`、`regex`、`url`、`json`、`time`、
`junkclean`、`clean`、`apk`、`datapull`、`screenshot`、`quicktransfer`、`gallery`、`extension`、`extensions`、`jarvis`。

### 能力与声明对象

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `capabilities[]` | ≤ 16 项，`{ id, reason }`，`reason` 4–60 字，id 不重复 | `reason` 是授权屏那一行的第二句，写给用户看 |
| `network.hosts` | 与 `network.preferenceHosts` 至少一项（声明了 `network.https` 时）：1–8 个主机名 | 宿主只放行这几个主机（完全相等，不认后缀）；授权屏逐条列给用户看 |
| `network.preferenceHosts` | SDK 2.9：1–4 个本扩展 `urlList` 偏好的 key | 订阅地址这一类，作者写 manifest 时不知道在哪个主机：用户在那几项里填的地址，主机在**请求那一刻**放行（删掉一条，下一次请求就拦）。只认 `urlList`：它的控件由宿主画、值只可能来自用户亲手输入；页面里的输入框扩展自己就能填，宿主分不出是谁写的。授权屏写「以及你在「‹偏好标题›」里填的地址所在的主机」 |
| `process.executables[]` | 声明了 `process.run` 时必填：1–16 项 `{ name, arguments: [[…], …], stdin? }`，`name` 不带路径；1–16 组参数（SDK 2.7 起，原来 1–8），每组 ≤ 8 个，每个参数 1–64 字、**不带空白与 `; & \| \` $ < >`**；`stdin: true`（SDK 2.7）允许经标准输入交给它一段文字 | 一次调用的参数必须与其中某一组**逐项相等**——不支持通配，读 manifest 就知道它会跑什么。16 项是给格式化扩展这种「一整套工具链」留的；`stdin` 只给本职就是读 stdin 的工具，解释器不得声明 |
| `process.terminal[]` | 声明了 `terminal.run` 时必填：`{ id, title ≤ 16, script: [行…] }`，1–80 行、每行 ≤ 240 字 | 扩展只能按 id 点名，不能传脚本内容；宿主在前面补 `#!/bin/sh` 与「执行完删掉自己」那一行 |
| `files.read[]` | 声明了 `files.read` 时必填：1–8 个绝对路径或 `~` 开头的**文件**，不能有通配与 `..` | 宿主展开 `~`、规整之后逐字比；目录读不了 |
| `process.daemons[]` | SDK 2.9，声明了 `process.daemon` 时必填：1–2 项 `{ id, executable, arguments, config? }`。`id` `^[a-z][a-z0-9-]{0,31}$`；`executable` 规则同 `process.executables[].name`；`arguments` 是**一组** 1–16 个参数，每个 1–64 字、不带空白与 `; & \| \` $ < >`；只认 `{config}`（宿主写下的配置文件绝对路径）与 `{workdir}`（它的工作目录）两个占位符，**必须独占一个参数**、至少用一个；`config: { fileName }` 声明了就必须在参数里用 `{config}`，反之亦然 | 运行时扩展一个参数都传不进来，它能决定的只有配置文件的内容——所以读 manifest 就知道这个进程会以什么命令行常驻。占位符独占一个参数，是因为宿主按整参数替换；至少一个，是因为 Jarvis 崩溃之后宿主靠参数里的工作目录路径认出自己留下的孤儿进程。授权屏逐字念：「会在后台常驻运行：sing-box run -c ‹配置文件› -D ‹工作目录›」 |
| `process.daemons[].reload` | SDK 2.10，可省：只认 `"SIGHUP"` | 声明了它，`daemon.reload` 才能换配置不断进程（宿主重写配置文件再发这个信号）；没声明 = `daemon.reload` 一律拒绝 |
| `process.tunnel` | SDK 2.10，声明了 `network.tunnel` 时必填：`{ "executable": "sing-box" }`（本期只认这一个值） | TUN 由宿主的网络助手以 root 跑，配置要过宿主的守卫——守卫只懂 sing-box。跑的是安装时拷进 root 目录、校验过哈希的副本，不是用户目录里那一份。授权屏：「会以管理员身份运行 sing-box 接管整机网络（TUN 增强模式）；第一次打开时要你输一次管理员密码，装上 Jarvis 的网络助手」 |
| `git.mutations[]` | 声明了 `git.hosting.write` 时必填：1–32 个不重复的 GraphQL 变更名（`^[_A-Za-z][_0-9A-Za-z]*$`，≤ 80 字） | 宿主只执行顶层字段名**都在这里**的变更（别名不算数、顶层不许片段展开）；授权屏写「会以你的身份修改：…」、商店详情一行「Git 变更」逐字列出 |

能力目录见 [06](06-capabilities.md)。隐式能力（`panel.*`、`window.open`、`commands.run`、`storage.*`、`preferences.*`、
`permissions.*`、`text.*`、`host.*`、`log`）**不在这里声明**：它们碰不到用户的数据。

**受限执行声明要最小、要逐字**：只写真的会跑的那几组参数、真的会读的那一个文件。多写一组参数，
用户在授权屏上就多点了一次头去允许一件扩展根本不做的事。`git.mutations` 同理：只写代码里真的会发的变更，
像 `updateIssue` 这种一个名字能改很多东西的变更，README 里要写清你只改了哪一项。

### `contributes`：入驻的域

#### 工具箱域：`contributes.toolbox`

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `subtitle` | 1–22 字 | 列表行说明 11pt，行宽约 270pt |
| `keywords` | ≤ 12 个，每个 ≤ 24 字，不重复 | 只装名字与说明里**没有**的词（英文名、别名） |

入驻了工具箱域，目录末尾多一行；点开是面板里那一页（`defineExtension({ toolbox })`）。

#### 窗口域：`contributes.window`

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `subtitle` | 1–40 字 | 全局搜索那一行与标签副标题 |
| `keywords` | 同上 | 只入驻窗口域的扩展靠它在全局搜索里被找到 |

入驻了窗口域，扩展可以在 Jarvis 工作区里开一枚标签（`defineExtension({ window })`，省略时画 `toolbox` 那一页）。
入口：`presentation: "window"` 的命令、全局搜索（只入驻窗口、没有工具箱那一行的扩展才在搜索里单列一行）、页面里的
`jarvis.window.open()`。

#### 菜单栏域：`contributes.menuBar`（SDK 2.9）

`{ "title": "…", "symbol": "…" }`，两个键都必填；一个扩展至多一枚图标。**它是入口**：只入驻菜单栏的扩展也合法。

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `title` | 1–20 字 | 设置 · 扩展 里「在菜单栏显示」那一行与 VoiceOver 读的名字 |
| `symbol` | SF Symbol，`^[A-Za-z0-9.-]+$` | 还没收到任何模型时（应用刚启动、后台会话还没起来）画它 |
| `preferences`（SDK 2.10，可省） | 1–6 个不重复的 key，每个必须在 `contributes.settings.preferences` 里声明过 | 这枚图标自己的设置（「菜单栏显示速率」「速率刷新间隔」）：宿主把它们从通用偏好里拿出来，画在设置页「在菜单栏显示」下面、图标关着时置灰——排在授权与十几项偏好之后，用户找不到它 |

入驻了菜单栏域，系统菜单栏上就有这个扩展**自己的**一枚图标（不并进 Jarvis 那枚 sparkles）：仓库主人要「菜单独立」。
宿主用 `NSStatusItem` + `NSMenu` 画，扩展经 `jarvis.menuBar.update(model)` 推一份声明式模型（[06](06-capabilities.md)、[07](07-ui-components.md)），
代码跑在后台会话（`defineExtension({ menuBar: { start, open, select } })`）。菜单末尾宿主固定追加「打开「名」」「「名」的设置」：
菜单栏图标是扩展唯一常驻在屏幕上的东西，用户必须总能从它回到 Jarvis 管它的地方。用户可以在 设置 · 扩展 里关掉「在菜单栏显示」（[10](10-settings.md)）。

#### 悬浮球那一层：`contributes.orb`（SDK 2.10）

`{ "title": "…" }`（1–20 字），一个扩展至多一项。**它不是入口**：只声明它的扩展不合法。声明了它，`jarvis.orb.update(model)` 才放行（隐式能力，不要点头）：
扩展推读数（本期只有 `traffic`：有效上下行速率与成败连接数），宿主画在收起态的悬浮球上——外圈一道成败环，球心空着时两行速率（[06](06-capabilities.md)）。
`title` 是 设置 · 扩展 里「在悬浮球上显示」那一行与 VoiceOver 读的名字。悬浮球仍然不是可入驻的域：手势、动画与状态都是固定的，扩展只能画这一层读数。

#### 指令域：`contributes.commands[]`

≤ 12 条，每条 `{ id, title, description?, slash?, hotkey?, presentation }`。

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `id` | 与扩展 id 同一套规则，扩展内唯一 | `defineExtension({ commands })` 按它对上处理函数 |
| `title` | 1–12 字 | `/` 下拉、设置页、商店详情里显示 |
| `description` | ≤ 60 字 | 全局搜索里那一行的灰字 |
| `slash.keyword` | `^[a-z][a-z0-9-]{1,19}$` | `/` 下拉里显示的那一个；能直接敲出来 |
| `slash.aliases` | ≤ 4 个，每个 1–12 字、不带空白与 `/`；可以是中文 | `/翻译` 这样的别名 |
| `slash.argument` | 1–24 字 | 参数提示；**有它 = 要参数**：`/` 下拉里回车先补全成 `/http ` 等用户接着打；没有它回车直接跑 |
| `slash.scopes` | ⊆ `["launcher", "memo"]`，省略 = 两处都要 | `launcher` = 全局搜索（全局启动条与默认页搜索栏），`memo` = 速记输入框 |
| `hotkey` | 修饰键按 `⌃⌥⇧⌘` 顺序 + 一个主键，至少含 ⌃、⌥、⌘ 之一；例 `⌥⌘T` | 与设置页显示的写法一致；跨应用冲突系统层面探测不到 |
| `presentation` | `toolbox` / `window` / `popover` / `silent` | 见下表 |

| `presentation` | 跑在哪 | 用户看到 | 要求 |
| --- | --- | --- | --- |
| `toolbox` | 前台会话 | 面板展开到这个扩展的页面 | 入驻工具箱域 |
| `window` | 前台会话 | 工作区里开它的标签 | 入驻窗口域 |
| `popover` | 前台会话 | 面板不动，原地结果弹窗：截图的扩展锚在选区旁，不截图的扩展锚在指针旁 | 入驻工具箱域（弹窗画 `popover`，省略时画 `toolbox`） |
| `silent` | **后台会话** | 什么界面都不碰 | 至少声明 `clipboard.write`、`notifications.post`、`inbox.post` 之一来交结果 |

**`/` 指令词不能与内置指令撞**：`color colour 颜色 调色板 hash md5 sha1 sha256 sha512 哈希 base64 b64 url 链接
time ts timestamp 时间 时间戳 json regex 正则 mind 脑图 flow 流程图 seq 时序图 lane 泳道图 arch 架构图 architecture
todo 待办 memo note 速记 记 find 查找 diff compare 对比 比较 gitdiff gdiff git对比 git gitlog git图 clean cleanup 清理`。
撞了宿主不加载那一条（设置页写明），`validate.mjs` 在 PR 里就拦下。两个扩展认同一个词时宿主先装先得，仓库里不允许出现。

#### Git 域：`contributes.git`

`{ "hosting": [ … ], "summary": "…" }`，两个键都必填。**它不是入口**：只入驻 Git 域的扩展仍要入驻工具箱、窗口、指令、服务、菜单栏之一。

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `hosting` | 1–4 个不重复的托管服务标识（与扩展 id 同一套规则），例如 `github` | 与 Jarvis Git 服务的服务标识一致。Git 操作域的能力**只对这里列出的服务放行**：没入驻的服务，扩展碰不到 |
| `summary` | 1–40 字 | 商店卡片「装上之后」那一行：「Git · <summary>」，告诉用户在 Git 里去哪找它 |

入驻 Git 域的扩展才能声明 Git 操作域的能力（`git.repository.read` / `git.hosting.read` / `git.hosting.write`，见 [06](06-capabilities.md)）；
宿主在 Git 设置对应托管服务下给它画「关联」区段（项目引擎是「Project 关联」，[10](10-settings.md)）。

#### 设置域：`contributes.settings`

`{ "preferences": [ … ] }`，1–16 项。控件由宿主画在设置页「扩展」区段它那块面板里（[10](10-settings.md)）：

| `type` | 控件 | 字段 |
| --- | --- | --- |
| `toggle` | 玻璃开关 | `default: boolean` |
| `text` | 单行输入框（失焦或回车提交，清空 = 恢复默认） | `default`、`placeholder`、`maxLength`（≤ 200）、`monospaced`（路径、命令用等宽字） |
| `number` | 输入框，提交时夹到 `[minimum, maximum]` | `default`、`minimum`、`maximum`、`step` |
| `select` | 下拉 | `default`、`options[]`（2–8 项） |
| `multiselect` | 一列勾选框 | `default: string[]`、`options[]`（2–8 项） |
| `secret` | 遮罩输入框 + 「已保存」徽标 + 「清除」 | 无默认；`placeholder`。进**钥匙串**、不进库、不进日志、`preferences.all()` 里没有它 |
| `directory` | 「选择…」+ 路径 | 无默认 |
| `urlList`（SDK 2.9） | 一行一条 + 删除 + 「添加一行」；宿主逐条校验，填错的那一行标红不存 | 无默认；`maxItems`（1–20，省略 = 10）、`placeholder`、`secret`（省略 = `true`：整列进钥匙串——订阅地址里的 token 就是密码）。每条必须是带主机名的 `https://` 地址。被 `network.preferenceHosts` 点名时，它们的主机放行给 `net.fetch` |

`key` `^[a-z][a-zA-Z0-9]*$`，≤ 32；`title` ≤ 24 字；`description` ≤ 120 字。

#### 服务域：`contributes.services[]`

≤ 4 个，每个 `{ point, id, title, subtitle, notes?, preferences? }`。

| 字段 | 规则 | 为什么 |
| --- | --- | --- |
| `point` | 宿主开放的扩展点：`junkClean.engine`（清理引擎）、`project.engine`（项目引擎）、`launcher.apps`（全局搜索的应用目录，SDK 2.5）、`code.format`（Git 的代码格式化，SDK 2.7）、`code.highlight`（Git 的代码高亮，SDK 2.8） | **扩展点是宿主定的**：方法、载荷、设置画在哪都写死在宿主与 SDK 里 |
| `id` | 与扩展 id 同一套规则，扩展内唯一 | 引擎 id = `<扩展 id>/<服务 id>`；`defineExtension({ services })` 按它对上实现 |
| `title` | 1–16 字 | 在那个内置能力里的名字，例如「深度清理（Mole）」——设置 · 清理 里那一行开关的标题；项目引擎的是 Git 设置与「项目」里引擎的名字 |
| `subtitle` | 1–80 字 | 一句话说它比内置的多做了什么 |
| `notes` | ≤ 6 条，每条 1–80 字 | 须知：画在设置区段与清理工具的范围说明里 |
| `preferences` | ≤ 8 项，形状同设置域 | **画在扩展点指定的那个内置区段里**（`junkClean.engine` → 设置 · 清理，`project.engine` / `code.format` / `code.highlight` → 设置 · Git，`launcher.apps` → 设置 · 全局搜索），不在「扩展」区段 |

偏好的 key 在设置域与全部服务之间**共用一个命名空间**，不能重。

### `inbox`

`false`，或 `{ "messages": boolean, "notifications": boolean }`，两个键都必填。

| 组合 | 含义 |
| --- | --- |
| `false` | 不投 Inbox、不弹横幅；声明了 `inbox.post` / `notifications.post` 也算错 |
| `{ messages: true, notifications: false }` | 往 Inbox 投消息（`inbox.post`） |
| `{ messages: false, notifications: true }` | 只弹系统横幅（`notifications.post`），静默命令的回执用它 |
| `{ messages: true, notifications: true }` | 两条都开 |
| `{ messages: false, notifications: false }` | **不合法**：两项都不要就写 `false` |

### 跨字段规则（validate.mjs 与宿主同一份）

- `network.https` ⇔ `network`（`hosts` 与 `preferenceHosts` 至少一项，schema 管）；`process.run` ⇔ `process.executables`；`terminal.run` ⇔ `process.terminal`；
  `process.daemon` ⇔ `process.daemons`；`network.tunnel` ⇔ `process.tunnel`（SDK 2.10）；`files.read` ⇔ `files`；`git.hosting.write` ⇔ `git.mutations`。
- `system.proxy` ⇒ `process.daemon`：系统代理只能指向这个扩展自己在跑的常驻进程，没有常驻进程可起的扩展申请到了也永远打不开它。
- 常驻进程：`id` 不重；含 `{` 或 `}` 的参数必须恰好是 `{config}` 或 `{workdir}`；至少用其中一个；用了 `{config}` ⇔ 声明了 `config`。
- `network.preferenceHosts` 的每一项都是本扩展（设置域或任一服务）声明的 `urlList` 偏好的 key。
- 声明了任一项 `git.*` 能力 ⇒ 入驻 Git 域（`contributes.git`）。
- `inbox.messages` ⇔ 声明 `inbox.post`；`inbox.notifications` ⇔ 声明 `notifications.post`；`inbox: false` 时两项都不能声明。
- 任一命令带 `hotkey` ⇔ 声明 `hotkeys.register`；两条命令不能用同一个快捷键。
- `presentation: "toolbox" | "popover"` ⇒ 入驻工具箱域；`"window"` ⇒ 入驻窗口域；`"silent"` ⇒ 至少一种交结果的能力。
- 命令 id 不重；`/` 指令词（含别名）不重、不与内置撞；服务 id 不重；偏好 key 全局不重。
- `select` / `multiselect` 的默认值在 `options` 里；`number` 的默认值在上下界之间。
- `toolbox.keywords` / `window.keywords` 不重复名字与说明里已经有的词。

## Usage

```bash
node scripts/validate.mjs                 # 校验全部扩展（含跨扩展的 / 指令词冲突）
node scripts/validate.mjs extensions/foo  # 校验一个
```

脚本检查：schema、保留 id、目录名 = id、跨字段规则、`main` 指向的文件存在且 ≤ 512 KB、bundle 不含
`XMLHttpRequest` / `WebSocket` / `require(` / `importScripts` / `eval(` / `new Function(`、bundle 是用 SDK 构建的、有 README。
`version` 相对主干递增由 `check-pr.mjs` 在 PR 里查。SF Symbol 是否存在脚本查不了（符号表只在 macOS 上）。

## Gotchas

- `name` 与各处说明是**中文优先**的；英文名放进 `keywords`。
- 改 `id` 等于换一个扩展：安装记录、授权、偏好、钥匙串全部按 `id` 隔离，旧的不会迁移。
- `capabilities` 里多声明一项而代码里没用到，审核会问；少声明一项而代码里用到了，运行时得到 `capability.undeclared`。
- 受限执行的参数组合里出现「为了以后可能用到」的那一组，审核不通过。
- v1 的 `toolbox.symbol/name`、`commands`、`settings`、`background`、`workspace`、`bigquery`、`inbox.cards` 都不存在了——schema 会直接拒。
- 顶层 `git`（声明对象）与 `contributes.git`（域）是两样东西：前者说「我会改什么」，后者说「我在 Git 里出现在哪」。
- 用了 `jarvis.git` 或 `project.engine` 的扩展写 `"sdk": "^2.1.0"`：SDK 是内联进产物的，2.0 的 SDK 里没有这两样。
- 用了 `jarvis.android`（`android.apps.read` / `android.tools.open`）或 `row.image` 的扩展写 `"sdk": "^2.4.0"`。
- 用了 `jarvis.apps`（`apps.read`）或实现 `launcher.apps` 的扩展写 `"sdk": "^2.5.0"`。
- 实现 `code.format`、或用了 `process.run` 的 `stdin` / `directory` / `output` 的扩展写 `"sdk": "^2.7.0"`。
- 实现 `code.highlight` 的扩展写 `"sdk": "^2.8.0"`。
- 入驻菜单栏域、用了 `jarvis.daemon` / `jarvis.systemProxy`、`urlList` 偏好或 `network.preferenceHosts` 的扩展写 `"sdk": "^2.9.0"`。
- 常驻进程的 `executable` 不得是解释器（`sh`、`bash`、`zsh`、`python3`、`node`、`osascript`）：`sh {config}` 等于把配置文件当脚本跑，
  「扩展能决定的只有配置文件的内容」就成了「扩展能跑任何东西」。schema 与校验脚本拦不住这一条，靠审核（[13](13-review-checklist.md)）。
  这两项能力**没有声明对象、不要入驻哪个域**：宿主跑的是它自己写死的 adb 命令，扩展只给序列号与包名（[06](06-capabilities.md)「Android 操作域」）。

## Related Links

- [`schemas/extension.v2.schema.json`](../schemas/extension.v2.schema.json)、[`schemas/registry.v2.schema.json`](../schemas/registry.v2.schema.json)
- [05 · 能力授权模型](05-permissions.md)
- [06 · 能力接口目录](06-capabilities.md)
- [10 · 设置域与服务扩展点](10-settings.md)
- [11 · Inbox 通路](11-inbox.md)
