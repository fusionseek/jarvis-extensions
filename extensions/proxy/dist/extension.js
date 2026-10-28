// jarvis-extension bundle · proxy@1.0.0 · sdk 2.9.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
    image: make("image")
  };

  // sdk/src/index.ts
  var sdkVersion = "2.9.0";
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
      const page = this.surfaceDefinition(this.activeSurface);
      if (page) return page.render();
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
    daemon: namespaced("daemon"),
    systemProxy: namespaced("systemProxy")
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
      update: (model) => call.menuBar("update", model)
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
    // 常驻进程（SDK 2.9）：入参原样上线缆，占位符展开、控制口校验都在宿主。
    daemon: {
      start: (request) => call.daemon("start", request),
      stop: (id) => call.daemon("stop", { id }),
      status: (id, executable) => call.daemon("status", executable === void 0 ? { id } : { id, executable }),
      logs: (id) => call.daemon("logs", { id }),
      request: (request) => call.daemon("request", request),
      observe: (id, listener) => runtime.subscribe("daemon", "observe", listener, { id })
    },
    // 系统代理（SDK 2.9）：主机由宿主写死 127.0.0.1，扩展只给端口与例外。
    systemProxy: {
      status: () => call.systemProxy("status"),
      enable: (request) => call.systemProxy("enable", request),
      disable: () => call.systemProxy("disable")
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

  // extensions/proxy/src/clash.ts
  var DAEMON_ID = "sing-box";
  function randomSecret(random = Math.random) {
    let secret = "";
    for (let index = 0; index < 32; index += 1) secret += Math.floor(random() * 16).toString(16);
    return secret;
  }
  var delayTimeoutMs = 5e3;
  var delayConcurrency = 4;
  function proxyPath(name) {
    return `/proxies/${encodeURIComponent(name)}`;
  }
  function delayPath(name, url, timeoutMs = delayTimeoutMs) {
    return `${proxyPath(name)}/delay?url=${encodeURIComponent(url)}&timeout=${Math.round(timeoutMs)}`;
  }
  function parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function parseDelay(response) {
    if (response.status !== 200) return null;
    const body = parseJSON(response.text);
    const delay = isRecord(body) ? body.delay : void 0;
    return typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? Math.round(delay) : null;
  }
  function parseGroupNow(response) {
    if (response.status !== 200) return null;
    const body = parseJSON(response.text);
    const now = isRecord(body) ? body.now : void 0;
    return typeof now === "string" && now.length > 0 ? now : null;
  }
  function parseConnections(response) {
    if (response.status !== 200) return null;
    const body = parseJSON(response.text);
    if (!isRecord(body)) return null;
    const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
    const string = (value) => typeof value === "string" ? value : "";
    const list = Array.isArray(body.connections) ? body.connections : [];
    const connections = [];
    for (const item of list) {
      if (!isRecord(item)) continue;
      const metadata = isRecord(item.metadata) ? item.metadata : {};
      const domain = string(metadata.host);
      const port = string(metadata.destinationPort);
      const address = domain || string(metadata.destinationIP);
      const started = Date.parse(string(item.start));
      connections.push({
        id: string(item.id),
        host: address && port ? `${address}:${port}` : address,
        network: string(metadata.network),
        rule: string(item.rule),
        chains: Array.isArray(item.chains) ? item.chains.filter((chain) => typeof chain === "string") : [],
        upload: number(item.upload),
        download: number(item.download),
        start: Number.isFinite(started) ? started : 0
      });
    }
    return { uploadTotal: number(body.uploadTotal), downloadTotal: number(body.downloadTotal), connections };
  }
  function trafficRate(previous, next) {
    if (!previous) return null;
    const seconds = (next.at - previous.at) / 1e3;
    if (seconds < 0.2) return null;
    const up = next.upload - previous.upload;
    const down = next.download - previous.download;
    if (up < 0 || down < 0) return null;
    return { up: up / seconds, down: down / seconds };
  }
  var units = ["B", "KB", "MB", "GB", "TB"];
  function formatBytes(bytes) {
    let value = Math.max(0, bytes);
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    if (unit === 0) return `${Math.round(value)} B`;
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }
  function formatRate(bytesPerSecond) {
    return `${formatBytes(bytesPerSecond)}/s`;
  }
  function compactRate(rate) {
    const short = (bytesPerSecond) => formatBytes(bytesPerSecond).replace(" ", "").replace(/B$/, "") || "0";
    return `\u2193${short(rate.down)} \u2191${short(rate.up)}`;
  }
  function formatDelay(delay) {
    if (delay === void 0) return "";
    return delay === null ? "\u8D85\u65F6" : `${delay} ms`;
  }
  async function runLimited(items, limit, work) {
    let next = 0;
    const lane = async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await work(item);
      }
    };
    const lanes = [];
    for (let index = 0; index < Math.max(1, Math.min(limit, items.length)); index += 1) lanes.push(lane());
    await Promise.all(lanes);
  }

  // extensions/proxy/src/nodes.ts
  var proxyProtocols = ["shadowsocks", "vmess", "vless", "trojan", "hysteria2", "tuic"];
  var SELECTOR_TAG = "\u8282\u70B9\u9009\u62E9";
  var URLTEST_TAG = "\u81EA\u52A8\u9009\u62E9";
  var DIRECT_TAG = "direct";
  var reservedTags = [SELECTOR_TAG, URLTEST_TAG, DIRECT_TAG];
  function claimUniqueName(base, used) {
    let name = base;
    for (let index = 2; used.has(name); index += 1) name = `${base} ${index}`;
    used.add(name);
    return name;
  }
  function dedupeNodeNames(nodes) {
    const used = new Set(reservedTags);
    return nodes.map((node) => {
      const base = node.name.trim() || endpointLabel(node.server, node.port);
      const name = claimUniqueName(base, used);
      return name === node.name ? node : { ...node, name };
    });
  }
  function endpointLabel(server, port) {
    return server.includes(":") ? `[${server}]:${port}` : `${server}:${port}`;
  }

  // extensions/proxy/src/singbox-config.ts
  var clashModeNames = { rule: "Rule", global: "Global", direct: "Direct" };
  var MIXED_INBOUND_TAG = "mixed-in";
  var LOCAL_DNS_TAG = "local";
  var RULE_SET_HTTP_CLIENT_TAG = "rule-set-direct";
  var chinaRuleSets = [
    { tag: "geosite-cn", url: "https://testingcf.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs" },
    { tag: "geoip-cn", url: "https://testingcf.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs" }
  ];
  function buildConfig(options) {
    validate(options);
    const nodes = dedupeNodeNames(options.nodes);
    const names = nodes.map((node) => node.name);
    const members = [URLTEST_TAG, ...names];
    const selected = options.selected !== void 0 && members.includes(options.selected) ? options.selected : URLTEST_TAG;
    const rules = [
      { action: "sniff" },
      { ip_is_private: true, domain_suffix: ["localhost", "local"], action: "route", outbound: DIRECT_TAG },
      { clash_mode: clashModeNames.direct, action: "route", outbound: DIRECT_TAG },
      { clash_mode: clashModeNames.global, action: "route", outbound: SELECTOR_TAG }
    ];
    const route = {
      rules,
      final: SELECTOR_TAG,
      default_domain_resolver: LOCAL_DNS_TAG
    };
    const config = {
      log: { level: "info", timestamp: true },
      dns: {
        servers: [{ type: "local", tag: LOCAL_DNS_TAG }]
      },
      inbounds: [{ type: "mixed", tag: MIXED_INBOUND_TAG, listen: "127.0.0.1", listen_port: options.mixedPort }],
      outbounds: [
        {
          type: "selector",
          tag: SELECTOR_TAG,
          outbounds: members,
          default: selected,
          // 手动换节点多半是因为当前这个慢了或断了；不打断旧连接的话，开着的页面与长连接还挂在坏节点上，「切了没用」。
          interrupt_exist_connections: true
        },
        // 自动切换不打断：它是在后台按延迟挑，挑中更快的那个不代表旧的那条连接已经坏了。
        { type: "urltest", tag: URLTEST_TAG, outbounds: names, url: options.testURL },
        ...nodes.map((node) => ({ type: node.outbound.type, tag: node.name, ...cloneOutbound(node.outbound) })),
        { type: "direct", tag: DIRECT_TAG }
      ],
      route,
      experimental: {
        // 相对路径：sing-box 以 `-D <工作目录>` 启动，`cache.db` 落在宿主给的那个目录里。
        // 它记住「节点选择」选中的节点、当前出站模式与下载过的规则集——下次启动时这三样**以它为准**，
        // `selector.default` 与 `default_mode` 只在第一次（或缓存里的值不再是组员 / 模式）时生效。
        cache_file: { enabled: true },
        clash_api: {
          external_controller: `127.0.0.1:${options.controlPort}`,
          secret: options.controlSecret,
          default_mode: clashModeNames[options.mode]
        }
      }
    };
    if (options.chinaRules) {
      rules.push(
        { rule_set: "geosite-cn", action: "route", outbound: DIRECT_TAG },
        { rule_set: "geoip-cn", action: "route", outbound: DIRECT_TAG }
      );
      route.rule_set = chinaRuleSets.map((set) => ({ type: "remote", tag: set.tag, format: "binary", url: set.url }));
      config.http_clients = [{ tag: RULE_SET_HTTP_CLIENT_TAG }];
      route.default_http_client = RULE_SET_HTTP_CLIENT_TAG;
    }
    return config;
  }
  function terminalProxyCommand(mixedPort) {
    const http = `http://127.0.0.1:${mixedPort}`;
    return `export https_proxy=${http} http_proxy=${http} all_proxy=socks5://127.0.0.1:${mixedPort}`;
  }
  function cloneOutbound(outbound) {
    const copy = JSON.parse(JSON.stringify(outbound));
    delete copy.tag;
    return copy;
  }
  function validate(options) {
    if (options.nodes.length === 0) throw new Error("\u6CA1\u6709\u53EF\u7528\u7684\u8282\u70B9\uFF1A\u5148\u66F4\u65B0\u8BA2\u9605");
    for (const [label, port] of [
      ["\u672C\u5730\u7AEF\u53E3", options.mixedPort],
      ["\u63A7\u5236\u7AEF\u53E3", options.controlPort]
    ]) {
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`${label}\u5FC5\u987B\u662F 1024\u201365535 \u4E4B\u95F4\u7684\u6574\u6570\uFF1A${port}`);
    }
    if (options.mixedPort === options.controlPort) throw new Error(`\u672C\u5730\u7AEF\u53E3\u4E0E\u63A7\u5236\u7AEF\u53E3\u4E0D\u80FD\u76F8\u540C\uFF1A${options.mixedPort}`);
    if (options.controlSecret.length === 0) throw new Error("\u63A7\u5236\u53E3\u7684 secret \u4E0D\u80FD\u4E3A\u7A7A");
    if (!/^https?:\/\/\S+$/i.test(options.testURL)) throw new Error(`\u5EF6\u8FDF\u6D4B\u8BD5\u5730\u5740\u5FC5\u987B\u662F http(s) \u5730\u5740\uFF1A${options.testURL}`);
    if (!Object.prototype.hasOwnProperty.call(clashModeNames, options.mode)) throw new Error(`\u4E0D\u8BA4\u8BC6\u7684\u51FA\u7AD9\u6A21\u5F0F\uFF1A${options.mode}`);
  }

  // extensions/proxy/src/store.ts
  var storageKeys = {
    /** `SubscriptionRecord[]`，按偏好里地址的顺序。 */
    subscriptions: "subscriptions",
    /** `Selection`：出站模式与「节点选择」选中的组员。 */
    selection: "selection",
    /** `LatencyRecord`：每个节点最近一次测速。 */
    latency: "latency",
    /** `ControlRecord`：此刻在跑的那一份内核的控制口与它用的设置。 */
    control: "control",
    /** `FailureRecord`：最近一次起不来 / 意外退出；成功开启或用户关掉时清掉。 */
    failure: "failure",
    /** `Schedule`：订阅自动更新的日程。 */
    schedule: "schedule"
  };
  function nodeChunkKey(subscriptionId2, index) {
    return `nodes:${subscriptionId2}:${index}`;
  }
  var maximumChunkBytes = 48 * 1024;
  function utf8Length(text) {
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 55296 && code <= 56319) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  }
  function chunkNodes(nodes, maxBytes = maximumChunkBytes) {
    const chunks = [];
    let current = [];
    let size = 2;
    for (const node of nodes) {
      const bytes = utf8Length(JSON.stringify(node)) + 1;
      if (current.length > 0 && size + bytes > maxBytes) {
        chunks.push(current);
        current = [];
        size = 2;
      }
      current.push(node);
      size += bytes;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }
  function headerValue(headers, name) {
    const lowered = name.toLowerCase();
    for (const key of Object.keys(headers)) if (key.toLowerCase() === lowered) return headers[key];
    return void 0;
  }
  function parseSubscriptionUserinfo(value) {
    if (!value) return null;
    const fields = {};
    for (const part of value.split(";")) {
      const match = /^\s*([a-z]+)\s*=\s*(\d+(?:\.\d+)?)\s*$/i.exec(part);
      if (match) fields[match[1].toLowerCase()] = Number(match[2]);
    }
    if (fields.upload === void 0 && fields.download === void 0 && fields.total === void 0) return null;
    return {
      upload: fields.upload ?? 0,
      download: fields.download ?? 0,
      total: fields.total ?? 0,
      expire: fields.expire ? fields.expire * 1e3 : null
    };
  }
  var maximumSkippedPerSubscription = 30;
  function fnv1a(text, seed) {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }
  function digest(text) {
    const hex = (value) => `00000000${value.toString(16)}`.slice(-8);
    return hex(fnv1a(text, 2166136261)) + hex(fnv1a(text, 19088743));
  }
  function subscriptionId(url) {
    return digest(url.trim());
  }
  function subscriptionHost(url) {
    const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url.trim());
    return match ? match[1].toLowerCase() : "\u8BA2\u9605";
  }
  function nodesDigest(nodes) {
    return digest(JSON.stringify(nodes));
  }
  var updateIntervals = ["never", "6h", "daily"];
  function updateIntervalMs(interval) {
    switch (interval) {
      case "6h":
        return 6 * 60 * 60 * 1e3;
      case "daily":
        return 24 * 60 * 60 * 1e3;
      default:
        return null;
    }
  }
  var retryAfterFailureMs = 30 * 60 * 1e3;
  function isUpdateDue(schedule, interval, now) {
    const period = updateIntervalMs(interval);
    if (period === null) return false;
    if (schedule.lastAttemptAt !== null && now - schedule.lastAttemptAt < Math.min(period, retryAfterFailureMs)) return false;
    return schedule.lastSuccessAt === null || now - schedule.lastSuccessAt >= period;
  }
  function nextRecord(previous, url, position, outcome, chunks, now) {
    const base = previous ? { ...previous, position, host: subscriptionHost(url) } : {
      id: subscriptionId(url),
      host: subscriptionHost(url),
      position,
      format: null,
      nodeCount: 0,
      chunks: 0,
      skipped: [],
      skippedTotal: 0,
      fetchedAt: null,
      attemptedAt: now,
      error: null,
      usage: null
    };
    if (!outcome.ok) {
      const failed = { ...base, attemptedAt: now, error: outcome.error };
      if (!outcome.skipped) return failed;
      return { ...failed, skipped: outcome.skipped.slice(0, maximumSkippedPerSubscription), skippedTotal: outcome.skipped.length };
    }
    return {
      ...base,
      format: outcome.format,
      nodeCount: outcome.nodes.length,
      chunks,
      skipped: outcome.skipped.slice(0, maximumSkippedPerSubscription),
      skippedTotal: outcome.skipped.length,
      fetchedAt: now,
      attemptedAt: now,
      error: null,
      usage: outcome.usage
    };
  }
  function formatAge(at, now) {
    const seconds = Math.max(0, Math.round((now - at) / 1e3));
    if (seconds < 60) return "\u521A\u521A";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} \u5C0F\u65F6\u524D`;
    return `${Math.floor(hours / 24)} \u5929\u524D`;
  }
  function describeUsage(usage) {
    const gigabytes = (bytes) => {
      const value = bytes / 1024 ** 3;
      return `${value < 10 ? value.toFixed(1) : Math.round(value)} GB`;
    };
    const parts = [`\u5DF2\u7528 ${gigabytes(usage.upload + usage.download)}${usage.total > 0 ? ` / ${gigabytes(usage.total)}` : ""}`];
    if (usage.expire !== null) {
      const date = new Date(usage.expire);
      const pad = (value) => `0${value}`.slice(-2);
      parts.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} \u5230\u671F`);
    }
    return parts.join(" \xB7 ");
  }

  // extensions/proxy/src/status.ts
  var defaultPreferences = {
    mixedPort: 7890,
    controlPort: 19090,
    systemProxy: true,
    autoStart: false,
    chinaRules: true,
    testURL: "https://www.gstatic.com/generate_204",
    singBoxPath: "",
    updateInterval: "daily",
    showSpeed: false
  };
  function normalizePreferences(raw) {
    const source = raw ?? {};
    const port = (value, fallback) => typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : fallback;
    const flag2 = (value, fallback) => typeof value === "boolean" ? value : fallback;
    const text = (value, fallback) => typeof value === "string" ? value.trim() : fallback;
    const testURL = text(source.testURL, defaultPreferences.testURL);
    const interval = source.updateInterval;
    return {
      mixedPort: port(source.mixedPort, defaultPreferences.mixedPort),
      controlPort: port(source.controlPort, defaultPreferences.controlPort),
      systemProxy: flag2(source.systemProxy, defaultPreferences.systemProxy),
      autoStart: flag2(source.autoStart, defaultPreferences.autoStart),
      chinaRules: flag2(source.chinaRules, defaultPreferences.chinaRules),
      // sing-box 的测速只认 https（`http://` 开头的地址会被它丢掉、换成默认地址）：填错了就用默认，免得读数与填的对不上。
      testURL: /^https:\/\/\S+$/i.test(testURL) ? testURL : defaultPreferences.testURL,
      singBoxPath: text(source.singBoxPath, ""),
      updateInterval: updateIntervals.includes(interval) ? interval : defaultPreferences.updateInterval,
      showSpeed: flag2(source.showSpeed, defaultPreferences.showSpeed)
    };
  }
  var defaultSelection = { mode: "rule", node: URLTEST_TAG };
  function normalizeSelection(raw) {
    const value = typeof raw === "object" && raw !== null ? raw : {};
    const mode = Object.prototype.hasOwnProperty.call(clashModeNames, value.mode) ? value.mode : defaultSelection.mode;
    const node = typeof value.node === "string" && value.node.length > 0 ? value.node : defaultSelection.node;
    return { mode, node };
  }
  var modeTitles = { rule: "\u89C4\u5219", global: "\u5168\u5C40", direct: "\u76F4\u8FDE" };
  var modeHelps = {
    rule: "\u5C40\u57DF\u7F51\u4E0E\u4E2D\u56FD\u5927\u9646\u76F4\u8FDE\uFF0C\u5176\u4F59\u8D70\u6240\u9009\u8282\u70B9",
    global: "\u9664\u5C40\u57DF\u7F51\u5916\u5168\u90E8\u8D70\u6240\u9009\u8282\u70B9",
    direct: "\u5168\u90E8\u76F4\u8FDE\uFF0C\u4EE3\u7406\u5F00\u7740\u4E5F\u4E0D\u7ECF\u8FC7\u8282\u70B9"
  };
  var protocolTitles = {
    shadowsocks: "Shadowsocks",
    vmess: "VMess",
    vless: "VLESS",
    trojan: "Trojan",
    hysteria2: "Hysteria2",
    tuic: "TUIC"
  };
  var requiredCapability = "process.daemon";
  function phaseOf(input) {
    if (!input.granted.includes(requiredCapability)) return "notGranted";
    if (input.daemon?.state === "running") return "running";
    if (input.daemon && input.daemon.executable === "") return "notInstalled";
    if (input.nodeCount === 0) return "noNodes";
    if (input.failure || input.daemon?.state === "exited") return "failed";
    return "stopped";
  }
  function isRuleSetFailure(text) {
    return /initial rule-set/i.test(text);
  }
  function describeFailure(lines, preferences) {
    const text = lines.join("\n");
    const last = lastMeaningfulLine(lines);
    const portMatch = /listen tcp [^:\s]*:(\d+).*address already in use/i.exec(text) ?? /:(\d+): bind: address already in use/i.exec(text);
    if (portMatch || /address already in use/i.test(text)) {
      const port = portMatch ? Number(portMatch[1]) : null;
      const which = port === preferences.controlPort ? "\u63A7\u5236\u7AEF\u53E3" : port === preferences.mixedPort ? "\u672C\u5730\u7AEF\u53E3" : "\u7AEF\u53E3";
      return {
        message: port ? `${which} ${port} \u88AB\u522B\u7684\u7A0B\u5E8F\u5360\u7740` : "\u7AEF\u53E3\u88AB\u522B\u7684\u7A0B\u5E8F\u5360\u7740",
        hint: `\u5728\u8BBE\u7F6E\u91CC\u6362\u4E00\u4E2A${which === "\u7AEF\u53E3" ? "\u672C\u5730\u7AEF\u53E3\u6216\u63A7\u5236\u7AEF\u53E3" : which}\uFF0C\u6216\u8005\u5148\u5173\u6389\u5360\u7740\u5B83\u7684\u7A0B\u5E8F\u3002`
      };
    }
    if (isRuleSetFailure(text)) {
      return { message: "\u4E2D\u56FD\u5927\u9646\u5206\u6D41\u89C4\u5219\u96C6\u4E0B\u8F7D\u5931\u8D25", hint: "\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\uFF1B\u6216\u8005\u5728\u8BBE\u7F6E\u91CC\u5173\u6389\u300C\u4E2D\u56FD\u5927\u9646\u76F4\u8FDE\u300D\uFF0C\u4E0D\u5206\u6D41\u8FD0\u884C\u3002" };
    }
    if (/unknown field|unknown (?:transport|obfs|outbound|inbound) type|decode config/i.test(text)) {
      return { message: "sing-box \u4E0D\u8BA4\u8BC6\u8FD9\u4EFD\u914D\u7F6E", hint: "\u88C5\u7740\u7684 sing-box \u53EF\u80FD\u592A\u65E7\uFF08\u9700\u8981 1.12 \u4EE5\u4E0A\uFF09\u3002\u5728\u7EC8\u7AEF\u91CC\u8FD0\u884C brew upgrade sing-box \u4E4B\u540E\u91CD\u8BD5\u3002" };
    }
    if (/reality/i.test(text) && /(handshake|verif|invalid|processed invalid connection|EOF)/i.test(text)) {
      return {
        message: "REALITY \u63E1\u624B\u5931\u8D25",
        hint: "sing-box \u7248\u672C\u592A\u65E7\u65F6\u8FDE\u4E0D\u4E0A\u65B0\u7684 REALITY \u670D\u52A1\u7AEF\u3002\u5728\u7EC8\u7AEF\u91CC\u8FD0\u884C brew upgrade sing-box \u4E4B\u540E\u91CD\u8BD5\uFF1B\u4ECD\u4E0D\u884C\u5C31\u6362\u4E00\u4E2A\u8282\u70B9\u3002"
      };
    }
    return { message: last || "sing-box \u6CA1\u80FD\u542F\u52A8", hint: "" };
  }
  function lastMeaningfulLine(lines) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].replace(/\u001b\[[0-9;]*m/g, "").replace(/^[+-]\d{4} \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+/, "").trim();
      if (line.length > 0) return line;
    }
    return "";
  }
  function restartReasons(control, preferences, digestNow) {
    if (!control) return [];
    const reasons = [];
    if (control.nodesDigest !== digestNow) reasons.push("\u8BA2\u9605\u66F4\u65B0\u8FC7");
    if (control.mixedPort !== preferences.mixedPort) reasons.push("\u672C\u5730\u7AEF\u53E3\u6539\u8FC7");
    if (control.controlPort !== preferences.controlPort) reasons.push("\u63A7\u5236\u7AEF\u53E3\u6539\u8FC7");
    if (control.testURL !== preferences.testURL) reasons.push("\u5EF6\u8FDF\u6D4B\u8BD5\u5730\u5740\u6539\u8FC7");
    if (control.chinaRules !== preferences.chinaRules && !control.ruleSetFallback) reasons.push("\u4E2D\u56FD\u5927\u9646\u76F4\u8FDE\u6539\u8FC7");
    return reasons;
  }
  function parseToggleArgument(argument) {
    const value = (argument ?? "").trim().toLowerCase();
    if (value === "") return "toggle";
    if (/^(开|开启|打开|启动|on|start|enable)$/.test(value)) return "on";
    if (/^(关|关闭|停止|停|off|stop|disable)$/.test(value)) return "off";
    return null;
  }
  function systemProxyCondition(proxy, granted) {
    if (!granted.includes("system.proxy")) return { kind: "notGranted" };
    if (!proxy) return { kind: "off" };
    if (proxy.blocker) return { kind: "blocked", message: proxy.blocker.message };
    if (proxy.owner === "other") return { kind: "other", message: `\u7CFB\u7EDF\u4EE3\u7406\u5DF2\u7531\u300C${proxy.otherName ?? "\u53E6\u4E00\u4E2A\u6269\u5C55"}\u300D\u63A5\u7BA1` };
    if (proxy.owner === "self") return { kind: "active" };
    return { kind: "off" };
  }
  var maximumMenuNodes = 250;
  function menuText(text) {
    if (text.length <= 80) return text;
    let cut = text.slice(0, 80);
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return cut;
  }
  function nodeItemId(index) {
    return index < 0 ? "node:auto" : `node:${index}`;
  }
  function parseMenuItemId(id) {
    switch (id) {
      case "toggle":
      case "systemProxy":
      case "test":
      case "update":
      case "copy":
      case "install":
        return { kind: id };
    }
    const mode = /^mode:(rule|global|direct)$/.exec(id);
    if (mode) return { kind: "mode", mode: mode[1] };
    if (id === "node:auto") return { kind: "node", index: -1 };
    const node = /^node:(\d+)$/.exec(id);
    if (node) return { kind: "node", index: Number(node[1]) };
    return null;
  }
  function statusLine(input) {
    if (input.busy) return input.busy;
    switch (input.phase) {
      case "notGranted":
        return "\u8FD8\u6CA1\u6388\u6743\uFF1A\u6253\u5F00\u300C\u4EE3\u7406\u300D\u70B9\u6388\u6743";
      case "notInstalled":
        return input.preferences.singBoxPath ? "\u8BBE\u7F6E\u91CC\u586B\u7684 sing-box \u8DEF\u5F84\u4E0D\u53EF\u7528" : "\u6CA1\u6709\u627E\u5230 sing-box";
      case "noNodes":
        return "\u6CA1\u6709\u8282\u70B9\uFF1A\u5728\u8BBE\u7F6E\u91CC\u586B\u8BA2\u9605\u5730\u5740";
      case "running":
        return `\u5DF2\u5F00\u542F \xB7 ${modeTitles[input.selection.mode]} \xB7 127.0.0.1:${input.preferences.mixedPort}`;
      case "failed":
        return menuText(`\u51FA\u9519\u4E86\uFF1A${input.failure?.message ?? "sing-box \u9000\u51FA\u4E86"}`);
      default:
        return "\u5DF2\u5173\u95ED";
    }
  }
  function buildMenuModel(input) {
    const running = input.phase === "running";
    const symbol = running ? "network" : input.phase === "failed" ? "exclamationmark.triangle" : "network.slash";
    const items = [{ kind: "header", title: menuText(statusLine(input)) }];
    if (input.phase === "notInstalled") {
      if (!input.preferences.singBoxPath && input.granted.includes("terminal.run")) {
        items.push({ kind: "item", id: "install", title: "\u5728\u7EC8\u7AEF\u4E2D\u5B89\u88C5 sing-box", symbol: "terminal" });
      }
    } else if (input.phase !== "notGranted" && input.phase !== "noNodes") {
      items.push({
        kind: "item",
        id: "toggle",
        title: running ? "\u5173\u95ED\u4EE3\u7406" : "\u5F00\u542F\u4EE3\u7406",
        symbol: running ? "stop.circle" : "play.circle",
        enabled: input.busy === null
      });
    }
    const condition = systemProxyCondition(input.proxy, input.granted);
    const proxySubtitle = condition.kind === "blocked" || condition.kind === "other" ? condition.message : condition.kind === "notGranted" ? "\u6CA1\u6709\u6388\u6743\u4FEE\u6539\u7CFB\u7EDF\u4EE3\u7406" : void 0;
    items.push({ kind: "separator" });
    items.push({
      kind: "item",
      id: "systemProxy",
      title: "\u7CFB\u7EDF\u4EE3\u7406",
      ...proxySubtitle ? { subtitle: menuText(proxySubtitle) } : {},
      checked: running && condition.kind === "active",
      enabled: running && input.busy === null && condition.kind !== "notGranted" && condition.kind !== "other"
    });
    items.push({
      kind: "submenu",
      title: `\u51FA\u7AD9\u6A21\u5F0F \xB7 ${modeTitles[input.selection.mode]}`,
      items: Object.keys(modeTitles).map((mode) => ({
        kind: "item",
        id: `mode:${mode}`,
        title: modeTitles[mode],
        subtitle: modeHelps[mode],
        checked: input.selection.mode === mode
      }))
    });
    if (input.nodes.length > 0) {
      const shown = input.nodes.slice(0, maximumMenuNodes);
      const autoSubtitle = input.autoPick && running ? `\u6B64\u523B\uFF1A${input.autoPick}` : "\u6309\u5EF6\u8FDF\u81EA\u52A8\u6311\u6700\u5FEB\u7684";
      const nodeItems = [
        { kind: "item", id: nodeItemId(-1), title: URLTEST_TAG, subtitle: menuText(autoSubtitle), checked: input.selection.node === URLTEST_TAG },
        { kind: "separator" },
        ...shown.map((node, index) => {
          const delay = formatDelay(input.latency[node.name]);
          return {
            kind: "item",
            id: nodeItemId(index),
            title: menuText(node.name),
            subtitle: delay ? `${protocolTitles[node.protocol]} \xB7 ${delay}` : protocolTitles[node.protocol],
            checked: input.selection.node === node.name
          };
        })
      ];
      if (input.nodes.length > shown.length) {
        nodeItems.push({ kind: "item", id: "nodes-more", title: `\u53E6\u6709 ${input.nodes.length - shown.length} \u4E2A\u8282\u70B9\uFF0C\u5728\u300C\u4EE3\u7406\u300D\u7A97\u53E3\u91CC\u770B`, enabled: false });
      }
      const current = input.selection.node === URLTEST_TAG ? URLTEST_TAG : input.selection.node;
      items.push({ kind: "submenu", title: menuText(`\u8282\u70B9 \xB7 ${current}`), items: nodeItems });
    }
    items.push({ kind: "separator" });
    items.push({ kind: "item", id: "test", title: "\u6D4B\u901F", symbol: "speedometer", enabled: running && input.busy === null && input.nodes.length > 0 });
    items.push({ kind: "item", id: "update", title: "\u66F4\u65B0\u8BA2\u9605", symbol: "arrow.clockwise", enabled: input.busy === null });
    items.push({ kind: "item", id: "copy", title: "\u590D\u5236\u7EC8\u7AEF\u4EE3\u7406\u547D\u4EE4", symbol: "doc.on.clipboard", enabled: input.granted.includes("clipboard.write") });
    const model = { symbol, items, tooltip: menuText(`\u4EE3\u7406 \xB7 ${statusLine(input)}`) };
    if (running && input.preferences.showSpeed && input.rate) model.title = compactRate(input.rate);
    return model;
  }

  // extensions/proxy/src/subscription.ts
  var skippedLineLimit = 200;
  function parseSubscription(text) {
    const body = text.trim();
    if (body.length === 0) return { format: "links", nodes: [], skipped: [] };
    if (body.startsWith("{")) return parseSingBoxDocument(body);
    if (/^<(?:!doctype|html|\?xml)/i.test(body)) {
      return { format: "links", nodes: [], skipped: [whole(body, "\u6536\u5230\u7684\u662F\u7F51\u9875\u800C\u4E0D\u662F\u8BA2\u9605\u5185\u5BB9\uFF1A\u8BA2\u9605\u5730\u5740\u53EF\u80FD\u586B\u9519\u4E86\uFF0C\u6216\u8005\u8BA2\u9605\u5DF2\u7ECF\u8FC7\u671F")] };
    }
    if (/^proxies\s*:/m.test(body)) {
      return { format: "links", nodes: [], skipped: [whole(body, "\u8FD9\u662F Clash YAML \u683C\u5F0F\u7684\u8BA2\u9605\uFF0C\u672C\u671F\u53EA\u8BA4\u5206\u4EAB\u94FE\u63A5\u4E0E sing-box JSON")] };
    }
    if (body.includes("://")) return { format: "links", ...parseLinkLines(body) };
    const decoded = decodeBase64Text(body);
    if (decoded !== null) {
      if (decoded.includes("://")) return { format: "base64", ...parseLinkLines(decoded) };
      return { format: "base64", nodes: [], skipped: [whole(decoded, "base64 \u89E3\u5F00\u4E4B\u540E\u4E0D\u662F\u5206\u4EAB\u94FE\u63A5")] };
    }
    return { format: "links", ...parseLinkLines(body) };
  }
  function parseLinkLines(text) {
    const nodes = [];
    const skipped = [];
    const used = new Set(reservedTags);
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;
      const result = parseShareLink(line);
      if (result.ok) nodes.push(withUniqueName(result.node, used));
      else skipped.push({ line: clampLine(line), reason: result.reason });
    }
    return { nodes, skipped };
  }
  function withUniqueName(node, used) {
    const name = claimUniqueName(node.name, used);
    return name === node.name ? node : { ...node, name };
  }
  function whole(text, reason) {
    const first = text.split(/\r\n|\r|\n/).find((line) => line.trim().length > 0) ?? "";
    return { line: clampLine(first.trim()), reason };
  }
  function clampLine(line) {
    if (line.length <= skippedLineLimit) return line;
    let cut = line.slice(0, skippedLineLimit - 1);
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut}\u2026`;
  }
  var nonNodeOutboundTypes = /* @__PURE__ */ new Set(["selector", "urltest", "direct", "block", "dns"]);
  function parseSingBoxDocument(body) {
    let document;
    try {
      document = JSON.parse(body);
    } catch (error) {
      return { format: "sing-box", nodes: [], skipped: [whole(body, `JSON \u89E3\u6790\u5931\u8D25\uFF1A${errorMessage(error)}`)] };
    }
    const outbounds = isRecord2(document) ? document.outbounds : void 0;
    if (!Array.isArray(outbounds)) {
      return { format: "sing-box", nodes: [], skipped: [whole(body, "JSON \u91CC\u6CA1\u6709 outbounds \u6570\u7EC4\uFF0C\u4E0D\u662F sing-box \u914D\u7F6E")] };
    }
    const nodes = [];
    const skipped = [];
    const used = new Set(reservedTags);
    outbounds.forEach((item, index) => {
      const result = singBoxOutboundNode(item);
      if (result === null) return;
      if (result.ok) nodes.push(withUniqueName(result.node, used));
      else skipped.push({ line: clampLine(`outbounds[${index}] ${safeStringify(item)}`), reason: result.reason });
    });
    const endpoints = isRecord2(document) ? document.endpoints : void 0;
    if (Array.isArray(endpoints)) {
      endpoints.forEach((item, index) => {
        const type = isRecord2(item) && typeof item.type === "string" ? item.type : "\u672A\u77E5";
        skipped.push({ line: clampLine(`endpoints[${index}] ${safeStringify(item)}`), reason: `\u672C\u671F\u4E0D\u652F\u6301 ${type} \u7AEF\u70B9\uFF08endpoint\uFF09` });
      });
    }
    return { format: "sing-box", nodes, skipped };
  }
  function singBoxOutboundNode(item) {
    if (!isRecord2(item)) return fail("\u4E0D\u662F\u4E00\u4E2A\u51FA\u7AD9\u5BF9\u8C61");
    const type = typeof item.type === "string" ? item.type : "";
    if (nonNodeOutboundTypes.has(type)) return null;
    if (!isProxyProtocol(type)) return fail(type ? `\u672C\u671F\u4E0D\u652F\u6301 ${type} \u51FA\u7AD9` : "\u51FA\u7AD9\u6CA1\u6709 type");
    if (typeof item.detour === "string" && item.detour.length > 0) return fail("\u7ECF\u7531\u53E6\u4E00\u4E2A\u51FA\u7AD9\uFF08detour\uFF09\u7684\u94FE\u5F0F\u8282\u70B9\u672C\u671F\u4E0D\u652F\u6301");
    const server = typeof item.server === "string" ? stripBrackets(item.server.trim()) : "";
    if (server.length === 0) return fail("\u51FA\u7AD9\u6CA1\u6709 server");
    let port = typeof item.server_port === "number" && isValidPort(item.server_port) ? item.server_port : 0;
    if (port === 0 && type === "hysteria2" && Array.isArray(item.server_ports)) {
      const first = item.server_ports[0];
      port = typeof first === "string" ? parsePortNumber(first.split(/[:-]/)[0]) ?? 0 : 0;
    }
    if (port === 0) return fail("\u51FA\u7AD9\u6CA1\u6709\u5408\u6CD5\u7684 server_port");
    const outbound = JSON.parse(JSON.stringify(item));
    const tag = typeof outbound.tag === "string" ? outbound.tag.trim() : "";
    delete outbound.tag;
    delete outbound.domain_resolver;
    delete outbound.domain_strategy;
    outbound.server = server;
    return ok({ name: tag || endpointLabel(server, port), protocol: type, server, port, outbound });
  }
  function parseShareLink(line) {
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(line);
    if (!match) return fail("\u4E0D\u662F\u5206\u4EAB\u94FE\u63A5");
    const scheme = match[1].toLowerCase();
    try {
      switch (scheme) {
        case "ss":
          return parseShadowsocks(line);
        case "vmess":
          return parseVMess(line);
        case "vless":
          return parseVLESS(line);
        case "trojan":
          return parseTrojan(line);
        case "hysteria2":
        case "hy2":
          return parseHysteria2(line);
        case "tuic":
          return parseTUIC(line);
        case "ssr":
          return fail("sing-box \u4E0D\u652F\u6301 ShadowsocksR");
        case "hysteria":
          return fail("\u672C\u671F\u4E0D\u652F\u6301 Hysteria\uFF08\u7B2C\u4E00\u7248\uFF09\u94FE\u63A5\uFF0C\u53EA\u8BA4 hysteria2");
        default:
          return fail(`\u672C\u671F\u4E0D\u652F\u6301 ${scheme}:// \u94FE\u63A5`);
      }
    } catch (error) {
      return fail(`\u89E3\u6790\u51FA\u9519\uFF1A${errorMessage(error)}`);
    }
  }
  function splitLink(line) {
    let rest = line.slice(line.indexOf("://") + 3);
    let fragment = "";
    const hash = rest.indexOf("#");
    if (hash >= 0) {
      fragment = rest.slice(hash + 1);
      rest = rest.slice(0, hash);
    }
    let query = "";
    const question = rest.indexOf("?");
    if (question >= 0) {
      query = rest.slice(question + 1);
      rest = rest.slice(0, question);
    }
    let userinfo = null;
    const at = rest.lastIndexOf("@");
    if (at >= 0) {
      userinfo = rest.slice(0, at);
      rest = rest.slice(at + 1);
    }
    const slash = rest.indexOf("/");
    const hostPort = slash >= 0 ? rest.slice(0, slash) : rest;
    const { host, port } = splitHostPort(hostPort);
    return { userinfo, host, port, params: parseQuery(query), name: percentDecode(fragment).trim() };
  }
  function splitHostPort(text) {
    if (text.startsWith("[")) {
      const close = text.indexOf("]");
      if (close < 0) return { host: text, port: "" };
      const after = text.slice(close + 1);
      return { host: text.slice(1, close), port: after.startsWith(":") ? after.slice(1) : "" };
    }
    const colon = text.lastIndexOf(":");
    if (colon < 0) return { host: percentDecode(text), port: "" };
    return { host: percentDecode(text.slice(0, colon)), port: text.slice(colon + 1) };
  }
  function parseQuery(query) {
    const params = /* @__PURE__ */ new Map();
    for (const pair of query.split("&")) {
      if (pair.length === 0) continue;
      const equals = pair.indexOf("=");
      const key = percentDecode(equals >= 0 ? pair.slice(0, equals) : pair);
      const value = equals >= 0 ? percentDecode(pair.slice(equals + 1)) : "";
      if (!params.has(key)) params.set(key, value);
    }
    return params;
  }
  function param(params, ...keys) {
    for (const key of keys) {
      const value = params.get(key);
      if (value !== void 0 && value.trim().length > 0) return value.trim();
    }
    return "";
  }
  function flag(params, ...keys) {
    return /^(?:1|true|yes)$/i.test(param(params, ...keys));
  }
  function finishNode(protocol, endpoint, outbound) {
    const server = endpoint.host.trim();
    if (server.length === 0 || /\s/.test(server)) return fail("\u7F3A\u5C11\u670D\u52A1\u5668\u5730\u5740");
    const port = parsePortNumber(endpoint.port);
    if (port === null) return fail(endpoint.port.length === 0 ? "\u7F3A\u5C11\u7AEF\u53E3" : `\u7AEF\u53E3\u4E0D\u5408\u6CD5\uFF1A${endpoint.port}`);
    const name = endpoint.name.trim();
    return ok({
      name: name.length > 0 ? name : endpointLabel(server, port),
      protocol,
      server,
      port,
      outbound: { type: protocol, server, server_port: port, ...outbound }
    });
  }
  var shadowsocksMethods = /* @__PURE__ */ new Set([
    "2022-blake3-aes-128-gcm",
    "2022-blake3-aes-256-gcm",
    "2022-blake3-chacha20-poly1305",
    "none",
    "aes-128-gcm",
    "aes-192-gcm",
    "aes-256-gcm",
    "chacha20-ietf-poly1305",
    "xchacha20-ietf-poly1305",
    "aes-128-ctr",
    "aes-192-ctr",
    "aes-256-ctr",
    "aes-128-cfb",
    "aes-192-cfb",
    "aes-256-cfb",
    "rc4-md5",
    "chacha20-ietf",
    "xchacha20"
  ]);
  var shadowsocks2022KeyLength = {
    "2022-blake3-aes-128-gcm": 16,
    "2022-blake3-aes-256-gcm": 32,
    "2022-blake3-chacha20-poly1305": 32
  };
  function parseShadowsocks(line) {
    const parts = splitLink(line);
    let method;
    let password;
    let host = parts.host;
    let port = parts.port;
    if (parts.userinfo !== null) {
      const userinfo = percentDecode(parts.userinfo);
      const plain = userinfo.includes(":") ? userinfo : decodeBase64Text(userinfo);
      if (plain === null || !plain.includes(":")) return fail("ss \u94FE\u63A5\u7684\u7528\u6237\u4FE1\u606F\u65E2\u4E0D\u662F base64(method:password) \u4E5F\u4E0D\u662F\u660E\u6587 method:password");
      const colon = plain.indexOf(":");
      method = plain.slice(0, colon);
      password = plain.slice(colon + 1);
    } else {
      let body = line.slice("ss://".length);
      const hash = body.indexOf("#");
      if (hash >= 0) body = body.slice(0, hash);
      const question = body.indexOf("?");
      if (question >= 0) body = body.slice(0, question);
      const decoded = decodeBase64Text(percentDecode(body.replace(/\/+$/, "")));
      if (decoded === null) return fail("ss \u94FE\u63A5\u65E2\u4E0D\u662F SIP002 \u4E5F\u4E0D\u662F\u65E7\u5F0F base64 \u5199\u6CD5");
      const at = decoded.lastIndexOf("@");
      const colon = decoded.indexOf(":");
      if (at < 0 || colon < 0 || colon > at) return fail("\u65E7\u5F0F ss \u94FE\u63A5\u89E3\u5F00\u540E\u4E0D\u662F method:password@host:port");
      method = decoded.slice(0, colon);
      password = decoded.slice(colon + 1, at);
      const endpoint = splitHostPort(decoded.slice(at + 1).trim());
      host = endpoint.host;
      port = endpoint.port;
    }
    method = method.trim().toLowerCase();
    if (!shadowsocksMethods.has(method)) return fail(`sing-box \u4E0D\u652F\u6301\u7684 Shadowsocks \u52A0\u5BC6\u65B9\u5F0F\uFF1A${method || "\uFF08\u7A7A\uFF09"}`);
    const keyLength = shadowsocks2022KeyLength[method];
    if (keyLength !== void 0) {
      const valid = password.split(":").every((key) => decodeBase64(key)?.length === keyLength);
      if (!valid) return fail(`${method} \u7684\u5BC6\u7801\u5FC5\u987B\u662F ${keyLength} \u5B57\u8282\u5BC6\u94A5\u7684 base64`);
    }
    const outbound = { method, password };
    const plugin = parts.params.get("plugin");
    if (plugin !== void 0 && plugin.trim().length > 0) {
      const resolved = shadowsocksPlugin(plugin.trim());
      if (!resolved.ok) return resolved;
      outbound.plugin = resolved.plugin;
      if (resolved.options) outbound.plugin_opts = resolved.options;
    }
    return finishNode("shadowsocks", { host, port, name: parts.name }, outbound);
  }
  function shadowsocksPlugin(value) {
    const semicolon = value.indexOf(";");
    const name = (semicolon >= 0 ? value.slice(0, semicolon) : value).trim();
    const options = semicolon >= 0 ? value.slice(semicolon + 1).trim() : "";
    if (name === "obfs-local" || name === "simple-obfs") {
      const mode = /(?:^|;)obfs=([^;]*)/.exec(options)?.[1];
      if (mode !== void 0 && mode !== "http" && mode !== "tls") return { ok: false, reason: `obfs-local \u4E0D\u8BA4\u8BC6\u7684 obfs \u6A21\u5F0F\uFF1A${mode}` };
      return { ok: true, plugin: "obfs-local", options };
    }
    if (name === "v2ray-plugin") return { ok: true, plugin: "v2ray-plugin", options };
    return { ok: false, reason: `\u9700\u8981\u63D2\u4EF6 ${name}\uFF0Csing-box \u53EA\u5185\u7F6E obfs-local \u4E0E v2ray-plugin` };
  }
  var vmessSecurities = /* @__PURE__ */ new Set(["auto", "none", "zero", "aes-128-gcm", "chacha20-poly1305", "aes-128-cfb"]);
  function parseVMess(line) {
    const payload = line.slice("vmess://".length).split("#")[0].split("?")[0].trim();
    const decoded = decodeBase64Text(percentDecode(payload));
    if (decoded === null) return fail("vmess \u94FE\u63A5\u4E0D\u662F v2rayN \u7684 base64 JSON \u5199\u6CD5");
    let json;
    try {
      json = JSON.parse(decoded);
    } catch {
      return fail("vmess \u94FE\u63A5\u89E3\u5F00\u540E\u4E0D\u662F JSON\uFF08\u53EA\u8BA4 v2rayN \u5199\u6CD5\uFF09");
    }
    if (!isRecord2(json)) return fail("vmess \u94FE\u63A5\u89E3\u5F00\u540E\u4E0D\u662F JSON \u5BF9\u8C61");
    const field = (key) => {
      const value = json[key];
      return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
    };
    const uuid = field("id");
    if (uuid.length === 0) return fail("vmess \u94FE\u63A5\u7F3A\u5C11 id");
    const security = (field("scy") || "auto").toLowerCase();
    if (!vmessSecurities.has(security)) return fail(`sing-box \u4E0D\u652F\u6301\u7684 VMess \u52A0\u5BC6\u65B9\u5F0F\uFF1A${security}`);
    const alterId = Number(field("aid") || "0");
    const outbound = { uuid, security };
    if (Number.isInteger(alterId) && alterId > 0) outbound.alter_id = alterId;
    const tlsMode = field("tls").toLowerCase();
    const host = field("host");
    const network = (field("net") || "tcp").toLowerCase();
    const transport = buildTransport({
      network,
      headerType: field("type"),
      host,
      path: field("path"),
      // v2rayN 把 gRPC 的 serviceName 放在 path 里。
      serviceName: field("path"),
      tlsEnabled: tlsMode === "tls"
    });
    if (!transport.ok) return transport;
    if (transport.transport) outbound.transport = transport.transport;
    if (tlsMode === "tls") {
      outbound.tls = buildTLS({
        serverName: field("sni") || hostHeader(host),
        insecure: /^(?:1|true)$/i.test(field("allowInsecure")),
        alpn: splitList(field("alpn")),
        fingerprint: field("fp")
      });
    } else if (tlsMode.length > 0 && tlsMode !== "none") {
      return fail(`VMess \u4E0D\u652F\u6301\u7684 tls \u53D6\u503C\uFF1A${tlsMode}`);
    }
    return finishNode("vmess", { host: stripBrackets(field("add")), port: field("port"), name: field("ps") }, outbound);
  }
  function parseVLESS(line) {
    const parts = splitLink(line);
    const uuid = parts.userinfo === null ? "" : percentDecode(parts.userinfo).trim();
    if (uuid.length === 0) return fail("vless \u94FE\u63A5\u7F3A\u5C11 uuid");
    const encryption = param(parts.params, "encryption").toLowerCase();
    if (encryption.length > 0 && encryption !== "none") return fail(`sing-box \u4E0D\u652F\u6301 VLESS \u52A0\u5BC6\uFF1A${encryption}`);
    const outbound = { uuid };
    const flow = param(parts.params, "flow").toLowerCase();
    if (flow.length > 0) {
      if (flow === "xtls-rprx-vision" || flow === "xtls-rprx-vision-udp443") outbound.flow = "xtls-rprx-vision";
      else return fail(`sing-box \u4E0D\u652F\u6301\u7684 VLESS flow\uFF1A${flow}`);
    }
    const security = streamSecurity(parts.params, "none");
    if (!security.ok) return security;
    if (security.tls) outbound.tls = security.tls;
    const transport = streamTransport(parts.params, security.tls !== void 0);
    if (!transport.ok) return transport;
    if (transport.transport) outbound.transport = transport.transport;
    outbound.packet_encoding = "xudp";
    return finishNode("vless", parts, outbound);
  }
  function parseTrojan(line) {
    const parts = splitLink(line);
    const password = parts.userinfo === null ? "" : percentDecode(parts.userinfo);
    if (password.length === 0) return fail("trojan \u94FE\u63A5\u7F3A\u5C11\u5BC6\u7801");
    const outbound = { password };
    const security = streamSecurity(parts.params, "tls");
    if (!security.ok) return security;
    if (security.tls) outbound.tls = security.tls;
    const transport = streamTransport(parts.params, security.tls !== void 0);
    if (!transport.ok) return transport;
    if (transport.transport) outbound.transport = transport.transport;
    return finishNode("trojan", parts, outbound);
  }
  function streamSecurity(params, fallback) {
    const security = (param(params, "security") || fallback).toLowerCase();
    const host = param(params, "host");
    const serverName = param(params, "sni", "peer", "serverName");
    const fingerprint = param(params, "fp", "fingerprint");
    const alpn = splitList(param(params, "alpn"));
    const insecure = flag(params, "allowInsecure", "insecure", "allow_insecure");
    switch (security) {
      case "none":
        return { ok: true };
      case "tls":
        return { ok: true, tls: buildTLS({ serverName: serverName || hostHeader(host), insecure, alpn, fingerprint }) };
      case "reality": {
        const publicKey = param(params, "pbk", "publicKey", "public-key");
        const shortId = param(params, "sid", "shortId", "short-id");
        if (!isRealityPublicKey(publicKey)) return { ok: false, reason: publicKey ? "Reality \u516C\u94A5\uFF08pbk\uFF09\u4E0D\u662F 32 \u5B57\u8282\u7684 base64url" : "Reality \u8282\u70B9\u7F3A\u5C11\u516C\u94A5\uFF08pbk\uFF09" };
        if (!/^(?:[0-9a-fA-F]{2}){0,8}$/.test(shortId)) return { ok: false, reason: `Reality short id\uFF08sid\uFF09\u4E0D\u662F 0\u201316 \u4F4D\u7684\u5076\u6570\u4F4D\u5341\u516D\u8FDB\u5236\uFF1A${shortId}` };
        return {
          ok: true,
          tls: buildTLS({ serverName, insecure: false, alpn, fingerprint: fingerprint || "chrome", reality: { publicKey, shortId } })
        };
      }
      default:
        return { ok: false, reason: `sing-box \u4E0D\u652F\u6301\u7684 security\uFF1A${security}` };
    }
  }
  function streamTransport(params, tlsEnabled) {
    return buildTransport({
      network: (param(params, "type", "network", "net") || "tcp").toLowerCase(),
      headerType: param(params, "headerType"),
      host: param(params, "host"),
      path: param(params, "path"),
      serviceName: param(params, "serviceName", "service_name"),
      tlsEnabled
    });
  }
  function buildTransport(input) {
    const hosts = splitList(input.host);
    switch (input.network) {
      case "tcp":
      case "raw":
      case "":
        if (input.headerType.toLowerCase() !== "http") return { ok: true };
        if (input.tlsEnabled) return { ok: false, reason: "TCP + HTTP \u4F2A\u88C5 + TLS \u7684\u7EC4\u5408 sing-box \u65E0\u6CD5\u5BF9\u5E94" };
        return { ok: true, transport: compact({ type: "http", method: "GET", host: hosts.length ? hosts : void 0, path: firstPath(input.path) }) };
      case "ws":
      case "websocket":
        return { ok: true, transport: webSocketTransport(input.path, hosts[0] ?? "") };
      case "grpc":
      case "gun":
        return { ok: true, transport: compact({ type: "grpc", service_name: input.serviceName || void 0 }) };
      case "http":
      case "h2":
        return { ok: true, transport: compact({ type: "http", host: hosts.length ? hosts : void 0, path: input.path || void 0 }) };
      case "httpupgrade":
        return { ok: true, transport: compact({ type: "httpupgrade", host: hosts[0], path: input.path || void 0 }) };
      case "quic":
        if (!input.tlsEnabled) return { ok: false, reason: "QUIC \u4F20\u8F93\u5FC5\u987B\u914D TLS" };
        return { ok: true, transport: { type: "quic" } };
      default:
        return { ok: false, reason: `sing-box \u4E0D\u652F\u6301 ${input.network} \u4F20\u8F93` };
    }
  }
  var earlyDataHeader = ["Sec-Web", "Socket-Protocol"].join("");
  function webSocketTransport(path, host) {
    const transport = { type: "ws" };
    let cleanPath = path;
    const question = path.indexOf("?");
    if (question >= 0) {
      const kept = [];
      let earlyData = 0;
      for (const pair of path.slice(question + 1).split("&")) {
        const match = /^ed=(\d+)$/.exec(pair);
        if (match) earlyData = Number(match[1]);
        else if (pair.length > 0) kept.push(pair);
      }
      cleanPath = path.slice(0, question) + (kept.length ? `?${kept.join("&")}` : "");
      if (earlyData > 0) {
        transport.max_early_data = earlyData;
        transport.early_data_header_name = earlyDataHeader;
      }
    }
    if (cleanPath) transport.path = cleanPath;
    if (host) transport.headers = { Host: host };
    return transport;
  }
  var hysteria2Obfs = /* @__PURE__ */ new Set(["salamander", "gecko"]);
  function parseHysteria2(line) {
    const parts = splitLink(line);
    const password = parts.userinfo === null ? "" : percentDecode(parts.userinfo);
    const outbound = {};
    if (password.length > 0) outbound.password = password;
    const obfs = param(parts.params, "obfs").toLowerCase();
    if (obfs.length > 0 && obfs !== "none") {
      if (!hysteria2Obfs.has(obfs)) return fail(`sing-box \u4E0D\u652F\u6301\u7684 Hysteria2 \u6DF7\u6DC6\uFF1A${obfs}`);
      outbound.obfs = { type: obfs, password: param(parts.params, "obfs-password", "obfsPassword", "obfs_password") };
    }
    outbound.tls = buildTLS({
      serverName: param(parts.params, "sni", "peer"),
      insecure: flag(parts.params, "insecure", "allowInsecure", "allow_insecure"),
      alpn: splitList(param(parts.params, "alpn")),
      fingerprint: ""
    });
    const ports = parsePortList([parts.port, param(parts.params, "mport")].filter((text) => text.length > 0).join(","));
    if (ports === null) return fail(`\u7AEF\u53E3\u4E0D\u5408\u6CD5\uFF1A${parts.port}`);
    const first = ports.length > 0 ? ports[0][0] : 443;
    const hopping = ports.length > 1 || ports.length === 1 && ports[0][0] !== ports[0][1];
    if (hopping) outbound.server_ports = ports.map(([start, end]) => `${start}:${end}`);
    return finishNode("hysteria2", { host: parts.host, port: String(first), name: parts.name }, outbound);
  }
  var tuicCongestionControls = /* @__PURE__ */ new Set(["cubic", "new_reno", "bbr"]);
  function parseTUIC(line) {
    const parts = splitLink(line);
    const userinfo = parts.userinfo === null ? "" : percentDecode(parts.userinfo);
    const colon = userinfo.indexOf(":");
    if (colon < 0) return fail("tuic \u94FE\u63A5\u7F3A\u5C11 uuid:password\uFF08sing-box \u53EA\u652F\u6301 TUIC v5\uFF09");
    const uuid = userinfo.slice(0, colon).trim();
    const password = userinfo.slice(colon + 1);
    if (!isUUID(uuid)) return fail(`TUIC \u7684 uuid \u4E0D\u662F\u5408\u6CD5\u7684 UUID\uFF1A${uuid}`);
    const outbound = { uuid, password };
    const congestion = param(parts.params, "congestion_control", "congestion-control", "congestion").toLowerCase();
    if (congestion.length > 0) {
      if (!tuicCongestionControls.has(congestion)) return fail(`sing-box \u4E0D\u652F\u6301\u7684 TUIC \u62E5\u585E\u63A7\u5236\uFF1A${congestion}`);
      outbound.congestion_control = congestion;
    }
    const relay = param(parts.params, "udp_relay_mode", "udp-relay-mode").toLowerCase();
    if (relay === "native" || relay === "quic") outbound.udp_relay_mode = relay;
    const alpn = splitList(param(parts.params, "alpn"));
    const tls = buildTLS({
      serverName: param(parts.params, "sni", "peer"),
      insecure: flag(parts.params, "allow_insecure", "allowInsecure", "insecure"),
      alpn: alpn.length > 0 ? alpn : ["h3"],
      fingerprint: ""
    });
    if (flag(parts.params, "disable_sni", "disable-sni")) tls.disable_sni = true;
    outbound.tls = tls;
    return finishNode("tuic", parts, outbound);
  }
  var utlsFingerprints = /* @__PURE__ */ new Set(["chrome", "firefox", "edge", "safari", "360", "qq", "ios", "android", "random", "randomized"]);
  function buildTLS(input) {
    const tls = { enabled: true };
    if (input.serverName) tls.server_name = input.serverName;
    if (input.insecure) tls.insecure = true;
    if (input.alpn.length > 0) tls.alpn = input.alpn;
    if (input.fingerprint) {
      const fingerprint = input.fingerprint.toLowerCase();
      tls.utls = { enabled: true, fingerprint: utlsFingerprints.has(fingerprint) ? fingerprint : "chrome" };
    }
    if (input.reality) tls.reality = { enabled: true, public_key: input.reality.publicKey, short_id: input.reality.shortId };
    return tls;
  }
  function hostHeader(host) {
    const first = splitList(host)[0] ?? "";
    return isIPAddress(first) ? "" : first;
  }
  function splitList(text) {
    return text.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  }
  function firstPath(path) {
    return splitList(path)[0];
  }
  function compact(object) {
    for (const key of Object.keys(object)) if (object[key] === void 0) delete object[key];
    return object;
  }
  function parsePortNumber(text) {
    if (!/^\d{1,5}$/.test(text.trim())) return null;
    const port = Number(text.trim());
    return isValidPort(port) ? port : null;
  }
  function isValidPort(port) {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  }
  function parsePortList(text) {
    const ranges = [];
    for (const item of splitList(text)) {
      const bounds = item.split(/[-:]/);
      if (bounds.length > 2) return null;
      const start = parsePortNumber(bounds[0]);
      const end = bounds.length === 2 ? parsePortNumber(bounds[1]) : start;
      if (start === null || end === null || end < start) return null;
      ranges.push([start, end]);
    }
    return ranges;
  }
  function isUUID(text) {
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(text);
  }
  function isRealityPublicKey(text) {
    return /^[A-Za-z0-9_-]{43}$/.test(text) && decodeBase64(text)?.length === 32;
  }
  function isIPAddress(text) {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(text) || text.includes(":");
  }
  function stripBrackets(text) {
    return text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  }
  function isProxyProtocol(type) {
    return proxyProtocols.includes(type);
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function safeStringify(value) {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function ok(node) {
    return { ok: true, node };
  }
  function fail(reason) {
    return { ok: false, reason };
  }
  var base64Values = (() => {
    const table = new Int8Array(128).fill(-1);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (let index = 0; index < alphabet.length; index += 1) table[alphabet.charCodeAt(index)] = index;
    table["-".charCodeAt(0)] = 62;
    table["_".charCodeAt(0)] = 63;
    return table;
  })();
  function decodeBase64(text) {
    const clean = text.replace(/\s+/g, "").replace(/={1,2}$/, "");
    if (clean.length === 0 || clean.length % 4 === 1) return null;
    const bytes = new Uint8Array(Math.floor(clean.length * 6 / 8));
    let buffer = 0;
    let bits = 0;
    let index = 0;
    for (let position = 0; position < clean.length; position += 1) {
      const code = clean.charCodeAt(position);
      const value = code < 128 ? base64Values[code] : -1;
      if (value < 0) return null;
      buffer = buffer << 6 | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes[index] = buffer >> bits & 255;
        index += 1;
        buffer &= (1 << bits) - 1;
      }
    }
    return bytes;
  }
  function decodeUtf8(bytes) {
    const units2 = [];
    let output = "";
    for (let index = 0; index < bytes.length; ) {
      const lead = bytes[index];
      let codePoint;
      let length;
      if (lead < 128) {
        codePoint = lead;
        length = 1;
      } else if (lead >= 194 && lead <= 223) {
        codePoint = lead & 31;
        length = 2;
      } else if (lead >= 224 && lead <= 239) {
        codePoint = lead & 15;
        length = 3;
      } else if (lead >= 240 && lead <= 244) {
        codePoint = lead & 7;
        length = 4;
      } else {
        return null;
      }
      if (index + length > bytes.length) return null;
      for (let offset = 1; offset < length; offset += 1) {
        const next = bytes[index + offset];
        if ((next & 192) !== 128) return null;
        codePoint = codePoint << 6 | next & 63;
      }
      const minimum = length === 3 ? 2048 : length === 4 ? 65536 : 0;
      if (codePoint < minimum || codePoint > 1114111 || codePoint >= 55296 && codePoint <= 57343) return null;
      if (codePoint >= 65536) {
        const offset = codePoint - 65536;
        units2.push(55296 + (offset >> 10), 56320 + (offset & 1023));
      } else {
        units2.push(codePoint);
      }
      index += length;
      if (units2.length >= 8192) {
        output += String.fromCharCode.apply(null, units2);
        units2.length = 0;
      }
    }
    return output + String.fromCharCode.apply(null, units2);
  }
  function decodeBase64Text(text) {
    const bytes = decodeBase64(text);
    if (bytes === null) return null;
    const decoded = decodeUtf8(bytes);
    if (decoded === null || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(decoded)) return null;
    return decoded;
  }
  function percentDecode(text) {
    if (!text.includes("%")) return text;
    return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
      const bytes = new Uint8Array(run.length / 3);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16);
      return decodeUtf8(bytes) ?? run;
    });
  }

  // extensions/proxy/src/core.ts
  var INSTALL_SCRIPT_ID = "install";
  var SUBSCRIPTION_USER_AGENT = "sing-box 1.14.4 (Jarvis)";
  var readyTimeoutMs = 3e4;
  var requestTimeoutSeconds = 10;
  var allCapabilities = ["process.daemon", "system.proxy", "network.https", "terminal.run", "notifications.post", "clipboard.write"];
  function errorMessage2(error) {
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
      return error.message;
    }
    return String(error);
  }
  function errorLines(error) {
    const detail = typeof error === "object" && error !== null && "detail" in error ? error.detail : void 0;
    const text = typeof detail === "string" && detail.trim().length > 0 ? detail : errorMessage2(error);
    return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  }
  async function read(key) {
    try {
      return await jarvis.storage.get(key);
    } catch {
      return void 0;
    }
  }
  async function write(key, value) {
    try {
      await jarvis.storage.set(key, value);
    } catch (error) {
      jarvis.log.warn(`\u5B58\u50A8\u5199\u4E0D\u8FDB\u53BB\uFF1A${key}`, errorMessage2(error));
    }
  }
  async function remove(key) {
    try {
      await jarvis.storage.delete(key);
    } catch {
    }
  }
  var ProxyCore = class {
    /**
     * @param changed 状态变了（忙闲、测出一个延迟）时调用：页面重画、菜单栏重推。
     */
    constructor(changed) {
      this.changed = changed;
      /** 这个会话正在做的事；`null` = 闲着。 */
      this.busy = null;
      /** 本会话刚测出、已经交给界面但可能还没落盘的延迟。 */
      this.pendingLatency = {};
    }
    setBusy(busy) {
      this.busy = busy;
      this.changed();
    }
    /** 此刻已授予的能力（每次现问：授权会在设置里被撤销）。 */
    async granted() {
      try {
        return await jarvis.permissions.granted();
      } catch {
        return [];
      }
    }
    /**
     * 偏好。
     * @param raw 事件里带来的偏好；省略时现问宿主。
     * @returns 完整、合法的一份。
     */
    async preferences(raw) {
      if (raw) return normalizePreferences(raw);
      try {
        return normalizePreferences(await jarvis.preferences.all());
      } catch {
        return normalizePreferences({});
      }
    }
    /** 偏好里的订阅地址（进钥匙串的 `urlList`，只能单独读）。 */
    async subscriptionURLs() {
      try {
        const value = await jarvis.preferences.get("subscriptions");
        return Array.isArray(value) ? value.filter((url) => typeof url === "string" && /^https:\/\//i.test(url.trim())).map((url) => url.trim()) : [];
      } catch {
        return [];
      }
    }
    /** 订阅记录。 */
    async records() {
      const value = await read(storageKeys.subscriptions);
      return Array.isArray(value) ? value : [];
    }
    /**
     * 全部节点：按订阅在偏好里的顺序拼起来、再去一次重（两家机场都有「香港 01」是常事）。界面显示的与配置里的 tag 是同一份名字。
     * @param records 订阅记录；省略时现读。
     * @returns 节点。
     */
    async nodes(records) {
      const list = records ?? await this.records();
      const all = [];
      for (const record of [...list].sort((a, b) => a.position - b.position)) {
        for (let index = 0; index < record.chunks; index += 1) {
          const chunk = await read(nodeChunkKey(record.id, index));
          if (Array.isArray(chunk)) all.push(...chunk);
        }
      }
      return dedupeNodeNames(all);
    }
    /** 用户选的模式与节点（未按节点列表校正）。 */
    async selection() {
      return normalizeSelection(await read(storageKeys.selection));
    }
    /** 最近一次测速，叠上本会话刚测出的。 */
    async latency() {
      const stored = await read(storageKeys.latency);
      const values = stored && typeof stored.values === "object" && stored.values !== null ? stored.values : {};
      return { values: { ...values, ...this.pendingLatency }, testedAt: stored?.testedAt ?? null };
    }
    /** 此刻在跑的那一份的控制口记录。 */
    async control() {
      const value = await read(storageKeys.control);
      return value && typeof value.secret === "string" ? value : null;
    }
    /**
     * 读全部事实。
     * @param context 事件里带来的授权与偏好（菜单栏、指令）；省略时现问。
     * @returns 快照。
     */
    async snapshot(context = {}) {
      const granted = context.granted ?? await this.granted();
      const preferences = await this.preferences(context.preferences);
      const records = await this.records();
      const [nodes, selection, latency, control, failure, subscriptionCount] = await Promise.all([
        this.nodes(records),
        this.selection(),
        this.latency(),
        this.control(),
        read(storageKeys.failure),
        this.subscriptionURLs().then((urls) => urls.length)
      ]);
      let daemon = null;
      let proxy = null;
      if (granted.includes(requiredCapability)) {
        try {
          daemon = await jarvis.daemon.status(DAEMON_ID, preferences.singBoxPath || void 0);
        } catch {
          daemon = null;
        }
      }
      if (granted.includes("system.proxy")) {
        try {
          proxy = await jarvis.systemProxy.status();
        } catch {
          proxy = null;
        }
      }
      const members = /* @__PURE__ */ new Set([URLTEST_TAG, ...nodes.map((node) => node.name)]);
      const effective = members.has(selection.node) ? selection : { ...selection, node: URLTEST_TAG };
      const failed = failure && typeof failure.message === "string" ? failure : null;
      return {
        granted,
        preferences,
        daemon,
        proxy,
        nodes,
        subscriptions: records,
        subscriptionCount,
        selection: effective,
        latency,
        control,
        failure: failed,
        phase: phaseOf({ granted, daemon, nodeCount: nodes.length, failure: failed })
      };
    }
    /**
     * 发一个 Clash API 请求。
     * @param method 方法。
     * @param path 路径。
     * @param body 请求体（对象，转 JSON）。
     * @param timeout 超时秒。
     * @returns 响应。
     */
    async clash(method, path, body, timeout = requestTimeoutSeconds) {
      const control = await this.control();
      const headers = {};
      if (control) headers.Authorization = `Bearer ${control.secret}`;
      if (body !== void 0) headers["Content-Type"] = "application/json";
      return jarvis.daemon.request({
        id: DAEMON_ID,
        method,
        path,
        headers,
        ...body !== void 0 ? { body: JSON.stringify(body) } : {},
        timeout
      });
    }
    // MARK: 开与关
    /**
     * 开启：查装没装 → 有没有节点 → 生成配置 → 起内核 → 等它就绪 → 把模式与节点重新放回去 → 设系统代理。
     * @param context 事件里带来的授权与偏好。
     * @returns 结果。
     */
    async turnOn(context = {}) {
      if (this.busy) return { ok: false, message: `${this.busy}\uFF0C\u7A0D\u7B49` };
      const granted = context.granted ?? await this.granted();
      if (!granted.includes(requiredCapability)) return { ok: false, message: "\u8FD8\u6CA1\u6709\u6388\u6743\u300C\u4EE3\u7406\u300D\u5728\u540E\u53F0\u8FD0\u884C sing-box" };
      const preferences = await this.preferences(context.preferences);
      this.setBusy("\u6B63\u5728\u5F00\u542F");
      try {
        const executable = preferences.singBoxPath || void 0;
        const status = await jarvis.daemon.status(DAEMON_ID, executable);
        if (status.state === "running") {
          const proxy2 = await this.applySystemProxy(granted, preferences.systemProxy, (await this.control())?.mixedPort ?? preferences.mixedPort);
          return { ok: true, message: proxy2 ?? "\u4EE3\u7406\u5DF2\u7ECF\u5F00\u7740" };
        }
        if (status.executable === "") {
          return { ok: false, message: preferences.singBoxPath ? `\u8BBE\u7F6E\u91CC\u586B\u7684 sing-box \u8DEF\u5F84\u4E0D\u53EF\u7528\uFF1A${preferences.singBoxPath}` : "\u6CA1\u6709\u627E\u5230 sing-box\uFF1A\u5148\u5728\u300C\u4EE3\u7406\u300D\u91CC\u5B89\u88C5" };
        }
        let nodes = await this.nodes();
        if (nodes.length === 0 && granted.includes("network.https")) {
          this.busy = null;
          await this.updateSubscriptions({ granted, restartIfChanged: false });
          this.setBusy("\u6B63\u5728\u5F00\u542F");
          nodes = await this.nodes();
        }
        if (nodes.length === 0) return { ok: false, message: "\u6CA1\u6709\u8282\u70B9\uFF1A\u5728\u8BBE\u7F6E\u91CC\u586B\u8BA2\u9605\u5730\u5740\uFF0C\u518D\u66F4\u65B0\u8BA2\u9605" };
        const selection = await this.selection();
        const secret = randomSecret();
        let chinaRules = preferences.chinaRules;
        let fallback = false;
        try {
          await this.startDaemon(nodes, preferences, selection, secret, chinaRules);
        } catch (error) {
          if (!(chinaRules && isRuleSetFailure(errorLines(error).join("\n")))) throw error;
          chinaRules = false;
          fallback = true;
          await this.startDaemon(nodes, preferences, selection, secret, chinaRules);
        }
        await remove(storageKeys.failure);
        await this.applySelection(selection, nodes);
        const proxy = await this.applySystemProxy(granted, preferences.systemProxy, preferences.mixedPort);
        const parts = [`\u4EE3\u7406\u5DF2\u5F00\u542F \xB7 127.0.0.1:${preferences.mixedPort}`];
        if (fallback) parts.push("\u4E2D\u56FD\u5927\u9646\u89C4\u5219\u96C6\u4E0B\u8F7D\u5931\u8D25\uFF0C\u8FD9\u6B21\u4E0D\u5206\u6D41");
        if (proxy) parts.push(proxy);
        return { ok: true, message: parts.join("\uFF1B") };
      } catch (error) {
        const lines = errorLines(error);
        const { message, hint } = describeFailure(lines, preferences);
        const failure = { at: Date.now(), message, lines: lines.slice(-20), hint };
        await write(storageKeys.failure, failure);
        await this.markStarted();
        return { ok: false, message: hint ? `${message}\uFF1A${hint}` : message };
      } finally {
        this.setBusy(null);
      }
    }
    /**
     * 起内核并等它就绪。远程规则集在 sing-box 的启动阶段下载（`daemon.start` 只等 1 秒），所以「起来了」之后还要等 Clash API 开始答话；
     * 这期间进程退了，读它的输出当失败抛出——上层据此判断要不要不分流再试一次。
     */
    async startDaemon(nodes, preferences, selection, secret, chinaRules) {
      const config = buildConfig({
        nodes,
        mixedPort: preferences.mixedPort,
        controlPort: preferences.controlPort,
        controlSecret: secret,
        mode: selection.mode,
        testURL: preferences.testURL,
        selected: selection.node,
        chinaRules
      });
      const control = {
        secret,
        controlPort: preferences.controlPort,
        mixedPort: preferences.mixedPort,
        chinaRules,
        ruleSetFallback: preferences.chinaRules && !chinaRules,
        testURL: preferences.testURL,
        nodesDigest: nodesDigest(nodes),
        startedAt: Date.now(),
        starting: true
      };
      await write(storageKeys.control, control);
      await jarvis.daemon.start({
        id: DAEMON_ID,
        config: JSON.stringify(config),
        controlPort: preferences.controlPort,
        ...preferences.singBoxPath ? { executable: preferences.singBoxPath } : {}
      });
      const deadline = Date.now() + readyTimeoutMs;
      for (; ; ) {
        const status = await jarvis.daemon.status(DAEMON_ID);
        if (status.state !== "running") {
          let lines = [];
          try {
            lines = (await jarvis.daemon.logs(DAEMON_ID)).slice(-20);
          } catch {
            lines = [];
          }
          throw { message: "sing-box \u542F\u52A8\u540E\u9000\u51FA\u4E86", detail: lines.join("\n") || "sing-box \u542F\u52A8\u540E\u9000\u51FA\u4E86" };
        }
        try {
          const response = await this.clash("GET", "/version", void 0, 2);
          if (response.status === 200) break;
        } catch {
        }
        if (Date.now() >= deadline) {
          jarvis.log.warn("\u7B49\u4E86 30 \u79D2 Clash API \u4ECD\u6CA1\u7B54\u8BDD\uFF0C\u6309\u5DF2\u5F00\u542F\u5904\u7406");
          break;
        }
        await sleep(500);
      }
      await this.markStarted();
    }
    /** 把存储里的 `starting` 落下。 */
    async markStarted() {
      const control = await this.control();
      if (control?.starting) await write(storageKeys.control, { ...control, starting: false });
    }
    /**
     * 把模式与「节点选择」放回用户选的样子。`cache.db` 记着上一次的模式与选中项，启动时以它为准，
     * 配置里的 `default_mode` / `default` 只管第一次——用户在内核停着的时候改过，不放回去就会被缓存盖掉。
     */
    async applySelection(selection, nodes) {
      try {
        await this.clash("PATCH", "/configs", { mode: clashModeNames[selection.mode] });
        const members = /* @__PURE__ */ new Set([URLTEST_TAG, ...nodes.map((node) => node.name)]);
        await this.clash("PUT", proxyPath(SELECTOR_TAG), { name: members.has(selection.node) ? selection.node : URLTEST_TAG });
      } catch (error) {
        jarvis.log.warn("\u6A21\u5F0F\u4E0E\u8282\u70B9\u6CA1\u80FD\u653E\u56DE\u53BB", errorMessage2(error));
      }
    }
    /**
     * 按偏好设系统代理。
     * @returns 要告诉用户的一句话（被拦着、别人接管着、没授权）；一切正常为 `null`。
     */
    async applySystemProxy(granted, wanted, port) {
      if (!wanted) return null;
      if (!granted.includes("system.proxy")) return "\u6CA1\u6709\u6388\u6743\u4FEE\u6539\u7CFB\u7EDF\u4EE3\u7406\uFF0C\u53EA\u5728\u672C\u673A\u7AEF\u53E3\u4E0A\u53EF\u7528";
      try {
        const status = await jarvis.systemProxy.enable({ port });
        return status.blocker ? status.blocker.message : null;
      } catch (error) {
        return errorMessage2(error);
      }
    }
    /**
     * 关闭：先还原系统代理，再停内核（反过来的话中间那一下系统代理指着一个没人监听的端口）。
     * @returns 结果。
     */
    async turnOff() {
      if (this.busy) return { ok: false, message: `${this.busy}\uFF0C\u7A0D\u7B49` };
      this.setBusy("\u6B63\u5728\u5173\u95ED");
      try {
        const granted = await this.granted();
        if (granted.includes("system.proxy")) {
          try {
            await jarvis.systemProxy.disable();
          } catch (error) {
            jarvis.log.warn("\u7CFB\u7EDF\u4EE3\u7406\u6CA1\u80FD\u8FD8\u539F\uFF08\u5BBF\u4E3B\u4F1A\u5728\u5185\u6838\u505C\u4E0B\u540E\u515C\u5E95\u8FD8\u539F\uFF09", errorMessage2(error));
          }
        }
        await jarvis.daemon.stop(DAEMON_ID);
        await remove(storageKeys.failure);
        await remove(storageKeys.control);
        return { ok: true, message: "\u4EE3\u7406\u5DF2\u5173\u95ED" };
      } catch (error) {
        return { ok: false, message: `\u6CA1\u80FD\u5173\u95ED\uFF1A${errorMessage2(error)}` };
      } finally {
        this.setBusy(null);
      }
    }
    /**
     * 换一份配置重开（订阅更新过、端口改过）。
     * @returns 结果。
     */
    async restart() {
      const off = await this.turnOff();
      if (!off.ok) return off;
      return this.turnOn();
    }
    // MARK: 模式、节点、系统代理
    /**
     * 换出站模式：记下来，开着就当场换。
     * @param mode 模式。
     */
    async setMode(mode) {
      const selection = await this.selection();
      await write(storageKeys.selection, { ...selection, mode });
      if (!await this.isRunning()) return { ok: true, message: "" };
      try {
        const response = await this.clash("PATCH", "/configs", { mode: clashModeNames[mode] });
        return response.status < 300 ? { ok: true, message: "" } : { ok: false, message: `\u6CA1\u80FD\u6362\u6A21\u5F0F\uFF08${response.status}\uFF09` };
      } catch (error) {
        return { ok: false, message: `\u6CA1\u80FD\u6362\u6A21\u5F0F\uFF1A${errorMessage2(error)}` };
      }
    }
    /**
     * 换节点：记下来，开着就当场换（`节点选择` 打断旧连接，见配置）。
     * @param name 节点名或「自动选择」。
     */
    async selectNode(name) {
      const selection = await this.selection();
      await write(storageKeys.selection, { ...selection, node: name });
      if (!await this.isRunning()) return { ok: true, message: "" };
      try {
        const response = await this.clash("PUT", proxyPath(SELECTOR_TAG), { name });
        return response.status < 300 ? { ok: true, message: "" } : { ok: false, message: `\u6CA1\u80FD\u5207\u5230\u300C${name}\u300D\uFF08${response.status}\uFF09` };
      } catch (error) {
        return { ok: false, message: `\u6CA1\u80FD\u5207\u8282\u70B9\uFF1A${errorMessage2(error)}` };
      }
    }
    /**
     * 开 / 关系统代理（不改偏好：偏好只决定「开启代理时要不要顺手设」）。
     * @param on 开还是关。
     */
    async setSystemProxy(on) {
      const granted = await this.granted();
      if (!granted.includes("system.proxy")) return { ok: false, message: "\u6CA1\u6709\u6388\u6743\u4FEE\u6539\u7CFB\u7EDF\u4EE3\u7406" };
      try {
        if (!on) {
          await jarvis.systemProxy.disable();
          return { ok: true, message: "\u7CFB\u7EDF\u4EE3\u7406\u5DF2\u8FD8\u539F" };
        }
        const control = await this.control();
        const port = control?.mixedPort ?? (await this.preferences()).mixedPort;
        const status = await jarvis.systemProxy.enable({ port });
        return status.blocker ? { ok: false, message: status.blocker.message } : { ok: true, message: `\u7CFB\u7EDF\u4EE3\u7406\u6307\u5411 127.0.0.1:${port}` };
      } catch (error) {
        return { ok: false, message: errorMessage2(error) };
      }
    }
    /** 内核此刻在不在跑。 */
    async isRunning() {
      try {
        return (await jarvis.daemon.status(DAEMON_ID)).state === "running";
      } catch {
        return false;
      }
    }
    // MARK: 测速、流量、日志
    /**
     * 测一遍节点延迟：4 个一批，每测出一个就通知界面亮起读数，全部测完写进存储（另一个会话读得到）。
     * @param names 要测的节点；省略 = 全部。
     * @returns 结果。
     */
    async testLatency(names) {
      if (this.busy) return { ok: false, message: `${this.busy}\uFF0C\u7A0D\u7B49` };
      if (!await this.isRunning()) return { ok: false, message: "\u4EE3\u7406\u5F00\u7740\u624D\u80FD\u6D4B\u901F" };
      const targets = names ?? (await this.nodes()).map((node) => node.name);
      if (targets.length === 0) return { ok: false, message: "\u6CA1\u6709\u8282\u70B9\u53EF\u6D4B" };
      const control = await this.control();
      const url = control?.testURL ?? (await this.preferences()).testURL;
      this.setBusy("\u6B63\u5728\u6D4B\u901F");
      let reachable = 0;
      try {
        await runLimited(targets, delayConcurrency, async (name) => {
          let delay = null;
          try {
            delay = parseDelay(await this.clash("GET", delayPath(name, url), void 0, requestTimeoutSeconds));
          } catch {
            delay = null;
          }
          if (delay !== null) reachable += 1;
          this.pendingLatency[name] = delay;
          this.changed();
        });
        const stored = await read(storageKeys.latency);
        const values = { ...stored?.values ?? {}, ...this.pendingLatency };
        await write(storageKeys.latency, { values, testedAt: Date.now() });
        this.pendingLatency = {};
        return { ok: true, message: `\u6D4B\u5B8C ${targets.length} \u4E2A\u8282\u70B9\uFF0C${reachable} \u4E2A\u8FDE\u5F97\u4E0A` };
      } finally {
        this.setBusy(null);
      }
    }
    /** 读一份连接快照；没在跑、读不出为 `null`。 */
    async connections() {
      try {
        return parseConnections(await this.clash("GET", "/connections", void 0, 3));
      } catch {
        return null;
      }
    }
    /** 「自动选择」此刻选中的节点；读不出为 `null`。 */
    async autoPick() {
      try {
        return parseGroupNow(await this.clash("GET", proxyPath(URLTEST_TAG), void 0, 3));
      } catch {
        return null;
      }
    }
    /** 内核最近 500 行输出。 */
    async logs() {
      try {
        return await jarvis.daemon.logs(DAEMON_ID);
      } catch {
        return [];
      }
    }
    /**
     * 终端代理命令（按此刻在跑的那一份的端口；没在跑按偏好）。
     * @param preferences 偏好。
     * @param control 控制口记录。
     */
    terminalCommand(preferences, control) {
      return terminalProxyCommand(control?.mixedPort ?? preferences.mixedPort);
    }
    /** 在终端里装（或升级）sing-box。 */
    async install() {
      try {
        await jarvis.terminal.run(INSTALL_SCRIPT_ID);
        return { ok: true, message: "\u5DF2\u5728\u7EC8\u7AEF\u91CC\u5F00\u59CB\u5B89\u88C5\uFF1B\u88C5\u597D\u4E4B\u540E\u56DE\u5230\u8FD9\u91CC\u5C31\u80FD\u5F00\u542F" };
      } catch (error) {
        return { ok: false, message: `\u6CA1\u80FD\u6253\u5F00\u7EC8\u7AEF\uFF1A${errorMessage2(error)}` };
      }
    }
    // MARK: 订阅
    /**
     * 拉一遍偏好里的全部订阅。每条各自成败：失败的那条留着上一次的节点，只记下原因。
     * 内核开着、节点又真的变了，就重开一次让新节点生效（sing-box 不支持热加载出站）。
     * @param options 授权（省略时现问）与要不要重开。
     * @returns 结果。
     */
    async updateSubscriptions(options = {}) {
      if (this.busy) return { ok: false, message: `${this.busy}\uFF0C\u7A0D\u7B49` };
      const granted = options.granted ?? await this.granted();
      if (!granted.includes("network.https")) return { ok: false, message: "\u8FD8\u6CA1\u6709\u6388\u6743\u300C\u4EE3\u7406\u300D\u62C9\u53D6\u8BA2\u9605\u5730\u5740" };
      const urls = await this.subscriptionURLs();
      if (urls.length === 0) return { ok: false, message: "\u8BBE\u7F6E\u91CC\u8FD8\u6CA1\u6709\u8BA2\u9605\u5730\u5740" };
      this.setBusy("\u6B63\u5728\u66F4\u65B0\u8BA2\u9605");
      let summary;
      try {
        const previous = await this.records();
        const now = Date.now();
        const outcomes = await Promise.all(urls.map((url) => this.fetchSubscription(url)));
        const records = [];
        for (let index = 0; index < urls.length; index += 1) {
          const id = subscriptionId(urls[index]);
          const before = previous.find((record) => record.id === id);
          const outcome = outcomes[index];
          let chunks = 0;
          if (outcome.ok) {
            const blocks = chunkNodes(outcome.nodes);
            for (let block = 0; block < blocks.length; block += 1) await write(nodeChunkKey(id, block), blocks[block]);
            chunks = blocks.length;
            for (let stale = chunks; stale < (before?.chunks ?? 0); stale += 1) await remove(nodeChunkKey(id, stale));
          }
          records.push(nextRecord(before, urls[index], index + 1, outcome, chunks, now));
        }
        const kept = new Set(records.map((record) => record.id));
        for (const record of previous) {
          if (kept.has(record.id)) continue;
          for (let block = 0; block < record.chunks; block += 1) await remove(nodeChunkKey(record.id, block));
        }
        await write(storageKeys.subscriptions, records);
        const succeeded = outcomes.filter((outcome) => outcome.ok).length;
        const schedule = await read(storageKeys.schedule) ?? { lastAttemptAt: null, lastSuccessAt: null };
        await write(storageKeys.schedule, { lastAttemptAt: now, lastSuccessAt: succeeded > 0 ? now : schedule.lastSuccessAt });
        const nodes = await this.nodes(records);
        const failures = records.filter((record) => record.error).map((record) => `${record.host}\uFF1A${record.error}`);
        summary = {
          ok: succeeded > 0,
          message: succeeded === urls.length ? `\u66F4\u65B0\u4E86 ${urls.length} \u6761\u8BA2\u9605\uFF0C\u5171 ${nodes.length} \u4E2A\u8282\u70B9` : `${urls.length} \u6761\u8BA2\u9605\u91CC ${urls.length - succeeded} \u6761\u6CA1\u66F4\u65B0\u4E0A\uFF08${failures.join("\uFF1B")}\uFF09\uFF1B\u73B0\u6709 ${nodes.length} \u4E2A\u8282\u70B9`
        };
        if (options.restartIfChanged !== false && succeeded > 0) {
          const control = await this.control();
          if (control && control.nodesDigest !== nodesDigest(nodes) && await this.isRunning()) {
            this.setBusy(null);
            const restarted = await this.restart();
            summary = { ok: restarted.ok, message: `${summary.message}\uFF1B${restarted.ok ? "\u5DF2\u91CD\u65B0\u5F00\u542F\u4EE5\u7528\u4E0A\u65B0\u8282\u70B9" : restarted.message}` };
          }
        }
      } catch (error) {
        summary = { ok: false, message: `\u66F4\u65B0\u8BA2\u9605\u51FA\u9519\uFF1A${errorMessage2(error)}` };
      } finally {
        if (this.busy === "\u6B63\u5728\u66F4\u65B0\u8BA2\u9605") this.setBusy(null);
      }
      return summary;
    }
    /**
     * 拉一条订阅并解析。
     * @param url 地址。
     * @returns 结果。
     */
    async fetchSubscription(url) {
      try {
        const response = await jarvis.net.fetch(url, { method: "GET", headers: { "User-Agent": SUBSCRIPTION_USER_AGENT } });
        if (response.status < 200 || response.status >= 300) return { ok: false, error: `\u670D\u52A1\u5668\u56DE\u4E86 HTTP ${response.status}` };
        const parsed = parseSubscription(response.text);
        if (parsed.nodes.length === 0) {
          return { ok: false, error: parsed.skipped[0] ? `\u6CA1\u6709\u8BA4\u51FA\u4EFB\u4F55\u8282\u70B9\uFF08${parsed.skipped[0].reason}\uFF09` : "\u8BA2\u9605\u662F\u7A7A\u7684", skipped: parsed.skipped };
        }
        return {
          ok: true,
          format: parsed.format,
          nodes: parsed.nodes,
          skipped: parsed.skipped,
          usage: parseSubscriptionUserinfo(headerValue(response.headers ?? {}, "subscription-userinfo"))
        };
      } catch (error) {
        return { ok: false, error: errorMessage2(error) };
      }
    }
  };

  // extensions/proxy/src/background.ts
  var scheduleTickMs = 3e4;
  var speedTickMs = 1e3;
  var outputRefreshMs = 2e3;
  async function pushMenu(snapshot, extra) {
    try {
      await jarvis.menuBar.update(
        buildMenuModel({
          phase: snapshot.phase,
          preferences: snapshot.preferences,
          selection: snapshot.selection,
          nodes: snapshot.nodes,
          latency: snapshot.latency.values,
          proxy: snapshot.proxy,
          granted: snapshot.granted,
          autoPick: extra.autoPick,
          rate: extra.rate,
          failure: snapshot.failure,
          busy: extra.busy
        })
      );
    } catch (error) {
      jarvis.log.debug("\u83DC\u5355\u680F\u6A21\u578B\u6CA1\u63A8\u4E0A", errorMessage2(error));
    }
  }
  var Background = class {
    constructor() {
      this.core = new ProxyCore(() => void this.refresh());
      this.context = null;
      this.unobserve = null;
      this.scheduleRunning = false;
      this.speedRunning = false;
      this.autoStarted = false;
      this.lastSnapshot = null;
      this.autoPick = null;
      this.rate = null;
      this.lastSample = null;
      this.lastOutputRefresh = 0;
      this.refreshing = null;
      this.refreshAgain = false;
    }
    /**
     * 菜单栏 `start`：推第一份模型、订内核事件、按偏好自动开启、起自动更新与速率两条循环。
     * @param context 授权与偏好。
     */
    async start(context) {
      this.context = context;
      this.observe(context.granted);
      await this.refresh();
      const snapshot = this.lastSnapshot;
      if (snapshot && snapshot.preferences.autoStart && !this.autoStarted && (snapshot.phase === "stopped" || snapshot.phase === "failed")) {
        this.autoStarted = true;
        await this.core.turnOn({ granted: context.granted, preferences: context.preferences });
        await this.refresh();
      }
      void this.scheduleLoop();
      void this.speedLoop();
    }
    /**
     * 菜单栏 `open`：重读状态；开着、延迟又是 5 分钟以前测的，顺手在后台测一遍（菜单开着时宿主就地更新读数）。
     * @param context 授权与偏好。
     */
    async open(context) {
      this.context = context;
      this.observe(context.granted);
      await this.refresh();
      const snapshot = this.lastSnapshot;
      const stale = !snapshot?.latency.testedAt || Date.now() - snapshot.latency.testedAt > 5 * 60 * 1e3;
      if (snapshot?.phase === "running" && stale && snapshot.nodes.length > 0) void this.core.testLatency().then(() => this.refresh());
      void this.speedLoop();
    }
    /**
     * 菜单栏 `select`。
     * @param context 授权与偏好。
     * @param itemId 点的是哪一项。
     */
    async select(context, itemId) {
      this.context = context;
      this.observe(context.granted);
      const action = parseMenuItemId(itemId);
      if (!action) return;
      const snapshot = await this.core.snapshot(context);
      switch (action.kind) {
        case "toggle":
          if (snapshot.daemon?.state === "running") await this.core.turnOff();
          else await this.report(await this.core.turnOn(context), false);
          break;
        case "systemProxy": {
          const active = snapshot.proxy?.owner === "self";
          await this.report(await this.core.setSystemProxy(!active), false);
          break;
        }
        case "mode":
          await this.core.setMode(action.mode);
          break;
        case "node": {
          const name = action.index < 0 ? URLTEST_TAG : snapshot.nodes[action.index]?.name;
          if (name) await this.core.selectNode(name);
          break;
        }
        case "test":
          await this.core.testLatency();
          break;
        case "update":
          await this.report(await this.core.updateSubscriptions({ granted: context.granted }), true);
          break;
        case "copy":
          try {
            await jarvis.clipboard.write(this.core.terminalCommand(snapshot.preferences, snapshot.control));
          } catch (error) {
            jarvis.log.warn("\u7EC8\u7AEF\u4EE3\u7406\u547D\u4EE4\u6CA1\u590D\u5236\u4E0A", errorMessage2(error));
          }
          break;
        case "install":
          await this.core.install();
          break;
      }
      await this.refresh();
      void this.speedLoop();
    }
    /**
     * `/proxy`：不带参数切换，`开` / `关` 指定。静默命令只能用横幅交结果。
     * @param context 指令上下文。
     */
    async command(context) {
      this.observe(context.granted);
      const intent = parseToggleArgument(context.argument);
      let result;
      if (intent === null) {
        result = { ok: false, message: `\u8BA4\u4E0D\u51FA\u300C${context.argument ?? ""}\u300D\uFF1A\u7528 /proxy \u5207\u6362\uFF0C/proxy \u5F00 \u6216 /proxy \u5173` };
      } else {
        const running = await this.core.isRunning();
        const on = intent === "toggle" ? !running : intent === "on";
        if (on === running) result = { ok: true, message: running ? "\u4EE3\u7406\u5DF2\u7ECF\u5F00\u7740" : "\u4EE3\u7406\u5DF2\u7ECF\u5173\u7740" };
        else result = on ? await this.core.turnOn({ granted: context.granted, preferences: context.preferences }) : await this.core.turnOff();
      }
      await this.notify(result.ok ? "\u4EE3\u7406" : "\u4EE3\u7406\u6CA1\u80FD\u5B8C\u6210", result.message, context.granted);
      await this.refresh();
      void this.speedLoop();
    }
    /** 菜单里的动作只在失败（或订阅更新这种要交代结果的）时发横幅：成功的开关菜单图标自己就说明了。 */
    async report(result, always) {
      if (!result.ok || always) await this.notify(result.ok ? "\u4EE3\u7406" : "\u4EE3\u7406\u6CA1\u80FD\u5B8C\u6210", result.message);
    }
    async notify(title, body, granted) {
      const list = granted ?? this.context?.granted ?? await this.core.granted();
      if (!list.includes("notifications.post") || body.length === 0) return;
      try {
        await jarvis.notifications.post({ title, body: body.slice(0, 200) });
      } catch (error) {
        jarvis.log.warn("\u6A2A\u5E45\u6CA1\u53D1\u51FA\u53BB", errorMessage2(error));
      }
    }
    /**
     * 订内核的输出与退出。只订一次；没授权时宿主会拒（SDK 只记一条 warn），所以授权了才订。
     * @param granted 已授予的能力。
     */
    observe(granted) {
      if (this.unobserve || !granted.includes(requiredCapability)) return;
      this.unobserve = jarvis.daemon.observe("sing-box", (event) => void this.onDaemonEvent(event));
    }
    async onDaemonEvent(event) {
      if (event.kind === "output") {
        if (Date.now() - this.lastOutputRefresh >= outputRefreshMs) {
          this.lastOutputRefresh = Date.now();
          await this.refresh();
          void this.speedLoop();
        }
        return;
      }
      if (!event.expected) {
        const control = await this.core.control();
        if (!control?.starting) {
          const preferences = await this.core.preferences(this.context?.preferences);
          const { message, hint } = describeFailure(event.lines, preferences);
          const failure = { at: Date.now(), message, lines: event.lines.slice(-20), hint };
          try {
            await jarvis.storage.set(storageKeys.failure, failure);
          } catch {
          }
          const last = lastMeaningfulLine(event.lines);
          await this.notify("\u4EE3\u7406\u5DF2\u505C\u6B62\uFF1Asing-box \u610F\u5916\u9000\u51FA", `${last || message}\u3002\u7CFB\u7EDF\u4EE3\u7406\u5DF2\u8FD8\u539F\u3002`);
        }
      }
      this.rate = null;
      this.lastSample = null;
      await this.refresh();
    }
    /** 重读状态、重推菜单。同一时刻只有一次在跑，期间再要求的合并成跑完后的一次。 */
    async refresh() {
      if (this.refreshing) {
        this.refreshAgain = true;
        return this.refreshing;
      }
      this.refreshing = (async () => {
        try {
          do {
            this.refreshAgain = false;
            try {
              const snapshot = await this.core.snapshot(this.context ? { granted: this.context.granted, preferences: this.context.preferences } : {});
              this.lastSnapshot = snapshot;
              this.autoPick = snapshot.phase === "running" && snapshot.selection.node === URLTEST_TAG ? await this.core.autoPick() : null;
              if (snapshot.phase !== "running") this.rate = null;
              await pushMenu(snapshot, { autoPick: this.autoPick, rate: this.rate, busy: this.core.busy });
            } catch (error) {
              jarvis.log.warn("\u83DC\u5355\u680F\u72B6\u6001\u6CA1\u5237\u65B0\u4E0A", errorMessage2(error));
            }
          } while (this.refreshAgain);
        } finally {
          this.refreshing = null;
        }
      })();
      return this.refreshing;
    }
    /** 订阅自动更新：每 30 秒看一次日程，到点就拉；节点真的变了且开着，`updateSubscriptions` 自己会重开。 */
    async scheduleLoop() {
      if (this.scheduleRunning) return;
      this.scheduleRunning = true;
      try {
        for (; ; ) {
          await sleep(scheduleTickMs);
          try {
            const preferences = await this.core.preferences();
            const schedule = await jarvis.storage.get(storageKeys.schedule) ?? { lastAttemptAt: null, lastSuccessAt: null };
            if (!isUpdateDue(schedule, preferences.updateInterval, Date.now())) continue;
            const granted = await this.core.granted();
            if (!granted.includes("network.https") || (await this.core.subscriptionURLs()).length === 0) continue;
            await this.core.updateSubscriptions({ granted });
            await this.refresh();
          } catch (error) {
            jarvis.log.warn("\u8BA2\u9605\u81EA\u52A8\u66F4\u65B0\u51FA\u9519", errorMessage2(error));
          }
        }
      } finally {
        this.scheduleRunning = false;
      }
    }
    /** 菜单栏速率：开着且偏好要显示时每秒读一次连接快照，两次之差就是速率；条件不成立就退出循环。 */
    async speedLoop() {
      if (this.speedRunning) return;
      const wanted = () => this.lastSnapshot?.phase === "running" && this.lastSnapshot.preferences.showSpeed;
      if (!wanted()) return;
      this.speedRunning = true;
      try {
        while (wanted()) {
          await sleep(speedTickMs);
          const snapshot = await this.core.connections();
          if (!snapshot) continue;
          const sample = { at: Date.now(), upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
          this.rate = trafficRate(this.lastSample, sample) ?? this.rate;
          this.lastSample = sample;
          if (this.lastSnapshot) await pushMenu(this.lastSnapshot, { autoPick: this.autoPick, rate: this.rate, busy: this.core.busy });
        }
      } finally {
        this.speedRunning = false;
        this.rate = null;
        this.lastSample = null;
      }
    }
  };

  // extensions/proxy/src/page.ts
  var toolboxNodeRows = 60;
  var windowNodeRows = 300;
  var connectionRows = 200;
  var logRows = 200;
  function renderPage(session2) {
    const snapshot = session2.snapshot;
    if (!snapshot) return ui.scroll({ children: [ui.text({ key: "loading", style: "footnote", text: "\u6B63\u5728\u8BFB\u53D6\u72B6\u6001" })] });
    const children = [statusSection(session2, snapshot), ...notes(session2, snapshot)];
    if (session2.surface === "window") {
      children.push(
        ui.segmented({
          key: "view",
          label: "\u7A97\u53E3\u91CC\u770B\u54EA\u4E00\u9875",
          layout: "full",
          value: session2.view,
          options: [
            { value: "nodes", title: "\u8282\u70B9" },
            { value: "connections", title: "\u8FDE\u63A5" },
            { value: "logs", title: "\u65E5\u5FD7" },
            { value: "subscriptions", title: "\u8BA2\u9605" }
          ],
          onChange: (value) => void session2.showView(value)
        })
      );
      children.push(...windowView(session2, snapshot));
    } else {
      if (snapshot.nodes.length > 0) children.push(modeSection(session2, snapshot), nodesSection(session2, snapshot, toolboxNodeRows));
      children.push(subscriptionsSection(session2, snapshot, false), commandSection(snapshot));
    }
    return ui.scroll({ children });
  }
  function statusSection(session2, snapshot) {
    const running = snapshot.phase === "running";
    const busy = session2.core.busy;
    const canToggle = busy === null && (running || snapshot.phase === "stopped" || snapshot.phase === "failed");
    const children = [
      ui.toggle({
        key: "power",
        title: running ? "\u4EE3\u7406\u5DF2\u5F00\u542F" : "\u4EE3\u7406",
        subtitle: statusLine({ ...snapshot, busy }),
        value: running,
        disabled: !canToggle,
        onChange: (on) => void session2.toggle(on)
      })
    ];
    if (running) {
      const condition = systemProxyCondition(snapshot.proxy, snapshot.granted);
      const subtitle = condition.kind === "active" ? `\u7CFB\u7EDF\u4EE3\u7406\u6307\u5411 127.0.0.1:${snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort}` : condition.kind === "notGranted" ? "\u6CA1\u6709\u6388\u6743\u4FEE\u6539\u7CFB\u7EDF\u4EE3\u7406" : condition.kind === "off" ? "\u6D4F\u89C8\u5668\u4E0E\u5927\u90E8\u5206\u5E94\u7528\u6B64\u523B\u4E0D\u7ECF\u8FC7\u4EE3\u7406" : condition.message;
      children.push(
        ui.toggle({
          key: "system-proxy",
          title: "\u8BBE\u4E3A\u7CFB\u7EDF\u4EE3\u7406",
          subtitle,
          value: condition.kind === "active",
          disabled: busy !== null || condition.kind === "notGranted" || condition.kind === "other",
          onChange: (on) => void session2.setSystemProxy(on)
        })
      );
    }
    if (session2.message) {
      children.push(ui.text({ key: "message", style: "footnote", tint: session2.message.ok ? "live" : "alert", text: session2.message.message }));
    }
    const trailing = running && session2.rate ? `\u2193 ${formatRate(session2.rate.down)}  \u2191 ${formatRate(session2.rate.up)}` : void 0;
    return ui.section({ key: "status", title: "\u4EE3\u7406 \xB7 PROXY", ...trailing ? { trailing } : {}, tint: running ? "live" : "neutral", children });
  }
  function notes(session2, snapshot) {
    const out = [];
    const action = (id, title, onPress, extra = {}) => ({ id, title, onPress, ...extra });
    switch (snapshot.phase) {
      case "notGranted":
        out.push(
          ui.note({
            key: "not-granted",
            tint: "alert",
            symbol: "lock",
            title: "\u8FD8\u6CA1\u6709\u6388\u6743",
            body: "\u300C\u4EE3\u7406\u300D\u8981\u5728\u540E\u53F0\u5E38\u9A7B\u8FD0\u884C sing-box\u3001\u5F00\u7740\u65F6\u628A\u7CFB\u7EDF\u4EE3\u7406\u6307\u5411\u5B83\u3001\u62C9\u53D6\u4F60\u586B\u7684\u8BA2\u9605\u5730\u5740\u3002\u6CA1\u6709\u300C\u540E\u53F0\u8FD0\u884C sing-box\u300D\u8FD9\u4E00\u9879\uFF0C\u5B83\u4EC0\u4E48\u90FD\u505A\u4E0D\u4E86\uFF1B\u5176\u4F59\u51E0\u9879\u53EF\u4EE5\u53EA\u7ED9\u4E00\u90E8\u5206\u3002",
            actions: [action("grant", "\u6388\u6743", () => void session2.grant())]
          })
        );
        break;
      case "notInstalled":
        out.push(
          snapshot.preferences.singBoxPath ? ui.note({
            key: "bad-path",
            tint: "alert",
            symbol: "questionmark.folder",
            title: "\u8BBE\u7F6E\u91CC\u586B\u7684 sing-box \u8DEF\u5F84\u4E0D\u53EF\u7528",
            body: `${snapshot.preferences.singBoxPath} \u4E0D\u5B58\u5728\u6216\u4E0D\u662F\u53EF\u6267\u884C\u6587\u4EF6\uFF0C\u6587\u4EF6\u540D\u5FC5\u987B\u662F sing-box\u3002\u6539\u5BF9\u8DEF\u5F84\uFF0C\u6216\u8005\u6E05\u7A7A\u5B83\u8BA9 Jarvis \u81EA\u5DF1\u627E\uFF08Homebrew \u88C5\u7684\u4F1A\u81EA\u52A8\u627E\u5230\uFF09\u3002`,
            actions: [action("settings", "\u6253\u5F00\u8BBE\u7F6E", () => session2.openSettings())]
          }) : ui.note({
            key: "not-installed",
            tint: "alert",
            symbol: "shippingbox",
            title: "\u6CA1\u6709\u627E\u5230 sing-box",
            body: session2.installingSince !== null ? "\u7EC8\u7AEF\u91CC\u6B63\u5728\u5B89\u88C5\uFF1B\u88C5\u597D\u4E4B\u540E\u8FD9\u91CC\u4F1A\u81EA\u5DF1\u6362\u6389\uFF08\u6BCF 2 \u79D2\u67E5\u4E00\u6B21\uFF09\u3002\u7EC8\u7AEF\u91CC\u5199\u7740\u6CA1\u88C5\u6210\u7684\u8BDD\uFF0C\u6309\u5B83\u8BF4\u7684\u505A\u5B8C\u518D\u56DE\u6765\u3002" : "\u300C\u4EE3\u7406\u300D\u7528\u4F60\u81EA\u5DF1\u88C5\u7684 sing-box \u505A\u5185\u6838\u3002\u70B9\u300C\u5728\u7EC8\u7AEF\u4E2D\u5B89\u88C5\u300D\u4F1A\u5728\u7EC8\u7AEF\u91CC\u6267\u884C brew install sing-box\uFF1B\u8FD9\u53F0 Mac \u6CA1\u6709 Homebrew \u65F6\uFF0C\u7EC8\u7AEF\u91CC\u4F1A\u5199\u660E\u8FD8\u5269\u54EA\u51E0\u6761\u8DEF\u3002",
            actions: [action("install", "\u5728\u7EC8\u7AEF\u4E2D\u5B89\u88C5", () => void session2.install(), { disabled: session2.installingSince !== null })]
          })
        );
        break;
      case "noNodes": {
        const errors = snapshot.subscriptions.filter((record) => record.error).map((record) => `${record.host}\uFF1A${record.error}`);
        out.push(
          snapshot.subscriptionCount === 0 ? ui.note({
            key: "no-subscription",
            tint: "alert",
            symbol: "link.badge.plus",
            title: "\u8FD8\u6CA1\u6709\u8BA2\u9605",
            body: "\u5728\u8BBE\u7F6E\u91CC\u586B\u8BA2\u9605\u5730\u5740\uFF08\u673A\u573A\u7ED9\u7684\u90A3\u4E00\u4E32 https \u94FE\u63A5\uFF0C\u53EF\u4EE5\u586B\u51E0\u6761\uFF09\uFF0C\u518D\u56DE\u6765\u70B9\u300C\u66F4\u65B0\u8BA2\u9605\u300D\u3002\u8BA4\u5206\u4EAB\u94FE\u63A5\uFF08\u6574\u6BB5 base64 \u6216\u9010\u884C\uFF09\u4E0E sing-box JSON\uFF1BClash YAML \u672C\u671F\u4E0D\u8BA4\u3002",
            actions: [action("settings", "\u6253\u5F00\u8BBE\u7F6E", () => session2.openSettings())]
          }) : ui.note({
            key: "no-nodes",
            tint: "alert",
            symbol: "exclamationmark.magnifyingglass",
            title: "\u8BA2\u9605\u91CC\u6CA1\u6709\u8BA4\u51FA\u8282\u70B9",
            body: errors.length > 0 ? errors.join("\n") : "\u586B\u4E86\u8BA2\u9605\u5730\u5740\uFF0C\u4F46\u8FD8\u6CA1\u6709\u62C9\u8FC7\u3002\u70B9\u300C\u66F4\u65B0\u8BA2\u9605\u300D\u62C9\u4E00\u6B21\u3002",
            actions: [
              action("update", "\u66F4\u65B0\u8BA2\u9605", () => void session2.update(), { disabled: session2.core.busy !== null }),
              action("settings", "\u6253\u5F00\u8BBE\u7F6E", () => session2.openSettings())
            ]
          })
        );
        break;
      }
      case "failed": {
        const failure = snapshot.failure;
        const upgrade = failure?.hint.includes("brew upgrade") === true;
        out.push(
          ui.note({
            key: "failed",
            tint: "danger",
            symbol: "exclamationmark.triangle",
            title: failure?.message ?? "sing-box \u9000\u51FA\u4E86",
            body: failure?.hint || "\u4E0B\u9762\u662F sing-box \u6700\u540E\u7684\u8F93\u51FA\u3002\u6539\u4E86\u8BBE\u7F6E\u4E4B\u540E\u70B9\u300C\u91CD\u8BD5\u300D\uFF1B\u770B\u4E0D\u61C2\u5C31\u6253\u5F00\u65E5\u5FD7\u3002",
            actions: [
              action("retry", "\u91CD\u8BD5", () => void session2.toggle(true), { disabled: session2.core.busy !== null }),
              ...upgrade ? [action("upgrade", "\u5728\u7EC8\u7AEF\u4E2D\u66F4\u65B0 sing-box", () => void session2.install())] : [],
              action("logs", "\u67E5\u770B\u65E5\u5FD7", () => session2.openWindow("logs"))
            ]
          })
        );
        if (failure && failure.lines.length > 0) {
          out.push(ui.result({ key: "failed-lines", mono: true, lines: 8, copy: true, error: true, text: failure.lines.slice(-8).join("\n") }));
        }
        break;
      }
      case "running": {
        const condition = systemProxyCondition(snapshot.proxy, snapshot.granted);
        const port = snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort;
        if (snapshot.preferences.systemProxy && (condition.kind === "blocked" || condition.kind === "other")) {
          out.push(
            ui.note({
              key: "blocked",
              tint: "alert",
              symbol: "hand.raised",
              title: "\u7CFB\u7EDF\u4EE3\u7406\u88AB\u522B\u7684\u4EE3\u7406\u5DE5\u5177\u62E6\u7740",
              body: `${condition.message}
\u300C\u4EE3\u7406\u300D\u7167\u5E38\u5728 127.0.0.1:${port} \u4E0A\u8FD0\u884C\uFF0C\u53EA\u662F\u7CFB\u7EDF\u4EE3\u7406\u6CA1\u6709\u6539\uFF1A\u8981\u8BA9\u6D4F\u89C8\u5668\u7ECF\u8FC7\u5B83\uFF0C\u5148\u5173\u6389\u90A3\u4E2A\u5DE5\u5177\u7684\u589E\u5F3A\u6A21\u5F0F / \u7CFB\u7EDF\u4EE3\u7406\uFF0C\u518D\u6253\u5F00\u4E0A\u9762\u7684\u300C\u8BBE\u4E3A\u7CFB\u7EDF\u4EE3\u7406\u300D\u3002\u547D\u4EE4\u884C\u5DE5\u5177\u53EF\u4EE5\u76F4\u63A5\u7528\u4E0B\u9762\u8FD9\u6761\u547D\u4EE4\u3002`
            })
          );
          out.push(ui.copy({ key: "blocked-copy", text: terminalProxyCommand(port), label: "\u590D\u5236\u7EC8\u7AEF\u4EE3\u7406\u547D\u4EE4", variant: "chip" }));
        }
        if (snapshot.control?.ruleSetFallback) {
          out.push(
            ui.note({
              key: "rule-set-fallback",
              tint: "amber",
              symbol: "arrow.triangle.branch",
              title: "\u8FD9\u4E00\u6B21\u6CA1\u6709\u5206\u6D41",
              body: "\u4E2D\u56FD\u5927\u9646\u89C4\u5219\u96C6\u6CA1\u4E0B\u8F7D\u4E0B\u6765\uFF0C\u6240\u6709\u6D41\u91CF\uFF08\u5C40\u57DF\u7F51\u9664\u5916\uFF09\u90FD\u8D70\u8282\u70B9\u3002\u7F51\u7EDC\u597D\u4E86\u4E4B\u540E\u91CD\u65B0\u5F00\u542F\u4E00\u6B21\u5C31\u4F1A\u5206\u6D41\u3002"
            })
          );
        }
        const reasons = restartReasons(snapshot.control, snapshot.preferences, nodesDigest(snapshot.nodes));
        if (reasons.length > 0) {
          out.push(
            ui.note({
              key: "restart",
              tint: "blue",
              symbol: "arrow.triangle.2.circlepath",
              title: "\u91CD\u65B0\u5F00\u542F\u4E4B\u540E\u751F\u6548",
              body: `${reasons.join("\u3001")}\uFF1B\u5728\u8DD1\u7684\u8FD9\u4E00\u4EFD\u8FD8\u662F\u65E7\u7684\u3002\u91CD\u65B0\u5F00\u542F\u4F1A\u65AD\u5F00\u73B0\u6709\u8FDE\u63A5\u4E00\u4E0B\u3002`,
              actions: [action("restart", "\u91CD\u65B0\u5F00\u542F", () => void session2.restart(), { disabled: session2.core.busy !== null })]
            })
          );
        }
        break;
      }
    }
    return out;
  }
  function modeSection(session2, snapshot) {
    const mode = snapshot.selection.mode;
    return ui.section({
      key: "mode",
      title: "\u6A21\u5F0F \xB7 MODE",
      children: [
        ui.segmented({
          key: "mode-picker",
          label: "\u51FA\u7AD9\u6A21\u5F0F",
          layout: "full",
          value: mode,
          options: Object.keys(modeTitles).map((value) => ({ value, title: modeTitles[value], help: modeHelps[value] })),
          onChange: (value) => void session2.setMode(value)
        }),
        ui.text({ key: "mode-help", style: "footnote", text: modeHelps[mode] })
      ]
    });
  }
  function delayTint(delay) {
    if (delay === void 0) return void 0;
    if (delay === null) return "danger";
    return delay < 300 ? "live" : delay < 800 ? "amber" : "alert";
  }
  function nodeRow(session2, snapshot, node) {
    const delay = snapshot.latency.values[node.name];
    const parts = [protocolTitles[node.protocol]];
    const reading = formatDelay(delay);
    if (reading) parts.push(reading);
    if (session2.autoPick === node.name && snapshot.selection.node === URLTEST_TAG) parts.push("\u81EA\u52A8\u9009\u62E9\u6B64\u523B\u7528\u5B83");
    const tint = delayTint(delay);
    return ui.row({
      key: `node:${node.name}`,
      symbol: "server.rack",
      title: node.name,
      subtitle: parts.join(" \xB7 "),
      ...tint ? { tint } : {},
      selected: snapshot.selection.node === node.name,
      onPress: () => void session2.selectNode(node.name)
    });
  }
  function nodesSection(session2, snapshot, limit) {
    const running = snapshot.phase === "running";
    const query = session2.filter.trim().toLowerCase();
    const matched = query ? snapshot.nodes.filter((node) => node.name.toLowerCase().includes(query) || node.protocol.includes(query)) : snapshot.nodes;
    const shown = matched.slice(0, limit);
    const autoSubtitle = running && session2.autoPick && snapshot.selection.node === URLTEST_TAG ? `\u6B64\u523B\u7528\u300C${session2.autoPick}\u300D` : "\u6309\u5EF6\u8FDF\u81EA\u52A8\u6311\u6700\u5FEB\u7684\u90A3\u4E2A";
    const rows = [
      ui.row({
        key: "node:auto",
        symbol: "bolt.horizontal",
        title: URLTEST_TAG,
        subtitle: autoSubtitle,
        selected: snapshot.selection.node === URLTEST_TAG,
        onPress: () => void session2.selectNode(URLTEST_TAG)
      }),
      ...shown.map((node) => nodeRow(session2, snapshot, node))
    ];
    const children = [];
    if (snapshot.nodes.length > 8) {
      children.push(ui.search({ key: "node-search", value: session2.filter, placeholder: "\u641C\u7D22\u8282\u70B9", label: "\u641C\u7D22\u8282\u70B9", onChange: (value) => session2.search(value) }));
    }
    children.push(ui.list({ key: "nodes", children: rows }));
    if (matched.length > shown.length) {
      children.push(ui.text({ key: "nodes-more", style: "footnote", text: `\u53E6\u6709 ${matched.length - shown.length} \u4E2A\u6CA1\u5217\u51FA\u6765\uFF1A\u7528\u641C\u7D22\u627E\uFF0C\u6216\u5728\u7A97\u53E3\u91CC\u770B\u5168\u90E8` }));
    }
    const tested = snapshot.latency.testedAt ? ` \xB7 \u6D4B\u4E8E${formatAge(snapshot.latency.testedAt, Date.now())}` : "";
    return ui.section({
      key: "nodes-section",
      title: "\u8282\u70B9 \xB7 NODES",
      trailing: `${snapshot.nodes.length} \u4E2A${tested}`,
      actions: [
        {
          id: "test",
          title: "\u6D4B\u901F",
          symbol: "speedometer",
          help: running ? "\u6D4B\u4E00\u904D\u5168\u90E8\u8282\u70B9\u7684\u5EF6\u8FDF" : "\u4EE3\u7406\u5F00\u7740\u624D\u80FD\u6D4B\u901F",
          disabled: !running || session2.core.busy !== null,
          onPress: () => void session2.test()
        }
      ],
      children
    });
  }
  function subscriptionsSection(session2, snapshot, detailed) {
    const now = Date.now();
    const latest = snapshot.subscriptions.reduce((max, record) => record.fetchedAt !== null && (max === null || record.fetchedAt > max) ? record.fetchedAt : max, null);
    const rows = snapshot.subscriptions.map((record) => {
      const parts = [];
      if (record.error) parts.push(`\u4E0A\u6B21\u6CA1\u66F4\u65B0\u4E0A\uFF1A${record.error}`);
      parts.push(`${record.nodeCount} \u4E2A\u8282\u70B9`);
      if (record.fetchedAt !== null) parts.push(`\u66F4\u65B0\u4E8E${formatAge(record.fetchedAt, now)}`);
      if (record.usage) parts.push(describeUsage(record.usage));
      if (record.skippedTotal > 0) parts.push(`${record.skippedTotal} \u884C\u8BA4\u4E0D\u51FA`);
      return ui.row({
        key: `sub:${record.id}`,
        symbol: record.error ? "exclamationmark.triangle" : "link",
        title: `${record.position}. ${record.host}`,
        subtitle: parts.join(" \xB7 "),
        ...record.error ? { tint: "alert" } : {},
        ...detailed ? {} : { accessory: "chevron", onPress: () => session2.openWindow("subscriptions") }
      });
    });
    const children = [
      ui.list({
        key: "subscriptions",
        children: rows,
        emptyState: ui.empty({
          key: "no-subscriptions",
          symbol: "link.badge.plus",
          title: snapshot.subscriptionCount > 0 ? "\u8FD8\u6CA1\u6709\u62C9\u8FC7\u8BA2\u9605" : "\u8BBE\u7F6E\u91CC\u8FD8\u6CA1\u6709\u8BA2\u9605\u5730\u5740",
          hint: snapshot.subscriptionCount > 0 ? "\u70B9\u53F3\u4E0A\u89D2\u300C\u66F4\u65B0\u300D\u62C9\u4E00\u6B21\u3002" : "\u5728\u8BBE\u7F6E \xB7 \u6269\u5C55 \xB7 \u4EE3\u7406\u91CC\u586B\u8BA2\u9605\u5730\u5740\u3002"
        })
      })
    ];
    if (detailed) {
      for (const record of snapshot.subscriptions) {
        if (record.skipped.length === 0) continue;
        children.push(
          ui.section({
            key: `skipped:${record.id}`,
            title: `\u8BA4\u4E0D\u51FA\u7684\u884C \xB7 ${record.host}`,
            trailing: record.skippedTotal > record.skipped.length ? `\u524D ${record.skipped.length} / ${record.skippedTotal} \u884C` : `${record.skippedTotal} \u884C`,
            tint: "alert",
            children: [
              ui.list({
                key: `skipped-list:${record.id}`,
                children: record.skipped.map(
                  (line, index) => ui.row({ key: `skipped:${record.id}:${index}`, symbol: "questionmark.circle", title: line.reason, subtitle: line.line })
                )
              })
            ]
          })
        );
      }
    }
    return ui.section({
      key: "subscriptions-section",
      title: "\u8BA2\u9605 \xB7 SUBSCRIPTIONS",
      ...latest !== null ? { trailing: `\u66F4\u65B0\u4E8E${formatAge(latest, now)}` } : {},
      actions: [
        {
          id: "update",
          title: "\u66F4\u65B0\u8BA2\u9605",
          symbol: "arrow.clockwise",
          help: snapshot.granted.includes("network.https") ? "\u91CD\u65B0\u62C9\u4E00\u904D\u5168\u90E8\u8BA2\u9605" : "\u8FD8\u6CA1\u6709\u6388\u6743\u62C9\u53D6\u8BA2\u9605\u5730\u5740",
          disabled: session2.core.busy !== null || snapshot.subscriptionCount === 0,
          onPress: () => void session2.update()
        }
      ],
      children
    });
  }
  function commandSection(snapshot) {
    const command = terminalProxyCommand(snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort);
    return ui.section({
      key: "terminal",
      title: "\u7EC8\u7AEF \xB7 TERMINAL",
      children: [
        ui.text({ key: "terminal-help", style: "footnote", text: "\u547D\u4EE4\u884C\u5DE5\u5177\u4E0D\u8BFB\u7CFB\u7EDF\u4EE3\u7406\uFF1A\u5728\u7EC8\u7AEF\u91CC\u7C98\u8D34\u8FD9\u4E00\u884C\uFF0C\u8FD9\u4E2A\u7EC8\u7AEF\u91CC\u7684 curl\u3001git\u3001brew \u5C31\u4F1A\u7ECF\u8FC7\u4EE3\u7406\u3002" }),
        ui.copy({ key: "terminal-copy", text: command, label: "\u590D\u5236\u7EC8\u7AEF\u4EE3\u7406\u547D\u4EE4", variant: "chip" })
      ]
    });
  }
  function windowView(session2, snapshot) {
    switch (session2.view) {
      case "connections":
        return [connectionsSection(session2, snapshot)];
      case "logs":
        return [logsSection(session2)];
      case "subscriptions":
        return [subscriptionsSection(session2, snapshot, true), commandSection(snapshot)];
      default:
        return snapshot.nodes.length > 0 ? [modeSection(session2, snapshot), nodesSection(session2, snapshot, windowNodeRows)] : [];
    }
  }
  function connectionsSection(session2, snapshot) {
    const data = session2.connections;
    const list = data ? [...data.connections].sort((a, b) => b.start - a.start).slice(0, connectionRows) : [];
    const trailing = data ? `${data.connections.length} \u6761 \xB7 \u2193 ${formatBytes(data.downloadTotal)}  \u2191 ${formatBytes(data.uploadTotal)}` : void 0;
    return ui.section({
      key: "connections-section",
      title: "\u8FDE\u63A5 \xB7 CONNECTIONS",
      ...trailing ? { trailing } : {},
      children: [
        ui.list({
          key: "connections",
          children: list.map(
            (connection) => ui.row({
              key: `conn:${connection.id}`,
              symbol: connection.chains.includes("direct") ? "arrow.right" : "point.3.connected.trianglepath.dotted",
              title: connection.host || "\uFF08\u6CA1\u6709\u4E3B\u673A\u540D\uFF09",
              subtitle: [connection.chains[0] ?? "", connection.network, `\u2193 ${formatBytes(connection.download)} \u2191 ${formatBytes(connection.upload)}`, connection.rule].filter((part) => part.length > 0).join(" \xB7 ")
            })
          ),
          emptyState: ui.empty({
            key: "no-connections",
            symbol: "point.3.connected.trianglepath.dotted",
            title: snapshot.phase === "running" ? "\u6B64\u523B\u6CA1\u6709\u8FDE\u63A5" : "\u4EE3\u7406\u6CA1\u5F00",
            hint: snapshot.phase === "running" ? "\u6BCF\u79D2\u5237\u65B0\u4E00\u6B21\u3002" : "\u5F00\u542F\u4E4B\u540E\uFF0C\u7ECF\u8FC7\u4EE3\u7406\u7684\u6BCF\u4E00\u6761\u8FDE\u63A5\u90FD\u4F1A\u5217\u5728\u8FD9\u91CC\u3002"
          })
        })
      ]
    });
  }
  function logsSection(session2) {
    const tail = session2.logs.slice(-logRows);
    let text = tail.join("\n");
    if (text.length > 19e3) text = text.slice(text.length - 19e3);
    return ui.section({
      key: "logs-section",
      title: "\u65E5\u5FD7 \xB7 LOGS",
      trailing: `${session2.logs.length} \u884C`,
      actions: [{ id: "reload", title: "\u91CD\u8BFB", symbol: "arrow.clockwise", help: "\u91CD\u8BFB sing-box \u6700\u8FD1 500 \u884C\u8F93\u51FA", onPress: () => void session2.showView("logs") }],
      children: [ui.result({ key: "log-text", mono: true, copy: true, text, empty: "sing-box \u8FD8\u6CA1\u6709\u8F93\u51FA" })]
    });
  }

  // extensions/proxy/src/session.ts
  var maximumLogLines = 500;
  var installWaitMs = 10 * 60 * 1e3;
  var Session = class {
    constructor() {
      this.core = new ProxyCore(() => jarvis.ui.update());
      this.surface = "toolbox";
      this.snapshot = null;
      this.view = "nodes";
      /** 节点搜索框里的字。 */
      this.filter = "";
      /** 上一个动作的结果（页面上那一行）。 */
      this.message = null;
      this.rate = null;
      this.connections = null;
      this.logs = [];
      /** 「自动选择」此刻选中的节点。 */
      this.autoPick = null;
      /** 点「在终端中安装」的时刻；不在等为 `null`。 */
      this.installingSince = null;
      this.sample = null;
      this.generation = 0;
      this.unobserve = null;
      this.unwatch = null;
      /** 交给 `defineExtension` 的页面（工具箱与窗口同一份，按 `surface` 画）。 */
      this.page = {
        activate: (context) => this.activate(context),
        deactivate: () => this.deactivate(),
        render: () => renderPage(this)
      };
    }
    async activate(context) {
      this.surface = context.surface;
      this.generation += 1;
      const generation = this.generation;
      await this.refresh();
      this.observe();
      if (!this.unwatch) this.unwatch = jarvis.preferences.onChange(() => void this.refresh());
      if (this.surface === "window") await this.loadLogs();
      void this.loop(generation);
    }
    deactivate() {
      this.generation += 1;
      this.unobserve?.();
      this.unobserve = null;
      this.unwatch?.();
      this.unwatch = null;
      this.sample = null;
      this.rate = null;
    }
    /** 重读全部状态，重画，并把菜单栏也推一份（后台会话可能此刻没在跑，图标不能停在旧状态）。 */
    async refresh() {
      try {
        const snapshot = await this.core.snapshot();
        this.snapshot = snapshot;
        this.autoPick = snapshot.phase === "running" ? await this.core.autoPick() : null;
        if (snapshot.phase !== "running") {
          this.rate = null;
          this.connections = null;
        }
        if (this.installingSince !== null && (snapshot.phase !== "notInstalled" || Date.now() - this.installingSince > installWaitMs)) {
          this.installingSince = null;
        }
        jarvis.ui.update();
        await pushMenu(snapshot, { autoPick: this.autoPick, rate: null, busy: this.core.busy });
      } catch (error) {
        this.message = { ok: false, message: `\u8BFB\u4E0D\u51FA\u72B6\u6001\uFF1A${errorMessage2(error)}` };
        jarvis.ui.update();
      }
    }
    observe() {
      if (this.unobserve || !this.snapshot?.granted.includes(requiredCapability)) return;
      this.unobserve = jarvis.daemon.observe("sing-box", (event) => {
        if (event.kind === "output") {
          this.logs = [...this.logs, ...event.lines].slice(-maximumLogLines);
          if (this.surface === "window" && this.view === "logs") jarvis.ui.update();
          return;
        }
        void this.onExit(event.expected, event.lines);
      });
    }
    /**
     * 内核退出了。意外退出时也在这里记一份失败（后台会话没在跑时——用户关了「在菜单栏显示」——没有别人会记），
     * 开启过程中的退出除外：那由正在开启的一方处理。
     */
    async onExit(expected, lines) {
      if (!expected) {
        const control = await this.core.control();
        if (!control?.starting) {
          const preferences = await this.core.preferences();
          const { message, hint } = describeFailure(lines, preferences);
          try {
            await jarvis.storage.set(storageKeys.failure, { at: Date.now(), message, lines: lines.slice(-20), hint });
          } catch {
          }
        }
      }
      await this.refresh();
    }
    async loadLogs() {
      this.logs = (await this.core.logs()).slice(-maximumLogLines);
      jarvis.ui.update();
    }
    /** 页面开着时的每秒一拍。 */
    async loop(generation) {
      for (let tick = 1; ; tick += 1) {
        await sleep(1e3);
        if (generation !== this.generation) return;
        if (this.snapshot?.phase === "running") {
          const snapshot = await this.core.connections();
          if (generation !== this.generation) return;
          if (snapshot) {
            const sample = { at: Date.now(), upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
            this.rate = trafficRate(this.sample, sample) ?? this.rate;
            this.sample = sample;
            this.connections = snapshot;
            jarvis.ui.update();
          }
        }
        const waitingInstall = this.installingSince !== null && tick % 2 === 0;
        if (waitingInstall || tick % 10 === 0) await this.refresh();
      }
    }
    /**
     * 跑一个动作：记下结果那一句、重读状态。
     * @param action 动作。
     */
    async run(action) {
      this.message = null;
      jarvis.ui.update();
      let result;
      try {
        result = await action();
      } catch (error) {
        result = { ok: false, message: errorMessage2(error) };
      }
      this.message = result.message ? result : null;
      await this.refresh();
    }
    /** 开 / 关。 */
    toggle(on) {
      return this.run(() => on ? this.core.turnOn() : this.core.turnOff());
    }
    /** 重开（设置或订阅改过）。 */
    restart() {
      return this.run(() => this.core.restart());
    }
    /** 一次问完全部授权（只在用户按下的回调里有效）。 */
    grant() {
      return this.run(async () => {
        const result = await jarvis.permissions.request([...allCapabilities]);
        this.observe();
        return result.denied.includes(requiredCapability) ? { ok: false, message: "\u6CA1\u6709\u6388\u6743\u5728\u540E\u53F0\u8FD0\u884C sing-box\uFF0C\u300C\u4EE3\u7406\u300D\u5F00\u4E0D\u8D77\u6765" } : { ok: true, message: "" };
      });
    }
    /** 在终端里装 / 升级 sing-box；没授权终端先问一次。 */
    install() {
      return this.run(async () => {
        if (!this.snapshot?.granted.includes("terminal.run")) {
          const result2 = await jarvis.permissions.request(["terminal.run"]);
          if (!result2.granted.includes("terminal.run")) return { ok: false, message: "\u6CA1\u6709\u6388\u6743\u6253\u5F00\u7EC8\u7AEF\uFF1A\u81EA\u5DF1\u5728\u7EC8\u7AEF\u91CC\u8FD0\u884C brew install sing-box \u4E5F\u884C" };
        }
        const result = await this.core.install();
        if (result.ok) this.installingSince = Date.now();
        return result;
      });
    }
    /** 打开设置里「代理」那一块。 */
    openSettings() {
      void jarvis.system.openExtensionSettings().catch(() => void 0);
    }
    /**
     * 在工作区窗口里打开，并落在某一页。
     * @param view 哪一页。
     */
    openWindow(view) {
      this.view = view;
      void jarvis.window.open().catch(() => void 0);
    }
    /**
     * 换窗口里的页。
     * @param view 哪一页。
     */
    async showView(view) {
      this.view = view;
      jarvis.ui.update();
      if (view === "logs") await this.loadLogs();
    }
    setMode(mode) {
      return this.run(() => this.core.setMode(mode));
    }
    selectNode(name) {
      return this.run(() => this.core.selectNode(name));
    }
    setSystemProxy(on) {
      return this.run(() => this.core.setSystemProxy(on));
    }
    test() {
      return this.run(() => this.core.testLatency());
    }
    update() {
      return this.run(() => this.core.updateSubscriptions());
    }
    /**
     * 改搜索框。
     * @param value 字。
     */
    search(value) {
      this.filter = value;
    }
  };

  // extensions/proxy/src/index.ts
  var session = new Session();
  var background = new Background();
  defineExtension({
    toolbox: session.page,
    window: session.page,
    menuBar: {
      start: (context) => background.start(context),
      open: (context) => background.open(context),
      select: (context, itemId) => background.select(context, itemId)
    },
    commands: {
      toggle: (context) => background.command(context)
    }
  });
})();
