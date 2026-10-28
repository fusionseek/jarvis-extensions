/**
 * `extension.json` 的类型。**真源是 `schemas/extension.v2.schema.json`**，这里只是它的
 * TypeScript 投影，供 `defineExtension` 与脚手架做静态检查；两处冲突时以 schema 为准。
 *
 * v2 按「域」组织：一个扩展在 `contributes` 里声明它入驻哪几个域——工具箱、窗口、指令、设置、服务、Git、菜单栏（SDK 2.9）。
 * **悬浮球不是可入驻的域**：它是 Jarvis 的主入口，手势、动画与状态都是固定的；扩展只能通过
 * 「扩展一个本来就驱动悬浮球的内置能力」（服务域，例如清理引擎）间接影响它。
 */

/** 宿主能力目录（v2）。只列宿主真的做得到的；隐式能力不在这里——它们不需要用户点头。 */
export type CapabilityID =
  | "clipboard.read"
  | "clipboard.write"
  | "quickTransfer.status"
  | "quickTransfer.control"
  | "quickTransfer.send"
  | "screenshot.capture"
  | "notifications.post"
  | "inbox.post"
  | "network.https"
  | "system.openURL"
  | "ocr.recognize"
  | "speech.speak"
  | "hotkeys.register"
  /** 受限执行：跑 manifest `process.executables` 里声明过的可执行文件与参数组合。 */
  | "process.run"
  /** 读 manifest `files.read` 里声明过的文件。 */
  | "files.read"
  /** 在终端里执行 manifest `process.terminal` 里逐字写着的脚本。 */
  | "terminal.run"
  /**
   * 常驻进程（SDK 2.9）：在后台一直跑 manifest `process.daemons` 里逐字声明的那条命令，并经本机控制口与它说话。
   * 生死归宿主、不归任何 JS 会话——这正是它与 `process.run` 分开的原因：`process.run` 跟会话走，会话闲 60 秒被收，进程随之中断。
   */
  | "process.daemon"
  /**
   * 修改系统代理（SDK 2.9）：把这台 Mac 的系统代理指向 `127.0.0.1` 的一个端口。主机写死、只能指向本机，
   * 且这个扩展此刻必须有一个在跑的常驻进程；进程没了、扩展停用 / 卸载、Jarvis 退出或崩溃之后，宿主自己还原。
   */
  | "system.proxy"
  /** Git 操作域：读 Jarvis 最近打开过的仓库（名字与远端身份，不给本机路径）。要入驻 Git 域。 */
  | "git.repository.read"
  /** Git 操作域：经宿主的 Git 服务执行**只读** GraphQL、读 token 的身份与权限范围；token 不交给扩展。要入驻 Git 域。 */
  | "git.hosting.read"
  /** Git 操作域：经宿主的 Git 服务执行 manifest `git.mutations` 里逐字声明过的变更。要入驻 Git 域。 */
  | "git.hosting.write"
  /**
   * Android 操作域：经宿主的 adb 读连着的设备、设备上装了哪些应用（包名、大小）与应用名 / 版本 / 图标。
   * 宿主跑的是它自己写死的那几条命令，扩展只给设备序列号与包名——不是 `process.run` 那种「替扩展跑命令」，因此没有声明对象。
   */
  | "android.apps.read"
  /** Android 操作域：把一个包名交给内置的「APK 扫描」「数据导出」，工具里预填好，开始仍由用户按。 */
  | "android.tools.open"
  /**
   * 本机应用（SDK 2.5）：这台 Mac 装了哪些应用——名字、Bundle ID、位置、分类、最近打开 / 添加时刻。
   * 宿主自己扫三处应用目录，扩展不给路径；打开、删除应用由用户在全局搜索里点，扩展做不了。
   */
  | "apps.read";

/** 授权屏按风险分组；一档一个标签，颜色由宿主决定。 */
export type CapabilityTier = "low" | "medium" | "high";

