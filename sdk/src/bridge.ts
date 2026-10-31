/**
 * 宿主 ⇄ 扩展的线缆（协议 2）。**真源是 jarvis-mac 的 `contracts/schemas/extensions/bridge.v2.schema.json`**。
 *
 * 扩展跑在宿主进程里的一个 JavaScriptCore `JSContext`（每个会话一个，各自一条串行队列）。
 * 两边**只交换 JSON 字符串**，没有共享对象：这是安全边界，也是"宿主升级不碰扩展"的前提。
 *
 * 宿主注入一个全局 `__jarvisHost`（下面的 `HostBridge`），SDK 注册一个全局 `__jarvisRuntime`
 * （`RuntimeBridge`）；此外全局环境里没有 `fetch`、`XMLHttpRequest`、`require`、`import()`、
 * 文件系统或任何 DOM。扩展能做的每一件事都要过 `__jarvisHost.invoke`，而每一次 invoke 都在
 * 宿主侧过一遍能力闸门。
 *
 * 同一个扩展最多有两个会话：**前台会话**（有界面：工具箱页面、原地弹窗、窗口标签）与**后台会话**
 * （没有界面：服务扩展点、静默命令、菜单栏事件）。两个会话互相看不见对方的内存，共享的只有宿主那边的存储与偏好；
 * 常驻进程与系统代理的状态在宿主手里，两边各自 `status` 读同一份。
 */
import type { FileHandle, UINode } from "./ui.js";
import type { JarvisErrorShape } from "./capabilities.js";
import type { CommandPresentation, ServicePoint } from "./manifest.js";
import type { CodeFormatMethod, CodeFormatRequest, CodeHighlightMethod, CodeHighlightRequest, FileActionsMethod, FileActionsRequest, JunkCleanMethod, LauncherAppsMethod, ProjectEngineMethod, ProjectEngineRequest } from "./services.js";

/** 线缆协议版本。宿主与 SDK 主版本不同时，宿主拒绝加载并在扩展页面说明。 */
export const bridgeProtocolVersion = 2 as const;

/**
 * 扩展的树画在哪一面：工具箱面板里的页面（`toolbox`）、原地结果弹窗（`popover`）、工作区窗口里的标签（`window`）。
 * 同一时刻只有一面 activate：弹窗 > 窗口 > 工具箱页面。
 */
export type Surface = "toolbox" | "popover" | "window";

/** SDK → 宿主：一次能力调用。 */
export interface InvokeRequest {
  protocol: typeof bridgeProtocolVersion;
  /** 单调递增，由 SDK 生成；宿主用它回 `settle`。0 = 同步调用。 */
  id: number;
  /** 形如 `clipboard` / `process` / `service`。 */
  namespace: string;
  method: string;
  params: unknown;
}

/** 一次调用的结果。 */
export type InvokeResult =
  | { ok: true; value: unknown }
  | { ok: false; error: JarvisErrorShape };

/** SDK → 宿主：一次 UI 提交。 */
export interface CommitRequest {
  protocol: typeof bridgeProtocolVersion;
  /** 每次提交递增；宿主丢弃比已渲染更旧的树（异步回调交叉时会出现）。 */
  generation: number;
  /** 这棵树画在哪一面。 */
  surface: Surface;
  root: SerializedNode;
}

/**
 * 线缆上的节点：函数换成句柄。`on` 的键是去掉 on 前缀的事件名（`press` / `change` / `submit` …），
 * 值是 `handlerId`，宿主回传事件时原样带回。
 */
export type SerializedNode = {
  kind: string;
  key?: string;
  props: Record<string, unknown>;
  on?: Record<string, string>;
  children?: SerializedNode[];
};

/** 一条命令是从哪儿触发的：全局快捷键、`/` 指令、页面里的按钮（`jarvis.commands.run`）。 */
export type CommandTrigger = "hotkey" | "slash" | "page";

/** 宿主在 `activate` 里带给页面的命令清单（给没有自定义页面的扩展画默认页用）。 */
export interface CommandSummary {
  id: string;
  title: string;
  description?: string | undefined;
  /** 用户此刻配置的快捷键显示串；没配为 `undefined`。 */
  hotkey?: string | undefined;
  /** `/` 指令的写法（`/http`）；没有为 `undefined`。 */
  slash?: string | undefined;
  presentation: CommandPresentation;
}

/** 页面 `activate` 拿到的东西。 */
export interface ActivationContext {
  /** 从哪里进来的：工具箱那一行、全局搜索里那一行、一条命令（快捷键、`/` 指令、页面按钮）。 */
  entry: "toolbox" | "search" | "command";
  /** 要画的是哪一面。 */
  surface: Surface;
  granted: string[];
  preferences: Record<string, unknown>;
  commands: CommandSummary[];
}

/** 命令处理函数拿到的东西。 */
export interface CommandContext {
  id: string;
  trigger: CommandTrigger;
  /** 只有 `trigger = "slash"` 时有：从全局搜索还是速记输入框来的。 */
  scope?: "launcher" | "memo" | undefined;
  /** `/` 指令后面那段字（已去掉首尾空白）；没有为 `undefined`。 */
  argument?: string | undefined;
  granted: string[];
  preferences: Record<string, unknown>;
}

