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
import type { UINode } from "./ui.js";
import type { JarvisErrorShape } from "./capabilities.js";
import type { CommandPresentation, ServicePoint } from "./manifest.js";
import type { CodeFormatMethod, CodeFormatRequest, CodeHighlightMethod, CodeHighlightRequest, JunkCleanMethod, LauncherAppsMethod, ProjectEngineMethod, ProjectEngineRequest } from "./services.js";

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
 * `code.format`（SDK 2.7）是 `describe`（不带入参）与 `format`（入参 `CodeFormatRequest`）；`code.highlight`（SDK 2.8）是 `describe` 与 `highlight`（入参 `CodeHighlightRequest`）。
 */
export interface ServiceCall {
  callId: number;
  point: ServicePoint;
  /** manifest `contributes.services[].id`。 */
  service: string;
  method: JunkCleanMethod | ProjectEngineMethod | LauncherAppsMethod | CodeFormatMethod | CodeHighlightMethod;
  params: { preferences: Record<string, unknown>; granted: string[]; actionId?: string; request?: ProjectEngineRequest | CodeFormatRequest | CodeHighlightRequest };
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

/** 子菜单。至多嵌两层；更深的、以及整份模型超过 300 项的部分，宿主丢掉并记一条警告（schema 数不了递归总数）。 */
export interface MenuBarSubmenu {
  kind: "submenu";
  /** 1–80 字。 */
  title: string;
  symbol?: string;
  /** 省略 = 可展开。 */
  enabled?: boolean;
  items: MenuBarItem[];
}

/** 菜单里的一项：可点的条目、分隔线、段标题或子菜单。 */
export type MenuBarItem = MenuBarActionItem | MenuBarSeparator | MenuBarHeader | MenuBarSubmenu;

/**
 * `jarvis.menuBar.update` 的入参：这个扩展那枚菜单栏图标与它的菜单。
 *
 * 宿主**缓存最后一份**：后台会话空闲被收掉之后图标与菜单照旧在，点开 / 点选时宿主把会话唤醒再发事件。
 * 宿主按 250 ms 合并，只画最后一份——挡的是「每帧推一次速率」。菜单末尾宿主固定追加分隔线、「打开「名」」与「「名」的设置」，
 * 扩展改不掉：菜单栏图标是扩展唯一常驻在屏幕上的东西，用户必须总能从它回到 Jarvis 管它的地方。
 */
export interface MenuBarModel {
  /** 图标（SF Symbol）。省略 = manifest `contributes.menuBar.symbol`；宿主画不出时同样退回它。 */
  symbol?: string;
  /** 图标右侧的短字（≤ 16 字，速率之类）。省略 = 只有图标。 */
  title?: string;
  /** 悬停提示，≤ 80 字。 */
  tooltip?: string;
  /** ≤ 300 项（含子菜单里的）。 */
  items: MenuBarItem[];
}

/**
 * 宿主 → 后台会话的 `menuBar` 事件（线缆形状）。SDK 把它拆成 `defineExtension({ menuBar })` 的三个回调。
 *
 * - `start`：应用启动、扩展启用 / 更新、用户在设置里重新打开「在菜单栏显示」时各一次——推第一份模型、做「启动时恢复」；
 * - `open`：用户点开菜单的那一刻（`menuWillOpen`）——可以趁机刷新读数，菜单开着时宿主照样就地更新条目；
 * - `select`：用户点了一项，`itemId` 是扩展自己给的 id。
 */
export type MenuBarEvent =
  | { event: "start" | "open"; granted: string[]; preferences: Record<string, unknown> }
  | { event: "select"; itemId: string; granted: string[]; preferences: Record<string, unknown> };

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
