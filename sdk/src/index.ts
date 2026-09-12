/**
 * `@fusionseek/jarvis-extension-sdk` 的入口。
 *
 * 一个扩展只做三件事：`defineExtension` 交出页面与命令，用 `ui.*` 描述界面，
 * 用全局 `jarvis` 调宿主能力。其余（渲染、悬停光、授权、存储隔离、快捷键注册）全在宿主。
 *
 * 入口模型是 **命令 + 页面**：工具箱那一行打开页面；快捷键、页面里的按钮、快捷环、Inbox 卡片
 * 触发命令。没有自定义页面的扩展，SDK 会画一张列出全部命令的默认页。
 */
import type { EnvironmentInfo, HostInfo, Jarvis, Unsubscribe } from "./capabilities.js";
import { JarvisError } from "./capabilities.js";
import type { ActivationContext, CommandContext, HostEvent, InvokeResult, HostBridge, CommandSummary, Surface } from "./bridge.js";
import { bridgeProtocolVersion, countNodes, serialize } from "./bridge.js";
import type { UINode } from "./ui.js";
import { maximumNodesPerRender, ui } from "./ui.js";
import { ocr } from "./ocr.js";

export * from "./manifest.js";
export * from "./ui.js";
export * from "./capabilities.js";
export * from "./ocr.js";
export type { ActivationContext, CommandContext, CommandSummary, CommandTrigger, HostEvent, SerializedNode, Surface } from "./bridge.js";
export { bridgeProtocolVersion } from "./bridge.js";

export const sdkVersion = "1.2.0";

export interface PageDefinition {
  /** 进入扩展页面时调用一次。拿到已授予的能力、当前偏好与命令清单。 */
  activate?(context: ActivationContext): void | Promise<void>;
  /** 每次需要重画时调用。必须是同步的、只读自己的状态。 */
  render(): UINode;
  /** 离开扩展页面时调用；`background: true` 的扩展只在被禁用 / 卸载时调用。 */
  deactivate?(): void | Promise<void>;
}

export type CommandHandler = (context: CommandContext) => void | Promise<void>;

export interface ExtensionDefinition {
  /** 工具箱那一行打开的页面。省略时 SDK 画一张列出全部命令的默认页。 */
  page?: PageDefinition;
  /**
   * `presentation: "popover"` 的命令结束后，宿主贴着选区弹出的那扇原地结果弹窗里画什么。
   * 省略时弹窗里画 `page.render()` 的那棵树。弹窗 400 宽、按内容长高（最高 520），因此这里通常是
   * 页面的紧凑版：不画缩略图、不画偏好行，只有原文、语言行与译文。
   * 同一时刻只有一面（面板或弹窗）开着；「在面板里打开」是宿主先 `deactivate` 这里再 `activate` 页面。
   */
  popover?: PageDefinition;
  /** manifest `commands[]` 里每条命令的处理函数，按 id 对上。 */
  commands?: Record<string, CommandHandler>;
  /** Inbox 卡片上的按钮被按了。卡片由宿主收走，这里只做后果。 */
  onInboxAction?(cardId: string, actionId: string): void | Promise<void>;
  /** 用户点了这个扩展发的系统横幅；宿主已经把面板展开到这个扩展。 */
  onNotificationActivated?(): void | Promise<void>;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: JarvisError) => void };

/**
 * 运行时。**一个 JSContext 里只有一份**：`defineExtension` 第二次调用会抛错，
 * 因为宿主只认一个入口。
 *
 * 宿主全局 `__jarvisHost` 是**延迟绑定**的：模块加载时不碰它，第一次真的要调宿主时才找。
 * 因此这个 bundle 可以在 node 里被 `import`（配合 `testing.ts` 的替身跑单测），
 * 只有真的调能力却没有宿主时才报错。
 */
class Runtime {
  private definition: ExtensionDefinition | null = null;
  private nextRequestId = 1;
  private generation = 0;
  private pending = new Map<number, Pending>();
  private handlers = new Map<string, (payload: unknown) => void>();
  private subscriptions = new Map<string, (payload: unknown) => void>();
  private updateQueued = false;
  /** 此刻开着的那一面；`null` = 既没有页面也没有弹窗，`render()` 不会被调。 */
  private activeSurface: Surface | null = null;
  private commandSummaries: CommandSummary[] = [];
  private hostRef: HostBridge | null = null;
  private registered = false;

