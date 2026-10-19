// jarvis-extension bundle · android-apps@1.0.1 · sdk 2.5.0 · 由 scripts/build-extension.mjs 生成，请勿手改
"use strict";
(() => {
  // sdk/src/capabilities.ts
  var JarvisError = class extends Error {
    constructor(shape) {
      super(shape.message);
      this.name = "JarvisError";
      this.code = shape.code;
      this.detail = shape.detail;
    }
  };
  var maximumAndroidAppDetailsPerCall = 8;

  // sdk/src/bridge.ts
  var bridgeProtocolVersion = 2;
  function eventName(propName) {
    return propName.length > 2 && propName.startsWith("on") ? propName[2].toLowerCase() + propName.slice(3) : propName;
  }
  function serialize(root, register) {
    const walk = (node) => {
      const props = {};
      const on = {};
      let children;
      for (const [name, value] of Object.entries(node)) {
        if (name === "kind" || name === "key") continue;
        if (name === "children" && Array.isArray(value)) {
          children = value.map(walk);
          continue;
        }
        if (typeof value === "function") {
          on[eventName(name)] = register(value);
          continue;
        }
        if (name === "actions" && Array.isArray(value)) {
          props[name] = value.map((action) => {
            const { onPress, ...rest } = action;
            return { ...rest, on: { press: register(onPress) } };
          });
          continue;
        }
        if (name === "action" && value && typeof value === "object" && "onPress" in value) {
          const { onPress, ...rest } = value;
          props[name] = { ...rest, on: { press: register(onPress) } };
          continue;
        }
        if ((name === "hoverCard" || name === "emptyState") && value && typeof value === "object") {
          props[name] = walk(value);
          continue;
        }
        props[name] = value;
      }
      const out = { kind: node.kind, props };
      if (node.key !== void 0) out.key = node.key;
      if (Object.keys(on).length > 0) out.on = on;
      if (children) out.children = children;
      return out;
    };
    return walk(root);
  }
  function countNodes(node) {
    let count = 1;
    for (const child of node.children ?? []) count += countNodes(child);
    for (const name of ["hoverCard", "emptyState"]) {
      const nested = node.props[name];
      if (nested && typeof nested === "object" && "kind" in nested) count += countNodes(nested);
    }
    return count;
  }

  // sdk/src/ui.ts
  var maximumNodesPerRender = 500;
  function make(kind) {
    return (props) => ({ kind, ...props });
  }
  var ui = {
    stack: make("stack"),
    scroll: make("scroll"),
    section: make("section"),
    hairline: () => ({ kind: "hairline" }),
    spacer: () => ({ kind: "spacer" }),
    text: make("text"),
    row: make("row"),
    readout: make("readout"),
    field: make("field"),
    editor: make("editor"),
    search: make("search"),
    segmented: make("segmented"),
    toggle: make("toggle"),
    chip: make("chip"),
    picker: make("picker"),
    button: make("button"),
    iconButton: make("iconButton"),
    copy: make("copy"),
    result: make("result"),
    progress: make("progress"),
    badge: make("badge"),
    note: make("note"),
    empty: make("empty"),
    list: make("list"),
    card: make("card"),
    symbol: make("symbol"),
    qrcode: make("qrcode"),
    swatch: make("swatch"),
    dropzone: make("dropzone"),
    keycap: make("keycap"),
    image: make("image")
  };

  // sdk/src/index.ts
  var sdkVersion = "2.5.0";
  var Cancellation = class {
    constructor() {
      this.listeners = [];
      this.fired = false;
    }
    get cancelled() {
      return this.fired;
    }
    onCancel(listener) {
      if (this.fired) {
        listener();
        return;
      }
      this.listeners.push(listener);
    }
    cancel() {
      if (this.fired) return;
      this.fired = true;
      const listeners = this.listeners;
      this.listeners = [];
      for (const listener of listeners) listener();
    }
  };
  var Runtime = class {
    constructor() {
      this.definition = null;
      this.nextRequestId = 1;
      this.generation = 0;
      this.pending = /* @__PURE__ */ new Map();
      this.handlers = /* @__PURE__ */ new Map();
      this.subscriptions = /* @__PURE__ */ new Map();
      this.serviceSignals = /* @__PURE__ */ new Map();
      this.updateQueued = false;
      /** 此刻开着的那一面；`null` = 一面都没有，`render()` 不会被调。 */
      this.activeSurface = null;
      this.commandSummaries = [];
      this.hostRef = null;
      this.registered = false;
    }
    host() {
      if (this.hostRef) return this.hostRef;
      const host = globalThis.__jarvisHost;
      if (!host) {
        throw new Error("\u627E\u4E0D\u5230 __jarvisHost\uFF1A\u8FD9\u6BB5\u4EE3\u7801\u53EA\u80FD\u5728 Jarvis \u7684\u6269\u5C55\u8FD0\u884C\u65F6\u91CC\u6267\u884C\uFF08\u5355\u6D4B\u8BF7\u5148 createTestHost()\uFF09\u3002");
      }
      this.hostRef = host;
      return host;
    }
    /** 把 `dispatch` 挂到全局。幂等。 */
    ensureRegistered() {
      if (this.registered) return;
      globalThis.__jarvisRuntime = { dispatch: (json) => this.dispatch(json) };
      this.registered = true;
    }
    define(definition) {
      if (this.definition) {
        throw new Error("defineExtension() \u53EA\u80FD\u8C03\u7528\u4E00\u6B21\uFF1A\u5BBF\u4E3B\u53EA\u8BA4\u4E00\u4E2A\u5165\u53E3\u3002");
      }
      this.definition = definition;
      this.ensureRegistered();
    }
    /** 让宿主再调一次 render。同一拍里的多次请求合并成一次提交；一面都没开着时是空操作。 */
    requestUpdate() {
      if (this.updateQueued || !this.activeSurface) return;
      this.updateQueued = true;
      Promise.resolve().then(() => {
        this.updateQueued = false;
        this.commit();
      });
    }
    invoke(namespace, method, params) {
      this.ensureRegistered();
      const id = this.nextRequestId++;
      const request = { protocol: bridgeProtocolVersion, id, namespace, method, params };
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.host().invoke(JSON.stringify(request));
      });
    }
    invokeSync(namespace, method, params) {
      const request = { protocol: bridgeProtocolVersion, id: 0, namespace, method, params };
      const result = JSON.parse(this.host().invokeSync(JSON.stringify(request)));
      if (result.ok) return result.value;
      throw new JarvisError(result.error);
    }
    /** 新的订阅 token。 */
    token(namespace, method) {
      return `${namespace}.${method}#${this.nextRequestId++}`;
    }
    /** 收这个 token 上的订阅事件。 */
    listen(token, listener) {
      this.subscriptions.set(token, listener);
    }
    /** 不再收这个 token 上的事件。 */
    forget(token) {
      this.subscriptions.delete(token);
    }
    /**
     * 订阅宿主事件。宿主拒绝订阅（没授权、没这个能力）时**不抛到扩展里**：一条被拒的订阅只是收不到事件，
     * 让它变成未处理的 rejection 会把整个上下文拖垮。拒绝记一条 warn 日志。
     */
    subscribe(namespace, method, listener) {
      const token = this.token(namespace, method);
      this.listen(token, listener);
      this.invoke(namespace, method, { token }).catch((error) => {
        this.forget(token);
        this.log("warn", `\u8BA2\u9605 ${namespace}.${method} \u88AB\u5BBF\u4E3B\u62D2\u7EDD`, error instanceof Error ? error.message : String(error));
      });
      return () => {
        this.forget(token);
        this.invoke(namespace, "unsubscribe", { token }).catch(() => void 0);
      };
    }
    log(level, message, data) {
      this.host().log(level, message, data === void 0 ? null : JSON.stringify(data));
    }
    /** 开着的那一面的定义：弹窗与窗口没给时退回工具箱页面。 */
    surfaceDefinition(surface) {
      const definition = this.definition;
      if (surface === "popover" && definition?.popover) return definition.popover;
      if (surface === "window" && definition?.window) return definition.window;
      return definition?.toolbox;
    }
    /** 此刻那一面的树：自定义的那一面，或按命令清单画的默认页。 */
    renderSurface() {
      const page2 = this.surfaceDefinition(this.activeSurface);
      if (page2) return page2.render();
      return ui.scroll({
        children: [
          ui.section({
            title: "\u547D\u4EE4 \xB7 COMMANDS",
            children: this.commandSummaries.length ? this.commandSummaries.map(
              (command) => ui.row({
                key: command.id,
                symbol: command.presentation === "silent" ? "bolt" : "rectangle.and.text.magnifyingglass",
                title: command.title,
                subtitle: command.hotkey ? `\u5FEB\u6377\u952E ${command.hotkey}` : command.slash ? `\u6307\u4EE4 ${command.slash}` : command.description ?? "\u5728\u8FD9\u91CC\u8FD0\u884C",
                onPress: () => void jarvis.commands.run(command.id)
              })
            ) : [ui.empty({ symbol: "bolt.slash", title: "\u8FD9\u4E2A\u6269\u5C55\u6CA1\u6709\u547D\u4EE4", hint: "\u5B83\u65E2\u6CA1\u6709\u9875\u9762\u4E5F\u6CA1\u6709\u547D\u4EE4\u3002" })]
          })
        ]
      });
    }
    commit() {
      const surface = this.activeSurface;
      if (!this.definition || !surface) return;
      this.handlers.clear();
      const register = (fn) => {
        const handlerId = `h${this.handlers.size + 1}`;
        this.handlers.set(handlerId, fn);
        return handlerId;
      };
      const root = serialize(this.renderSurface(), register);
      const count = countNodes(root);
      if (count > maximumNodesPerRender) {
        throw new Error(`\u4E00\u6B21 render \u63D0\u4EA4\u4E86 ${count} \u4E2A\u8282\u70B9\uFF0C\u4E0A\u9650 ${maximumNodesPerRender}\u3002`);
      }
      this.generation += 1;
      this.host().commit(JSON.stringify({ protocol: bridgeProtocolVersion, generation: this.generation, surface, root }));
    }
    /** 宿主调一次服务。结果与进度都经隐式调用交回去；这里不抛任何东西。 */
    handleService(call2) {
      const implementation = this.definition?.services?.[call2.service];
      const respond = (result) => {
        this.serviceSignals.delete(call2.callId);
        this.invoke("service", "resolve", { callId: call2.callId, result }).catch(() => void 0);
      };
      if (!implementation) {
        respond({ ok: false, error: { code: "capability.unknown", message: `defineExtension \u91CC\u6CA1\u6709\u670D\u52A1\u300C${call2.service}\u300D\u7684\u5B9E\u73B0\u3002` } });
        return;
      }
      const context = { preferences: call2.params.preferences, granted: call2.params.granted };
      const signal = new Cancellation();
      this.serviceSignals.set(call2.callId, signal);
      const work = () => {
        switch (call2.point) {
          case "junkClean.engine": {
            const engine = implementation;
            switch (call2.method) {
              case "status":
                return Promise.resolve(engine.status(context));
              case "run":
                return engine.run(
                  context,
                  (progress) => {
                    if (signal.cancelled) return;
                    this.invoke("service", "progress", { callId: call2.callId, progress }).catch(() => void 0);
                  },
                  signal
                );
              case "action":
                return Promise.resolve(engine.action ? engine.action(call2.params.actionId ?? "", context) : {});
            }
            break;
          }
          case "project.engine": {
            const engine = implementation;
            const request = call2.params.request ?? {};
            switch (call2.method) {
              case "describe":
                return Promise.resolve(engine.describe(context));
              case "listProjects":
                return engine.listProjects(request, context, signal);
              case "readSchema":
                return engine.readSchema(request, context, signal);
              case "readItems":
                return engine.readItems(request, context, signal);
              case "applyEdit":
                return engine.applyEdit(request, context, signal);
              case "createField":
                if (!engine.createField) break;
                return engine.createField(request, context, signal);
              case "createOption":
                if (!engine.createOption) break;
                return engine.createOption(request, context, signal);
              case "createIteration":
                if (!engine.createIteration) break;
                return engine.createIteration(request, context, signal);
              case "createItem":
                if (!engine.createItem) break;
                return engine.createItem(request, context, signal);
            }
            break;
          }
          case "launcher.apps": {
            const engine = implementation;
            if (call2.method === "catalog") return Promise.resolve(engine.catalog(context));
            break;
          }
        }
        return Promise.reject(new JarvisError({ code: "capability.unknown", message: `\u4E0D\u8BA4\u8BC6\u7684\u670D\u52A1\u65B9\u6CD5 ${call2.point}.${call2.method}` }));
      };
      let pending;
      try {
        pending = work();
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(
        (value) => respond({ ok: true, value: value ?? {} }),
        (error) => {
          const shape = error instanceof JarvisError ? { code: error.code, message: error.message, ...error.detail !== void 0 ? { detail: error.detail } : {} } : { code: "host.failure", message: error instanceof Error ? error.message : String(error) };
          this.log("error", `\u670D\u52A1\u300C${call2.service}\u300D\u7684 ${call2.method} \u629B\u51FA\u4E86\u5F02\u5E38`, shape.message);
          respond({ ok: false, error: shape });
        }
      );
    }
    dispatch(json) {
      const event = JSON.parse(json);
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
          this.requestUpdate();
          return;
        }
        case "command": {
          const handler = definition?.commands?.[event.context.id];
          if (!handler) {
            this.log("error", `manifest \u58F0\u660E\u4E86\u547D\u4EE4\u300C${event.context.id}\u300D\uFF0C\u4F46 defineExtension \u91CC\u6CA1\u6709\u5B83\u7684\u5904\u7406\u51FD\u6570\u3002`, void 0);
            return;
          }
          void Promise.resolve(handler(event.context)).then(
            () => this.requestUpdate(),
            (error) => this.log("error", `\u547D\u4EE4\u300C${event.context.id}\u300D\u629B\u51FA\u4E86\u5F02\u5E38`, error instanceof Error ? error.message : String(error))
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
  };
  var runtime = new Runtime();
  function defineExtension(definition) {
    runtime.define(definition);
  }
  function namespaced(namespace) {
    return (method, params) => runtime.invoke(namespace, method, params ?? {});
  }
  function syncNamespaced(namespace) {
    return (method, params) => runtime.invokeSync(namespace, method, params ?? {});
  }
  var call = {
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
    system: namespaced("system")
  };
  var sync = {
    text: syncNamespaced("text"),
    host: syncNamespaced("host")
  };
  function runProcess(options) {
    const token = runtime.token("process", "run");
    runtime.listen(token, (payload) => {
      const lines = payload.lines ?? [];
      for (const line of lines) options.onLine?.(line);
    });
    const result = runtime.invoke("process", "run", { executable: options.executable, arguments: options.arguments, token }).finally(() => runtime.forget(token));
    let cancelled = false;
    return {
      result,
      cancel() {
        if (cancelled) return;
        cancelled = true;
        call.process("cancel", { token }).catch(() => void 0);
      }
    };
  }
  var jarvis = {
    sdk: { version: sdkVersion },
    get host() {
      return sync.host("info");
    },
    get environment() {
      return sync.host("environment");
    },
    ui: {
      update: () => runtime.requestUpdate(),
      dismissPopover: () => runtime.invoke("ui", "dismissPopover", {})
    },
    panel: {
      hold(reason) {
        let released = false;
        const id = runtime.invoke("panel", "hold", { reason });
        id.catch(() => void 0);
        return {
          release() {
            if (released) return;
            released = true;
            void id.then((handle) => call.panel("release", { handle })).catch(() => void 0);
          }
        };
      },
      collapse: () => call.panel("collapse"),
      present: () => call.panel("present")
    },
    window: {
      open: () => call.window("open")
    },
    commands: {
      run: (id, argument) => call.commands("run", argument === void 0 ? { id } : { id, argument })
    },
    storage: {
      get: (key) => call.storage("get", { key }),
      set: (key, value) => call.storage("set", { key, value }),
      delete: (key) => call.storage("delete", { key }),
      keys: () => call.storage("keys")
    },
    preferences: {
      get: (key) => call.preferences("get", { key }),
      all: () => call.preferences("all"),
      onChange: (listener) => runtime.subscribe("preferences", "observe", listener)
    },
    permissions: {
      granted: () => call.permissions("granted"),
      request: (ids) => call.permissions("request", { ids }),
      openSystemSettings: (kind) => call.permissions("openSystemSettings", { kind })
    },
    log: {
      debug: (message, data) => runtime.log("debug", message, data),
      info: (message, data) => runtime.log("info", message, data),
      warn: (message, data) => runtime.log("warn", message, data),
      error: (message, data) => runtime.log("error", message, data)
    },
    text: {
      base64: {
        encode: (text, options) => sync.text("base64.encode", { text, ...options }),
        decode: (text, options) => sync.text("base64.decode", { text, ...options })
      },
      hash: {
        digest: (algorithm, text, options) => sync.text("hash.digest", { algorithm, text, ...options })
      },
      language: {
        detect: (text, options) => sync.text("language.detect", { text, ...options }),
        displayName: (code) => sync.text("language.displayName", { code })
      }
    },
    clipboard: {
      read: () => call.clipboard("read"),
      readImage: () => call.clipboard("readImage"),
      write: (text) => call.clipboard("write", { text })
    },
    quickTransfer: {
      status: () => call.quickTransfer("status"),
      observe: (listener) => runtime.subscribe("quickTransfer", "observe", listener),
      start: () => call.quickTransfer("start"),
      stop: () => call.quickTransfer("stop"),
      sendText: (text) => call.quickTransfer("sendText", { text })
    },
    screenshot: {
      capture: (options) => call.screenshot("capture", options)
    },
    ocr: {
      recognize: (file, options) => call.ocr("recognize", { file, ...options })
    },
    speech: {
      speak: (text, options) => call.speech("speak", { text, ...options }),
      stop: () => call.speech("stop")
    },
    notifications: {
      post: (content) => call.notifications("post", content)
    },
    inbox: {
      post: (message) => call.inbox("post", message)
    },
    net: {
      fetch: (url, init) => call.net("fetch", { url, ...init })
    },
    process: {
      locate: (executable) => call.process("locate", { executable }),
      run: runProcess
    },
    files: {
      stat: (path) => call.files("stat", { path }),
      tail: (path, offset) => call.files("tail", { path, offset })
    },
    terminal: {
      run: (scriptId) => call.terminal("run", { id: scriptId })
    },
    git: {
      repositories: () => call.git("repositories"),
      hosting: {
        viewer: (options) => call.git("hosting.viewer", options ?? {}),
        query: (request) => call.git("hosting.query", request),
        mutate: (request) => call.git("hosting.mutate", request)
      }
    },
    // Android 操作域（SDK 2.4）：参数原样上线缆，校验（1…8 个包、设备是否 ready）在宿主那一侧。
    android: {
      devices: () => call.android("devices"),
      apps: (options) => call.android("apps", options),
      appDetails: (options) => call.android("appDetails", options),
      openTool: (options) => call.android("openTool", options)
    },
    // 本机应用（SDK 2.5）：不收参数，扫哪几处由宿主定。
    apps: {
      list: () => call.apps("list")
    },
    system: {
      openURL: (url) => call.system("openURL", { url }),
      openExtensionSettings: () => call.system("openExtensionSettings")
    }
  };
  function sleep(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  // extensions/android-apps/src/model.ts
  var pageSize = 40;
  var maximumRows = 400;
  var units = ["B", "KB", "MB", "GB", "TB"];
  function formatBytes(bytes) {
    const total = Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0;
    if (total < 1e3) return `${total} B`;
    let value = total;
    let unit = 0;
    while (value >= 1e3 && unit < units.length - 1) {
      value /= 1e3;
      unit += 1;
    }
    if (value >= 999.5 && unit < units.length - 1) {
      value /= 1e3;
      unit += 1;
    }
    const text = value < 99.95 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(0);
    return `${text} ${units[unit]}`;
  }
  function totalBytes(app) {
    const parts = [app.apkBytes, app.dataBytes, app.cacheBytes].filter((part) => part !== null);
    return parts.length === 0 ? null : parts.reduce((sum, part) => sum + part, 0);
  }
  function sizeLine(app) {
    const total = totalBytes(app);
    if (total === null) return "\u5927\u5C0F\u8BFB\u4E0D\u51FA";
    if (app.apkBytes !== null && app.dataBytes !== null) {
      const data = app.dataBytes + (app.cacheBytes ?? 0);
      return `${formatBytes(total)} \xB7 \u5B89\u88C5\u5305 ${formatBytes(app.apkBytes)} / \u6570\u636E ${formatBytes(data)}`;
    }
    return formatBytes(total);
  }
  function displayName(app, detail) {
    const label = detail?.label?.trim();
    return label ? label : app.package;
  }
  function rowSubtitle(app, detail, scope) {
    const parts = [];
    if (scope === "all" && app.system) parts.push("\u7CFB\u7EDF");
    if (displayName(app, detail) !== app.package) parts.push(app.package);
    parts.push(sizeLine(app));
    return parts.join(" \xB7 ");
  }
  function matchesQuery(app, detail, query) {
    const needle = query.trim().toLowerCase();
    if (needle === "") return true;
    if (app.package.toLowerCase().includes(needle)) return true;
    return (detail?.label ?? "").toLowerCase().includes(needle);
  }
  var collator = null;
  function compareNames(a, b) {
    collator ?? (collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" }));
    return collator.compare(a, b);
  }
  function sortApps(apps, order, detailOf) {
    const byName = (a, b) => compareNames(displayName(a, detailOf(a.package)), displayName(b, detailOf(b.package))) || compareNames(a.package, b.package);
    if (order === "name") return [...apps].sort(byName);
    return [...apps].sort((a, b) => {
      const x = totalBytes(a);
      const y = totalBytes(b);
      if (x === null && y === null) return byName(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x || byName(a, b);
    });
  }
  function summarize(apps) {
    let bytes = 0;
    let unknown = 0;
    for (const app of apps) {
      const total = totalBytes(app);
      if (total === null) unknown += 1;
      else bytes += total;
    }
    return { count: apps.length, bytes, unknown };
  }
  function summaryLine(matched, all, searching) {
    const head = searching ? `\u5339\u914D ${matched.count} / ${all.count}` : `${all.count} \u4E2A\u5E94\u7528`;
    return `${head} \xB7 \u5171 ${formatBytes(searching ? matched.bytes : all.bytes)}`;
  }
  function rowsToRender(available, visibleCount) {
    return Math.max(0, Math.min(available, visibleCount, maximumRows));
  }
  function canLoadMore(available, visibleCount) {
    return visibleCount < Math.min(available, maximumRows);
  }
  function nextVisibleCount(visibleCount) {
    return Math.min(visibleCount + pageSize, maximumRows);
  }
  function nextDetailsBatch(packages, isKnown, limit) {
    const batch = [];
    const seen = /* @__PURE__ */ new Set();
    for (const name of packages) {
      if (batch.length >= limit) break;
      if (seen.has(name)) continue;
      seen.add(name);
      if (!isKnown(name)) batch.push(name);
    }
    return batch;
  }
  function isCacheFresh(entry, app) {
    return entry.apkBytes === app.apkBytes;
  }
  function chooseSerial(devices, current) {
    const ready = devices.filter((device) => device.ready);
    if (current !== null && ready.some((device) => device.serial === current)) return current;
    return ready[0]?.serial ?? null;
  }
  function deviceIssue(device) {
    switch (device.state) {
      case "unauthorized":
        return { title: `${device.name} \u8FD8\u6CA1\u5141\u8BB8\u8FD9\u53F0\u7535\u8111\u8C03\u8BD5`, hint: "\u5728\u624B\u673A\u4E0A\u70B9\u300C\u5141\u8BB8 USB \u8C03\u8BD5\u300D\uFF0C\u518D\u70B9\u91CD\u65B0\u626B\u63CF" };
      case "offline":
        return { title: `${device.name} \u79BB\u7EBF`, hint: "\u91CD\u65B0\u63D2\u4E00\u6B21 USB \u7EBF\uFF0C\u6216\u5728\u624B\u673A\u4E0A\u5173\u6389\u518D\u6253\u5F00 USB \u8C03\u8BD5\uFF0C\u518D\u70B9\u91CD\u65B0\u626B\u63CF" };
      default:
        return { title: `${device.name} \u6B64\u523B\u8BFB\u4E0D\u4E86\u5E94\u7528`, hint: "\u5B83\u4E0D\u5728\u6B63\u5E38\u5F00\u673A\u7684\u7CFB\u7EDF\u91CC\uFF08recovery\u3001sideload \u4E4B\u7C7B\uFF09\uFF1B\u5F00\u673A\u8FDB\u7CFB\u7EDF\u540E\u518D\u70B9\u91CD\u65B0\u626B\u63CF" };
    }
  }
  function describeError(error, fallback) {
    const shape = error ?? {};
    const code = typeof shape.code === "string" ? shape.code : void 0;
    const detail = typeof shape.detail === "string" && shape.detail.trim() !== "" ? shape.detail : void 0;
    const message = typeof shape.message === "string" && shape.message.trim() !== "" ? shape.message : void 0;
    return { code, message: detail ?? message ?? fallback };
  }

  // extensions/android-apps/src/session.ts
  var toolTitle = { apkScan: "APK \u626B\u63CF", dataExport: "\u6570\u636E\u5BFC\u51FA" };
  var rateLimitBackoffMs = 5e3;
  var Session = class {
    constructor() {
      /** 此刻拿到的能力。 */
      this.granted = [];
      /** adb 看得见的设备；`null` = 还没问过。 */
      this.devices = null;
      this.devicesLoading = false;
      /** 列设备失败的那句话（「未找到 adb」）。 */
      this.devicesError = null;
      /** 选着的设备。 */
      this.serial = null;
      this.scope = "user";
      this.sort = "size";
      this.query = "";
      /** 这台设备、这一种范围下的应用；`null` = 还没列出来。 */
      this.apps = null;
      this.appsLoading = false;
      /** 列应用失败的那句话。 */
      this.appsError = null;
      /** 列表展开到几行。 */
      this.visibleCount = pageSize;
      /** 用户点了「读全部应用名」：不只读画出来的行。换设备、换范围、重新扫描时复位。 */
      this.readAll = false;
      /** 读名字整批失败的那句话（「没有 aapt2，读不出应用名和图标」）；有它就不再往下读，等用户按「重试」。 */
      this.detailsProblem = null;
      /** 用户拒了「交给 APK 扫描 / 数据导出」。 */
      this.toolsDenied = false;
      this.notice = null;
      this.active = false;
      this.generation = 0;
      /** `apps` 是哪一台、哪一种范围的：同一个键刷新时旧列表留在屏幕上，换了键才清空。 */
      this.appsKey = null;
      this.detailsBusy = false;
      /** `序列号\0包名` → 详情。 */
      this.cache = /* @__PURE__ */ new Map();
    }
    // ── 生命周期 ──────────────────────────────────────────────────────────
    /**
     * 页面 activate：记下授权，**不等**任何调用就返回——第一棵树要立刻画出来（「正在找设备」），不能是一块空白。
     * @param context 宿主给的上下文。
     * @returns 无。
     */
    activate(context) {
      this.granted = [...context.granted];
      this.active = true;
      this.notice = null;
      if (this.has("android.tools.open")) this.toolsDenied = false;
      if (!this.has("android.apps.read")) return;
      void this.refresh();
    }
    /** 页面离开：代号 +1，在途的结果回来也不再接着排、不再重画。 */
    deactivate() {
      this.active = false;
      this.generation += 1;
    }
    has(capability) {
      return this.granted.includes(capability);
    }
    grantLocally(capability) {
      if (!this.has(capability)) this.granted = [...this.granted, capability];
    }
    revokeLocally(capability) {
      this.granted = this.granted.filter((id) => id !== capability);
    }
    // ── 设备与列表 ────────────────────────────────────────────────────────
    /**
     * 重新扫描：先问设备，再列选着的那台上的应用。读名字的整批失败也一起复位——用户按重新扫描，多半是刚装好 aapt2 或换了线。
     * @returns 列完（或失败）时兑现；从不抛。
     */
    async refresh() {
      const generation = ++this.generation;
      this.devicesLoading = true;
      this.devicesError = null;
      this.appsLoading = false;
      if (!this.devices?.some((device) => device.ready)) this.devices = null;
      this.detailsProblem = null;
      this.readAll = false;
      this.notice = null;
      jarvis.ui.update();
      let devices;
      try {
        devices = await jarvis.android.devices();
      } catch (error) {
        if (generation !== this.generation) return;
        this.devicesLoading = false;
        this.fail(error, "\u8BFB\u4E0D\u5230 adb \u7684\u8BBE\u5907\u5217\u8868", (message) => {
          this.devicesError = message;
          this.devices = null;
        });
        jarvis.ui.update();
        return;
      }
      if (generation !== this.generation) return;
      this.devicesLoading = false;
      this.devices = devices;
      const serial = chooseSerial(devices, this.serial);
      if (serial !== this.serial) {
        this.serial = serial;
        this.resetView();
      }
      if (serial === null) {
        this.apps = null;
        this.appsKey = null;
        jarvis.ui.update();
        return;
      }
      await this.loadApps(generation);
    }
    /**
     * 换一台设备（多台 ready 时的下拉）。
     * @param serial 选中的序列号。
     */
    selectDevice(serial) {
      if (serial === this.serial || !this.devices?.some((device) => device.serial === serial && device.ready)) return;
      this.serial = serial;
      this.detailsProblem = null;
      this.resetView();
      void this.loadApps(++this.generation);
    }
    /**
     * 换范围：用户应用 / 全部。
     * @param scope 新范围。
     */
    selectScope(scope) {
      if (scope !== "user" && scope !== "all" || scope === this.scope) return;
      this.scope = scope;
      this.resetView();
      if (this.serial !== null) void this.loadApps(++this.generation);
    }
    /**
     * 换排序。只是同一份数据换个顺序：不重新列，只回到第一页，并按新的第一页接着读名字。
     * @param order `size` / `name`。
     */
    selectSort(order) {
      if (order !== "size" && order !== "name" || order === this.sort) return;
      this.sort = order;
      this.visibleCount = pageSize;
      this.pump();
    }
    /**
     * 搜索框里的字变了。
     * @param query 新的字。
     */
    setQuery(query) {
      this.query = query;
      this.visibleCount = pageSize;
      this.pump();
    }
    /** 再展开一页（列表滚到底的哨兵，或底部那颗按钮）。 */
    loadMore() {
      this.visibleCount = nextVisibleCount(this.visibleCount);
      this.pump();
    }
    /** 「读全部应用名」：搜索要按名字找到还没轮到的那些应用时，用户自己点。 */
    readAllLabels() {
      this.readAll = true;
      this.pump();
    }
    /** 读名字整批失败之后的「重试」。 */
    retryDetails() {
      this.detailsProblem = null;
      this.pump();
    }
    resetView() {
      this.visibleCount = pageSize;
      this.readAll = false;
    }
    async loadApps(generation) {
      const serial = this.serial;
      if (serial === null) return;
      const scope = this.scope;
      const key = `${serial}\0${scope}`;
      if (this.appsKey !== key) {
        this.apps = null;
        this.appsKey = key;
      }
      this.appsLoading = true;
      this.appsError = null;
      jarvis.ui.update();
      try {
        const list = await jarvis.android.apps({ serial, scope });
        if (generation !== this.generation) return;
        this.apps = list.apps;
      } catch (error) {
        if (generation !== this.generation) return;
        this.fail(error, "\u5217\u4E0D\u51FA\u8FD9\u53F0\u8BBE\u5907\u4E0A\u7684\u5E94\u7528", (message) => {
          this.appsError = message;
        });
      }
      this.appsLoading = false;
      jarvis.ui.update();
      this.pump();
    }
    /**
     * 一次调用被拒：没授权 → 拒绝态（不是错误）；取消 → 什么都不说；其余把那句人话交给 `show`。
     */
    fail(error, fallback, show) {
      const { code, message } = describeError(error, fallback);
      if (code === "permission.denied") {
        this.revokeLocally("android.apps.read");
        return;
      }
      if (code === "cancelled") return;
      show(message);
    }
    /**
     * 这一页没有授权时那颗「授权」。只从按钮回调里调（宿主只在用户动作 1 秒内放行）。
     * @returns 问完（并在拿到授权时开始扫描）时兑现。
     */
    async requestAppsAccess() {
      const result = await jarvis.permissions.request(["android.apps.read"]);
      if (result.granted.includes("android.apps.read")) {
        this.grantLocally("android.apps.read");
        void this.refresh();
      }
      jarvis.ui.update();
    }
    // ── 列表视图 ──────────────────────────────────────────────────────────
    /**
     * 一个包此刻可用的详情：缓存里有、且读它时的安装包大小与此刻一样。
     * @param app 应用。
     * @returns 详情；没有为 `undefined`。
     */
    detailFor(app) {
      if (this.serial === null) return void 0;
      const entry = this.cache.get(`${this.serial}\0${app.package}`);
      return entry && isCacheFresh(entry, app) ? entry.detail : void 0;
    }
    /** 按包名取详情（排序、搜索用）。 */
    detailByName() {
      const index = new Map((this.apps ?? []).map((app) => [app.package, app]));
      return (name) => {
        const app = index.get(name);
        return app ? this.detailFor(app) : void 0;
      };
    }
    /** 全部应用按此刻的排序排好（不过滤）。 */
    sortedApps() {
      return sortApps(this.apps ?? [], this.sort, this.detailByName());
    }
    /** 过滤之后的全部（不截断）。 */
    matchedApps() {
      return this.sortedApps().filter((app) => matchesQuery(app, this.detailFor(app), this.query));
    }
    /** 此刻画出来的那几行。 */
    visibleApps() {
      const matched = this.matchedApps();
      return matched.slice(0, rowsToRender(matched.length, this.visibleCount));
    }
    /**
     * 读名字的候选，按优先级：先是画出来的行；点了「读全部应用名」再接上整张表（不过滤）。
     */
    detailTargets() {
      const visible = this.visibleApps();
      return this.readAll ? [...visible, ...this.sortedApps()] : visible;
    }
    /** 还没读到名字的应用有几个（搜索的空结果那一屏要说）。 */
    unlabeledCount() {
      return (this.apps ?? []).filter((app) => this.detailFor(app) === void 0).length;
    }
    /**
     * 读名字的进度：画出来的行（「读全部」时是整张表）里有几行已经有了详情。
     * @returns 进度；没在读、或没有要读的为 `null`。
     */
    detailsProgress() {
      if (!this.detailsBusy) return null;
      const targets = this.readAll ? this.apps ?? [] : this.visibleApps();
      const done = targets.filter((app) => this.detailFor(app) !== void 0).length;
      return { done, target: targets.length };
    }
    // ── 一批一批读名字 ────────────────────────────────────────────────────
    /**
     * 排下一批。没开着、在读、整批失败过、没有列表、或没有要问的了，都什么都不做。
     * 结果按序列号 + 包名落进缓存；页面还开着才重画、才排下一批（换了设备也接着排——新设备的那一批）。
     */
    pump() {
      if (!this.active || this.detailsBusy || this.detailsProblem !== null || this.serial === null || this.apps === null) return;
      if (!this.has("android.apps.read")) return;
      const serial = this.serial;
      const targets = this.detailTargets();
      const byName = new Map(targets.map((app) => [app.package, app]));
      const batch = nextDetailsBatch(
        targets.map((app) => app.package),
        (name) => {
          const app = byName.get(name);
          return app !== void 0 && this.detailFor(app) !== void 0;
        },
        maximumAndroidAppDetailsPerCall
      );
      if (batch.length === 0) return;
      const sizes = new Map(batch.map((name) => [name, byName.get(name)?.apkBytes ?? null]));
      this.detailsBusy = true;
      jarvis.ui.update();
      void this.readBatch(serial, batch, sizes);
    }
    async readBatch(serial, batch, sizes) {
      let retryAfter = 0;
      try {
        const details = await jarvis.android.appDetails({ serial, packages: batch });
        const answered = new Map(details.map((detail) => [detail.package, detail]));
        for (const name of batch) {
          const detail = answered.get(name) ?? { package: name, label: null, versionName: null, icon: null, problem: "\u5BBF\u4E3B\u6CA1\u6709\u4EA4\u56DE\u8FD9\u4E2A\u5305" };
          this.cache.set(`${serial}\0${name}`, { detail, apkBytes: sizes.get(name) ?? null });
        }
      } catch (error) {
        const { code, message } = describeError(error, "\u8BFB\u4E0D\u51FA\u5E94\u7528\u540D\u548C\u56FE\u6807");
        if (code === "permission.denied") {
          this.revokeLocally("android.apps.read");
        } else if (code === "rate.limited") {
          retryAfter = rateLimitBackoffMs;
        } else if (code === "invalid.argument") {
          for (const name of batch) {
            this.cache.set(`${serial}\0${name}`, {
              detail: { package: name, label: null, versionName: null, icon: null, problem: message },
              apkBytes: sizes.get(name) ?? null
            });
          }
        } else if (code !== "cancelled") {
          this.detailsProblem = message;
        }
      }
      if (retryAfter > 0) {
        const generation = this.generation;
        await sleep(retryAfter);
        if (generation !== this.generation) {
          this.detailsBusy = false;
          this.pump();
          return;
        }
      }
      this.detailsBusy = false;
      if (!this.active) return;
      jarvis.ui.update();
      this.pump();
    }
    // ── 交给内置工具 ──────────────────────────────────────────────────────
    /**
     * 行尾那两颗：把包名交给内置的「APK 扫描」或「数据导出」。没授权时就地问一次——按钮本身就是那次用户动作。
     * 打开成功之后宿主把面板切到那个工具，这一页随之离开。
     * @param tool 哪一个工具。
     * @param name 包名。
     * @returns 交出去（或失败、被拒）时兑现；从不抛。
     */
    async openTool(tool, name) {
      this.notice = null;
      if (!this.has("android.tools.open")) {
        const result = await jarvis.permissions.request(["android.tools.open"]);
        if (!result.granted.includes("android.tools.open")) {
          this.toolsDenied = true;
          jarvis.ui.update();
          return;
        }
        this.grantLocally("android.tools.open");
      }
      this.toolsDenied = false;
      try {
        await jarvis.android.openTool({ tool, package: name });
      } catch (error) {
        const { code, message } = describeError(error, `\u6CA1\u80FD\u6253\u5F00\u300C${toolTitle[tool]}\u300D`);
        if (code === "permission.denied") {
          this.revokeLocally("android.tools.open");
          this.toolsDenied = true;
        } else if (code !== "cancelled") {
          this.notice = { title: `\u6CA1\u80FD\u4EA4\u7ED9\u300C${toolTitle[tool]}\u300D`, body: message };
        }
      }
      jarvis.ui.update();
    }
    /** 「授权」那颗（交给工具被拒之后）。 */
    async requestToolsAccess() {
      const result = await jarvis.permissions.request(["android.tools.open"]);
      if (result.granted.includes("android.tools.open")) {
        this.grantLocally("android.tools.open");
        this.toolsDenied = false;
      }
      jarvis.ui.update();
    }
    dismissNotice() {
      this.notice = null;
    }
  };

  // extensions/android-apps/src/page.ts
  function rescanAction(session2) {
    return { id: "rescan", title: "\u91CD\u65B0\u626B\u63CF", symbol: "arrow.clockwise", help: "\u91CD\u65B0\u626B\u63CF\u8BBE\u5907\u4E0E\u5E94\u7528", onPress: () => void session2.refresh() };
  }
  function footnote(key, text) {
    return ui.text({ key, text, style: "footnote" });
  }
  function deniedScreen(session2) {
    return ui.empty({
      key: "denied",
      symbol: "lock",
      title: "\u6CA1\u6709\u8BFB\u53D6\u624B\u673A\u5E94\u7528\u7684\u6388\u6743",
      hint: "\u626B\u63CF\u8981\u7ECF adb \u8BFB\u624B\u673A\u4E0A\u88C5\u4E86\u54EA\u4E9B\u5E94\u7528\uFF1B\u8BFB\u5E94\u7528\u540D\u548C\u56FE\u6807\u65F6\u628A\u5B89\u88C5\u5305\u4E34\u65F6\u62C9\u5230\u672C\u673A\uFF0C\u8BFB\u5B8C\u5373\u5220\u3002",
      action: { id: "grant", title: "\u6388\u6743", onPress: () => void session2.requestAppsAccess() }
    });
  }
  function rescanEmpty(session2, key, symbol, title, hint) {
    return ui.empty({ key, symbol, title, hint, action: { id: "rescan", title: "\u91CD\u65B0\u626B\u63CF", onPress: () => void session2.refresh() } });
  }
  function deviceScreen(session2, devices) {
    if (devices.length === 0) {
      return rescanEmpty(session2, "no-device", "cable.connector", "\u6CA1\u6709\u8FDE\u7740\u7684\u5B89\u5353\u8BBE\u5907", "\u7528 USB \u8FDE\u4E0A\u624B\u673A\u3001\u6253\u5F00 USB \u8C03\u8BD5\uFF0C\u518D\u70B9\u91CD\u65B0\u626B\u63CF");
    }
    const first = devices[0];
    const issue = deviceIssue(first);
    const more = devices.length > 1 ? `\uFF08\u53E6\u6709 ${devices.length - 1} \u53F0\u4E5F\u8BFB\u4E0D\u4E86\uFF09` : "";
    return rescanEmpty(session2, "device-issue", "lock.iphone", issue.title, `${issue.hint}${more}`);
  }
  function deviceSection(session2, devices) {
    const ready = devices.filter((device) => device.ready);
    const current = ready.find((device) => device.serial === session2.serial);
    const children = [];
    if (ready.length > 1) {
      children.push(
        ui.picker({
          key: "device",
          label: "\u9009\u8BBE\u5907",
          layout: "compact",
          value: session2.serial ?? "",
          options: ready.map((device) => ({ value: device.serial, title: device.name, detail: device.serial })),
          onChange: (serial) => session2.selectDevice(serial)
        })
      );
    }
    const blocked = devices.filter((device) => !device.ready);
    if (blocked.length > 0) {
      const issue = deviceIssue(blocked[0]);
      const more = blocked.length > 1 ? `\u7B49 ${blocked.length} \u53F0` : "";
      children.push(footnote("blocked", `${issue.title}${more}\uFF1A${issue.hint}`));
    }
    return ui.section({
      key: "device-section",
      title: "\u8BBE\u5907 \xB7 DEVICE",
      // 多台时名字已经在下拉里，标题右端不再重复；重新扫描期间这里说一声，旧的清单先留在屏幕上
      ...session2.devicesLoading ? { trailing: "\u6B63\u5728\u626B\u63CF" } : ready.length === 1 && current ? { trailing: current.name } : {},
      actions: [rescanAction(session2)],
      children
    });
  }
  function controls(session2) {
    return [
      ui.search({
        key: "query",
        value: session2.query,
        placeholder: "\u641C\u5E94\u7528\u540D\u6216\u5305\u540D",
        label: "\u641C\u5E94\u7528",
        onChange: (value) => session2.setQuery(value)
      }),
      ui.stack({
        key: "modes",
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          ui.segmented({
            key: "scope",
            label: "\u8303\u56F4",
            layout: "full",
            value: session2.scope,
            options: [
              { value: "user", title: "\u7528\u6237\u5E94\u7528", help: "\u53EA\u5217\u4F60\u81EA\u5DF1\u88C5\u7684\u5E94\u7528" },
              { value: "all", title: "\u5168\u90E8", help: "\u8FDE\u540C\u7CFB\u7EDF\u5E94\u7528\u4E00\u8D77\u5217" }
            ],
            onChange: (value) => session2.selectScope(value)
          }),
          ui.segmented({
            key: "sort",
            label: "\u6392\u5E8F",
            layout: "full",
            value: session2.sort,
            options: [
              { value: "size", title: "\u6309\u5927\u5C0F", help: "\u5360\u5F97\u591A\u7684\u5728\u524D" },
              { value: "name", title: "\u6309\u540D\u79F0", help: "\u6309\u5E94\u7528\u540D\uFF1B\u8FD8\u6CA1\u8BFB\u5230\u540D\u5B57\u7684\u6309\u5305\u540D" }
            ],
            onChange: (value) => session2.selectSort(value)
          })
        ]
      })
    ];
  }
  function toolActions(session2, app) {
    return [
      {
        id: "apk-scan",
        title: toolTitle.apkScan,
        symbol: "shippingbox",
        help: `\u5728\u300C${toolTitle.apkScan}\u300D\u91CC\u6253\u5F00 ${app.package}`,
        onPress: () => void session2.openTool("apkScan", app.package)
      },
      {
        id: "data-export",
        title: toolTitle.dataExport,
        symbol: "square.and.arrow.down",
        help: `\u5728\u300C${toolTitle.dataExport}\u300D\u91CC\u6253\u5F00 ${app.package}`,
        onPress: () => void session2.openTool("dataExport", app.package)
      }
    ];
  }
  function appRow(session2, app) {
    const detail = session2.detailFor(app);
    const title = displayName(app, detail);
    const total = totalBytes(app);
    const spoken = [title, detail?.versionName ? `\u7248\u672C ${detail.versionName}` : null, total === null ? "\u5927\u5C0F\u8BFB\u4E0D\u51FA" : `\u5171 ${formatBytes(total)}`].filter((part) => part !== null).join("\uFF0C");
    return ui.row({
      key: app.package,
      // 读到图标就换成图标；还没轮到、或读不出时是同一口井里的通用应用符号
      ...detail?.icon ? { image: detail.icon } : { symbol: "app" },
      title,
      subtitle: rowSubtitle(app, detail, session2.scope),
      label: spoken,
      actions: toolActions(session2, app)
    });
  }
  function emptyList(session2) {
    const query = session2.query.trim();
    if (query === "") {
      return session2.scope === "user" ? ui.empty({ symbol: "app.dashed", title: "\u8FD9\u53F0\u8BBE\u5907\u4E0A\u6CA1\u6709\u7528\u6237\u5E94\u7528", hint: "\u5207\u5230\u300C\u5168\u90E8\u300D\u770B\u7CFB\u7EDF\u5E94\u7528" }) : ui.empty({ symbol: "app.dashed", title: "\u8FD9\u53F0\u8BBE\u5907\u4E0A\u4E00\u4E2A\u5E94\u7528\u90FD\u6CA1\u5217\u51FA\u6765", hint: "\u70B9\u91CD\u65B0\u626B\u63CF\u518D\u8BD5\u4E00\u6B21" });
    }
    const unlabeled = session2.unlabeledCount();
    const total = session2.apps?.length ?? 0;
    const hint = unlabeled > 0 ? `\u5E94\u7528\u540D\u8BFB\u5230\u4E4B\u540E\u624D\u641C\u5F97\u5230\uFF08\u5DF2\u8BFB ${total - unlabeled} / ${total}\uFF09\uFF1B\u6CA1\u8BFB\u5230\u540D\u5B57\u7684\u53EA\u6309\u5305\u540D\u5339\u914D` : "\u6309\u5E94\u7528\u540D\u6216\u5305\u540D\u641C\uFF0C\u4E0D\u5206\u5927\u5C0F\u5199";
    return ui.empty({ symbol: "magnifyingglass", title: `\u6CA1\u6709\u5339\u914D\u300C${query}\u300D\u7684\u5E94\u7528`, hint });
  }
  function notes(session2) {
    const out = [];
    if (session2.detailsProblem !== null) {
      out.push(
        ui.note({
          key: "details-problem",
          tint: "alert",
          symbol: "exclamationmark.triangle",
          title: "\u8BFB\u4E0D\u51FA\u5E94\u7528\u540D\u548C\u56FE\u6807",
          body: `${session2.detailsProblem}\u3002\u5305\u540D\u4E0E\u5927\u5C0F\u7167\u5E38\u5217\u51FA\u3002`,
          actions: [{ id: "retry-details", title: "\u91CD\u8BD5", onPress: () => session2.retryDetails() }]
        })
      );
    }
    if (session2.toolsDenied) {
      out.push(
        ui.note({
          key: "tools-denied",
          tint: "alert",
          symbol: "lock",
          title: "\u6CA1\u6709\u4EA4\u7ED9 APK \u626B\u63CF / \u6570\u636E\u5BFC\u51FA\u7684\u6388\u6743",
          body: "\u884C\u5C3E\u90A3\u4E24\u9897\u6309\u94AE\u8981\u5B83\u624D\u80FD\u628A\u5305\u540D\u4EA4\u8FC7\u53BB\uFF1B\u4E5F\u53EF\u4EE5\u5728 \u8BBE\u7F6E \u203A \u6269\u5C55 \u203A \u624B\u673A\u5E94\u7528 \u91CC\u6253\u5F00\u3002",
          actions: [{ id: "grant-tools", title: "\u6388\u6743", onPress: () => void session2.requestToolsAccess() }]
        })
      );
    }
    if (session2.notice) {
      out.push(
        ui.note({
          key: "notice",
          tint: "danger",
          symbol: "xmark.octagon",
          title: session2.notice.title,
          body: session2.notice.body,
          actions: [{ id: "dismiss-notice", title: "\u77E5\u9053\u4E86", onPress: () => session2.dismissNotice() }]
        })
      );
    }
    return out;
  }
  function appsSection(session2, deviceName) {
    const children = [...controls(session2)];
    const apps = session2.apps;
    if (apps === null) {
      if (session2.appsError !== null) {
        children.push(
          ui.note({
            key: "apps-error",
            tint: "danger",
            symbol: "xmark.octagon",
            title: "\u5217\u4E0D\u51FA\u5E94\u7528",
            body: session2.appsError,
            actions: [{ id: "rescan-apps", title: "\u91CD\u65B0\u626B\u63CF", onPress: () => void session2.refresh() }]
          })
        );
      } else {
        children.push(ui.progress({ key: "apps-progress", tint: "accent", label: `\u6B63\u5728\u8BFB ${deviceName} \u4E0A\u7684\u5E94\u7528` }));
      }
      return ui.section({ key: "apps-section", title: "\u5E94\u7528 \xB7 APPS", children });
    }
    const matched = session2.matchedApps();
    const visible = session2.visibleApps();
    const searching = session2.query.trim() !== "";
    const all = summarize(apps);
    const progress = session2.detailsProgress();
    if (session2.appsLoading) {
      children.push(ui.progress({ key: "apps-progress", tint: "accent", label: "\u6B63\u5728\u5237\u65B0\u5E94\u7528\u5217\u8868" }));
    } else if (progress && progress.target > 0) {
      children.push(
        ui.progress({
          key: "details-progress",
          tint: "accent",
          value: progress.done / progress.target,
          label: `\u8BFB\u5E94\u7528\u540D\u4E0E\u56FE\u6807 ${progress.done} / ${progress.target}`
        })
      );
    }
    if (session2.appsError !== null) {
      children.push(ui.note({ key: "apps-error", tint: "danger", symbol: "xmark.octagon", title: "\u5237\u65B0\u5931\u8D25\uFF0C\u4E0B\u9762\u662F\u4E0A\u4E00\u6B21\u7684\u5217\u8868", body: session2.appsError }));
    }
    children.push(...notes(session2));
    const more = canLoadMore(matched.length, session2.visibleCount);
    children.push(
      ui.list({
        key: "apps",
        children: visible.map((app) => appRow(session2, app)),
        emptyState: emptyList(session2),
        ...more ? { onLoadMore: () => session2.loadMore() } : {}
      })
    );
    if (more) {
      const next = Math.min(pageSize, matched.length - visible.length);
      children.push(ui.button({ key: "load-more", title: `\u518D\u5217 ${next} \u4E2A`, variant: "link", size: "inline", onPress: () => session2.loadMore() }));
    } else if (matched.length > maximumRows) {
      children.push(footnote("cap", `\u53EA\u5217\u51FA\u524D ${maximumRows} \u4E2A\uFF1A\u7528\u641C\u7D22\u7F29\u5C0F\u8303\u56F4`));
    }
    if (searching && matched.length === 0 && session2.unlabeledCount() > 0 && !session2.readAll && session2.detailsProblem === null) {
      children.push(
        ui.button({ key: "read-all", title: "\u8BFB\u5168\u90E8\u5E94\u7528\u540D", variant: "secondary", size: "inline", help: "\u4E00\u6279 8 \u4E2A\u5F80\u540E\u8BFB\uFF0C\u8BFB\u5230\u7684\u540D\u5B57\u968F\u65F6\u641C\u5F97\u5230", onPress: () => session2.readAllLabels() })
      );
    }
    if (all.unknown > 0) children.push(footnote("unknown-size", `${all.unknown} \u4E2A\u5E94\u7528\u8BFB\u4E0D\u51FA\u5927\u5C0F\uFF0C\u6CA1\u7B97\u8FDB\u603B\u6570`));
    return ui.section({
      key: "apps-section",
      title: "\u5E94\u7528 \xB7 APPS",
      trailing: summaryLine(summarize(matched), all, searching),
      children
    });
  }
  function renderPage(session2) {
    if (!session2.has("android.apps.read")) return ui.scroll({ children: [deniedScreen(session2)] });
    const devices = session2.devices;
    if (devices === null) {
      if (session2.devicesError !== null) {
        return ui.scroll({
          children: [rescanEmpty(session2, "devices-error", "exclamationmark.triangle", "\u8BFB\u4E0D\u5230\u8BBE\u5907", session2.devicesError)]
        });
      }
      if (!session2.devicesLoading) {
        return ui.scroll({ children: [rescanEmpty(session2, "not-scanned", "arrow.clockwise", "\u8FD8\u6CA1\u626B\u63CF", "\u70B9\u91CD\u65B0\u626B\u63CF\uFF0C\u8BFB\u8FDE\u7740\u7684\u5B89\u5353\u8BBE\u5907")] });
      }
      return ui.scroll({
        children: [ui.progress({ key: "devices-progress", tint: "accent", label: "\u6B63\u5728\u627E\u8FDE\u7740\u7684\u5B89\u5353\u8BBE\u5907" })]
      });
    }
    const current = devices.find((device) => device.ready && device.serial === session2.serial);
    if (!current) return ui.scroll({ children: [deviceScreen(session2, devices)] });
    return ui.scroll({
      children: [
        deviceSection(session2, devices),
        appsSection(session2, current.name),
        footnote("hint", "\u884C\u5C3E\u4E24\u9897\uFF1A\u4EA4\u7ED9\u300CAPK \u626B\u63CF\u300D\u6216\u300C\u6570\u636E\u5BFC\u51FA\u300D\uFF0C\u5305\u540D\u5DF2\u7ECF\u586B\u597D\uFF0C\u5F00\u59CB\u7531\u4F60\u5728\u90A3\u8FB9\u6309")
      ]
    });
  }

  // extensions/android-apps/src/index.ts
  var session = new Session();
  var page = {
    activate: (context) => session.activate(context),
    deactivate: () => session.deactivate(),
    render: () => renderPage(session)
  };
  defineExtension({ toolbox: page });
})();
