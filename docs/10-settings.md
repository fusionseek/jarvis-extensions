# 设置域与服务扩展点

## Overview

扩展的设置**一律由宿主画**：扩展在 manifest 里声明偏好的类型与约束，宿主用设置页自己的控件画出来，
读起来与内置设置没有区别。扩展页面里**不许再画一份设置**——同一个值两处可改，总有一处画着旧值。

设置画在哪里取决于它属于哪个域：

| 偏好声明在 | 画在 | 为什么 |
| --- | --- | --- |
| `contributes.settings.preferences` | 设置 › **扩展** › 该扩展那块面板 | 它是这个扩展自己的设置 |
| `contributes.services[].preferences` | 那个扩展点所属的**内置区段**，例如 `junkClean.engine` → 设置 › **清理** › 清理引擎，`project.engine` → 设置 › **Git** | 服务扩展是内置能力的一部分：用户找「深度清理怎么设」会去「清理」，不会去「扩展」 |

两者共用一个值空间（`extension_preferences` 里 `<id>` 那一行），`jarvis.preferences` 一并读到；key 不得重名。

## Concepts

### 设置 › 扩展

区段在索引栏里只有一项，内容随安装而变：一块**扩展商店**面板，然后每个已装扩展一块面板。

**扩展商店面板**回答「数据从哪来、什么时候的、在本机哪里」：

| 行 | 内容 |
| --- | --- |
| 来源 | 「扩展商店」+ 公开仓库名 + 同步状态；「立即同步」 |
| 本机快照 | 快照目录、大小；「在访达中显示」 |
| 每 30 分钟自动检查 | 玻璃开关。关掉之后只有用户按「立即同步」或商店里的「刷新」才联网 |

v1 的「开发者模式 · 从本地目录加载」已删除：v2 只从商店装（本地怎么调见 [12](12-developer-guide.md)）。

**每个已装扩展一块面板**（`ExtensionInstalledPanel`）：

| 段 | 内容 | 为什么 |
| --- | --- | --- |
| 头行 | 图标井 + 名 + 版本 + 状态徽标 + 启用开关 | 与集成行（Codex / Claude）同构 |
| 第二行 | 描述 · 作者 · 「查看源码」 | 用户要知道这是谁写的 |
| 入驻 | 「入驻：工具箱 · 窗口 · 指令 /http · 菜单栏 · 设置」；有服务的另写一句「「深度清理（Mole）」的开关与设置在 设置 · 清理」（项目引擎写「设置 · Git」） | 在这里找不到服务的开关，是因为它在「清理」里——说出来，用户就不会以为丢了 |
| 在菜单栏显示（SDK 2.9） | 入驻了菜单栏域的扩展多一颗玻璃开关，默认开；关掉 = 拿掉图标、不发 `start` | 菜单栏是所有应用共用的一条窄带，用户得能不要它而不必停用整个扩展。它是宿主替这个扩展记的一个值（扩展偏好表的宿主命名空间 `<id>#host`，键 `menuBar.visible`），扩展读不到也改不了 |
| 菜单栏自己的设置（SDK 2.10） | `contributes.menuBar.preferences` 点名的那几项偏好，缩进一级画在「在菜单栏显示」下面；图标关着时置灰。通用偏好列表里不再重复画 | 「菜单栏显示速率」与那枚图标是同一件事；排在授权与十几项偏好之后，仓库主人问「这块的配置在哪」 |
| 在悬浮球上显示（SDK 2.10） | 声明了 `contributes.orb` 的扩展多一颗开关，默认开；关掉 = 悬浮球上不画它那一层（`orb.update` 照样兑现） | 悬浮球是 Jarvis 的主入口，用户得能把扩展的读数从上面拿掉。同样存在 `<id>#host`，键 `orb.visible` |
| 网络助手（SDK 2.10） | 声明了 `network.tunnel` 的扩展多一行：未安装 / 已安装 · sing-box 版本 / 需要更新，以及「卸载」 | 它是一个以管理员身份运行的 LaunchDaemon：装是扩展第一次开增强模式时触发的，卸只能在这里（要管理员密码），扩展做不了 |
| 全局快捷键 | **只列真的注册上了的**，脚注「按了没反应多半是别的应用占着同一组键」 | 跨应用撞键探测不到；没注册上的不列，列表本身就是诊断 |
| 指令冲突 | 撞了内置词或别的扩展、因而没加载的 `/` 指令，逐条用 `alert` 色写出来 | 不写出来，用户只会觉得「装了却没有这条指令」 |
| 授权 | 声明的每一项一行：符号 + 名 + 档位 + 「还没问过」（若是）+ 玻璃开关 | 拨动即生效，前台与后台会话都收到 `permissionsChanged`（[05](05-permissions.md)） |
| 偏好 | `contributes.settings.preferences`，按 manifest 顺序，控件见下 | — |
| 页脚 | 「本地 x · 扩展商店 y」；「更新到 y」；「卸载」与「卸载并删除数据」，都是**就地两步确认** | 卸载不弹 modal；数据删不删是用户的决定 |

