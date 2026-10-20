# jarvis-mac 侧落地记录（v2）

## Overview

这一篇不再是分期方案，而是**宿主已经做了什么**的记录：v2 的域模型、受限执行、服务扩展点与清理引擎可插拔，
在 `jarvis-mac` 的 Speckit feature `specs/20261011-193606-extension-domains-service-engines/` 里落地；
Git 域、Git 操作域与项目引擎（SDK 2.1）在 `specs/20261015-123126-github-project-management/` 里落地，见文末「第二轮」；
Android 操作域与行首图标（SDK 2.4）在 `specs/20261017-170440-issue-derive-app-scan/` 里落地，见「第三轮」。
扩展作者读它，是为了知道每一条规则在宿主哪一个类型里被执行；宿主开发者读它，是为了改动时知道牵动哪几处。

文件名保留 `14-host-integration-plan.md`：其余文档、PR 模板与 jarvis-mac 的引用都指向这个名字，改名只会多出一批死链。

真源在 `jarvis-mac`：本文与那边的 `spec.md` / `plan.md` 冲突时以那边为准。

## Concepts

### 决策一览（spec D-1…D-15）

| # | 决策 | 一句话 |
| --- | --- | --- |
| D-1 | 按域组织 | 悬浮球（不开放）、工具箱、窗口、指令、设置、服务六个域 + Inbox 通道；`contributes` 至少入驻工具箱 / 窗口 / 指令 / 服务之一 |
| D-2 | 一次性换代 | manifest v2 / registry v2 / bridge 2 / SDK 2.0，旧的一律不读，没有迁移代码 |
| D-3 | 两种会话 | 一个前台会话（有界面，三面）+ 每扩展一个后台会话（无界面，闲 60 秒收） |
| D-4 | 指令一张表 | 内置指令与扩展指令合表；撞内置的不加载，扩展之间先装先得 |
| D-5 | 受限执行 | `process.run` / `files.read` / `terminal.run`，只放行 manifest 里逐字声明的对象 |
| D-6 | 服务扩展点 | 宿主定义契约；第一个是 `junkClean.engine`；线缆 `service` / `serviceCancel` 与 `service.resolve` / `service.progress` |
| D-7 | 清理引擎注册表 | Mole 的一切移出主程序；悬浮球一个字不改；Jarvis 清理继续读 `~/.config/mole/whitelist` |
| D-8 | 设置域 | 宿主画七种偏好控件；服务的偏好画在扩展点指定的内置区段 |
| D-9 | 窗口域 | 工作区 `.extension` 标签，按扩展 id 去重，正文 ≤ 720 居中 |
| D-10 | 工具箱域 | 可选的 `contributes.toolbox`；没有它不进目录 |
| D-11 | 能力目录 v2 | 只列宿主做得到的 17 项；删掉粘贴板历史、速记、日历、任务、文件选择、BigQuery |
| D-12 | 商店 | 卡片与详情一行入驻；回执按域说去哪儿找它 |
| D-13 | 授权屏 | 列全部声明；高风险项由宿主写一句话，受限执行逐字列对象 |
| D-14 | 扩展仓 | `translation` / `http-status` / `send-to-phone` 主版本 +1 按 v2 重写；新增 `mole-clean` |
| D-15 | 文档 | 本仓 `docs/01`–`14`、`README.md`、`AGENTS.md`、模板；jarvis-mac 的 `docs/foundation/extensions.md`、`junk-clean.md` 等 |

### 宿主类型与文件

路径相对 `jarvis-mac/Sources/Jarvis/`。

**Domain（纯函数，可测）**