/**
 * 宿主 → 后台会话：调一次服务扩展点的方法。
 *
 * `junkClean.engine` 的方法是 `status` / `run` / `action`（`action` 带 `actionId`）；
 * `project.engine` 的方法是 `describe` / `listProjects` / `readSchema` / `readItems` / `applyEdit` / `createField` / `createOption` / `createIteration` / `createItem`，
 * 入参放在 `params.request`（`describe` 不带；2.6 起 `readItems` 可只带 `itemIds`，见 `ProjectItemsRequest`）；`launcher.apps`（SDK 2.5）只有 `catalog`，不带入参；
 * `code.format`（SDK 2.7）是 `describe`（不带入参）与 `format`（入参 `CodeFormatRequest`）；`code.highlight`（SDK 2.8）是 `describe` 与 `highlight`（入参 `CodeHighlightRequest`）；
 * `files.actions`（SDK 2.13）是 `describe` 与 `run`（入参 `FileActionsRequest`，进度经 `service.progress`）。
 */
export interface ServiceCall {
  callId: number;
  point: ServicePoint;
  /** manifest `contributes.services[].id`。 */
  service: string;
  method: JunkCleanMethod | ProjectEngineMethod | LauncherAppsMethod | CodeFormatMethod | CodeHighlightMethod | FileActionsMethod;
  params: { preferences: Record<string, unknown>; granted: string[]; actionId?: string; request?: ProjectEngineRequest | CodeFormatRequest | CodeHighlightRequest | FileActionsRequest };
}

// ---------------------------------------------------------------------------
// 菜单栏域（SDK 2.9）：bridge schema 的 `$defs.sfSymbol` / `menuBarItemID` / `menuBarItem` / `menuBarModel` / `menuBarEvent`。
// 语义见 jarvis-mac `specs/20261028-091917-proxy-extension-menubar-daemon` P-2。
// ---------------------------------------------------------------------------

/**
 * 菜单栏里一项可点的条目。宿主画成一行系统菜单项：`checked` 画系统的勾，`enabled: false` 灰掉且点不了。
 *
 * `id`（`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`）由扩展自己定，用户点了它，`select` 事件原样带回。
 * 允许 `:` 与 `.`，是为了让 `mode:rule`、`node:<名字>` 这种「类别:值」直接当 id 用——回调里拆开就知道点的是哪一类，不用另记一张表。
 */
export interface MenuBarActionItem {
  kind: "item";
  id: string;
  /** 1–80 字。 */
  title: string;
  /** ≤ 80 字。画在标题下面的灰字（延迟、状态这类读数）。 */
  subtitle?: string;
  /** SF Symbol（`^[a-z0-9]+(\.[a-z0-9]+)*$`）。 */
  symbol?: string;
  /** 画系统的勾。省略 = 不勾。 */
  checked?: boolean;
  /** 省略 = 可点。 */
  enabled?: boolean;
  /**
   * SDK 2.10：字的颜色。`critical` 画系统红（失败的请求）、`secondary` 画次要色（不重要的读数）；省略 = 普通文字色。
   * 只改颜色，不改可点与否——要灰掉且点不了用 `enabled: false`。
   */
  tone?: "critical" | "secondary";
}

/** 分隔线。不带任何别的字段——带了 schema 就拒：一条分隔线上没有地方放标题。 */
export interface MenuBarSeparator {
  kind: "separator";
}

/** 灰色段标题（系统菜单的 section header）：不可点，只说下面几项是什么。 */
export interface MenuBarHeader {
  kind: "header";
  /** 1–80 字。 */
  title: string;
}

/**
 * 子菜单。至多嵌三层（SDK 2.10 起；2.9 是两层）——「当前页面 › 域名 › 走代理 / 直连 / 拒绝」要三层；
 * 更深的画成灰的空项，整份模型超过 300 项的部分宿主丢掉并记一条警告（schema 数不了递归总数）。
 */
export interface MenuBarSubmenu {
  kind: "submenu";
  /** 1–80 字。 */
  title: string;
  symbol?: string;
  /** 省略 = 可展开。 */
  enabled?: boolean;
  items: MenuBarItem[];
}

/** 流量曲线里的一条（SDK 2.10）：`upload` 与 `download` 各一种颜色，颜色宿主定。 */
export interface MenuBarChartSeries {
  tone: "upload" | "download";
  /** ≤ 120 个非负数（旧的在前）。宿主按两条里的最大值统一缩放。 */
  values: number[];
}

/**
 * 菜单顶部那块流量曲线（SDK 2.10，jarvis-mac `specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-11）：
 * 宿主用原生视图画（约 240×48），不可点、没有 `id`。
 */
export interface MenuBarChart {
  kind: "chart";
  /** 1–2 条。 */
  series: MenuBarChartSeries[];
  /** ≤ 80 字。画在曲线下面的一行读数（「↓ 1.2 MB/s  ↑ 34 KB/s」）。 */
  caption?: string;
}

/** 菜单里的一项：可点的条目、分隔线、段标题、子菜单或流量曲线（SDK 2.10）。 */
export type MenuBarItem = MenuBarActionItem | MenuBarSeparator | MenuBarHeader | MenuBarSubmenu | MenuBarChart;

/**
 * `jarvis.menuBar.update` 的入参：这个扩展那枚菜单栏图标与它的菜单。
 *
 * 宿主**缓存最后一份**：后台会话空闲被收掉之后图标与菜单照旧在，点开 / 点选时宿主把会话唤醒再发事件。
 * 宿主按 250 ms 合并，只画最后一份——挡的是「每帧推一次速率」。菜单末尾宿主固定追加分隔线、「打开「名」」与「「名」的设置」，
 * 扩展改不掉：菜单栏图标是扩展唯一常驻在屏幕上的东西，用户必须总能从它回到 Jarvis 管它的地方。
 */