/**
 * 每个能力的风险档位。写成常量而不是让扩展自己标：档位是宿主对用户的承诺，
 * 不是扩展对自己的评价。
 *
 * Android 操作域：读是中（用户自己手机上的东西，不出本机；安装包只临时拉到本机、读完即删），
 * 交给内置工具是低（只是把工具打开、包名填好，开始与否仍由用户按）。
 *
 * SDK 2.9 的两项都是高：常驻进程与 `process.run` 一样继承 Jarvis 的全部系统权限，还一直跑着；
 * 系统代理改的是整台机器的网络出口，浏览器与大部分应用的流量从此先经过这个扩展起的进程。
 */
export const capabilityTiers: Readonly<Record<CapabilityID, CapabilityTier>> = {
  "system.openURL": "low",
  "ocr.recognize": "low",
  "speech.speak": "low",
  "android.tools.open": "low",
  "clipboard.read": "medium",
  "clipboard.write": "medium",
  "notifications.post": "medium",
  "inbox.post": "medium",
  "quickTransfer.status": "medium",
  "hotkeys.register": "medium",
  "git.repository.read": "medium",
  "git.hosting.read": "medium",
  "android.apps.read": "medium",
  "apps.read": "medium",
  "screenshot.capture": "high",
  "network.https": "high",
  "quickTransfer.control": "high",
  "quickTransfer.send": "high",
  "process.run": "high",
  "files.read": "high",
  "terminal.run": "high",
  "process.daemon": "high",
  "system.proxy": "high",
  "git.hosting.write": "high",
};

/** 一项能力申请。 */
export interface CapabilityRequest {
  id: CapabilityID;
  /** 授权屏那一行的第二句：这个扩展拿它做什么（4–60 字）。 */
  reason: string;
}

/** 作者。 */
export interface Author {
  name: string;
  url?: string;
  github?: string;
}

/** 工具箱域：目录里一行，点开是面板里 400×520 的一屏。 */
export interface ToolboxContribution {
  /** ≤ 22 字。列表排布下那一行说明。 */
  subtitle: string;
  keywords?: string[];
}

/** 窗口域：在 Jarvis 工作区窗口里开一枚标签。 */
export interface WindowContribution {
  /** ≤ 40 字。全局搜索那一行与标签副标题。 */
  subtitle: string;
  keywords?: string[];
}

/**
 * 命令跑起来之后落在哪。
 *
 * - `toolbox`：展开面板到这个扩展的页面（要工具箱域）；
 * - `window`：在工作区开它的标签（要窗口域）；
 * - `popover`：面板不动，原地弹一扇结果弹窗——锚在这条命令里那次 `screenshot.capture` 的选区旁，没截图就锚在指针旁（要工具箱域）；
 * - `silent`：在**后台会话**里跑，不碰任何界面；至少要 `clipboard.write`、`notifications.post`、`inbox.post` 之一来交结果。
 */
export type CommandPresentation = "toolbox" | "window" | "popover" | "silent";

/** 命令在 `/` 下拉里的写法（指令域）。 */
export interface SlashSpec {
  /** `/` 下拉里显示的那一个：`^[a-z][a-z0-9-]{1,19}$`。与内置指令撞了，这条不加载。 */
  keyword: string;
  /** 也认的词，可以是中文（≤ 4 个）。 */
  aliases?: string[];
  /** 参数提示；有它 = 这条指令要参数，处理函数从 `context.argument` 拿到。 */
  argument?: string;
  /** `launcher` = 全局搜索（全局启动条与默认页搜索栏），`memo` = 速记输入框。省略 = 两处都要。 */
  scopes?: ("launcher" | "memo")[];
}

/**
 * 一条命令（指令域）。`/` 指令、全局快捷键、页面里的按钮都落到 `defineExtension({ commands })`
 * 里同 id 的处理函数上。宿主按 manifest **在启动时**就把指令与快捷键加载好，不需要扩展的 JS 在跑。
 */