| 类型 | 文件 | 管什么 |
| --- | --- | --- |
| `ExtensionManifest`、`ExtensionCapabilityID`、`ExtensionServicePoint` | `Domain/Extensions/ExtensionManifest.swift` | v2 结构、能力枚举与档位、扩展点枚举 |
| `ExtensionManifestValidation` | `Domain/Extensions/ExtensionManifestValidation.swift` | 跨字段校验（域与落点、能力与声明对象、关键词、偏好键） |
| `ExtensionRegistry`（`ExtensionRegistryEntry`、`ExtensionManifestHeader`） | `Domain/Extensions/ExtensionRegistry.swift` | 索引 v2 两层读取：条目读不出只让那张卡失效，索引层读不出整份作废 |
| `ExtensionCapabilityMap`、`ExtensionRateLimitPolicy` | `Domain/Extensions/ExtensionCapabilityMap.swift` | 方法 → 能力；隐式能力；限频表 |
| `ExtensionGatePolicy`、`ExtensionGrantPolicy` | `Domain/Extensions/ExtensionGatePolicy.swift` | 闸门判定；第一次进入 / 新增能力的授权范围 |
| `ExtensionProcessPolicy` | `Domain/Extensions/ExtensionProcessPolicy.swift` | 可执行文件名 / 路径、参数组逐项相等、可读路径规整后相等、`locate` 的候选目录 |
| `ExtensionJunkCleanContract` | `Domain/Extensions/ExtensionServiceContracts.swift` | `junkClean.engine` 的入参与 status / 报告 / 进度 / 动作结果的解码 |
| `ExtensionCommandCatalog`（`ExtensionSlashCommand`、`ExtensionCommandConflict`） | `Domain/Extensions/ExtensionCommandCatalog.swift` | 扩展指令表、与内置保留词的冲突、先装先得 |
| `ExtensionCatalogPolicy`（`InstalledExtensionSummary`） | `Domain/Extensions/ExtensionCatalogPolicy.swift` | 只把有工具箱域的扩展合进目录；窗口入口给全局搜索 |
| `ExtensionSurfacePolicy` | `Domain/Extensions/ExtensionSurfacePolicy.swift` | 三面优先级：弹窗 > 窗口 > 工具箱 |
| `ExtensionBridgeMessage` | `Domain/Extensions/ExtensionBridgeMessage.swift` | 协议 2 的事件与调用编解码 |
| `ExtensionCompatibilityPolicy`（`ExtensionRuntime.sdkMajor = 2`） | `Domain/Extensions/ExtensionCompatibilityPolicy.swift` | 需要 Jarvis ≥ x / 需要 SDK N / 读不懂它（`.manifestUnreadable`） |
| `ExtensionStorePolicy` | `Domain/Extensions/ExtensionStorePolicy.swift` | 商店卡片与详情的入驻行、受限执行的事实行、回执 |
| `ExtensionPopoverPlacement` | `Domain/Extensions/ExtensionPopoverPlacement.swift` | 弹窗 400 宽、≤ 520 高、贴选区或指针 |
| `JunkCleanEngineDescriptor` | `Domain/JunkClean.swift` | 取代闭合的 `JunkCleanEngineKind`：`native` 或 `<扩展 id>/<服务 id>` |
| `LauncherCommandPolicy`、`MemoSlashMenu` | `Domain/LauncherCommand.swift`、`Domain/MemoSyntax.swift` | 全局搜索与速记的 `/` 候选读「内置 + 扩展」 |

**Infrastructure**

| 类型 | 文件 | 管什么 |
| --- | --- | --- |
| `RegistrySnapshotSync` | `Infrastructure/Extensions/RegistrySnapshotSync.swift` | codeload 归档 + ETag；**读不出的缓存快照整个删掉、ETag 一起清**（否则下一次 304 在一份读不出的快照上，商店永远空着） |
| `ExtensionStore` | `Infrastructure/Extensions/ExtensionStore.swift` | 安装 / 授权 / 偏好三张表的读写；读不出 manifest 的安装连数据一起删 |
| `ExtensionInstallDirectory`、`ExtensionBundleVerifier` | `Infrastructure/Extensions/` | 安装目录读写；SHA-256 校验 |
| `ExtensionJSContext`、`ExtensionNetworkClient` | `Infrastructure/Extensions/` | JavaScriptCore 上下文；`net.fetch` |
| `ExtensionProcessRunner`、`ExtensionFileReader`、`ExtensionTerminalScript`、`ExtensionLineBuffer` | `Infrastructure/Extensions/ExtensionProcessRunner.swift` | 受限执行：不经 shell 的 exec、补 PATH、逐行合批、stderr 末尾 4 KB、取消；`stat` / `tail`；终端脚本落临时文件 |
| `ExtensionKeychainSecretStore` | `Infrastructure/Extensions/ExtensionSecretStore.swift` | `secret` 偏好进钥匙串 |
| `JunkCleanPreferences` | `Infrastructure/JunkCleanPreferences.swift` | 只剩引擎 id（`UserDefaults` `junkClean.engine`） |
| 删除 | `MoleCleaner.swift`、`MoleOperationLog.swift`、`MoleInstallScript.swift` | 以 TypeScript 重写进 `extensions/mole-clean/`，测试一并搬过去 |