这一版**不能在这里改键**：快捷键取 manifest 的默认值，注册不上就不列。

### 设置 › 清理 · 清理引擎（`junkClean.engine`）

```text
完全磁盘访问权限                                    [重新检测] [去授权]
清理引擎
  Jarvis 清理  [使用中]   内置的清理引擎：只清不需要管理员权限的缓存、日志与废纸篓……
  深度清理（Mole）  扩展「Mole 深度清理」            [可用]   (开关)
      mo 1.20.0 · /opt/homebrew/bin/mo                [在终端中安装] …   ← status.summary / actions
      · 须知 1 / 须知 2                               ← services[].notes
      mo 命令路径 / …                                 ← services[].preferences
清理之前请知道
  · 不想被清的目录写进 ~/.config/mole/whitelist（一行一个路径），Jarvis 清理认这一份。
```

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 宿主不认识任何具体的外部引擎 | 每个服务引擎一行：标题 / 副标题 / 须知来自 manifest，状态与动作来自它的 `status`，设置来自它的 `preferences` | 换一个引擎扩展不需要动宿主 |
| 同一时刻至多一个开着 | 打开 = 选它；关上 = 回到 Jarvis 清理。选择存在 `UserDefaults` 的 `junkClean.engine`（`native` 或 `<扩展 id>/<服务 id>`） | 单值标量偏好，按门禁留在 `UserDefaults` |
| 第一次打开时授权 | 它声明的能力里还有没问过的 → 设置窗口里一扇 420×520 的授权 sheet，列**全部**声明；点头之后才选上；「暂不」= 不选它、什么都不记 | 后台会话没有界面可以问，只能在用户打开开关的那一下问 |
| 徽标 | 检测中 / 可用 / 使用中 / 未就绪 | 状态不能只靠颜色 |
| 动作 | `status.actions` 每项一颗 chip（`prominent` 的那颗实心）；按下去调 `action(id)`；回来的 `watchStatus` 让宿主每 2 秒重问一次 `status`，最长 10 分钟 | 装工具这类事在终端里跑，宿主看不见它何时完成，只能轮询 |
| 用不了的时候 | 「用不了的这段时间，清理照常进行，用的是 Jarvis 清理；结果页会写明这一点。」 | 清理不因为一个扩展的状态而整个失灵 |
| 选中的引擎被卸载 / 停用 | 「之前选的清理引擎已经不在了……这段时间用的是 Jarvis 清理。重新装上它，选择还在。」 | 选择不被清掉，装回来就接着用 |
| 一个引擎扩展都没装 | 「想要更深的清理？」+「去扩展商店」 | 告诉用户这条路在哪 |

悬浮球不变：清理中的状态由宿主照旧画，与用的是哪个引擎无关（悬浮球不对扩展开放）。
清理工具面板上那张引擎状态卡同样由宿主画，读的是同一份 `status`。

### 设置 › 全局搜索 · 应用目录（`launcher.apps`，SDK 2.5）