export interface CommandSpec {
  /** 扩展内唯一。 */
  id: string;
  /** ≤ 12 字。 */
  title: string;
  description?: string;
  slash?: SlashSpec;
  /** 全局快捷键默认值，如 `⌥⌘T`。有它就必须声明 `hotkeys.register`。 */
  hotkey?: string;
  presentation: CommandPresentation;
}

interface PreferenceBase<T extends string> {
  key: string;
  type: T;
  title: string;
  description?: string;
}

/** 一个下拉 / 多选的选项。 */
export interface PreferenceOption {
  value: string;
  title: string;
}

/**
 * 一项偏好。控件由宿主画：开关、单行输入、数字、单选、多选、机密、目录、一列地址（SDK 2.9）。
 *
 * `urlList` 是一列 `https://` 地址（订阅地址这一类），设置页画成「一行一条 + 删除 + 添加一行」，宿主逐条校验、填错的那一行标红不存。
 * `maxItems` 省略 = 10（上限 20）；`secret` 省略 = `true`：整列进钥匙串（订阅地址里的 token 就是密码），只能经 `preferences.get` 单独读。
 * 被 manifest `network.preferenceHosts` 点名时，这些地址的主机在请求那一刻放行给 `net.fetch`——
 * 只认这种偏好，是因为它的控件由宿主画、值只可能来自用户亲手输入；页面里的输入框扩展自己就能填，宿主分不出是谁写的。没有默认值。
 */
export type Preference =
  | (PreferenceBase<"toggle"> & { default: boolean })
  | (PreferenceBase<"text"> & { default: string; placeholder?: string; maxLength?: number; monospaced?: boolean })
  | (PreferenceBase<"number"> & { default: number; minimum: number; maximum: number; step?: number })
  | (PreferenceBase<"select"> & { default: string; options: PreferenceOption[] })
  | (PreferenceBase<"multiselect"> & { default: string[]; options: PreferenceOption[] })
  /** 机密：宿主存 Keychain、设置页遮罩显示、只交给这个扩展、不进日志。没有默认值。 */
  | (PreferenceBase<"secret"> & { placeholder?: string })
  | PreferenceBase<"directory">
  | (PreferenceBase<"urlList"> & { maxItems?: number; secret?: boolean; placeholder?: string });

/** 设置域：设置页「扩展」区段里属于它的那块面板。 */
export interface SettingsContribution {
  preferences: Preference[];
}

/**
 * 宿主开放的扩展点（服务域）。
 *
 * - `junkClean.engine`：清理引擎，设置画在「清理」；
 * - `project.engine`：项目引擎，Jarvis「项目」（需求 / 迭代 / 缺陷）的数据来源，设置画在「Git」；
 * - `launcher.apps`（SDK 2.5）：全局搜索的应用目录——分组、组里先后、搜索结果里出不出与出几条；网格由 Jarvis 画，设置画在「全局搜索」；
 * - `code.format`（SDK 2.7）：Git 的代码格式化——认得哪几种语言、把一份文本格式化好交回；预览与写回由 Jarvis 做、由用户点，设置画在「Git」；
 * - `code.highlight`（SDK 2.8）：Git 的代码高亮——把代码切成记号（关键字、字符串、注释……）交回，颜色由 Jarvis 按种类定，设置画在「Git」。
 */
export type ServicePoint = "junkClean.engine" | "project.engine" | "launcher.apps" | "code.format" | "code.highlight";

/**
 * 服务域：实现宿主开放的一个扩展点。**没有独立界面**——它体现在它扩展的那个内置能力里，
 * 它的 `preferences` 也画在扩展点指定的那个内置设置区段里（`junkClean.engine` → 设置「清理」，
 * `project.engine` → 设置「Git」）。
 */
