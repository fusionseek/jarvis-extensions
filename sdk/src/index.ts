/**
 * `@fusionseek/jarvis-extension-sdk` 的入口（SDK 2）。
 *
 * 一个扩展只做三件事：`defineExtension` 按域交出实现，用 `ui.*` 描述界面，用全局 `jarvis` 调宿主能力。
 * 其余（渲染、悬停光、授权、存储隔离、指令与快捷键注册、服务调度）全在宿主。
 *
 * 域与 `defineExtension` 的对应：
 *
 * | 域 | manifest | `defineExtension` |
 * |---|---|---|
 * | 工具箱 | `contributes.toolbox` | `toolbox`（面板里的页面）+ `popover`（原地结果弹窗，省略时画 `toolbox`） |
 * | 窗口 | `contributes.window` | `window`（工作区标签，省略时画 `toolbox`） |
 * | 指令 | `contributes.commands` | `commands` |
 * | 设置 | `contributes.settings` | —（宿主画控件，扩展读 `jarvis.preferences`） |
 * | 服务 | `contributes.services` | `services` |
 * | Git | `contributes.git` | —（宿主在 Git 里画入口；扩展经 `jarvis.git` 读写托管服务） |
 *
 * 能力按命名空间挂在 `jarvis` 上；Android 操作域（`jarvis.android`，SDK 2.4）不是域、不入驻任何东西，只是两项能力；
 * 本机应用（`jarvis.apps`，SDK 2.5）同样只是一项能力 `apps.read`。
 *
 * 悬浮球不是可入驻的域。
 */
import type { EnvironmentInfo, HostInfo, Jarvis, ProcessHandle, ProcessResult, ProcessRunOptions, Unsubscribe } from "./capabilities.js";
import { JarvisError } from "./capabilities.js";
import type { ActivationContext, CommandContext, HostEvent, InvokeResult, HostBridge, CommandSummary, ServiceCall, Surface } from "./bridge.js";
import { bridgeProtocolVersion, countNodes, serialize } from "./bridge.js";
import type { CancelSignal, CodeFormatEngine, CodeFormatRequest, ServiceContext, ServiceImplementation, JunkCleanEngine, LauncherAppsEngine, ProjectEngine, ProjectEngineRequest } from "./services.js";
import type { UINode } from "./ui.js";
import { maximumNodesPerRender, ui } from "./ui.js";
import { ocr } from "./ocr.js";

export * from "./manifest.js";
export * from "./ui.js";
export * from "./capabilities.js";
export * from "./services.js";
export * from "./ocr.js";
export type {
  ActivationContext,
  CommandContext,
  CommandSummary,
  CommandTrigger,
  HostEvent,
  SerializedNode,
  ServiceCall,
  Surface,
} from "./bridge.js";
export { bridgeProtocolVersion } from "./bridge.js";

/** SDK 版本。主版本必须与宿主运行时一致。 */
export const sdkVersion = "2.7.0";

/** 一面的实现：工具箱页面、原地弹窗或窗口标签。 */
export interface PageDefinition {
  /** 这一面 activate 时调用一次。拿到已授予的能力、当前偏好与命令清单。 */
  activate?(context: ActivationContext): void | Promise<void>;
  /** 每次需要重画时调用。必须是同步的、只读自己的状态。 */
  render(): UINode;
  /** 这一面离开时调用。 */
  deactivate?(): void | Promise<void>;
}

/** 一条命令的处理函数。`/` 指令带来的参数在 `context.argument`。 */
export type CommandHandler = (context: CommandContext) => void | Promise<void>;

/** 按域交出的实现。 */
export interface ExtensionDefinition {
  /** 工具箱域：面板里那一页。省略时 SDK 画一张列出全部命令的默认页。 */
  toolbox?: PageDefinition;
  /**
   * `presentation: "popover"` 的命令跑起来之后，宿主贴着选区弹出的那扇原地结果弹窗里画什么。
   * 省略时画 `toolbox`。弹窗 400 宽、按内容长高（最高 520），因此通常是页面的紧凑版。
   */
  popover?: PageDefinition;
  /** 窗口域：工作区标签里画什么。省略时画 `toolbox`；宽度不受 400 限制。 */
  window?: PageDefinition;
  /** 指令域：manifest `contributes.commands[]` 里每条命令的处理函数，按 id 对上。 */
  commands?: Record<string, CommandHandler>;
  /** 服务域：manifest `contributes.services[]` 里每个服务的实现，按服务 id 对上。 */
  services?: Record<string, ServiceImplementation>;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: JarvisError) => void };

