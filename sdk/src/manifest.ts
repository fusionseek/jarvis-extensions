/**
 * `extension.json` 的类型。**真源是 `schemas/extension.v2.schema.json`**，这里只是它的
 * TypeScript 投影，供 `defineExtension` 与脚手架做静态检查；两处冲突时以 schema 为准。
 *
 * v2 按「域」组织：一个扩展在 `contributes` 里声明它入驻哪几个域——工具箱、窗口、指令、设置、服务。
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
  | "terminal.run";

/** 授权屏按风险分组；一档一个标签，颜色由宿主决定。 */
export type CapabilityTier = "low" | "medium" | "high";

/**
 * 每个能力的风险档位。写成常量而不是让扩展自己标：档位是宿主对用户的承诺，
 * 不是扩展对自己的评价。
 */
export const capabilityTiers: Readonly<Record<CapabilityID, CapabilityTier>> = {
  "system.openURL": "low",
  "ocr.recognize": "low",
  "speech.speak": "low",
  "clipboard.read": "medium",
  "clipboard.write": "medium",
  "notifications.post": "medium",
  "inbox.post": "medium",
  "quickTransfer.status": "medium",
  "hotkeys.register": "medium",
  "screenshot.capture": "high",
  "network.https": "high",
  "quickTransfer.control": "high",
  "quickTransfer.send": "high",
  "process.run": "high",
  "files.read": "high",
  "terminal.run": "high",
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

/** 一项偏好。控件由宿主画：开关、单行输入、数字、单选、多选、机密、目录。 */
export type Preference =
  | (PreferenceBase<"toggle"> & { default: boolean })
  | (PreferenceBase<"text"> & { default: string; placeholder?: string; maxLength?: number; monospaced?: boolean })
  | (PreferenceBase<"number"> & { default: number; minimum: number; maximum: number; step?: number })
  | (PreferenceBase<"select"> & { default: string; options: PreferenceOption[] })
  | (PreferenceBase<"multiselect"> & { default: string[]; options: PreferenceOption[] })
  /** 机密：宿主存 Keychain、设置页遮罩显示、只交给这个扩展、不进日志。没有默认值。 */
  | (PreferenceBase<"secret"> & { placeholder?: string })
  | PreferenceBase<"directory">;

/** 设置域：设置页「扩展」区段里属于它的那块面板。 */
export interface SettingsContribution {
  preferences: Preference[];
}

/** 宿主开放的扩展点（服务域）。 */
export type ServicePoint = "junkClean.engine";

/**
 * 服务域：实现宿主开放的一个扩展点。**没有独立界面**——它体现在它扩展的那个内置能力里，
 * 它的 `preferences` 也画在扩展点指定的那个内置设置区段里（`junkClean.engine` → 设置「清理」）。
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

/** 扩展入驻的域。至少要有工具箱、窗口、指令、服务之一。 */
export interface Contributes {
  toolbox?: ToolboxContribution;
  window?: WindowContribution;
  commands?: CommandSpec[];
  settings?: SettingsContribution;
  services?: ServiceContribution[];
}

/** 受限执行里的一个可执行文件。 */
export interface ExecutableDeclaration {
  /** 不带路径的名字，如 `mo`。用户填的绝对路径，文件名必须等于它。 */
  name: string;
  /** 允许的参数组合；一次调用的参数必须与其中某一组逐项相等。 */
  arguments: string[][];
}

/** 在终端里执行的一段脚本。 */
export interface TerminalScriptDeclaration {
  id: string;
  /** ≤ 16 字，例如「安装 Mole」。 */
  title: string;
  /** 逐字执行的 sh 脚本，一行一个元素。 */
  script: string[];
}

/** 受限执行（指令域）。 */
export interface ProcessDeclaration {
  /** 配 `process.run`。 */
  executables?: ExecutableDeclaration[];
  /** 配 `terminal.run`。 */
  terminal?: TerminalScriptDeclaration[];
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
  network?: { hosts: string[] };
  /** 声明了 `process.run` / `terminal.run` 时必填。 */
  process?: ProcessDeclaration;
  /** 声明了 `files.read` 时必填。 */
  files?: { read: string[] };
  contributes: Contributes;
  /** false = 不进 Inbox。 */
  inbox: false | InboxParticipation;
}
