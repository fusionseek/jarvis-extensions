/**
 * 宿主 ⇄ 扩展的线缆。
 *
 * 扩展跑在宿主进程里的一个 JavaScriptCore `JSContext`（每个扩展一个，各自一条串行队列）。
 * 两边**只交换 JSON 字符串**，没有共享对象：这是安全边界，也是"宿主升级不碰扩展"的前提。
 *
 * 宿主注入一个全局 `__jarvisHost`（下面的 `HostBridge`），SDK 注册一个全局 `__jarvisRuntime`
 * （`RuntimeBridge`）；此外全局环境里没有 `fetch`、`XMLHttpRequest`、`require`、`import()`、
 * 文件系统或任何 DOM。扩展能做的每一件事都要过 `__jarvisHost.invoke`，而每一次 invoke 都在
 * 宿主侧过一遍能力闸门。
 *
 * **JS 不在渲染路径的每一帧里。** 这条线上只跑事件、能力调用与整棵树的提交；悬停、滚动、动画、
 * 文本编辑全在宿主，JS 拿不到"每一帧"。
 */
import type { UINode } from "./ui.js";
import type { JarvisErrorShape } from "./capabilities.js";
import type { CommandPresentation } from "./manifest.js";

/** 线缆协议版本。宿主与 SDK 主版本不同时，宿主拒绝加载并在扩展页面说明。 */
export const bridgeProtocolVersion = 1 as const;

/** SDK → 宿主：一次能力调用。 */
export interface InvokeRequest {
  protocol: typeof bridgeProtocolVersion;
  /** 单调递增，由 SDK 生成；宿主用它回 `settle`。 */
  id: number;
  /** 形如 `clipboard` / `quickTransfer` / `storage`。 */
  namespace: string;
  method: string;
  params: unknown;
}

export type InvokeResult =
  | { ok: true; value: unknown }
  | { ok: false; error: JarvisErrorShape };

/** SDK → 宿主：一次 UI 提交。 */
export interface CommitRequest {
  protocol: typeof bridgeProtocolVersion;
  /** 每次提交递增；宿主丢弃比已渲染更旧的树（异步回调交叉时会出现）。 */
  generation: number;
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

/** 一条命令是从哪儿触发的。 */
export type CommandTrigger = "hotkey" | "page" | "ring" | "inboxCard" | "developer";

/** 宿主在 `activate` 里带给页面的命令清单（给没有自定义页面的扩展画默认页用）。 */
export interface CommandSummary {
  id: string;
  title: string;
  description?: string | undefined;
  /** 用户此刻配置的快捷键显示串；没配为 `undefined`。 */
  hotkey?: string | undefined;
  presentation: CommandPresentation;
}

/** 页面 `activate` 拿到的东西。 */
export interface ActivationContext {
  /** 从哪里进来的：工具箱那一行、快捷环、Inbox 卡片、通知横幅、命令跑完之后、开发者模式重载。 */
  entry: "toolbox" | "shortcutRing" | "inboxCard" | "notification" | "command" | "developer";
  granted: string[];
  preferences: Record<string, unknown>;
  commands: CommandSummary[];
}

/** 命令处理函数拿到的东西。 */
export interface CommandContext {
  id: string;
  trigger: CommandTrigger;
  granted: string[];
  preferences: Record<string, unknown>;
}

/** 宿主 → SDK 的事件。 */
export type HostEvent =
  | { type: "activate"; context: ActivationContext }
  | { type: "deactivate" }
  | { type: "settle"; id: number; result: InvokeResult }
  | { type: "ui"; handler: string; payload: unknown }
  | { type: "command"; context: CommandContext }
  | { type: "preferencesChanged"; changes: Record<string, unknown> }
  | { type: "permissionsChanged"; granted: string[] }
  | { type: "inboxAction"; cardId: string; actionId: string }
  | { type: "notificationActivated" }
  | { type: "subscription"; token: string; payload: unknown };

/** 宿主注入的全局对象。 */
export interface HostBridge {
  invoke(requestJSON: string): void;
  commit(commitJSON: string): void;
  log(level: string, message: string, dataJSON: string | null): void;
  /** 同步纯函数（text.* / time.* / color.*）：不经事件循环，直接返回结果 JSON。 */
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
}

/** 把一棵节点树序列化到线缆上；回调函数在这里换成句柄。 */
/** `onPress` → `press`、`onChange` → `change`；没有 on 前缀的原样返回。 */
export function eventName(propName: string): string {
  return propName.length > 2 && propName.startsWith("on") ? propName[2]!.toLowerCase() + propName.slice(3) : propName;
}

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