/** 一次服务调用的取消信号。 */
class Cancellation implements CancelSignal {
  private listeners: (() => void)[] = [];
  private fired = false;

  get cancelled(): boolean {
    return this.fired;
  }

  onCancel(listener: () => void): void {
    if (this.fired) {
      listener();
      return;
    }
    this.listeners.push(listener);
  }

  cancel(): void {
    if (this.fired) return;
    this.fired = true;
    const listeners = this.listeners;
    this.listeners = [];
    for (const listener of listeners) listener();
  }
}

/**
 * 运行时。**一个 JSContext 里只有一份**：`defineExtension` 第二次调用会抛错，因为宿主只认一个入口。
 *
 * 同一份 bundle 会被装进两种会话：前台（有界面）与后台（服务、静默命令）。运行时不需要知道自己在哪一种——
 * 后台会话里宿主永远不发 `activate`，`render` 也就永远不会被调。
 *
 * 宿主全局 `__jarvisHost` 是**延迟绑定**的：模块加载时不碰它，第一次真的要调宿主时才找。
 * 因此这个 bundle 可以在 node 里被 `import`（配合 `testing.ts` 的替身跑单测）。
 */
class Runtime {
  private definition: ExtensionDefinition | null = null;
  private nextRequestId = 1;
  private generation = 0;
  private pending = new Map<number, Pending>();
  private handlers = new Map<string, (payload: unknown) => void>();
  private subscriptions = new Map<string, (payload: unknown) => void>();
  private serviceSignals = new Map<number, Cancellation>();
  private updateQueued = false;
  /** 此刻开着的那一面；`null` = 一面都没有，`render()` 不会被调。 */
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

  /** 把 `dispatch` 挂到全局。幂等。 */
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

  /** 让宿主再调一次 render。同一拍里的多次请求合并成一次提交；一面都没开着时是空操作。 */
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

  /** 新的订阅 token。 */
  token(namespace: string, method: string): string {
    return `${namespace}.${method}#${this.nextRequestId++}`;
  }

  /** 收这个 token 上的订阅事件。 */
  listen(token: string, listener: (payload: unknown) => void): void {
    this.subscriptions.set(token, listener);
  }

  /** 不再收这个 token 上的事件。 */
  forget(token: string): void {
    this.subscriptions.delete(token);
  }

  /**
   * 订阅宿主事件。宿主拒绝订阅（没授权、没这个能力）时**不抛到扩展里**：一条被拒的订阅只是收不到事件，
   * 让它变成未处理的 rejection 会把整个上下文拖垮。拒绝记一条 warn 日志。
   */
  subscribe(namespace: string, method: string, listener: (payload: unknown) => void): Unsubscribe {
    const token = this.token(namespace, method);
    this.listen(token, listener);
    this.invoke(namespace, method, { token }).catch((error: unknown) => {
      this.forget(token);
      this.log("warn", `订阅 ${namespace}.${method} 被宿主拒绝`, error instanceof Error ? error.message : String(error));
    });
    return () => {
      this.forget(token);
      this.invoke(namespace, "unsubscribe", { token }).catch(() => undefined);
    };
  }

  log(level: string, message: string, data: unknown): void {
    this.host().log(level, message, data === undefined ? null : JSON.stringify(data));
  }

  /** 开着的那一面的定义：弹窗与窗口没给时退回工具箱页面。 */
  private surfaceDefinition(surface: Surface | null): PageDefinition | undefined {
    const definition = this.definition;
    if (surface === "popover" && definition?.popover) return definition.popover;
    if (surface === "window" && definition?.window) return definition.window;
    return definition?.toolbox;
  }

