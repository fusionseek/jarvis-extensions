# jarvis-mac 侧实施方案

## Overview

本仓库只放扩展与它们的契约；宿主的每一行改动都在 `jarvis-mac`，并且**每一期都是一个 Speckit feature**
（`specs/YYYYMMDD-HHMMSS-<slug>/`，`.specify/feature.json` 指向它，先 spec 后实现）。
本文是那几个 feature 的**提纲**：分几期、每期改什么、决定是什么、测试钉什么、哪些门禁会被命中。
它不替代 spec，spec 从这里起草。

四期，顺序不可换——后一期都站在前一期的类型上：

| 期 | slug（建议） | 交付 | 用户看到什么 |
| --- | --- | --- | --- |
| A | `toolbox-extension-gallery` | 虚化的加号、扩展库页面、快照同步、安装记录（DB v8 前半）、设置页「扩展」骨架 | 能看、能装，装了点进去是一屏「运行时下一期到」 |
| B | `extension-runtime` | JSContext 运行时、线缆、能力闸门、授权弹窗、渲染器全部节点、`storage` / `preferences` / 纯函数工具 | 扩展真的能跑，第一次进入弹授权 |
| C | `extension-settings-inbox` | 偏好渲染、授权撤销、Inbox 卡片与横幅、`background` 常驻、快捷环接入 | 四个部分齐了 |
| D | `extension-developer-mode` | 本地目录加载、热重载、日志抽屉、警告 | 开发者能在本机迭代 |

每期都要：版本 patch +1（三处一致）、`swift test` / `swift build` / `xcodebuild` / `validate_contracts.py` /
`git diff --check`、docs 与 design-system 回写、**外部页影响评估**段落。

## 期 A · 扩展库

### 决定

- **D-A1 两个新内容模式，都属工具箱主线。** `FloatingPanelContentMode` 加 `extensionGallery` 与 `extension`；
  `section` 那一支的工具箱分组各加一个 case。它们**不是工具**：`jarvis-web/scripts/sync-from-mac.mjs`
  的分类规则要显式排除这两个 case（否则页面会对外报"13 个工具"），这一条写进本期的外部页影响评估。
- **D-A2 活动扩展是内容模式旁边的第二坐标。** `AppModel.activeExtensionID: String?`，只在
  `applyPanelContentMode` 同一拍写入；`FloatingPanelSectionMemory` 的工具箱那一格从 `toolboxPage: FloatingPanelContentMode`
  变成 `toolboxPage: FloatingPanelToolboxPage`（`struct { mode; extensionID? }`）。不给枚举加关联值：
  `CaseIterable` / `rawValue` / `OrbShortcutKind.panelContent(String)` / 派生脚本都依赖它是闭合的。
- **D-A3 目录合并是纯函数。** `ExtensionCatalogPolicy.items(builtIn:installed:)`；扩展行 id 带 `extension:` 前缀；
  加号是 `FloatingToolboxView` 的尾随构件，不进目录、不进搜索、不进计数。
- **D-A4 快照不走 git。** `RegistrySnapshotSync`：HTTPS zipball → `ZipArchiveReader` → `Caches/…/extensions/registry/<sha7>/`；
  `If-None-Match`；≥ 30 分钟才自动拉；三种"空"各一屏；解析失败显示上一份。前提：仓库 public。
- **D-A5 安装即校验。** SHA-256 与 registry 比对，不等拒绝；拷到 Application Support；`extension_installs` 一行。
  **安装不弹授权**——授权在第一次进入。
- **D-A6 DB v8 一次加五张表**（`extension_installs` / `extension_grants` / `extension_preferences` /
  `extension_documents` / `extension_inbox_cards`），保留策略见 [02](02-architecture.md)。后三张本期不写，
  但迁移只进不退，一次加齐比分三次加省三次 schema 快照。
- **D-A7 设置页「扩展」区段本期只有骨架**：扩展库面板 + 每个已装扩展的头行（名、版本、启用开关、卸载）。

### 改动清单