全局搜索（⌥Space 那条启动条，与默认页搜索栏同一个视图）里的本机应用：普通打字时结果里出应用，输入 `app ` 进按组排开的图标网格
（按住进编辑态移到废纸篓、右键在访达中显示）。**网格与搜索结果由宿主画**——扩展的界面只能画在面板里，画不进全局搜索那只框；
扩展交出的只有一份目录：怎么分组、组里先后、搜索里出不出与出几条。

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 有没有它 | 没有启用着的 `launcher.apps` 时，搜索结果里没有应用，`app ` 视图只写一句「装上扩展「应用」……」 | 宿主没有应用目录的规则 |
| 几个 | 多个扩展都实现时取安装在先的那一个 | 一只全局搜索只有一份网格 |
| 什么时候问 | 每次唤出全局搜索、默认页搜索栏出现时问一次 `catalog`；手上的目录先照用，回来再换上 | 扩展的设置改了，下一次唤出就按新的来 |
| 授权 | 服务在后台调，不弹授权屏：没授权时网格那里一行「还没获准读取本机应用 · ⏎ 打开它授权」，打开扩展的工具箱页（第一次进入时问） | 后台会话没有界面可以问 |
| 设置画在哪 | 设置 › 全局搜索 的「应用」一行只写谁提供、在哪改；分组排序这些是扩展自己的（参考实现放在它的工具箱页、存在 `jarvis.storage`） | 仓库主人：「工具箱中打开是针对全局搜索这块的一些显示设置」 |

**方法**（形状真源是 jarvis-mac `contracts/schemas/extensions/bridge.v2.schema.json` 的 `$defs.launcherAppsCatalog`）：

| 方法 | 入参 | 返回 | 超时 |
| --- | --- | --- | --- |
| `catalog` | — | `{ showInSearch, searchLimit（1–8）, groups: [{ id, title（≤ 40 字）, apps: [MacApp.id] }]（≤ 64 组） }` | 15 秒 |

宿主不认得的应用 id 丢掉、组里重复的去掉、空组不画、多出的字段整份拒收（写原因）。

### 设置 › Git · 代码格式化（`code.format`，SDK 2.7）

Git 文件 diff 页里**工作区那一份**文件（未暂存 / 已暂存改动的工作区一侧、搜索打开的仓库文件）的「格式化」（⌥⇧F）：宿主按文件名认出语言，
交给实现了 `code.format` 的扩展，拿回格式化之后的全文，先给用户看对比（现成的对比正文，左「当前」右「格式化后」），用户点「写入文件」才改；
写入之后一颗「撤销格式化」。**宿主里没有任何一种语言的格式化规则**——哪种语言用哪个工具、什么参数，全在扩展。
（jarvis-mac `specs/20261020-181305-branch-folders-blame-fullscreen-code-format-log-duration` C。）

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 有没有它 | 没有启用着的 `code.format` 时文件 diff 页没有「格式化」；设置 · Git 那一块只写去哪儿装 | 宿主没有格式化规则 |
| 语言 | 宿主按扩展名认：`java` `kotlin` `swift` `c` `cpp` `objc` `csharp` `python` `shell` `markdown` `javascript` `typescript` `json` `yaml` `css` `html` `go` `rust` `xml` `sql` | 「git 会识别打开的文件格式」：认语言是宿主的事，扩展只说自己认得哪几种 |
| 几个 | 每种语言取安装在先、说能用的那一个；都说不能用时取第一个认得它的（点了把原因告诉用户） | 一份文件一次只交给一个工具 |
| 什么时候问 | 设置 · Git 出现、切回应用、改了偏好时问 `describe`；点「格式化」时调 `format` | 工具是在终端里装的，切回来就该重查 |
| 授权 | 后台会话不弹授权屏：第一次点「格式化」（或设置 · Git 里点「授权」）时宿主弹 | 后台会话没有界面可以问 |
| 写回 | 宿主做：原子替换、保留文件权限；文件在格式化之后被改过就不写 | 用户在两次之间敲的字不能被一份旧文本的结果盖掉 |
| 设置画在哪 | 设置 › Git ·「代码格式化」：每个引擎一块——语言胶囊（能用的亮、不能用的灰，悬停写工具 / 原因）+ 它的服务偏好（工具路径） | 与清理引擎同一种做法 |