**App**

| 类型 | 文件 | 管什么 |
| --- | --- | --- |
| `ExtensionCenterModel` | `App/ExtensionCenterModel.swift` | 已装清单、安装 / 更新 / 卸载；`purgeUnreadable`：读不出的安装整批卸掉（顺带清掉本机全部 v1 扩展）；推指令表与引擎表 |
| `ExtensionSessionModel`（`Role` 前台 / 后台） | `App/Extensions/ExtensionSessionModel.swift` | 一个 JS 上下文的一生：三面、命令、服务调用的进出 |
| `ExtensionRuntimeCenter`、`ExtensionBackgroundCenter`、`ExtensionCommandDispatcher` | `App/Extensions/ExtensionRuntimeCenter.swift` | 前台会话（全局一个）；后台会话（每扩展一个，`idleTimeout` 60 秒、每 15 秒巡检）；命令按落点分派 |
| `ExtensionCapabilityHost` | `App/Extensions/ExtensionCapabilityHost.swift` | 闸门之后的执行；后台会话里拒绝界面类调用 |
| `JavaScriptExtensionEngine` | `App/Extensions/ExtensionEngine.swift` | 引擎协议的 JavaScriptCore 实现 |
| `ExtensionHotKeyCenter` | `App/Extensions/ExtensionHotKeyCenter.swift` | 按 manifest 注册快捷键 |
| `ExtensionGrantsModel`、`ExtensionPreferencesModel` | `App/Extensions/` | 设置页里授权与偏好的读写，并通知活着的会话 |
| `ExtensionWorkspaceSession`、`ExtensionWindowPresenter` | `App/Extensions/ExtensionWorkspace.swift` | 工作区标签与前台会话的窗口面 |
| `ExtensionOpenRouter` | `App/Extensions/ExtensionOpenRouter.swift` | 「打开」按域去哪 |
| `JunkCleanEngineRegistry`、`ExtensionJunkCleanEngine`、`ExtensionCommandRegistry` | `App/JunkCleanEngineRegistry.swift` | 可选引擎、选择、状态缓存、动作与 `watchStatus` 轮询、启用时的授权 sheet；服务引擎适配器；扩展指令表单例 |
| `JunkCleanCoordinator`、`JunkCleanSettingsModel` | `App/` | 清理流程按引擎描述符走；回落到 Jarvis 清理时报告写明原因 |

**UI**

| 视图 | 文件 |
| --- | --- |
| 扩展页面与宿主态、`ExtensionConsentView` | `UI/FloatingExtensionHostView.swift` |
| 节点渲染 | `UI/ExtensionRendererView.swift` |
| 原地弹窗 `ExtensionPopoverController` | `UI/ExtensionPopoverWindow.swift` |
| 工作区标签 | `UI/ExtensionWorkspacePage.swift` |
| 商店与详情 | `UI/FloatingExtensionStoreView.swift`、`ExtensionStoreDetailView.swift`、`ExtensionStoreControls.swift` |
| 设置 › 扩展（`ExtensionInstalledPanel`）、偏好控件（`ExtensionPreferenceRows`） | `UI/ExtensionSettingsSection.swift`、`ExtensionPreferenceControls.swift` |
| 设置 › 清理 · 清理引擎、清理工具的引擎状态卡 | `UI/JunkCleanSettingsSection.swift`、`FloatingJunkCleanView.swift` |
| tokens | `UI/DesignTokens.swift`：`JarvisDesign.Extensions.Window`（720 / 16）、`.Consent.sheetSize`（420×520）、`.Preferences`（180 / 80）、`.Popover` |

### 契约

