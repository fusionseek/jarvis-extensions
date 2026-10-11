# 设置域与服务扩展点

## Overview

扩展的设置**一律由宿主画**：扩展在 manifest 里声明偏好的类型与约束，宿主用设置页自己的控件画出来，
读起来与内置设置没有区别。扩展页面里**不许再画一份设置**——同一个值两处可改，总有一处画着旧值。

设置画在哪里取决于它属于哪个域：

| 偏好声明在 | 画在 | 为什么 |
| --- | --- | --- |
| `contributes.settings.preferences` | 设置 › **扩展** › 该扩展那块面板 | 它是这个扩展自己的设置 |
| `contributes.services[].preferences` | 那个扩展点所属的**内置区段**，例如 `junkClean.engine` → 设置 › **清理** › 清理引擎 | 服务扩展是内置能力的一部分：用户找「深度清理怎么设」会去「清理」，不会去「扩展」 |

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
| 入驻 | 「入驻：工具箱 · 窗口 · 指令 /http · 设置」；有服务的另写一句「「深度清理（Mole）」的开关与设置在 设置 · 清理」 | 在这里找不到服务的开关，是因为它在「清理」里——说出来，用户就不会以为丢了 |
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

`jarvis.preferences` 只读：扩展想改自己的偏好，只能引导用户去设置页。

## Usage

1. 扩展自己的设置：写 `contributes.settings.preferences`；服务的设置写在那个服务的 `preferences` 里。
2. 每一项写清 `title` 与 `description`：description 是用户在设置页看到的唯一解释。
3. 读值用 `jarvis.preferences.get`；用户改了要跟着变就订阅 `onChange`。

## Lifecycle / Disposal

- 关掉启用开关：前台会话关掉、后台会话收走、工具箱行消失、`/` 指令与快捷键撤下、选中的服务引擎退回 Jarvis 清理；授权与偏好原样留着。
- 卸载：删安装目录、`extension_installs` 与 `extension_grants`；选「卸载并删除数据」才删 `extension_preferences`（偏好与 `storage`）与钥匙串里的机密。

## Gotchas

- 服务的偏好**不**出现在设置 › 扩展：去它扩展的那个内置区段找。
- `number` 越界是夹取不是拒绝；需要更严的范围就把 `minimum` / `maximum` 写严。
- `secret` 没有默认值、`all()` 里没有它：只能 `get(key)` 单独读。
- 设置 › 扩展 的快捷键行只列注册上了的；这一版不能改键。

## Related Links

- [03 · manifest 规范](03-manifest.md)
- [05 · 能力授权模型](05-permissions.md)（撤销、服务的授权 sheet）
- [06 · 能力接口目录](06-capabilities.md)（`jarvis.preferences`）
- `jarvis-mac/Sources/Jarvis/UI/ExtensionSettingsSection.swift`、`ExtensionPreferenceControls.swift`、`JunkCleanSettingsSection.swift`、
  `App/JunkCleanEngineRegistry.swift`