**方法**（形状真源是 jarvis-mac `contracts/schemas/extensions/bridge.v2.schema.json` 的 `$defs.codeFormat*`）：

| 方法 | 入参 | 返回 | 超时 |
| --- | --- | --- | --- |
| `describe` | — | `{ languages: [{ id, available, tool?, message? }] }`（≤ 64 项；宿主不认得的 id 丢掉） | 15 秒 |
| `format` | `{ language, fileName（不含目录）, text（≤ 1 MiB）, directory（宿主颁发的目录句柄） }` | `{ text（≤ 4 MiB）, tool? }`；格式化不了就抛错，`message` 写给用户看 | 60 秒，可取消 |

`directory` 只在这一次调用里有效：交给 `jarvis.process.run({ directory })`，格式化工具就在文件所在目录里跑；调用结束宿主收回。
参考实现：[`extensions/code-format`](../extensions/code-format)「代码格式化」。

### 设置 › 文件 · 文件动作（`files.actions`，SDK 2.13）

Jarvis「文件」（内置文件管理器）的**文件动作**：扩展在 `describe` 里报动作（名字、SF Symbol、认哪些类别 / 扩展名、文件 / 文件夹、几项、进不进转盘），
按选中的类型出现在长按转盘（紫色扇面）、右键菜单与「更多」里。点了之后宿主把文件句柄与一个空暂存目录的句柄交给 `run`，扩展经 `process.run` 的
`{ file }` / `{ output }` 把产物写进暂存目录、交回产物名；宿主把产物移进当前文件夹、选中、⌘Z 可撤销。（jarvis-mac `specs/20261031-080031-file-manager-p2-actions-ring` A。）

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 有没有它 | 没有启用着的 `files.actions` 时转盘只有内置动作 | 宿主没有任何一种转换 |
| 几个 | 每个服务至多 16 个动作；转盘一圈至多 8 片，内置固定五片在前，放不下进「更多」 | 转盘再多就读不清 |
| 授权 | `describe` 不要授权；第一次 `run` 之前问一次（面板里盖住内容区的一页、窗口里是 sheet） | 列动作不碰进程，执行才碰 |
| 路径 | 扩展看不到：文件与暂存目录都是这一次调用颁的句柄，调用结束收回 | 扩展只能碰用户亲手选中的那几个文件 |
| 产物 | 只收暂存目录的直接子项、不收符号链接；重名按「名字 2」避开；用户点 ✕ 取消时做了一半的产物不收 | 不让扩展借产物把别处的东西「交」出来 |
| 设置画在哪 | 设置 › 文件 ·「文件动作」：它报的动作、偏好、授权与「重新检测」 | 工具多半在终端里装，切回来重问 |

参考实现：模板 `templates/file-actions-sample`（系统自带的 sips 把图片转成 PNG / JPEG / HEIC）。

### 设置 › Git · 代码高亮（`code.highlight`，SDK 2.8）

Git 文件 diff 页（File View / Diff View）与 Blame 的**语法高亮**：宿主按文件名认出语言，把左右两份文本交给实现了 `code.highlight` 的扩展，
扩展交回记号（哪一段是关键字、字符串、注释……），宿主按记号种类上色。**扩展不定颜色**（本仓库不许自定义颜色值）；**宿主里没有任何一种语言的语法规则**。
（jarvis-mac `specs/20261020-181305-branch-folders-blame-fullscreen-code-format-log-duration` E。）

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 有没有它 | 没有启用着的 `code.highlight` 时 Git 里的代码照原样白字 | 宿主没有语法规则 |
| 语言 | 与 `code.format` 同一张表（`CodeLanguageID`） | 认语言是宿主的事 |
| 几个 | 每种语言取安装在先、说认得它的那一个；还没问到的也交过去试 | 一份文本一次只交给一个扩展 |
| 授权 | 不弹：着色扩展应当是纯计算（参考实现 `capabilities: []`） | 打开一个文件就弹授权屏不合理 |
| 出错 | 宿主照原样白字画，不报错、不提示 | 着色是锦上添花，坏了不该挡住看代码 |
| 缓存 | 宿主按（扩展、语言、文本）缓存 32 份 | 在 File / Diff / Blame 之间切、重开同一个文件不再问 |
| 设置画在哪 | 设置 › Git ·「代码高亮」：只读——谁提供、认得哪几种语言 | 着色没有要用户调的东西 |