| 产物 | 位置 |
| --- | --- |
| manifest v2 | 本仓 `schemas/extension.v2.schema.json`（v1 已删） |
| 索引 v2 | 本仓 `schemas/registry.v2.schema.json`（v1 已删）；`registry.json` 每条带整份 manifest |
| 线缆协议 2 | `jarvis-mac/contracts/schemas/extensions/bridge.v2.schema.json`；样例在 `contracts/fixtures/extensions/` |
| SDK 2.0 | 本仓 `sdk/src/`（`manifest.ts`、`bridge.ts`、`capabilities.ts`、`services.ts`、`index.ts`、`testing.ts`） |

扩展线缆是进程内 JSON，不是 WebSocket 应用消息；它照 schema-first 处理（先改 schema 与 fixture，再改 Swift 与 SDK）。

### 存储：没有迁移

| 表 / 位置 | v2 怎么用 |
| --- | --- |
| `extension_installs` / `extension_grants` | 照用 |
| `extension_preferences` | `<id>` 一行装偏好（扩展的与服务的共用），`<id>#storage` 一行装 `jarvis.storage` |
| `extension_documents` / `extension_inbox_cards` | 维持原状、v2 不写（`inbox.post` 投的是一条 Inbox 消息） |
| 钥匙串 | service `ai.fusionseek.jarvis.extension-secret`、account `<id>.<key>` |
| `UserDefaults` | `junkClean.engine`（单值）；快照 ETag、上次同步时刻、自动检查开关 |

**为什么没有迁移**：用户与扩展都少，过渡代码会留隐患（spec Complexity Tracking）。
v1 安装的清理靠一条通用不变量完成——「一条跑不起来、也画不出来的安装记录不该留着」——而不是一段 v1→v2 的迁移。

### 有意不做

- 开发者模式（本地目录加载、热重载）；
- 扩展进快捷环；Inbox 卡片上的动作；
- 同步工具只有 `text.base64` / `text.hash` / `text.language` 与 `host.*`：SDK 1 类型里写过、宿主从没接上的 `text.json` / `text.url` / `text.regex` / `time.*` / `color.*` 已从 SDK 2 拿掉；
- 设置页里改扩展快捷键（这一版只列注册上了的）。

### 外部页

命中「对外产品页当前已在演示的界面发生可见变化」（`jarvis-web` 第 16 节「开放扩展」演示商店与授权，能力数由 mac 派生）。
结论：**需同步**，落在 `jarvis-web` 自己的提交里，不夹带进 `jarvis-mac` 或本仓库。

### 第二轮：Git 域、Git 操作域与项目引擎（spec `20261015-123126-github-project-management` K / H 节）

仓库主人要 GitHub Project 不进主程序，又要原生表格、甘特复用与最好的性能：于是宿主做提供方无关的「项目」框架，
GitHub Projects v2 的全部专属知识做成扩展 [`github-project`](../extensions/github-project)，插在新扩展点 `project.engine` 上。

| # | 决策 | 一句话 |
| --- | --- | --- |
| K-1 | 宿主做框架、扩展做引擎 | 工作项、通用字段、映射配置、工作流、漂移守卫、镜像、界面在宿主；GraphQL 与字段翻译在扩展 |
| K-3 | 新扩展点 `project.engine` | `describe` / `listProjects` / `readSchema` / `readItems` / `applyEdit` / `createField` / `createOption`；入参在 `params.request`；引擎只交原始值 |
| K-4 | 有无引擎 | 没有引擎时「项目」、Projects 分组、Project 行、「Project 关联」都不出现；卸载删镜像、保留配置 |
| K-5 | 只追加不改名 | 契约方法、字段类型名、能力 id 一经发布不改；`describe` 报契约版本与可选能力，宿主按它降级 |
| H-1 | 新域 `contributes.git` | `{ hosting[], summary }`；不是入口；Git 操作域的能力只对入驻了的托管服务放行 |
| H-2 | Git 操作域三项能力 | `git.repository.read`（中）、`git.hosting.read`（中）、`git.hosting.write`（高）；目录 16 → 19。设计稿里的 `git.events`、`git.branch.create` 本期没有调用方，不进目录 |
| H-2 | 变更白名单 | 顶层 `git.mutations`；宿主按 GraphQL 文档的顶层字段名逐个比对，`git.hosting.write` ⇔ `git.mutations` 成对 |
| H-3 | 边界不破 | `gh` 仍只在宿主的 `Infrastructure/GitHosting/`；扩展 → 闸门 → 宿主 → `GitHostingService`；token 不交给扩展 |