| 层 | 文件 | 改什么 |
| --- | --- | --- |
| Domain | `Extensions/ExtensionManifest.swift` | `Codable` 结构 + `validate()`，与 `extension.v1.schema.json` 逐字段对应；跨字段规则 |
| Domain | `Extensions/ExtensionRegistry.swift` | `registry.json` 结构 + 校验 |
| Domain | `Extensions/ExtensionCatalogPolicy.swift` | 目录合并、排序、`extension:` 前缀 |
| Domain | `Extensions/ExtensionCompatibilityPolicy.swift` | `sdk` 主版本、`minimumJarvisVersion`（用 `AppVersion`）、更新判定 |
| Infrastructure | `Extensions/RegistrySnapshotSync.swift` | 拉、解、缓存、ETag、上限 |
| Infrastructure | `Extensions/ExtensionStore.swift` | 五张表的 CRUD；`JarvisMigrations` 追加 v8；`schema.md` + `schema-v8.sql` |
| Infrastructure | `Extensions/ExtensionBundleVerifier.swift` | SHA-256 |
| App | `Extensions/ExtensionCenterModel.swift` | 已装 / 可装 / 更新 / 安装 / 卸载 / 启用 |
| App | `AppModel.swift` | `activeExtensionID`、`showExtension(_:)`、记忆结构 |
| UI | `FloatingPanelContentMode.swift` | 两个 case、`section`、`title(for:)`（gallery「扩展库」；extension 读 manifest name） |
| UI | `FloatingToolboxView.swift` | 目录来源换成 `ExtensionCatalogPolicy`、尾随加号、搜索排除 |
| UI | `FloatingStatusView.swift` | `expandedContent` 两支、`headerBadge` 两支 |
| UI | `FloatingExtensionGalleryView.swift`、`FloatingExtensionHostView.swift`（本期只画"运行时未就绪"） | 新 |
| UI | `DesignTokens.swift` | `JarvisDesign.Toolbox.AddExtension`、`JarvisDesign.Extensions.Gallery`，带理由注释与 Figma 节点号 |
| UI | `SettingsIndex.swift`、`SettingsView.swift` | `extensions` case 与区段骨架 |
| Tests | `ExtensionManifestTests`、`ExtensionRegistryTests`、`ExtensionCatalogPolicyTests`、`ExtensionCompatibilityTests`、`RegistrySnapshotSyncTests`（注入临时目录 + 本地 zip 夹具）、`ExtensionStoreTests`、`JarvisDatabaseTests`（v8 快照）、`FloatingToolboxTests`（加号不进目录 / 计数 / 搜索）、`PanelSectionNavigationTests`（记忆带 extensionID）、`FloatingPanelGeometryTests`（两个新模式下 header 仍 62） | |
| Docs | `docs/foundation/extensions.md`（新）、`design-system.md`（加号 / 扩展库 / 扩展页面三节）、`floating-panel.md`（内容模式表） | |
| Web | `jarvis-web/scripts/sync-from-mac.mjs`：排除 `extensionGallery` / `extension` 两个 case；页面工具箱章节加那枚加号 | 独立提交进 `jarvis-web` |

### 外部页影响评估（本期必写）

命中：「工具箱新增一类工具」（加号）、「新增用户可见的界面能力」（扩展库）、「页面当前已在演示的界面发生可见变化」
（工具箱目录）。影响章节：工具箱。结论：**需同步**——页面演示的工具箱末尾多一枚虚化的加号；
派生脚本必须先更新，否则 `sync:mac:check` 会把两个新 case 数成工具。

## 期 B · 运行时

### 决定

- **D-B1 一个扩展一个 `JSVirtualMachine` + `JSContext`，一条串行队列。** 全局只注入 `__jarvisHost`；
  `setTimeout` / `setInterval` 由宿主实现并限数。
- **D-B2 线缆只走 JSON 字符串。** `invoke` / `invokeSync` / `commit` / `log` 四个入口；`dispatch` 一个出口；
  协议版本 1。宿主侧 `ExtensionBridgeMessage` 是 `Codable`，未知 `type` 拒绝。
- **D-B3 闸门在调用栈之外。** `ExtensionCapabilityGate.check(extensionID, namespace, method)` 六步
  （见 [02](02-architecture.md)）；"用户动作 1 秒内"由渲染器记录最近一次 `ui` 事件时刻。