**方法**（形状真源是 jarvis-mac `contracts/schemas/extensions/bridge.v2.schema.json` 的 `$defs.codeHighlight*` / `codeSyntaxKind`）：

| 方法 | 入参 | 返回 | 超时 |
| --- | --- | --- | --- |
| `describe` | — | `{ languages: [语言 id] }`（≤ 64；宿主不认得的丢掉） | 15 秒 |
| `highlight` | `{ language, documents: [文本]（1–2 份，各 ≤ 1 MiB，行以 \n 分隔） }` | `{ kinds: [记号种类], documents: [[起点, 长度, 种类下标, …]] }`：起点是整份文本里的 UTF-16 下标，按起点递增、互不重叠，合起来 ≤ 300,000 个记号 | 30 秒，可取消 |

记号种类：`keyword` `type` `string` `number` `comment` `function` `constant` `attribute` `preprocessor` `variable` `property` `tag` `heading` `emphasis` `link` `code` `quote` `marker`。
跨行的记号（块注释、多行字符串）照原样给，宿主按行拆。参考实现：[`extensions/code-highlight`](../extensions/code-highlight)「代码高亮」。

### 设置 › Git · 项目引擎（`project.engine`）

项目引擎是 Jarvis「项目」（需求 / 迭代 / 缺陷的原生表格与甘特）的**数据来源**。宿主有一整套提供方无关的框架——
工作项、通用字段、映射配置、工作流约束、漂移守卫、本地镜像、界面；**某一家托管服务的专属知识**（GraphQL、字段类型翻译、
Issue Type / 子 Issue / blocked by 的读写）全在引擎扩展里。先例是清理引擎：宿主有清理框架与界面，Mole 只是一台引擎。

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 有没有它 | 没有启用着的项目引擎时，工作区「项目」、Git 左栏 Projects、Issue 预览页的 Project 行、Git 设置「Project 关联」**都不出现** | 宿主不认识任何一家托管服务的 Project；没有引擎就没有数据 |
| 设置画在哪 | 设置 › Git，引擎入驻的那个托管服务下（manifest `contributes.git.hosting`）：「Project 关联」区段；服务的 `preferences` 也画在这里 | 用户找「Project 怎么关联仓库」会去 Git，不会去「扩展」 |
| 授权 | 第一次用它之前（打开「项目」或「Project 关联」）挂一次授权屏，列全部声明；只授予读、没授予写 = 只读浏览，编辑入口置灰 | 后台会话没有界面可以问 |
| 卸载 | 镜像随之删除；映射配置与 Git 侧关联设置是用户写下的内容，保留（再装即恢复） | 镜像随时能重新同步，配置是用户花时间做出来的 |
| 引擎 id | `<扩展 id>.<服务 id>`（例如 `github-project.github`） | 镜像、配置与 Git 关联都按它归属 |

**方法**（入参在线缆的 `params.request` 里，SDK 把它作为第一个参数交给实现；类型见 [`sdk/src/services.ts`](../sdk/src/services.ts)，
形状真源是 jarvis-mac `contracts/schemas/extensions/bridge.v2.schema.json` 的 `$defs.projectEngine*`）：