export interface ServiceContribution {
  point: ServicePoint;
  /** 扩展内唯一；`defineExtension({ services })` 按它对上实现。 */
  id: string;
  /** ≤ 16 字。在那个内置能力里的名字，例如「深度清理（Mole）」。 */
  title: string;
  /** ≤ 80 字。一句话说它比内置的多做了什么。 */
  subtitle: string;
  /** 须知（≤ 6 条），画在设置区段与工具页的范围说明里。 */
  notes?: string[];
  /** 这个服务的设置。键与 `contributes.settings` 共用一个命名空间。 */
  preferences?: Preference[];
}

/**
 * Git 域：入驻 Git 的哪些托管服务、在那里是什么。没入驻的扩展碰不到 Git——
 * Git 操作域的能力（`git.*`）只对这里列出的服务放行。它不是入口：只有它的扩展仍要入驻工具箱、窗口、指令、服务、菜单栏之一。
 */
export interface GitContribution {
  /** 1–4 个不重复的托管服务标识（例如 `github`），与 Jarvis Git 服务的服务标识一致。 */
  hosting: string[];
  /** 1–40 字。商店「装上之后」那一行：在 Git 里出现在哪。 */
  summary: string;
}

/**
 * 菜单栏域（SDK 2.9）：系统菜单栏上属于这个扩展的**一枚**图标与它的菜单，不并进 Jarvis 那枚。
 *
 * 宿主用 `NSStatusItem` + `NSMenu` 画（键盘、VoiceOver、深浅色都是系统的），扩展只经 `jarvis.menuBar.update` 推一份声明式模型，
 * 代码跑在后台会话（`defineExtension({ menuBar })`）。它是入口域：菜单末尾宿主固定追加「打开」「设置」两项，用户总能从这枚图标回到 Jarvis。
 * 用户可以在 设置 · 扩展 里关掉「在菜单栏显示」。
 */
export interface MenuBarContribution {
  /** 1–20 字。设置页与 VoiceOver 里这枚图标的名字。 */
  title: string;
  /** SF Symbol。还没收到任何模型时（应用刚启动、后台会话还没起来）画它。 */
  symbol: string;
}

/** 扩展入驻的域。至少要有工具箱、窗口、指令、服务、菜单栏之一。 */
export interface Contributes {
  toolbox?: ToolboxContribution;
  window?: WindowContribution;
  /** 菜单栏域（SDK 2.9）。一个扩展至多一枚图标。 */
  menuBar?: MenuBarContribution;
  commands?: CommandSpec[];
  settings?: SettingsContribution;
  services?: ServiceContribution[];
  /** 声明了任一项 `git.*` 能力时必填。 */
  git?: GitContribution;
}

/** 受限执行里的一个可执行文件。 */
export interface ExecutableDeclaration {
  /** 不带路径的名字，如 `mo`。用户填的绝对路径，文件名必须等于它。 */
  name: string;
  /** 允许的参数组合；一次调用的参数必须与其中某一组逐项相等。 */
  arguments: string[][];
  /**
   * SDK 2.7：允许 `process.run` 经标准输入交给它一段文字（≤ 1 MiB）。省略 = 不允许。
   * 只给本职就是从 stdin 读数据的工具（格式化工具）；解释器（`sh`、`python3`、`node`）不得声明——那等于把参数当脚本。
   */
  stdin?: boolean;
}

/** 在终端里执行的一段脚本。 */
export interface TerminalScriptDeclaration {
  id: string;
  /** ≤ 16 字，例如「安装 Mole」。 */
  title: string;
  /** 逐字执行的 sh 脚本，一行一个元素。 */
  script: string[];
}

/**
 * 一个常驻进程（SDK 2.9，配 `process.daemon`）。
 *
 * 与 `process.executables` 的差别在生死：它不跟任何 JS 会话走，停止只在扩展 `daemon.stop`、扩展停用 / 卸载 / 更新、Jarvis 退出时；
 * Jarvis 崩溃留下的那一个，下次启动时宿主按参数认出来收掉。以用户身份运行、不经 shell、stdin 接空设备。
 */