- **D-B4 授权弹窗是第二类窗口。** `ExtensionConsentDialog`：借 `ResumeDialog` 的窗与按钮 tokens、
  `HostSoundTakeoverSheet` 的逐条形态、`SettingsGlassToggleStyle` 的开关；用户主动进入才弹、拿焦点；
  面板期间 `holdsPanelOpen`。
- **D-B5 渲染器按 `key` diff。** `ExtensionUINode`（每种 kind 一个 `Codable`）→ `ExtensionUIDiff`（纯函数）→
  SwiftUI；节点视图只读 `JarvisDesign`，每个可交互节点挂 `controlFocusHighlight`；输入类节点聚焦即 `onHoldChanged(true)`。
- **D-B6 纯函数工具原样复用领域层。** `text.*` / `time.*` / `color.*` 直接调 `Base64Codec`、`HashDigest`、
  `JSONFormatting`、`URLBreakdown`、`RegexTesting`、`TimeConversion` 与拾色器的色彩模型，不复制。
- **D-B7 预算与终止。** 同步 200ms 警告 / 2s 终止；内存 128 MB；节点 500；终止进错误屏。
- **D-B8 本期落地的能力**：快传、剪贴板（含 `readImage`）、截图（含 `selectionOnly` 与 `recognizeText`）、
  `ocr.recognize`、`network.https`（白名单、UA 由扩展定、系统代理）、`text.language`；其余在期 C。
  第一个扩展是截屏翻译，它要的正是这一组。
- **D-B9 命令与快捷键**：manifest `commands[]` 由宿主在启动时按 `extension_installs` 注册
  （`ScreenshotHotKeyMonitor` 那套 Carbon 热键复用）；按下 = 一次用户动作；`background: false` 的按需加载、
  跑完销毁；`presentation: "panel"` 的展开面板到该扩展。设置页给一枚**键组录制控件**，
  内置截图那两组键一并接上（了结"这一版还不能在这里改键"）。
- **D-B10 截图后回到扩展**：`screenshot.capture` 从扩展发起时走一种"只选区、松手即完成"的会话模式，
  完成 / 取消后按命令的 `presentation` 决定面板去向（页面按钮发起的按 `panel`）。
- **D-B11 输入框由宿主持有文本**：`field` / `editor` / `search` 的 `value` 只在与宿主不一致时覆写，
  中文输入法组合态不被打断。
- **D-B12 SDK 1.1**：延迟绑定宿主、`testing` 替身、`ocr.mergeLines` / `chunk`、`image` 节点。
  P-0 加两条量测：500 节点提交耗时、编辑器 20000 字符改一个字；顺带决定要不要加
  `com.apple.security.cs.allow-jit`。
- **D-B13 原地结果弹窗——宿主的第三类窗口**（面板是第一类、授权弹窗是第二类；Figma `jarvis-extension-screenshot-translate`
  `983:2` 的 `popover-01-translating` `993:4` / `popover-02-result` `993:53` / `capture-02-result-in-place` `994:4`）。
  `presentation: "popover"` 的命令：宿主在命令里第一次 `screenshot.capture` 返回时开弹窗，锚在选区左下角、
  顶边距选区下沿 12pt、左边对齐，下方放不下翻到上方，不出屏幕边 16pt，跟着选区所在的屏幕；没截图的命令锚在指针旁。
  400 宽、按内容长高最高 520 再滚；**不拿焦点**（原来的窗口继续能打字）；Esc（指针在弹窗上或弹窗刚出现 3 秒内）/
  点弹窗外 / 指针离开 15 秒关，翻译中（`panel.hold`）不倒计时；⊙ 钉住常驻，再截一块时被新的一次替换；
  ⤢「在面板里打开」= `deactivate` 弹窗 + `activate` 页面。弹窗期间原选区留一圈 1pt 青 70% 轮廓。
  线缆：`activate` 带 `surface: "popover"`，`commit` 带 `surface`；渲染器同一套节点视图换一层 chrome。
  VoiceOver 播报「<扩展名> · 结果」并把主要结果作为 `accessibilityValue`；Reduce Motion 直接出现。