| 方法 | 入参 | 返回 | 超时 |
| --- | --- | --- | --- |
| `describe` | — | `{ contractVersion, ready, summary, problem?, hosting, features[] }` | 15 秒 |
| `listProjects` | `owner?`、`repository?`（`owner/name`） | `{ projects[] }`（≤ 200） | 45 秒 |
| `readSchema` | `projectId` | `{ project, fields[] }`（字段 ≤ 100） | 45 秒 |
| `readItems` | `projectId`、`cursor?`、`since?`（ISO 8601）；或只带 `itemIds`（1–100 个条目 id，SDK 2.6，声明了 `readItemsById` 才会收到） | `{ items[], nextCursor?, totalCount? }`（一页 ≤ 100）；按 id 读时只交回还在这个 Project 里的那几条、不带 `nextCursor` | 60 秒 |
| `applyEdit` | `projectId`、`itemId`、`contentRef?`、`changes[]`（1–16 步） | `{ item? }`：读回的那一条 | 45 秒 |
| `createField` | `projectId`、`name`、`dataType`、`options?`、`iterationDurationDays?` | `{ field }` | 45 秒 |
| `createOption` | `projectId`、`fieldId`、`name` | `{ field }`（已有选项的 id 不变） | 45 秒 |
| `createIteration`（SDK 2.2） | `projectId`、`fieldId`、`name`、`startDate`（`YYYY-MM-DD`）、`iterationDurationDays` | `{ field }`（已有迭代——含已结束的——的 id 不变） | 45 秒 |
| `createItem`（SDK 2.3） | `projectId`、`repository`、`title`、`body?` | `{ item }`：建好、已加进 Project 的那一条 | 45 秒 |
| `addItem`（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` I-1） | `projectId`、`repository`、`number` | `{ item }`：把仓库里已有的那条 Issue 加进 Project 之后读回的那一条（已经在里面时交回原条目，幂等）；不写字段 | 45 秒 |

| 契约规则 | 值 | 为什么 |
| --- | --- | --- |
| 只交原始值 | 字段值六种形状恰好一种：`text` / `number` / `date` / `optionId` / `optionIds` / `iterationId` | 翻译成通用字段、工作流校验、漂移守卫都在宿主——**所有引擎同一套规则**，换引擎不换规则 |
| 日期与时刻 | 日期是 UTC 日历日 `YYYY-MM-DD`；时刻是 ISO 8601 | 甘特按天画；跨时区的同一天不能变成两天 |
| 字段类型 | `text`、`number`、`date`、`singleSelect`、`multiSelect`、`iteration`（可建），`title`、`assignees`、`labels`、`milestone`、`repository`、`issueType`、`parentIssue`、`subIssuesProgress`、`linkedPullRequests`、`reviewers`（内置），认不出的写 `other` | 宿主的映射页按类型给出可选来源；`other` 不丢字段，只是不能映射 |
| 条目身份 | Issue / PR 必须带 `content.repository`（`owner/name`）与 `content.number`；草稿没有 | 父子、依赖、Git 关联都按 `owner/name#number` 认；缺了的条目宿主丢掉这一条，不丢整页 |
| 选项按 id 认 | 映射记的是选项 id，不是名字 | 选项改名不该让映射失效；`createOption` 因此必须保住已有选项的 id |
| 迭代按 id 认 | 条目上的迭代值记的是迭代 id | GitHub 的迭代配置是整组替换：`createIteration` 只写进行中的会把已结束的迭代连同条目上的值一起删掉 |
| 编辑只执行 | `applyEdit` 的每一步宿主都按工作流、必填与漂移守卫校验过 | 引擎再判断一遍只会与宿主分歧 |
| 失败 | 抛错；`message` 原样显示在发起处 | 用户要知道是哪一步、被谁拒了 |
| 按 id 读 | `itemIds` 里请求了却没交回的，宿主当作「已移出 Project」从列表与镜像里去掉；所以读失败（权限、限流、超时）必须抛错，不能交回一个空页 | 「刷新本视图」只重读眼前这几条：全量翻页要十几次请求，按 id 一次 100 条 |
| 可选能力 | `describe.features` ⊆ `nativeHierarchy`、`nativeDependencies`、`issueTypes`、`createFields`、`draftIssues`、`createIterations`（SDK 2.2）、`createItems`（SDK 2.3）、`readItemsById`（SDK 2.6）、`addItems`（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` I-1）；`contractVersion` 当前是 1 | 没声明的那一项，宿主把对应入口置灰并说明；契约只追加不改名 |

参考实现：[`extensions/github-project`](../extensions/github-project)（GitHub Projects v2）。

### 偏好控件

控件由宿主画（`ExtensionPreferenceRows`，设置 › 扩展 与 设置 › 清理 共用），左标题 + 说明，右控件：

| `type` | 控件 | 行为 |
| --- | --- | --- |
| `toggle` | 玻璃开关 | 切换即写入 |
| `text` | 单行输入，宽 180；`monospaced` 时等宽 | 回车**或失焦**提交（填完直接去点别处的用户会以为自己改过了）；超过 `maxLength` 截断；**清空 = 恢复默认**（一个空着的命令路径只会让扩展下一次调用时报一句看不懂的错）；与默认值不同时右边一颗「恢复默认」 |
| `number` | 单行输入，宽 80 | 解析不了回填原值；越界**夹到** `minimum…maximum` |
| `select` | 下拉菜单，宽 180 | — |
| `multiselect` | 一列复选框 | 每点一下写一次 |
| `secret` | 遮罩输入 + 「已保存」徽标 + 「清除」 | 回车保存；只写不读，设置页从不回显；存钥匙串（service `ai.fusionseek.jarvis.extension-secret`、account `<扩展 id>.<key>`），不进 SQLite、不进日志 |
| `directory` | 缩写路径 +「选择…」 | 走 `NSOpenPanel`，只能选目录；存为字符串 |
| `urlList`（SDK 2.9） | 一行一条 + 删除 + 「添加一行」，至多 `maxItems` 行（省略 = 10，上限 20） | 宿主逐条校验：每条必须是带主机名的 `https://` 地址，填错的那一行标红、不存；`secret` 省略 = `true`：整列进钥匙串，设置页按 `secret` 的方式遮罩，`all()` 与 `onChange` 里都没有它。存的是字符串数组。SDK 2.10 起往一行里**粘贴多行**会按行拆成多条（去空行、去重、超出 `maxItems` 的截掉并提示）——「复制这些地址」再贴进来就是这么用的 |
| `executable`（Jarvis 3.2.8） | 与设置页「APK 扫描工具链」同构的一行：左标题 + 说明，下面一行**生效路径 · 来源**（自动发现 / 自定义路径），右端状态徽标（已就绪 / 未找到 / 路径无效）+「选择」+（选过才有）「清除」 | 判定与常驻进程、TUN 起内核用的是同一份（空值按名字在 Homebrew、`~/.local/bin` 等固定位置里找；选过的路径坏了**报坏、不回落**自动查找；文件名必须等于 `executable`）。「选择」走 `NSOpenPanel`（显示隐藏文件），文件名不对或不可执行的不存、就地说原因。没找到且写了 `install` 时一行问题 +「在终端中安装」：跑 manifest 里那段 `process.terminal` 脚本——这是用户在宿主界面上亲手点的，不看 `terminal.run` 的运行时授权。不轮询安装结果：Jarvis 回到前台时重查一次。存为字符串，空串 = 自动查找 |

