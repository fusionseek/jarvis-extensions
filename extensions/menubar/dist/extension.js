// jarvis-extension bundle · menubar@1.0.0 · sdk 2.11.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
    image: make("image"),
    chart: make("chart")
  };

  // sdk/src/index.ts
  var sdkVersion = "2.11.0";
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
     *
     * `params`（SDK 2.9）是订阅的对象——`daemon.observe` 要说订的是哪一个常驻进程（`{ id }`）。它同时随订阅与退订上线缆，
     * 宿主据此找到那一个进程的订阅者表，不必反查 token 属于谁；不给时线缆上只有 `{ token }`，与 2.8 一字不差。
     */
    subscribe(namespace, method, listener, params = {}) {
      const token = this.token(namespace, method);
      this.listen(token, listener);
      this.invoke(namespace, method, { ...params, token }).catch((error) => {
        this.forget(token);
        this.log("warn", `\u8BA2\u9605 ${namespace}.${method} \u88AB\u5BBF\u4E3B\u62D2\u7EDD`, error instanceof Error ? error.message : String(error));
      });
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        this.forget(token);
        this.invoke(namespace, "unsubscribe", { ...params, token }).catch(() => void 0);
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
              case "addItem":
                if (!engine.addItem) break;
                return engine.addItem(request, context, signal);
            }
            break;
          }
          case "launcher.apps": {
            const engine = implementation;
            if (call2.method === "catalog") return Promise.resolve(engine.catalog(context));
            break;
          }
          case "code.format": {
            const engine = implementation;
            if (call2.method === "describe") return Promise.resolve(engine.describe(context));
            if (call2.method === "format") return engine.format(call2.params.request, context, signal);
            break;
          }
          case "code.highlight": {
            const engine = implementation;
            if (call2.method === "describe") return Promise.resolve(engine.describe(context));
            if (call2.method === "highlight") return Promise.resolve(engine.highlight(call2.params.request, context, signal));
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
    /**
     * 菜单栏事件落到 `defineExtension({ menuBar })` 的回调。与命令同一种收尾：回调抛错只记 error 日志——
     * 一次点选失败不该把后台会话拖垮，菜单还要接着用。
     */
    handleMenuBar(event) {
      const handlers = this.definition?.menuBar;
      if (!handlers) {
        this.log("error", "manifest \u5165\u9A7B\u4E86\u83DC\u5355\u680F\u57DF\uFF0C\u4F46 defineExtension \u91CC\u6CA1\u6709 menuBar \u7684\u5B9E\u73B0\u3002", void 0);
        return;
      }
      const context = { granted: event.granted, preferences: event.preferences };
      let work;
      try {
        switch (event.event) {
          case "start":
            work = handlers.start?.(context);
            break;
          case "open":
            work = handlers.open?.(context);
            break;
          case "select":
            work = handlers.select(context, event.itemId);
            break;
          case "press":
            work = handlers.press?.(context, event.statusItem, event.modifiers);
            break;
          default:
            return;
        }
      } catch (error) {
        work = Promise.reject(error);
      }
      void Promise.resolve(work).then(
        () => this.requestUpdate(),
        (error) => this.log("error", `\u83DC\u5355\u680F\u7684 ${event.event} \u629B\u51FA\u4E86\u5F02\u5E38`, error instanceof Error ? error.message : String(error))
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
        case "menuBar": {
          this.handleMenuBar(event.menuBar);
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
    system: namespaced("system"),
    menuBar: namespaced("menuBar"),
    menuBarExtras: namespaced("menuBarExtras"),
    screens: namespaced("screens"),
    daemon: namespaced("daemon"),
    systemProxy: namespaced("systemProxy"),
    tunnel: namespaced("tunnel"),
    browser: namespaced("browser")
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
    const params = { executable: options.executable, arguments: options.arguments, token };
    if (options.stdin !== void 0) params.stdin = options.stdin;
    if (options.directory !== void 0) params.directory = options.directory;
    if (options.output !== void 0) params.output = options.output;
    const result = runtime.invoke("process", "run", params).finally(() => runtime.forget(token));
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
      set: async (key, value) => {
        await call.preferences("set", { key, value });
      },
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
    // 菜单栏域（SDK 2.9）：模型原样就是线缆上的 params，校验与上限在宿主。
    menuBar: {
      update: (model) => call.menuBar("update", model),
      // SDK 2.11：订阅自己的命名空间（`menuBarPointer.observe / unsubscribe`）——宿主按 types 只装要的那几种监听。
      observePointer: (types, listener) => runtime.subscribe("menuBarPointer", "observe", listener, { types: [...new Set(types)] })
    },
    // SDK 2.11：菜单栏上的项、屏幕几何。
    menuBarExtras: {
      list: () => call.menuBarExtras("list"),
      observe: (listener) => runtime.subscribe("menuBarExtras", "observe", listener)
    },
    screens: {
      list: () => call.screens("list"),
      observe: (listener) => runtime.subscribe("screens", "observe", (payload) => listener(payload.screens))
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
      tail: (path, offset) => call.files("tail", { path, offset }),
      pick: (request) => call.files("pick", request ?? {})
    },
    terminal: {
      run: (scriptId) => call.terminal("run", { id: scriptId })
    },
    // 常驻进程（SDK 2.9）：入参原样上线缆，占位符展开、控制口校验都在宿主。
    daemon: {
      start: (request) => call.daemon("start", request),
      stop: (id) => call.daemon("stop", { id }),
      status: (id, executable) => call.daemon("status", executable === void 0 ? { id } : { id, executable }),
      logs: (id) => call.daemon("logs", { id }),
      request: (request) => call.daemon("request", request),
      reload: (request) => call.daemon("reload", request),
      observe: (id, listener) => runtime.subscribe("daemon", "observe", listener, { id })
    },
    // 系统代理（SDK 2.9）：主机由宿主写死 127.0.0.1，扩展只给端口与例外。
    systemProxy: {
      status: () => call.systemProxy("status"),
      enable: (request) => call.systemProxy("enable", request),
      disable: () => call.systemProxy("disable")
    },
    // TUN 增强模式（SDK 2.10）：入参原样上线缆；守卫、TUN 段、网络助手的安装都在宿主。
    tunnel: {
      status: (executable) => call.tunnel("status", executable === void 0 ? {} : { executable }),
      start: (request) => call.tunnel("start", request),
      reload: (config) => call.tunnel("reload", { config }),
      stop: () => call.tunnel("stop"),
      logs: () => call.tunnel("logs"),
      request: (request) => call.tunnel("request", request),
      observe: (listener) => runtime.subscribe("tunnel", "observe", listener)
    },
    // 悬浮球那一层（SDK 2.10）：模型原样就是 params——撤掉时线缆上是 null（不走 namespaced 那个 `?? {}`：{} 会被宿主当成一份坏模型）。
    orb: {
      update: (model) => runtime.invoke("orb", "update", model)
    },
    browser: {
      activeTab: () => call.browser("activeTab")
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

  // extensions/menubar/src/model.ts
  var TOGGLE = "toggle";
  var HIDDEN = "hidden";
  var ALWAYS = "always";
  var HIDE_LENGTH = 1e4;
  var defaultSettings = {
    clickReveal: true,
    hoverReveal: false,
    scrollReveal: false,
    autoRehide: 10,
    alwaysHidden: true
  };
  function readSettings(preferences) {
    const flag = (key, fallback) => typeof preferences[key] === "boolean" ? preferences[key] : fallback;
    const seconds = typeof preferences.autoRehide === "number" && Number.isFinite(preferences.autoRehide) ? preferences.autoRehide : defaultSettings.autoRehide;
    return {
      clickReveal: flag("clickReveal", defaultSettings.clickReveal),
      hoverReveal: flag("hoverReveal", defaultSettings.hoverReveal),
      scrollReveal: flag("scrollReveal", defaultSettings.scrollReveal),
      autoRehide: Math.max(0, Math.min(120, Math.round(seconds))),
      alwaysHidden: flag("alwaysHidden", defaultSettings.alwaysHidden)
    };
  }
  var collapsedState = { expanded: false, alwaysRevealed: false };
  function press(state, modifiers, settings) {
    if (modifiers.includes("option") && settings.alwaysHidden) {
      return state.alwaysRevealed ? collapsedState : { expanded: true, alwaysRevealed: true };
    }
    return state.expanded ? collapsedState : { expanded: true, alwaysRevealed: false };
  }
  function statusModels(state, settings) {
    const toggleItems = [
      { kind: "item", id: state.expanded ? "collapse" : "reveal", title: state.expanded ? "\u6536\u8D77" : "\u663E\u793A\u9690\u85CF\u7684\u56FE\u6807" }
    ];
    if (settings.alwaysHidden) {
      toggleItems.push({ kind: "item", id: state.alwaysRevealed ? "collapse-all" : "reveal-all", title: state.alwaysRevealed ? "\u5168\u90E8\u6536\u8D77" : "\u5168\u90E8\u663E\u793A\uFF08\u542B\u6C38\u8FDC\u9690\u85CF\uFF09" });
    }
    toggleItems.push({ kind: "separator" }, { kind: "header", title: "\u6309\u4F4F \u2318 \u628A\u56FE\u6807\u62D6\u5230\u7AD6\u7EBF\u5DE6\u8FB9\u5C31\u4F1A\u88AB\u6536\u8D77" });
    const toggle = {
      statusItem: TOGGLE,
      // 收着时指向左边那些被藏起来的；露着时指回去，点一下收起。
      symbol: state.expanded ? "chevron.right" : "chevron.left",
      primaryClick: "event",
      tooltip: state.expanded ? "\u70B9\u4E00\u4E0B\u6536\u8D77" : settings.alwaysHidden ? "\u70B9\u4E00\u4E0B\u663E\u793A\u9690\u85CF\u7684\u56FE\u6807\uFF0C\u2325 \u70B9\u8FDE\u6C38\u8FDC\u9690\u85CF\u7684\u4E00\u8D77\u663E\u793A" : "\u70B9\u4E00\u4E0B\u663E\u793A\u9690\u85CF\u7684\u56FE\u6807",
      items: toggleItems
    };
    const divider = (id, shown, tooltip) => shown ? { statusItem: id, symbol: "poweron", length: "auto", tooltip, items: [{ kind: "item", id: "collapse", title: "\u6536\u8D77" }] } : { statusItem: id, blank: true, length: HIDE_LENGTH, items: [] };
    const hidden = divider(HIDDEN, state.expanded, "\u9690\u85CF\u6BB5\uFF1A\u7AD6\u7EBF\u5DE6\u8FB9\u7684\u56FE\u6807\u6536\u8D77\u65F6\u9690\u85CF");
    const always = settings.alwaysHidden ? divider(ALWAYS, state.alwaysRevealed, "\u6C38\u8FDC\u9690\u85CF\u6BB5\uFF1A\u7AD6\u7EBF\u5DE6\u8FB9\u7684\u56FE\u6807\u53EA\u6709 \u2325 \u70B9\u65F6\u624D\u51FA\u6765") : { statusItem: ALWAYS, hidden: true, length: "auto", items: [] };
    return [toggle, hidden, always];
  }
  function pointerTypes(state, settings, granted) {
    if (!granted) return [];
    const types = /* @__PURE__ */ new Set();
    if (settings.hoverReveal || state.expanded && settings.autoRehide > 0) {
      types.add("enter");
      types.add("exit");
    }
    if (settings.clickReveal || state.expanded && settings.autoRehide > 0) types.add("click");
    if (settings.scrollReveal) types.add("scroll");
    const order = ["enter", "exit", "click", "scroll"];
    return order.filter((type) => types.has(type));
  }
  function isEmptyAreaClick(event, screens) {
    if (event.button !== "left" || event.onItem) return false;
    if (event.onAppMenu !== null) return !event.onAppMenu;
    const screen = screens.find((candidate) => candidate.id === event.screen);
    return screen !== void 0 && event.x > screen.frame.width / 2;
  }
  var HOVER_DELAY_MS = 250;
  var INTERACTION_REHIDE_SECONDS = 20;
  function rehideDelay(settings, interacting) {
    if (settings.autoRehide <= 0) return null;
    return (interacting ? Math.max(settings.autoRehide, INTERACTION_REHIDE_SECONDS) : settings.autoRehide) * 1e3;
  }
  function classify(items, screens) {
    const hiddenDivider = items.find((item) => item.mine === HIDDEN);
    const alwaysDivider = items.find((item) => item.mine === ALWAYS);
    const layout = { shown: [], hidden: [], always: [], notched: [], hasDivider: hiddenDivider !== void 0, collapsed: false };
    layout.collapsed = hiddenDivider !== void 0 && hiddenDivider.frame.width > 1e3;
    for (const item of items) {
      if (item.mine) continue;
      const center = item.frame.x + item.frame.width / 2;
      if (alwaysDivider && center < alwaysDivider.frame.x) {
        layout.always.push(item);
      } else if (hiddenDivider && center < hiddenDivider.frame.x) {
        layout.hidden.push(item);
      } else {
        layout.shown.push(item);
        if (isBehindNotch(item, screens)) layout.notched.push(item);
      }
    }
    return layout;
  }
  function isBehindNotch(item, screens) {
    if (item.onScreen || item.screen === null) return false;
    const notch = screens.find((screen) => screen.id === item.screen)?.notch;
    if (!notch) return false;
    const gapStart = notch.left.x + notch.left.width;
    const gapEnd = notch.right.x;
    return item.frame.x < gapEnd && item.frame.x + item.frame.width > gapStart;
  }
  function displayName(item) {
    return item.ownerName || item.title || item.id;
  }

  // extensions/menubar/src/controller.ts
  var MAXIMUM_TIMER_MS = 3e4;
  function cancel(timer) {
    if (timer !== void 0) clearTimeout(timer);
    return void 0;
  }
  var Controller = class {
    constructor() {
      this.state = collapsedState;
      this.settings = defaultSettings;
      this.pointerGranted = false;
      this.subscribedTypes = "";
      /** 指针此刻在菜单栏那一条上（只在订了 enter / exit 时知道）。 */
      this.pointerInBar = false;
      /** 露着期间点过某一颗图标（它的菜单多半开着，收回要等久一点）。 */
      this.interacting = false;
      this.screens = [];
    }
    /** 此刻的状态（测试读）。 */
    get current() {
      return this.state;
    }
    /**
     * 菜单栏域的 `start`：读偏好与授权，推第一份模型（启动时一律收着，与 Bartender 一样），按设置订指针。
     * @param preferences 此刻的偏好。
     * @param granted 此刻的授权。
     */
    async start(preferences, granted) {
      this.settings = readSettings(preferences);
      this.pointerGranted = granted.includes("menuBar.pointer");
      this.state = collapsedState;
      this.stopPreferences ?? (this.stopPreferences = jarvis.preferences.onChange(() => void this.reloadPreferences()));
      await this.render();
    }
    /**
     * 控制项被左键点了。
     * @param modifiers 按着的修饰键。
     */
    async press(modifiers) {
      await this.apply(press(this.state, modifiers, this.settings));
    }
    /**
     * 菜单里点了一项（控制项与两枚边界的菜单）。
     * @param itemId 那一项。
     */
    async select(itemId) {
      switch (itemId) {
        case "reveal":
          return this.apply({ expanded: true, alwaysRevealed: false });
        case "reveal-all":
          return this.apply({ expanded: true, alwaysRevealed: this.settings.alwaysHidden });
        case "collapse":
        case "collapse-all":
          return this.apply(collapsedState);
      }
    }
    /** 快捷键 / 指令：在露与收之间切换。 */
    async toggle() {
      await this.apply(this.state.expanded ? collapsedState : { expanded: true, alwaysRevealed: false });
    }
    /** 会话要收了：退订、停表（宿主同时把边界的宽度复原）。 */
    stop() {
      this.clearTimers();
      this.unsubscribePointer?.();
      this.unsubscribePointer = void 0;
      this.subscribedTypes = "";
      this.stopPreferences?.();
      this.stopPreferences = void 0;
    }
    // ---------------------------------------------------------------------------
    async reloadPreferences() {
      this.settings = readSettings(await jarvis.preferences.all());
      this.pointerGranted = (await jarvis.permissions.granted()).includes("menuBar.pointer");
      if (!this.settings.alwaysHidden && this.state.alwaysRevealed) this.state = { ...this.state, alwaysRevealed: false };
      await this.render();
    }
    async apply(next) {
      const wasExpanded = this.state.expanded;
      this.state = next;
      if (next.expanded && !wasExpanded) this.interacting = false;
      await this.render();
    }
    async render() {
      for (const model of statusModels(this.state, this.settings)) await jarvis.menuBar.update(model);
      this.syncPointer();
      this.scheduleRehide();
    }
    /** 订阅范围变了才重订：没变的不碰（宿主那边一订一退都是一次调用）。 */
    syncPointer() {
      const types = pointerTypes(this.state, this.settings, this.pointerGranted);
      const signature = types.join(",");
      if (signature === this.subscribedTypes) return;
      this.unsubscribePointer?.();
      this.unsubscribePointer = void 0;
      this.subscribedTypes = signature;
      this.pointerInBar = false;
      if (types.length === 0) return;
      if (types.includes("click") && this.screens.length === 0) {
        void jarvis.screens.list().then((screens) => this.screens = screens, () => void 0);
      }
      this.unsubscribePointer = jarvis.menuBar.observePointer(types, (event) => void this.pointer(event));
    }
    async pointer(event) {
      switch (event.type) {
        case "enter":
          this.pointerInBar = true;
          this.scheduleRehide();
          if (!this.state.expanded && this.settings.hoverReveal) {
            this.hoverTimer = cancel(this.hoverTimer);
            this.hoverTimer = setTimeout(() => {
              this.hoverTimer = void 0;
              if (this.pointerInBar && !this.state.expanded) void this.apply({ expanded: true, alwaysRevealed: false });
            }, HOVER_DELAY_MS);
          }
          return;
        case "exit":
          this.pointerInBar = false;
          this.hoverTimer = cancel(this.hoverTimer);
          this.scheduleRehide();
          return;
        case "click":
          if (this.state.expanded && event.onItem) {
            this.interacting = true;
            this.scheduleRehide();
            return;
          }
          if (this.settings.clickReveal && isEmptyAreaClick(event, this.screens)) await this.toggle();
          return;
        case "scroll":
          if (!this.settings.scrollReveal || Math.abs(event.deltaY) < 1) return;
          if (event.deltaY > 0 && !this.state.expanded) await this.apply({ expanded: true, alwaysRevealed: false });
          if (event.deltaY < 0 && this.state.expanded) await this.apply(collapsedState);
          return;
      }
    }
    /**
     * 倒计时：露着、指针不在菜单栏上时开始；指针回到菜单栏上就停。到点收起。
     * 收着时不挂任何定时器。
     */
    scheduleRehide() {
      this.rehideTimer = cancel(this.rehideTimer);
      this.rehideDeadline = void 0;
      const delay = rehideDelay(this.settings, this.interacting);
      if (!this.state.expanded || delay === null) return;
      const knowsPointer = this.subscribedTypes.includes("exit");
      if (knowsPointer && this.pointerInBar) return;
      this.rehideDeadline = Date.now() + delay;
      this.armRehide();
    }
    armRehide() {
      if (this.rehideDeadline === void 0) return;
      const remaining = this.rehideDeadline - Date.now();
      if (remaining <= 0) {
        this.rehideDeadline = void 0;
        this.rehideTimer = void 0;
        void this.apply(collapsedState);
        return;
      }
      this.rehideTimer = setTimeout(() => this.armRehide(), Math.min(remaining, MAXIMUM_TIMER_MS));
    }
    clearTimers() {
      this.rehideTimer = cancel(this.rehideTimer);
      this.hoverTimer = cancel(this.hoverTimer);
      this.rehideDeadline = void 0;
    }
  };

  // extensions/menubar/src/page.ts
  var PageSession = class {
    constructor() {
      this.status = { kind: "loading" };
      this.granted = [];
      this.screens = [];
    }
    /**
     * 页面出现了。
     * @param context 此刻的授权。
     */
    async activate(context) {
      this.granted = context.granted;
      await this.refresh();
      if (this.granted.includes("menuBarExtras.read")) {
        this.stopObserving ?? (this.stopObserving = jarvis.menuBarExtras.observe(() => void this.refresh()));
      }
    }
    /** 页面不在了：退订（订阅留着，宿主就会每 10 s 看一眼窗口列表）。 */
    deactivate() {
      this.stopObserving?.();
      this.stopObserving = void 0;
    }
    /** 重读一次（并发的合成一次）。 */
    refresh() {
      this.refreshing ?? (this.refreshing = this.load().finally(() => this.refreshing = void 0));
      return this.refreshing;
    }
    async load() {
      if (!this.granted.includes("menuBarExtras.read")) {
        this.status = { kind: "denied" };
        return;
      }
      try {
        const [items, screens] = await Promise.all([jarvis.menuBarExtras.list(), jarvis.screens.list()]);
        this.screens = screens;
        this.status = { kind: "ready", layout: classify(items, this.screens) };
      } catch (error) {
        const code = error.code;
        if (code === "permission.unavailable") this.status = { kind: "noAccessibility" };
        else if (code === "permission.denied") this.status = { kind: "denied" };
        else this.status = { kind: "failed", message: error instanceof Error ? error.message : String(error) };
      }
    }
    /** 收放：交给后台会话（状态在那里）；稍后清单变了，这一页跟着重画。 */
    async toggle() {
      await jarvis.commands.run("toggle");
      setTimeout(() => void this.refresh(), 400);
    }
    /** 再问一次授权（只在按钮回调里调）。 */
    async requestAccess() {
      const result = await jarvis.permissions.request(["menuBarExtras.read", "menuBar.pointer"]);
      await this.activate({ granted: result.granted });
    }
  };
  function rows(items, keyPrefix, subtitle) {
    return items.map(
      (item) => ui.row({
        key: `${keyPrefix}:${item.id}`,
        symbol: "app.dashed",
        image: item.icon,
        title: displayName(item),
        subtitle: subtitle(item),
        accessory: "none"
      })
    );
  }
  function section(key, title, items, empty, subtitle) {
    return ui.section({
      key,
      title,
      trailing: `${items.length} \u9897`,
      children: items.length > 0 ? rows(items, key, subtitle) : [ui.text({ key: `${key}:empty`, style: "footnote", text: empty })]
    });
  }
  function renderPage(session) {
    const status = session.status;
    switch (status.kind) {
      case "loading":
        return ui.empty({ key: "loading", symbol: "menubar.rectangle", title: "\u6B63\u5728\u8BFB\u83DC\u5355\u680F", hint: "\u7B2C\u4E00\u6B21\u8981\u95EE\u4E00\u904D\u5404\u4E2A\u5E94\u7528\uFF0C\u7EA6\u4E00\u4E24\u79D2" });
      case "denied":
        return ui.empty({
          key: "denied",
          symbol: "lock",
          title: "\u8FD8\u6CA1\u5141\u8BB8\u8BFB\u83DC\u5355\u680F",
          hint: "\u6536\u8D77\u4E0E\u663E\u793A\u4E0D\u9700\u8981\u6388\u6743\uFF0C\u7167\u5E38\u80FD\u7528\uFF1B\u8981\u5217\u51FA\u6BCF\u4E00\u6BB5\u91CC\u6709\u54EA\u4E9B\u56FE\u6807\uFF0C\u5F97\u5141\u8BB8\u300C\u8BFB\u53D6\u83DC\u5355\u680F\u4E0A\u6709\u54EA\u4E9B\u56FE\u6807\u300D",
          action: { id: "grant", title: "\u5141\u8BB8", onPress: () => void session.requestAccess() }
        });
      case "noAccessibility":
        return ui.empty({
          key: "ax",
          symbol: "hand.raised",
          title: "Jarvis \u8FD8\u6CA1\u6709\u8F85\u52A9\u529F\u80FD\u6743\u9650",
          hint: "macOS 26 \u8D77\uFF0C\u83DC\u5355\u680F\u56FE\u6807\u5C5E\u4E8E\u54EA\u4E2A\u5E94\u7528\u53EA\u80FD\u7ECF\u8F85\u52A9\u529F\u80FD\u8BA4\u51FA\u6765\u3002\u6536\u8D77\u4E0E\u663E\u793A\u4E0D\u53D7\u5F71\u54CD",
          action: { id: "open-ax", title: "\u6253\u5F00\u7CFB\u7EDF\u8BBE\u7F6E", onPress: () => void jarvis.permissions.openSystemSettings("accessibility") }
        });
      case "failed":
        return ui.empty({ key: "failed", symbol: "exclamationmark.triangle", title: "\u6CA1\u8BFB\u51FA\u6765", hint: status.message });
      case "ready":
        return ready(session, status.layout);
    }
  }
  function ready(session, layout) {
    const hiddenCount = layout.hidden.length + layout.always.length;
    const children = [
      ui.row({
        key: "state",
        symbol: layout.collapsed ? "chevron.left" : "chevron.right",
        title: layout.collapsed ? `\u5DF2\u6536\u8D77 ${hiddenCount} \u9897` : "\u9690\u85CF\u7684\u56FE\u6807\u6B63\u9732\u7740",
        subtitle: layout.hasDivider ? "\u70B9\u83DC\u5355\u680F\u4E0A\u7684\u300C\u2039\u300D\u4E5F\u4E00\u6837" : "\u83DC\u5355\u680F\u4E0A\u8FD8\u6CA1\u6709\u5206\u9694\u7AD6\u7EBF\uFF1A\u6253\u5F00\u300C\u5728\u83DC\u5355\u680F\u663E\u793A\u300D",
        actions: [{
          id: "toggle",
          title: layout.collapsed ? "\u663E\u793A" : "\u6536\u8D77",
          symbol: layout.collapsed ? "eye" : "eye.slash",
          help: layout.collapsed ? "\u663E\u793A\u9690\u85CF\u7684\u56FE\u6807" : "\u6536\u8D77",
          onPress: () => void session.toggle()
        }],
        accessory: "none"
      })
    ];
    if (layout.notched.length > 0) {
      children.push(section("notch", "\u88AB\u5218\u6D77\u6321\u4F4F", layout.notched, "", () => "\u5728\u663E\u793A\u6BB5\u91CC\uFF0C\u4F46\u843D\u5728\u5218\u6D77\u4E0B\u9762\u770B\u4E0D\u89C1\uFF1A\u62D6\u5230\u7AD6\u7EBF\u5DE6\u8FB9\u6536\u8D77\uFF0C\u6216\u8005\u5C11\u653E\u51E0\u9897"));
    }
    children.push(
      section("shown", "\u663E\u793A", layout.shown.filter((item) => !layout.notched.includes(item)), "\u7AD6\u7EBF\u53F3\u8FB9\u7684\u56FE\u6807\u4E00\u76F4\u663E\u793A", (item) => item.title || void 0),
      section("hidden", "\u9690\u85CF", layout.hidden, "\u6309\u4F4F \u2318 \u628A\u56FE\u6807\u62D6\u5230\u7AD6\u7EBF\u5DE6\u8FB9\uFF0C\u6536\u8D77\u65F6\u5B83\u5C31\u85CF\u8D77\u6765", (item) => item.title || void 0)
    );
    if (layout.always.length > 0) {
      children.push(section("always", "\u6C38\u8FDC\u9690\u85CF", layout.always, "", (item) => item.title || "\u2325 \u70B9\u300C\u2039\u300D\u65F6\u624D\u51FA\u6765"));
    }
    children.push(
      ui.text({
        key: "how",
        style: "footnote",
        text: "\u5206\u6BB5\u9760\u4E24\u6761\u7AD6\u7EBF\uFF1A\u6309\u4F4F \u2318 \u62D6\u52A8\u56FE\u6807\u8D8A\u8FC7\u7AD6\u7EBF\u5C31\u6362\u4E86\u6BB5\u3002\u6700\u5DE6\u8FB9\u90A3\u6761\u662F\u300C\u6C38\u8FDC\u9690\u85CF\u300D\uFF0C\u53EA\u6709 \u2325 \u70B9\u300C\u2039\u300D\u624D\u9732\u51FA\u6765\u3002\u83DC\u5355\u680F\u6CA1\u53D8\u65F6 Jarvis \u4E0D\u8BFB\u5B83\uFF0C\u7A7A\u95F2\u4E0D\u5360 CPU\u3002"
      })
    );
    return ui.scroll({ key: "page", children: [ui.stack({ key: "content", children })] });
  }

  // extensions/menubar/src/index.ts
  var controller = new Controller();
  var page = new PageSession();
  var toolbox = {
    activate: (context) => page.activate(context),
    deactivate: () => page.deactivate(),
    render: () => renderPage(page)
  };
  defineExtension({
    toolbox,
    commands: {
      toggle: () => controller.toggle()
    },
    menuBar: {
      start: (context) => controller.start(context.preferences, context.granted),
      select: (_context, itemId) => controller.select(itemId),
      press: (_context, statusItem, modifiers) => {
        if (statusItem === TOGGLE) return controller.press(modifiers);
      }
    }
  });
})();