- **D-B14 `screenshot.capture` 的 `hint`**：只框选会话里选框下方那句提示由扩展给（≤ 16 字），省略用「松手即完成」。
- **D-B15 `system.openExtensionSettings`**：隐式能力；打开设置窗并滚到 扩展 › 本扩展；用户动作 1 秒内放行。
- **D-B16 `picker.layout: "compact"`**：触发器画成「值 ▾」chip（借 `SettingsStatusBadge` 的形），下拉同一份。
- **期 A.1（在 2.0.0 里）**：manifest / registry 的 `presentation` 枚举认 `popover`——不认的宿主会把整份
  registry 判为无效而回落到上一份快照，因此这一步先于运行时。
  这一条曾写作「已在 2.0.1 落地」：宿主 `845da91` 当时确实把版本推到 2.0.1，但随后
  `cb650bf`（`hold at 2.0.0 until the owner starts iterating`）把版本退回 2.0.0 并钉住——
  2.0.0 还没发出去。**因此 2.0.1 不存在，扩展的 `minimumJarvisVersion` 不得写它**：
  `ExtensionCompatibilityPolicy` 只做 `hostVersion < minimum` 的比较，写了就等于在每一版宿主上都装不上。

### 改动清单

| 层 | 文件 |
| --- | --- |
| Domain | `ExtensionCapability.swift`（id、档位、隐式表、`namespace.method → id` 映射）、`ExtensionGrantPolicy.swift`（首次进入 / 新增 / request 三种范围的纯函数）、`ExtensionUINode.swift`、`ExtensionUIDiff.swift`、`ExtensionRateLimitPolicy.swift`、`ExtensionBridgeMessage.swift` |
| Infrastructure | `ExtensionJSContext.swift`（VM、队列、定时器、预算、终止）、`ExtensionBundleLoader.swift` |
| App | `ExtensionSessionModel.swift`（一个活着的扩展：加载、激活、提交树、事件）、`ExtensionCapabilityGate.swift`、`ExtensionConsentCoordinator.swift`、`ExtensionCapabilityHost*.swift`（每个命名空间一个适配：`…Clipboard`、`…QuickTransfer`、`…Screenshot`、`…Storage`、`…Preferences`、`…Panel`、`…TextTools`） |
| UI | `ExtensionRenderer.swift` + `ExtensionNodeViews/`（30 个）、`ExtensionConsentDialog.swift` + `Window`、`FloatingExtensionHostView.swift`（四个宿主态）、`DesignTokens.swift`（`JarvisDesign.Extensions.Consent`、`.Renderer`） |
| Tests | 闸门六步逐条、授权范围纯函数、diff（增删改、无 key 的重建）、每种节点的解析与拒绝、预算终止、线缆 fixture（`contracts/fixtures/extensions/bridge/*.json` 成功 + 失败）、快传 / 剪贴板适配对既有模型的调用（注入替身） |
| Docs / contracts | `contracts/schemas/extensions/bridge.v1.schema.json`（线缆消息）、`contracts/fixtures/extensions/`、`docs/foundation/extensions.md` 运行时一节、`design-system.md` 授权弹窗一节 |

线缆不是 WebSocket，不命中 WebSocket 分层 Contract 门禁；但按同一精神 **schema-first**：
`bridge.v1.schema.json` 先于 Swift `Codable`。

### 外部页影响评估

命中：「新增用户可见的界面能力」（授权弹窗）。影响章节：无（页面不演示授权流程）。结论：无需同步。

## 期 C · 设置与 Inbox

### 决定

- **D-C1 偏好是设置页的事**：五种控件映射既有组件（[10](10-settings.md)）；值进 `extension_preferences`；
  `preferencesChanged` 推给运行中的扩展。
- **D-C2 撤销即生效**：授权段每项一颗开关；`permissionsChanged`。
- **D-C3 扩展卡借速记提醒卡的解剖**，标题恒为扩展名；`UnreadItemKey.extension(String)`（`"<id>:<cardId>"`），
  `reconcile` 多一个入参；卡片进 `extension_inbox_cards`；顺序在速记提醒之后、消息卡之前。