写入之后宿主立刻告诉此刻活着的前台与后台会话：`preferencesChanged` 事件，SDK 里是 `jarvis.preferences.onChange`。
默认值来自 manifest；库里没有那一项时读默认。**用户改过的值在扩展更新后保留**；manifest 里删掉的 key 留着不读，
「卸载并删除数据」时一并删。

### 扩展怎么读

```ts
const path = await jarvis.preferences.get("moPath");        // 普通值与 secret 都用 get
const all = await jarvis.preferences.all();                 // 不含 secret
jarvis.preferences.onChange((changes) => { /* 不含 secret */ });
await jarvis.system.openExtensionSettings();                 // 页面里一颗「在设置里调整」link
```

`jarvis.preferences.set(key, value)`（SDK 2.10）只认自己声明过的 `toggle` / `select` / `number`，按声明校验：菜单、页面里的开关与设置页那一项同一份真源
（[06](06-capabilities.md)）。其余几种只能引导用户去设置页——`openExtensionSettings()` 打开设置并**滚到这个扩展那块面板**；菜单栏末尾「「名」的设置」同一条。

`urlList`（SDK 2.9）读回来是字符串数组；它没有默认值，没填过时按空处理。它存在的理由是联网：manifest `network.preferenceHosts` 点名它之后，
用户在这里填的地址的主机就放行给 `net.fetch`（[06](06-capabilities.md)「`network.https`」）。只认这种偏好，是因为它的控件由宿主画、
值只可能来自用户亲手输入——页面里的输入框扩展自己就能填，宿主分不出是谁写的。订阅地址里的 token 就是密码，所以默认进钥匙串。