| 类型 | 文件（相对 `jarvis-mac/Sources/Jarvis/`） | 管什么 |
| --- | --- | --- |
| `ExtensionCapabilityID`（+3）、`ExtensionGitDeclaration`、`ExtensionGitContribution`、`ExtensionDomain.git`、`ExtensionServicePoint.projectEngine` | `Domain/Extensions/ExtensionManifest.swift` | 能力与档位、`git.mutations`、Git 域、扩展点（设置画在「Git」、角色「项目引擎」） |
| `checkGit` | `Domain/Extensions/ExtensionManifestValidation.swift` | `git.hosting.write` ⇔ `git.mutations`、变更名格式 / 不重 / ≤ 32、`contributes.git` 的形状、`git.*` ⇒ 入驻 Git 域 |
| `ExtensionCapabilityMap`、`ExtensionRateLimitPolicy` | `Domain/Extensions/ExtensionCapabilityMap.swift` | `git.repositories` / `git.hosting.viewer` / `git.hosting.query` / `git.hosting.mutate` → 能力；读 240、写 60、仓库 60 次 / 分钟 |
| `GitHostingGraphQLPolicy`、`GitHostingIdentity` | `Domain/GitHosting/GitHostingGraphQL.swift` | GraphQL 文档的最小解析：一个操作、查询 / 变更 / 订阅、顶层字段名；token 的 scope → `projectAccess` |
| `ExtensionProjectEngineContract` | `Domain/Extensions/ExtensionProjectEngineContract.swift` | `project.engine` 各返回值的宽进严出解码、`applyEdit` 请求编码 |
| `ExtensionCapabilityHost`（Git 操作域一段） | `App/Extensions/ExtensionCapabilityHost.swift` | 闸门之后：认定托管服务、放行判定、经 `GitHostingService` 执行 |
| `ExtensionSessionModel` | `App/Extensions/ExtensionSessionModel.swift` | 服务调用的 `request` 与超时（`describe` 15 秒、`readItems` 60 秒、其余 45 秒） |
| `ProjectEngineRegistry`、`ExtensionProjectEngineClient` | `App/Projects/` | 引擎表、第一次用之前的授权、`describe` 缓存、调用 |
| `ExtensionStorePolicy`、`ExtensionConsentView` | `Domain/Extensions/ExtensionStorePolicy.swift`、`UI/FloatingExtensionHostView.swift` | 商店「Git · summary」与「Git 变更」事实行；授权屏上 `git.hosting.read` / `write` 那一句 |

| 产物 | 位置 |
| --- | --- |
| manifest | 本仓 `schemas/extension.v2.schema.json`：能力枚举 +3、顶层 `git`、`contributes.git`、扩展点 `project.engine` |
| 线缆 | `jarvis-mac/contracts/schemas/extensions/bridge.v2.schema.json`：`serviceCall` 的点与方法、`$defs.projectEngine*` 等；样例 `contracts/fixtures/extensions/bridge/project-engine-*.json` |
| SDK 2.1 | 本仓 `sdk/src/`：`jarvis.git`（`capabilities.ts`）、`ProjectEngine`（`services.ts`）、`ServiceCall.params.request`（`bridge.ts`）、运行时分派（`index.ts`）、替身 `callService({ request })`（`testing.ts`） |
| SDK 2.2 | `project.engine` 加 `createIteration` 与能力 `createIterations`（jarvis-mac 同 spec 第八轮 U-5「新增迭代」）：线缆 `serviceCall.method` 与 `projectEngineRequest.startDate`、样例 `project-engine-request.create-iteration*.json`；只追加，2.1 的引擎照常工作（宿主见不到这项能力时把入口置灰） |
| SDK 2.3 | `project.engine` 加 `createItem` 与能力 `createItems`（jarvis-mac 同 spec 第十八轮 AG-1「新建条目」）：线缆 `serviceCall.method`、`projectEngineRequest.title` / `body` 与 `$defs.projectEngineCreatedItem`、样例 `project-engine-request.create-item*.json` / `project-engine-created-item*.json`；只追加，2.2 的引擎照常工作（宿主见不到这项能力时把「新建」置灰） |
| SDK 2.6 | `readItems` 认 `itemIds` 与能力 `readItemsById`（jarvis-mac `specs/20261020-083342-project-view-refresh-gantt-polish` A「刷新本视图」）：线缆 `projectEngineRequest.itemIds`、`projectEngineDescribe.features` 加一项，样例 `project-engine-request.read-items-by-id*.json` / `project-engine-describe.read-items-by-id.valid.json` / `bridge.event.service-project-read-items-by-id.valid.json`；只是类型，各扩展内联的 SDK 字节不变；只追加，宿主见不到这项能力时只做增量读 |