export interface MenuBarModel {
  /**
   * 这一刻不画图标（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-1）：代理关着时「菜单图标去掉」那种。显示 = 用户的「在菜单栏显示」**且**这里不为真——
   * 用户关掉的，扩展打不开。藏着时后台会话照旧常驻、模型照旧缓存；变回 `false` 时宿主立即画出最新一份。宿主记住上一次，
   * 下次启动、第一份模型到之前的占位按它来，图标不先闪一下。
   */
  hidden?: boolean;
  /** 图标（SF Symbol）。省略 = manifest `contributes.menuBar.symbol`；宿主画不出时同样退回它。 */
  symbol?: string;
  /**
   * 图标右侧的短字（≤ 16 字，速率之类）。省略 = 只有图标。
   * SDK 2.10：可以是**两行**——一个 `\n` 分隔、每行 ≤ 10 字，宿主画成 9pt 等宽数字的上下两行（Surge 那种上下行速率）。
   */
  title?: string;
  /** 悬停提示，≤ 80 字。 */
  tooltip?: string;
  /**
   * 改哪一枚状态项（SDK 2.11，jarvis-mac `specs/20261029-225323-menubar-manager-p1` N-1）：manifest `contributes.menuBar.items[].id`。
   * 省略 = 第一枚。每枚各有一份完整的模型（图标、短字、菜单）。
   */
  statusItem?: string;
  /**
   * 宽度（SDK 2.11）：`"auto"`（默认，随内容）或 0–10000 点。把一枚空白撑宽，它左边的图标就被挤出屏幕——那是扩展的做法，宿主不知道。
   * 维持它的后台会话一收掉（停用、卸载、更新），宿主把宽度复原成 `"auto"`：扩展不在时，别人的图标不会一直被挤着。
   */
  length?: "auto" | number;
  /** 不画图标也不画字，只占 `length` 那么宽（SDK 2.11）。VoiceOver 仍读 manifest 里这一枚的名字。 */
  blank?: boolean;
  /**
   * 左键做什么（SDK 2.11）：`"menu"`（默认）开菜单；`"event"` 发 `press` 事件（`defineExtension({ menuBar: { press } })`），
   * 右键与 ⌃ 点仍开菜单，宿主固定的「打开」「设置」两项照旧在。
   */
  primaryClick?: "menu" | "event";
  /** ≤ 300 项（含子菜单里的）。 */
  items: MenuBarItem[];
}

/** 事件发生时按着的修饰键（SDK 2.11）。 */
export type MenuBarModifier = "command" | "option" | "control" | "shift";

/**
 * 宿主 → 后台会话的 `menuBar` 事件（线缆形状）。SDK 把它拆成 `defineExtension({ menuBar })` 的三个回调。
 *
 * - `start`：应用启动、扩展启用 / 更新、用户在设置里重新打开「在菜单栏显示」时各一次——推第一份模型、做「启动时恢复」；
 * - `open`：用户点开菜单的那一刻（`menuWillOpen`）——可以趁机刷新读数，菜单开着时宿主照样就地更新条目；
 * - `select`：用户点了一项，`itemId` 是扩展自己给的 id。
 */
export type MenuBarEvent =
  | { event: "start"; granted: string[]; preferences: Record<string, unknown> }
  | { event: "open"; statusItem?: string; granted: string[]; preferences: Record<string, unknown> }
  | { event: "select"; itemId: string; statusItem?: string; granted: string[]; preferences: Record<string, unknown> }
  /** SDK 2.11：`primaryClick: "event"` 的那一枚被左键点了。 */
  | { event: "press"; statusItem: string; modifiers: MenuBarModifier[]; granted: string[]; preferences: Record<string, unknown> };

// ---------------------------------------------------------------------------
// 菜单栏管理 P1（SDK 2.11，jarvis-mac `specs/20261029-225323-menubar-manager-p1` N-2…N-4）：`$defs.screenRect` / `screenInfo` /
// `menuBarPointerEvent` / `menuBarExtra` / `menuBarExtrasChange`。坐标一律是全局坐标：原点在主屏左上角、y 向下。
// ---------------------------------------------------------------------------

/** 一块矩形（全局坐标）。 */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一块屏（`jarvis.screens.list()`）。 */
export interface ScreenInfo {
  /** `CGDirectDisplayID` 的十进制。 */
  id: string;
  frame: ScreenRect;
  /** 去掉菜单栏与程序坞之后的那一块。 */
  visibleFrame: ScreenRect;
  /** 这块屏顶上菜单栏那一条的高度。 */
  menuBarHeight: number;
  isMain: boolean;
  scale: number;
  /** 刘海两侧还能放东西的两块；没有刘海为 `null`。落在两块之间（刘海下面）的菜单栏图标看不见。 */
  notch: { left: ScreenRect; right: ScreenRect } | null;
}

/** 菜单栏上的指针事件（`jarvis.menuBar.observePointer`）。只报菜单栏那一条里的事。 */
export type MenuBarPointerEvent =
  | { type: "enter" | "exit"; screen: string; x: number; modifiers: MenuBarModifier[] }
  | {
      type: "click";
      screen: string;
      x: number;
      modifiers: MenuBarModifier[];
      button: "left" | "right";
      /** 落在某一颗菜单栏图标上。 */
      onItem: boolean;
      /** 落在前台应用的菜单标题（「文件」「编辑」……）上；宿主还没读到（没有辅助功能权限、刚切换前台）时为 `null`。 */
      onAppMenu: boolean | null;
    }
  | { type: "scroll"; screen: string; x: number; modifiers: MenuBarModifier[]; /** 100 ms 内的累计值，手指 / 滚轮向上为正。 */ deltaY: number };

