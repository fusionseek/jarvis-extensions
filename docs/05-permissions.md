# 能力授权模型与授权屏

## Overview

内置能力是 Jarvis 的一部分，用户装 Jarvis 时把权限给了它；扩展是别人写的。
因此**扩展能碰到的每一项宿主能力都要用户点一次头**，点头之前调用得到的是一个结构化的拒绝。

三条边界叠在一起：

| 层 | 谁说了算 | 扩展看到什么 |
| --- | --- | --- |
| 声明 | manifest `capabilities[]`，以及受限执行的声明对象（可执行文件与参数、文件、脚本） | 没声明就调、或对象不是声明过的那一个 → `capability.undeclared` |
| 用户授权 | `extension_grants` 表 | 没点头就调 → `permission.denied` |
| 系统权限 | macOS TCC（屏幕录制 / 辅助功能），属于 Jarvis | Jarvis 自己没拿到 → `permission.unavailable` |

扩展永远不直接面对系统的授权弹窗——那是 Jarvis 与用户之间的事。

## Concepts

### 什么时候问

| 入驻 | 何时问 | 在哪问 |
| --- | --- | --- |
| 有界面（工具箱 / 窗口） | **第一次进入**那一面时，一次问完 manifest 声明的全部能力 | 那一面里（面板页面或窗口标签）画授权屏，代替扩展的页面 |
| 服务 | **第一次启用**它时（例如在设置 · 清理 里打开「深度清理（Mole）」）；项目引擎在**第一次用它之前**（打开工作区「项目」或 Git 设置「Project 关联」） | 设置窗口或工作区里一扇 sheet（420×520），同一个授权屏 |
| 只有指令 | 第一次按下它的快捷键或回车它的 `/` 指令时 | 有界面的命令：唤出那一面先问；静默命令跑在后台会话里，**不问**，没点头的能力照常拒绝 |

不在安装时问：装了没用过的扩展不该拿着任何能力。不在每次调用时问：一个每按一下就弹一次的工具教会用户闭着眼点允许。

**后台会话从不弹授权**：它没有可以承载授权屏的界面。服务的授权在启用时问过；静默命令要的能力，
用户可以在设置 › 扩展 里那块面板上打开。

之后再问只有两种情形：

| 情形 | 范围 |
| --- | --- |
| 更新后的版本**新增**了能力 | 下一次进入时只列新增的那几项（已有的授权不动） |
| 扩展调用 `jarvis.permissions.request(ids)` | 只列传进来的、且 manifest 声明过的那几项；后台会话里不弹，直接答此刻的授权 |

### 授权屏长什么样

逐条列出声明的能力，每项一行：符号 + 名字 + 风险档位 + 玻璃开关，下面是扩展写的 `reason`，
高风险那几项再加一句**宿主自己写**的话——`reason` 是扩展说的话，这一句是宿主说的、这台机器上会发生什么：

| 能力 | 宿主那一句 |
| --- | --- |
| `screenshot.capture` | 会看到你的屏幕 |
| `network.https` | 会访问：translate.googleapis.com, …；声明了 `network.preferenceHosts` 的再加「以及你在「‹偏好标题›」里填的地址所在的主机」 |
| `quickTransfer.control` | 会对局域网开一个端口 |
| `hotkeys.register` | 会注册全局快捷键 ⌥⌘T · ⌥⌘O |
| `process.run` | 会运行：mo clean、mo --version。**运行起来的命令拥有 Jarvis 的全部系统权限（含完全磁盘访问）** |
| `files.read` | 会读取：~/Library/Logs/mole/operations.log |
| `terminal.run` | 会在终端里执行：安装 Mole（脚本写在扩展的 manifest 里，执行过程在终端里看得见） |
| `process.daemon` | 会在后台常驻运行：sing-box run -c ‹配置文件› -D ‹工作目录›（manifest `process.daemons` 逐字列出） |
| `network.tunnel` | 会以管理员身份运行 sing-box 接管整机网络（TUN 增强模式）；第一次打开时要你输一次管理员密码，装上 Jarvis 的网络助手（SDK 2.10） |
| `browser.activeTab` | 会读你正在看的网页地址与标题（前台或最近一次用过的浏览器；每个浏览器第一次读时系统还会问一次「自动化」）（SDK 2.10） |
| `files.pick` | 会让你挑一个文件交给它读（只给你挑的那一份，拿不到路径）（SDK 2.10） |
| `git.hosting.read` | 会用你在 Git 服务里填的 token 读取数据；token 本身不交给扩展 |
| `git.hosting.write` | 会以你的身份修改：updateProjectV2ItemFieldValue、closeIssue、…（manifest `git.mutations` 逐字列出） |
| `android.apps.read` | 会经 adb 读连着的手机上装了哪些应用；读应用名与图标时把安装包临时拉到本机，读完即删 |
| `apps.read` | 会读这台 Mac 装了哪些应用（名字、位置、分类、最近打开时刻）；打开、删除应用由你在全局搜索里点，扩展做不了 |