### 第三轮：Android 操作域与行首图标（spec `20261017-170440-issue-derive-app-scan` D 节）

仓库主人要一个「扫描手机上所有应用：大小、包名、应用名，最好有图标」的工具，**界面与交互写成扩展**，只要 adb 的权限，
扫到的应用能按包名交给已有的「APK 扫描」「数据导出」接着做。扩展此前做不到：`process.run` 只能跑逐字写死的参数（带不了 `-s <serial>`、
`pm path <pkg>`），设备上的 shell 给不出应用名（要 aapt2 读 APK），`image` 节点之外没有地方放一张图，也没有任何接口能打开内置工具。

| # | 决策 | 一句话 |
| --- | --- | --- |
| D-1 | Android 操作域两项能力 | `android.apps.read`（中，`apps.iphone`，「读取手机上的应用」）、`android.tools.open`（低，`arrow.up.forward.app`，「交给 APK 扫描 / 数据导出」）；目录 19 → 21 |
| D-1 | 宿主跑、扩展点名 | adb 与 aapt2 只在宿主里跑宿主写死的命令；扩展只给序列号与包名，因此没有声明对象、不入驻新域 |
| D-1 | 方法 | `android.devices` / `android.apps` / `android.appDetails`（1…8 个包）/ `android.openTool`；限频 120 次（读三项合计）与 30 次 / 分钟 |
| D-1 | 行首图标 | `row.image`：宿主颁发的句柄（`appDetails` 交回的图标），有它就不画 `symbol` |

| 类型 | 文件（相对 `jarvis-mac/Sources/Jarvis/`） | 管什么 |
| --- | --- | --- |
| `ExtensionCapabilityID`（+2） | `Domain/Extensions/ExtensionManifest.swift` | 能力、档位、授权屏标题与符号 |
| `ExtensionCapabilityMap`、`ExtensionRateLimitPolicy` | `Domain/Extensions/ExtensionCapabilityMap.swift` | `android.devices` / `android.apps` / `android.appDetails` → `android.apps.read`，`android.openTool` → `android.tools.open`；120 / 30 次 / 分钟 |
| `ExtensionConsentView` | `UI/FloatingExtensionHostView.swift` | 授权屏上 `android.apps.read` 那一句（「…把安装包临时拉到本机，读完即删」） |

| 产物 | 位置 |
| --- | --- |
| manifest | 本仓 `schemas/extension.v2.schema.json`：能力枚举 +2 |
| SDK 2.4 | 本仓 `sdk/src/`：`jarvis.android` 与 `AndroidDevice` / `AndroidApp` / `AndroidAppDetail` / `maximumAndroidAppDetailsPerCall`（`capabilities.ts`）、档位（`manifest.ts`）、`RowNode.image`（`ui.ts`）、运行时绑定（`index.ts`）、替身 `fakeAndroid()`（`testing.ts`）；只追加，2.3 的扩展照常工作 |
| 扩展 | [`extensions/android-apps`](../extensions/android-apps)「手机应用」：工具箱一页，只声明这两项能力 |

### 第四轮：全局搜索的应用目录（spec `20261019-145942-derive-local-open-sub-issue-app-search` C 节）

仓库主人要全局搜索里有一块「类似于现在系统的 APP 展示」——按组排开的应用网格、分组、排序、长按删除、在访达中显示，**按扩展的形式来支持**；
工具箱里打开的是全局搜索这块的显示设置。扩展的界面画不进全局搜索那只框，SDK 也没有网格、长按、右键——于是照「项目」「清理」的做法：
扩展供数据（分组与先后），宿主画界面并做用户亲手点出来的那几件事。