  private host(): HostBridge {
    if (this.hostRef) return this.hostRef;
    const host = globalThis.__jarvisHost;
    if (!host) {
      throw new Error("找不到 __jarvisHost：这段代码只能在 Jarvis 的扩展运行时里执行（单测请先 createTestHost()）。");
    }
    this.hostRef = host;
    return host;
  }

  /** 把 `dispatch` 挂到全局。幂等；`defineExtension` 与任何一次能力调用都会确保它挂上了。 */
  private ensureRegistered(): void {
    if (this.registered) return;
    globalThis.__jarvisRuntime = { dispatch: (json) => this.dispatch(json) };
    this.registered = true;
  }

  define(definition: ExtensionDefinition): void {
    if (this.definition) {
      throw new Error("defineExtension() 只能调用一次：宿主只认一个入口。");
    }
    this.definition = definition;
    this.ensureRegistered();
  }

  /** 让宿主再调一次 render。同一拍里的多次请求合并成一次提交；页面与弹窗都没开着时是空操作。 */
  requestUpdate(): void {
    if (this.updateQueued || !this.activeSurface) return;
    this.updateQueued = true;
    Promise.resolve().then(() => {
      this.updateQueued = false;
      this.commit();
    });
  }

  invoke<T>(namespace: string, method: string, params: unknown): Promise<T> {
    this.ensureRegistered();
    const id = this.nextRequestId++;
    const request = { protocol: bridgeProtocolVersion, id, namespace, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.host().invoke(JSON.stringify(request));
    });
  }

  invokeSync<T>(namespace: string, method: string, params: unknown): T {
    const request = { protocol: bridgeProtocolVersion, id: 0, namespace, method, params };
    const result = JSON.parse(this.host().invokeSync(JSON.stringify(request))) as InvokeResult;
    if (result.ok) return result.value as T;
    throw new JarvisError(result.error);
  }

  /**
   * 订阅宿主事件。宿主拒绝订阅（没授权、没这个能力）时**不抛到扩展里**：一条被拒的订阅只是收不到事件，
   * 让它变成未处理的 rejection 会把整个上下文拖垮。拒绝记一条 warn 日志，开发者模式看得见。
   */
  subscribe(namespace: string, method: string, listener: (payload: unknown) => void): Unsubscribe {
    const token = `${namespace}.${method}#${this.nextRequestId++}`;
    this.subscriptions.set(token, listener);
    this.invoke(namespace, method, { token }).catch((error: unknown) => {
      this.subscriptions.delete(token);
      this.log("warn", `订阅 ${namespace}.${method} 被宿主拒绝`, error instanceof Error ? error.message : String(error));
    });
    return () => {
      this.subscriptions.delete(token);
      this.invoke(namespace, "unsubscribe", { token }).catch(() => undefined);
    };
  }

  log(level: string, message: string, data: unknown): void {
    this.host().log(level, message, data === undefined ? null : JSON.stringify(data));
  }

  /** 开着的那一面的定义：弹窗（没给时退回页面）或页面。 */
  private surfaceDefinition(surface: Surface | null): PageDefinition | undefined {
    const definition = this.definition;
    if (surface === "popover" && definition?.popover) return definition.popover;
    return definition?.page;
  }

  /** 此刻那一面的树：弹窗、自定义页面，或按命令清单画的默认页。 */
  private renderSurface(): UINode {
    const page = this.surfaceDefinition(this.activeSurface);
    if (page) return page.render();
    return ui.scroll({
      children: [
        ui.section({
          title: "命令 · COMMANDS",
          children: this.commandSummaries.length
            ? this.commandSummaries.map((command) =>
                ui.row({
                  key: command.id,
                  symbol: command.presentation === "silent" ? "bolt" : "rectangle.and.text.magnifyingglass",
                  title: command.title,
                  subtitle: command.hotkey ? `快捷键 ${command.hotkey}` : (command.description ?? "没有快捷键，在这里运行"),
                  onPress: () => void jarvis.commands.run(command.id),
                }),
              )
            : [ui.empty({ symbol: "bolt.slash", title: "这个扩展没有命令", hint: "它的 manifest 里既没有页面也没有命令。" })],
        }),
      ],
    });
  }

  private commit(): void {
    const surface = this.activeSurface;
    if (!this.definition || !surface) return;
    // 上一棵树的句柄整批作废：宿主只会回传最新一棵树上的句柄。
    this.handlers.clear();
    const register = (fn: (payload: unknown) => void): string => {
      const handlerId = `h${this.handlers.size + 1}`;
      this.handlers.set(handlerId, fn);
      return handlerId;
    };
    const root = serialize(this.renderSurface(), register);
    const count = countNodes(root);
    if (count > maximumNodesPerRender) {
      throw new Error(`一次 render 提交了 ${count} 个节点，上限 ${maximumNodesPerRender}。`);
    }
    this.generation += 1;
    this.host().commit(JSON.stringify({ protocol: bridgeProtocolVersion, generation: this.generation, surface, root }));
  }

  private dispatch(json: string): void {
    const event = JSON.parse(json) as HostEvent;
    const definition = this.definition;
    switch (event.type) {
      case "activate": {
        const surface: Surface = event.context.surface ?? "page";
        this.activeSurface = surface;
        this.commandSummaries = event.context.commands ?? [];
        void Promise.resolve(this.surfaceDefinition(surface)?.activate?.(event.context)).then(() => this.commit());
        return;
      }
      case "deactivate": {
        const surface = this.activeSurface;
        this.activeSurface = null;
        this.handlers.clear();
        void this.surfaceDefinition(surface)?.deactivate?.();
        return;
      }
      case "settle": {
        const pending = this.pending.get(event.id);
        if (!pending) return;
        this.pending.delete(event.id);
        if (event.result.ok) pending.resolve(event.result.value);
        else pending.reject(new JarvisError(event.result.error));
        return;
      }
      case "ui": {
        const handler = this.handlers.get(event.handler);
        if (!handler) return;
        handler(event.payload);
        // 回调改了状态，默认认为界面要跟着变；没变时宿主 diff 出来是一棵一样的树，代价可忽略。
        this.requestUpdate();
        return;
      }
      case "command": {
        const handler = definition?.commands?.[event.context.id];
        if (!handler) {
          this.log("error", `manifest 声明了命令「${event.context.id}」，但 defineExtension 里没有它的处理函数。`, undefined);
          return;
        }
        void Promise.resolve(handler(event.context)).then(
          () => this.requestUpdate(),
          (error: unknown) => this.log("error", `命令「${event.context.id}」抛出了异常`, error instanceof Error ? error.message : String(error)),
        );
        return;
      }
      case "subscription": {
        this.subscriptions.get(event.token)?.(event.payload);
        return;
      }
      case "preferencesChanged":
      case "permissionsChanged": {
        this.requestUpdate();
        return;
      }
      case "inboxAction": {
        void definition?.onInboxAction?.(event.cardId, event.actionId);
        return;
      }
      case "notificationActivated": {
        void definition?.onNotificationActivated?.();
        return;
      }
    }
  }
}