- 默认全开、每条可单独关：用户要做的是"关掉不想给的"，不是"逐条勾上"。
- 主按钮写「允许 N 项」；全部关掉时变成「不授权，仍然打开」——用户关掉全部仍然可以进去看看，扩展要自己画出受限态。
- 「暂不」= 每一项都记成拒绝，仍然进去。之后改主意去设置页拨开关。
  服务那扇 sheet 上的「暂不」不一样：**不启用它，也什么都不记**——用户只是没打开那个开关，下次打开时照样再问。
- **授权屏上不允许出现扩展自己写的任何富文本**：`reason` 是 4–60 字的纯文本。扩展没有办法在这里画一个"允许"按钮骗用户。

### 撤销与查看

设置页「扩展」区段里每个扩展的面板有一段「授权」：每项一颗玻璃开关，还没问过的写「还没问过」（与"关着"不是一回事）。
拨动即生效：记进库、告诉此刻活着的前台与后台会话（`permissionsChanged`）；`hotkeys.register` 变了还会重新注册快捷键。
没有"一键全部允许"——那正是逐条确认要避免的东西。

### 扩展该怎么对待拒绝

`permission.denied` 与 `permission.unavailable` 是**状态，不是错误**。有界面的扩展必须能在没有任何授权的情况下画出一屏说得清楚的东西：

```ts
try {
  text = await jarvis.clipboard.read();
} catch (e) {
  if (e instanceof JarvisError && e.code === "permission.denied") {
    // 画一张 note：「没有读取剪贴板的授权」+ 一颗按钮 → jarvis.permissions.request(["clipboard.read"])
  }
  if (e instanceof JarvisError && e.code === "permission.unavailable") {
    // 画一张 note：「Jarvis 还没有屏幕录制权限」+ 一颗按钮 → jarvis.permissions.openSystemSettings("screenRecording")
  }
}
```

服务与静默命令没有界面：拒绝要写进它交回的东西里——服务的 `status` 写 `ready: false` 与原因，
静默命令发一条 Inbox 消息或横幅（若那一项也没点头，只能写一条日志）。

### 能力风险档位

档位是宿主对用户的承诺，写在 SDK 的 `capabilityTiers` 与宿主的 `ExtensionCapabilityID.tier` 里，扩展改不了：

| 档 | 能力 | 判据 |
| --- | --- | --- |
| 低 | `system.openURL`、`ocr.recognize`、`speech.speak`、`android.tools.open`、`files.pick` | 用户看得见后果，或只处理扩展已经拿到的东西，或只拿用户亲手挑给它的那一份 |
| 中 | `clipboard.read`、`clipboard.write`、`notifications.post`、`inbox.post`、`quickTransfer.status`、`hotkeys.register`、`git.repository.read`、`git.hosting.read`、`android.apps.read`、`apps.read`、`browser.activeTab` | 读或写用户自己的数据但不出本机；或占一组全局按键；或经宿主**只读**用户已经接上的 Git 服务；或经宿主的 adb **只读**用户连着的手机；或**只读**这台 Mac 装了哪些应用、此刻在看哪个网页 |
| 高 | `screenshot.capture`、`network.https`、`quickTransfer.control`、`quickTransfer.send`、`process.run`、`files.read`、`terminal.run`、`process.daemon`、`system.proxy`、`network.tunnel`、`git.hosting.write` | 看得见屏幕、出得了本机、开得了端口、跑得了命令、读得了文件、以用户的身份改远端数据、改整台机器的网络出口、以管理员身份接管全部流量 |

**受限执行为什么是高风险**：被允许 `process.run` 的扩展，跑出来的进程继承 Jarvis 的全部系统权限——
用户给 Jarvis 的完全磁盘访问，那个进程也有。声明对象逐字列在授权屏上，就是为了让用户知道自己允许的到底是哪一条命令。