  /** 此刻那一面的树：自定义的那一面，或按命令清单画的默认页。 */
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
                  subtitle: command.hotkey
                    ? `快捷键 ${command.hotkey}`
                    : command.slash
                      ? `指令 ${command.slash}`
                      : (command.description ?? "在这里运行"),
                  onPress: () => void jarvis.commands.run(command.id),
                }),
              )
            : [ui.empty({ symbol: "bolt.slash", title: "这个扩展没有命令", hint: "它既没有页面也没有命令。" })],
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

  /** 宿主调一次服务。结果与进度都经隐式调用交回去；这里不抛任何东西。 */
  private handleService(call: ServiceCall): void {
    const implementation = this.definition?.services?.[call.service];
    const respond = (result: InvokeResult) => {
      this.serviceSignals.delete(call.callId);
      this.invoke("service", "resolve", { callId: call.callId, result }).catch(() => undefined);
    };
    if (!implementation) {
      respond({ ok: false, error: { code: "capability.unknown", message: `defineExtension 里没有服务「${call.service}」的实现。` } });
      return;
    }
    const context: ServiceContext = { preferences: call.params.preferences, granted: call.params.granted };
    const signal = new Cancellation();
    this.serviceSignals.set(call.callId, signal);
    const work = (): Promise<unknown> => {
      switch (call.point) {
        case "junkClean.engine": {
          const engine = implementation as JunkCleanEngine;
          switch (call.method) {
            case "status":
              return Promise.resolve(engine.status(context));
            case "run":
              return engine.run(
                context,
                (progress) => {
                  if (signal.cancelled) return;
                  this.invoke("service", "progress", { callId: call.callId, progress }).catch(() => undefined);
                },
                signal,
              );
            case "action":
              return Promise.resolve(engine.action ? engine.action(call.params.actionId ?? "", context) : {});
          }
          break;
        }
        case "project.engine": {
          const engine = implementation as ProjectEngine;
          // 入参的形状由宿主按 bridge schema 保证；SDK 只转交，不替引擎判断哪几项该在。
          const request = (call.params.request ?? {}) as ProjectEngineRequest;
          switch (call.method) {
            case "describe":
              return Promise.resolve(engine.describe(context));
            case "listProjects":
              return engine.listProjects(request, context, signal);
            case "readSchema":
              return engine.readSchema(request as Parameters<ProjectEngine["readSchema"]>[0], context, signal);
            case "readItems":
              return engine.readItems(request as Parameters<ProjectEngine["readItems"]>[0], context, signal);
            case "applyEdit":
              return engine.applyEdit(request as Parameters<ProjectEngine["applyEdit"]>[0], context, signal);
            case "createField":
              if (!engine.createField) break;
              return engine.createField(request as Parameters<NonNullable<ProjectEngine["createField"]>>[0], context, signal);
            case "createOption":
              if (!engine.createOption) break;
              return engine.createOption(request as Parameters<NonNullable<ProjectEngine["createOption"]>>[0], context, signal);
            case "createIteration":
              if (!engine.createIteration) break;
              return engine.createIteration(request as Parameters<NonNullable<ProjectEngine["createIteration"]>>[0], context, signal);
            case "createItem":
              if (!engine.createItem) break;
              return engine.createItem(request as Parameters<NonNullable<ProjectEngine["createItem"]>>[0], context, signal);
          }
          break;
        }
        case "launcher.apps": {
          // 全局搜索的应用目录（SDK 2.5）：只有 catalog，不带入参。
          const engine = implementation as LauncherAppsEngine;
          if (call.method === "catalog") return Promise.resolve(engine.catalog(context));
          break;
        }
        case "code.format": {
          // Git 的代码格式化（SDK 2.7）：describe 不带入参，format 的入参在 params.request（形状由宿主按 bridge schema 保证）。
          const engine = implementation as CodeFormatEngine;
          if (call.method === "describe") return Promise.resolve(engine.describe(context));
          if (call.method === "format") return engine.format(call.params.request as CodeFormatRequest, context, signal);
          break;
        }
      }
      return Promise.reject(new JarvisError({ code: "capability.unknown", message: `不认识的服务方法 ${call.point}.${call.method}` }));
    };
    let pending: Promise<unknown>;
    try {
      pending = work();
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (value) => respond({ ok: true, value: value ?? {} }),
      (error: unknown) => {
        const shape =
          error instanceof JarvisError
            ? { code: error.code, message: error.message, ...(error.detail !== undefined ? { detail: error.detail } : {}) }
            : { code: "host.failure" as const, message: error instanceof Error ? error.message : String(error) };
        this.log("error", `服务「${call.service}」的 ${call.method} 抛出了异常`, shape.message);
        respond({ ok: false, error: shape });
      },
    );
  }

  private dispatch(json: string): void {
    const event = JSON.parse(json) as HostEvent;
    const definition = this.definition;
    switch (event.type) {
      case "activate": {
        const surface = event.context.surface;
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
      case "service": {
        this.handleService(event.call);
        return;
      }
      case "serviceCancel": {
        this.serviceSignals.get(event.callId)?.cancel();
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
  window: namespaced("window"),
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
  net: namespaced("net"),
  process: namespaced("process"),
  files: namespaced("files"),
  terminal: namespaced("terminal"),
  git: namespaced("git"),
  android: namespaced("android"),
  apps: namespaced("apps"),
  system: namespaced("system"),
};

const sync = {
  text: syncNamespaced("text"),
  host: syncNamespaced("host"),
};

/**
 * `process.run`：标准输出经订阅逐批推过来（`{ lines: string[] }`），进程结束时那次调用兑现。
 * 宿主保证**所有输出先于结果**到达——这条线上的事件按顺序进同一条队列。
 */
function runProcess(options: ProcessRunOptions): ProcessHandle {
  const token = runtime.token("process", "run");
  runtime.listen(token, (payload) => {
    const lines = (payload as { lines?: string[] }).lines ?? [];
    for (const line of lines) options.onLine?.(line);
  });
  // SDK 2.7 的三个选项只在给了的时候上线缆：没给就与 2.6 的请求一字不差。
  const params: Record<string, unknown> = { executable: options.executable, arguments: options.arguments, token };
  if (options.stdin !== undefined) params.stdin = options.stdin;
  if (options.directory !== undefined) params.directory = options.directory;
  if (options.output !== undefined) params.output = options.output;
  const result = runtime
    .invoke<ProcessResult>("process", "run", params)
    .finally(() => runtime.forget(token));
  let cancelled = false;
  return {
    result,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      call.process("cancel", { token }).catch(() => undefined);
    },
  };
}

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
    dismissPopover: () => runtime.invoke<void>("ui", "dismissPopover", {}),
  },
  panel: {
    hold(reason) {
      let released = false;
      const id = runtime.invoke<string>("panel", "hold", { reason });
      // 后台会话里 hold 会被拒（surface.unavailable）：那里没有面板可摁，拒了就当没摁。
      id.catch(() => undefined);
      return {
        release() {
          if (released) return;
          released = true;
          void id.then((handle) => call.panel("release", { handle })).catch(() => undefined);
        },
      };
    },
    collapse: () => call.panel("collapse"),
    present: () => call.panel("present"),
  },
  window: {
    open: () => call.window("open"),
  },
  commands: {
    run: (id, argument) => call.commands("run", argument === undefined ? { id } : { id, argument }),
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
    language: {
      detect: (text, options) => sync.text("language.detect", { text, ...options }),
      displayName: (code) => sync.text("language.displayName", { code }),
    },
  },
  clipboard: {
    read: () => call.clipboard("read"),
    readImage: () => call.clipboard("readImage"),
    write: (text) => call.clipboard("write", { text }),
  },
  quickTransfer: {
    status: () => call.quickTransfer("status"),
    observe: (listener) => runtime.subscribe("quickTransfer", "observe", listener as (payload: unknown) => void),
    start: () => call.quickTransfer("start"),
    stop: () => call.quickTransfer("stop"),
    sendText: (text) => call.quickTransfer("sendText", { text }),
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
    post: (message) => call.inbox("post", message),
  },
  net: {
    fetch: (url, init) => call.net("fetch", { url, ...init }),
  },
  process: {
    locate: (executable) => call.process("locate", { executable }),
    run: runProcess,
  },
  files: {
    stat: (path) => call.files("stat", { path }),
    tail: (path, offset) => call.files("tail", { path, offset }),
  },
  terminal: {
    run: (scriptId) => call.terminal("run", { id: scriptId }),
  },
  git: {
    repositories: () => call.git("repositories"),
    hosting: {
      viewer: (options) => call.git("hosting.viewer", options ?? {}),
      query: (request) => call.git("hosting.query", request),
      mutate: (request) => call.git("hosting.mutate", request),
    },
  },
  // Android 操作域（SDK 2.4）：参数原样上线缆，校验（1…8 个包、设备是否 ready）在宿主那一侧。
  android: {
    devices: () => call.android("devices"),
    apps: (options) => call.android("apps", options),
    appDetails: (options) => call.android("appDetails", options),
    openTool: (options) => call.android("openTool", options),
  },
  // 本机应用（SDK 2.5）：不收参数，扫哪几处由宿主定。
  apps: {
    list: () => call.apps("list"),
  },
  system: {
    openURL: (url) => call.system("openURL", { url }),
    openExtensionSettings: () => call.system("openExtensionSettings"),
  },
};

/**
 * 等一会儿。
 *
 * **宿主的 JavaScript 环境里有 `setTimeout`，但没有 `setInterval`**：没有哪个扩展需要一个
 * 自己不会停的循环，而一个忘记 clear 的 interval 会在面板关掉之后继续醒着。
 *
 * 会话结束时宿主会把还没到点的定时器全部取消，因此这个 Promise 有可能**永远不 resolve**——
 * 那正是想要的：会话已经没了，接着往下跑的那段代码没有任何人在等它的结果。
 *
 * 上限由宿主定：单次 30s、同时挂起 64 个。超出时那一次调用被丢掉并记一条 warn。
 *
 * @param milliseconds 等多久。负数、NaN 与 Infinity 一律当 0（与浏览器一致，含义是"尽快"）。
 */
export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export { ui, ocr };