const runtime = new Runtime();

/** 交出扩展定义。整个 bundle 只能调用一次。 */
export function defineExtension(definition: ExtensionDefinition): void {
  runtime.define(definition);
}

function namespaced(namespace: string) {
  return <T>(method: string, params?: unknown) => runtime.invoke<T>(namespace, method, params ?? {});
}

function syncNamespaced(namespace: string) {
  return <T>(method: string, params?: unknown) => runtime.invokeSync<T>(namespace, method, params ?? {});
}

const call = {
  panel: namespaced("panel"),
  commands: namespaced("commands"),
  storage: namespaced("storage"),
  preferences: namespaced("preferences"),
  permissions: namespaced("permissions"),
  clipboard: namespaced("clipboard"),
  quickTransfer: namespaced("quickTransfer"),
  screenshot: namespaced("screenshot"),
  ocr: namespaced("ocr"),
  speech: namespaced("speech"),
  notifications: namespaced("notifications"),
  inbox: namespaced("inbox"),
  memo: namespaced("memo"),
  calendar: namespaced("calendar"),
  tasks: namespaced("tasks"),
  net: namespaced("net"),
  files: namespaced("files"),
  system: namespaced("system"),
};

const sync = {
  text: syncNamespaced("text"),
  time: syncNamespaced("time"),
  color: syncNamespaced("color"),
  host: syncNamespaced("host"),
};

