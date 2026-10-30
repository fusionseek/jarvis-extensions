# 能力接口目录（`jarvis.*` API 参考，SDK 2）

## Overview

扩展里那个全局对象 `jarvis` 的每一个命名空间，对应宿主里一个**已经存在**的模型：闸门放行之后调的是
`QuickTransferService.shared`、`AppModel.shared`、`ScreenshotCaptureCoordinator.shared`、系统剪贴板这些既有入口，
**不复制它们的逻辑**。因此扩展拿到的行为与用户在内置面板里做同一件事逐字相同：快传没开就是没开，剪贴板里的机密就是读不到。

v2 的目录**只列宿主真的做得到的**：声明得到、调不到的能力会让用户在授权屏上点了头，扩展却永远走不到那条路，
而两边都不会报错。v1 的粘贴板历史、速记、日历、任务、文件选择、BigQuery 因此全部删掉。

类型真源是 [`sdk/src/capabilities.ts`](../sdk/src/capabilities.ts)。全部方法返回 Promise，只有标了「同步」的纯函数工具例外。
错误一律是 `JarvisError`，`code` 见文末。

## Concepts

### 隐式能力（不需要点头）

#### `jarvis.sdk` / `jarvis.host` / `jarvis.environment`

| 属性 | 值 |
| --- | --- |
| `sdk.version` | SDK 版本，`2.13.0` |
| `host.version` / `host.channel` | 宿主版本（`CFBundleShortVersionString`）、`release` / `development` |
| `environment` | `reduceMotion` / `reduceTransparency` / `increaseContrast` / `locale`。界面上的适配由宿主做；这里给出来是让扩展自己的逻辑也能让步 |

#### `networkStatus()`（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）

单独导出的函数（`import { networkStatus } from "@fusionseek/jarvis-extension-sdk"`），不挂在 `jarvis` 上——没用到它的扩展打包时被摇掉。
线缆 `network.status`，隐式、只读：此刻的主网络接口 `{ kind: "wifi" | "ethernet" | "other", interface: "en0", name: "Wi-Fi" }`，没有网络为 `{ kind: "none" }`。
增强模式开着时 sing-box 的隧道会成为主接口，宿主照样报底下那块实体网卡。不读 SSID（macOS 14 起要定位授权）、不读地址。

#### `jarvis.ui`

| 方法 | 说明 |
| --- | --- |
| `update()` | 让宿主再调一次 `render()`。同一拍多次调用合并成一次提交；一面都没开着时是空操作。`ui` 事件回调之后宿主自动更新，**异步**回来的数据才需要手动调 |
| `dismissPopover()` | 撤掉这一轮的原地结果弹窗：这一轮没什么可给用户看的（框到的那块里根本没有文字）。在命令返回之前 `await` 它，SDK 那次自动提交就不会再开弹窗。后台会话里 `surface.unavailable` |

#### `jarvis.panel`（工具箱域）

| 方法 | 说明 |
| --- | --- |
| `hold(reason) → HoldHandle` | 告诉容器「此刻别自动收回」（文件在读、传输在跑、用户在盯进度）。事情做完必须 `release()`，离开扩展时宿主兜底释放。原地弹窗同样尊重它。后台会话里被拒（SDK 把这次拒绝吞掉：那里没有面板可摁） |
| `collapse()` | 把面板收成那颗球 |
| `present()` | 把它的界面叫到用户眼前：命令落点是窗口就开窗口，否则展开面板到这个扩展的页面 |

后台会话里 `panel.*` 一律 `surface.unavailable`。

#### `jarvis.window`（窗口域）

`open()`：在 Jarvis 工作区里打开这个扩展的标签（已经开着就切过去），前台会话随之 activate 在窗口那一面。
没有入驻窗口域、或在后台会话里调用 → `surface.unavailable`。

#### `jarvis.commands`

`run(id, argument?)`：运行 manifest 里声明的一条命令，与快捷键同一条路（`trigger = "page"`）。落点是 `silent` 的
去后台会话跑，其余在前台——宿主替你转到对的那一种。页面里那颗「截屏翻译」按钮就该这么写：一条命令只有一份实现。

SDK 2.12：第二个参数也可以是 `{ argument?, anchor? }`。`anchor: { statusItem }` 让 `popover` 命令的弹窗挂在**你自己的**那一枚状态项正下方
（manifest `contributes.menuBar.items` 里的 id；上沿离菜单栏下沿 4pt、水平居中、夹回屏内）；那一枚此刻没画出来时退回指针旁边。
不是 `popover` 命令、或状态项不是你声明的，报 `invalid.argument`。**再点那一枚状态项 = 关掉弹窗**，这一下不再发 `press`（`NSPopover` 的惯例）。
后台会话（菜单栏域）收到 `press` 之后就用它开一面：弹窗跑在前台会话里，规则与别的弹窗一样。

#### `jarvis.storage`

每扩展一个键值空间（库里 `extension_preferences` 的 `<id>#storage` 命名空间，与偏好分开存——否则一个 key 取成
`targetLanguage` 的 `set` 会改掉用户在设置页里选的语言）。

| 方法 | 限制 |
| --- | --- |
| `get(key)` / `set(key, value)` / `delete(key)` / `keys()` | 值必须可 JSON 序列化，单条 ≤ 64 KB，超出 `rate.limited` |

它是"记住上次输入了什么"那种量级，不是缓存、不会被淘汰；用户选「卸载并删除数据」时一起删。

#### `jarvis.preferences`

manifest `contributes.settings.preferences` 与各服务 `preferences` 里声明的值（共用一个命名空间）。
`get(key)` / `all()` / `onChange(listener)`；用户在设置页改动后触发 `onChange(changes)` 并自动重画。
`secret` 类型只能 `get(key)` 单独读（宿主从钥匙串取），`all()` 与 `onChange` 里都没有它。

`set(key, value)`（SDK 2.10，隐式、不要点头）：改自己声明过的一项。菜单、页面里的开关（「增强模式（TUN）」）与设置页是同一件事时，
只能有一份真源——扩展另记一份，工具箱开着、设置页关着（jarvis-mac `specs/20261028-130540-proxy-walkthrough-fixes` W-6）。

| 规则 | 为什么 |
| --- | --- |
| 只认 `toggle`（布尔）、`select`（选项里的值）、`number`（在 `minimum…maximum`、合 `step`） | 只改扩展自己的行为，写错了用户在设置页一眼看得见、点一下改得回 |
| `text` / `secret` / `urlList` / `directory` / `multiselect` 一律 `invalid.argument` | `urlList` 是 `network.preferenceHosts` 放行主机的依据，路径决定读哪、跑什么，机密进钥匙串：这几种只能来自用户亲手输入 |
| 写完与设置页编辑同一条通知：每个活着的会话（**包括写的那一个**）收一次 `onChange`，开着的设置页就地刷新 | 后台会话要据此跟上；写的那一方自己已经处理过的，用一笔自己的记号认出回声 |
| 每个会话每分钟至多 60 次 | 拨开关是用户点出来的，只挡死循环 |

#### `jarvis.permissions`

| 方法 | 说明 |
| --- | --- |
| `granted()` | 此刻拿到的能力 id 列表 |
| `request(ids)` | 再问一次，只能问 manifest 声明过的；返回 `{ granted, denied }`。后台会话里不弹，直接答此刻的授权 |
| `openSystemSettings("screenRecording" \| "accessibility")` | 打开系统设置对应隐私面板并上「把 Jarvis 拖进列表」浮窗 |
| `onChange(listener)`（SDK 2.13） | 授权变了（用户在授权屏或设置里点了头 / 收回）时回调，带此刻的授权；返回退订。只在本地听宿主已有的事件，线缆不变。后台会话没有 `activate`，靠它在用户点了「允许」之后补上订阅 |

#### `jarvis.system`

| 方法 | 能力 | 说明 |
| --- | --- | --- |
| `openExtensionSettings()` | 隐式 | 打开设置窗口（偏好、授权、快捷键都在 设置 › 扩展 里）。扩展页面里**不许再画一份设置** |
| `openURL(url)` | `system.openURL` | 只放行 https |