**常驻进程与系统代理为什么是高**（SDK 2.9）：常驻进程与 `process.run` 一样继承 Jarvis 的全部系统权限，而且一直跑着、不跟任何页面走；
系统代理一旦接管，浏览器与大部分应用的流量都先经过这个扩展起的那个进程。宿主能硬拦的（只指向本机、要有自己在跑的进程、一个主人、进程没了自动还原）都拦了，
拦不了的是「那个进程拿到流量之后做什么」——那取决于它跑的是哪个工具、配置写了什么，只有授权屏上那一句与审核守得住。

**增强模式为什么是高**（SDK 2.10）：它以管理员身份运行、接管整机的全部流量——连不认系统代理的命令行工具与应用也算上。
宿主能硬拦的都拦了：只跑安装时拷进 root 目录、校验过哈希的那一份 sing-box；配置过一道守卫，任何文件路径、非回环监听都拒绝；TUN 段由宿主填；
Jarvis 不在了（退出、崩溃）内核立刻停；装与卸都要管理员密码，卸载只在宿主界面里。拦不了的仍是「拿到流量之后按配置做什么」，与系统代理同一档。

**Git 操作域为什么读是中、写是高**：读与写走的是同一把 token（用户在 设置 · Git · Git 服务 里填的），
但 token **从不交给扩展**——扩展交一份 GraphQL，宿主替它执行、把结果交回去。读只放行查询，碰到的是用户本来就看得到的东西；
写以用户的身份改远端（关 Issue、改 Project 字段），别人看得见、撤回要人工，因此是高风险，且只放行 manifest `git.mutations` 里逐字写出的变更。
`git.repository.read` 只给 Jarvis 最近打开过的仓库的名字与远端身份，**不给本机路径**。

**Android 操作域为什么读是中、交给工具是低**：`android.apps.read` 读的是用户自己手机上装了什么、占多大——不出本机，
但它是用户的数据（装了哪些应用本身就能说明很多事），因此与读剪贴板同档。它**不是受限执行**：adb 在宿主里跑、跑的是宿主写死的命令，
扩展只给序列号与包名，碰不到 adb 的任何参数，所以不像 `process.run` 那样高风险。读名字与图标要把安装包拉到本机临时目录，
宿主读完即删——授权屏上那一句写的就是这件事。`android.tools.open` 只是把内置工具打开、包名填好：开始与否仍是用户在那边按，
后果用户看得见，因此是低。

### 系统权限的借用

| 能力 | 依赖的系统权限 | Jarvis 没拿到时 |
| --- | --- | --- |
| `screenshot.capture` | 屏幕录制 | `permission.unavailable`；`openSystemSettings("screenRecording")` 走与截图引导同一个协调器：打开隐私面板并上「把 Jarvis 拖进列表」那扇浮窗 |
| `notifications.post` | 通知 | 被拒时静默不弹，**不算失败**——横幅本来就是"尽力而为" |
| `process.run` | 不借、不查 | 进程照常起，拿着 Jarvis 此刻有的全部系统权限；没有完全磁盘访问时，它读不到的东西就读不到 |

## Usage

- 有界面的扩展：每一项声明的能力都画一个拒绝态，并给一颗 `permissions.request` 按钮（只在用户按下时调）。
- 服务扩展：`status` 里先看 `context.granted`，缺了关键能力就 `ready: false` 并写清原因，不要硬调。
- 用户：设置 › 扩展 › 某个扩展 › 授权，逐项开关。

## Gotchas

- 「暂不」会把每一项都记成拒绝；下一次进入不再问，要改去设置页。
- 更新后新增的能力在下次进入时问；撤销过的不重问。
- `panel.*`、`window.open`、`storage.*`、`preferences.*`、`text.*`、`host.*` 不进授权屏——它们碰不到用户的数据。
- 只授予了 `git.hosting.read`、没授予 `git.hosting.write` 的项目引擎照样能读：宿主把「项目」里的编辑入口置灰（只读浏览），
  不是整块用不了。
  `copy` 节点写剪贴板也不需要 `clipboard.write`：那是用户按下复制钮的那一下。
- `permissions.request` 与 `panel.collapse` 只该在用户动作的回调里调用；宿主这一版没有硬拦，审核时查。

## Related Links

- [03 · manifest 规范](03-manifest.md)
- [06 · 能力接口目录](06-capabilities.md)
- `jarvis-mac/Sources/Jarvis/UI/FloatingExtensionHostView.swift`（`ExtensionConsentView`）、`App/Extensions/ExtensionGrantsModel.swift`、
  `App/PermissionHandoffCoordinator.swift`