/** 菜单栏上的一颗图标（`jarvis.menuBarExtras.list()`），任何应用的。 */
export interface MenuBarExtra {
  /**
   * 跨重启尽量不变：有 AX identifier 的 `<bundleId>:<identifier>`；同一应用只有一颗的 `<bundleId>`；有几颗的 `<bundleId>#<序号>`；
   * 归属认不出来的 `window:<窗口号>`（跨重启不稳定）。Jarvis 自己的状态项是 `<Jarvis bundleId>:<扩展 id>.<状态项 id>`。
   */
  id: string;
  ownerBundleId: string;
  ownerName: string;
  /** AX 描述（「Wi‑Fi，已接入，3格」）；第三方大多为空。 */
  title: string;
  frame: ScreenRect;
  /** 在哪块屏的菜单栏上；被挤出所有屏幕的为 `null`。 */
  screen: string | null;
  /** 窗口服务器说它此刻在屏幕上：被刘海挡住、被挤出屏幕的为 `false`。 */
  onScreen: boolean;
  /** `false` 的是钉死在最右、⌘ 拖不动的系统项（时钟、控制中心）。 */
  movable: boolean;
  /** 是调用方自己的哪一枚状态项（manifest `contributes.menuBar.items[].id`）。 */
  mine?: string;
  /** 所属应用的图标句柄（交给 `image` / `row.image`）。 */
  icon?: FileHandle;
}

/**
 * 一枚键盘输入源（`jarvis.inputSources.list()`，SDK 2.13，`$defs.inputSource`），顺序同系统输入法菜单。
 * 只列启用、可选的键盘输入源：表情与符号、按住重音这类调色板与不可选的父项不在里面。
 */
export interface InputSource {
  /** TIS 的输入源 id（`com.apple.keylayout.ABC`、`com.tencent.inputmethod.wetype.pinyin`）。自制布局的 id 可能带空格。 */
  id: string;
  /** 系统给的名字（「ABC」「微信输入法」）。 */
  name: string;
  /** 键盘布局 / 不分模式的输入法 / 输入法里的一个模式（拼音、平假名）。 */
  kind: "keyboardLayout" | "inputMethod" | "inputMode";
  /** TIS 给的语言码，至多 8 个（ABC 自报 97 个）。 */
  languages: string[];
  /** 输入源图标的句柄（交给 `image` / `row.image` / `hud.show`）；读不到时省略。 */
  icon?: FileHandle;
}

/** `jarvis.inputSources.select` 的结果（SDK 2.13）。 */
export interface InputSourceSelection {
  id: string;
  /** 切完读回的当前输入源就是它；本来就是当前时宿主不调系统，同样为 `true`。 */
  effective: boolean;
}

/**
 * `jarvis.inputSources.observe` 推来的一条（SDK 2.13，`$defs.inputSourcesEvent`）。
 *
 * - `selected`：当前输入源变了（每一次真正的切换一条）。`bySelf` 为 `true`：这一次是**你自己** 1 s 内的 `select` 引起的——
 *   拿它分清「用户手动切的」与「我刚切的」；别的扩展收到同一条时为 `false`。
 * - `listChanged`：用户在系统设置里增删了输入源，重新 `list()`。
 */
export type InputSourcesEvent = { type: "selected"; id: string; bySelf: boolean } | { type: "listChanged" };

/** 此刻在前台的应用（`jarvis.frontmostApp`，SDK 2.13，`$defs.frontmostApp`）。 */
export interface FrontmostApp {
  bundleId: string;
  name: string;
  pid: number;
  /** 应用图标的句柄（同一会话同一 bundle 只颁一次）。 */
  icon?: FileHandle;
}

/** `jarvis.apps.icons` 交回的一项（SDK 2.13，`$defs.appsIconsResult`）：装着的应用有 `icon`，没装的没有。 */
export interface AppIcon {
  bundleId: string;
  /** 64 px 图标句柄（交给 `row.image` / `chip.image` / `image`）。同一会话同一应用只颁一次。 */
  icon?: FileHandle;
}

/** `jarvis.hud.show` 的入参（SDK 2.13，`$defs.hudShowRequest`）。 */
export interface HUDOptions {
  /** 1–24 字。 */
  text: string;
  /** SF Symbol；与 `image`、`monogram` 至多给一个。 */
  symbol?: string;
  /** 这个会话拿到的图片句柄（例：`InputSource.icon`）；与 `symbol`、`monogram` 至多给一个。 */
  image?: FileHandle;
  /**
   * 字标（宿主 ≥ 3.3.2，jarvis-mac `specs/20261030-210500-input-source-orb-crash-keycap` K-2）：1–3 个字，宿主画成一枚键帽（圆角方块、白边、底沿一道暗边）。
   * 给一个没有图标的东西一个识别标记时用它（系统自带的输入法「A」「中」、代理节点的「HK」）；与 `symbol`、`image` 至多给一个。
   */
  monogram?: string;
  /**
   * 贴在哪：`caret` 前台应用的文字插入点下方，读不到插入点时贴着输入框，输入框也读不到（没有辅助功能权限、企业微信这类不报的应用）时放在前台窗口正中——
   * 不退回指针；`window`（宿主 ≥ 3.3.2）前台应用最前面那扇窗的正中；`pointer` 指针右下；
   * `screen` 屏幕中间偏下（牌子中心在可见区自下往上 30%；前台窗口所在的屏，读不到用指针所在的屏）；
   * `orb`（宿主 ≥ 3.3.2，jarvis-mac `specs/20261030-194903-input-source-cards-orb-flash` C-6）悬浮球：`symbol` / `image` 进球心，`text` 是一枚连着颈贴在球下的 chip，
   * 到时一起缩回、球心复原；球展开、贴边藏起、被藏掉时退回 `screen`。位置由宿主读，不交给扩展。
   */
  anchor: "caret" | "window" | "pointer" | "screen" | "orb";
  /** 400–3000 ms，默认 1200。 */
  duration?: number;
}

