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
  | "notifications.post"
  | "inbox.post"
  | "memo.read"
  | "memo.write"
  | "calendar.read"
  | "tasks.read"
  | "network.https"
  | "files.pick"
  | "system.openURL";

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
  "clipboard.read": "medium",
  "clipboard.write": "medium",
  "memo.read": "medium",
  "memo.write": "medium",
  "notifications.post": "medium",
  "inbox.post": "medium",
  "quickTransfer.status": "medium",
  "quickTransfer.records": "medium",
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
  | PreferenceBase<"directory">;

export interface SettingsSection {
  preferences: Preference[];
}

export interface InboxParticipation {
  cards: boolean;
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
  /** 第三部分：false = 不进设置页。 */
  settings: false | SettingsSection;
  /** 第四部分：false = 不进 Inbox。 */
  inbox: false | InboxParticipation;
  background?: boolean;
}
