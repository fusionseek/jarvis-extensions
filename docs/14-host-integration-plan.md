# jarvis-mac 侧落地记录（v2）

## Overview

这一篇不再是分期方案，而是**宿主已经做了什么**的记录：v2 的域模型、受限执行、服务扩展点与清理引擎可插拔，
在 `jarvis-mac` 的 Speckit feature `specs/20261011-193606-extension-domains-service-engines/` 里落地。
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
- `jarvis-mac/docs/foundation/extensions.md`、`docs/foundation/junk-clean.md`
- [02 · 框架层级设计](02-architecture.md)、[05 · 能力授权模型](05-permissions.md)、[10 · 设置域与服务扩展点](10-settings.md)