export interface DaemonDeclaration {
  /** `^[a-z][a-z0-9-]{0,31}$`，扩展内唯一。`jarvis.daemon.*` 按它点名，也是它工作目录的名字。 */
  id: string;
  /** 可执行文件名（不带路径），定位规则与 `process.executables[].name` 相同；用户填的路径，文件名也必须等于它。 */
  executable: string;
  /**
   * **一组**固定参数，逐字。只认两个占位符且必须**独占一个参数**：`{config}`（宿主写下的配置文件的绝对路径）、
   * `{workdir}`（这个常驻进程的工作目录）。至少用其中一个——宿主靠参数里的工作目录路径认出崩溃后留下的孤儿进程。
   * 运行时扩展一个参数都传不进来：它能决定的只有配置文件的内容。
   */
  arguments: string[];
  /** 声明了它，`daemon.start` 就必须带配置正文（≤ 4 MiB），宿主写到 `{workdir}/<fileName>`（0600），停止后删掉。参数里要有 `{config}`。 */
  config?: { fileName: string };
}

/** 受限执行。 */
export interface ProcessDeclaration {
  /** 配 `process.run`。 */
  executables?: ExecutableDeclaration[];
  /** 配 `terminal.run`。 */
  terminal?: TerminalScriptDeclaration[];
  /** 配 `process.daemon`（SDK 2.9），至多 2 个。 */
  daemons?: DaemonDeclaration[];
}

/**
 * 联网的声明（配 `network.https`）。两项至少一项：
 *
 * - `hosts`：写死的白名单（1–8 个主机名），授权屏逐条列给用户；
 * - `preferenceHosts`（SDK 2.9）：本扩展的 `urlList` 偏好的 key（1–4 个）。用户在那几项里填的地址，主机在**请求那一刻**放行——
 *   订阅地址这一类，作者写 manifest 时不知道它在哪个主机；用户删掉一条，下一次请求就拦。
 *
 * 两种都只放行 HTTPS、只认完全相等的主机名，重定向落点照样核对。
 */
export type NetworkDeclaration =
  | { hosts: string[]; preferenceHosts?: string[] }
  | { hosts?: string[]; preferenceHosts: string[] };

/**
 * Git 操作域的声明。声明了 `git.hosting.write` 时必填：宿主只执行这里逐字写出的 GraphQL 变更
 * （按顶层字段名比对，别名不算数），查询不受它限制。授权屏与商店详情把它们逐字列给用户。
 */
export interface GitDeclaration {
  /** 1–32 个不重复的变更名（`^[_A-Za-z][_0-9A-Za-z]*$`，≤ 80 字），例如 `updateProjectV2ItemFieldValue`。 */
  mutations: string[];
}

/** Inbox 通道。 */
export interface InboxParticipation {
  /** 往 Inbox 投消息（`inbox.post`）。 */
  messages: boolean;
  /** 弹系统横幅（`notifications.post`）。 */
  notifications: boolean;
}

/** 一份 `extension.json`（v2）。 */
export interface ExtensionManifest {
  manifestVersion: 2;
  id: string;
  version: string;
  /** ≤ 12 字。工具箱那一行、窗口标签、header、设置面板的标题。 */
  name: string;
  /** SF Symbol 名。 */
  symbol: string;
  description: string;
  author: Author;
  repository?: string;
  main: string;
  sdk: string;
  minimumJarvisVersion: string;
  capabilities: CapabilityRequest[];
  /** 声明了 `network.https` 时必填。 */
  network?: NetworkDeclaration;
  /** 声明了 `process.run` / `terminal.run` / `process.daemon` 时必填。 */
  process?: ProcessDeclaration;
  /** 声明了 `files.read` 时必填。 */
  files?: { read: string[] };
  /** 声明了 `git.hosting.write` 时必填。 */
  git?: GitDeclaration;
  contributes: Contributes;
  /** false = 不进 Inbox。 */
  inbox: false | InboxParticipation;
}
