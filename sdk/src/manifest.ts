/**
 * `extension.json` 的类型。**真源是 `schemas/extension.v1.schema.json`**，这里只是它的
 * TypeScript 投影，供 `defineExtension` 与脚手架做静态检查；两处冲突时以 schema 为准。
 */

/** 宿主能力目录（v1）。隐式能力不在这里——它们不需要用户点头。 */
export type CapabilityID =
  | "clipboard.read"
  | "clipboard.write"
  | "clipboard.history"
  | "quickTransfer.status"
  | "quickTransfer.control"
  | "quickTransfer.send"
  | "quickTransfer.records"
  | "screenshot.capture"
  | "ocr.recognize"
  | "notifications.post"
  | "inbox.post"
  | "memo.read"
  | "memo.write"
  | "calendar.read"
  | "tasks.read"
  | "network.https"
  | "files.pick"
  | "system.openURL"
  | "speech.speak"
  | "hotkeys.register";

/** 授权弹窗按风险分组；一档一个标签，颜色由宿主决定。 */
export type CapabilityTier = "low" | "medium" | "high";

/**
 * 每个能力的风险档位。写成常量而不是让扩展自己标：档位是宿主对用户的承诺，
 * 不是扩展对自己的评价。
 */
export const capabilityTiers: Readonly<Record<CapabilityID, CapabilityTier>> = {
  "tasks.read": "low",
  "calendar.read": "low",
  "system.openURL": "low",
  "files.pick": "low",
  "ocr.recognize": "low",
  "speech.speak": "low",
  "clipboard.read": "medium",
  "clipboard.write": "medium",
  "memo.read": "medium",
  "memo.write": "medium",
  "notifications.post": "medium",
  "inbox.post": "medium",
  "quickTransfer.status": "medium",
  "quickTransfer.records": "medium",
  "hotkeys.register": "medium",
  "clipboard.history": "high",
  "quickTransfer.control": "high",
  "quickTransfer.send": "high",
  "screenshot.capture": "high",
  "network.https": "high",
};

export interface CapabilityRequest {
  id: CapabilityID;
  /** 授权弹窗那一行的第二句：这个扩展拿它做什么（4–60 字）。 */
  reason: string;
}

export interface ToolboxEntry {
  /** SF Symbol 名；同时用于工具箱行、宫格与 header 徽标。 */
  symbol: string;
  /** ≤ 12 字。header 留给标题的宽度只有 144pt。 */
  name: string;
  /** ≤ 22 字。列表排布下那一行说明。 */
  subtitle: string;
  keywords?: string[];
}

export interface Author {
  name: string;
  url?: string;
  github?: string;
}

/**
 * 命令跑完之后面板怎么办。
 *
 * - `panel`：宿主把面板展开到这个扩展的页面（没展开就展开、不在这一屏就切过来）；
 * - `silent`：不碰面板。命令自己决定要不要 `jarvis.panel.present()`，否则只留一条横幅或剪贴板里的结果。
 */
export type CommandPresentation = "panel" | "silent";

/**
 * 全局快捷键，写法与 Jarvis 设置页显示的一致：修饰键按 ⌃⌥⇧⌘ 的顺序，后面一个主键
 * （`A`–`Z`、`0`–`9`、`F1`–`F12` 或 `- = [ ] ; ' , . /` 之一），至少含 ⌃、⌥、⌘ 之一。
 * 例：`⌥⌘T`、`⌃⇧F5`。它只是**默认值**，用户可以在设置页改；系统层面探测不到跨应用冲突。
 */
export interface HotKeySpec {
  default: string;
}

/**
 * 一条命令：扩展除"工具箱那一行"之外的入口。
 *
 * 工具箱那一行打开的是页面；命令由快捷键、页面里的按钮、快捷环（期 C）或 Inbox 卡片触发，
 * 落到 `defineExtension({ commands })` 里同 id 的处理函数上。宿主按 manifest **在启动时**就注册快捷键，
 * 不需要扩展的 JS 在跑；按下时才按需加载。
 */
export interface CommandSpec {
  /** 与 `id` 同一套规则；扩展内唯一。 */
  id: string;
  /** ≤ 12 字。设置页与快捷环里显示。 */
  title: string;
  description?: string;
  /** 有它就必须同时声明 `hotkeys.register` 能力：全局快捷键要用户点头。 */
  hotkey?: HotKeySpec;
  presentation: CommandPresentation;
}

interface PreferenceBase<T extends string> {
  key: string;
  type: T;
  title: string;
  description?: string;
}

export type Preference =
  | (PreferenceBase<"toggle"> & { default: boolean })
  | (PreferenceBase<"text"> & { default: string; placeholder?: string; maxLength?: number })
  | (PreferenceBase<"number"> & { default: number; minimum: number; maximum: number; step?: number })
  | (PreferenceBase<"select"> & { default: string; options: { value: string; title: string }[] })
  | (PreferenceBase<"multiselect"> & { default: string[]; options: { value: string; title: string }[] })
  /** 机密：宿主存 Keychain、设置页遮罩显示、只在扩展内可读、不进日志。没有默认值。 */
  | (PreferenceBase<"secret"> & { placeholder?: string })
  | PreferenceBase<"directory">;

export interface SettingsSection {
  preferences: Preference[];
}

export interface InboxParticipation {
  /** 往 Inbox 投递卡片。 */
  cards: boolean;
  /** 弹系统横幅。可以不带卡：点横幅展开面板到这个扩展的页面。 */
  notifications: boolean;
}

export interface ExtensionManifest {
  manifestVersion: 1;
  id: string;
  version: string;
  toolbox: ToolboxEntry;
  description: string;
  author: Author;
  repository?: string;
  main: string;
  sdk: string;
  minimumJarvisVersion: string;
  capabilities: CapabilityRequest[];
  network?: { hosts: string[] };
  /** 第二部分的另一半：页面之外的入口。 */
  commands?: CommandSpec[];
  /** 第三部分：false = 不进设置页。 */
  settings: false | SettingsSection;
  /** 第四部分：false = 不进 Inbox。 */
  inbox: false | InboxParticipation;
  background?: boolean;
}