- **D-C4 横幅无按钮**：`AppNotificationContent` 加 `extensionID`，`NotificationActivationBridge` 多一条通道；
  点横幅 = 展开到该扩展。
- **D-C5 `background: true` 的常驻**：离开页面不销毁上下文；`inboxAction` 对未运行的扩展"加载 → 执行 → 销毁"。
- **D-C6 快捷环**：`OrbShortcutKind.panelContent("extension:<id>")`；菜单里扩展列在内置工具之后。
- **D-C7 其余能力落地**：`notifications` / `inbox` / `memo` / `calendar` / `tasks` / `files` / `system` / `speech`。
- **D-C8 偏好类型 `secret` 与 `multiselect`**：`secret` 进 Keychain（`<id>/<key>`，随卸载删）、
  设置页遮罩、`preferences.all()` 里没有它；`multiselect` 是一排可多选 chip。

### 改动清单（摘要）

`SettingsView.swift` 扩展区段完整版；`FloatingStatusView.swift` 扩展卡；`UnreadState.swift`；
`AppModel.swift`（`setExtensionCards(_:)`、`announceExtensionCard`）；`ExtensionInboxBridge.swift`；
`NotificationService.swift` / `NotificationUserInfo.swift`；`OrbShortcut+ContentMode`；
`ExtensionNetClient.swift`（白名单、上限、超时）；`ExtensionCapabilityHost*` 其余命名空间；
tests：未读键往返与对账、卡片替换与 7 天撤走、频率限制、横幅落点、网络白名单拒绝、`files.pick` 的 hold。

### 外部页影响评估

命中：「页面当前已在演示的界面发生可见变化」（Inbox 演示帧若含扩展卡）。结论视页面当时的 Inbox 章节而定，
写出来。

## 期 D · 开发者模式

- **D-D1** 设置页「从本地目录加载」开关 + 目录（`UserDefaults` 标量）；`extension_installs.source = 'local'`，
  `local_path`；目录行带 `hammer` 角标。
- **D-D2** `DispatchSource` 监视 `dist/extension.js`；变更 → 销毁上下文 → 重新加载 → 回到离开时那一屏。
- **D-D3** 日志抽屉：内存环形缓冲 200 条；宿主警告（符号不存在、节点超限、hold 超时、同步预算、未声明能力）走同一条。
- **D-D4** 本地扩展不校验哈希、不查 registry；其余（闸门、弹窗、表）完全相同。

外部页影响评估：不触发（仅影响调试与内部工具的界面）。

## 跨期的门禁清单

| 门禁 | 怎么命中 | 怎么过 |
| --- | --- | --- |
| Speckit HARD STOP | 每一期 | 先建 `specs/<ts>-<slug>/`，写 spec / plan / tasks，`.specify/feature.json` 指过去 |
| CodeGraph-first | 定位 `expandedContent`、`headerBadge`、`reconcile` 等改动点 | 每轮 `codegraph sync .` 后用 `query` / `callers` / `impact` |
| 本地持久化单库 | 五张表 | v8 迁移 + `schema.md` + `schema-v8.sql` + 保留策略 + 临时目录测试 |
| 浮窗面板尺寸 | 扩展库与扩展页面 | 400×520 不动；内容滚动；`FloatingPanelGeometryTests` 逐模式核对 header 62 |
| 对外产品页同步 | 期 A 必命中 | 更新 `sync-from-mac.mjs`、`外部页影响评估` 段落、`jarvis-web` 独立提交 |
| 版本号 | 每期 | `Info.plist` / `project.pbxproj` / `generate_xcodeproj.rb` 三处 patch +1 |
| 零第三方依赖 | JavaScriptCore 是系统框架 | plan 里写明；不引入 npm 产物进宿主 |
| 设计 tokens 理由注释 | 每个新数 | 写"为什么是这个数、代价是什么、买不到什么"，带 Figma 节点号 |

## Related Links

- [02 · 框架层级设计](02-architecture.md)
- [04 · 工具箱接入与扩展库](04-toolbox-and-gallery.md)
- `jarvis-mac/AGENTS.md`、`jarvis-mac/.specify/memory/constitution.md`、根 `AGENTS.md`（对外产品页同步门禁）