`executable`（Jarvis 3.2.8）读回来是字符串：空串 = 让宿主自动查找，非空 = 用户选的那一份的绝对路径。原样交给要它的能力即可，不必自己判断：

```ts
const { singBoxPath } = await jarvis.preferences.all();
await jarvis.daemon.start({ id: "sing-box", config, ...(singBoxPath ? { executable: singBoxPath } : {}) }); // 空串时宿主按名字找
```

```ts
const subscriptions = (await jarvis.preferences.get<string[] | undefined>("subscriptions")) ?? []; // 默认 secret：只能 get 单独读
for (const url of subscriptions) await jarvis.net.fetch(url);                   // 主机在请求那一刻按此刻的值放行
```

## Usage

1. 扩展自己的设置：写 `contributes.settings.preferences`；服务的设置写在那个服务的 `preferences` 里。
2. 每一项写清 `title` 与 `description`：description 是用户在设置页看到的唯一解释。
3. 读值用 `jarvis.preferences.get`；用户改了要跟着变就订阅 `onChange`。

## Lifecycle / Disposal

- 关掉启用开关：前台会话关掉、后台会话收走、工具箱行消失、`/` 指令与快捷键撤下、选中的服务引擎退回 Jarvis 清理、
  项目引擎的入口（「项目」、Projects 分组、Project 关联）收起；授权与偏好原样留着。
- 卸载：删安装目录、`extension_installs` 与 `extension_grants`；选「卸载并删除数据」才删 `extension_preferences`（偏好与 `storage`）与钥匙串里的机密。

## Gotchas

- 服务的偏好**不**出现在设置 › 扩展：去它扩展的那个内置区段找。
- `number` 越界是夹取不是拒绝；需要更严的范围就把 `minimum` / `maximum` 写严。
- `secret` 没有默认值、`all()` 里没有它：只能 `get(key)` 单独读。`urlList` 默认同理（`secret: false` 才进 `all()`）。
- `network.preferenceHosts` 只认 `urlList`：点名一个 `text` 偏好，校验脚本与宿主都拒。
- `executable` 偏好没有输入框：想让用户手填路径就用 `text`（但那样设置页看不出找没找到）。它点名的程序与安装脚本都必须在 manifest 里声明过。
- 设置 › 扩展 的快捷键行只列注册上了的；这一版不能改键。

## Related Links

- [03 · manifest 规范](03-manifest.md)
- [05 · 能力授权模型](05-permissions.md)（撤销、服务的授权 sheet）
- [06 · 能力接口目录](06-capabilities.md)（`jarvis.preferences`）
- `jarvis-mac/Sources/Jarvis/UI/ExtensionSettingsSection.swift`、`ExtensionPreferenceControls.swift`、`JunkCleanSettingsSection.swift`、
  `App/JunkCleanEngineRegistry.swift`
- `jarvis-mac/Sources/Jarvis/App/Projects/ProjectEngineRegistry.swift`、`ProjectEngineClient.swift`、
  `Domain/Extensions/ExtensionProjectEngineContract.swift`（项目引擎的注册、调用与载荷解码）
- `jarvis-mac/specs/20261028-091917-proxy-extension-menubar-daemon/spec.md` P-2（「在菜单栏显示」）、P-5（`urlList` 与 `network.preferenceHosts`）