| # | 决策 | 一句话 |
| --- | --- | --- |
| C-1 | 新扩展点 `launcher.apps` | 方法只有 `catalog`（不带入参、15 秒）：`{ showInSearch, searchLimit, groups[] }`；设置段「全局搜索」、宿主侧叫「应用目录」 |
| C-1 | 新能力 `apps.read` | 中，`square.grid.3x3`，「读取本机应用列表」；方法 `apps.list`（60 次 / 分钟）；目录 21 → 22 |
| C-2 | 宿主扫 | 三处应用目录、两层，`Info.plist` + Spotlight 元数据；只在内存缓存 5 分钟，不进库 |
| C-4 / C-5 | 宿主画 | `app ` 视图网格、编辑态（按住 0.5 秒）、✕ + 确认条 → `FileManager.trashItem`；系统 / 正开着 / 没写权限 / Jarvis 自己不能删 |

| 类型 | 文件（相对 `jarvis-mac/Sources/Jarvis/`） | 管什么 |
| --- | --- | --- |
| `MacAppRecord`、`MacAppCategory`、`MacAppSearchPolicy`、`ExtensionLauncherAppsContract`、`MacAppGridNavigation`、`MacAppDeletePolicy`、`LauncherAppsQuery` | `Domain/MacApps.swift` | 应用是什么、分类中文名、搜索打分（含拼音首字母）、目录解析、网格移动、能不能删、`app ` 指令 |
| `MacAppScanner` | `Infrastructure/MacAppScanner.swift` | 扫描、缓存、移到废纸篓 |
| `LauncherAppsCenter` | `App/LauncherAppsCenter.swift` | 认出提供方、问目录、打开 / 在访达中显示 / 删除 |
| `LauncherAppsGrid` 等 | `UI/LauncherAppsGridView.swift` | 网格、编辑态、确认条、←→ 键、设置 · 全局搜索那一行 |

| 产物 | 位置 |
| --- | --- |
| manifest | 本仓 `schemas/extension.v2.schema.json`：能力 +1、扩展点 +1 |
| SDK 2.5 | 本仓 `sdk/src/`：`jarvis.apps` 与 `MacApp`（`capabilities.ts`）、`LauncherAppsEngine` / `LauncherAppsCatalog`（`services.ts`）、档位与扩展点（`manifest.ts`）、服务分派（`index.ts`）；只追加 |
| 扩展 | [`extensions/mac-apps`](../extensions/mac-apps)「应用」：服务 `launcher.apps` + 工具箱设置页，只声明 `apps.read` |

## Usage

- 扩展作者：遇到一条规则想知道"是谁在拦"，按上表找到类型名，在 `jarvis-mac` 里读它的文档注释——每条规则都写了为什么。
- 宿主开发者：改能力、扩展点或线缆，先改契约（本仓 schema、SDK 类型、`bridge.v2.schema.json`），再改 Swift；
  加一个扩展点 = `ExtensionServicePoint` 一个 case + 一份契约解码 + 一个注册表适配器 + SDK `services.ts` 一个接口 + 本仓 [10](10-settings.md) 一节。

## Gotchas

- 「服务扩展的授权在第一次启用时问」只对已知扩展点成立：一个新的扩展点必须同时定义"在哪里启用它"，否则它的后台会话永远拿不到授权。
- 宿主的受限执行只拦**声明之外**；声明本身是否最小，只能靠审核（[13](13-review-checklist.md)）。
- 授权屏上 `hotkeys.register` 那一句写「会注册全局快捷键 ⌥⌘T · …」；设置 · 扩展列出真的注册上的那些，这一版不提供改键。

## Related Links

- `jarvis-mac/specs/20261011-193606-extension-domains-service-engines/`（`spec.md`、`plan.md`、`tasks.md`、`validation.md`）
- `jarvis-mac/specs/20261015-123126-github-project-management/`（第二轮：Git 域、Git 操作域、项目引擎；`research.md` 是 GitHub GraphQL 的实测）
- `jarvis-mac/specs/20261017-170440-issue-derive-app-scan/`（第三轮：Android 操作域、`row.image`）
- `jarvis-mac/docs/foundation/extensions.md`、`docs/foundation/junk-clean.md`
- [02 · 框架层级设计](02-architecture.md)、[05 · 能力授权模型](05-permissions.md)、[10 · 设置域与服务扩展点](10-settings.md)