/** `jarvis.menuBarExtras.observe` 推来的一次变化：只报有哪些项来了、走了；位置随时在变，要位置就 `list()`。 */
export interface MenuBarExtrasChange {
  added: MenuBarExtra[];
  removed: string[];
}

/**
 * `jarvis.menuBarExtras.capture` 交回的一项（SDK 2.12，`$defs.menuBarExtraCapture`），与请求的 id 同序。
 *
 * - `live: true`：这一次当场截的（图标此刻在屏幕上）。
 * - `live: false` 而有 `image`：它藏着，交回的是同一扇窗最近一次露着时截到的那一张，`capturedAt` 是那一刻（Unix 毫秒）。
 * - 没有 `image`：从没露出来过、应用重启过（窗口换了），或 id 不认识。
 *
 * 屏幕外、刘海下的图标窗口服务器不算在屏上，截不到（jarvis-mac `specs/20261030-081832-menubar-manager-p2` R-3）。
 */
export interface MenuBarExtraCapture {
  id: string;
  live: boolean;
  image?: FileHandle;
  capturedAt?: number;
}

/** `jarvis.menuBarExtras.press` 怎么点到的（SDK 2.12）：`accessibility` = AXPress 送达；`click` = 那个应用不接，宿主合成了一次点击。 */
export interface MenuBarExtrasPressResult {
  via: "accessibility" | "click";
}

/**
 * 点开之后那个应用的菜单（SDK 2.12，`$defs.menuBarMenuEvent.state`）：`opened` 开了；`closed` 关了；
 * `none` 1.5 s 内没有菜单打开（弹的是窗口、自绘面板，或什么都没弹）。`closed` / `none` 之后不再推。
 */
export type MenuBarMenuState = "opened" | "closed" | "none";

// ---------------------------------------------------------------------------
// 常驻进程（SDK 2.9）：`$defs.daemonID` / `controlPort` / `daemonStartRequest` / `daemonStatus` / `daemonEvent` /
// `daemonRequest` / `daemonResponse`。语义见同一 spec P-3、P-4。
// ---------------------------------------------------------------------------

/**
 * `jarvis.daemon.start` 的入参。
 *
 * 宿主依次：定位可执行文件 → 写配置 → 起进程 → 等 1 秒。这 1 秒里进程退了算启动失败（错误里带它输出的最后 20 行——
 * 配置错了由工具自己报，扩展不用另跑一遍检查）；否则返回 `running` 的状态。已经在跑时报错：先 `stop`。
 */
export interface DaemonStartRequest {
  /** manifest `process.daemons[].id`（`^[a-z][a-z0-9-]{0,31}$`）。 */
  id: string;
  /** 配置文件正文（≤ 4 MiB，按字节由宿主数）。manifest 声明了 `config` 时必填，宿主写到 `{workdir}/<fileName>`（0600），停止后删掉。 */
  config?: string;
  /** 用户填的可执行文件路径（≤ 1024 字），文件名必须等于声明的名字；省略 = 宿主自动定位。 */
  executable?: string;
  /** 这个进程会监听的本机控制口（1024–65535）。之后 `daemon.request` 只发往 `127.0.0.1:<它>`；不报就没有控制口可用。 */
  controlPort?: number;
}

/** 常驻进程此刻在哪一步：`stopped` 没起过或已停；`running` 在跑；`exited` 意外退出了（`exitCode` / `signal` 是怎么退的）。 */
export type DaemonState = "stopped" | "running" | "exited";

/** `daemon.start` / `stop` / `status` 的返回。 */
export interface DaemonStatus {
  id: string;
  state: DaemonState;
  /** `running` 时必有。 */
  pid?: number;
  /** `running` 时必有，Unix 毫秒。 */
  startedAt?: number;
  exitCode?: number;
  /** 被信号终止时的信号值（≥ 1）。 */
  signal?: number;
  controlPort?: number;
  /**
   * 此刻定位到的可执行文件路径（运行中 = 正在跑的那一份），**找不到为空串**。
   * 扩展据此画「没装」那一屏——因此不需要为了问一句「装没装」另外申请 `process.run`。
   */
  executable: string;
}

/**
 * `daemon.observe` 推来的一条。
 *
 * - `output`：100 ms 合批的新输出行（stdout 与 stderr 合流，每行 ≤ 2 KB）；
 * - `exit`：进程退了。`expected` 为真是 `stop` / 停用 / 退出应用收的；为假是它自己死的——**宿主不自动重启**，重试、横幅、关系统代理由扩展决定
 *   （系统代理宿主另有兜底：主人的常驻进程没了就还原）。`lines` 是最后 20 行输出。
 */
export type DaemonEvent =
  | { kind: "output"; lines: string[] }
  | { kind: "exit"; lines: string[]; expected: boolean; exitCode?: number; signal?: number };