#### `jarvis.menuBar`（菜单栏域，SDK 2.9）

`update(model)`：推一份菜单栏模型——图标（`symbol`，省略 = manifest 的）、图标右侧的短字（`title` ≤ 16 字；2.10 起可以两行，每行 ≤ 10 字）、`tooltip`、菜单项 `items`
（`item` / `separator` / `header` / `submenu`，2.10 起还有流量曲线 `chart` 与 `item.tone`，子菜单至多三层；形状见 [07](07-ui-components.md#菜单栏sdk-29不是第四面)）。不要点头：它只改这个扩展自己那枚图标；
但只对入驻了菜单栏域（`contributes.menuBar`）的扩展放行，别的一律 `surface.unavailable`。

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 合并 | 先画、之后合并：距上一次画已过 ≥ 250 ms 的立即画，否则攒到 250 ms 末尾只画最后一份（SDK 2.11） | 挡的是「每帧推一次速率」；菜单栏不是动画画布。但悬停露出图标晚四分之一秒是看得出来的 |
| 缓存 | 宿主记着最后一份：后台会话空闲被收掉之后图标与菜单照旧在，点开 / 点选时宿主把会话唤醒再发事件 | 图标不能因为扩展的 JS 闲下来就消失或变回默认 |
| 上限 | 整份 ≤ 300 项（含子菜单里的）、子菜单至多两层、文字 ≤ 80 字；超出的部分宿主丢掉并记警告，不整份拒绝 | 一份超了一项的模型不该让整个菜单变空 |
| 固定项 | 菜单末尾宿主追加分隔线、「打开「名」」「「名」的设置」，扩展改不掉 | 菜单栏图标是扩展唯一常驻在屏幕上的东西，用户必须总能从它回到 Jarvis 管它的地方 |

事件（`start` / `open` / `select`，2.11 起还有 `press`）落到 `defineExtension({ menuBar })` 的回调，跑在后台会话，见 [12](12-developer-guide.md)。

**几枚状态项（SDK 2.11，jarvis-mac `specs/20261029-225323-menubar-manager-p1` N-1）**：manifest `contributes.menuBar.items: [{ id, title, symbol, placement? }]` 声明 1–4 枚，第一枚在最右、按声明顺序往左排；不写 = 一枚 `main`。
`placement: "trailing"` 让它第一次出现在最右端、紧挨系统项——系统默认把新图标放在最左端，图标一多就落在刘海下面看不见；用户 ⌘ 拖过之后以系统记住的位置为准。
模型多四个字段：

| 字段 | 含义 |
| --- | --- |
| `statusItem` | 改哪一枚（`items[].id`）；省略 = 第一枚。每枚各有一份完整的模型与菜单 |
| `length` | `"auto"`（默认，随内容）或 0–10000 点 |
| `blank` | 不画图标也不画字，只占 `length` 那么宽；VoiceOver 仍读 manifest 里这一枚的名字 |
| `primaryClick` | `"menu"`（默认）左键开菜单；`"event"` 左键发 `press(context, statusItem, modifiers)`，右键与 ⌃ 点仍开菜单 |

宿主不知道你拿这几枚做什么（开关、读数、分组用的空白都一样）。**兜底**：维持它们的后台会话一收掉（停用、卸载、更新、加载失败），
宿主把这个扩展所有状态项的 `length` 复原成 `"auto"`、`blank` 复原成假——一块定宽的空白会把别人的图标挤出屏幕，扩展不在时这件事不再发生。

#### `jarvis.menuBar.observePointer` — 菜单栏上的指针（能力 `menuBar.pointer`，中档，SDK 2.11）

`observePointer(types, listener)` → `Unsubscribe`。只报菜单栏那一条里的事；指针在屏幕别处的位置读不到。

| 事件 | 字段 |
| --- | --- |
| `enter` / `exit` | 指针进出菜单栏那一条时各一次（不发连续移动）：`screen`、`x`（相对那块屏左边）、`modifiers`。订阅 `enter` 的那一刻指针已经在那一条里时，宿主先补发一条 `enter`——不要自己假定指针在哪 |
| `click` | 另带 `button`（`left` / `right`）、`onItem`（点在某一颗图标上）、`onAppMenu`（点在前台应用的菜单标题上；宿主还没读到时为 `null`） |
| `scroll` | 另带 `deltaY`：100 ms 内的累计值，手指 / 滚轮向上为正 |

**只订用得着的**：宿主只装 `types` 里那几种监听。`enter` / `exit` 要一个随鼠标移动触发的全局监听（鼠标一动每秒上百次唤醒），用不着就别订；
`click` / `scroll` 的监听只在用户点、滚的时候醒。参考 [`extensions/menubar`](../extensions/menubar)：收着、没开悬停时只订 `click`，露着时才加 `enter` / `exit`。

#### `jarvis.menuBarExtras` — 菜单栏上的项（能力 `menuBarExtras.read`，中档，借辅助功能，SDK 2.11）

| 方法 | 说明 |
| --- | --- |
| `list()` | 此刻菜单栏上的全部图标（任何应用的），从左到右：`[{ id, ownerBundleId, ownerName, title, frame, screen, onScreen, movable, mine?, icon? }]` |
| `observe(listener)` | 「有哪些项」的变化 `{ added, removed }`，250 ms 合并；位置随时在变，要位置就 `list()` |

- `id` 跨重启尽量不变：有 AX identifier 的 `<bundleId>:<identifier>`；同一应用只有一颗的 `<bundleId>`；有几颗的 `<bundleId>#<序号>`；归属认不出的 `window:<窗口号>`。
- `frame` 是全局坐标（原点在主屏左上角、y 向下）；`onScreen` 为假的是被刘海挡住或被挤出屏幕的；`movable` 为假的是时钟、控制中心这类钉死的系统项；
  `mine` 是你自己的哪一枚状态项；`icon` 是所属应用的图标句柄（交给 `row.image`）。
- Jarvis 没有辅助功能权限时报 `permission.unavailable`（macOS 26 起归属只能经 AX 认）。
- **宿主只在菜单栏变了时才问 AX**：稳态一次 `list()` 只按已知窗口号读位置（约 0.2 ms），要位置时直接调、不必自己缓存；
  有 `observe` 订阅者时宿主每 10 s 兜底看一眼屏幕上的窗口——页面离开就退订。限频每分钟 ≤ 600 次。

#### `jarvis.menuBarExtras.capture` — 截菜单栏上的项（能力 `menuBarExtras.capture`，高档，借屏幕录制，SDK 2.12）

`capture(ids)` → `[{ id, live, image?, capturedAt? }]`，与 `ids` 同序（1–40 个，`list()` 给的 id）。

- 此刻在屏幕上的当场截（`live: true`，2x PNG 句柄，交给 `image` / `row.image` / `chip.image` / `iconButton.image`）。
- **藏着的截不到**：被挤出屏幕的、被刘海挡住的，窗口服务器都不算在屏上，ScreenCaptureKit 截不到（jarvis-mac `specs/20261030-081832-menubar-manager-p2` R-3）。
  宿主按窗口号留着它最近一次露着时截到的那一张（内存里至多 64 张），藏着时交回它：`live: false`，`capturedAt` 是截的时刻（Unix 毫秒）。
  从没露出来过、应用重启过（窗口换了）的没有 `image`——退回 `list()` 的 `icon`。
- 所以要藏着时也有图，就在它露着的时候截一次（参考 [`extensions/menubar`](../extensions/menubar)：启动收起之前、每次展开之后、为点开而露出时）。
  **宿主自己从不截，也不会为了截去动菜单栏**；一次调用读一次屏上窗口的清单（约 50 ms）、只截屏上的那几颗（每颗约 20 ms）。
- Jarvis 没有屏幕录制权限时整次报 `permission.unavailable`。限频每分钟 ≤ 60 次。

#### `jarvis.menuBarExtras.press` — 点开菜单栏上的项（能力 `menuBarExtras.control`，高档，借辅助功能，SDK 2.12）

`press(id, { button?, onMenu? })` → `{ via: "accessibility" | "click" }`。

- 先 AXPress（右键是 AXShowMenu）。那个应用不接 AX 的动作时，宿主在它中点合成一次点击、再把指针放回原处（`via: "click"`，用户看得到指针跳一下）。
- **它的横向范围要落在某块屏里**：被挤出屏幕的报 `target.unavailable`（`detail: "offscreen"`）——点开的菜单会开在屏外。
  宿主不替你把它挪出来：先露出它所在的段，等 `list()` 里它进了屏幕再点。刘海下面的可以点（AXPress 打开的菜单开在刘海下方，看得见），
  但那里没有像素可点，AX 不接的应用在刘海下面点不开，同样报 `target.unavailable`。
- `onMenu(state)`：这一次点开之后那个应用的菜单——`opened` 开了、`closed` 关了、`none` 1.5 s 内没开菜单（弹的是窗口、自绘面板，或什么都没弹）。
  `closed` / `none` 之后不再推；开着超过 10 分钟的不再观察。宿主只为带了 `onMenu` 的那一次装观察，不常驻。
- 限频每分钟 ≤ 30 次。

#### `jarvis.inputSources` — 键盘输入源（能力 `inputSources.read` / `inputSources.select`，中档，不借系统权限，SDK 2.13）

jarvis-mac `specs/20261030-170731-input-source-switch-p1` N-1。

| 方法 | 说明 |
| --- | --- |
| `list()` | 此刻启用、可选的输入源 `{ id, name, kind, languages, icon? }`，顺序同系统输入法菜单。表情与符号、按住重音这类调色板与不可选的父项（「微信输入法」那一枚只装着模式的）不在里面。`kind`：`keyboardLayout` / `inputMethod` / `inputMode`；`languages` 至多 8 个；`icon` 是 64 px 的图标句柄——单色暗图（不少输入法交的都是黑色单色图）宿主翻成白色，Jarvis 的界面锁定深色 |
| `current()` | `{ id }` |
| `select(id)` | `{ id, effective }`（要 `inputSources.select`）。不在 `list()` 里报 `target.unavailable`（`detail: "unknown"`）；已经是当前时宿主不调系统、`effective: true`。切完宿主读回一次，`effective` 为假说明系统没接——记日志，别重试打架。每分钟 ≤ 120 次 |
| `observe(listener)` | `{ type: "selected", id, bySelf }` / `{ type: "listChanged" }`。`bySelf` 为真：这一次是**你自己** 1 s 内的 `select` 引起的；别的扩展收到同一条时为假——「记住用户手动用的」只认 `bySelf: false` 的。宿主有订阅者才注册那两条系统通知；后台会话持有它就常驻 |

- 读（`list` / `current` / `observe`）每分钟 ≤ 600 次。
- 中文输入法里按 ⇧ 切到的英文模式不是一个输入源：读不到也切不了。
- 中日韩输入法「切了打字不生效」的老问题：本机 macOS 26 + 微信输入法实测读回均为目标；宿主不做抢焦点、合成快捷键这类修正（合成的系统快捷键异步落地，会和下一次切换打架）。

#### `jarvis.frontmostApp` — 前台应用（能力 `system.activity`，中档，不借系统权限，SDK 2.13）

N-2。`current()` → `{ bundleId, name, pid, icon? } | null`；`observe(listener)` **订阅时先补发一条此刻的**，之后每换一次前台推一条。

- 没有 bundle id 的进程不报；Jarvis 自己成为前台也照报。
- 不抢前台的浮层（Spotlight、Alfred、Jarvis 的全局搜索）不算换了前台——系统不发通知，宿主也不轮询。
- `icon` 与 `menuBarExtras` 的应用图标同一份按 bundle 的句柄。`current` 每分钟 ≤ 120 次；订阅一次就够。
- 后台会话持有这条订阅就常驻（不参与 60 秒空闲回收），关掉菜单栏图标也照样在。

#### `jarvis.hud` — 一闪而过的提示（能力 `hud.show`，低档，不借系统权限，SDK 2.13）

N-3。`show({ text, symbol?, image?, anchor, duration? })`：宿主画一枚胶囊小牌子，不抢焦点、鼠标穿透，`duration`（400–3000 ms，默认 1200）后淡出。

- `text` 1–24 字；`symbol`（SF Symbol）与 `image`（**这个会话**拿到的句柄，例 `InputSource.icon`）至多给一个。
- `anchor`：`caret` 前台应用的文字插入点下方；读不到插入点时贴着输入框（下方左对齐、放不下翻上面）；输入框也读不到（没有辅助功能权限、企业微信这类不报的应用、密码框）时放在前台窗口正中——
  **不退回指针**（指针可能在屏幕任何地方，牌子就飘，jarvis-mac `specs/20261030-190534-input-source-walkthrough-fixes` F-2）。刚切过去时焦点常常还没落定，宿主隔 60 ms 再读一次。
  `window` 前台应用最前面那扇窗的正中（窗口列表读位置，不要权限；读不到退回 `screen`）；`pointer` 指针右下；
  `screen` 屏幕中间偏下（牌子中心在可见区自下往上 30%；前台窗口所在的屏，读不到用指针所在的屏，jarvis-mac `specs/20261030-194903-input-source-cards-orb-flash` C-7）；
  `orb`（宿主 ≥ 3.3.2，C-6）悬浮球「粘连闪示」：`symbol` / `image` 进球心、替掉球心原来的东西，`text` 是一枚连着一段颈贴在球下（放不下翻上方）的 chip，
  到时一起缩回、球心复原；全应用同一时刻只有一个球上闪示，新的顶掉旧的；球展开、贴边藏起、被藏掉时退回 `screen`。**坐标由宿主读，扩展拿不到**。
- 同一个扩展同一时刻只有一枚，新的顶掉旧的并重新计时。VoiceOver 低优先级读出 `text`。后台会话可以调：静默命令的执行反馈用它，比系统横幅轻。每分钟 ≤ 60 次。

#### `jarvis.screens` — 屏幕几何（隐式，SDK 2.11）

`list()` → `[{ id, frame, visibleFrame, menuBarHeight, isMain, scale, notch }]`，主屏在前；`notch` 是刘海两侧还能放东西的两块（`{ left, right }`），没有刘海为 `null`。
`observe(listener)`：屏幕配置变了推完整的新列表。坐标与 `menuBarExtras` 同一套。

#### `jarvis.orb`（悬浮球那一层，SDK 2.10）

`update(model | null)`：推一份读数到收起态的悬浮球上；`null` 撤掉。不要点头：它只改悬浮球上属于这个扩展的那一层；但只对声明了 `contributes.orb`
的扩展放行，别的一律 `surface.unavailable`。本期只有一种读数（jarvis-mac `specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-6）：

| 字段 | 含义 |
| --- | --- |
| `kind` | `"traffic"` |
| `upload` / `download` | **有效**速率（字节 / 秒，≥ 0）：只算拿到过回包的连接上的字节 |
| `succeeded` / `failed` | 最近一个窗口里判定了的连接数：宿主据此画外圈一道环的青（成功）/ 红（失败）两段 |
| `caption` | ≤ 40 字：悬停提示与 VoiceOver 补一句 |

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 画法 | 宿主定：外圈一道成败环；球心本来画产品标识时改画两行速率（下行在上），未读、番茄钟、清理闪示照旧压过它；停靠成细条时不画 | 悬浮球是 Jarvis 的主入口，扩展不画像素 |
| 合并与过期 | 宿主按 250 ms 合并；**5 秒没有更新自动撤掉** | 后台会话没了，不能让一个停住的读数挂在球上——要它一直在就每秒推一次 |
| 几个扩展都推 | 画最近推的那一个 | |
| 用户可以关 | 设置 · 扩展 里「在悬浮球上显示」（默认开，存在 `<id>#host`） | 被关掉时 `update` 照样兑现，只是不画 |

#### `jarvis.log`

`debug` / `info` / `warn` / `error(message, data?)`。进内存里那条日志（每会话最近 200 条），出错屏上看得见最后几条。
**不要往里写用户内容与机密**。

#### 定时器：`setTimeout` / `clearTimeout` / `sleep(ms)`

全局，不是一次能力调用。单次 ≤ 30 s、同时挂起 ≤ 64 个、会话结束时全部取消；**没有 `setInterval`**。

#### 纯函数工具（同步）

| 命名空间 | 方法 | 宿主这一版 |
| --- | --- | --- |
| `host` | `info` / `environment` | 已接上 |
| `text.language` | `detect(text, { hints })`、`displayName(code)` | 已接上（系统 `NaturalLanguage` 与 `Locale`） |
| `text.base64` | `encode(text, { urlSafe, omitPadding, wrapAt76 })`、`decode(text, { ignoreWhitespace })` | 已接上（`Base64Codec`） |
| `text.hash` | `digest(algorithm, text, { uppercase })` | 已接上（`HashDigest`） |
| （不提供）`text.json` / `text.url` / `text.regex` / `time` / `color` | — | SDK 1 的类型里写过、宿主从没接上；SDK 2 拿掉了。目录只列宿主做得到的 |

SDK 自己还带一组**不经宿主**的纯函数（`ocr.mergeLines` / `ocr.paragraphs` / `ocr.chunk`），在 node 里就能测。

### 需要点头的能力

每一节的标题就是 manifest 里要声明的 `CapabilityID`。频率上限是宿主的 `ExtensionRateLimitPolicy`，挡的是失控，不是安全边界。

#### `clipboard.read` — 读取剪贴板

| 方法 | 说明 |
| --- | --- |
| `read()` | 当前剪贴板的文本；密码管理器标记为机密的内容读回 `null`，与内置粘贴板同一条过滤 |
| `readImage()` | 剪贴板里是一张图时给出句柄（宿主落临时文件）；不是图为 `null` |

#### `clipboard.write` — 写入剪贴板

`write(text)`，每分钟 ≤ 60 次。**用户按下的复制钮不需要它**（`ui.copy` 由宿主写）；需要它的是"扩展自己决定写"，
例如静默命令把译文放进剪贴板。

#### `quickTransfer.status` — 查看快传状态

| 方法 | 说明 |
| --- | --- |
| `status()` | `{ state: stopped/starting/running/failed, url?, peers: [{ label, address, paired }], activeTransfers, failureReason? }`；**没有配对码** |
| `observe(listener)` | 状态变化时回调（宿主每秒看一眼快照，变了才推） |

#### `quickTransfer.control` — 开关快传服务

`start()` 对局域网开端口（返回状态）；`stop()`。**不替用户自动打开**：扩展想发东西而服务没开时，
画一颗「开启快传」按钮让用户按。

#### `quickTransfer.send` — 经快传发送

`sendText(text)`：推一条消息到已配对的手机页面；服务没开着 → `host.failure`（「快传没有开着」），宿主不会替你打开它。

#### `screenshot.capture` — 截图

`capture({ mode, selectionOnly, recognizeText, ocr: { languages, level }, hint, appearance })` → `{ file, width, height, ocr? }`。
宿主收起面板、盖遮罩、由用户框选；Esc → `cancelled`；没有屏幕录制权限 → `permission.unavailable`；每分钟 ≤ 20 次。

- `selectionOnly: true`：只框选，松手即完成；`hint` 是选框下方那句提示（≤ 16 字）；`appearance` 选压不压暗、画不画参照线。
- 完成后谁叫回来：落点 `popover` 的在选区旁开原地弹窗；`toolbox` / `window` 的叫回面板页面或窗口；`silent` 的安静收场。
- **后台会话里也能截**（静默命令「截屏译文入剪贴板」就是）：框选遮罩是宿主自己的界面，不借扩展的任何一面。

#### `ocr.recognize` — 识别图片文字

`recognize(file, { languages, level })` → `{ text, lines: [{ text, box, confidence }] }`；`box` 相对整张图归一化到 0…1。
段落合并用 SDK 的 `ocr.mergeLines`。每分钟 ≤ 60 次。

#### `speech.speak` — 朗读

`speak(text, { language, rate })` / `stop()`：系统语音，再次调用打断上一次。每分钟 ≤ 30 次。

#### `hotkeys.register` — 全局快捷键

没有方法。它是 manifest `commands[].hotkey` 的授权开关：宿主启动时按 manifest 注册；**还没问过**授权的照样注册
（按下时先把界面唤出来问一次），明确拒了的不注册。跨应用冲突探测不到。

#### `notifications.post` — 系统横幅

`post({ title, body })`，需要 manifest `inbox.notifications: true`。每分钟 ≤ 6 条。通知权限被拒时静默不弹、照常 resolve。

#### `inbox.post` — 往 Inbox 投消息

`post({ title, body, level? })`，需要 `inbox.messages: true`。标题前缀扩展名（`发到手机 · 已推到 iPhone`）、正文 ≤ 400 字、
`level` 是 `info` / `success` / `warning` / `error`；与 WebSocket 进来的消息同一张卡、计入未读、不弹横幅。每分钟 ≤ 6 条。
v1 的卡片动作与 `dismiss` 已删除（[11](11-inbox.md)）。

#### `network.https` — 访问网络

`net.fetch(url, { method, headers, body })` → `{ status, headers, text }`：

- 只走 HTTPS；主机必须与 manifest `network.hosts` 里的某一个**完全相等**（后缀匹配会把 `evil-x.googleapis.com.attacker.tld` 放过去）；
- 方法只认 GET / POST / PUT / DELETE；不带 cookie、不带 Jarvis 的任何凭据；宿主追加 `X-Jarvis-Extension: <id>/<version>`；
- 响应 ≤ 5 MB、30 秒超时；每分钟 ≤ 60 次。
- SDK 2.9：manifest `network.preferenceHosts` 点名的 `urlList` 偏好里、用户**此刻**填着的地址，主机一并放行（请求那一刻现读：用户删掉一条，下一次请求就拦）。
  一个扩展可以点名几项（「代理」点名订阅地址与规则集地址两项）；从别处来的地址（例如导入的配置文件里写着的）要用户自己贴进这几项才放行。
  同样只走 HTTPS、完全相等比较、重定向落点照样核对。为什么认偏好而不认页面里的输入框：偏好的控件是宿主画的，值只可能来自用户亲手输入；
  页面里的输入框扩展自己就能填，宿主分不出是谁写的。

### 受限执行（指令域，SDK 2）

三项能力全部**高风险**，全部要在 manifest 里逐项声明对象，宿主硬拦声明之外的一切。

#### `process.run` — 运行命令

| 方法 | 说明 |
| --- | --- |
| `locate(executable)` | 按名字在固定位置里找：`/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`、`~/bin`、`~/.nix-profile/bin`、`/run/current-system/sw/bin`，以及语言工具链自带的 `~/.cargo/bin`、`~/.dotnet/tools`、`/usr/local/go/bin`（SDK 2.7 的宿主起；不 fork shell 去 `which`：从 Finder 起的应用只有一份最小 PATH）。带 `/` 或 `~` 的当作用户填的路径——**坏了就报坏，不悄悄回落到自动探测**。返回 `{ path, source: custom/discovered }` 或 `{ path: null, problem: notFound/missing/notExecutable }` |
| `run({ executable, arguments, onLine, stdin?, directory?, output? })` → `{ result, cancel() }` | 跑一个声明过的可执行文件；参数必须与声明的某一组**逐项相等**。标准输出逐行交给 `onLine`（宿主按 100ms 合批推过来，**全部输出先于结果到达**）；`result` 兑现为 `{ exitCode, stderr, stdout? }`（stderr 末尾 4 KB）；`cancel()` 发 SIGINT，`result` 以 `cancelled` 拒绝。SDK 2.7 的三个选项见下 |

SDK 2.7 的三个选项（给格式化工具这一类「读一份文本、吐一份文本」的工具用）：

| 选项 | 规则 | 为什么 |
| --- | --- | --- |
| `stdin` | 写进标准输入的文字，≤ 1 MiB。**只对 manifest 里声明了 `"stdin": true` 的可执行文件放行**，否则 `capability.undeclared` | 格式化工具从 stdin 读源码是本职；同一个开关放到解释器身上就等于把参数当脚本——所以写在声明上、授权屏逐个念出来，审核逐个看 |
| `directory` | 工作目录的**句柄**，只认宿主在这一次服务调用里给的那一个（`code.format · format` 的 `request.directory`），别的一律 `capability.undeclared` | 工具按文件所在目录找 `.clang-format` / `.editorconfig` / `pyproject.toml`；扩展看不到本机路径，也造不出一个目录来跑 |
| `output: "text"` | 不逐行推；进程结束后结果里多一个 `stdout`（整份，按 UTF-8 解码，≤ 4 MiB，超过以 `host.failure` 拒绝） | 逐行推会吞掉空行，交回一份源码必须是整份 |

放行规则（`ExtensionProcessPolicy`）：名字或路径的**文件名**必须等于 manifest `process.executables[].name`——
用户在偏好里填 `/opt/tools/mo` 可以，填 `/bin/rm` 不行（`capability.undeclared`）。

运行环境：**不经 shell**（`;`、`|`、`$()` 都只是字符）；stdin 接空设备（非交互的命令不会提示、不会卡住、不会要密码；声明了 `stdin` 且这一次给了 `stdin` 的除外）；
工作目录是主目录（或这一次给的目录句柄）；PATH 补上 Homebrew 与常见工具链目录；`HOME` 显式给出；`NO_COLOR=1`。
**进程继承 Jarvis 的全部系统权限，含完全磁盘访问**——这正是它高风险的原因。测试进程里一律拒绝。每分钟 ≤ 120 次。

#### `files.read` — 读取文件

| 方法 | 说明 |
| --- | --- |
| `stat(path)` | `{ size, inode }`；文件不在或是目录时 `null` |
| `tail(path, offset)` | 从字节偏移起读**完整的**行，一次 ≤ 1 MB：`{ lines, offset, size, inode }`。最后一个换行之后的半行不读，留到下一次；`offset` 超过文件大小时从 0 读（文件被换掉了）。文件不在时 `null` |

路径必须与 manifest `files.read` 里的某一个逐字相等（展开 `~`、规整之后比——`~/Library/Logs/mole/../../Keychains/x` 绕不过去）。
换了 inode 或文件变小 = 被轮转了，由扩展自己从 0 接着读。每分钟 ≤ 1200 次（一次清理要读几百次日志）。

#### `files.pick` — 让用户挑一个文件（SDK 2.10）

`files.pick({ title?, directory?, extensions? })` → `{ name, text }`；用户取消为 `null`。宿主画 `NSOpenPanel`（起点 `directory` 可以用 `~`，
`extensions` 是可挑的扩展名、不带点），交回文件名与 UTF-8 正文（≤ 4 MiB）——**扩展拿不到路径**。只在前台会话（要用户在场）；每分钟 ≤ 10 次。
低风险：用户亲手挑的那一份才给，与 `files.read`（manifest 逐字写死几个路径、随时可读）不同。

#### `terminal.run` — 在终端里执行脚本

`run(scriptId)`：打开用户选定的终端，执行 manifest `process.terminal` 里那个 id 的脚本——**扩展只能点名，不能传内容**。
宿主在正文前补 `#!/bin/sh` 与「执行完删掉自己」那一行，写到属主独占的临时目录再交给终端打开；打开即返回，不等它跑完。
每分钟 ≤ 6 次。装完之后的事（工具在不在了）由扩展自己再 `locate` 一次。

### 常驻进程与系统代理（SDK 2.9）

扩展沙盒故意不给的两件事——**常驻**、**改系统网络**——由宿主补成通用能力：宿主不认识 sing-box、不认识任何代理协议，
`process.daemon` 不知道它跑的是什么，`system.proxy` 只认「本机的某个端口」（jarvis-mac `specs/20261028-091917-proxy-extension-menubar-daemon` P-1、P-3、P-4、P-6）。
两项都是**高风险**。

#### `process.daemon` — 常驻运行命令

跑 manifest `process.daemons` 里逐字声明的那条命令（[03](03-manifest.md)）。与 `process.run` 的差别在生死：`process.run` 跟会话走，
后台会话闲 60 秒被收、进程随之中断；常驻进程**归宿主**，停止只在扩展自己 `stop`、扩展停用 / 卸载 / 更新、Jarvis 退出时。

| 方法 | 说明 |
| --- | --- |
| `daemon.start({ id, config?, executable?, controlPort? })` | 定位 → 写配置（`{workdir}/<fileName>`，0600，≤ 4 MiB）→ 起进程 → 等 1 秒：这期间退出算启动失败（`host.failure`，`detail` 里带它输出的最后 20 行——配置错了由工具自己报）；否则返回 `running` 的状态。已在运行时拒绝（先 `stop`）。`executable` 是用户填的路径（文件名必须等于声明的名字），省略 = 宿主定位；`controlPort` 是它会监听的本机控制口 |
| `daemon.stop(id)` | SIGTERM，3 秒不退 SIGKILL；返回状态。没在跑时照常兑现 |
| `daemon.status(id, executable?)` | `{ id, state: stopped / running / exited, pid?, startedAt?, exitCode?, signal?, controlPort?, executable }`。`executable` 是此刻定位到的路径（运行中 = 正在跑的那一份），**找不到为空串**——扩展据此画「没装」那一屏，因此不必为了问一句「装没装」另外申请 `process.run` |
| `daemon.logs(id)` | 最近 500 行输出（stdout 与 stderr 合流，每行 ≤ 2 KB） |
| `daemon.observe(id, listener) → Unsubscribe` | 订阅：`{ kind: "output", lines }`（100 ms 合批）与 `{ kind: "exit", exitCode?, signal?, expected, lines }`（最后 20 行）。线缆上是 `daemon.observe` / `daemon.unsubscribe`，参数 `{ id, token }`，事件是带这个 token 的 `subscription` |
| `daemon.request({ id, method, path, headers?, body?, timeout? })` | 见下「本机控制口」 |

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 运行环境 | 以用户身份运行（不提权）、不经 shell、stdin 接空设备、补 PATH、`NO_COLOR=1`，工作目录 = `{workdir}` | 与 `process.run` 同一套；**进程继承 Jarvis 的全部系统权限**（含完全磁盘访问）——这正是它高风险的原因 |
| 工作目录 | `<Application Support>/Jarvis/extension-runtime/<扩展 id>/<daemon id>/`（0700）；卸载扩展时整个删掉 | 里面是外部工具自己的状态（缓存、规则集），不是 Jarvis 的结构化持久化：Jarvis 不读、不索引它 |
| 意外退出 | 事件发给订阅者，`expected: false`；**宿主不自动重启** | 重试、横幅、关系统代理是产品决定，归扩展；系统代理另有宿主兜底 |
| 退出 Jarvis | 同步收：全部 SIGTERM，合计至多等 2 秒，剩下的 SIGKILL | 不留一个占着端口、没人管的进程 |
| 孤儿 | Jarvis 崩溃留下的那一个，下次启动时宿主按参数里的 `extension-runtime/` 路径认出来 SIGTERM | 不靠 pid 文件：pid 会被复用，参数里的路径不会撞 |
| 后台会话 | 有 `running` 的常驻进程时，这个扩展的后台会话**不因空闲被收**；全部停下后回到「闲 60 秒收」 | 退出事件与菜单栏点选要有人接 |
| 订阅 | 跟着会话走：前台页面与后台会话各订各的 | 两个 JSContext 不共享内存；状态在宿主手里，两边各自 `status` 读同一份 |
| 测试进程 | 一律拒绝 | 与 `process.run` 同一位 |

#### 本机控制口：`daemon.request`

扩展要和自己的常驻进程说话（sing-box 的 Clash API：切节点、测延迟、读连接与流量），而 `net.fetch` 只放行 HTTPS 与白名单主机，连不到 `127.0.0.1`。
因此控制口单开一条路，归 `process.daemon` 这一项能力（不另设）：它只通向扩展自己声明、自己起的那个进程。

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 发往哪 | 只发 `http://127.0.0.1:<start 时报的 controlPort><path>`，只在这个进程 `running` 时放行 | 别的端口、别的主机拼不出来 |
| `path` | 以 `/` 开头，不含 `//`、`\`、`#`、空白与协议头，≤ 2048 字；查询串照常带 | 一条路径改不了主机 |
| 方法与头 | `GET` / `POST` / `PUT` / `PATCH` / `DELETE`；请求头只放行 `Authorization`、`Content-Type`、`Accept` | 控制 API 用得到的就这几样 |
| 体积与超时 | 请求体 ≤ 1 MiB、响应 ≤ 5 MiB（形状同 `net.fetch`，非 UTF-8 的 `text` 为空串）；超时默认 10 秒、至多 30 秒 | 测一次延迟要几秒 |
| 代理 | 走一个**不经任何代理**的会话 | 系统代理此刻可能正指着这个进程自己 |
| 流式 | 不做（WebSocket / chunked 长连接都不做） | 流量速率由扩展每秒读一次快照算差值 |

#### `system.proxy` — 修改系统代理

| 方法 | 说明 |
| --- | --- |
| `systemProxy.status()` | `{ owner: self / other / none, port?, effective, current?, otherName?, blocker? }`。`effective` = 有效系统代理此刻就是这个扩展写的那个端口；`current` 是有效系统代理的一句话（`127.0.0.1:6152`） |
| `systemProxy.enable({ port, socks?, bypass? })` | 把系统代理指向 `127.0.0.1:<port>`；`socks` 省略 = 连 SOCKS 一起设；`bypass`（≤ 64 条）追加进例外列表。被别的工具拦着时**不写**，返回带 `blocker` 的状态 |
| `systemProxy.disable()` | 还原接管前的设置 |

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 只能指向本机 | 主机写死 `127.0.0.1`；`port` 1024–65535；**这个扩展此刻必须有一个 `running` 的常驻进程** | 系统代理指着一个没人监听的端口，等于整机断网 |
| 写哪些服务 | 每个**启用的、有网卡的**网络服务设 HTTP / HTTPS（与 SOCKS）；没有网卡的服务跳过 | 那是 VPN / 代理工具自己注册的服务，往别人的服务里写代理是越界 |
| 例外列表 | 原有的 + 必加的（`127.0.0.1`、`::1`、`localhost`、`*.local`、`169.254/16`）+ 扩展给的 | 本机与局域网不能被绕到代理上 |
| 还原 | 接管前每个服务原来的设置存进宿主的库；还原时**只还原此刻仍指着这个端口的服务** | 别人在期间改过的不动 |
| 被拦着 | 主服务的代理来自动态状态（Surge 增强模式、其他 VPN 的虚拟网卡）时 `enable` 什么都不写，`blocker.message` 原样给用户 | 写了也不生效，还会让用户以为生效了 |
| 一个主人 | 另一个扩展已经接管时 `enable` 报错写明是谁 | 两个扩展轮流改系统代理，还原的时候谁都还原不对 |
| 宿主兜底 | 主人的常驻进程全部停止或意外退出、主人停用 / 卸载 / 更新、Jarvis 退出、Jarvis 启动时发现上次崩溃留下的备份——宿主自己还原，扩展不需要也不能阻止 | 最坏的情况是用户的整台机器断网，而扩展的 JS 那时候可能根本没在跑 |
| 怎么写 | 宿主经系统自带的 `/usr/sbin/networksetup` 写、经 SystemConfiguration 读 | 非 root 进程直接写网络设置要每次输管理员密码 |

```ts
const status = await jarvis.daemon.status("sing-box", preferences.singBoxPath || undefined);
if (status.executable === "") return showInstallScreen(); // 「在终端中安装」→ jarvis.terminal.run("install")
jarvis.daemon.observe("sing-box", (event) => {
  if (event.kind === "exit" && !event.expected) void jarvis.notifications.post({ title: "内核退出了", body: event.lines.at(-1) ?? "" });
});
await jarvis.daemon.start({ id: "sing-box", config: JSON.stringify(config), controlPort: 19090 });
const proxy = await jarvis.systemProxy.enable({ port: 7890 });
if (proxy.blocker) showNote(proxy.blocker.message);               // 被 Surge 这类工具拦着：原样告诉用户
const delay = await jarvis.daemon.request({ id: "sing-box", method: "GET", path: "/proxies/auto/delay?url=…&timeout=5000", headers: { Authorization: `Bearer ${secret}` } });
```

#### `daemon.reload` — 换配置不断进程（SDK 2.10）

`daemon.reload({ id, config? })`：宿主重写同一个配置文件，再发 manifest `process.daemons[].reload` 声明的信号（本期只认 `SIGHUP`；sing-box 收到它原进程重载、pid 不变）。
没声明 `reload` → `capability.undeclared`；没在跑 → `host.failure`。状态保持 `running`——为什么不 `stop` + `start`：系统代理的兜底还原看的是「这个扩展还有没有在跑的常驻进程」，
停一下再起，中间那一两秒宿主会以为内核没了、把系统代理还原掉。

### 增强模式（TUN，SDK 2.10）

`network.tunnel`（**高风险**）：以管理员身份运行 sing-box 接管整机网络，命令行工具与不认系统代理的应用也走它（jarvis-mac
`specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-2…T-4）。TUN 要 root（建 utun、改路由表），所以它是**宿主**的能力，不是「让常驻进程以 root 跑」：
宿主装一个只做五件事的网络助手（root LaunchDaemon）——收配置、过守卫、填 TUN 段、写进 root 目录、用 root 所有的 sing-box 副本跑它。
manifest 写 `process.tunnel: { "executable": "sing-box" }`（本期只认 sing-box：宿主的守卫只懂它）。

| 方法 | 说明 |
| --- | --- |
| `tunnel.status(executable?)` | `{ state, pid?, startedAt?, exitCode?, signal?, controlPort?, helper: { state: notInstalled / outdated / ready / unreachable, version?, kernelVersion?, kernelSHA256? }, kernel: { executable, matchesInstalled }, blocker? }` |
| `tunnel.start({ config, controlPort, executable?, excludeRoutes?, stack?, ipv6? })` | 定位 sing-box → 拦截判定 → 网络助手没装 / 版本不对 / 副本与用户那份不是同一版时**当场安装**（系统弹管理员密码框；取消 → `permission.denied`）→ 守卫、填 TUN 段、起内核、等 1.5 秒 |
| `tunnel.reload(config)` | 换配置不断进程（网络助手重写配置、过守卫、SIGHUP） |
| `tunnel.stop()` | 停内核，路由表随 sing-box 退出由它自己还原 |
| `tunnel.logs()` | 最近 500 行 |
| `tunnel.observe(listener) → Unsubscribe` | 与 `daemon.observe` 同形状的 `output` / `exit` 事件；线缆上参数只有 `{ token }` |
| `tunnel.request({ method, path, headers?, body?, timeout? })` | 与 `daemon.request` 相同、不带 `id`：只发往 TUN 内核报的 `127.0.0.1:<controlPort>` |

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| TUN 段 | **宿主填**：地址 `172.19.0.1/30`（与 IPv6 的一段）、`auto_route`、`strict_route`、协议栈（`stack`，默认 mixed）、不进 TUN 的路由（必加回环、链路本地、组播 + `excludeRoutes` ≤ 256 条）；并强制 `route.auto_detect_interface` | 扩展给不了、也改不了：配置里写 `tun` 入站会被拒 |
| 守卫 | 拒绝 `log.output`、任意层级以 `_path` 结尾的键与 `data_directory` / `acme`、键 `path`（`transport` 里的 URL 路径除外）、`type: local` 的规则集、非 `mixed` / `http` / `socks` 或不监听回环地址的入站、`set_system_proxy`、`external_ui*`、`v2ray_api`、`cache_file.path`、`endpoints` / `services` / 顶层 `certificate`，以及 Clash API 不在 `127.0.0.1:<controlPort>` 的配置；顶层键只认 `log / dns / ntp / inbounds / outbounds / route / experimental / http_clients` | 它以 root 运行：配置里的任何一个文件路径都是一次以 root 读写任意文件 |
| 跑哪一份 | 安装那一刻从用户的 sing-box 拷进 `/Library/Application Support/Jarvis Tunnel/` 的副本（root 所有、记下哈希、每次启动前核对）；`brew upgrade` 之后 `kernel.matchesInstalled` 为假，下一次开启时再要一次管理员授权把新版拷进去 | 让 root 执行一个用户可写的文件，等于让任何用户进程把它换掉 |
| 租约 | 发 `start` 的那条连接就是这次运行的租约：Jarvis 退出、崩溃、被杀，内核**立刻停** | TUN 不会在 Jarvis 不在的时候接着接管整机网络 |
| 拦截 | 主网卡此刻已经是别人的 `utun`（Surge 增强模式、其他 VPN）：不启动，返回带 `blocker` 的 `stopped` 状态（不抛错） | 两个 TUN 同时接管网络会互相抢路由 |
| 与系统代理 | 可以共存：`systemProxy.enable` 认「在跑的常驻进程**或** TUN 内核」 | 与 Surge 增强模式相同：认系统代理的应用少绕一次 TUN |
| 卸载网络助手 | 只在宿主的设置里（设置 · 扩展 · 它那块「网络助手」一行），扩展做不了 | root 的东西，用户必须总能自己卸掉 |

### 浏览器（SDK 2.10）

#### `browser.activeTab` — 读取浏览器当前页

`browser.activeTab()` → `{ browser: { bundleId, name, path }, frontmost, status, url?, title?, message? }`；从没用过任何浏览器为 `null`。
此刻的前台 App 是浏览器就读它，否则读**最近一次激活过的**浏览器（`frontmost: false`）——点开菜单栏图标不改变前台 App，所以从菜单栏读到的正是用户刚才在看的那一页。

| 规则 | 值 |
| --- | --- |
| 支持 | Safari（含 Technology Preview）、Chrome、Edge、Brave、Arc、Vivaldi、Chromium；Firefox → `unsupported`（它没有读地址的 AppleScript） |
| 读法 | 宿主经 `/usr/bin/osascript` 发一条只读的 Apple Event（2 秒超时）；只读当前标签的地址与标题 |
| 授权 | 第一次对某个浏览器读时系统弹「“Jarvis”想要控制“Safari”」；拒绝 → `status: denied`，`message` 指到「系统设置 › 隐私与安全性 › 自动化」 |
| 频率 | 每分钟 ≤ 60 次（菜单每点开一次读一次） |
| `path` | 浏览器包的路径：Chromium 系的网络进程在包里面，扩展据此在连接表里认它的连接 |

中风险：你在看什么网站，不出本机。

### Git 操作域（SDK 2.1）

三项能力只给**入驻了 Git 域**（`contributes.git`）的扩展；托管服务只认 `contributes.git.hosting` 里列出的那几个。
宿主替扩展执行、把结果交回去：**token 只在宿主的钥匙串里**，`gh` 只在宿主的 Git 服务里跑，扩展拿到的是 JSON。

#### `git.repository.read` — 读取本地仓库

`jarvis.git.repositories()` → `[{ name, host?, repository? }]`：Jarvis 最近打开过的仓库（至多 20 个），
`name` 是目录名，`host` / `repository`（`owner/name`）从 `origin` 读；读不出 `origin` 的跳过。**不给本机路径**。每分钟 ≤ 60 次。

#### `git.hosting.read` — 读取 Git 服务数据

| 方法 | 说明 |
| --- | --- |
| `hosting.viewer({ hosting? })` | 此刻那把 token 的 `{ login?, scopes?, projectAccess }`。`projectAccess` 从 classic token 的 scope 推：`readWrite`（有 `project`）/ `readOnly`（只有 `read:project`）/ `none` / `unknown`（fine-grained token 不报 scope，只能试了才知道） |
| `hosting.query({ hosting?, query, variables? })` | 执行一份**查询**，原样交回 `{ data, errors? }`。文档里是 `mutation` / `subscription` 以 `invalid.argument` 拒绝 |

#### `git.hosting.write` — 修改 Git 服务数据

`hosting.mutate({ hosting?, query, variables? })`：执行一份变更（查询也放行，方便改完读回）。
顶层字段名（别名之后的真名）必须**都**在 manifest `git.mutations` 里，否则 `capability.undeclared`；顶层不许片段展开（不让变更字段藏进片段里）。

共同规则：

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 文档 | 恰好一个操作，可以带具名片段；≤ 64 KB | 宿主要先认清它是查询还是哪几个变更，才谈得上放不放行 |
| `hosting` | 省略时宿主取 `contributes.git.hosting` 里的一个；只声明一个时可以省略，声明多个就显式传。不在声明里 → `capability.undeclared` | 没入驻的服务碰不到 |
| 部分成功 | `data` 与 `errors` 同时出现时**照样兑现**，由扩展决定接不接受 | GitHub 常见：一条 Issue 在私有仓库里、一个字段没权限，整页其余都好好的 |
| 整次失败 | 总开关关着、没添加这个服务、缺 token、`gh` 没装、超时 → `host.failure`，`message` 是一句人话 | 原样显示给用户，他知道去 设置 · Git 修哪里 |
| 限频 | 读 240 次 / 分钟、写 60 次 / 分钟 | 一次全量同步 1,240 项约 13 页加一次字段；上限只挡死循环（GitHub 自己还有每小时 5,000 点） |

```ts
const { data, errors } = await jarvis.git.hosting.query<{ viewer: { login: string } }>({
  query: "query { viewer { login } }",
});
if (!data) throw new Error(errors?.[0]?.message ?? "GitHub 没有回应");
```

用户给的值（标签名、登录名、搜索串）**一律放 `variables`**，不要拼进文档：拼进去的引号会把文档变成另一份文档。

### Android 操作域（SDK 2.4）

两项能力，**不是域、不入驻任何东西**：声明了就能用。宿主经**它自己的** adb 跑它写死的那几条命令（列设备、列应用与大小、
拉安装包用 aapt2 读名字与图标），扩展只给设备序列号与包名——因此它不是 `process.run`，manifest 里没有声明对象；
跑什么、带什么参数，扩展改不了一个字。adb 与 aapt2 用的是内置「APK 扫描」「数据导出」同一套工具链（设置里手填的路径优先）。

#### `android.apps.read` — 读取手机上的应用

| 方法 | 说明 |
| --- | --- |
| `android.devices()` | `[{ serial, name, state, ready }]`：adb 此刻看得见的设备，含没允许调试的。`name` 读得出型号就是型号，否则是序列号；`state` 是 `device` / `unauthorized` / `offline` / `other`；`ready` = `state === "device"` |
| `android.apps({ serial, scope? })` | `{ apps: [{ package, system, apkBytes, dataBytes, cacheBytes }] }`。`scope` 省略为 `user`（只列用户自己装的），`all` 连同系统应用。三个大小互不重叠、加起来是这个应用占的地方；设备不报时为 `null`（不是 0） |
| `android.appDetails({ serial, packages })` | `[{ package, label, versionName, icon, problem }]`：每个包一项，按 `package` 对上。`icon` 是宿主颁发的图片句柄（与截图、剪贴板里的图同一种 `FileHandle`）；某个包读不出时那一项 `problem` 写一句，其余照常 |

`appDetails` **慢**：每个包都要把安装包拉到本机临时目录、跑一次 aapt2、读完即删，几百毫秒到几秒。规则：

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 一次几个包 | 1…8（`maximumAndroidAppDetailsPerCall`），超出 `invalid.argument` | 8 个是「一屏露出来的那几行」：再多一次调用就要十几秒，这期间页面一动不动 |
| 什么时候问 | 先画列表（包名与大小），再按屏幕从上往下一批一批补；同一时刻只让一批在途 | 一台手机一条 adb，并发只会让每一批都更慢；列表不等名字 |
| 缓存 | 扩展自己按「序列号 + 包名」记在内存里；安装包大小变了再重读 | 宿主不替扩展缓存：图标句柄只在本次会话内有效 |
| 失败 | 找不到 adb、没有 aapt2、设备中途拔掉、adb 超时 → `host.failure`，`message` 是一句人话（「未找到 adb」「没有 aapt2，读不出应用名和图标」） | 原样显示；读名字整批失败时列表照常，别连着重试 |
| 设备 | `serial` 为空 → `invalid.argument`；不在、不是 `ready` → `host.failure` | 没允许调试的设备读不了任何东西，先画「在手机上点『允许 USB 调试』」 |
| 限频 | 三个方法合计每分钟 ≤ 120 次 | 一次扫描是设备 1 次 + 列表 1 次 + 每屏几批；上限只挡死循环 |

#### `android.tools.open` — 交给 APK 扫描 / 数据导出

`android.openTool({ tool, package })`：`tool` 是 `apkScan`（工具箱「APK 扫描」）或 `dataExport`（「数据导出」）。
宿主在面板里打开那个工具、把包名填好；**开始仍由用户在那里按**——它不替用户跑扫描、不替用户导出。打开之后扩展的页面随之离开（前台会话 deactivate）。
只该在用户按下的回调里调；`tool` 不认识、`package` 为空 → `invalid.argument`；每分钟 ≤ 30 次。

```ts
const devices = await jarvis.android.devices();
const phone = devices.find((device) => device.ready);
if (!phone) return; // 画「没有连着的安卓设备」或「在手机上点『允许 USB 调试』」
const { apps } = await jarvis.android.apps({ serial: phone.serial });
const firstScreen = apps.slice(0, 8).map((app) => app.package);
const details = await jarvis.android.appDetails({ serial: phone.serial, packages: firstScreen });
// 用户按下行尾按钮：
await jarvis.android.openTool({ tool: "apkScan", package: apps[0]!.package });
```

参考实现：[`extensions/android-apps`](../extensions/android-apps)（分批、在途一批、换设备丢旧结果、缓存按安装包大小判新旧）。

### 本机应用（SDK 2.5）

一项能力，**不是域**：声明了就能用。宿主自己扫三处应用目录（`/Applications` 两层、`/System/Applications` 两层、`~/Applications` 两层），
读 `Info.plist` 与 Spotlight 元数据，结果在宿主里缓存 5 分钟；扩展给不了路径参数。打开应用、在访达中显示、移到废纸篓**只在 Jarvis 的全局搜索里由用户点**，没有对应的能力。

#### `apps.read` — 读取本机应用列表

| 方法 | 说明 |
| --- | --- |
| `apps.list()` | `[{ id, name, bundleId, path, category, categoryTitle, version, location, locationTitle, lastUsedAt, addedAt, system, deletable }]`，按名字排。`id` 就是标准化之后的路径（同一个 Bundle ID 装两份是两个应用）；`category` 是 App Store 分类键（游戏子类归到 `public.app-category.games`），没有为 `null`、`categoryTitle` 为「其他」；`location` 是 `applications` / `system` / `user` / `other`；时刻是 Unix 毫秒，Spotlight 没记为 `null`；`deletable` = 不是系统应用且所在目录可写 |
| `apps.icons(bundleIds)`（SDK 2.13） | `[{ bundleId, icon? }]`，与入参同序；1–40 个、去重后上线缆。装着的应用给 64 px 图标句柄（与 `frontmostApp`、`menuBarExtras` 同一份按 bundle 的缓存，同一会话只颁一次），没装的没有 `icon`。宿主每个图标在主线程画一次（约 1 ms）：一次要一屏的量；与 `list` 共用每分钟 60 次（jarvis-mac `specs/20261030-182223-input-source-rules-ux` U-6） |

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 限频 | 每分钟 ≤ 60 次 | 全局搜索每唤出一次问一次目录；宿主已经缓存，不必自己再缓存 |
| 后台代理 | `LSBackgroundOnly` 的包不列 | 没有界面、不该被「打开」 |
| 没授权 | `permission.denied` | 在 `launcher.apps · catalog` 里原样抛出，宿主会请用户打开扩展那一页授权 |

```ts
const apps = await jarvis.apps.list();
const developer = apps.filter((app) => app.category === "public.app-category.developer-tools");
```

参考实现：[`extensions/mac-apps`](../extensions/mac-apps)（实现 `launcher.apps`：按设置分组排序交给全局搜索）。

### 错误码

| `code` | 含义 | 扩展该做什么 |
| --- | --- | --- |
| `permission.denied` | 用户没授或撤销了 | 画拒绝态 + 一颗 `request` 按钮；服务写进 `status` |
| `permission.unavailable` | Jarvis 自己没拿到系统权限 | 画说明 + `openSystemSettings` 按钮 |
| `capability.undeclared` | manifest 没声明，或受限执行的对象不是声明过的那一个（含没写进 `git.mutations` 的变更、没入驻的托管服务） | 开发期错误；改 manifest |
| `capability.unknown` | 宿主不认识这个方法（SDK 比宿主新，或宿主还没接上） | 检查 `minimumJarvisVersion` |
| `surface.unavailable` | 这一面不存在：后台会话里调了界面类能力，或扩展没有入驻那个域 | 静默命令与服务别碰面板与窗口 |
| `rate.limited` | 频率或体积超限 | 退避；不要重试风暴 |
| `invalid.argument` | 参数不合法 | 开发期错误 |
| `host.failure` | 宿主执行失败，`detail` 里是一句人话 | 原样显示 `detail` |
| `cancelled` | 用户在框选里按了 Esc，或宿主取消了这次调用 / 进程 | 收尾，不报错 |

## Usage

```ts
import { jarvis, JarvisError } from "@fusionseek/jarvis-extension-sdk";

const where = await jarvis.process.locate("mo");
if (where.path === null) return { ready: false, summary: "没有找到 mo 命令", actions: [{ id: "install", title: "在终端中安装" }] };
const handle = jarvis.process.run({ executable: where.path, arguments: ["--version"], onLine: (line) => lines.push(line) });
const { exitCode } = await handle.result;
```

## Gotchas

- `process.run` 的参数组合在 manifest 里写死：要多一组就改 manifest、升版本、过审核——这是有意的。
- `files.tail` 的 `offset` 是**字节**偏移，不是行号；跨调用自己记着。
- `inbox.post` 不是卡片：没有 id、没有动作、不能撤回；同一件事别每秒投一条。
- 后台会话里没有界面：静默命令要交结果只能靠剪贴板、横幅与 Inbox。
- `git.hosting.query` / `mutate` 的部分成功不会被拒：先看 `data` 再看 `errors`，别只看有没有抛错。
- `git.mutations` 按**顶层字段名**放行：一份文档里放几个变更（别名区分）可以，每一个都要声明。
- `android.appDetails` 别一进页面就把整张表问一遍：几百个包 × 每个几秒 = 用户盯着一张空表等几分钟。只读画出来的行。
- `android.openTool` 只交包名：内置工具用它自己选着的那台设备，连着多台手机时让用户到那边确认。
- `daemon.observe` 是这个会话的订阅：在页面里订的，页面关了就没了。要在内核死掉时发横幅，在后台会话里（菜单栏的 `start`）订。
- `systemProxy.enable` 被拦着时**不拒绝**：先看返回值里有没有 `blocker`，别只看有没有抛错。
- `daemon.request` 不经代理、只到 `127.0.0.1`：拿它去访问外网是走不通的，联网用 `net.fetch`。

## Related Links

- [05 · 能力授权模型](05-permissions.md)
- [10 · 设置域与服务扩展点](10-settings.md)（服务没有页面，它的东西画在哪）
- [`sdk/src/capabilities.ts`](../sdk/src/capabilities.ts)、`jarvis-mac/Sources/Jarvis/App/Extensions/ExtensionCapabilityHost.swift`、
  `jarvis-mac/Sources/Jarvis/Domain/GitHosting/GitHostingGraphQL.swift`（查询 / 变更的认定与放行）
- `jarvis-mac/specs/20261028-091917-proxy-extension-menubar-daemon/spec.md`（菜单栏域、常驻进程、本机控制口、按用户填的地址联网、系统代理）