/** 扩展里那个全局对象的实现。类型见 `capabilities.ts`。`host` 与 `environment` 延迟到第一次读取才问宿主。 */
export const jarvis: Jarvis = {
  sdk: { version: sdkVersion },
  get host() {
    return sync.host<HostInfo>("info");
  },
  get environment() {
    return sync.host<EnvironmentInfo>("environment");
  },
  ui: {
    update: () => runtime.requestUpdate(),
  },
  panel: {
    hold(reason) {
      let released = false;
      const id = runtime.invoke<string>("panel", "hold", { reason });
      return {
        release() {
          if (released) return;
          released = true;
          void id.then((handle) => call.panel("release", { handle }));
        },
      };
    },
    collapse: () => call.panel("collapse"),
    present: () => call.panel("present"),
  },
  commands: {
    run: (id) => call.commands("run", { id }),
  },
  storage: {
    get: (key) => call.storage("get", { key }),
    set: (key, value) => call.storage("set", { key, value }),
    delete: (key) => call.storage("delete", { key }),
    keys: () => call.storage("keys"),
  },
  preferences: {
    get: (key) => call.preferences("get", { key }),
    all: () => call.preferences("all"),
    onChange: (listener) => runtime.subscribe("preferences", "observe", listener as (payload: unknown) => void),
  },
  permissions: {
    granted: () => call.permissions("granted"),
    request: (ids) => call.permissions("request", { ids }),
    openSystemSettings: (kind) => call.permissions("openSystemSettings", { kind }),
  },
  log: {
    debug: (message, data) => runtime.log("debug", message, data),
    info: (message, data) => runtime.log("info", message, data),
    warn: (message, data) => runtime.log("warn", message, data),
    error: (message, data) => runtime.log("error", message, data),
  },
  text: {
    base64: {
      encode: (text, options) => sync.text("base64.encode", { text, ...options }),
      decode: (text, options) => sync.text("base64.decode", { text, ...options }),
    },
    hash: {
      digest: (algorithm, text, options) => sync.text("hash.digest", { algorithm, text, ...options }),
    },
    json: {
      format: (text, options) => sync.text("json.format", { text, ...options }),
      minify: (text, options) => sync.text("json.minify", { text, ...options }),
    },
    url: {
      parse: (text) => sync.text("url.parse", { text }),
      build: (parts) => sync.text("url.build", parts),
    },
    regex: {
      test: (pattern, text, flags) => sync.text("regex.test", { pattern, text, flags }),
    },
    language: {
      detect: (text, options) => sync.text("language.detect", { text, ...options }),
      displayName: (code) => sync.text("language.displayName", { code }),
    },
  },
  time: {
    parse: (text, unit) => sync.time("parse", { text, unit }),
    format: (epochMilliseconds, pattern, timeZone) => sync.time("format", { epochMilliseconds, pattern, timeZone }),
    timeZones: () => sync.time("timeZones"),
  },
  color: {
    convert: (hex) => sync.color("convert", { hex }),
  },
  clipboard: {
    read: () => call.clipboard("read"),
    readImage: () => call.clipboard("readImage"),
    write: (text) => call.clipboard("write", { text }),
    history: (options) => call.clipboard("history", options),
    entryText: (id) => call.clipboard("entryText", { id }),
    observe: (listener) => runtime.subscribe("clipboard", "observe", listener as (payload: unknown) => void),
  },
  quickTransfer: {
    status: () => call.quickTransfer("status"),
    observe: (listener) => runtime.subscribe("quickTransfer", "observe", listener as (payload: unknown) => void),
    start: () => call.quickTransfer("start"),
    stop: () => call.quickTransfer("stop"),
    sendText: (text) => call.quickTransfer("sendText", { text }),
    sendFile: (file) => call.quickTransfer("sendFile", { file }),
    records: (options) => call.quickTransfer("records", options),
  },
  screenshot: {
    capture: (options) => call.screenshot("capture", options),
  },
  ocr: {
    recognize: (file, options) => call.ocr("recognize", { file, ...options }),
  },
  speech: {
    speak: (text, options) => call.speech("speak", { text, ...options }),
    stop: () => call.speech("stop"),
  },
  notifications: {
    post: (content) => call.notifications("post", content),
  },
  inbox: {
    post: (card) => call.inbox("post", card),
    dismiss: (cardId) => call.inbox("dismiss", { cardId }),
  },
  memo: {
    list: (options) => call.memo("list", options),
    create: (body) => call.memo("create", { body }),
    complete: (id) => call.memo("complete", { id }),
  },
  calendar: {
    runs: (range) => call.calendar("runs", range),
  },
  tasks: {
    recent: () => call.tasks("recent"),
    observe: (listener) => runtime.subscribe("tasks", "observe", listener as (payload: unknown) => void),
  },
  net: {
    fetch: (url, init) => call.net("fetch", { url, ...init }),
  },
  files: {
    pick: (options) => call.files("pick", options),
    readText: (file) => call.files("readText", { file }),
    readBytes: (file) => call.files("readBytes", { file }),
    reveal: (file) => call.files("reveal", { file }),
  },
  system: {
    openURL: (url) => call.system("openURL", { url }),
    openExtensionSettings: () => call.system("openExtensionSettings"),
  },
};

export { ui, ocr };
