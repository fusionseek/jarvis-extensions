/**
 * `@fusionseek/jarvis-extension-sdk` 的入口。
 *
 * 一个扩展只做三件事：`defineExtension` 交出生命周期与 `render`，用 `ui.*` 描述界面，
 * 用全局 `jarvis` 调宿主能力。其余（渲染、悬停光、授权、存储隔离）全在宿主。
 */
import type { Jarvis, JarvisErrorShape, Unsubscribe } from "./capabilities.js";
import { JarvisError } from "./capabilities.js";
import type { ActivationContext, HostEvent, InvokeResult, HostBridge } from "./bridge.js";
import { bridgeProtocolVersion, serialize } from "./bridge.js";
import type { UINode } from "./ui.js";
import { maximumNodesPerRender, ui } from "./ui.js";

export * from "./manifest.js";
export * from "./ui.js";
export * from "./capabilities.js";
export type { ActivationContext, HostEvent, SerializedNode } from "./bridge.js";
export { bridgeProtocolVersion } from "./bridge.js";

export const sdkVersion = "1.0.0";

export interface ExtensionDefinition {
  /** 进入扩展页面（或后台唤醒）时调用一次。拿到已授予的能力与当前偏好。 */
  activate?(context: ActivationContext): void | Promise<void>;
  /** 每次需要重画时调用。必须是同步的、只读自己的状态。 */
  render(): UINode;
  /** 离开扩展页面时调用；`background: true` 的扩展只在被禁用 / 卸载时调用。 */
  deactivate?(): void | Promise<void>;
  /** Inbox 卡片上的按钮被按了。卡片由宿主收走，这里只做后果。 */
  onInboxAction?(cardId: string, actionId: string): void | Promise<void>;
  /** 用户点了这个扩展发的系统横幅；宿主已经把面板展开到这个扩展。 */
  onNotificationActivated?(): void | Promise<void>;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: JarvisError) => void };

/**
 * 运行时。**一个 JSContext 里只有一份**：`defineExtension` 第二次调用会抛错，
 * 因为宿主只认一个入口。
 */
class Runtime {
  private definition: ExtensionDefinition | null = null;
  private nextRequestId = 1;
  private generation = 0;
  private pending = new Map<number, Pending>();
  private handlers = new Map<string, (payload: unknown) => void>();
  private subscriptions = new Map<string, (payload: unknown) => void>();
  private updateQueued = false;
  private active = false;

  constructor(private readonly host: HostBridge) {
    globalThis.__jarvisRuntime = { dispatch: (json) => this.dispatch(json) };
  }

  define(definition: ExtensionDefinition): void {
    if (this.definition) {
      throw new Error("defineExtension() 只能调用一次：宿主只认一个入口。");
    }
    this.definition = definition;
  }

  /** 让宿主再调一次 render。同一拍里的多次请求合并成一次提交。 */
  requestUpdate(): void {
    if (this.updateQueued || !this.active) return;
    this.updateQueued = true;
    Promise.resolve().then(() => {
      this.updateQueued = false;
      this.commit();
    });
  }

  invoke<T>(namespace: string, method: string, params: unknown): Promise<T> {
    const id = this.nextRequestId++;
    const request = { protocol: bridgeProtocolVersion, id, namespace, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.host.invoke(JSON.stringify(request));
    });
  }

  invokeSync<T>(namespace: string, method: string, params: unknown): T {
    const request = { protocol: bridgeProtocolVersion, id: 0, namespace, method, params };
    const result = JSON.parse(this.host.invokeSync(JSON.stringify(request))) as InvokeResult;
    if (result.ok) return result.value as T;
    throw new JarvisError(result.error);
  }

  subscribe(namespace: string, method: string, listener: (payload: unknown) => void): Unsubscribe {
    const token = `${namespace}.${method}#${this.nextRequestId++}`;
    this.subscriptions.set(token, listener);
    void this.invoke(namespace, method, { token });
    return () => {
      this.subscriptions.delete(token);
      void this.invoke(namespace, "unsubscribe", { token });
    };
  }

  log(level: string, message: string, data: unknown): void {
    this.host.log(level, message, data === undefined ? null : JSON.stringify(data));
  }

  private commit(): void {
    const definition = this.definition;
    if (!definition || !this.active) return;
    // 上一棵树的句柄整批作废：宿主只会回传最新一棵树上的句柄。
    this.handlers.clear();
    let count = 0;
    const register = (fn: (payload: unknown) => void): string => {
      const handlerId = `h${this.handlers.size + 1}`;
      this.handlers.set(handlerId, fn);
      return handlerId;
    };
    const root = definition.render();
    const counted = serialize(root, register);
    const walk = (node: { children?: unknown[] }): void => {
      count += 1;
      for (const child of node.children ?? []) walk(child as { children?: unknown[] });
    };
    walk(counted);
    if (count > maximumNodesPerRender) {
      throw new Error(`一次 render 提交了 ${count} 个节点，上限 ${maximumNodesPerRender}。`);
    }
    this.generation += 1;
    this.host.commit(JSON.stringify({ protocol: bridgeProtocolVersion, generation: this.generation, root: counted }));
  }

  private dispatch(json: string): void {
    const event = JSON.parse(json) as HostEvent;
    const definition = this.definition;
    switch (event.type) {
      case "activate": {
        this.active = true;
        void Promise.resolve(definition?.activate?.(event.context)).then(() => this.commit());
        return;
      }
      case "deactivate": {
        this.active = false;
        this.handlers.clear();
        void definition?.deactivate?.();
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

function requireHost(): HostBridge {
  const host = globalThis.__jarvisHost;
  if (!host) {
    throw new Error("找不到 __jarvisHost：这段代码只能在 Jarvis 的扩展运行时里执行。");
  }
  return host;
}

const runtime = new Runtime(requireHost());

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
  storage: namespaced("storage"),
  preferences: namespaced("preferences"),
  permissions: namespaced("permissions"),
  clipboard: namespaced("clipboard"),
  quickTransfer: namespaced("quickTransfer"),
  screenshot: namespaced("screenshot"),
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

/** 扩展里那个全局对象的实现。类型见 `capabilities.ts`。 */
export const jarvis: Jarvis = {
  sdk: { version: sdkVersion },
  host: sync.host("info"),
  environment: sync.host("environment"),
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
  },
};

export { ui };