/** `daemon.request` 认的方法。 */
export type DaemonRequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * `jarvis.daemon.request` 的入参：发往 `http://127.0.0.1:<controlPort><path>`，只在这个常驻进程 `running` 时放行，**不经任何代理**
 * （系统代理此刻可能正指着这个进程自己）。
 *
 * `network.https` 只放行 HTTPS 与白名单主机，连不到 `127.0.0.1`——控制口因此单开一条路，且只通向扩展自己声明、自己起的那个进程。
 */
export interface DaemonRequest {
  id: string;
  method: DaemonRequestMethod;
  /** 以 `/` 开头，不含 `//`、反斜杠、`#` 与空白（≤ 2048 字）：只能是这个控制口上的一条路径，拼不出别的主机。查询串照常带。 */
  path: string;
  /** 只放行这三个头。 */
  headers?: { Authorization?: string; "Content-Type"?: string; Accept?: string };
  /** ≤ 1 MiB（按字节由宿主数）。 */
  body?: string;
  /** 秒，1–30，默认 10（测一次延迟要几秒）。 */
  timeout?: number;
}

/** `daemon.request` 的返回，与 `net.fetch` 同一形状：非 UTF-8 的响应 `text` 为空串；响应 ≤ 5 MiB。 */
export interface DaemonResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

// ---------------------------------------------------------------------------
// 系统代理（SDK 2.9）：`$defs.systemProxyEnableRequest` / `systemProxyStatus`。语义见同一 spec P-6。
// ---------------------------------------------------------------------------

/**
 * `jarvis.systemProxy.enable` 的入参。主机由宿主写死 `127.0.0.1`；调用时这个扩展必须有一个 `running` 的常驻进程——
 * 系统代理指着一个没人监听的端口，等于整机断网。
 */
export interface SystemProxyEnableRequest {
  /** 1024–65535。 */
  port: number;
  /** 连 SOCKS 一起设。省略 = `true`。 */
  socks?: boolean;
  /** 追加进例外列表（排在原有的与宿主必加的 `127.0.0.1`、`::1`、`localhost`、`*.local`、`169.254/16` 之后），≤ 64 条、不带空白。 */
  bypass?: string[];
}

/**
 * 主服务的代理由别的工具在动态状态里给出（Surge 增强模式、其他 VPN 的虚拟网卡）：写了也不生效，所以 `enable` 什么都不写。
 * `message` 是一句可以原样给用户看的话。
 */
export interface SystemProxyBlocker {
  serviceName: string;
  address: string;
  message: string;
}

/**
 * `systemProxy.status` / `enable` / `disable` 的返回。
 *
 * `owner`：`self` 是这个扩展接管着（带 `port`）、`other` 是另一个扩展（带 `otherName`——同一时刻只有一个主人）、`none` 是没人。
 * `effective`：有效系统代理此刻就是这个扩展写的那个端口（被别的工具盖住时为假）。`current`：有效系统代理的一句话（`127.0.0.1:6152`），没有为省略。
 */
export interface SystemProxyStatus {
  owner: "self" | "other" | "none";
  port?: number;
  effective: boolean;
  current?: string;
  otherName?: string;
  blocker?: SystemProxyBlocker;
}

// ---------------------------------------------------------------------------
// SDK 2.10：常驻进程重载、TUN 增强模式、悬浮球那一层、浏览器当前页、挑文件。bridge schema 的
// `$defs.daemonReloadRequest` / `cidr` / `tunnelStartRequest` / `tunnelReloadRequest` / `tunnelRequest` / `tunnelStatus` /
// `orbMeterModel` / `browserActiveTab` / `filesPickRequest` / `filesPickResult`。语义见 jarvis-mac
// `specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-4…T-10。
// ---------------------------------------------------------------------------

/**
 * `jarvis.daemon.reload` 的入参：换配置不断进程。只对 manifest 声明了 `reload` 的常驻进程放行（否则 `capability.undeclared`）；
 * 声明了 `config` 时必带，宿主重写同一个配置文件（0600）再发声明的信号（本期只有 SIGHUP）。状态保持 `running`。
 *
 * 为什么不 `stop` + `start`：系统代理的兜底还原看的是「这个扩展还有没有在跑的常驻进程」——停一下再起，中间那一两秒宿主会以为内核没了、把系统代理还原掉。
 */
export interface DaemonReloadRequest {
  id: string;
  /** ≤ 4 MiB（按字节由宿主数）。 */
  config?: string;
}

/** TUN 的协议栈：`mixed`（默认，TCP 走系统栈、UDP 走 gVisor）、`system`、`gvisor`。 */
export type TunnelStack = "mixed" | "system" | "gvisor";

/**
 * `jarvis.tunnel.start` 的入参。
 *
 * `config` 是 sing-box 配置正文，**不含 TUN 入站**：TUN 段由宿主填（地址、`auto_route`、`strict_route`、协议栈、不进 TUN 的路由），
 * 并强制 `route.auto_detect_interface`。正文要过宿主网络助手的守卫——任何文件路径（`log.output`、`*_path`、本地规则集……）、
 * 监听非回环地址的入站、`external_ui`、`v2ray_api`、Clash API 不在 `127.0.0.1:<controlPort>` 都会以 `invalid.argument` 拒绝，`message` 写明是哪个键。
 */
