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
| `sdk.version` | SDK 版本，`2.4.0` |
| `host.version` / `host.channel` | 宿主版本（`CFBundleShortVersionString`）、`release` / `development` |
| `environment` | `reduceMotion` / `reduceTransparency` / `increaseContrast` / `locale`。界面上的适配由宿主做；这里给出来是让扩展自己的逻辑也能让步 |

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

#### `jarvis.permissions`

| 方法 | 说明 |
| --- | --- |
| `granted()` | 此刻拿到的能力 id 列表 |
| `request(ids)` | 再问一次，只能问 manifest 声明过的；返回 `{ granted, denied }`。后台会话里不弹，直接答此刻的授权 |
| `openSystemSettings("screenRecording" \| "accessibility")` | 打开系统设置对应隐私面板并上「把 Jarvis 拖进列表」浮窗 |

#### `jarvis.system`

| 方法 | 能力 | 说明 |
| --- | --- | --- |
| `openExtensionSettings()` | 隐式 | 打开设置窗口（偏好、授权、快捷键都在 设置 › 扩展 里）。扩展页面里**不许再画一份设置** |
| `openURL(url)` | `system.openURL` | 只放行 https |

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

### 受限执行（指令域，SDK 2）

三项能力全部**高风险**，全部要在 manifest 里逐项声明对象，宿主硬拦声明之外的一切。

#### `process.run` — 运行命令

| 方法 | 说明 |
| --- | --- |
| `locate(executable)` | 按名字在固定位置里找：`/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`、`~/bin`、`~/.nix-profile/bin`、`/run/current-system/sw/bin`（不 fork shell 去 `which`：从 Finder 起的应用只有一份最小 PATH）。带 `/` 或 `~` 的当作用户填的路径——**坏了就报坏，不悄悄回落到自动探测**。返回 `{ path, source: custom/discovered }` 或 `{ path: null, problem: notFound/missing/notExecutable }` |
| `run({ executable, arguments, onLine })` → `{ result, cancel() }` | 跑一个声明过的可执行文件；参数必须与声明的某一组**逐项相等**。标准输出逐行交给 `onLine`（宿主按 100ms 合批推过来，**全部输出先于结果到达**）；`result` 兑现为 `{ exitCode, stderr }`（stderr 末尾 4 KB）；`cancel()` 发 SIGINT，`result` 以 `cancelled` 拒绝 |

放行规则（`ExtensionProcessPolicy`）：名字或路径的**文件名**必须等于 manifest `process.executables[].name`——
用户在偏好里填 `/opt/tools/mo` 可以，填 `/bin/rm` 不行（`capability.undeclared`）。

运行环境：**不经 shell**（`;`、`|`、`$()` 都只是字符）；stdin 接空设备（非交互的命令不会提示、不会卡住、不会要密码）；
工作目录是主目录；PATH 补上 Homebrew 与常见工具链目录；`HOME` 显式给出；`NO_COLOR=1`。
**进程继承 Jarvis 的全部系统权限，含完全磁盘访问**——这正是它高风险的原因。测试进程里一律拒绝。每分钟 ≤ 120 次。

#### `files.read` — 读取文件

| 方法 | 说明 |
| --- | --- |
| `stat(path)` | `{ size, inode }`；文件不在或是目录时 `null` |
| `tail(path, offset)` | 从字节偏移起读**完整的**行，一次 ≤ 1 MB：`{ lines, offset, size, inode }`。最后一个换行之后的半行不读，留到下一次；`offset` 超过文件大小时从 0 读（文件被换掉了）。文件不在时 `null` |

路径必须与 manifest `files.read` 里的某一个逐字相等（展开 `~`、规整之后比——`~/Library/Logs/mole/../../Keychains/x` 绕不过去）。
换了 inode 或文件变小 = 被轮转了，由扩展自己从 0 接着读。每分钟 ≤ 1200 次（一次清理要读几百次日志）。

#### `terminal.run` — 在终端里执行脚本

`run(scriptId)`：打开用户选定的终端，执行 manifest `process.terminal` 里那个 id 的脚本——**扩展只能点名，不能传内容**。
宿主在正文前补 `#!/bin/sh` 与「执行完删掉自己」那一行，写到属主独占的临时目录再交给终端打开；打开即返回，不等它跑完。
每分钟 ≤ 6 次。装完之后的事（工具在不在了）由扩展自己再 `locate` 一次。

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

## Related Links

- [05 · 能力授权模型](05-permissions.md)
- [10 · 设置域与服务扩展点](10-settings.md)（服务没有页面，它的东西画在哪）
- [`sdk/src/capabilities.ts`](../sdk/src/capabilities.ts)、`jarvis-mac/Sources/Jarvis/App/Extensions/ExtensionCapabilityHost.swift`、
  `jarvis-mac/Sources/Jarvis/Domain/GitHosting/GitHostingGraphQL.swift`（查询 / 变更的认定与放行）
