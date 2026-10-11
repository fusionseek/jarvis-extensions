/**
 * 服务域：宿主开放的扩展点。
 *
 * 扩展点是**宿主定义的契约**，不是扩展发明的：点名、方法、参数与返回值的形状、它的设置画在哪，
 * 全部在这里与宿主的 `contracts/schemas/extensions/bridge.v2.schema.json` 里写死。扩展只能插到这些点上。
 *
 * 服务跑在宿主为每个扩展单独起的**后台会话**里：没有界面、不弹授权、空闲一分钟收掉。
 * 宿主经 `service` 事件调用，扩展经 `service.resolve` / `service.progress` 回话——这些都由 SDK 代劳，
 * 扩展只需要在 `defineExtension({ services: { <id>: 实现 } })` 里交出一个对象。
 */

/** 宿主每次调服务时带来的东西。 */
export interface ServiceContext {
  /** 此刻的偏好：manifest 默认叠上用户在设置里改过的（含这个服务自己的 `preferences`）。 */
  preferences: Record<string, unknown>;
  /** 此刻已授予的能力。 */
  granted: string[];
}

/** 一次可取消的调用的取消信号。 */
export interface CancelSignal {
  /** 宿主是否已经要求取消。 */
  readonly cancelled: boolean;
  /** 取消时回调（已经取消时立即回调）。 */
  onCancel(listener: () => void): void;
}

// ---------------------------------------------------------------------------
// junkClean.engine：清理引擎
// ---------------------------------------------------------------------------

/** 引擎此刻能不能用。设置「清理」与清理工具的引擎卡画的就是它。 */
export interface JunkCleanStatus {
  /** 能跑。为 false 时宿主这一次用 Jarvis 清理，并在报告里写明 `problem`。 */
  ready: boolean;
  /** 一句话：能用时写「在哪、什么版本」，不能用时写原因。 */
  summary: string;
  /** 不能用的原因（≤ 200 字）。 */
  problem?: string;
  /** 用户此刻可以做的事（≤ 3 个），宿主画成按钮；按下调 `action(id)`。 */
  actions: { id: string; title: string; prominent?: boolean }[];
}

/** 清理进行中的读数。宿主把 `currentItem` 的主目录写成 `~`。 */
export interface JunkCleanProgress {
  sectionTitle?: string;
  freedBytes: number;
  itemCount: number;
  completedSections: number;
  totalSections?: number;
  /** 0…1；不知道时省略。界面不画百分比，留给估算。 */
  fraction?: number;
  /** 正在删的那一项（绝对路径）。 */
  currentItem?: string;
}

/** 某一类没有清的原因。 */
export interface JunkCleanSkip {
  reason: "requiresAdmin" | "appRunning" | "whitelisted" | "notPresent" | "other";
  /** `appRunning` 时是应用名；`other` 时是原文。 */
  detail?: string;
}

/** 一类清理目标的结果。 */
export interface JunkCleanSection {
  id: string;
  title: string;
  freedBytes: number;
  itemCount: number;
  skipped?: JunkCleanSkip;
  /** 删除失败的条目（路径 · 原因），≤ 8 条。 */
  failures?: string[];
  notes?: string[];
}

/** 一次清理的报告。开始 / 结束时刻由宿主记。 */
export interface JunkCleanReport {
  sections: JunkCleanSection[];
  /** 整次运行层面的说明（≤ 12 条）。 */
  notes: string[];
  /** 整次失败的原因；部分成功不算失败。 */
  failure?: string;
}

/** 一个动作的结果。 */
export interface JunkCleanActionResult {
  message?: string;
  /** 为 true 时宿主每 2 秒重查一次 `status`，最多 10 分钟，`ready` 即停（「在终端中安装」之后用）。 */
  watchStatus?: boolean;
}

/**
 * 清理引擎（`junkClean.engine`）。开着时晃球、`/clean` 与工具箱清理都走它；悬浮球照旧读 Jarvis 的通用清理状态。
 *
 * **永久删除由你负责**：宿主的路径校验、运行中应用保护只覆盖 Jarvis 自己的清理，管不到你调用的外部工具。
 */
export interface JunkCleanEngine {
  /** 此刻能不能用。要快（宿主在打开设置、工具页时都会问）。 */
  status(context: ServiceContext): JunkCleanStatus | Promise<JunkCleanStatus>;
  /** 跑一次清理。不要抛错：失败写进 `failure`，部分成功照常报告。 */
  run(context: ServiceContext, progress: (progress: JunkCleanProgress) => void, signal: CancelSignal): Promise<JunkCleanReport>;
  /** 用户按了 `status.actions` 里的某一颗。 */
  action?(id: string, context: ServiceContext): JunkCleanActionResult | Promise<JunkCleanActionResult>;
}

/** 某个扩展点的实现。按 manifest `contributes.services[].point` 对上。 */
export interface ServiceImplementations {
  "junkClean.engine": JunkCleanEngine;
}

/** 任一扩展点的实现。 */
export type ServiceImplementation = ServiceImplementations[keyof ServiceImplementations];