export interface TunnelStartRequest {
  /** sing-box 配置正文（≤ 4 MiB）。 */
  config: string;
  /** 配置里 Clash API 监听的本机端口（`experimental.clash_api.external_controller` 必须恰好是 `127.0.0.1:<它>`）。之后 `tunnel.request` 只发往它。 */
  controlPort: number;
  /** 用户填的 sing-box 路径；省略 = 宿主自动定位（规则同 `daemon`）。宿主拿它比对 root 目录里那份副本的哈希，不同就在这次开启时重装副本（又一次管理员授权）。 */
  executable?: string;
  /** 不进 TUN 的路由（CIDR，≤ 256 条）：局域网、Surge 的 `tun-excluded-routes` / `bypass-tun`。宿主另外必加回环、链路本地与组播。 */
  excludeRoutes?: string[];
  /** 省略 = `mixed`。 */
  stack?: TunnelStack;
  /** 省略 = `true`：给 TUN 配一个 IPv6 地址。 */
  ipv6?: boolean;
}

/** `jarvis.tunnel.request` 的入参：与 `daemon.request` 相同，但没有 `id`——只发往 TUN 内核报的 `127.0.0.1:<controlPort>`，只在它 `running` 时放行，不经任何代理。 */
export type TunnelRequest = Omit<DaemonRequest, "id">;

/**
 * 网络助手此刻的样子：`notInstalled` 没装；`outdated` 装着的版本与这一版 Jarvis 不符（下次开启时重装）；`ready` 就绪；
 * `unreachable` 装了但连不上（被手动删坏、launchd 没拉起来）。
 */
export type TunnelHelperState = "notInstalled" | "outdated" | "ready" | "unreachable";

/** 主网卡此刻已经是别人的 `utun`（Surge 增强模式 / 其他 VPN）：TUN 不启动。`message` 是一句可以原样给用户看的话。 */
export interface TunnelBlocker {
  interface: string;
  serviceName?: string;
  message: string;
}

/** `tunnel.start` / `stop` / `status` / `reload` 的返回。 */
export interface TunnelStatus {
  /** 同 `DaemonState`。 */
  state: DaemonState;
  /** `running` 时必有。 */
  pid?: number;
  /** `running` 时必有，Unix 毫秒。 */
  startedAt?: number;
  exitCode?: number;
  signal?: number;
  /** `running` 时必有。 */
  controlPort?: number;
  helper: {
    state: TunnelHelperState;
    version?: string;
    /** root 目录里那份 sing-box 副本的版本（`sing-box version` 第一行里的版本号）。 */
    kernelVersion?: string;
    kernelSHA256?: string;
  };
  kernel: {
    /** 此刻定位到的用户那份 sing-box，找不到为空串。 */
    executable: string;
    /** 与 root 目录里那份副本哈希相同。为假 = 下次开启会再要一次管理员授权，把新版拷进去（`brew upgrade sing-box` 之后就是这样）。 */
    matchesInstalled: boolean;
  };
  /** 有值 = 别的 VPN / 增强模式正占着主网卡，`start` 没有启动（不抛错，同 `systemProxy.enable` 的拦截）。 */
  blocker?: TunnelBlocker;
}

/**
 * 悬浮球那一层的读数（SDK 2.10，`jarvis.orb.update`）。本期只有 `traffic`：
 *
 * - `upload` / `download`：**有效**速率（字节 / 秒，≥ 0）——只算拿到过回包的连接上的字节；
 * - `succeeded` / `failed`：最近一个窗口里判定了的连接数，宿主据此画外圈的青 / 红两段；
 * - `caption`（≤ 40 字）：悬停提示与 VoiceOver 补一句（「节点选择 · c95s5」）。
 *
 * `null` 撤掉。宿主按 250 ms 合并，**5 秒没有更新自动撤掉**——后台会话没了，不能让一个停住的读数挂在球上。
 */
export type OrbMeterModel = {
  kind: "traffic";
  upload: number;
  download: number;
  succeeded: number;
  failed: number;
  caption?: string;
} | null;

/**
 * `browser.activeTab()` 读到的状态：`ok` 读到了；`denied` 用户没在「系统设置 › 隐私与安全性 › 自动化」里允许 Jarvis 控制这个浏览器；
 * `unsupported` 这个浏览器读不了地址（Firefox）；`noWindow` 没有窗口；`unavailable` 读超时或出错（`message` 写原因）。
 */
export type BrowserActiveTabStatus = "ok" | "denied" | "unsupported" | "noWindow" | "unavailable";

/**
 * `browser.activeTab()` 的返回。此刻前台是浏览器就读它，否则读**最近一次激活过的**浏览器（`frontmost: false`）——
 * 点开菜单栏图标不改变前台 App，所以从菜单栏读到的正是用户刚才在看的那一页。从没用过任何浏览器为 `null`。
 */
export type BrowserActiveTab = BrowserActiveTabPage | null;

/**
 * 浏览器当前标签的一次读数（`$defs.browserActiveTabPage`）：`browser.activeTab()` 读到的（不为 `null` 时）与
 * `browser.watchActiveTab` 推来的（SDK 2.13，`frontmost` 恒为真）是同一个形状。
 */
export type BrowserActiveTabPage = {
  browser: {
    bundleId: string;
    name: string;
    /** 浏览器包的路径：Chromium 系的网络进程在包里面，扩展据此在连接表里认它。 */
    path: string;
  };
  frontmost: boolean;
  status: BrowserActiveTabStatus;
  /** `ok` 时必有。 */
  url?: string;
  title?: string;
  message?: string;
};

/** `files.pick` 的入参：宿主画打开面板的起点与可挑的扩展名。 */
export interface FilesPickRequest {
  /** ≤ 80 字。面板上的提示。 */
  title?: string;
  /** 起点目录，可以用 `~`（用户照样可以去别处挑）。 */
  directory?: string;
  /** 可挑的扩展名，不带点（≤ 16 个）。省略 = 任何文件。 */
  extensions?: string[];
}

/** `files.pick` 的返回：用户取消为 `null`；否则文件名（**不带路径**——扩展拿不到路径）与 UTF-8 正文（≤ 4 MiB）。 */
export type FilesPickResult = { name: string; text: string } | null;

/** 宿主 → SDK 的事件。 */
export type HostEvent =
  | { type: "activate"; context: ActivationContext }
  | { type: "deactivate" }
  | { type: "settle"; id: number; result: InvokeResult }
  | { type: "ui"; handler: string; payload: unknown }
  | { type: "command"; context: CommandContext }
  | { type: "service"; call: ServiceCall }
  | { type: "serviceCancel"; callId: number }
  | { type: "preferencesChanged"; changes: Record<string, unknown> }
  | { type: "permissionsChanged"; granted: string[] }
  | { type: "subscription"; token: string; payload: unknown }
  /** SDK 2.9：菜单栏域的事件，只发给后台会话。 */
  | { type: "menuBar"; menuBar: MenuBarEvent };

/** 宿主注入的全局对象。 */
export interface HostBridge {
  invoke(requestJSON: string): void;
  commit(commitJSON: string): void;
  log(level: string, message: string, dataJSON: string | null): void;
  /** 同步纯函数（text.* / host.*）：不经事件循环，直接返回结果 JSON。 */
  invokeSync(requestJSON: string): string;
}

/** SDK 注册给宿主的全局对象。 */
export interface RuntimeBridge {
  dispatch(eventJSON: string): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __jarvisHost: HostBridge | undefined;
  // eslint-disable-next-line no-var
  var __jarvisRuntime: RuntimeBridge | undefined;

  /**
   * 宿主注入的定时器。
   *
   * 这里要自己声明，是因为 `tsconfig` 的 `lib` 只有 `ES2020`、`types` 是空的——
   * **故意的**：这个运行时没有 DOM、没有 Node，把那两套类型引进来会让扩展写出
   * `document` 或 `process` 这种编译得过、真机上抛 ReferenceError 的代码。
   * 于是宿主环境里有什么，就在这里一条一条说出来。
   *
   * 没有 `setInterval`：没有哪个扩展需要一个自己不会停的循环。
   */
  function setTimeout(callback: () => void, milliseconds: number): number;
  function clearTimeout(id: number): void;
}

/** `onPress` → `press`、`onChange` → `change`；没有 on 前缀的原样返回。 */
export function eventName(propName: string): string {
  return propName.length > 2 && propName.startsWith("on") ? propName[2]!.toLowerCase() + propName.slice(3) : propName;
}

/** 把一棵节点树序列化到线缆上；回调函数在这里换成句柄。 */
/**
 * `networkStatus()` 的返回（隐式、只读，jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）：此刻的主网络接口。增强模式开着时 sing-box 的隧道会成为主接口，
 * 宿主照样报底下那块实体网卡（「Wi-Fi」「以太网」）。不读 SSID（macOS 14 起要定位授权）、不读地址。
 */
export type NetworkStatus =
  | { kind: "none" }
  | {
      kind: "wifi" | "ethernet" | "other";
      /** BSD 名（`en0`），≤ 16 字。 */
      interface: string;
      /** 系统给的本地化名称（「Wi-Fi」「以太网」），≤ 40 字。 */
      name: string;
    };

export function serialize(root: UINode, register: (fn: (payload: unknown) => void) => string): SerializedNode {
  const walk = (node: UINode): SerializedNode => {
    const props: Record<string, unknown> = {};
    const on: Record<string, string> = {};
    let children: SerializedNode[] | undefined;
    for (const [name, value] of Object.entries(node)) {
      if (name === "kind" || name === "key") continue;
      if (name === "children" && Array.isArray(value)) {
        children = (value as UINode[]).map(walk);
        continue;
      }
      if (typeof value === "function") {
        // 线缆上的事件名去掉 on 前缀：onPress → press、onChange → change，与 actions[].on 同一套。
        on[eventName(name)] = register(value as (payload: unknown) => void);
        continue;
      }
      if (name === "actions" && Array.isArray(value)) {
        props[name] = (value as { onPress: (payload: unknown) => void }[]).map((action) => {
          const { onPress, ...rest } = action;
          return { ...rest, on: { press: register(onPress) } };
        });
        continue;
      }
      if (name === "action" && value && typeof value === "object" && "onPress" in (value as object)) {
        const { onPress, ...rest } = value as { onPress: (payload: unknown) => void };
        props[name] = { ...rest, on: { press: register(onPress) } };
        continue;
      }
      if ((name === "hoverCard" || name === "emptyState") && value && typeof value === "object") {
        props[name] = walk(value as UINode);
        continue;
      }
      props[name] = value;
    }
    const out: SerializedNode = { kind: node.kind, props };
    if (node.key !== undefined) out.key = node.key;
    if (Object.keys(on).length > 0) out.on = on;
    if (children) out.children = children;
    return out;
  };
  return walk(root);
}

/** 数一棵序列化树有多少节点。 */
export function countNodes(node: SerializedNode): number {
  let count = 1;
  for (const child of node.children ?? []) count += countNodes(child);
  for (const name of ["hoverCard", "emptyState"]) {
    const nested = node.props[name];
    if (nested && typeof nested === "object" && "kind" in (nested as object)) count += countNodes(nested as SerializedNode);
  }
  return count;
}
