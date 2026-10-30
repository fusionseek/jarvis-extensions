// jarvis-extension bundle · proxy@1.0.3 · sdk 2.13.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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

  // sdk/src/layout.ts
  var layout = {
    /** 侧栏导航（只许做根）。 */
    sidebar: (props) => ({ kind: "sidebar", ...props }),
    /** 自适应网格。 */
    grid: (props) => ({ kind: "grid", ...props }),
    /** 表格。 */
    table: (props) => ({ kind: "table", ...props }),
    /** 堆叠柱。 */
    bars: (props) => ({ kind: "bars", ...props }),
    /** 宿主画的偏好控件。 */
    preference: (props) => ({ kind: "preference", ...props }),
    /** 窗口一页的页头（jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-2，宿主 ≥ 3.3.1）。 */
    header: (props) => ({ kind: "header", ...props })
  };

  // sdk/src/index.ts
  var sdkVersion = "2.13.0";
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
      /** `jarvis.permissions.onChange` 的监听者（SDK 2.13）：只在本地听宿主已有的 `permissionsChanged`，不上线缆。 */
      this.permissionListeners = /* @__PURE__ */ new Set();
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
    /**
     * 听授权变化（SDK 2.13）。监听者抛错只记日志，不影响别的监听者与重画。
     * @param listener 授权变了就调，带此刻的授权。
     * @returns 退订。
     */
    onPermissions(listener) {
      this.permissionListeners.add(listener);
      return () => {
        this.permissionListeners.delete(listener);
      };
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
        case "preferencesChanged": {
          this.requestUpdate();
          return;
        }
        case "permissionsChanged": {
          for (const listener of [...this.permissionListeners]) {
            try {
              listener(event.granted);
            } catch (error) {
              this.log("error", "permissions.onChange \u7684\u56DE\u8C03\u629B\u9519", error instanceof Error ? error.message : String(error));
            }
          }
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
  function networkStatus() {
    return runtime.invoke("network", "status", {});
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
    browser: namespaced("browser"),
    inputSources: namespaced("inputSources"),
    frontmostApp: namespaced("frontmostApp"),
    hud: namespaced("hud")
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
      // SDK 2.12：第二个参数可以是 `{ argument?, anchor? }`——弹窗挂在自己的一枚状态项下面。字符串照旧是参数。
      run: (id, argument) => {
        if (argument === void 0) return call.commands("run", { id });
        if (typeof argument === "string") return call.commands("run", { id, argument });
        return call.commands("run", {
          id,
          ...argument.argument === void 0 ? {} : { argument: argument.argument },
          ...argument.anchor === void 0 ? {} : { anchor: { statusItem: argument.anchor.statusItem } }
        });
      }
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
      openSystemSettings: (kind) => call.permissions("openSystemSettings", { kind }),
      onChange: (listener) => runtime.onPermissions(listener)
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
      observe: (listener) => runtime.subscribe("menuBarExtras", "observe", listener),
      // SDK 2.12：截图、点开。
      capture: (ids) => call.menuBarExtras("capture", { ids: [...new Set(ids)] }),
      press: (id, options) => {
        const button = options?.button ?? "left";
        const onMenu = options?.onMenu;
        if (!onMenu) return call.menuBarExtras("press", { id, button });
        const token = runtime.token("menuBarExtras", "press");
        runtime.listen(token, (payload) => {
          const state = payload.state;
          if (state !== "opened") runtime.forget(token);
          onMenu(state);
        });
        return call.menuBarExtras("press", { id, button, token }).catch((error) => {
          runtime.forget(token);
          throw error;
        });
      }
    },
    screens: {
      list: () => call.screens("list"),
      observe: (listener) => runtime.subscribe("screens", "observe", (payload) => listener(payload.screens))
    },
    // SDK 2.13：输入源、前台应用、提示（jarvis-mac `specs/20261030-170731-input-source-switch-p1` N-1…N-3）。
    inputSources: {
      list: () => call.inputSources("list"),
      current: () => call.inputSources("current"),
      select: (id) => call.inputSources("select", { id }),
      observe: (listener) => runtime.subscribe("inputSources", "observe", listener)
    },
    frontmostApp: {
      current: () => call.frontmostApp("current"),
      observe: (listener) => runtime.subscribe("frontmostApp", "observe", listener)
    },
    hud: {
      show: async (options) => {
        await call.hud("show", {
          text: options.text,
          anchor: options.anchor,
          ...options.symbol === void 0 ? {} : { symbol: options.symbol },
          ...options.image === void 0 ? {} : { image: options.image },
          ...options.duration === void 0 ? {} : { duration: options.duration }
        });
      }
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
    const list2 = Array.isArray(body.connections) ? body.connections : [];
    const connections = [];
    for (const item of list2) {
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
        start: Number.isFinite(started) ? started : 0,
        source: sourceOf(string(metadata.sourceIP), string(metadata.sourcePort)),
        process: processOf(string(metadata.processPath))
      });
    }
    return { uploadTotal: number(body.uploadTotal), downloadTotal: number(body.downloadTotal), connections };
  }
  function sourceOf(ip, port) {
    if (!ip || !port) return "";
    return ip.includes(":") ? `[${ip}]:${port}` : `${ip}:${port}`;
  }
  function processOf(value) {
    return value.replace(/ \([^()]*\)$/, "");
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
  var proxyProtocols = ["shadowsocks", "vmess", "vless", "trojan", "hysteria2", "tuic", "anytls"];
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

  // extensions/proxy/src/rules.ts
  var maximumPageRules = 500;
  function isPolicyRef(value) {
    return value === "proxy" || value === "direct" || value === "reject" || typeof value === "string" && /^group:.+$/.test(value);
  }
  function normalizePageRules(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const rule = item;
      const kind = rule.kind === "domain" ? "domain" : rule.kind === "domain_suffix" ? "domain_suffix" : null;
      const value = typeof rule.value === "string" ? normalizeHost(rule.value) : "";
      if (!kind || !value || !isPolicyRef(rule.policy)) continue;
      const id = `${kind}:${value}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, kind, value, policy: rule.policy, createdAt: typeof rule.createdAt === "number" ? rule.createdAt : 0 });
    }
    return out.slice(0, maximumPageRules);
  }
  function upsertPageRule(rules, rule, now) {
    const value = normalizeHost(rule.value);
    if (!value) return [...rules];
    const id = `${rule.kind}:${value}`;
    return [{ id, kind: rule.kind, value, policy: rule.policy, createdAt: now }, ...rules.filter((existing) => existing.id !== id)].slice(0, maximumPageRules);
  }
  function removePageRule(rules, id) {
    return rules.filter((rule) => rule.id !== id);
  }
  function normalizeHost(value) {
    let host = value.trim().toLowerCase();
    const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
    if (bracket) return bracket[1];
    if ((host.match(/:/g) ?? []).length === 1) host = host.replace(/:\d+$/, "");
    host = host.replace(/\.$/, "");
    return /^[a-z0-9_.:-]+$/.test(host) ? host : "";
  }
  function urlHost(url) {
    const match = /^https?:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url.trim());
    return match ? normalizeHost(match[1]) : "";
  }
  function isIP(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  }
  var secondLevelSuffixes = /* @__PURE__ */ new Set([
    "com.cn",
    "net.cn",
    "org.cn",
    "gov.cn",
    "edu.cn",
    "ac.cn",
    "com.hk",
    "net.hk",
    "org.hk",
    "edu.hk",
    "gov.hk",
    "com.tw",
    "net.tw",
    "org.tw",
    "edu.tw",
    "gov.tw",
    "co.jp",
    "ne.jp",
    "or.jp",
    "ac.jp",
    "go.jp",
    "co.kr",
    "or.kr",
    "ne.kr",
    "ac.kr",
    "go.kr",
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "me.uk",
    "com.au",
    "net.au",
    "org.au",
    "edu.au",
    "gov.au",
    "com.sg",
    "edu.sg",
    "gov.sg",
    "com.my",
    "com.br",
    "com.mx",
    "com.tr",
    "com.ru",
    "co.in",
    "co.nz",
    "co.za",
    "github.io",
    "gitlab.io",
    "vercel.app",
    "netlify.app",
    "pages.dev",
    "workers.dev",
    "herokuapp.com",
    "appspot.com",
    "cloudfront.net",
    "azurewebsites.net",
    "blogspot.com",
    "fly.dev"
  ]);
  function registrableDomain(host) {
    const name = normalizeHost(host);
    if (!name || isIP(name)) return name;
    const labels = name.split(".");
    if (labels.length <= 2) return name;
    const lastTwo = labels.slice(-2).join(".");
    if (secondLevelSuffixes.has(lastTwo)) return labels.slice(-3).join(".");
    return lastTwo;
  }
  function isBrowserProcess(processPath, browser) {
    if (!processPath) return false;
    if (browser.bundleId === "com.apple.Safari" || browser.bundleId === "com.apple.SafariTechnologyPreview") {
      return processPath.includes("com.apple.WebKit.Networking") || processPath.startsWith(`${browser.path.replace(/\/$/, "")}/`);
    }
    const root = browser.path.replace(/\/$/, "");
    return root.length > 0 && processPath.startsWith(`${root}/`);
  }
  var maximumPageDomains = 8;
  function pageDomains(pageHost, browser, seen, now, windowMs = 3e4) {
    const byDomain = /* @__PURE__ */ new Map();
    const pageDomain = pageHost ? registrableDomain(pageHost) : "";
    if (pageDomain) byDomain.set(pageDomain, { domain: pageDomain, hosts: [pageHost], isPage: true, connections: 0, failed: 0, route: null, latest: 0 });
    for (const connection of seen) {
      if (now - connection.at > windowMs) continue;
      if (!browser || !isBrowserProcess(connection.process, browser)) continue;
      const host = normalizeHost(connection.host);
      if (!host) continue;
      const domain = registrableDomain(host);
      const entry = byDomain.get(domain) ?? { domain, hosts: [], isPage: false, connections: 0, failed: 0, route: null, latest: 0 };
      entry.connections += 1;
      if (connection.failed) entry.failed += 1;
      if (!entry.hosts.includes(host) && entry.hosts.length < 4) entry.hosts.push(host);
      if (connection.at >= entry.latest && connection.chains.length > 0) {
        entry.latest = connection.at;
        entry.route = connection.chains[connection.chains.length - 1];
      }
      byDomain.set(domain, entry);
    }
    const list2 = [...byDomain.values()].sort((a, b) => Number(b.isPage) - Number(a.isPage) || b.connections - a.connections || a.domain.localeCompare(b.domain));
    return list2.slice(0, maximumPageDomains).map(({ latest: _latest, ...domain }) => domain);
  }
  function pageRuleFor(rules, host) {
    const name = normalizeHost(host);
    for (const rule of rules) {
      if (rule.kind === "domain" && rule.value === name) return rule;
      if (rule.kind === "domain_suffix" && (name === rule.value || name.endsWith(`.${rule.value}`))) return rule;
    }
    return null;
  }
  function policyTitle(policy) {
    if (policy === "proxy") return "\u8D70\u4EE3\u7406";
    if (policy === "direct") return "\u76F4\u8FDE";
    if (policy === "reject") return "\u62D2\u7EDD";
    return `\u8D70\u300C${policy.slice("group:".length)}\u300D`;
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
    schedule: "schedule",
    /** `PageRule[]`：用户给网站加的规则，新的在前（SDK 2.10 这一期，T-8）。 */
    pageRules: "pageRules",
    /** `StoredSurge`：导入的 Surge 配置，规则另外切块（`surge:rules:<序号>`）。 */
    surge: "surge",
    /** `Record<tag, RuleSetRecord>`：导入配置里那些外部规则集拉没拉到，内容另外切块（`ruleset:<tag>:<序号>`）。 */
    ruleSets: "ruleSets",
    /**
     * `TunSwitch`：自己刚把偏好 `tun` 改成了什么（jarvis-mac `specs/20261028-130540-proxy-walkthrough-fixes` W-6）。
     * 宿主把每次偏好变更都通知给所有会话、包括写的那一个；后台会话看到 30 秒内、值相同的这一笔，就知道是自己人在换内核，不再换一次。
     */
    tunSwitch: "tunSwitch",
    /**
     * `DayStats`：今天的流量（分时桶、按进程 / 域名 / 策略的合计），后台会话每分钟写一次（jarvis-mac
     * `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）。窗口「活动」页读它。
     */
    statsToday: "stats.today",
    /** `RuleHits`：本次开启以来每个 `rule` 字段的连接数（窗口「规则」页的使用计数），与 `stats.today` 一起写。 */
    ruleHits: "ruleHits"
  };
  var tunSwitchEchoMs = 3e4;
  function isTunSwitchEcho(marker, on, now) {
    if (typeof marker !== "object" || marker === null) return false;
    const value = marker;
    return value.on === on && typeof value.at === "number" && now - value.at >= 0 && now - value.at < tunSwitchEchoMs;
  }
  function surgeRuleChunkKey(index) {
    return `surge:rules:${index}`;
  }
  function ruleSetChunkKey(tag, index) {
    return `ruleset:${tag}:${index}`;
  }
  function chunkItems(items, maxBytes = maximumChunkBytes) {
    const chunks = [];
    let current = [];
    let size = 2;
    for (const item of items) {
      const bytes = utf8Length(JSON.stringify(item)) + 1;
      if (current.length > 0 && size + bytes > maxBytes) {
        chunks.push(current);
        current = [];
        size = 2;
      }
      current.push(item);
      size += bytes;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }
  function splitHeadlessRules(rules, maxBytes = maximumChunkBytes - 1024) {
    const out = [];
    for (const rule of rules) {
      if (utf8Length(JSON.stringify(rule)) <= maxBytes) {
        out.push(rule);
        continue;
      }
      const scalars = {};
      const arrays = [];
      for (const [key, value] of Object.entries(rule)) {
        if (Array.isArray(value)) arrays.push([key, value]);
        else scalars[key] = value;
      }
      const destination = /* @__PURE__ */ new Set(["domain", "domain_suffix", "domain_keyword", "domain_regex", "ip_cidr"]);
      if (arrays.length > 1 && !arrays.every(([key]) => destination.has(key))) {
        out.push(rule);
        continue;
      }
      for (const [key, values] of arrays) {
        for (const part of chunkItems(values, maxBytes)) out.push({ ...scalars, [key]: part });
      }
    }
    return out;
  }
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

  // extensions/proxy/src/surge.ts
  function splitSections(text) {
    const sections = /* @__PURE__ */ new Map();
    let current = "";
    sections.set(current, []);
    for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith("#") || line.startsWith(";") || line.startsWith("//")) continue;
      const header = /^\[([^\]]+)\]$/.exec(line);
      if (header) {
        current = header[1].trim();
        if (!sections.has(current)) sections.set(current, []);
        continue;
      }
      sections.get(current).push(line);
    }
    return sections;
  }
  function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let quoted = false;
    let current = "";
    for (const char of text) {
      if (char === '"') quoted = !quoted;
      if (!quoted && char === "(") depth += 1;
      if (!quoted && char === ")") depth = Math.max(0, depth - 1);
      if (!quoted && depth === 0 && char === ",") {
        parts.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    parts.push(current.trim());
    return parts.map((part) => part.replace(/^"(.*)"$/, "$1"));
  }
  function stripTrailingComment(line) {
    const index = line.search(/\s\/\/\s/);
    return (index >= 0 ? line.slice(0, index) : line).trim();
  }
  function list(value) {
    if (!value) return [];
    return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  }
  function parseGeneral(lines) {
    const values = /* @__PURE__ */ new Map();
    for (const line of lines) {
      const index = line.indexOf("=");
      if (index <= 0) continue;
      values.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
    }
    const flag2 = (key) => {
      const value = values.get(key)?.toLowerCase();
      if (value === void 0) return null;
      return value === "true" || value === "1" || value === "yes";
    };
    const servers = list(values.get("dns-server")).filter((server) => server === "system" || isIPAddress(server));
    return {
      tunExcludedRoutes: list(values.get("tun-excluded-routes")).map(toCIDR).filter((value) => value !== null),
      bypassTun: list(values.get("bypass-tun")).map(toCIDR).filter((value) => value !== null),
      alwaysRealIP: list(values.get("always-real-ip")),
      dnsServers: servers,
      skipProxy: list(values.get("skip-proxy")),
      excludeSimpleHostnames: flag2("exclude-simple-hostnames") ?? false,
      ipv6: flag2("ipv6")
    };
  }
  function isIPAddress(value) {
    if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(value)) return value.split(".").every((part) => Number(part) <= 255);
    return /^[0-9a-f:]+$/i.test(value) && value.includes(":") && value.split("::").length <= 2;
  }
  function toCIDR(value) {
    const [address, prefix] = value.split("/");
    if (!isIPAddress(address)) return null;
    const v6 = address.includes(":");
    if (prefix === void 0) return `${address}/${v6 ? 128 : 32}`;
    if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (v6 ? 128 : 32)) return null;
    return `${address}/${Number(prefix)}`;
  }
  var rejectPolicies = /* @__PURE__ */ new Set(["REJECT", "REJECT-TINYGIF", "REJECT-DROP", "REJECT-NO-DROP", "REJECT-200"]);
  function policyOf(name) {
    const upper = name.trim().toUpperCase();
    if (upper === "DIRECT") return { kind: "direct" };
    if (rejectPolicies.has(upper)) return { kind: "reject", drop: upper === "REJECT-DROP" };
    return { kind: "group", name: name.trim() };
  }
  function samePolicy(a, b) {
    if (a.kind !== b.kind) return false;
    if (a.kind === "group" && b.kind === "group") return a.name === b.name;
    if (a.kind === "reject" && b.kind === "reject") return a.drop === b.drop;
    return true;
  }
  var destinationFields = /* @__PURE__ */ new Set(["domain", "domain_suffix", "domain_keyword", "domain_regex", "ip_cidr"]);
  function wildcardRegex(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return `^${escaped}$`;
  }
  function portMatch(value, single, range) {
    const span = /^(\d{1,5})-(\d{1,5})$/.exec(value);
    if (span) return { [range]: [`${Number(span[1])}:${Number(span[2])}`] };
    if (/^\d{1,5}$/.test(value) && Number(value) <= 65535) return { [single]: [Number(value)] };
    return null;
  }
  function convertCondition(type, value) {
    switch (type) {
      case "DOMAIN":
        return { match: { domain: [value.toLowerCase()] }, ip: false };
      case "DOMAIN-SUFFIX":
        return { match: { domain_suffix: [value.toLowerCase().replace(/^\./, "")] }, ip: false };
      case "DOMAIN-KEYWORD":
        return { match: { domain_keyword: [value.toLowerCase()] }, ip: false };
      case "DOMAIN-WILDCARD":
        return { match: { domain_regex: [wildcardRegex(value.toLowerCase())] }, ip: false };
      case "IP-CIDR":
      case "IP-CIDR6": {
        const cidr = toCIDR(value);
        return cidr ? { match: { ip_cidr: [cidr] }, ip: true } : { unsupported: "\u7F51\u6BB5\u5199\u9519\u4E86" };
      }
      case "GEOIP":
        return /^[a-z]{2}$/i.test(value) ? { match: { rule_set: [`geoip-${value.toLowerCase()}`] }, ip: true } : { unsupported: "\u56FD\u5BB6\u7801\u5199\u9519\u4E86" };
      case "PROCESS-NAME":
        return { match: { process_name: [value.includes("/") ? value.split("/").pop() ?? value : value] }, ip: false };
      case "DEST-PORT": {
        const match = portMatch(value, "port", "port_range");
        return match ? { match, ip: false } : { unsupported: "\u7AEF\u53E3\u5199\u9519\u4E86" };
      }
      case "SRC-PORT": {
        const match = portMatch(value, "source_port", "source_port_range");
        return match ? { match, ip: false } : { unsupported: "\u7AEF\u53E3\u5199\u9519\u4E86" };
      }
      case "SRC-IP": {
        const cidr = toCIDR(value);
        return cidr ? { match: { source_ip_cidr: [cidr] }, ip: false } : { unsupported: "\u5730\u5740\u5199\u9519\u4E86" };
      }
      case "PROTOCOL": {
        const upper = value.toUpperCase();
        if (upper === "TCP" || upper === "UDP") return { match: { network: [upper.toLowerCase()] }, ip: false };
        const sniffed = { HTTP: "http", HTTPS: "tls", QUIC: "quic", STUN: "stun" };
        return sniffed[upper] ? { match: { protocol: [sniffed[upper]] }, ip: false } : { unsupported: `sing-box \u8BA4\u4E0D\u51FA\u534F\u8BAE ${value}` };
      }
      default:
        return { unsupported: unsupportedReason(type) };
    }
  }
  function unsupportedReason(type) {
    switch (type) {
      case "USER-AGENT":
      case "URL-REGEX":
        return "\u8981\u89E3\u5F00 HTTPS \u6B63\u6587\uFF08MITM\uFF09\u624D\u770B\u5F97\u5230\uFF0Csing-box \u4E0D\u505A";
      case "IP-ASN":
        return "sing-box 1.14 \u4E0D\u6309 ASN \u5206\u6D41";
      case "SUBNET":
      case "CELLULAR-RADIO":
      case "CELLULAR-CARRIER":
      case "DEVICE-NAME":
      case "HOSTNAME-TYPE":
        return "Surge \u4E13\u6709\u7684\u73AF\u5883\u6761\u4EF6";
      case "SCRIPT":
        return "\u811A\u672C\u89C4\u5219\u4E0D\u5BFC\u5165";
      case "IN-PORT":
        return "\u300C\u4EE3\u7406\u300D\u53EA\u6709\u4E00\u4E2A\u672C\u673A\u7AEF\u53E3";
      default:
        return "\u8BA4\u4E0D\u51FA\u7684\u89C4\u5219\u7C7B\u578B";
    }
  }
  function convertLogical(type, body) {
    const inner = body.trim().replace(/^\((.*)\)$/s, "$1");
    const parts = splitTopLevel(inner).filter((part) => part.length > 0);
    if (parts.length === 0) return { unsupported: "\u903B\u8F91\u89C4\u5219\u662F\u7A7A\u7684" };
    const rules = [];
    let ip = false;
    for (const part of parts) {
      const sub = part.replace(/^\((.*)\)$/s, "$1");
      const fields = splitTopLevel(sub);
      const subType = (fields[0] ?? "").toUpperCase();
      const converted = subType === "AND" || subType === "OR" || subType === "NOT" ? convertLogical(subType, fields.slice(1).join(",")) : convertCondition(subType, fields[1] ?? "");
      if ("unsupported" in converted) return { unsupported: `\u5B50\u89C4\u5219 ${subType}\uFF1A${converted.unsupported}` };
      ip || (ip = converted.ip);
      rules.push(converted.match);
    }
    if (type === "NOT") {
      if (rules.length !== 1) return { unsupported: "NOT \u53EA\u80FD\u5E26\u4E00\u6761\u5B50\u89C4\u5219" };
      return { match: { ...rules[0], invert: true }, ip };
    }
    return { match: { type: "logical", mode: type === "AND" ? "and" : "or", rules }, ip };
  }
  function mergeable(a, b) {
    if (a.type === "logical" || b.type === "logical" || a.invert || b.invert) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.every((key) => destinationFields.has(key)) && keysB.every((key) => destinationFields.has(key))) return true;
    return keysA.length === 1 && keysB.length === 1 && keysA[0] === keysB[0] && Array.isArray(a[keysA[0]]);
  }
  function merge(a, b) {
    const out = { ...a };
    for (const [key, value] of Object.entries(b)) out[key] = [...out[key] ?? [], ...value];
    return out;
  }
  function noteUnsupported(report, kind, reason, sample) {
    const entry = report.get(kind) ?? { kind, count: 0, samples: [], reason };
    entry.count += 1;
    if (sample !== null && entry.samples.length < 5) entry.samples.push(sample.slice(0, 160));
    report.set(kind, entry);
  }
  function parseRules(lines, unsupported) {
    const rules = [];
    const ruleSets = [];
    const geoip = /* @__PURE__ */ new Set();
    const converted = {};
    let final = null;
    let count = 0;
    const bump = (type) => {
      converted[type] = (converted[type] ?? 0) + 1;
    };
    for (const raw of lines) {
      const line = stripTrailingComment(raw);
      if (line.length === 0) continue;
      count += 1;
      const fields = splitTopLevel(line);
      const type = (fields[0] ?? "").toUpperCase();
      if (type === "FINAL" || type === "MATCH") {
        if (fields[1]) {
          final = policyOf(fields[1]);
          bump("FINAL");
        }
        continue;
      }
      if (type === "AND" || type === "OR" || type === "NOT") {
        const policy2 = fields[2] ? policyOf(fields[2]) : null;
        const result2 = policy2 ? convertLogical(type, fields[1] ?? "") : { unsupported: "\u6CA1\u5199\u7B56\u7565" };
        if ("unsupported" in result2) noteUnsupported(unsupported, type, result2.unsupported, line);
        else {
          rules.push({ kind: "match", match: result2.match, policy: policy2, resolve: result2.ip && !fields.slice(3).some((option) => option.toLowerCase() === "no-resolve") });
          bump(type);
        }
        continue;
      }
      const value = fields[1] ?? "";
      const policyName2 = fields[2];
      const options = fields.slice(3).map((option) => option.toLowerCase());
      if (!policyName2) {
        noteUnsupported(unsupported, type || "\uFF08\u7A7A\uFF09", "\u6CA1\u5199\u7B56\u7565", line);
        continue;
      }
      const policy = policyOf(policyName2);
      if (type === "RULE-SET" || type === "DOMAIN-SET") {
        if (type === "RULE-SET" && value.toUpperCase() === "LAN") {
          rules.push({ kind: "match", match: { ip_is_private: true }, policy, resolve: false });
          bump(type);
          continue;
        }
        if (!/^https:\/\/\S+$/i.test(value)) {
          noteUnsupported(unsupported, `${type},${value.toUpperCase() === "SYSTEM" ? "SYSTEM" : "\u975E https \u5730\u5740"}`, value.toUpperCase() === "SYSTEM" ? "Surge \u5185\u7F6E\u7684\u7CFB\u7EDF\u670D\u52A1\u540D\u5355\uFF0C\u6CA1\u6709\u516C\u5F00\u7684\u5185\u5BB9" : "\u53EA\u62C9 https \u5730\u5740", line);
          continue;
        }
        const tag = `surge-${digest(value)}`;
        if (!ruleSets.some((ref) => ref.tag === tag)) {
          ruleSets.push({ tag, url: value, host: hostOf(value), format: type === "RULE-SET" ? "rule-set" : "domain-set" });
        }
        rules.push({ kind: "ruleSet", tag, policy, noResolve: options.includes("no-resolve") || type === "DOMAIN-SET" });
        bump(type);
        continue;
      }
      const result = convertCondition(type, value);
      if ("unsupported" in result) {
        noteUnsupported(unsupported, type, result.unsupported, line);
        continue;
      }
      if (type === "GEOIP") geoip.add(value.toLowerCase());
      const resolve = result.ip && !options.includes("no-resolve");
      const previous = rules[rules.length - 1];
      if (previous && previous.kind === "match" && samePolicy(previous.policy, policy) && previous.resolve === resolve && mergeable(previous.match, result.match)) {
        previous.match = merge(previous.match, result.match);
      } else {
        rules.push({ kind: "match", match: result.match, policy, resolve });
      }
      bump(type);
    }
    return { rules, final, ruleSets, geoip: [...geoip], converted, count };
  }
  function hostOf(url) {
    const match = /^https?:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url.trim());
    return match ? match[1].toLowerCase() : "";
  }
  function parseGroups(lines) {
    const groups = [];
    for (const line of lines) {
      const index = line.indexOf("=");
      if (index <= 0) continue;
      const name = line.slice(0, index).trim();
      const fields = splitTopLevel(line.slice(index + 1));
      const type = (fields[0] ?? "select").toLowerCase();
      const raw = fields.slice(1);
      const members = [];
      let external = false;
      for (const field of raw) {
        const option = /^([a-z0-9-]+)\s*=\s*(.*)$/i.exec(field);
        if (option) {
          const key = option[1].toLowerCase();
          if (key === "policy-path" || key === "include-all-proxies" || key === "include-other-group" || key === "policy-regex-filter") external = true;
          continue;
        }
        if (field.length > 0) members.push(field);
      }
      groups.push({ name, type, members: members.map((member) => ({ kind: "group", name: member })).concat(external ? [{ kind: "nodes" }] : []) });
    }
    return groups;
  }
  function resolveGroups(defined, referenced) {
    const names = new Set(defined.map((group) => group.name));
    const out = [];
    for (const group of defined) {
      const members = [];
      const push = (member) => {
        if (!members.some((existing) => JSON.stringify(existing) === JSON.stringify(member))) members.push(member);
      };
      for (const member of group.members) {
        if (member.kind !== "group") {
          push(member);
          continue;
        }
        const policy = policyOf(member.name);
        if (policy.kind === "direct") push({ kind: "direct" });
        else if (policy.kind === "reject") continue;
        else if (names.has(member.name) && member.name !== group.name) push({ kind: "group", name: member.name });
        else push({ kind: "nodes" });
      }
      const automatic = group.type !== "select";
      if (!members.some((member) => member.kind === "nodes" || member.kind === "auto")) push({ kind: "nodes" });
      if (!members.some((member) => member.kind === "auto")) {
        if (automatic) members.unshift({ kind: "auto" });
        else push({ kind: "auto" });
      } else if (automatic) {
        const index = members.findIndex((member) => member.kind === "auto");
        members.unshift(...members.splice(index, 1));
      }
      out.push({ name: group.name, type: group.type, members });
    }
    for (const name of referenced) {
      if (names.has(name) || out.some((group) => group.name === name)) continue;
      out.push({ name, type: "select", members: [{ kind: "nodes" }, { kind: "auto" }, { kind: "direct" }] });
    }
    return breakCycles(out);
  }
  function breakCycles(groups) {
    const byName = new Map(groups.map((group) => [group.name, group]));
    const state = /* @__PURE__ */ new Map();
    const visit = (group) => {
      state.set(group.name, "visiting");
      group.members = group.members.filter((member) => {
        if (member.kind !== "group") return true;
        const target = byName.get(member.name);
        if (!target) return false;
        if (state.get(target.name) === "visiting") return false;
        if (!state.has(target.name)) visit(target);
        return true;
      });
      if (group.members.length === 0) group.members.push({ kind: "nodes" });
      state.set(group.name, "done");
    };
    for (const group of groups) if (!state.has(group.name)) visit(group);
    return groups;
  }
  function parseHosts(lines, unsupported) {
    const entries = [];
    for (const line of lines) {
      const index = line.indexOf("=");
      if (index <= 0) continue;
      const domain = line.slice(0, index).trim().toLowerCase();
      const value = line.slice(index + 1).trim();
      if (domain.includes("*")) {
        noteUnsupported(unsupported, "[Host] \u901A\u914D", "sing-box \u7684 hosts \u53EA\u8BA4\u5B8C\u6574\u57DF\u540D", line);
        continue;
      }
      const server = /^server:(.+)$/i.exec(value);
      if (server) {
        const target = server[1].trim();
        if (isIPAddress(target)) entries.push({ kind: "server", domain, server: target });
        else noteUnsupported(unsupported, "[Host] server:", target === "system" || target === "syslib" ? "\u4EA4\u7ED9\u7CFB\u7EDF\u89E3\u6790\u5C31\u662F\u9ED8\u8BA4\u884C\u4E3A" : "\u53EA\u8BA4 IP \u5199\u7684 DNS", line);
        continue;
      }
      const addresses = list(value);
      if (addresses.length > 0 && addresses.every(isIPAddress)) entries.push({ kind: "address", domain, addresses });
      else noteUnsupported(unsupported, "[Host] \u522B\u540D", "\u57DF\u540D\u6307\u5411\u53E6\u4E00\u4E2A\u57DF\u540D\uFF08CNAME \u5F0F\uFF09\u8F6C\u4E0D\u4E86", line);
    }
    return entries;
  }
  var countOnlySections = {
    Proxy: "\u8282\u70B9\u6765\u81EA\u8BA2\u9605\uFF1A\u672C\u671F\u4E0D\u4ECE Surge \u914D\u7F6E\u5BFC\u5165\u8282\u70B9",
    MITM: "sing-box \u4E0D\u505A HTTPS \u89E3\u5BC6",
    Script: "sing-box \u4E0D\u8DD1\u811A\u672C",
    "URL Rewrite": "\u8981\u89E3\u5F00 HTTPS \u6B63\u6587\u624D\u80FD\u6539\u5199",
    "Header Rewrite": "\u8981\u89E3\u5F00 HTTPS \u6B63\u6587\u624D\u80FD\u6539\u5199",
    "Body Rewrite": "\u8981\u89E3\u5F00 HTTPS \u6B63\u6587\u624D\u80FD\u6539\u5199",
    "Map Local": "\u8981\u89E3\u5F00 HTTPS \u6B63\u6587\u624D\u80FD\u66FF\u6362",
    "SSID Setting": "Surge \u4E13\u6709\u7684\u73AF\u5883\u6761\u4EF6",
    WireGuard: "\u8282\u70B9\u6765\u81EA\u8BA2\u9605",
    Panel: "Surge \u7684\u9762\u677F"
  };
  var handledSections = /* @__PURE__ */ new Set(["General", "Rule", "Proxy Group", "Host", "Replica"]);
  function convertSurgeProfile(text, sourceName, now) {
    const sections = splitSections(text);
    const unsupported = /* @__PURE__ */ new Map();
    const general = parseGeneral(sections.get("General") ?? []);
    const parsed = parseRules(sections.get("Rule") ?? [], unsupported);
    const referenced = [];
    const note = (policy) => {
      if (policy?.kind === "group" && !referenced.includes(policy.name)) referenced.push(policy.name);
    };
    for (const rule of parsed.rules) note(rule.policy);
    note(parsed.final);
    const groups = resolveGroups(parseGroups(sections.get("Proxy Group") ?? []), referenced);
    const hosts = parseHosts(sections.get("Host") ?? [], unsupported);
    for (const [name, reason] of Object.entries(countOnlySections)) {
      const lines = sections.get(name)?.length ?? 0;
      if (lines > 0) unsupported.set(`[${name}]`, { kind: `[${name}]`, count: lines, samples: [], reason });
    }
    for (const [name, lines] of sections) {
      if (name === "" || handledSections.has(name) || countOnlySections[name] !== void 0 || lines.length === 0) continue;
      unsupported.set(`[${name}]`, { kind: `[${name}]`, count: lines.length, samples: [], reason: "\u8BA4\u4E0D\u51FA\u7684\u6BB5" });
    }
    if (parsed.count === 0 && groups.length === 0) throw new Error("\u8FD9\u4EFD\u6587\u4EF6\u91CC\u6CA1\u6709 [Rule] \u89C4\u5219\uFF1A\u6311\u7684\u662F Surge \u7684\u914D\u7F6E\uFF08.conf\uFF09\u5417");
    return {
      version: 1,
      sourceName,
      importedAt: now,
      general,
      groups,
      rules: parsed.rules,
      final: parsed.final,
      hosts,
      ruleSets: parsed.ruleSets,
      geoip: parsed.geoip,
      report: {
        ruleLines: parsed.count,
        converted: parsed.converted,
        unsupported: [...unsupported.values()].sort((a, b) => b.count - a.count),
        sections: [...sections].filter(([name, lines]) => name !== "" && lines.length > 0).map(([name, lines]) => ({ name, lines: lines.length })),
        compiledRules: parsed.rules.length
      }
    };
  }
  function convertedCount(report) {
    return Object.values(report.converted).reduce((sum, count) => sum + count, 0);
  }
  function convertSurgeList(text, format) {
    const destination = {};
    const others = /* @__PURE__ */ new Map();
    let hasIP = false;
    let total = 0;
    let skipped = 0;
    for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
      const line = stripTrailingComment(raw.trim());
      if (line.length === 0 || line.startsWith("#") || line.startsWith(";") || line.startsWith("//")) continue;
      total += 1;
      if (format === "domain-set") {
        const domain = line.toLowerCase();
        if (!/^\.?[a-z0-9*-]+(\.[a-z0-9-]+)*$/.test(domain)) {
          skipped += 1;
          continue;
        }
        const key = domain.startsWith(".") ? "domain_suffix" : "domain";
        destination[key] = [...destination[key] ?? [], domain.replace(/^\./, "")];
        continue;
      }
      const fields = splitTopLevel(line);
      const result = convertCondition((fields[0] ?? "").toUpperCase(), fields[1] ?? "");
      if ("unsupported" in result || result.match.rule_set) {
        skipped += 1;
        continue;
      }
      hasIP || (hasIP = result.ip && !fields.slice(2).some((option) => option.toLowerCase() === "no-resolve"));
      const keys = Object.keys(result.match);
      if (keys.every((key) => destinationFields.has(key))) {
        for (const key of keys) destination[key] = [...destination[key] ?? [], ...result.match[key]];
      } else {
        const signature = keys.sort().join("+");
        others.set(signature, merge(others.get(signature) ?? {}, result.match));
      }
    }
    const rules = [];
    if (Object.keys(destination).length > 0) rules.push(destination);
    rules.push(...others.values());
    return { rules, hasIP, total, skipped };
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
  var fakeIPRanges = { inet4: "198.18.0.0/15", inet6: "fc00::/18" };
  var defaultDirectDNS = "223.5.5.5";
  var proxyDNSServer = "1.1.1.1";
  var defaultRealIPDomains = [
    "*.lan",
    "*.local",
    "*.localdomain",
    "*.home.arpa",
    "time.*.com",
    "ntp.*.com",
    "*.ntp.org.cn",
    "*.pool.ntp.org",
    "time.apple.com",
    "*.push.apple.com",
    "*.msftconnecttest.com",
    "*.msftncsi.com",
    "stun.*.*",
    "stun.*.*.*",
    "+.stun.*.*",
    "localhost.ptlogin2.qq.com"
  ];
  var defaultExcludeRoutes = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"];
  function groupTags(surge, nodes) {
    const tags = /* @__PURE__ */ new Map();
    if (!surge) return tags;
    const used = /* @__PURE__ */ new Set([...reservedTags, ...nodes.map((node) => node.name)]);
    for (const group of surge.groups) {
      let tag = group.name;
      if (used.has(tag)) tag = `${group.name} \xB7 Surge`;
      for (let index = 2; used.has(tag); index += 1) tag = `${group.name} \xB7 Surge ${index}`;
      used.add(tag);
      tags.set(group.name, tag);
    }
    return tags;
  }
  function memberTag(member, tags) {
    switch (member.kind) {
      case "direct":
        return DIRECT_TAG;
      case "auto":
        return URLTEST_TAG;
      case "group":
        return tags.get(member.name) ?? SELECTOR_TAG;
      default:
        return SELECTOR_TAG;
    }
  }
  function tunnelExcludeRoutes(surge) {
    const routes = [...defaultExcludeRoutes, ...surge?.general.tunExcludedRoutes ?? [], ...surge?.general.bypassTun ?? []].map((route) => toCIDR(route)).filter((route) => route !== null);
    return [...new Set(routes)].slice(0, 256);
  }
  function systemProxyBypass(surge) {
    const entries = (surge?.general.skipProxy ?? []).filter((entry) => entry !== "*" && /^\S{1,253}$/.test(entry));
    return [...new Set(entries)].slice(0, 64);
  }
  function routePlan(options) {
    const tunnel = options.kernel === "tunnel";
    const surge = options.surge ?? null;
    const tags = groupTags(surge, dedupeNodeNames(options.nodes));
    const rules = [{ action: "sniff" }];
    const origins = [{ kind: "plumbing" }];
    const push = (origin, ...added) => {
      for (const rule of added) {
        rules.push(rule);
        origins.push(origin);
      }
    };
    if (tunnel) push({ kind: "plumbing" }, { protocol: "dns", action: "hijack-dns" });
    push({ kind: "lan" }, { ip_is_private: true, domain_suffix: ["localhost", "local"], action: "route", outbound: DIRECT_TAG });
    push({ kind: "mode", mode: "direct" }, { clash_mode: clashModeNames.direct, action: "route", outbound: DIRECT_TAG });
    push({ kind: "mode", mode: "global" }, { clash_mode: clashModeNames.global, action: "route", outbound: SELECTOR_TAG });
    push({ kind: "page" }, ...compilePageRules(options.pageRules ?? [], tags));
    const remoteSets = [];
    const inlineSets = [];
    let final = SELECTOR_TAG;
    let finalFromSurge = false;
    if (surge) {
      const compiled = compileSurgeRules(surge.rules, tags, options.ruleSets ?? {});
      compiled.rules.forEach((rule, index) => push(compiled.origins[index] ?? { kind: "plumbing" }, rule));
      for (const tag of compiled.usedRuleSets) inlineSets.push({ type: "inline", tag, rules: options.ruleSets?.[tag]?.rules ?? [] });
      for (const code of surge.geoip) remoteSets.push({ tag: `geoip-${code}`, url: geoipRuleSetURL(code) });
      if (surge.final) {
        finalFromSurge = true;
        if (surge.final.kind === "reject") push({ kind: "surgeFinal" }, ruleFor({}, surge.final, tags));
        else final = outboundOf(surge.final, tags);
      }
    } else if (options.chinaRules) {
      push(
        { kind: "china" },
        { rule_set: "geosite-cn", action: "route", outbound: DIRECT_TAG },
        { rule_set: "geoip-cn", action: "route", outbound: DIRECT_TAG }
      );
      remoteSets.push(...chinaRuleSets);
    }
    return { rules, origins, final, finalFromSurge, remoteSets, inlineSets };
  }
  function buildConfig(options) {
    validate(options);
    const tunnel = options.kernel === "tunnel";
    const fakeIP = tunnel && (options.dnsMode ?? "fakeip") === "fakeip";
    const surge = options.surge ?? null;
    const nodes = dedupeNodeNames(options.nodes);
    const names = nodes.map((node) => node.name);
    const members = [URLTEST_TAG, ...names];
    const selected = options.selected !== void 0 && members.includes(options.selected) ? options.selected : URLTEST_TAG;
    const tags = groupTags(surge, nodes);
    const directDNS = tunnel ? "dns-direct" : LOCAL_DNS_TAG;
    const plan = routePlan(options);
    const { rules, remoteSets, inlineSets, final } = plan;
    const route = {
      rules,
      final,
      default_domain_resolver: directDNS,
      // 按进程分流（导入的 PROCESS-NAME）与「当前页面」认浏览器的连接都要它；系统代理模式下对本机连进来的连接同样查得到（实测）。
      find_process: true
    };
    if (tunnel) route.auto_detect_interface = true;
    const groupOutbounds = (surge?.groups ?? []).map((group) => {
      const tag = tags.get(group.name) ?? group.name;
      const outbounds = [...new Set(group.members.map((member) => memberTag(member, tags)))].filter((member) => member !== tag);
      const chosen = options.groupSelection?.[group.name];
      return {
        type: "selector",
        tag,
        outbounds,
        default: chosen !== void 0 && outbounds.includes(chosen) ? chosen : outbounds[0],
        interrupt_exist_connections: true
      };
    });
    const config = {
      log: { level: "info", timestamp: true },
      dns: buildDNS({ tunnel, fakeIP, surge, chinaRules: !surge && options.chinaRules }),
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
        ...groupOutbounds,
        ...nodes.map((node) => ({ type: node.outbound.type, tag: node.name, ...cloneOutbound(node.outbound) })),
        { type: "direct", tag: DIRECT_TAG }
      ],
      route,
      experimental: {
        // 相对路径：sing-box 以 `-D <工作目录>` 启动，`cache.db` 落在宿主给的那个目录里（TUN 下是网络助手的 root 目录，宿主的守卫不许写 path）。
        // 它记住「节点选择」选中的节点、当前出站模式与下载过的规则集——下次启动时这三样**以它为准**，
        // `selector.default` 与 `default_mode` 只在第一次（或缓存里的值不再是组员 / 模式）时生效。TUN 下还记着假 IP 的映射：
        // 重载、重启之后应用手里缓存着的 198.18.x.x 仍然认得回域名。
        cache_file: fakeIP ? { enabled: true, store_fakeip: true } : { enabled: true },
        clash_api: {
          external_controller: `127.0.0.1:${options.controlPort}`,
          secret: options.controlSecret,
          default_mode: clashModeNames[options.mode]
        }
      }
    };
    if (remoteSets.length > 0 || inlineSets.length > 0) {
      route.rule_set = [
        ...remoteSets.map((set) => ({ type: "remote", tag: set.tag, format: "binary", url: set.url })),
        ...inlineSets
      ];
    }
    if (remoteSets.length > 0) {
      config.http_clients = [{ tag: RULE_SET_HTTP_CLIENT_TAG }];
      route.default_http_client = RULE_SET_HTTP_CLIENT_TAG;
    }
    return config;
  }
  function geoipRuleSetURL(code) {
    return `https://testingcf.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-${code}.srs`;
  }
  function outboundOf(policy, tags) {
    return policy.kind === "direct" ? DIRECT_TAG : tags.get(policy.name) ?? SELECTOR_TAG;
  }
  function ruleFor(match, policy, tags) {
    if (policy.kind === "reject") return policy.drop ? { ...match, action: "reject", method: "drop" } : { ...match, action: "reject" };
    return { ...match, action: "route", outbound: outboundOf(policy, tags) };
  }
  function pagePolicy(policy) {
    if (policy === "direct") return { kind: "direct" };
    if (policy === "reject") return { kind: "reject", drop: false };
    if (policy === "proxy") return { kind: "group", name: SELECTOR_TAG };
    return { kind: "group", name: policy.slice("group:".length) };
  }
  function compilePageRules(rules, tags) {
    const out = [];
    for (const rule of rules) {
      const last = out[out.length - 1];
      const entry = last && last.policy === rule.policy ? last : { policy: rule.policy, match: { domain: [], domain_suffix: [] } };
      if (entry !== last) out.push(entry);
      entry.match[rule.kind].push(rule.value);
    }
    const groupTagsWithSelector = new Map(tags);
    groupTagsWithSelector.set(SELECTOR_TAG, SELECTOR_TAG);
    return out.map((entry) => {
      const match = {};
      if (entry.match.domain.length > 0) match.domain = entry.match.domain;
      if (entry.match.domain_suffix.length > 0) match.domain_suffix = entry.match.domain_suffix;
      return ruleFor(match, pagePolicy(entry.policy), groupTagsWithSelector);
    });
  }
  function compileSurgeRules(rules, tags, ruleSets) {
    const out = [];
    const origins = [];
    const used = [];
    let resolved = false;
    for (const [position, rule] of rules.entries()) {
      let match;
      let resolve;
      if (rule.kind === "ruleSet") {
        const content = ruleSets[rule.tag];
        if (!content || content.rules.length === 0) continue;
        match = { rule_set: [rule.tag] };
        resolve = content.hasIP && !rule.noResolve;
        if (!used.includes(rule.tag)) used.push(rule.tag);
      } else {
        match = rule.match;
        resolve = rule.resolve;
      }
      if (resolve && !resolved) {
        out.push({ action: "resolve" });
        origins.push({ kind: "plumbing" });
        resolved = true;
      }
      out.push(ruleFor(match, rule.policy, tags));
      origins.push({ kind: "surge", index: position + 1 });
    }
    return { rules: out, usedRuleSets: used, origins, count: rules.length };
  }
  function realIPMatch(patterns) {
    const domain = [];
    const suffix = [];
    const regex = [];
    for (const raw of patterns) {
      const pattern = raw.trim().toLowerCase();
      if (!pattern || pattern === "*") continue;
      const plain = /^(?:\*|\+)\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(pattern);
      if (plain) suffix.push(plain[1]);
      else if (/[*?+]/.test(pattern)) regex.push(`^${pattern.replace(/^\+\./, "*.").replace(/[.^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+").replace(/\?/g, ".")}$`);
      else domain.push(pattern);
    }
    const match = {};
    if (domain.length > 0) match.domain = [...new Set(domain)];
    if (suffix.length > 0) match.domain_suffix = [...new Set(suffix)];
    if (regex.length > 0) match.domain_regex = [...new Set(regex)];
    return Object.keys(match).length > 0 ? match : null;
  }
  function buildDNS(input) {
    const servers = [];
    const rules = [];
    const surge = input.surge;
    const hostAddresses = (surge?.hosts ?? []).filter((entry) => entry.kind === "address");
    const hostServers = (surge?.hosts ?? []).filter((entry) => entry.kind === "server");
    if (!input.tunnel) {
      servers.push({ type: "local", tag: LOCAL_DNS_TAG });
    } else {
      const upstream = surge?.general.dnsServers.find((server) => server !== "system") ?? defaultDirectDNS;
      servers.push({ type: "udp", tag: "dns-direct", server: upstream });
      servers.push({ type: "https", tag: "dns-proxy", server: proxyDNSServer, detour: SELECTOR_TAG });
      if (input.fakeIP) servers.push({ type: "fakeip", tag: "dns-fakeip", inet4_range: fakeIPRanges.inet4, inet6_range: fakeIPRanges.inet6 });
    }
    if (hostAddresses.length > 0) {
      const predefined = {};
      for (const entry of hostAddresses) predefined[entry.domain] = entry.addresses;
      servers.push({ type: "hosts", tag: "dns-hosts", predefined });
      rules.push({ domain: hostAddresses.map((entry) => entry.domain), action: "route", server: "dns-hosts" });
    }
    const perServer = /* @__PURE__ */ new Map();
    for (const entry of hostServers) perServer.set(entry.server, [...perServer.get(entry.server) ?? [], entry.domain]);
    let index = 0;
    for (const [server, domains] of perServer) {
      index += 1;
      servers.push({ type: "udp", tag: `dns-host-${index}`, server });
      rules.push({ domain: domains, action: "route", server: `dns-host-${index}` });
    }
    const dns = { servers };
    if (input.tunnel) {
      const realIP = realIPMatch([...defaultRealIPDomains, ...surge?.general.alwaysRealIP ?? []]);
      if (realIP) rules.push({ ...realIP, action: "route", server: "dns-direct" });
      rules.push({ clash_mode: clashModeNames.direct, action: "route", server: "dns-direct" });
      if (input.chinaRules) rules.push({ rule_set: "geosite-cn", action: "route", server: "dns-direct" });
      if (input.fakeIP) rules.push({ query_type: ["A", "AAAA"], action: "route", server: "dns-fakeip" });
      dns.final = "dns-proxy";
      if (surge?.general.ipv6 === false) dns.strategy = "ipv4_only";
    }
    if (rules.length > 0) dns.rules = rules;
    return dns;
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

  // extensions/proxy/src/traffic.ts
  function parseLogLine(line) {
    const plain = line.replace(/\u001b\[[0-9;]*m/g, "");
    const match = /\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b(?:\[\d+\])?\s*\[(\d+)\s[^\]]*\]\s+(.*)$/.exec(plain);
    if (!match) return null;
    return { level: match[1], id: match[2], text: match[3] };
  }
  function splitHostPort(value) {
    const bracket = /^\[([^\]]+)\]:(\d+)$/.exec(value);
    if (bracket) return { host: bracket[1].toLowerCase(), port: Number(bracket[2]) };
    const plain = /^(.*):(\d+)$/.exec(value);
    if (plain && !plain[1].includes(":")) return { host: plain[1].toLowerCase(), port: Number(plain[2]) };
    return { host: value.toLowerCase(), port: 0 };
  }
  var defaultMeterOptions = {
    windowMs: 1e4,
    rejectAfterMs: 3e3,
    successAfterMs: 1e4,
    keepMs: 6e4,
    maximumAttempts: 2e3
  };
  var TrafficMeter = class {
    constructor(options = {}) {
      /** 连接 id → 尝试，按开始的先后。 */
      this.attempts = /* @__PURE__ */ new Map();
      this.previousTotals = null;
      this.previousConnections = /* @__PURE__ */ new Map();
      this.lastRate = { upload: 0, download: 0 };
      this.options = { ...defaultMeterOptions, ...options };
    }
    /** 清空（内核停了、换了一个）。 */
    reset() {
      this.attempts.clear();
      this.previousTotals = null;
      this.previousConnections.clear();
      this.lastRate = { upload: 0, download: 0 };
    }
    /**
     * 吃进一批日志行。
     * @param lines 行。
     * @param now 现在。
     */
    ingestLines(lines, now) {
      for (const line of lines) {
        const parsed = parseLogLine(line);
        if (!parsed) continue;
        const { id, text } = parsed;
        const inbound = /inbound (?:packet )?connection (from|to) (\S+)$/.exec(text);
        if (inbound && /^inbound\//.test(text)) {
          const attempt2 = this.attempts.get(id) ?? this.start(id, now);
          if (inbound[1] === "from") attempt2.source = inbound[2];
          else {
            const { host, port } = splitHostPort(inbound[2]);
            attempt2.host = host;
            attempt2.port = port;
          }
          continue;
        }
        const attempt = this.attempts.get(id);
        if (!attempt) continue;
        if (/^outbound\/\S+: outbound (?:packet )?connection to /.test(text)) {
          attempt.dialing = true;
          continue;
        }
        const process = /router: found process path: (.+?)(?:, user: .*)?$/.exec(text);
        if (process) {
          attempt.process = process[1];
          continue;
        }
        const failure = /^connection: open (?:packet )?connection to \S+(?: using \S+)?: (.*)$/.exec(text);
        if (failure && attempt.outcome === "pending") {
          attempt.outcome = "failed";
          attempt.settledAt = now;
          attempt.reason = failure[1];
        }
      }
      this.prune(now);
    }
    /**
     * 吃进一份连接快照：给拿到回包的连接判成功、补上出站链，并算出有效速率。
     * @param snapshot 快照。
     * @param now 现在。
     * @returns 有效速率（字节 / 秒）；第一份、或累计值变小（内核重启过）时为 `null`。
     */
    ingestSnapshot(snapshot, now) {
      const bySource = /* @__PURE__ */ new Map();
      for (const connection of snapshot.connections) if (connection.source) bySource.set(connection.source, connection);
      for (const attempt of this.attempts.values()) {
        if (!attempt.source) continue;
        const live = bySource.get(attempt.source);
        if (!live) continue;
        if (live.chains.length > 0) attempt.chains = live.chains;
        if (attempt.outcome === "pending" && live.download > 0) {
          attempt.outcome = "succeeded";
          attempt.settledAt = now;
        }
      }
      const current = /* @__PURE__ */ new Map();
      for (const connection of snapshot.connections) current.set(connection.id, { upload: connection.upload, download: connection.download });
      const previous = this.previousTotals;
      const previousConnections = this.previousConnections;
      this.previousTotals = { at: now, upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
      this.previousConnections = current;
      if (!previous) return null;
      const seconds = (now - previous.at) / 1e3;
      const totalUp = snapshot.uploadTotal - previous.upload;
      const totalDown = snapshot.downloadTotal - previous.download;
      if (seconds < 0.2 || totalUp < 0 || totalDown < 0) return null;
      let silentUp = 0;
      let silentDown = 0;
      for (const connection of snapshot.connections) {
        if (connection.download > 0) continue;
        const before = previousConnections.get(connection.id) ?? { upload: 0, download: 0 };
        silentUp += Math.max(0, connection.upload - before.upload);
        silentDown += Math.max(0, connection.download - before.download);
      }
      this.lastRate = { upload: Math.max(0, totalUp - silentUp) / seconds, download: Math.max(0, totalDown - silentDown) / seconds };
      return this.lastRate;
    }
    /**
     * 此刻的读数：最近一次算出的有效速率，与最近一个窗口里判定了的成败数。
     * @param now 现在。
     * @returns 读数。
     */
    reading(now) {
      this.settleByTime(now);
      let succeeded = 0;
      let failed = 0;
      for (const attempt of this.attempts.values()) {
        if (attempt.settledAt === null || now - attempt.settledAt > this.options.windowMs) continue;
        if (attempt.outcome === "succeeded") succeeded += 1;
        else if (attempt.outcome === "failed") failed += 1;
      }
      return { upload: this.lastRate.upload, download: this.lastRate.download, succeeded, failed };
    }
    /**
     * 最近的尝试，新的在前（「最近请求」与「当前页面」用）。
     * @param now 现在。
     * @param limit 至多几条。
     * @returns 尝试（拷贝）。
     */
    recent(now, limit) {
      this.settleByTime(now);
      const out = [];
      const list2 = [...this.attempts.values()];
      for (let index = list2.length - 1; index >= 0 && out.length < limit; index -= 1) {
        const attempt = list2[index];
        if (attempt.host) out.push({ ...attempt, chains: [...attempt.chains] });
      }
      return out;
    }
    start(id, now) {
      const attempt = { id, source: "", host: "", port: 0, process: "", startedAt: now, dialing: false, outcome: "pending", settledAt: null, reason: "", chains: [] };
      this.attempts.set(id, attempt);
      return attempt;
    }
    /** 按时间判：3 秒没交给出站 = 被拒绝；10 秒没失败 = 成功。DNS 不算，直接丢掉。 */
    settleByTime(now) {
      for (const [id, attempt] of this.attempts) {
        if (attempt.port === 53) {
          this.attempts.delete(id);
          continue;
        }
        if (attempt.outcome !== "pending") continue;
        const age = now - attempt.startedAt;
        if (!attempt.dialing && age >= this.options.rejectAfterMs) {
          attempt.outcome = "failed";
          attempt.settledAt = attempt.startedAt + this.options.rejectAfterMs;
          attempt.reason = "\u88AB\u89C4\u5219\u62D2\u7EDD";
        } else if (attempt.dialing && age >= this.options.successAfterMs) {
          attempt.outcome = "succeeded";
          attempt.settledAt = attempt.startedAt + this.options.successAfterMs;
        }
      }
    }
    /** 删掉过期的、超出条数的（Map 按插入顺序，最旧的在前）。 */
    prune(now) {
      for (const [id, attempt] of this.attempts) {
        const old = now - attempt.startedAt > this.options.keepMs;
        if (!old && this.attempts.size <= this.options.maximumAttempts) break;
        this.attempts.delete(id);
      }
    }
  };
  function titleAverage(window, interval) {
    const needed = Math.min(60, Math.max(1, Math.round(interval)));
    if (window.count < needed) return null;
    return { upload: window.upload / window.count, download: window.download / window.count };
  }
  function fixedRate(bytesPerSecond) {
    const units2 = ["K", "M", "G", "T"];
    let value = Math.max(0, Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0) / 1024;
    let unit = 0;
    while (Math.round(value) >= 1e3 && unit < units2.length - 1) {
      value /= 1024;
      unit += 1;
    }
    const digits = Math.round(value * 10) / 10 < 10 ? (Math.round(value * 10) / 10).toFixed(1) : `${Math.min(999, Math.round(value))}`;
    return `${digits}${units2[unit]}`.padStart(4, " ");
  }
  function shortRate(bytesPerSecond) {
    const units2 = ["", "K", "M", "G", "T"];
    let value = Math.max(0, bytesPerSecond);
    let unit = 0;
    while (value >= 1e3 && unit < units2.length - 1) {
      value /= 1024;
      unit += 1;
    }
    if (unit === 0) return `${Math.round(value)}`;
    return `${value < 10 ? (Math.round(value * 10) / 10).toString() : Math.round(value)}${units2[unit]}`;
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
    showSpeed: false,
    speedInterval: 1,
    tun: false,
    dnsMode: "fakeip",
    tunStack: "mixed",
    useSurgeRules: true
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
      showSpeed: flag2(source.showSpeed, defaultPreferences.showSpeed),
      speedInterval: typeof source.speedInterval === "number" && Number.isFinite(source.speedInterval) ? Math.min(60, Math.max(1, Math.round(source.speedInterval))) : defaultPreferences.speedInterval,
      tun: flag2(source.tun, defaultPreferences.tun),
      dnsMode: source.dnsMode === "realip" ? "realip" : "fakeip",
      tunStack: source.tunStack === "system" || source.tunStack === "gvisor" ? source.tunStack : "mixed",
      useSurgeRules: flag2(source.useSurgeRules, defaultPreferences.useSurgeRules)
    };
  }
  var defaultSelection = { mode: "rule", node: URLTEST_TAG, tun: null, groups: {} };
  function normalizeSelection(raw) {
    const value = typeof raw === "object" && raw !== null ? raw : {};
    const mode = Object.prototype.hasOwnProperty.call(clashModeNames, value.mode) ? value.mode : defaultSelection.mode;
    const node = typeof value.node === "string" && value.node.length > 0 ? value.node : defaultSelection.node;
    const tun = typeof value.tun === "boolean" ? value.tun : null;
    const groups = {};
    if (typeof value.groups === "object" && value.groups !== null) {
      for (const [name, member] of Object.entries(value.groups)) if (typeof member === "string") groups[name] = member;
    }
    return { mode, node, tun, groups };
  }
  function wantsTunnel(preferences) {
    return preferences.tun;
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
    tuic: "TUIC",
    anytls: "AnyTLS"
  };
  var requiredCapability = "process.daemon";
  function phaseOf(input) {
    if (!input.granted.includes(requiredCapability)) return "notGranted";
    if (input.daemon?.state === "running" || input.tunnel?.state === "running") return "running";
    if (input.daemon && input.daemon.executable === "") return "notInstalled";
    if (input.nodeCount === 0) return "noNodes";
    if (input.failure || input.daemon?.state === "exited" || input.tunnel?.state === "exited") return "failed";
    return "stopped";
  }
  function runningKernel(daemon, tunnel) {
    if (tunnel?.state === "running") return "tunnel";
    if (daemon?.state === "running") return "daemon";
    return null;
  }
  function tunSubtitle(tun) {
    if (!tun.granted) return "\u8FD8\u6CA1\u6709\u6388\u6743\uFF1A\u6253\u5F00\u300C\u4EE3\u7406\u300D\u70B9\u6388\u6743";
    if (tun.blocker) return tun.blocker;
    if (tun.active) return "\u6574\u673A\u7F51\u7EDC\u7ECF\u8FC7 sing-box\uFF08\u547D\u4EE4\u884C\u5DE5\u5177\u4E5F\u662F\uFF09";
    if (tun.helper === "notInstalled" || tun.helper === null) return "\u7B2C\u4E00\u6B21\u6253\u5F00\u8981\u8F93\u4E00\u6B21\u7BA1\u7406\u5458\u5BC6\u7801\uFF0C\u88C5\u4E0A\u7F51\u7EDC\u52A9\u624B";
    if (tun.helper === "outdated") return "\u7F51\u7EDC\u52A9\u624B\u8981\u66F4\u65B0\uFF1A\u6253\u5F00\u65F6\u518D\u8981\u4E00\u6B21\u7BA1\u7406\u5458\u5BC6\u7801";
    if (tun.helper === "unreachable") return "\u7F51\u7EDC\u52A9\u624B\u88C5\u4E86\u4F46\u8FDE\u4E0D\u4E0A\uFF1A\u6253\u5F00\u65F6\u91CD\u88C5\u4E00\u6B21\uFF08\u8981\u7BA1\u7406\u5458\u5BC6\u7801\uFF09";
    if (!tun.matchesInstalled) return "sing-box \u6362\u4E86\u7248\u672C\uFF1A\u6253\u5F00\u65F6\u518D\u8981\u4E00\u6B21\u7BA1\u7406\u5458\u5BC6\u7801\uFF0C\u628A\u65B0\u7248\u62F7\u8FDB\u53BB";
    return null;
  }
  function isRuleSetFailure(text) {
    return /initial rule-set/i.test(text);
  }
  function isPortConflict(lines) {
    return /address already in use/i.test(lines.join("\n"));
  }
  function describeFailure(lines, preferences) {
    const text = lines.join("\n");
    const last = lastMeaningfulLine(lines);
    const portMatch2 = /listen tcp [^:\s]*:(\d+).*address already in use/i.exec(text) ?? /:(\d+): bind: address already in use/i.exec(text);
    if (portMatch2 || /address already in use/i.test(text)) {
      const port = portMatch2 ? Number(portMatch2[1]) : null;
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
  function restartReasons(control, preferences, wantedKernel = null) {
    if (!control) return [];
    const reasons = [];
    if (control.mixedPort !== preferences.mixedPort) reasons.push("\u672C\u5730\u7AEF\u53E3\u6539\u8FC7");
    if (control.controlPort !== preferences.controlPort) reasons.push("\u63A7\u5236\u7AEF\u53E3\u6539\u8FC7");
    if (wantedKernel !== null && (control.kernel ?? "daemon") !== wantedKernel) reasons.push(wantedKernel === "tunnel" ? "\u589E\u5F3A\u6A21\u5F0F\u6253\u5F00\u4E86" : "\u589E\u5F3A\u6A21\u5F0F\u5173\u6389\u4E86");
    return reasons;
  }
  function reloadReasons(control, preferences, digestNow, rulesDigestNow = null) {
    if (!control) return [];
    const reasons = [];
    if (control.nodesDigest !== digestNow) reasons.push("\u8BA2\u9605\u66F4\u65B0\u8FC7");
    if (control.testURL !== preferences.testURL) reasons.push("\u5EF6\u8FDF\u6D4B\u8BD5\u5730\u5740\u6539\u8FC7");
    if (control.chinaRules !== preferences.chinaRules && !control.ruleSetFallback) reasons.push("\u4E2D\u56FD\u5927\u9646\u76F4\u8FDE\u6539\u8FC7");
    if (rulesDigestNow !== null && control.rulesDigest !== void 0 && control.rulesDigest !== rulesDigestNow) reasons.push("\u89C4\u5219\u6539\u8FC7");
    return reasons;
  }
  function parseToggleArgument(argument) {
    const value = (argument ?? "").trim().toLowerCase();
    if (value === "") return "toggle";
    if (/^(开|开启|打开|启动|on|start|enable)$/.test(value)) return "on";
    if (/^(关|关闭|停止|停|off|stop|disable)$/.test(value)) return "off";
    if (/^(tun|增强|增强模式|enhanced)$/.test(value)) return "tun";
    if (/^(系统代理|普通|notun|system|proxy)$/.test(value)) return "notun";
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
  var maximumMenuItems = 300;
  var maximumMenuNodes = 250;
  var maximumRecentRequests = 12;
  function speedTitle(rate) {
    return `\u2193${fixedRate(rate.download)}
\u2191${fixedRate(rate.upload)}`;
  }
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
      case "tun":
      case "test":
      case "update":
      case "reload":
      case "import":
      case "rules":
      case "copy":
      case "install":
        return { kind: id };
    }
    const mode = /^mode:(rule|global|direct)$/.exec(id);
    if (mode) return { kind: "mode", mode: mode[1] };
    if (id === "node:auto") return { kind: "node", index: -1 };
    const node = /^node:(\d+)$/.exec(id);
    if (node) return { kind: "node", index: Number(node[1]) };
    const group = /^group:(\d+):(\d+)$/.exec(id);
    if (group) return { kind: "group", group: Number(group[1]), member: Number(group[2]) };
    const pick = /^(page|recent):(\d+):(proxy|direct|reject|clear|g\d+)$/.exec(id);
    if (pick) {
      const index = Number(pick[2]);
      const policy = pick[3];
      return pick[1] === "page" ? { kind: "page", domain: index, policy } : { kind: "recent", request: index, policy };
    }
    return null;
  }
  function menuPolicyRef(policy, groups) {
    if (policy === "proxy" || policy === "direct" || policy === "reject") return policy;
    if (policy === "clear") return null;
    const group = groups[Number(policy.slice(1))];
    return group ? `group:${group.name}` : null;
  }
  function statusLine(input) {
    if (input.busy) return input.busy;
    switch (input.phase) {
      case "notGranted":
        return "\u8FD8\u6CA1\u6388\u6743\uFF1A\u6253\u5F00\u300C\u4EE3\u7406\u300D\u70B9\u6388\u6743";
      case "notInstalled":
        return input.preferences.singBoxPath ? "\u8BBE\u7F6E\u91CC\u9009\u7684 sing-box \u8DEF\u5F84\u4E0D\u53EF\u7528" : "\u6CA1\u6709\u627E\u5230 sing-box";
      case "noNodes":
        return "\u6CA1\u6709\u8282\u70B9\uFF1A\u5728\u8BBE\u7F6E\u91CC\u586B\u8BA2\u9605\u5730\u5740";
      case "running":
        return input.kernel === "tunnel" ? `\u5DF2\u5F00\u542F \xB7 ${modeTitles[input.selection.mode]} \xB7 \u589E\u5F3A\u6A21\u5F0F` : `\u5DF2\u5F00\u542F \xB7 ${modeTitles[input.selection.mode]} \xB7 127.0.0.1:${input.preferences.mixedPort}`;
      case "failed":
        return menuText(`\u51FA\u9519\u4E86\uFF1A${input.failure?.message ?? "sing-box \u9000\u51FA\u4E86"}`);
      default:
        return "\u5DF2\u5173\u95ED";
    }
  }
  function memberTitle(tag) {
    return tag === DIRECT_TAG ? "\u76F4\u8FDE" : tag;
  }
  function countMenuItems(items) {
    return items.reduce((total, item) => total + 1 + (item.kind === "submenu" ? countMenuItems(item.items) : 0), 0);
  }
  function policyItems(prefix, current, groups, withGroups, enabled) {
    const items = ["proxy", "direct", "reject"].map((policy) => ({
      kind: "item",
      id: `${prefix}:${policy}`,
      title: policyTitle(policy),
      checked: current === policy,
      enabled
    }));
    if (withGroups && groups.length > 0) {
      items.push({ kind: "separator" });
      groups.forEach((group, index) => {
        const ref = `group:${group.name}`;
        items.push({ kind: "item", id: `${prefix}:g${index}`, title: menuText(policyTitle(ref)), checked: current === ref, enabled });
      });
    }
    if (current !== null) {
      items.push({ kind: "separator" });
      items.push({ kind: "item", id: `${prefix}:clear`, title: "\u5220\u6389\u8FD9\u6761\u89C4\u5219", symbol: "trash", enabled });
    }
    return items;
  }
  function pageSubmenu(input, groups) {
    const page = input.page ?? null;
    const rules = input.pageRules ?? [];
    const items = [];
    let title = "\u5F53\u524D\u9875\u9762";
    if (!input.granted.includes("browser.activeTab")) {
      items.push({ kind: "header", title: "\u8FD8\u6CA1\u6709\u6388\u6743\u8BFB\u53D6\u6D4F\u89C8\u5668\u5F53\u524D\u9875\uFF1A\u6253\u5F00\u300C\u4EE3\u7406\u300D\u70B9\u6388\u6743" });
    } else if (!page || page.status === "none") {
      items.push({ kind: "header", title: "\u8FD8\u6CA1\u7528\u8FC7\u6D4F\u89C8\u5668\uFF1A\u5728 Safari\u3001Chrome \u7B49\u91CC\u6253\u5F00\u4E00\u9875\u518D\u6765" });
    } else {
      if (page.host) title = menuText(`\u5F53\u524D\u9875\u9762 \xB7 ${page.host}`);
      const where = page.browser ? `${page.browser}${page.host ? ` \xB7 ${page.host}` : ""}` : page.host;
      if (page.status !== "ok") items.push({ kind: "header", title: menuText(page.message || `\u8BFB\u4E0D\u5230${page.browser ?? "\u6D4F\u89C8\u5668"}\u7684\u5730\u5740`) });
      else items.push({ kind: "header", title: menuText(where) });
      if (page.domains.length === 0) {
        items.push({ kind: "item", id: "page-empty", title: "\u8FD9\u4E00\u9875\u8FD8\u6CA1\u6709\u7ECF\u8FC7\u4EE3\u7406\u7684\u8FDE\u63A5", enabled: false });
      }
      page.domains.forEach((domain, index) => {
        const rule = pageRuleFor(rules, domain.domain);
        const parts = [domain.domain];
        if (rule) parts.push(policyTitle(rule.policy));
        else if (domain.route) parts.push(`\u6B64\u523B ${memberTitle(domain.route)}`);
        if (domain.failed > 0) parts.push(`${domain.failed} \u5931\u8D25`);
        const children = [];
        if (domain.hosts.length > 0) children.push({ kind: "header", title: menuText(domain.hosts.join("\u3001")) });
        children.push(...policyItems(`page:${index}`, rule?.policy ?? null, groups, true, input.busy === null));
        items.push({ kind: "submenu", title: menuText(parts.join(" \xB7 ")), symbol: domain.isPage ? "globe" : "link", items: children });
      });
    }
    return { kind: "submenu", title, symbol: "safari", items };
  }
  function recentSubmenu(input) {
    const recent = (input.recent ?? []).slice(0, maximumRecentRequests);
    if (input.phase !== "running") return null;
    const rules = input.pageRules ?? [];
    const items = recent.length === 0 ? [{ kind: "item", id: "recent-empty", title: "\u8FD8\u6CA1\u6709\u8BF7\u6C42", enabled: false }] : recent.map((attempt, index) => {
      const failed = attempt.outcome === "failed";
      const rule = pageRuleFor(rules, attempt.host);
      const status = failed ? `\u5931\u8D25\uFF1A${attempt.reason}` : attempt.outcome === "pending" ? "\u8FDB\u884C\u4E2D" : `\u6210\u529F${attempt.chains.length > 0 ? ` \xB7 ${memberTitle(attempt.chains[attempt.chains.length - 1])}` : ""}`;
      return {
        kind: "submenu",
        title: menuText(`${failed ? "\u2715 " : ""}${attempt.host}${attempt.port && attempt.port !== 443 && attempt.port !== 80 ? `:${attempt.port}` : ""}`),
        items: [
          { kind: "item", id: `recent-info:${index}`, title: menuText(status), ...failed ? { tone: "critical" } : { tone: "secondary" }, enabled: false },
          { kind: "separator" },
          ...policyItems(`recent:${index}`, rule?.policy ?? null, [], false, input.busy === null)
        ]
      };
    });
    return { kind: "submenu", title: "\u6700\u8FD1\u8BF7\u6C42", symbol: "clock.arrow.circlepath", items };
  }
  function buildMenuModel(input) {
    const running = input.phase === "running";
    const hidden = !running && input.busy === null;
    const tunActive = running && input.kernel === "tunnel";
    const symbol = tunActive ? "network.badge.shield.half.filled" : running ? "network" : input.phase === "failed" ? "exclamationmark.triangle" : "network.slash";
    const groups = input.groups ?? [];
    const head = [];
    const reading = input.reading ?? null;
    const history = input.history ?? null;
    if (running && history && (history.download.length > 1 || history.upload.length > 1)) {
      const caption = reading ? `\u2193 ${shortRate(reading.download)}B/s  \u2191 ${shortRate(reading.upload)}B/s \xB7 10 \u79D2\u5185\u6210\u529F ${reading.succeeded}\u3001\u5931\u8D25 ${reading.failed}` : void 0;
      head.push({
        kind: "chart",
        series: [
          { tone: "download", values: history.download.slice(-120) },
          { tone: "upload", values: history.upload.slice(-120) }
        ],
        ...caption ? { caption: menuText(caption) } : {}
      });
    }
    head.push({ kind: "header", title: menuText(statusLine(input)) });
    if (input.phase === "notInstalled") {
      if (!input.preferences.singBoxPath && input.granted.includes("terminal.run")) {
        head.push({ kind: "item", id: "install", title: "\u5728\u7EC8\u7AEF\u4E2D\u5B89\u88C5 sing-box", symbol: "terminal" });
      }
    } else if (input.phase !== "notGranted" && input.phase !== "noNodes") {
      head.push({
        kind: "item",
        id: "toggle",
        title: running ? "\u5173\u95ED\u4EE3\u7406" : "\u5F00\u542F\u4EE3\u7406",
        symbol: running ? "stop.circle" : "play.circle",
        enabled: input.busy === null
      });
    }
    const condition = systemProxyCondition(input.proxy, input.granted);
    const proxySubtitle = condition.kind === "blocked" || condition.kind === "other" ? condition.message : condition.kind === "notGranted" ? "\u6CA1\u6709\u6388\u6743\u4FEE\u6539\u7CFB\u7EDF\u4EE3\u7406" : void 0;
    head.push({ kind: "separator" });
    head.push({
      kind: "item",
      id: "systemProxy",
      title: "\u8BBE\u4E3A\u7CFB\u7EDF\u4EE3\u7406",
      ...proxySubtitle ? { subtitle: menuText(proxySubtitle) } : {},
      checked: running && condition.kind === "active",
      enabled: running && input.busy === null && condition.kind !== "notGranted" && condition.kind !== "other"
    });
    if (input.tun) {
      const subtitle = tunSubtitle({ ...input.tun, active: tunActive });
      head.push({
        kind: "item",
        id: "tun",
        title: "\u589E\u5F3A\u6A21\u5F0F\uFF08TUN\uFF09",
        ...subtitle ? { subtitle: menuText(subtitle) } : {},
        checked: running ? tunActive : input.tun.wanted,
        enabled: input.tun.granted && input.busy === null && input.phase !== "notGranted" && input.phase !== "notInstalled"
      });
    }
    head.push({
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
    const groupItems = groups.map((group, groupIndex) => ({
      kind: "submenu",
      title: menuText(`${group.name} \xB7 ${memberTitle(group.selected)}`),
      items: group.members.map((member, memberIndex) => ({
        kind: "item",
        id: `group:${groupIndex}:${memberIndex}`,
        title: menuText(memberTitle(member.title)),
        checked: group.selected === member.tag
      }))
    }));
    const tail = [];
    if (input.phase !== "notGranted") {
      tail.push({ kind: "separator" });
      tail.push(pageSubmenu(input, groups));
      const recent = recentSubmenu(input);
      if (recent) tail.push(recent);
    }
    tail.push({ kind: "separator" });
    tail.push({ kind: "item", id: "test", title: "\u6D4B\u901F", symbol: "speedometer", enabled: running && input.busy === null && input.nodes.length > 0 });
    tail.push({ kind: "item", id: "update", title: "\u66F4\u65B0\u8BA2\u9605\u4E0E\u89C4\u5219\u96C6", symbol: "arrow.clockwise", enabled: input.busy === null });
    tail.push({ kind: "item", id: "reload", title: "\u91CD\u65B0\u8F7D\u5165\u914D\u7F6E", symbol: "arrow.triangle.2.circlepath", enabled: running && input.busy === null });
    tail.push({ kind: "item", id: "import", title: "\u5BFC\u5165 Surge \u914D\u7F6E", symbol: "square.and.arrow.down" });
    tail.push({ kind: "item", id: "rules", title: "\u89C4\u5219", symbol: "list.bullet.rectangle" });
    tail.push({ kind: "item", id: "copy", title: "\u590D\u5236\u7EC8\u7AEF\u4EE3\u7406\u547D\u4EE4", symbol: "doc.on.clipboard", enabled: input.granted.includes("clipboard.write") });
    const items = [...head];
    if (input.nodes.length > 0 || groups.length > 0) {
      items.push({ kind: "separator" });
      if (groups.length > 0) items.push({ kind: "header", title: "\u7B56\u7565\u7EC4" });
    }
    if (input.nodes.length > 0) {
      const others = countMenuItems(items) + countMenuItems(groupItems) + countMenuItems(tail) + 4;
      const room = Math.max(20, Math.min(maximumMenuNodes, maximumMenuItems - others));
      const shown = input.nodes.slice(0, room);
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
      items.push({ kind: "submenu", title: menuText(`${SELECTOR_TAG} \xB7 ${input.selection.node}`), items: nodeItems });
    }
    items.push(...groupItems, ...tail);
    const model = { hidden, symbol, items, tooltip: menuText(`\u4EE3\u7406 \xB7 ${statusLine(input)}`) };
    if (running && input.preferences.showSpeed) {
      const shown = input.titleRate ?? (reading ? { upload: reading.upload, download: reading.download } : input.rate ? { upload: input.rate.up, download: input.rate.down } : null);
      if (shown) model.title = speedTitle(shown);
    }
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
    if (type === "anytls" && !(isRecord2(item.tls) && item.tls.enabled === true)) return fail("AnyTLS \u5FC5\u987B\u5F00 TLS");
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
        case "anytls":
          return parseAnyTLS(line);
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
    const { host, port } = splitHostPort2(hostPort);
    return { userinfo, host, port, params: parseQuery(query), name: percentDecode(fragment).trim() };
  }
  function splitHostPort2(text) {
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
      const endpoint = splitHostPort2(decoded.slice(at + 1).trim());
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
  function parseAnyTLS(line) {
    const parts = splitLink(line);
    const password = parts.userinfo === null ? "" : percentDecode(parts.userinfo);
    if (password.length === 0) return fail("anytls \u94FE\u63A5\u7F3A\u5C11\u5BC6\u7801");
    const network = (param(parts.params, "type", "network") || "tcp").toLowerCase();
    if (network !== "tcp" && network !== "raw") return fail(`AnyTLS \u6CA1\u6709\u4F20\u8F93\u5C42\u9009\u9879\uFF08type=${network}\uFF09`);
    const security = streamSecurity(parts.params, "tls");
    if (!security.ok) return security;
    if (!security.tls) return fail("AnyTLS \u5FC5\u987B\u8D70 TLS\uFF08security=none \u4E0D\u8BA4\uFF09");
    return finishNode("anytls", { host: parts.host, port: parts.port || "443", name: parts.name }, { password, tls: security.tls });
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
    return isIPAddress2(first) ? "" : first;
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
  function isIPAddress2(text) {
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
  var portReleaseMs = 500;
  var readyTimeoutMs = 3e4;
  var requestTimeoutSeconds = 10;
  var allCapabilities = [
    "process.daemon",
    "system.proxy",
    "network.tunnel",
    "network.https",
    "terminal.run",
    "notifications.post",
    "clipboard.write",
    "browser.activeTab",
    "files.pick"
  ];
  var tunnelCapability = "network.tunnel";
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
    /**
     * 一项 `urlList` 偏好此刻的地址（进钥匙串的只能单独读，交回数组；不进的可能是数组或 JSON 串）。
     * @param key 偏好的 key。
     * @returns 去掉空白的 https 地址。
     */
    async urlList(key) {
      try {
        let value = await jarvis.preferences.get(key);
        if (typeof value === "string") {
          try {
            value = JSON.parse(value);
          } catch {
            value = [];
          }
        }
        return Array.isArray(value) ? value.filter((url) => typeof url === "string" && /^https:\/\//i.test(url.trim())).map((url) => url.trim()) : [];
      } catch {
        return [];
      }
    }
    /** 偏好里的订阅地址（进钥匙串的 `urlList`，只能单独读）。 */
    subscriptionURLs() {
      return this.urlList("subscriptions");
    }
    /** 偏好「规则集地址」里的地址：导入的配置里 `RULE-SET` 的地址，用户亲手贴进来的才去拉（宿主只放行这些主机）。 */
    ruleSetURLs() {
      return this.urlList("ruleSets");
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
      const list2 = records ?? await this.records();
      const all = [];
      for (const record of [...list2].sort((a, b) => a.position - b.position)) {
        for (let index = 0; index < record.chunks; index += 1) {
          const chunk = await read(nodeChunkKey(record.id, index));
          if (Array.isArray(chunk)) all.push(...chunk);
        }
      }
      return dedupeNodeNames(all);
    }
    /** 用户选的模式、节点、增强模式与策略组（未按节点列表校正）。 */
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
    /** 页面规则。 */
    async pageRules() {
      return normalizePageRules(await read(storageKeys.pageRules));
    }
    /** 导入的 Surge 配置（不含规则）。 */
    async storedSurge() {
      const value = await read(storageKeys.surge);
      return value && value.version === 1 ? value : null;
    }
    /** 导入的 Surge 配置（含规则）；没导入为 `null`。 */
    async surgeImport() {
      const stored = await this.storedSurge();
      if (!stored) return null;
      const rules = [];
      for (let index = 0; index < stored.ruleChunks; index += 1) {
        const chunk = await read(surgeRuleChunkKey(index));
        if (Array.isArray(chunk)) rules.push(...chunk);
      }
      const { ruleChunks: _chunks, ...rest } = stored;
      return { ...rest, rules };
    }
    /** 外部规则集的记录。 */
    async ruleSetRecords() {
      const value = await read(storageKeys.ruleSets);
      return value && typeof value === "object" ? Object.values(value) : [];
    }
    /** 拉到了的外部规则集的内容。 */
    async ruleSetContents(records) {
      const out = {};
      for (const record of records ?? await this.ruleSetRecords()) {
        if (record.chunks === 0) continue;
        const rules = [];
        for (let index = 0; index < record.chunks; index += 1) {
          const chunk = await read(ruleSetChunkKey(record.tag, index));
          if (Array.isArray(chunk)) rules.push(...chunk);
        }
        out[record.tag] = { rules, hasIP: record.hasIP, total: record.total, skipped: record.skipped };
      }
      return out;
    }
    /**
     * 一份配置里与节点无关的输入，与它们的摘要。
     * @param preferences 偏好。
     * @returns 输入。
     */
    async ruleInputs(preferences) {
      const pageRules = await this.pageRules();
      const surge = preferences.useSurgeRules ? await this.surgeImport() : null;
      const ruleSets = surge ? await this.ruleSetContents() : {};
      const digestText = JSON.stringify({ pageRules: pageRules.map((rule) => [rule.id, rule.policy]), surge: surge ? [surge.importedAt, surge.sourceName] : null, sets: Object.keys(ruleSets).map((tag) => [tag, ruleSets[tag].total]), dns: preferences.dnsMode, stack: preferences.tunStack });
      return { pageRules, surge, ruleSets, digest: digest(digestText) };
    }
    /**
     * 导入的策略组（菜单与面板画它）。
     * @param surge 导入结果（不含规则也行）。
     * @param nodes 节点。
     * @param selection 选择。
     * @returns 组。
     */
    groupViews(surge, nodes, selection) {
      if (!surge) return [];
      const tags = groupTags(surge, nodes);
      return surge.groups.map((group) => {
        const tag = tags.get(group.name) ?? group.name;
        const members = [...new Set(group.members.map((member) => memberTag(member, tags)))].filter((member) => member !== tag).map((member) => ({ tag: member, title: memberTitle(member) }));
        const chosen = selection.groups[group.name];
        return { name: group.name, tag, members, selected: chosen && members.some((member) => member.tag === chosen) ? chosen : members[0]?.tag ?? SELECTOR_TAG };
      });
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
      const [nodes, selection, latency, control, failure, subscriptionCount, pageRules, storedSurge, ruleSetRecords, ruleSetURLs, rules] = await Promise.all([
        this.nodes(records),
        this.selection(),
        this.latency(),
        this.control(),
        read(storageKeys.failure),
        this.subscriptionURLs().then((urls) => urls.length),
        this.pageRules(),
        this.storedSurge(),
        this.ruleSetRecords(),
        this.ruleSetURLs(),
        this.ruleInputs(preferences)
      ]);
      let daemon = null;
      let tunnel = null;
      let proxy = null;
      if (granted.includes(requiredCapability)) {
        try {
          daemon = await jarvis.daemon.status(DAEMON_ID, preferences.singBoxPath || void 0);
        } catch {
          daemon = null;
        }
      }
      if (granted.includes(tunnelCapability)) {
        try {
          tunnel = await jarvis.tunnel.status(preferences.singBoxPath || void 0);
        } catch {
          tunnel = null;
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
      const kernel = runningKernel(daemon, tunnel);
      return {
        granted,
        preferences,
        daemon,
        tunnel,
        kernel,
        tun: {
          granted: granted.includes(tunnelCapability),
          wanted: wantsTunnel(preferences),
          active: kernel === "tunnel",
          helper: tunnel?.helper.state ?? null,
          matchesInstalled: tunnel?.kernel.matchesInstalled ?? false,
          blocker: tunnel?.blocker?.message ?? null
        },
        proxy,
        nodes,
        subscriptions: records,
        subscriptionCount,
        selection: effective,
        latency,
        control,
        failure: failed,
        phase: phaseOf({ granted, daemon, tunnel, nodeCount: nodes.length, failure: failed }),
        pageRules,
        surge: storedSurge,
        ruleSetRecords,
        ruleSetURLs,
        groups: preferences.useSurgeRules ? this.groupViews(storedSurge, nodes, selection) : [],
        rulesDigest: rules.digest
      };
    }
    /**
     * 发一个 Clash API 请求：发往存储里记着的那一个内核（系统代理模式经 `daemon.request`，增强模式经 `tunnel.request`）。
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
      const request = { method, path, headers, ...body !== void 0 ? { body: JSON.stringify(body) } : {}, timeout };
      if ((control?.kernel ?? "daemon") === "tunnel") return jarvis.tunnel.request(request);
      return jarvis.daemon.request({ id: DAEMON_ID, ...request });
    }
    // MARK: 内核
    /** 一个内核此刻在不在跑。 */
    async kernelRunning(kind) {
      try {
        return kind === "tunnel" ? (await jarvis.tunnel.status()).state === "running" : (await jarvis.daemon.status(DAEMON_ID)).state === "running";
      } catch {
        return false;
      }
    }
    /** 内核此刻在不在跑（任一个）。 */
    async isRunning() {
      if (await this.kernelRunning("daemon")) return true;
      const granted = await this.granted();
      return granted.includes(tunnelCapability) && await this.kernelRunning("tunnel");
    }
    /** 此刻在跑的内核；都没在跑为 `null`。 */
    async activeKernel() {
      if (await this.kernelRunning("daemon")) return "daemon";
      const granted = await this.granted();
      if (granted.includes(tunnelCapability) && await this.kernelRunning("tunnel")) return "tunnel";
      return null;
    }
    /** 一个内核最近 500 行输出。 */
    async kernelLogs(kind) {
      try {
        return kind === "tunnel" ? await jarvis.tunnel.logs() : await jarvis.daemon.logs(DAEMON_ID);
      } catch {
        return [];
      }
    }
    // MARK: 开与关
    /**
     * 开启：查装没装 → 有没有节点 → 生成配置 → 起内核（系统代理模式或增强模式）→ 等它就绪 → 把模式、节点、策略组放回去 → 设系统代理。
     * @param context 事件里带来的授权与偏好。
     * @returns 结果。
     */
    async turnOn(context = {}) {
      if (this.busy) return { ok: false, message: `${this.busy}\uFF0C\u7A0D\u7B49` };
      const granted = context.granted ?? await this.granted();
      if (!granted.includes(requiredCapability)) return { ok: false, message: "\u8FD8\u6CA1\u6709\u6388\u6743\u300C\u4EE3\u7406\u300D\u5728\u540E\u53F0\u8FD0\u884C sing-box" };
      const preferences = await this.preferences(context.preferences);
      const selection = await this.selection();
      const kernel = wantsTunnel(preferences) ? "tunnel" : "daemon";
      if (kernel === "tunnel" && !granted.includes(tunnelCapability)) {
        return { ok: false, message: "\u8FD8\u6CA1\u6709\u6388\u6743\u589E\u5F3A\u6A21\u5F0F\uFF08TUN\uFF09\uFF1A\u6253\u5F00\u300C\u4EE3\u7406\u300D\u70B9\u6388\u6743\uFF0C\u6216\u5728\u83DC\u5355\u91CC\u5173\u6389\u589E\u5F3A\u6A21\u5F0F" };
      }
      this.setBusy(kernel === "tunnel" ? "\u6B63\u5728\u5F00\u542F\u589E\u5F3A\u6A21\u5F0F" : "\u6B63\u5728\u5F00\u542F");
      try {
        const executable = preferences.singBoxPath || void 0;
        const running = await this.activeKernel();
        if (running) {
          const port = (await this.control())?.mixedPort ?? preferences.mixedPort;
          const proxy2 = await this.applySystemProxy(granted, preferences.systemProxy, port);
          return { ok: true, message: proxy2 ?? "\u4EE3\u7406\u5DF2\u7ECF\u5F00\u7740" };
        }
        const status = await jarvis.daemon.status(DAEMON_ID, executable);
        if (status.executable === "") {
          return { ok: false, message: preferences.singBoxPath ? `\u8BBE\u7F6E\u91CC\u9009\u7684 sing-box \u8DEF\u5F84\u4E0D\u53EF\u7528\uFF1A${preferences.singBoxPath}` : "\u6CA1\u6709\u627E\u5230 sing-box\uFF1A\u5148\u5728\u300C\u4EE3\u7406\u300D\u91CC\u5B89\u88C5" };
        }
        let nodes = await this.nodes();
        if (nodes.length === 0 && granted.includes("network.https")) {
          this.busy = null;
          await this.updateSubscriptions({ granted, restartIfChanged: false });
          this.setBusy(kernel === "tunnel" ? "\u6B63\u5728\u5F00\u542F\u589E\u5F3A\u6A21\u5F0F" : "\u6B63\u5728\u5F00\u542F");
          nodes = await this.nodes();
        }
        if (nodes.length === 0) return { ok: false, message: "\u6CA1\u6709\u8282\u70B9\uFF1A\u5728\u8BBE\u7F6E\u91CC\u586B\u8BA2\u9605\u5730\u5740\uFF0C\u518D\u66F4\u65B0\u8BA2\u9605" };
        const secret = randomSecret();
        let chinaRules = preferences.chinaRules;
        let fallback = false;
        const rules = await this.ruleInputs(preferences);
        try {
          await this.startKernelReleasingOwnPorts(kernel, nodes, preferences, selection, secret, chinaRules, rules);
        } catch (error) {
          if (error.blocked) throw error;
          if (!(chinaRules && !rules.surge && isRuleSetFailure(errorLines(error).join("\n")))) throw error;
          chinaRules = false;
          fallback = true;
          await this.startKernel(kernel, nodes, preferences, selection, secret, chinaRules, rules);
        }
        await remove(storageKeys.failure);
        await this.applySelection(selection, nodes);
        const proxy = await this.applySystemProxy(granted, preferences.systemProxy, preferences.mixedPort);
        const parts = [kernel === "tunnel" ? "\u589E\u5F3A\u6A21\u5F0F\u5DF2\u5F00\u542F \xB7 \u6574\u673A\u7F51\u7EDC\u7ECF\u8FC7 sing-box" : `\u4EE3\u7406\u5DF2\u5F00\u542F \xB7 127.0.0.1:${preferences.mixedPort}`];
        if (fallback) parts.push("\u4E2D\u56FD\u5927\u9646\u89C4\u5219\u96C6\u4E0B\u8F7D\u5931\u8D25\uFF0C\u8FD9\u6B21\u4E0D\u5206\u6D41");
        if (proxy) parts.push(proxy);
        return { ok: true, message: parts.join("\uFF1B") };
      } catch (error) {
        if (error.blocked) {
          await this.markStarted();
          await remove(storageKeys.control);
          return { ok: false, message: errorMessage2(error) };
        }
        if (error.code === "permission.denied" && kernel === "tunnel") {
          await remove(storageKeys.control);
          return { ok: false, message: `${errorMessage2(error)}\uFF1A\u589E\u5F3A\u6A21\u5F0F\u8981\u88C5\u4E00\u6B21\u7F51\u7EDC\u52A9\u624B\uFF0C\u518D\u70B9\u4E00\u6B21\u6253\u5F00\u3001\u8F93\u5165\u7BA1\u7406\u5458\u5BC6\u7801\u5373\u53EF` };
        }
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
     * 一份配置。
     * @param kernel 跑在哪。
     * @param nodes 节点。
     * @param preferences 偏好。
     * @param selection 选择。
     * @param secret 控制口 secret。
     * @param chinaRules 这一次分不分流。
     * @param rules 规则输入。
     * @returns 配置与它的选项。
     */
    config(kernel, nodes, preferences, selection, secret, chinaRules, rules, ports) {
      const options = {
        nodes,
        mixedPort: ports?.mixedPort ?? preferences.mixedPort,
        controlPort: ports?.controlPort ?? preferences.controlPort,
        controlSecret: secret,
        mode: selection.mode,
        testURL: preferences.testURL,
        selected: selection.node,
        chinaRules,
        kernel,
        dnsMode: preferences.dnsMode,
        pageRules: rules.pageRules,
        surge: rules.surge,
        ruleSets: rules.ruleSets,
        groupSelection: selection.groups
      };
      return buildConfig(options);
    }
    /**
     * 起内核；撞上「端口被占着」时先停掉自己的两个内核、等半秒再起一次（W-4）。
     *
     * 仓库主人：「Jarvis 自己的端口释放和占用，我理解应该可以自行处理」。占着 7890 / 19090 的多半是 Jarvis 自己：
     * 另一种模式的内核还没退完、上一个实例留下的 sing-box（宿主在 `daemon.start` 前也会收同目录的遗留进程）。
     * 第二次还冲突才是真的被别的程序占着，照常报出来。
     */
    async startKernelReleasingOwnPorts(kernel, nodes, preferences, selection, secret, chinaRules, rules) {
      try {
        await this.startKernel(kernel, nodes, preferences, selection, secret, chinaRules, rules);
      } catch (error) {
        if (error.blocked || !isPortConflict(errorLines(error))) throw error;
        jarvis.log.info("\u7AEF\u53E3\u88AB\u5360\u7740\uFF1A\u5148\u505C\u6389\u81EA\u5DF1\u7684\u5185\u6838\u518D\u8D77\u4E00\u6B21");
        await this.stopOwnKernels();
        await sleep(portReleaseMs);
        await this.startKernel(kernel, nodes, preferences, selection, secret, chinaRules, rules);
      }
    }
    /** 停自己的两个内核（哪一个在跑都停得掉；没在跑是空操作）。 */
    async stopOwnKernels() {
      try {
        await jarvis.daemon.stop(DAEMON_ID);
      } catch (error) {
        jarvis.log.warn("\u5E38\u9A7B\u5185\u6838\u6CA1\u80FD\u505C\u4E0B", errorMessage2(error));
      }
      if ((await this.granted()).includes(tunnelCapability)) {
        try {
          await jarvis.tunnel.stop();
        } catch (error) {
          jarvis.log.warn("\u589E\u5F3A\u6A21\u5F0F\u6CA1\u80FD\u505C\u4E0B", errorMessage2(error));
        }
      }
    }
    /**
     * 起内核并等它就绪。远程规则集在 sing-box 的启动阶段下载（宿主只等 1–1.5 秒），所以「起来了」之后还要等 Clash API 开始答话；
     * 这期间进程退了，读它的输出当失败抛出——上层据此判断要不要不分流再试一次。增强模式被别的 VPN 拦着时抛 `{ blocked: true }`。
     */
    async startKernel(kernel, nodes, preferences, selection, secret, chinaRules, rules) {
      const config = this.config(kernel, nodes, preferences, selection, secret, chinaRules, rules);
      const control = {
        kernel,
        secret,
        controlPort: preferences.controlPort,
        mixedPort: preferences.mixedPort,
        chinaRules,
        ruleSetFallback: preferences.chinaRules && !chinaRules && !rules.surge,
        testURL: preferences.testURL,
        nodesDigest: nodesDigest(nodes),
        rulesDigest: rules.digest,
        startedAt: Date.now(),
        starting: true
      };
      await write(storageKeys.control, control);
      if (kernel === "tunnel") {
        const status = await jarvis.tunnel.start({
          config: JSON.stringify(config),
          controlPort: preferences.controlPort,
          ...preferences.singBoxPath ? { executable: preferences.singBoxPath } : {},
          excludeRoutes: tunnelExcludeRoutes(rules.surge),
          stack: preferences.tunStack,
          ipv6: rules.surge?.general.ipv6 !== false
        });
        if (status.state !== "running") {
          throw { blocked: true, message: status.blocker?.message ?? "\u589E\u5F3A\u6A21\u5F0F\u6CA1\u6709\u8D77\u6765\uFF1A\u53E6\u4E00\u4E2A VPN \u6216\u589E\u5F3A\u6A21\u5F0F\u6B63\u5360\u7740\u7F51\u7EDC" };
        }
      } else {
        await jarvis.daemon.start({
          id: DAEMON_ID,
          config: JSON.stringify(config),
          controlPort: preferences.controlPort,
          ...preferences.singBoxPath ? { executable: preferences.singBoxPath } : {}
        });
      }
      const deadline = Date.now() + readyTimeoutMs;
      for (; ; ) {
        if (!await this.kernelRunning(kernel)) {
          const lines = (await this.kernelLogs(kernel)).slice(-20);
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
     * 把模式、「节点选择」与导入的策略组放回用户选的样子。`cache.db` 记着上一次的模式与选中项，启动时以它为准，
     * 配置里的 `default_mode` / `default` 只管第一次——用户在内核停着的时候改过，不放回去就会被缓存盖掉。
     */
    async applySelection(selection, nodes) {
      try {
        await this.clash("PATCH", "/configs", { mode: clashModeNames[selection.mode] });
        const members = /* @__PURE__ */ new Set([URLTEST_TAG, ...nodes.map((node) => node.name)]);
        await this.clash("PUT", proxyPath(SELECTOR_TAG), { name: members.has(selection.node) ? selection.node : URLTEST_TAG });
        const preferences = await this.preferences();
        const surge = preferences.useSurgeRules ? await this.storedSurge() : null;
        for (const group of this.groupViews(surge, nodes, selection)) {
          if (selection.groups[group.name] === void 0) continue;
          await this.clash("PUT", proxyPath(group.tag), { name: group.selected });
        }
      } catch (error) {
        jarvis.log.warn("\u6A21\u5F0F\u4E0E\u8282\u70B9\u6CA1\u80FD\u653E\u56DE\u53BB", errorMessage2(error));
      }
    }
    /**
     * 按偏好设系统代理（增强模式下照样设：认系统代理的应用少绕一次 TUN，与 Surge 增强模式相同）。
     * @returns 要告诉用户的一句话（被拦着、别人接管着、没授权）；一切正常为 `null`。
     */
    async applySystemProxy(granted, wanted, port) {
      if (!wanted) return null;
      if (!granted.includes("system.proxy")) return "\u6CA1\u6709\u6388\u6743\u4FEE\u6539\u7CFB\u7EDF\u4EE3\u7406\uFF0C\u53EA\u5728\u672C\u673A\u7AEF\u53E3\u4E0A\u53EF\u7528";
      try {
        const status = await jarvis.systemProxy.enable({ port, bypass: systemProxyBypass(await this.storedSurge()) });
        return status.blocker ? status.blocker.message : null;
      } catch (error) {
        return errorMessage2(error);
      }
    }
    /**
     * 关闭：先还原系统代理，再停内核（反过来的话中间那一下系统代理指着一个没人监听的端口）。两个内核都停一次：哪一个在跑都停得掉。
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
        if (granted.includes(tunnelCapability)) {
          try {
            await jarvis.tunnel.stop();
          } catch (error) {
            jarvis.log.warn("\u589E\u5F3A\u6A21\u5F0F\u6CA1\u80FD\u505C\u4E0B", errorMessage2(error));
          }
        }
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
     * 重开（端口改过、换了内核）：会断开现有连接一下。
     * @returns 结果。
     */
    async restart() {
      const off = await this.turnOff();
      if (!off.ok) return off;
      return this.turnOn();
    }
    /**
     * 重新载入：换一份配置、不断进程（`daemon.reload` / `tunnel.reload`，sing-box 收到 SIGHUP 原进程重载）。节点、规则、测速地址变了都走这条路；
     * 端口改过、内核要换时只能重开（见 `restartReasons`），这里会转去 {@link restart}。没在跑时什么都不做。
     * @returns 结果。
     */
    async reload() {
      if (this.busy) return { ok: false, message: `${this.busy}\uFF0C\u7A0D\u7B49` };
      const control = await this.control();
      const kernel = await this.activeKernel();
      if (!control || !kernel) return { ok: true, message: "" };
      const preferences = await this.preferences();
      const selection = await this.selection();
      const wanted = wantsTunnel(preferences) ? "tunnel" : "daemon";
      if (control.mixedPort !== preferences.mixedPort || control.controlPort !== preferences.controlPort || wanted !== kernel) return this.restart();
      this.setBusy("\u6B63\u5728\u91CD\u65B0\u8F7D\u5165");
      try {
        const nodes = await this.nodes();
        if (nodes.length === 0) return { ok: false, message: "\u6CA1\u6709\u8282\u70B9\uFF1A\u5148\u66F4\u65B0\u8BA2\u9605" };
        const rules = await this.ruleInputs(preferences);
        const chinaRules = preferences.chinaRules;
        const config = JSON.stringify(this.config(kernel, nodes, preferences, selection, control.secret, chinaRules, rules, { mixedPort: control.mixedPort, controlPort: control.controlPort }));
        if (kernel === "tunnel") await jarvis.tunnel.reload(config);
        else await jarvis.daemon.reload({ id: DAEMON_ID, config });
        await write(storageKeys.control, {
          ...control,
          kernel,
          chinaRules,
          ruleSetFallback: false,
          testURL: preferences.testURL,
          nodesDigest: nodesDigest(nodes),
          rulesDigest: rules.digest
        });
        await this.waitReady(kernel);
        await this.applySelection(selection, nodes);
        return { ok: true, message: "\u5DF2\u91CD\u65B0\u8F7D\u5165\u914D\u7F6E" };
      } catch (error) {
        return { ok: false, message: `\u6CA1\u80FD\u91CD\u65B0\u8F7D\u5165\uFF1A${errorMessage2(error)}` };
      } finally {
        this.setBusy(null);
      }
    }
    /** 重载之后等 Clash API 重新答话（sing-box 重载时控制口会关一下），至多 10 秒。 */
    async waitReady(kernel) {
      const deadline = Date.now() + 1e4;
      while (Date.now() < deadline) {
        if (!await this.kernelRunning(kernel)) return;
        try {
          if ((await this.clash("GET", "/version", void 0, 2)).status === 200) return;
        } catch {
        }
        await sleep(300);
      }
    }
    // MARK: 模式、节点、策略组、增强模式、系统代理
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
     * 给导入的一个策略组换组员：记下来，开着就当场换。
     * @param group 组（Surge 里的名字）。
     * @param member 组员 tag。
     */
    async selectGroupMember(group, member) {
      const selection = await this.selection();
      await write(storageKeys.selection, { ...selection, groups: { ...selection.groups, [group.name]: member } });
      if (!await this.isRunning()) return { ok: true, message: "" };
      try {
        const response = await this.clash("PUT", proxyPath(group.tag), { name: member });
        return response.status < 300 ? { ok: true, message: "" } : { ok: false, message: `\u300C${group.name}\u300D\u6CA1\u80FD\u5207\u5230\u300C${memberTitle(member)}\u300D\uFF08${response.status}\uFF09` };
      } catch (error) {
        return { ok: false, message: `\u6CA1\u80FD\u5207\u7B56\u7565\u7EC4\uFF1A${errorMessage2(error)}` };
      }
    }
    /**
     * 开 / 关增强模式：写偏好 `tun`（W-6：菜单、工具箱、`/proxy tun` 与设置页同一份真源），开着就换一个内核重开——
     * 两个内核都要监听同一个本地端口，不能同时跑。第一次打开时宿主会弹管理员密码框装网络助手。
     * 写之前先记一笔 `tunSwitch`：宿主把这次变更也通知给后台会话，它据此认出是自己人在换，不再换一次。
     * @param on 开还是关。
     */
    async setTun(on) {
      await write(storageKeys.tunSwitch, { on, at: Date.now() });
      try {
        await jarvis.preferences.set("tun", on);
      } catch (error) {
        return { ok: false, message: `\u6CA1\u80FD\u6539\u300C\u589E\u5F3A\u6A21\u5F0F\u300D\uFF1A${errorMessage2(error)}` };
      }
      return this.applyTun(on);
    }
    /**
     * 按偏好 `tun` 换内核：开着且内核与它不符时重开；没开着什么都不做（下次开启按它）。设置页改了这一项走这里（后台会话）。
     * @param on 偏好此刻的值。
     * @returns 结果。
     */
    async applyTun(on) {
      const kernel = await this.activeKernel();
      if (!kernel) return { ok: true, message: on ? "\u4E0B\u6B21\u5F00\u542F\u4EE3\u7406\u65F6\u7528\u589E\u5F3A\u6A21\u5F0F" : "\u4E0B\u6B21\u5F00\u542F\u4EE3\u7406\u65F6\u7528\u7CFB\u7EDF\u4EE3\u7406\u6A21\u5F0F" };
      if (kernel === "tunnel" === on) return { ok: true, message: "" };
      return this.restart();
    }
    /**
     * 上一版把菜单里拨的增强模式记在 `selection.tun`：读到布尔值就写进偏好再清掉，之后只看偏好（W-6）。
     * 写不进去（旧宿主没有 `preferences.set`）时留着不动，下次再试。
     */
    async migrateTunSelection() {
      const selection = await this.selection();
      if (selection.tun === null) return;
      try {
        await write(storageKeys.tunSwitch, { on: selection.tun, at: Date.now() });
        await jarvis.preferences.set("tun", selection.tun);
        await write(storageKeys.selection, { ...selection, tun: null });
      } catch (error) {
        jarvis.log.warn("\u589E\u5F3A\u6A21\u5F0F\u7684\u65E7\u5F00\u5173\u6CA1\u80FD\u642C\u8FDB\u504F\u597D", errorMessage2(error));
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
        const status = await jarvis.systemProxy.enable({ port, bypass: systemProxyBypass(await this.storedSurge()) });
        return status.blocker ? { ok: false, message: status.blocker.message } : { ok: true, message: `\u7CFB\u7EDF\u4EE3\u7406\u6307\u5411 127.0.0.1:${port}` };
      } catch (error) {
        return { ok: false, message: errorMessage2(error) };
      }
    }
    // MARK: 页面规则
    /**
     * 给一个域名定策略（`null` = 删掉它的规则），开着就重新载入——不断连接、不动系统代理。
     * @param domain 域名（`domain_suffix`：含全部子域名）。
     * @param policy 策略。
     * @returns 结果。
     */
    async setPageRule(domain, policy) {
      const rules = await this.pageRules();
      const id = `domain_suffix:${domain}`;
      const next = policy === null ? removePageRule(rules, id) : upsertPageRule(rules, { kind: "domain_suffix", value: domain, policy }, Date.now());
      await write(storageKeys.pageRules, next);
      const reloaded = await this.reload();
      if (!reloaded.ok) return reloaded;
      return { ok: true, message: policy === null ? `\u5220\u6389\u4E86 ${domain} \u7684\u89C4\u5219` : `${domain} \u4EE5\u540E${policyLabel(policy)}` };
    }
    /**
     * 删一条页面规则（按 id）。
     * @param id 规则 id。
     */
    async removePageRule(id) {
      await write(storageKeys.pageRules, removePageRule(await this.pageRules(), id));
      return this.reload();
    }
    /**
     * 读「当前页面」：浏览器地址栏 + 这个浏览器的进程最近 30 秒连过的主机。
     * @param granted 已授予的能力。
     * @param seen 最近的连接（日志与快照合起来的）。
     * @returns 读到的东西。
     */
    async currentPage(granted, seen) {
      if (!granted.includes("browser.activeTab")) return { browser: null, host: "", status: "notGranted", message: "\u8FD8\u6CA1\u6709\u6388\u6743\u8BFB\u53D6\u6D4F\u89C8\u5668\u5F53\u524D\u9875", domains: [] };
      let tab = null;
      try {
        tab = await jarvis.browser.activeTab();
      } catch (error) {
        return { browser: null, host: "", status: "unavailable", message: errorMessage2(error), domains: [] };
      }
      if (!tab) return { browser: null, host: "", status: "none", message: "", domains: [] };
      const host = tab.status === "ok" && tab.url ? urlHost(tab.url) : "";
      return {
        browser: tab.browser.name,
        host,
        status: tab.status,
        message: tab.message ?? (tab.status === "denied" ? `\u5728 \u7CFB\u7EDF\u8BBE\u7F6E \u203A \u9690\u79C1\u4E0E\u5B89\u5168\u6027 \u203A \u81EA\u52A8\u5316 \u91CC\u5141\u8BB8 Jarvis \u63A7\u5236\u300C${tab.browser.name}\u300D` : tab.status === "unsupported" ? `\u8BFB\u4E0D\u5230\u300C${tab.browser.name}\u300D\u7684\u5730\u5740\uFF1A\u53EA\u80FD\u770B\u4E0B\u9762\u8FD9\u4E9B\u8FDE\u63A5` : ""),
        domains: pageDomains(host, tab.browser, seen, Date.now())
      };
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
    /**
     * 此刻的路由（窗口「规则」页那张表，jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）：
     * 与开启时交给 sing-box 的同一份算法、同一份输入（页面规则、导入的配置、拉到的外部规则集）；这一份有没有分流按在跑的那一份记的为准。
     * 改过规则还没重新载入时，这里列的是新的那一份——页面上「重新载入之后生效」那张卡会说清楚。
     * @param snapshot 快照。
     * @returns 路由。
     */
    async routeTable(snapshot) {
      const rules = await this.ruleInputs(snapshot.preferences);
      return routePlan({
        nodes: snapshot.nodes,
        mixedPort: snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort,
        controlPort: snapshot.control?.controlPort ?? snapshot.preferences.controlPort,
        controlSecret: snapshot.control?.secret ?? "-",
        mode: snapshot.selection.mode,
        testURL: snapshot.preferences.testURL,
        selected: snapshot.selection.node,
        chinaRules: snapshot.control ? snapshot.control.chinaRules && !snapshot.control.ruleSetFallback : snapshot.preferences.chinaRules,
        kernel: snapshot.kernel ?? snapshot.control?.kernel ?? "daemon",
        dnsMode: snapshot.preferences.dnsMode,
        pageRules: rules.pageRules,
        surge: rules.surge,
        ruleSets: rules.ruleSets,
        groupSelection: snapshot.selection.groups
      });
    }
    /**
     * 经直连出站测一次「Internet 延迟」（窗口「活动」页那张卡）：本机到外网通不通、要多久，不经过任何节点。
     * @param url 测试地址（https）。
     * @returns 毫秒；没在跑、超时、连不上为 `null`。
     */
    async internetLatency(url) {
      try {
        return parseDelay(await this.clash("GET", delayPath(DIRECT_TAG, url), void 0, requestTimeoutSeconds));
      } catch {
        return null;
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
    /** 在跑的内核（没在跑就按存储里记着的那一个）最近 500 行输出。 */
    async logs() {
      const kernel = await this.activeKernel() ?? (await this.control())?.kernel ?? "daemon";
      return this.kernelLogs(kernel);
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
    // MARK: 导入 Surge 配置与外部规则集
    /**
     * 导入一份 Surge 配置：转换、存下（规则切块），开着就重新载入；再把「规则集地址」里已经填了的那几个拉一遍。
     * @param text 文件正文。
     * @param name 文件名。
     * @returns 结果。
     */
    async importSurge(text, name) {
      let imported;
      try {
        imported = convertSurgeProfile(text, name, Date.now());
      } catch (error) {
        return { ok: false, message: errorMessage2(error) };
      }
      const previous = await this.storedSurge();
      const blocks = chunkItems(imported.rules);
      for (let index = 0; index < blocks.length; index += 1) await write(surgeRuleChunkKey(index), blocks[index]);
      for (let stale = blocks.length; stale < (previous?.ruleChunks ?? 0); stale += 1) await remove(surgeRuleChunkKey(stale));
      const { rules: _rules, ...rest } = imported;
      await write(storageKeys.surge, { ...rest, ruleChunks: blocks.length });
      const records = await this.ruleSetRecords();
      const keep = new Set(imported.ruleSets.map((ref) => ref.tag));
      const kept = {};
      for (const record of records) {
        if (keep.has(record.tag)) kept[record.tag] = record;
        else for (let index = 0; index < record.chunks; index += 1) await remove(ruleSetChunkKey(record.tag, index));
      }
      await write(storageKeys.ruleSets, kept);
      const pending = imported.ruleSets.length;
      const parts = [`\u5BFC\u5165\u4E86\u300C${name}\u300D\uFF1A${convertedCount(imported.report)} / ${imported.report.ruleLines} \u6761\u89C4\u5219\u8F6C\u6210 sing-box\u3001${imported.groups.length} \u4E2A\u7B56\u7565\u7EC4`];
      const unsupported = imported.report.unsupported.reduce((sum, kind) => sum + kind.count, 0);
      if (unsupported > 0) parts.push(`${unsupported} \u9879\u8F6C\u4E0D\u4E86\uFF08\u89C1\u300C\u89C4\u5219\u300D\u9875\uFF09`);
      const granted = await this.granted();
      if (pending > 0) {
        const fetched = granted.includes("network.https") ? await this.updateRuleSets({ reload: false }) : null;
        parts.push(fetched?.message || `${pending} \u4E2A\u5916\u90E8\u89C4\u5219\u96C6\u8981\u8054\u7F51\u62C9\uFF1A\u628A\u5730\u5740\u8D34\u8FDB \u8BBE\u7F6E \u203A\u300C\u89C4\u5219\u96C6\u5730\u5740\u300D`);
      }
      const reloaded = await this.reload();
      if (!reloaded.ok) parts.push(reloaded.message);
      return { ok: true, message: parts.join("\uFF1B") };
    }
    /** 撤掉导入的 Surge 配置，回到内置规则。 */
    async clearSurge() {
      const stored = await this.storedSurge();
      for (let index = 0; index < (stored?.ruleChunks ?? 0); index += 1) await remove(surgeRuleChunkKey(index));
      for (const record of await this.ruleSetRecords()) for (let index = 0; index < record.chunks; index += 1) await remove(ruleSetChunkKey(record.tag, index));
      await remove(storageKeys.surge);
      await remove(storageKeys.ruleSets);
      const reloaded = await this.reload();
      return reloaded.ok ? { ok: true, message: "\u64A4\u6389\u4E86\u5BFC\u5165\u7684 Surge \u914D\u7F6E\uFF0C\u56DE\u5230\u5185\u7F6E\u89C4\u5219" } : reloaded;
    }
    /**
     * 拉一遍导入配置里的外部规则集——只拉用户贴进「规则集地址」的那些（宿主只放行用户亲手填的主机）。每个各自成败：没拉到的留着上一次的内容。
     * @param options `reload`：拉完、内容变了且开着就重新载入（默认要）。
     * @returns 结果；没导入、没有外部规则集为 `{ ok: true, message: "" }`。
     */
    async updateRuleSets(options = {}) {
      const surge = await this.storedSurge();
      if (!surge || surge.ruleSets.length === 0) return { ok: true, message: "" };
      const allowed = new Set(await this.ruleSetURLs());
      const previous = new Map((await this.ruleSetRecords()).map((record) => [record.tag, record]));
      const next = {};
      let fetched = 0;
      let waiting = 0;
      let changed = false;
      const failures = [];
      for (const ref of surge.ruleSets) {
        const before = previous.get(ref.tag);
        const base = before ?? { ...ref, fetchedAt: null, attemptedAt: null, error: null, total: 0, skipped: 0, hasIP: false, chunks: 0 };
        if (!allowed.has(ref.url)) {
          waiting += 1;
          next[ref.tag] = { ...base, error: base.chunks > 0 ? base.error : "\u8FD8\u6CA1\u8D34\u8FDB\u300C\u89C4\u5219\u96C6\u5730\u5740\u300D" };
          continue;
        }
        const now = Date.now();
        try {
          const response = await jarvis.net.fetch(ref.url, { method: "GET", headers: { "User-Agent": SUBSCRIPTION_USER_AGENT } });
          if (response.status < 200 || response.status >= 300) throw new Error(`\u670D\u52A1\u5668\u56DE\u4E86 HTTP ${response.status}`);
          const list2 = convertSurgeList(response.text, ref.format);
          const blocks = chunkItems(splitHeadlessRules(list2.rules));
          for (let index = 0; index < blocks.length; index += 1) await write(ruleSetChunkKey(ref.tag, index), blocks[index]);
          for (let stale = blocks.length; stale < base.chunks; stale += 1) await remove(ruleSetChunkKey(ref.tag, stale));
          changed || (changed = base.total !== list2.total || base.chunks !== blocks.length || base.fetchedAt === null);
          next[ref.tag] = { ...base, fetchedAt: now, attemptedAt: now, error: null, total: list2.total, skipped: list2.skipped, hasIP: list2.hasIP, chunks: blocks.length };
          fetched += 1;
        } catch (error) {
          failures.push(`${ref.host}\uFF1A${errorMessage2(error)}`);
          next[ref.tag] = { ...base, attemptedAt: now, error: errorMessage2(error) };
        }
      }
      await write(storageKeys.ruleSets, next);
      const parts = [];
      if (fetched > 0) parts.push(`\u62C9\u5230 ${fetched} \u4E2A\u5916\u90E8\u89C4\u5219\u96C6`);
      if (waiting > 0) parts.push(`${waiting} \u4E2A\u8FD8\u6CA1\u8D34\u8FDB\u300C\u89C4\u5219\u96C6\u5730\u5740\u300D`);
      if (failures.length > 0) parts.push(`\u6CA1\u62C9\u5230\uFF1A${failures.join("\uFF1B")}`);
      if (changed && options.reload !== false) {
        const reloaded = await this.reload();
        if (!reloaded.ok) parts.push(reloaded.message);
      }
      return { ok: failures.length === 0, message: parts.join("\uFF1B") };
    }
    // MARK: 订阅
    /**
     * 拉一遍偏好里的全部订阅。每条各自成败：失败的那条留着上一次的节点，只记下原因。
     * 内核开着、节点又真的变了，就重新载入一次让新节点生效（不断进程：`daemon.reload` / `tunnel.reload`）。
     * @param options 授权（省略时现问）与要不要重新载入。
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
            const reloaded = await this.reload();
            summary = { ok: reloaded.ok, message: `${summary.message}\uFF1B${reloaded.ok ? "\u5DF2\u91CD\u65B0\u8F7D\u5165\u4EE5\u7528\u4E0A\u65B0\u8282\u70B9" : reloaded.message}` };
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
     * 「更新订阅与规则集」：订阅一遍、外部规则集一遍（菜单与自动更新用）。
     * @param granted 已授予的能力。
     * @returns 两件事合起来的结果。
     */
    async updateAll(granted) {
      const subscriptions = await this.updateSubscriptions({ granted });
      const sets = await this.updateRuleSets();
      const message = [subscriptions.message, sets.message].filter((part) => part.length > 0).join("\uFF1B");
      return { ok: subscriptions.ok && sets.ok, message };
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
  function policyLabel(policy) {
    if (policy === "proxy") return "\u8D70\u4EE3\u7406";
    if (policy === "direct") return "\u76F4\u8FDE";
    if (policy === "reject") return "\u4E00\u5F8B\u62D2\u7EDD";
    return `\u8D70\u300C${policy.slice("group:".length)}\u300D`;
  }

  // extensions/proxy/src/rule-table.ts
  var nonConditionKeys = /* @__PURE__ */ new Set(["action", "outbound", "method", "no_drop", "invert", "type", "mode", "rules", "override_address", "override_port", "network_strategy", "fallback_delay", "udp_disable_domain_unmapping", "udp_connect", "udp_timeout", "tls_fragment", "tls_record_fragment"]);
  function signatureOf(rule) {
    const action = actionOf(rule);
    if (!action) return null;
    const values = /* @__PURE__ */ new Map();
    const collect = (source) => {
      for (const [key, value] of Object.entries(source)) {
        if (nonConditionKeys.has(key)) continue;
        const list2 = (Array.isArray(value) ? value : [value]).map((item) => String(item));
        values.set(key, [...values.get(key) ?? [], ...list2]);
      }
    };
    if (rule.type === "logical" && Array.isArray(rule.rules)) {
      for (const sub of rule.rules) if (typeof sub === "object" && sub !== null) collect(sub);
    } else {
      collect(rule);
    }
    return { action, keys: [...values.keys()].sort(), values };
  }
  function actionOf(rule) {
    if (rule.action === "route" && typeof rule.outbound === "string") return `route(${rule.outbound})`;
    if (rule.action === "reject") return "reject";
    return null;
  }
  function parseRuleText(text) {
    const arrow = text.lastIndexOf(" => ");
    if (arrow < 0) return null;
    const rawAction = text.slice(arrow + 4).trim();
    const action = rawAction.startsWith("reject") ? "reject" : rawAction;
    const values = /* @__PURE__ */ new Map();
    const pattern = /([a-z_]+)=(\[[^\]]*\]|\S+)/g;
    const conditions = text.slice(0, arrow);
    for (let match = pattern.exec(conditions); match; match = pattern.exec(conditions)) {
      const raw = match[2];
      const list2 = raw.startsWith("[") ? raw.slice(1, -1).split(" ").filter((item) => item.length > 0) : [raw];
      values.set(match[1], [...values.get(match[1]) ?? [], ...list2]);
    }
    return { action, keys: [...values.keys()].sort(), values };
  }
  function sameValues(left, right) {
    if (!left || !right || left.length !== right.length) return false;
    const a = [...left].sort();
    const b = [...right].sort();
    return a.every((item, index) => item === b[index]);
  }
  function matchRule(plan, text) {
    if (text === "final") return "final";
    const wanted = parseRuleText(text);
    if (!wanted) return null;
    let fallback = null;
    for (const [index, rule] of plan.rules.entries()) {
      const signature = signatureOf(rule);
      if (!signature || signature.action !== wanted.action) continue;
      if (signature.keys.length !== wanted.keys.length || signature.keys.some((key, position) => key !== wanted.keys[position])) continue;
      if (signature.keys.every((key) => sameValues(signature.values.get(key), wanted.values.get(key)))) return index;
      if (fallback === null) fallback = index;
    }
    return fallback;
  }
  var typeTitles = {
    domain: "DOMAIN",
    domain_suffix: "DOMAIN-SUFFIX",
    domain_keyword: "DOMAIN-KEYWORD",
    domain_regex: "DOMAIN-REGEX",
    ip_cidr: "IP-CIDR",
    source_ip_cidr: "SRC-IP",
    ip_is_private: "LAN",
    rule_set: "RULE-SET",
    process_name: "PROCESS-NAME",
    process_path: "PROCESS-PATH",
    clash_mode: "MODE",
    port: "DEST-PORT",
    port_range: "DEST-PORT",
    source_port: "SRC-PORT",
    network: "NETWORK",
    protocol: "PROTOCOL"
  };
  function policyColumn(action) {
    if (action === "reject") return "\u62D2\u7EDD";
    const tag = action.slice("route(".length, -1);
    if (tag === DIRECT_TAG) return "\u76F4\u8FDE";
    return tag;
  }
  function noteOf(origin) {
    switch (origin.kind) {
      case "lan":
        return "\u5C40\u57DF\u7F51\u4E0E\u672C\u673A\u4E00\u5F8B\u76F4\u8FDE";
      case "mode":
        return origin.mode === "direct" ? "\u51FA\u7AD9\u6A21\u5F0F\u300C\u76F4\u8FDE\u300D\u65F6\u5168\u90E8\u76F4\u8FDE" : "\u51FA\u7AD9\u6A21\u5F0F\u300C\u5168\u5C40\u300D\u65F6\u5168\u90E8\u8D70\u8282\u70B9\u9009\u62E9";
      case "page":
        return "\u9875\u9762\u89C4\u5219";
      case "surge":
        return `Surge \u5BFC\u5165 \xB7 \u7B2C ${origin.index} \u6761`;
      case "surgeFinal":
        return "Surge \u7684 FINAL";
      case "china":
        return "\u5185\u7F6E\uFF1A\u4E2D\u56FD\u5927\u9646\u76F4\u8FDE";
      default:
        return "";
    }
  }
  function targetOf(values, titles) {
    const parts = [];
    for (const [key, list2] of values) {
      if (key === "ip_is_private") continue;
      const shown = list2.map((value) => key === "rule_set" ? titles.get(value) ?? value : value);
      parts.push(...shown);
    }
    if (parts.length === 0) return "\u2014";
    const head = parts.slice(0, 3).join(", ");
    const text = parts.length > 3 ? `${head} \u7B49 ${parts.length} \u9879` : head;
    return text.length > 200 ? text.slice(0, 200) : text;
  }
  function ruleRows(plan, hits, titles = /* @__PURE__ */ new Map()) {
    const counts = /* @__PURE__ */ new Map();
    for (const [text, count] of Object.entries(hits)) {
      const index = matchRule(plan, text);
      if (index === null) continue;
      counts.set(index, (counts.get(index) ?? 0) + count);
    }
    const rows = [];
    for (const [index, rule] of plan.rules.entries()) {
      const origin = plan.origins[index] ?? { kind: "plumbing" };
      const signature = signatureOf(rule);
      if (!signature || origin.kind === "plumbing") continue;
      const type = rule.type === "logical" ? String(rule.mode ?? "and").toUpperCase() : signature.keys.length === 0 ? "FINAL" : [...new Set(signature.keys.filter((key) => !(origin.kind === "lan" && key === "domain_suffix")).map((key) => typeTitles[key] ?? key.toUpperCase()))].join(" + ");
      rows.push({ id: rows.length + 1, type, target: targetOf(signature.values, titles), policy: policyColumn(signature.action), hits: counts.get(index) ?? 0, note: noteOf(origin) });
    }
    rows.push({
      id: rows.length + 1,
      type: "FINAL",
      target: "\u2014",
      policy: policyColumn(`route(${plan.final})`),
      hits: counts.get("final") ?? 0,
      note: plan.finalFromSurge ? "Surge \u7684 FINAL\uFF1A\u6CA1\u547D\u4E2D\u4EFB\u4F55\u89C4\u5219\u7684\u8FDE\u63A5" : `\u515C\u5E95\uFF1A\u6CA1\u547D\u4E2D\u4EFB\u4F55\u89C4\u5219\u7684\u8FDE\u63A5\u8D70${plan.final === SELECTOR_TAG ? "\u300C\u8282\u70B9\u9009\u62E9\u300D" : `\u300C${plan.final}\u300D`}`
    });
    return rows;
  }
  var maximumRuleHitKeys = 400;
  function countRuleHits(hits, startedAt, connections, seen) {
    const counts = hits && hits.startedAt === startedAt ? { ...hits.counts } : {};
    const present = /* @__PURE__ */ new Set();
    for (const connection of connections) {
      if (!connection.id) continue;
      present.add(connection.id);
      if (seen.has(connection.id) || !connection.rule) continue;
      seen.add(connection.id);
      counts[connection.rule] = (counts[connection.rule] ?? 0) + 1;
    }
    for (const id of [...seen]) if (!present.has(id)) seen.delete(id);
    const entries = Object.entries(counts);
    if (entries.length <= maximumRuleHitKeys) return { startedAt, counts };
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { startedAt, counts: Object.fromEntries(entries.slice(0, maximumRuleHitKeys)) };
  }

  // extensions/proxy/src/stats.ts
  var maximumKeys = 200;
  function localDay(now) {
    const date = new Date(now);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function emptyBuckets() {
    return { upload: new Array(24).fill(0), download: new Array(24).fill(0) };
  }
  function emptyDay(now) {
    return { day: localDay(now), all: emptyBuckets(), proxy: emptyBuckets(), processes: {}, domains: {}, policies: {}, updatedAt: now };
  }
  function restoreDay(raw, now) {
    if (typeof raw !== "object" || raw === null) return emptyDay(now);
    const value = raw;
    if (value.day !== localDay(now)) return emptyDay(now);
    const buckets = (input) => {
      const source = typeof input === "object" && input !== null ? input : {};
      const column = (list2) => Array.from({ length: 24 }, (_, hour) => {
        const number = Array.isArray(list2) ? list2[hour] : 0;
        return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : 0;
      });
      return { upload: column(source.upload), download: column(source.download) };
    };
    const usages = (input) => {
      const out = {};
      if (typeof input !== "object" || input === null) return out;
      for (const [key, usage] of Object.entries(input)) {
        if (typeof usage !== "object" || usage === null) continue;
        const item = usage;
        const number = (field) => typeof field === "number" && Number.isFinite(field) && field > 0 ? field : 0;
        out[key] = { upload: number(item.upload), download: number(item.download), connections: number(item.connections) };
      }
      return out;
    };
    return {
      day: value.day,
      all: buckets(value.all),
      proxy: buckets(value.proxy),
      processes: usages(value.processes),
      domains: usages(value.domains),
      policies: usages(value.policies),
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : now
    };
  }
  function processName(connection) {
    const name = connection.process.split("/").pop() ?? "";
    return name.length > 0 ? name : "\u672A\u77E5\u8FDB\u7A0B";
  }
  function domainOf(connection) {
    const host = connection.host;
    if (host.startsWith("[")) return host.slice(1, host.indexOf("]") > 0 ? host.indexOf("]") : void 0);
    const colon = host.lastIndexOf(":");
    const bare = colon > 0 && host.indexOf(":") === colon ? host.slice(0, colon) : host;
    return bare.length > 0 ? bare : "\uFF08\u6CA1\u6709\u4E3B\u673A\u540D\uFF09";
  }
  function connectionPolicy(connection) {
    return connection.chains[connection.chains.length - 1] ?? DIRECT_TAG;
  }
  function isProxied(connection) {
    const final = connection.chains[0];
    return final !== void 0 && final !== DIRECT_TAG;
  }
  function add(target, key, upload, download, isNew) {
    const usage = target[key] ?? { upload: 0, download: 0, connections: 0 };
    usage.upload += upload;
    usage.download += download;
    if (isNew) usage.connections += 1;
    target[key] = usage;
  }
  function trimUsages(usages, limit = maximumKeys) {
    const entries = Object.entries(usages);
    if (entries.length <= limit) return usages;
    entries.sort((a, b) => b[1].upload + b[1].download - (a[1].upload + a[1].download) || a[0].localeCompare(b[0]));
    return Object.fromEntries(entries.slice(0, limit));
  }
  function ingest(state, snapshot, now) {
    const day = localDay(now);
    const base = state.stats.day === day ? state.stats : emptyDay(now);
    const stats = {
      day,
      all: { upload: [...base.all.upload], download: [...base.all.download] },
      proxy: { upload: [...base.proxy.upload], download: [...base.proxy.download] },
      processes: { ...base.processes },
      domains: { ...base.domains },
      policies: { ...base.policies },
      updatedAt: now
    };
    for (const category of ["processes", "domains", "policies"]) {
      stats[category] = Object.fromEntries(Object.entries(stats[category]).map(([key, usage]) => [key, { ...usage }]));
    }
    const hour = new Date(now).getHours();
    const seen = /* @__PURE__ */ new Map();
    for (const connection of snapshot.connections) {
      if (!connection.id) continue;
      const previous = state.seen.get(connection.id);
      const upload = Math.max(0, connection.upload - (previous && connection.upload >= previous.upload ? previous.upload : 0));
      const download = Math.max(0, connection.download - (previous && connection.download >= previous.download ? previous.download : 0));
      seen.set(connection.id, { upload: connection.upload, download: connection.download });
      const isNew = previous === void 0;
      if (upload === 0 && download === 0 && !isNew) continue;
      stats.all.upload[hour] += upload;
      stats.all.download[hour] += download;
      if (isProxied(connection)) {
        stats.proxy.upload[hour] += upload;
        stats.proxy.download[hour] += download;
      }
      add(stats.processes, processName(connection), upload, download, isNew);
      add(stats.domains, domainOf(connection), upload, download, isNew);
      add(stats.policies, connectionPolicy(connection), upload, download, isNew);
    }
    stats.processes = trimUsages(stats.processes);
    stats.domains = trimUsages(stats.domains);
    stats.policies = trimUsages(stats.policies);
    return { stats, seen };
  }
  function topUsages(stats, category, limit = 10) {
    return Object.entries(stats[category]).sort((a, b) => b[1].upload + b[1].download - (a[1].upload + a[1].download) || a[0].localeCompare(b[0])).slice(0, limit);
  }
  function processRates(previous, current, seconds) {
    const before = new Map((previous?.connections ?? []).map((connection) => [connection.id, connection]));
    const rows = /* @__PURE__ */ new Map();
    const span = seconds > 0 ? seconds : 1;
    for (const connection of current.connections) {
      const name = processName(connection);
      const row = rows.get(name) ?? { name, connections: 0, upload: 0, download: 0 };
      row.connections += 1;
      const last = before.get(connection.id);
      if (last) {
        row.upload += Math.max(0, connection.upload - last.upload) / span;
        row.download += Math.max(0, connection.download - last.download) / span;
      }
      rows.set(name, row);
    }
    return [...rows.values()].sort((a, b) => b.upload + b.download - (a.upload + a.download) || b.connections - a.connections || a.name.localeCompare(b.name));
  }

  // extensions/proxy/src/background.ts
  var scheduleTickMs = 3e4;
  var speedTickMs = 1e3;
  var outputRefreshMs = 2e3;
  var historyLength = 60;
  var statsSaveMs = 6e4;
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
          busy: extra.busy,
          kernel: snapshot.kernel,
          tun: snapshot.tun,
          groups: snapshot.groups,
          page: extra.page ?? null,
          pageRules: snapshot.pageRules,
          recent: extra.recent ?? [],
          reading: extra.reading ?? null,
          history: extra.history ?? null,
          titleRate: extra.titleRate ?? null
        })
      );
    } catch (error) {
      jarvis.log.debug("\u83DC\u5355\u680F\u6A21\u578B\u6CA1\u63A8\u4E0A", errorMessage2(error));
    }
  }
  function seenConnections(attempts) {
    return attempts.map((attempt) => ({ host: attempt.host, process: attempt.process, at: attempt.startedAt, chains: attempt.chains, failed: attempt.outcome === "failed" }));
  }
  function orbCaption(snapshot, autoPick) {
    const node = snapshot.selection.node === URLTEST_TAG && autoPick ? `${URLTEST_TAG} \xB7 ${autoPick}` : snapshot.selection.node;
    const text = snapshot.kernel === "tunnel" ? `\u589E\u5F3A\u6A21\u5F0F \xB7 ${node}` : node;
    return text.length <= 40 ? text : text.slice(0, 40);
  }
  var Background = class {
    constructor() {
      this.core = new ProxyCore(() => void this.refresh());
      this.meter = new TrafficMeter();
      this.context = null;
      this.unobserveDaemon = null;
      this.unobserveTunnel = null;
      this.scheduleRunning = false;
      this.speedRunning = false;
      this.autoStarted = false;
      this.lastSnapshot = null;
      this.autoPick = null;
      this.rate = null;
      this.reading = null;
      this.history = { upload: [], download: [] };
      this.page = null;
      this.lastSample = null;
      this.lastOutputRefresh = 0;
      this.orbShown = false;
      this.refreshing = null;
      this.refreshAgain = false;
      /** 菜单栏两行此刻写的那一份（W-2）；还没攒满第一段为 `null`。 */
      this.titleRate = null;
      /** 这一段里攒下的有效速率：凑满 `speedInterval` 个点取平均，换一次标题。 */
      this.titleWindow = { upload: 0, download: 0, count: 0 };
      this.unwatchPreferences = null;
      /** 今天的流量统计（P-3）；这个会话还没读过存储为 `null`。 */
      this.stats = null;
      /** 本次开启以来的规则命中（P-3）。 */
      this.hits = null;
      /** 已经记过命中的连接 id。 */
      this.hitSeen = /* @__PURE__ */ new Set();
      this.lastStatsSave = 0;
    }
    extras() {
      return {
        autoPick: this.autoPick,
        rate: this.rate,
        busy: this.core.busy,
        reading: this.reading,
        history: this.history,
        titleRate: this.titleRate,
        page: this.page,
        recent: this.meter.recent(Date.now(), 12)
      };
    }
    /**
     * 菜单栏 `start`：推第一份模型、订内核事件、按偏好自动开启、起自动更新与流量两条循环。
     * @param context 授权与偏好。
     */
    async start(context) {
      this.context = context;
      this.observe(context.granted);
      if (!this.unwatchPreferences) this.unwatchPreferences = jarvis.preferences.onChange((changes) => void this.onPreferencesChanged(changes));
      await this.core.migrateTunSelection();
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
     * 菜单栏 `open`：重读状态与「当前页面」；开着、延迟又是 5 分钟以前测的，顺手在后台测一遍（菜单开着时宿主就地更新读数）。
     * @param context 授权与偏好。
     */
    async open(context) {
      this.context = context;
      this.observe(context.granted);
      this.page = await this.core.currentPage(context.granted, seenConnections(this.meter.recent(Date.now(), 2e3)));
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
          if (snapshot.phase === "running") await this.core.turnOff();
          else await this.report(await this.core.turnOn(context), false);
          break;
        case "systemProxy": {
          const active = snapshot.proxy?.owner === "self";
          await this.report(await this.core.setSystemProxy(!active), false);
          break;
        }
        case "tun": {
          const on = snapshot.phase === "running" ? snapshot.kernel !== "tunnel" : !snapshot.tun.wanted;
          await this.report(await this.core.setTun(on), snapshot.phase !== "running");
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
        case "group": {
          const group = snapshot.groups[action.group];
          const member = group?.members[action.member];
          if (group && member) await this.report(await this.core.selectGroupMember(group, member.tag), false);
          break;
        }
        case "page": {
          const domain = this.page?.domains[action.domain]?.domain;
          if (domain) await this.report(await this.core.setPageRule(domain, menuPolicyRef(action.policy, snapshot.groups)), true);
          break;
        }
        case "recent": {
          const attempt = this.meter.recent(Date.now(), 12)[action.request];
          if (attempt) await this.report(await this.core.setPageRule(registrableDomain(attempt.host), menuPolicyRef(action.policy, snapshot.groups)), true);
          break;
        }
        case "test":
          await this.core.testLatency();
          break;
        case "update":
          await this.report(await this.core.updateAll(context.granted), true);
          break;
        case "reload":
          await this.report(await this.core.reload(), true);
          break;
        case "import":
          await this.runCommand("import-surge");
          break;
        case "rules":
          await this.runCommand("rules");
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
    async runCommand(id) {
      try {
        await jarvis.commands.run(id);
      } catch (error) {
        jarvis.log.warn(`\u547D\u4EE4 ${id} \u6CA1\u8DD1\u8D77\u6765`, errorMessage2(error));
      }
    }
    /**
     * `/proxy`：不带参数切换，`开` / `关` 指定，`tun` / `系统代理` 换模式。静默命令只能用横幅交结果。
     * @param context 指令上下文。
     */
    async command(context) {
      this.observe(context.granted);
      const intent = parseToggleArgument(context.argument);
      let result;
      if (intent === null) {
        result = { ok: false, message: `\u8BA4\u4E0D\u51FA\u300C${context.argument ?? ""}\u300D\uFF1A\u7528 /proxy \u5207\u6362\uFF0C/proxy \u5F00\u3001/proxy \u5173\u3001/proxy tun\u3001/proxy \u7CFB\u7EDF\u4EE3\u7406` };
      } else if (intent === "tun" || intent === "notun") {
        result = await this.core.setTun(intent === "tun");
        if (result.ok && !result.message) result = { ok: true, message: intent === "tun" ? "\u5DF2\u6362\u6210\u589E\u5F3A\u6A21\u5F0F" : "\u5DF2\u6362\u6210\u7CFB\u7EDF\u4EE3\u7406\u6A21\u5F0F" };
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
    /**
     * 偏好变了（设置页、或某个会话经 `preferences.set` 写的）：菜单与读数按新偏好重推。
     * 「增强模式」被设置页改了、代理开着、内核与它不符 → 在这里换内核（W-6：设置页与工具箱同一份真源，改哪边都当场生效）。
     * 自己人写的那一次（`tunSwitch` 30 秒内、值相同）由写的那一方换，这里不再换一次。后台会话常驻，换内核只在这一处。
     * @param changes 变了的几项。
     */
    async onPreferencesChanged(changes) {
      if (this.context) this.context = { ...this.context, preferences: { ...this.context.preferences, ...changes } };
      if ("speedInterval" in changes) this.titleWindow = { upload: 0, download: 0, count: 0 };
      if (typeof changes.tun === "boolean") {
        let echo = false;
        try {
          echo = isTunSwitchEcho(await jarvis.storage.get(storageKeys.tunSwitch), changes.tun, Date.now());
        } catch {
          echo = false;
        }
        if (!echo) await this.report(await this.core.applyTun(changes.tun), false);
      }
      await this.refresh();
      void this.speedLoop();
    }
    /** 菜单里的动作只在失败（或订阅更新这种要交代结果的）时发横幅：成功的开关菜单图标自己就说明了。 */
    async report(result, always) {
      if (!result.ok || always && result.message) await this.notify(result.ok ? "\u4EE3\u7406" : "\u4EE3\u7406\u6CA1\u80FD\u5B8C\u6210", result.message);
    }
    async notify(title, body, granted) {
      const list2 = granted ?? this.context?.granted ?? await this.core.granted();
      if (!list2.includes("notifications.post") || body.length === 0) return;
      try {
        await jarvis.notifications.post({ title, body: body.slice(0, 200) });
      } catch (error) {
        jarvis.log.warn("\u6A2A\u5E45\u6CA1\u53D1\u51FA\u53BB", errorMessage2(error));
      }
    }
    /**
     * 订两个内核的输出与退出。各只订一次；没授权时宿主会拒（SDK 只记一条 warn），所以授权了才订。
     * @param granted 已授予的能力。
     */
    observe(granted) {
      if (!this.unobserveDaemon && granted.includes(requiredCapability)) {
        this.unobserveDaemon = jarvis.daemon.observe("sing-box", (event) => void this.onKernelEvent(event));
      }
      if (!this.unobserveTunnel && granted.includes(tunnelCapability)) {
        this.unobserveTunnel = jarvis.tunnel.observe((event) => void this.onKernelEvent(event));
      }
    }
    async onKernelEvent(event) {
      if (event.kind === "output") {
        this.meter.ingestLines(event.lines, Date.now());
        if (Date.now() - this.lastOutputRefresh >= outputRefreshMs) {
          this.lastOutputRefresh = Date.now();
          if (this.lastSnapshot?.phase !== "running") await this.refresh();
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
      this.resetTraffic();
      await this.refresh();
    }
    resetTraffic() {
      this.meter.reset();
      this.rate = null;
      this.reading = null;
      this.lastSample = null;
      this.history = { upload: [], download: [] };
      this.titleRate = null;
      this.titleWindow = { upload: 0, download: 0, count: 0 };
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
              if (snapshot.phase !== "running") {
                this.resetTraffic();
                await this.pushOrb(null);
              }
              await pushMenu(snapshot, this.extras());
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
    /**
     * 推悬浮球那一层。撤掉（`null`）只推一次：没在显示时不必每次刷新都撤一遍。
     * @param reading 读数；`null` 撤掉。
     */
    async pushOrb(reading) {
      if (reading === null && !this.orbShown) return;
      try {
        if (reading === null) await jarvis.orb.update(null);
        else {
          await jarvis.orb.update({
            kind: "traffic",
            upload: Math.round(reading.upload),
            download: Math.round(reading.download),
            succeeded: reading.succeeded,
            failed: reading.failed,
            ...this.lastSnapshot ? { caption: orbCaption(this.lastSnapshot, this.autoPick) } : {}
          });
        }
        this.orbShown = reading !== null;
      } catch (error) {
        jarvis.log.debug("\u60AC\u6D6E\u7403\u90A3\u4E00\u5C42\u6CA1\u63A8\u4E0A", errorMessage2(error));
        this.orbShown = false;
      }
    }
    /** 订阅与外部规则集自动更新：每 30 秒看一次日程，到点就拉；节点或规则真的变了且开着，会自己重新载入。 */
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
            await this.core.updateAll(granted);
            await this.refresh();
          } catch (error) {
            jarvis.log.warn("\u8BA2\u9605\u81EA\u52A8\u66F4\u65B0\u51FA\u9519", errorMessage2(error));
          }
        }
      } finally {
        this.scheduleRunning = false;
      }
    }
    /**
     * 攒一个点进这一段；凑满 `speedInterval` 个就取平均、换标题（W-2）。间隔 1 秒时每个点都换，与上一版相同。
     * @param effective 这一秒的有效速率。
     */
    accumulateTitle(effective) {
      const interval = this.lastSnapshot?.preferences.speedInterval ?? 1;
      this.titleWindow = {
        upload: this.titleWindow.upload + effective.upload,
        download: this.titleWindow.download + effective.download,
        count: this.titleWindow.count + 1
      };
      const next = titleAverage(this.titleWindow, interval);
      if (next) {
        this.titleRate = next;
        this.titleWindow = { upload: 0, download: 0, count: 0 };
      } else if (!this.titleRate) {
        this.titleRate = { upload: effective.upload, download: effective.download };
      }
    }
    /**
     * 流量：开着时每秒读一次连接快照——喂给成败统计（拿到回包的判成功）、算有效速率，推悬浮球与菜单（两行速率、曲线）。
     * 条件不成立（关了）就退出循环并撤掉悬浮球那一层。
     */
    async speedLoop() {
      if (this.speedRunning) return;
      const wanted = () => this.lastSnapshot?.phase === "running";
      if (!wanted()) return;
      this.speedRunning = true;
      try {
        while (wanted()) {
          await sleep(speedTickMs);
          const snapshot = await this.core.connections();
          if (!snapshot) continue;
          const now = Date.now();
          const sample = { at: now, upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
          this.rate = trafficRate(this.lastSample, sample) ?? this.rate;
          this.lastSample = sample;
          await this.recordStats(snapshot, now);
          const effective = this.meter.ingestSnapshot(snapshot, now);
          if (effective) {
            this.history.upload = [...this.history.upload, effective.upload].slice(-historyLength);
            this.history.download = [...this.history.download, effective.download].slice(-historyLength);
            this.accumulateTitle(effective);
          }
          this.reading = this.meter.reading(now);
          await this.pushOrb(this.reading);
          if (this.lastSnapshot) await pushMenu(this.lastSnapshot, this.extras());
        }
      } finally {
        this.speedRunning = false;
        this.resetTraffic();
        await this.pushOrb(null);
        if (this.stats) {
          await this.saveStats(Date.now());
          this.stats = { stats: this.stats.stats, seen: /* @__PURE__ */ new Map() };
        }
        this.hitSeen.clear();
      }
    }
    /**
     * 记一份连接快照进今天的统计与规则命中（P-3），每分钟落一次存储。
     *
     * 这个会话第一次记的那一份只用来认下「此刻已有的连接各走到多少字节了」、不记账：后台会话被回收过又起来时，
     * 那些长连接之前的字节已经记过一次，再记就翻倍——代价是会话刚起来那一秒的新连接少记一点。
     * @param snapshot 快照。
     * @param now 此刻。
     */
    async recordStats(snapshot, now) {
      const startedAt = this.lastSnapshot?.control?.startedAt ?? 0;
      if (!this.stats) {
        let stored;
        let storedHits;
        try {
          [stored, storedHits] = await Promise.all([jarvis.storage.get(storageKeys.statsToday), jarvis.storage.get(storageKeys.ruleHits)]);
        } catch {
          stored = void 0;
        }
        const seen = new Map(snapshot.connections.map((connection) => [connection.id, { upload: connection.upload, download: connection.download }]));
        this.stats = { stats: restoreDay(stored, now), seen };
        const hits = storedHits;
        this.hits = hits && typeof hits.startedAt === "number" && typeof hits.counts === "object" && hits.counts !== null ? { startedAt: hits.startedAt, counts: { ...hits.counts } } : null;
        for (const connection of snapshot.connections) if (connection.id) this.hitSeen.add(connection.id);
        this.hits = countRuleHits(this.hits, startedAt, snapshot.connections, this.hitSeen);
        this.lastStatsSave = now;
        return;
      }
      this.stats = ingest(this.stats, snapshot, now);
      this.hits = countRuleHits(this.hits, startedAt, snapshot.connections, this.hitSeen);
      if (now - this.lastStatsSave >= statsSaveMs) await this.saveStats(now);
    }
    /** 把今天的统计与规则命中写进存储；写不进去只记一条（下一分钟再试）。 */
    async saveStats(now) {
      this.lastStatsSave = now;
      try {
        if (this.stats) await jarvis.storage.set(storageKeys.statsToday, this.stats.stats);
        if (this.hits) await jarvis.storage.set(storageKeys.ruleHits, this.hits);
      } catch (error) {
        jarvis.log.warn("\u6D41\u91CF\u7EDF\u8BA1\u6CA1\u5B58\u4E0A", errorMessage2(error));
      }
    }
  };

  // extensions/proxy/src/dashboard.ts
  var sidebarItems = [
    { value: "activity", title: "\u6D3B\u52A8", symbol: "waveform.path.ecg" },
    { value: "processes", title: "\u8FDB\u7A0B", symbol: "cpu" },
    { value: "policies", title: "\u7B56\u7565", symbol: "point.3.connected.trianglepath.dotted" },
    { value: "rules", title: "\u89C4\u5219", symbol: "list.bullet.rectangle" }
  ];
  var dashboardModeTitles = { direct: "\u76F4\u63A5\u8FDE\u63A5", global: "\u5168\u5C40\u4EE3\u7406", rule: "\u89C4\u5219\u5224\u5B9A" };
  var maximumCards = 120;
  var subtitleLimit = 120;
  var connectionRows = 200;
  var processRows = 300;
  var ruleTableRows = 300;
  var logPanelRows = 200;
  var hourLabels = Array.from({ length: 24 }, (_, hour) => String(hour));
  var idleCurve = new Array(60).fill(0);
  function renderDashboard(session2, snapshot, loading) {
    const page = snapshot ? pageOf(session2, snapshot) : loading ?? ui.scroll({ children: [] });
    return layout.sidebar({
      key: "dashboard",
      label: "\u4EE3\u7406",
      value: session2.view,
      items: sidebarItems.map((item) => ({ ...item })),
      onChange: (value) => void session2.showView(value),
      children: [page]
    });
  }
  function pageOf(session2, snapshot) {
    switch (session2.view) {
      case "processes":
        return ui.stack({ key: "page:processes", spacing: "loose", children: processesPage(session2, snapshot) });
      case "policies":
        return ui.scroll({ key: "page:policies", children: policiesPage(session2, snapshot) });
      case "rules":
        return ui.scroll({ key: "page:rules", children: rulesPage(session2, snapshot) });
      default:
        return ui.scroll({ key: "page:activity", children: activityPage(session2, snapshot) });
    }
  }
  function clip(text, limit = subtitleLimit) {
    return text.length <= limit ? text : `${text.slice(0, limit - 1)}\u2026`;
  }
  function pageHeader(session2, key, title, status, controls = []) {
    const message = session2.headerMessage(Date.now());
    const line = message ? { text: message.message, tint: message.ok ? "live" : "alert" } : status;
    return layout.header({ key, title, subtitle: clip(line.text), ...line.tint ? { tint: line.tint } : {}, children: controls });
  }
  function asPanel(node, title) {
    if (node.kind !== "section") return node;
    return { ...node, title: title ?? node.title.replace(/ · [A-Z][A-Z0-9 -]*$/, "") };
  }
  function proxyStatus(snapshot) {
    switch (snapshot.phase) {
      case "running": {
        const port = snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort;
        const parts = ["\u5DF2\u5F00\u542F", `127.0.0.1:${port}`, dashboardModeTitles[snapshot.selection.mode]];
        if (snapshot.kernel === "tunnel") parts.push("\u589E\u5F3A\u6A21\u5F0F");
        return { text: parts.join(" \xB7 "), tint: "live" };
      }
      case "failed":
        return { text: "\u6CA1\u5F00\u8D77\u6765\uFF1A\u770B\u300C\u8FDB\u7A0B\u300D\u9875\u7684\u65E5\u5FD7", tint: "alert" };
      case "notGranted":
        return { text: "\u8FD8\u6CA1\u6709\u6388\u6743", tint: "alert" };
      case "notInstalled":
        return { text: "\u6CA1\u6709\u627E\u5230 sing-box", tint: "alert" };
      case "noNodes":
        return { text: "\u8FD8\u6CA1\u6709\u8282\u70B9\uFF1A\u5728\u300C\u7B56\u7565\u300D\u9875\u4E0B\u9762\u586B\u8BA2\u9605\u5730\u5740", tint: "alert" };
      default:
        return { text: `\u5DF2\u5173\u95ED \xB7 ${dashboardModeTitles[snapshot.selection.mode]}`, tint: "neutral" };
    }
  }
  function networkText(network) {
    if (!network) return "\u2014";
    if (network.kind === "none") return "\u6CA1\u6709\u7F51\u7EDC";
    return `${network.name} \xB7 ${network.interface}`;
  }
  function profileText(snapshot) {
    if (snapshot.surge && snapshot.preferences.useSurgeRules) return `Surge \xB7 ${snapshot.surge.sourceName}`;
    if (snapshot.subscriptions.length === 0) return snapshot.subscriptionCount > 0 ? "\u8BA2\u9605\u8FD8\u6CA1\u62C9\u8FC7" : "\u8FD8\u6CA1\u6709\u8BA2\u9605";
    const hosts = snapshot.subscriptions.map((record) => record.host);
    const head = hosts.length > 2 ? `${hosts.slice(0, 2).join("\u3001")} \u7B49 ${hosts.length} \u4E2A` : hosts.join("\u3001");
    return `${head} \xB7 ${snapshot.nodes.length} \u4E2A\u8282\u70B9`;
  }
  function activityPage(session2, snapshot) {
    const running = snapshot.phase === "running";
    const busy = session2.core.busy !== null;
    const condition = systemProxyCondition(snapshot.proxy, snapshot.granted);
    const tunActive = snapshot.kernel === "tunnel";
    const canStart = snapshot.phase === "stopped" || snapshot.phase === "failed";
    const children = [
      pageHeader(session2, "activity-header", "\u6D3B\u52A8", busy ? { text: session2.core.busy ?? "", tint: "accent" } : proxyStatus(snapshot), [
        ui.toggle({
          key: "activity-system-proxy",
          title: "\u7CFB\u7EDF\u4EE3\u7406",
          subtitle: running ? condition.kind === "active" ? `127.0.0.1:${snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort}` : condition.kind === "off" ? "\u6CA1\u6709\u63A5\u7BA1" : condition.kind === "notGranted" ? "\u6CA1\u6709\u6388\u6743" : "\u88AB\u62E6\u7740" : "\u4EE3\u7406\u5173\u7740\uFF1A\u6253\u5F00\u5B83 = \u5F00\u542F\u4EE3\u7406",
          value: running && condition.kind === "active",
          disabled: busy || condition.kind === "notGranted" || !running && !canStart,
          onChange: (on) => void session2.activitySystemProxy(on)
        }),
        ui.toggle({
          key: "activity-tun",
          title: "\u589E\u5F3A\u6A21\u5F0F",
          subtitle: running ? tunActive ? "\u6574\u673A\u7F51\u7EDC\u7ECF\u8FC7 sing-box" : "\u6CA1\u6709\u63A5\u7BA1" : tunSubtitle({ ...snapshot.tun, active: false }) ?? (snapshot.tun.wanted ? "\u5F00\u542F\u4EE3\u7406\u65F6\u7528" : "\u4EE3\u7406\u5173\u7740"),
          value: running ? tunActive : wantsTunnel(snapshot.preferences),
          disabled: busy || !snapshot.tun.granted || snapshot.phase === "notInstalled" || snapshot.phase === "notGranted",
          onChange: (on) => void session2.activityTun(on)
        }),
        ui.iconButton({
          key: "activity-power",
          symbol: "power",
          label: running ? "\u5173\u95ED\u4EE3\u7406" : "\u5F00\u542F\u4EE3\u7406",
          active: running,
          disabled: busy || !(running || canStart),
          onPress: () => void session2.toggle(!running)
        })
      ])
    ];
    children.push(...notes(session2, snapshot));
    children.push(factsStrip(session2, snapshot), layout.grid({ key: "activity-cards", minimum: 180, spacing: "regular", children: activityCards(session2, snapshot) }));
    children.push(layout.grid({ key: "activity-panels", minimum: 420, spacing: "regular", fill: true, children: [trafficSection(session2), topSection(session2)] }));
    return children;
  }
  function factsStrip(session2, snapshot) {
    const running = snapshot.phase === "running";
    const ip = session2.externalIP?.ip ?? null;
    const fact = (key, label, value, tint, extra = []) => {
      const valueText = ui.text({ key: `${key}:value`, style: "body", text: value, lines: 1, ...tint ? { tint } : {} });
      return ui.stack({
        key,
        spacing: "tight",
        children: [
          ui.text({ key: `${key}:label`, style: "footnote", text: label }),
          extra.length > 0 ? ui.stack({ key: `${key}:line`, axis: "horizontal", spacing: "tight", alignment: "center", children: [valueText, ...extra] }) : valueText
        ]
      });
    };
    return ui.card({
      key: "activity-facts",
      children: [
        layout.grid({
          key: "activity-facts-grid",
          minimum: 160,
          spacing: "loose",
          children: [
            fact("fact-network", "\u7F51\u7EDC", networkText(session2.network)),
            fact("fact-profile", "\u5F53\u524D\u914D\u7F6E", profileText(snapshot)),
            fact("fact-mode", "\u51FA\u7AD9\u6A21\u5F0F", dashboardModeTitles[snapshot.selection.mode], running ? "live" : void 0),
            fact("fact-ip", "\u5916\u90E8 IP", ip ?? "\u2014", void 0, ip ? [ui.copy({ key: "fact-ip:copy", text: ip, label: "\u590D\u5236\u5916\u90E8 IP", variant: "icon" })] : [])
          ]
        })
      ]
    });
  }
  function activityCards(session2, snapshot) {
    const running = snapshot.phase === "running";
    const delay = session2.internetDelay;
    const delayTintValue = delay === void 0 ? "neutral" : delay === null ? "danger" : delay < 150 ? "live" : delay < 400 ? "amber" : "alert";
    const latest = (values) => values.length > 0 ? values[values.length - 1] : 0;
    const upload = session2.reading?.upload ?? latest(session2.history.upload);
    const download = session2.reading?.download ?? latest(session2.history.download);
    const card = (key, title, value, tint, footer) => ui.card({
      key,
      children: [ui.text({ key: `${key}:title`, style: "footnote", text: title }), ui.text({ key: `${key}:value`, style: "metric", tint, text: value, lines: 1 }), ui.spacer(), footer]
    });
    const caption = (key, text) => ui.text({ key, style: "footnote", text, lines: 1 });
    const chart = (key, tone, values) => {
      const live = running && values.length > 1;
      const what = tone === "upload" ? "\u4E0A\u884C" : "\u4E0B\u884C";
      return ui.chart({ key, series: [{ tone, values: live ? values.slice(-120) : idleCurve }], label: live ? `\u6700\u8FD1\u4E00\u5206\u949F\u7684${what}` : `\u4EE3\u7406\u5173\u7740\uFF0C\u6CA1\u6709${what}` });
    };
    const processCount = new Set((session2.connections?.connections ?? []).map((connection) => processName2(connection.process))).size;
    return [
      card("card-latency", "Internet \u5EF6\u8FDF", running ? delay === void 0 ? "\u6D4B\u91CF\u4E2D" : delay === null ? "\u4E0D\u901A" : `${delay} ms` : "\u2014", running ? delayTintValue : "neutral", caption("card-latency:caption", running ? "\u7ECF\u8FC7\u8282\u70B9\u8BBF\u95EE apple.com\uFF0C\u6BCF 30 \u79D2\u6D4B\u4E00\u6B21" : "\u4EE3\u7406\u5F00\u7740\u65F6\u6D4B")),
      card("card-connections", "\u6D3B\u52A8\u8FDE\u63A5", running && session2.connections ? String(session2.connections.connections.length) : "\u2014", running ? "accent" : "neutral", caption("card-connections:caption", running && session2.connections ? `${processCount} \u4E2A\u7A0B\u5E8F` : "\u4EE3\u7406\u5F00\u7740\u65F6\u6570")),
      card("card-upload", "\u4E0A\u884C", running ? formatRate(upload) : "\u2014", running ? "amber" : "neutral", chart("card-upload:chart", "upload", session2.history.upload)),
      card("card-download", "\u4E0B\u884C", running ? formatRate(download) : "\u2014", running ? "blue" : "neutral", chart("card-download:chart", "download", session2.history.download))
    ];
  }
  function trafficSection(session2) {
    const stats = session2.stats;
    const buckets = stats ? session2.trafficScope === "proxy" ? stats.proxy : stats.all : null;
    const sum = (values) => values.reduce((total, value) => total + value, 0);
    const caption = buckets ? `\u4ECA\u5929${session2.trafficScope === "proxy" ? "\u7ECF\u8FC7\u8282\u70B9" : "\u4E00\u5171"} \u2193 ${formatBytes(sum(buckets.download))}  \u2191 ${formatBytes(sum(buckets.upload))}` : "\u8FD8\u6CA1\u6709\u7EDF\u8BA1";
    return ui.section({
      key: "traffic",
      title: "\u4ECA\u65E5\u6D41\u91CF",
      trailing: stats ? `\u66F4\u65B0\u4E8E${formatAge(stats.updatedAt, Date.now())}` : void 0,
      segments: [
        { value: "all", title: "\u5168\u90E8" },
        { value: "proxy", title: "\u4EC5\u4EE3\u7406", help: "\u53EA\u7B97\u51FA\u7AD9\u4E0D\u662F\u76F4\u8FDE\u7684\u8FDE\u63A5" }
      ],
      segment: session2.trafficScope,
      segmentLabel: "\u6D41\u91CF\u770B\u54EA\u4E00\u4EFD",
      onSegment: (value) => session2.setTrafficScope(value),
      children: [
        layout.bars({
          key: "traffic-hours",
          labels: hourLabels,
          series: [
            { tone: "download", values: buckets ? buckets.download.slice(0, 24) : new Array(24).fill(0) },
            { tone: "upload", values: buckets ? buckets.upload.slice(0, 24) : new Array(24).fill(0) }
          ],
          caption,
          label: `\u4ECA\u5929\u6BCF\u5C0F\u65F6\u7684\u6D41\u91CF\uFF0C${caption}`
        })
      ]
    });
  }
  function policyName(tag) {
    return tag === DIRECT_TAG ? "\u76F4\u8FDE" : tag;
  }
  function topSection(session2) {
    const stats = session2.stats;
    const category = session2.topCategory;
    const rows = stats ? topUsages(stats, category, 10) : [];
    return ui.section({
      key: "top",
      title: "Top 10 \xB7 \u4ECA\u5929",
      segments: [
        { value: "processes", title: "\u8FDB\u7A0B" },
        { value: "domains", title: "\u57DF\u540D" },
        { value: "policies", title: "\u7B56\u7565" }
      ],
      segment: category,
      segmentLabel: "Top 10 \u770B\u54EA\u4E00\u7C7B",
      onSegment: (value) => session2.setTopCategory(value),
      children: [
        layout.table({
          key: `top-table:${category}`,
          label: "\u4ECA\u5929\u6D41\u91CF\u6700\u591A\u7684\u5341\u4E2A",
          columns: [
            { title: category === "processes" ? "\u8FDB\u7A0B\u4E0E\u8BBE\u5907" : category === "domains" ? "\u57DF\u540D" : "\u7B56\u7565", width: "fill" },
            { title: "\u8FDE\u63A5", width: "narrow", alignment: "trailing" },
            { title: "\u2191", width: "narrow", alignment: "trailing" },
            { title: "\u2193", width: "narrow", alignment: "trailing" },
            { title: "\u5408\u8BA1", width: "narrow", alignment: "trailing" }
          ],
          rows: rows.map(([name, usage]) => ({
            cells: [category === "policies" ? policyName(name) : name, String(usage.connections), formatBytes(usage.upload), formatBytes(usage.download), formatBytes(usage.upload + usage.download)]
          })),
          // 跟着面板长（第二轮 R-5）：那一行撑满时表也撑满，空着时提示在正中。
          scroll: true,
          emptyText: "\u4EE3\u7406\u5F00\u7740\u65F6\u540E\u53F0\u4F1A\u8BB0\u4ECA\u5929\u7684\u6D41\u91CF\uFF0C\u6BCF\u5206\u949F\u66F4\u65B0\u4E00\u6B21"
        })
      ]
    });
  }
  function processName2(path) {
    return path.split("/").pop() || "\u2014";
  }
  function processesPage(session2, snapshot) {
    const running = snapshot.phase === "running";
    const query = session2.processFilter.trim().toLowerCase();
    const data = session2.connections;
    const all = data ? [...data.connections].sort((a, b) => b.start - a.start) : [];
    const matches = (connection) => !query || connection.host.toLowerCase().includes(query) || processName2(connection.process).toLowerCase().includes(query);
    const matchedProcesses = new Set(all.filter(matches).map((connection) => processName2(connection.process)));
    const processes = session2.processes.filter((row) => !query || row.name.toLowerCase().includes(query) || matchedProcesses.has(row.name)).slice(0, processRows);
    const selected = session2.processSelection;
    const connections = all.filter((connection) => matches(connection) && (selected === null || processName2(connection.process) === selected)).slice(0, connectionRows);
    const download = session2.processes.reduce((total, row) => total + row.download, 0);
    const upload = session2.processes.reduce((total, row) => total + row.upload, 0);
    const status = running && data ? { text: `${session2.processes.length} \u4E2A\u7A0B\u5E8F \xB7 ${data.connections.length} \u6761\u8FDE\u63A5 \xB7 \u2193 ${formatRate(download)}  \u2191 ${formatRate(upload)}`, tint: "live" } : proxyStatus(snapshot);
    const children = [
      pageHeader(session2, "processes-header", "\u8FDB\u7A0B", status, [
        ui.search({ key: "process-search", value: session2.processFilter, placeholder: "\u641C\u7D22\u7A0B\u5E8F\u6216\u4E3B\u673A", label: "\u641C\u7D22\u7A0B\u5E8F\u6216\u4E3B\u673A", onChange: (value) => session2.searchProcesses(value) })
      ])
    ];
    const failures = failuresSection(session2);
    if (failures) children.push(asPanel(failures));
    children.push(
      layout.grid({
        key: "processes-split",
        minimum: 360,
        spacing: "regular",
        weights: [2, 3],
        fill: true,
        children: [
          ui.section({
            key: "processes",
            title: "\u7A0B\u5E8F",
            trailing: query ? `${processes.length} / ${session2.processes.length}` : `${session2.processes.length} \u4E2A`,
            children: [
              layout.table({
                key: "process-table",
                label: "\u6BCF\u4E2A\u7A0B\u5E8F\u6B64\u523B\u7684\u901F\u7387",
                scroll: true,
                ...selected !== null ? { selection: selected } : {},
                onSelect: (name) => session2.selectProcess(name),
                columns: [
                  { title: "\u7A0B\u5E8F", width: "fill" },
                  { title: "\u8FDE\u63A5", width: "narrow", alignment: "trailing" },
                  { title: "\u2193", width: "narrow", alignment: "trailing" },
                  { title: "\u2191", width: "narrow", alignment: "trailing" }
                ],
                rows: processes.map((row) => ({
                  id: row.name,
                  cells: [row.name, String(row.connections), formatRate(row.download), formatRate(row.upload)],
                  ...row.upload + row.download === 0 ? { tint: "neutral" } : {}
                })),
                emptyText: running ? query ? "\u6CA1\u6709\u5BF9\u5F97\u4E0A\u7684\u7A0B\u5E8F" : "\u6B64\u523B\u6CA1\u6709\u8FDE\u63A5" : "\u4EE3\u7406\u6CA1\u5F00"
              })
            ]
          }),
          connectionsSection(session2, snapshot, connections, selected)
        ]
      }),
      logsPanel(session2)
    );
    return children;
  }
  function connectionsSection(session2, snapshot, list2, selected) {
    const data = session2.connections;
    const download = list2.reduce((total, connection) => total + connection.download, 0);
    const upload = list2.reduce((total, connection) => total + connection.upload, 0);
    const chain = (chains) => chains.length > 0 ? [...chains].reverse().map(policyName).join(" \u2192 ") : "\u2014";
    return ui.section({
      key: "connections-section",
      title: selected === null ? "\u8FDE\u63A5 \xB7 \u5168\u90E8\u7A0B\u5E8F" : `\u8FDE\u63A5 \xB7 ${selected}`,
      ...data ? { trailing: `${list2.length} \u6761 \xB7 \u2193 ${formatBytes(download)}  \u2191 ${formatBytes(upload)}` } : {},
      actions: selected !== null ? [{ id: "show-all", title: "\u5168\u90E8\u7A0B\u5E8F", symbol: "xmark.circle", help: "\u56DE\u5230\u5168\u90E8\u7A0B\u5E8F\u7684\u8FDE\u63A5", onPress: () => session2.selectProcess(selected) }] : [],
      children: [
        layout.table({
          key: "connections",
          label: "\u6B64\u523B\u7684\u8FDE\u63A5",
          scroll: true,
          // 全部程序时第二列是程序；选了一个程序时程序是废话，换成规则。
          columns: [{ title: "\u4E3B\u673A", width: "fill" }, { title: selected === null ? "\u7A0B\u5E8F" : "\u89C4\u5219" }, { title: "\u7B56\u7565" }, { title: "\u2193", width: "narrow", alignment: "trailing" }, { title: "\u2191", width: "narrow", alignment: "trailing" }],
          rows: list2.map((connection) => ({
            cells: [connection.host || "\uFF08\u6CA1\u6709\u4E3B\u673A\u540D\uFF09", selected === null ? processName2(connection.process) : connection.rule || "\u2014", chain(connection.chains), formatBytes(connection.download), formatBytes(connection.upload)]
          })),
          emptyText: snapshot.phase === "running" ? selected === null ? "\u6B64\u523B\u6CA1\u6709\u8FDE\u63A5\uFF0C\u6BCF\u79D2\u5237\u65B0\u4E00\u6B21" : `${selected} \u6B64\u523B\u6CA1\u6709\u8FDE\u63A5` : "\u5F00\u542F\u4E4B\u540E\uFF0C\u7ECF\u8FC7\u4EE3\u7406\u7684\u6BCF\u4E00\u6761\u8FDE\u63A5\u90FD\u4F1A\u5217\u5728\u8FD9\u91CC"
        })
      ]
    });
  }
  function logsPanel(session2) {
    const tail = session2.logs.slice(-logPanelRows).reverse();
    let text = tail.join("\n");
    if (text.length > 19e3) text = text.slice(0, 19e3);
    return ui.section({
      key: "logs-section",
      title: "\u65E5\u5FD7",
      trailing: `${session2.logs.length} \u884C \xB7 \u6700\u65B0\u7684\u5728\u4E0A`,
      actions: [{ id: "reload", title: "\u91CD\u8BFB", symbol: "arrow.clockwise", help: "\u91CD\u8BFB sing-box \u6700\u8FD1 500 \u884C\u8F93\u51FA", onPress: () => void session2.showView("processes") }],
      children: [ui.editor({ key: "log-text", value: text, placeholder: "sing-box \u8FD8\u6CA1\u6709\u8F93\u51FA", label: "sing-box \u65E5\u5FD7", mono: true, readOnly: true, rows: 7 })]
    });
  }
  function policyGroups(session2, snapshot) {
    const running = snapshot.phase === "running";
    const selectorPick = snapshot.selection.node === URLTEST_TAG && running && session2.autoPick ? `${URLTEST_TAG} \u2192 ${session2.autoPick}` : snapshot.selection.node;
    return [
      { name: SELECTOR_TAG, count: snapshot.nodes.length, selected: selectorPick },
      ...snapshot.groups.map((group) => ({ name: group.name, count: group.members.length, selected: memberTitle(group.selected) }))
    ];
  }
  function policiesPage(session2, snapshot) {
    const running = snapshot.phase === "running";
    const mode = snapshot.selection.mode;
    const groups = policyGroups(session2, snapshot);
    const current = groups.find((group) => group.name === session2.policyGroup) ?? groups[0];
    const status = {
      text: mode === "direct" ? "\u76F4\u63A5\u8FDE\u63A5\uFF1A\u4E0D\u7ECF\u8FC7\u8282\u70B9\uFF0C\u4E0B\u9762\u7684\u9009\u62E9\u7167\u6837\u8BB0\u7740\uFF0C\u6362\u56DE\u522B\u7684\u6A21\u5F0F\u65F6\u751F\u6548" : `${dashboardModeTitles[mode]} \xB7 ${SELECTOR_TAG} \u2192 ${groups[0].selected}`,
      tint: running ? "live" : "neutral"
    };
    const children = [
      pageHeader(session2, "policies-header", "\u7B56\u7565", status, [
        ui.segmented({
          key: "policy-mode-picker",
          label: "\u51FA\u7AD9\u6A21\u5F0F",
          layout: "compact",
          value: mode,
          options: ["direct", "global", "rule"].map((value) => ({ value, title: dashboardModeTitles[value], help: modeHelps[value] })),
          onChange: (value) => void session2.setMode(value)
        }),
        ui.button({
          key: "test-all",
          title: "\u5168\u90E8\u6D4B\u901F",
          symbol: "speedometer",
          variant: "secondary",
          size: "bar",
          help: running ? "\u6D4B\u4E00\u904D\u5168\u90E8\u8282\u70B9\u7684\u5EF6\u8FDF" : "\u4EE3\u7406\u5F00\u7740\u624D\u80FD\u6D4B\u901F",
          disabled: !running || session2.core.busy !== null,
          onPress: () => void session2.test()
        })
      ])
    ];
    if (snapshot.nodes.length === 0) {
      children.push(ui.empty({ key: "no-nodes", symbol: "server.rack", title: "\u8FD8\u6CA1\u6709\u8282\u70B9", hint: "\u5728\u4E0B\u9762\u300C\u8BA2\u9605\u300D\u91CC\u586B\u8BA2\u9605\u5730\u5740\uFF0C\u62C9\u4E0B\u6765\u5C31\u6709\u4E86\u3002" }));
    } else {
      children.push(
        layout.grid({
          key: "policies-split",
          minimum: 240,
          spacing: "regular",
          weights: [1, 3],
          // 窗口比内容高时这一行吃掉剩下的高（第二轮 R-5）：策略组与节点两块面板长到订阅那一行上面，而不是整页下面空一截。
          fill: true,
          children: [
            ui.section({
              key: "policy-groups",
              title: "\u7B56\u7565\u7EC4",
              trailing: `${groups.length} \u4E2A`,
              children: [
                ui.list({
                  key: "policy-group-list",
                  children: groups.map(
                    (group) => ui.row({
                      key: `policy-group:${group.name}`,
                      symbol: group.name === SELECTOR_TAG ? "point.3.connected.trianglepath.dotted" : "square.stack.3d.up",
                      title: group.name,
                      subtitle: `${group.count} \u4E2A \xB7 ${group.selected}`,
                      selected: group.name === current.name,
                      onPress: () => session2.showPolicyGroup(group.name)
                    })
                  )
                })
              ]
            }),
            current.name === SELECTOR_TAG ? selectorPanel(session2, snapshot) : groupPanel(session2, snapshot, current.name)
          ]
        })
      );
    }
    children.push(
      layout.grid({
        key: "policies-bottom",
        minimum: 300,
        spacing: "regular",
        weights: [2, 1],
        children: [asPanel(subscriptionsSection(session2, snapshot, true)), terminalPanel(snapshot)]
      })
    );
    return children;
  }
  function selectorPanel(session2, snapshot) {
    const running = snapshot.phase === "running";
    const query = session2.filter.trim().toLowerCase();
    const matched = query ? snapshot.nodes.filter((node) => node.name.toLowerCase().includes(query) || node.protocol.includes(query)) : snapshot.nodes;
    const autoSelected = snapshot.selection.node === URLTEST_TAG;
    const cards = [
      nodeCard(session2, `node:${URLTEST_TAG}`, URLTEST_TAG, running && autoSelected && session2.autoPick ? `\u6B64\u523B\u7528\u300C${session2.autoPick}\u300D` : "\u6309\u5EF6\u8FDF\u81EA\u52A8\u6311\u6700\u5FEB\u7684", void 0, autoSelected, () => void session2.pickNode(URLTEST_TAG))
    ];
    for (const node of matched.slice(0, maximumCards - 1)) {
      const delay = snapshot.latency.values[node.name];
      cards.push(nodeCard(session2, `node:${node.name}`, node.name, [protocolTitles[node.protocol], formatDelay(delay)].filter((part) => part).join(" \xB7 "), delayTint(delay), snapshot.selection.node === node.name, () => void session2.pickNode(node.name)));
    }
    const children = [];
    if (snapshot.nodes.length > 8) {
      children.push(ui.search({ key: "node-search", value: session2.filter, placeholder: "\u641C\u7D22\u8282\u70B9", label: "\u641C\u7D22\u8282\u70B9", onChange: (value) => session2.search(value) }));
    }
    children.push(layout.grid({ key: "node-cards", minimum: 200, spacing: "tight", children: cards }));
    if (matched.length > cards.length - 1) children.push(ui.text({ key: "nodes-more", style: "footnote", text: `\u53E6\u6709 ${matched.length - (cards.length - 1)} \u4E2A\u6CA1\u753B\u51FA\u6765\uFF1A\u7528\u641C\u7D22\u627E` }));
    return ui.section({
      key: "policy-selector",
      title: `${SELECTOR_TAG} \xB7 ${snapshot.nodes.length} \u4E2A\u8282\u70B9`,
      trailing: snapshot.latency.testedAt ? `\u6D4B\u4E8E${formatAge(snapshot.latency.testedAt, Date.now())}` : "\u8FD8\u6CA1\u6D4B\u8FC7",
      children
    });
  }
  function groupPanel(session2, snapshot, name) {
    const group = snapshot.groups.find((candidate) => candidate.name === name);
    if (!group) return selectorPanel(session2, snapshot);
    return ui.section({
      key: `policy-group-panel:${group.name}`,
      title: `${group.name} \xB7 ${group.members.length} \u4E2A`,
      ...snapshot.surge ? { trailing: `\u6765\u81EA ${snapshot.surge.sourceName}` } : {},
      children: [
        layout.grid({
          key: `group-cards:${group.name}`,
          minimum: 200,
          spacing: "tight",
          children: group.members.slice(0, maximumCards).map((member) => {
            const delay = snapshot.latency.values[member.tag];
            return nodeCard(session2, `group:${group.name}:${member.tag}`, memberTitle(member.title), formatDelay(delay) || (member.tag === DIRECT_TAG ? "\u76F4\u8FDE" : ""), delayTint(delay), group.selected === member.tag, () => void session2.pickGroupMember(group, member.tag));
          })
        })
      ]
    });
  }
  function nodeCard(session2, key, title, detail, tint, selected, onPress) {
    return ui.card({
      key,
      ...selected ? { tint: "accent" } : {},
      onPress: session2.core.busy === null ? onPress : void 0,
      children: [
        ui.text({ key: `${key}:name`, style: "title", text: title, lines: 1 }),
        ui.text({ key: `${key}:detail`, style: "footnote", text: selected ? `\u5DF2\u9009 \xB7 ${detail || "\u70B9\u4E00\u4E0B\u6D4B\u901F"}` : detail || "\u70B9\u4E00\u4E0B\u9009\u5B83\u5E76\u6D4B\u901F", lines: 1, ...tint ? { tint } : {} })
      ]
    });
  }
  function terminalPanel(snapshot) {
    const command = terminalProxyCommand(snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort);
    return ui.section({
      key: "terminal",
      title: "\u7EC8\u7AEF\u4EE3\u7406",
      children: [
        ui.text({ key: "terminal-help", style: "footnote", text: "\u547D\u4EE4\u884C\u5DE5\u5177\u4E0D\u8BFB\u7CFB\u7EDF\u4EE3\u7406\uFF1A\u5728\u7EC8\u7AEF\u91CC\u7C98\u8D34\u8FD9\u4E00\u884C\uFF0C\u8FD9\u4E2A\u7EC8\u7AEF\u91CC\u7684 curl\u3001git\u3001brew \u5C31\u4F1A\u7ECF\u8FC7\u4EE3\u7406\u3002" }),
        ui.text({ key: "terminal-command", style: "mono", text: command, selectable: true }),
        ui.copy({ key: "terminal-copy", text: command, label: "\u590D\u5236\u7EC8\u7AEF\u4EE3\u7406\u547D\u4EE4", variant: "chip" })
      ]
    });
  }
  function rulesPage(session2, snapshot) {
    const plan = session2.routes;
    const children = [];
    if (plan) {
      const titles = new Map((snapshot.surge?.ruleSets ?? []).map((ref) => [ref.tag, ref.url.split("/").pop() || ref.host]));
      const rows = ruleRows(plan, session2.ruleHits?.counts ?? {}, titles);
      const shown = rows.length > ruleTableRows ? [...rows.slice(0, ruleTableRows - 1), rows[rows.length - 1]] : rows;
      const total = rows.reduce((sum, row) => sum + row.hits, 0);
      children.push(pageHeader(session2, "rules-header", "\u89C4\u5219", { text: `${rows.length} \u6761 \xB7 \u672C\u6B21\u5F00\u542F\u4EE5\u6765 ${total} \u6761\u8FDE\u63A5`, tint: snapshot.phase === "running" ? "live" : "neutral" }));
      const tableChildren = [
        layout.table({
          key: "rule-table",
          label: "\u6B64\u523B\u751F\u6548\u7684\u89C4\u5219",
          columns: [
            { title: "ID", width: "narrow", alignment: "trailing", mono: true },
            { title: "\u7C7B\u578B" },
            { title: "\u76EE\u6807", width: "fill" },
            { title: "\u7B56\u7565" },
            { title: "\u4F7F\u7528\u8BA1\u6570", width: "narrow", alignment: "trailing" },
            { title: "\u6CE8\u91CA", width: "wide" }
          ],
          rows: shown.map((row) => ({
            cells: [String(row.id), row.type, row.target, row.policy, String(row.hits), row.note],
            ...row.hits === 0 ? { tint: "neutral" } : {}
          }))
        })
      ];
      if (rows.length > shown.length) tableChildren.push(ui.text({ key: "rule-table-more", style: "footnote", text: `\u53E6\u6709 ${rows.length - shown.length} \u6761\u6CA1\u5217\u51FA\u6765\uFF08\u8868\u91CC\u81F3\u591A ${ruleTableRows} \u884C\uFF09` }));
      children.push(ui.section({ key: "rule-table-section", title: "\u751F\u6548\u7684\u89C4\u5219", trailing: `${rows.length} \u6761`, children: tableChildren }));
    } else {
      children.push(pageHeader(session2, "rules-header", "\u89C4\u5219", { text: "\u6B63\u5728\u8BFB\u53D6\u89C4\u5219", tint: "neutral" }));
    }
    children.push(
      layout.grid({
        key: "rules-tools",
        minimum: 360,
        spacing: "regular",
        children: [asPanel(currentPageSection(session2, snapshot)), asPanel(pageRulesSection(session2, snapshot))]
      }),
      asPanel(surgeSection(session2, snapshot), "Surge \u914D\u7F6E"),
      asPanel(builtinRulesSection(snapshot))
    );
    return children;
  }

  // extensions/proxy/src/page.ts
  var toolboxNodeRows = 60;
  var pageRuleRows = 120;
  var failedRows = 20;
  function renderPage(session2) {
    const snapshot = session2.snapshot;
    if (!snapshot) {
      const loading = ui.scroll({ children: [ui.text({ key: "loading", style: "footnote", text: "\u6B63\u5728\u8BFB\u53D6\u72B6\u6001" })] });
      return session2.surface === "window" ? renderDashboard(session2, null, loading) : loading;
    }
    if (session2.surface === "window") return renderDashboard(session2, snapshot);
    const children = [statusSection(session2, snapshot), ...notes(session2, snapshot)];
    if (snapshot.nodes.length > 0) children.push(modeSection(session2, snapshot), nodesSection(session2, snapshot, toolboxNodeRows));
    if (snapshot.groups.length > 0) children.push(groupsSection(session2, snapshot));
    children.push(rulesSummarySection(session2, snapshot), subscriptionsSection(session2, snapshot, false), commandSection(snapshot));
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
        subtitle: statusLine({ ...snapshot, busy, kernel: snapshot.kernel }),
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
    if (snapshot.phase !== "notGranted") {
      const tunActive = snapshot.kernel === "tunnel";
      const subtitle = tunSubtitle({ ...snapshot.tun, active: tunActive }) ?? "\u5F00\u7740\u65F6\u6574\u673A\u7F51\u7EDC\u7ECF\u8FC7 sing-box\uFF0C\u547D\u4EE4\u884C\u5DE5\u5177\u4E0E\u4E0D\u8BA4\u7CFB\u7EDF\u4EE3\u7406\u7684\u5E94\u7528\u4E5F\u7BA1\u5F97\u5230";
      children.push(
        ui.toggle({
          key: "tun",
          title: "\u589E\u5F3A\u6A21\u5F0F\uFF08TUN\uFF09",
          subtitle,
          value: running ? tunActive : snapshot.tun.wanted,
          disabled: busy !== null || !snapshot.tun.granted || snapshot.phase === "notInstalled",
          onChange: (on) => void session2.setTun(on)
        })
      );
    }
    if (running && (session2.history.download.length > 1 || session2.history.upload.length > 1)) {
      children.push(
        ui.chart({
          key: "traffic-chart",
          series: [
            { tone: "download", values: session2.history.download },
            { tone: "upload", values: session2.history.upload }
          ],
          label: "\u6700\u8FD1\u4E00\u5206\u949F\u7684\u6709\u6548\u6D41\u91CF\uFF1A\u9752\u8272\u4E0B\u884C\u3001\u6A59\u8272\u4E0A\u884C"
        })
      );
    }
    if (running && session2.reading) {
      children.push(
        ui.text({
          key: "reading",
          style: "footnote",
          tint: session2.reading.failed > 0 && session2.reading.failed >= session2.reading.succeeded ? "alert" : "neutral",
          text: `\u6709\u6548 \u2193 ${shortRate(session2.reading.download)}B/s  \u2191 ${shortRate(session2.reading.upload)}B/s \xB7 10 \u79D2\u5185\u6210\u529F ${session2.reading.succeeded}\u3001\u5931\u8D25 ${session2.reading.failed}`
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
            title: "\u8BBE\u7F6E\u91CC\u9009\u7684 sing-box \u8DEF\u5F84\u4E0D\u53EF\u7528",
            body: `${snapshot.preferences.singBoxPath} \u4E0D\u5B58\u5728\u6216\u4E0D\u662F\u53EF\u6267\u884C\u6587\u4EF6\uFF0C\u6587\u4EF6\u540D\u5FC5\u987B\u662F sing-box\u3002\u5728\u8BBE\u7F6E\u91CC\u91CD\u65B0\u300C\u9009\u62E9\u300D\u4E00\u4EFD\uFF0C\u6216\u8005\u70B9\u300C\u6E05\u9664\u300D\u8BA9 Jarvis \u81EA\u5DF1\u627E\uFF08Homebrew \u88C5\u7684\u4F1A\u81EA\u52A8\u627E\u5230\uFF09\u3002`,
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
            body: "\u5728\u4E0B\u9762\u300C\u8BA2\u9605\u300D\u90A3\u4E00\u6BB5\u586B\u8BA2\u9605\u5730\u5740\uFF08\u673A\u573A\u7ED9\u7684\u90A3\u4E00\u4E32 https \u94FE\u63A5\uFF0C\u53EF\u4EE5\u586B\u51E0\u6761\uFF09\uFF0C\u586B\u5B8C\u4F1A\u81EA\u5DF1\u62C9\u4E00\u904D\uFF1B\u4E5F\u53EF\u4EE5\u5728\u8BBE\u7F6E\u91CC\u586B\u3002\u8BA4\u5206\u4EAB\u94FE\u63A5\uFF08\u6574\u6BB5 base64 \u6216\u9010\u884C\uFF09\u4E0E sing-box JSON\uFF1BClash YAML \u672C\u671F\u4E0D\u8BA4\u3002",
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
        const wantedKernel = wantsTunnel(snapshot.preferences) ? "tunnel" : "daemon";
        const restart = restartReasons(snapshot.control, snapshot.preferences, wantedKernel);
        const reload = reloadReasons(snapshot.control, snapshot.preferences, nodesDigest(snapshot.nodes), snapshot.rulesDigest);
        if (restart.length > 0) {
          out.push(
            ui.note({
              key: "restart",
              tint: "blue",
              symbol: "arrow.triangle.2.circlepath",
              title: "\u91CD\u65B0\u5F00\u542F\u4E4B\u540E\u751F\u6548",
              body: `${restart.join("\u3001")}\uFF1B\u5728\u8DD1\u7684\u8FD9\u4E00\u4EFD\u8FD8\u662F\u65E7\u7684\u3002\u91CD\u65B0\u5F00\u542F\u4F1A\u65AD\u5F00\u73B0\u6709\u8FDE\u63A5\u4E00\u4E0B\u3002`,
              actions: [action("restart", "\u91CD\u65B0\u5F00\u542F", () => void session2.restart(), { disabled: session2.core.busy !== null })]
            })
          );
        } else if (reload.length > 0) {
          out.push(
            ui.note({
              key: "reload",
              tint: "blue",
              symbol: "arrow.clockwise",
              title: "\u91CD\u65B0\u8F7D\u5165\u4E4B\u540E\u751F\u6548",
              body: `${reload.join("\u3001")}\uFF1B\u5728\u8DD1\u7684\u8FD9\u4E00\u4EFD\u8FD8\u662F\u65E7\u7684\u3002\u91CD\u65B0\u8F7D\u5165\u4E0D\u65AD\u5F00\u8FDE\u63A5\u3001\u4E0D\u52A8\u7CFB\u7EDF\u4EE3\u7406\u3002`,
              actions: [action("reload", "\u91CD\u65B0\u8F7D\u5165", () => void session2.reload(), { disabled: session2.core.busy !== null })]
            })
          );
        }
        break;
      }
    }
    out.push(...tunNotes(session2, snapshot));
    return out;
  }
  function tunNotes(session2, snapshot) {
    if (snapshot.phase === "notGranted" || snapshot.phase === "notInstalled") return [];
    const wanted = wantsTunnel(snapshot.preferences);
    if (!wanted || snapshot.kernel === "tunnel") return [];
    if (!snapshot.tun.granted) {
      return [
        ui.note({
          key: "tun-not-granted",
          tint: "alert",
          symbol: "lock.shield",
          title: "\u589E\u5F3A\u6A21\u5F0F\u8FD8\u6CA1\u6709\u6388\u6743",
          body: "\u589E\u5F3A\u6A21\u5F0F\u4EE5\u7BA1\u7406\u5458\u8EAB\u4EFD\u8FD0\u884C sing-box\u3001\u63A5\u7BA1\u6574\u673A\u7F51\u7EDC\uFF1A\u547D\u4EE4\u884C\u5DE5\u5177\u548C\u4E0D\u8BA4\u7CFB\u7EDF\u4EE3\u7406\u7684\u5E94\u7528\u4E5F\u4F1A\u7ECF\u8FC7\u5B83\u3002\u7B2C\u4E00\u6B21\u6253\u5F00\u65F6\u8FD8\u8981\u4F60\u8F93\u4E00\u6B21\u7BA1\u7406\u5458\u5BC6\u7801\uFF0C\u88C5\u4E0A Jarvis \u7684\u7F51\u7EDC\u52A9\u624B\u3002",
          actions: [
            { id: "grant-tun", title: "\u6388\u6743", onPress: () => void session2.grantTunnel() },
            { id: "tun-off", title: "\u6539\u7528\u7CFB\u7EDF\u4EE3\u7406\u6A21\u5F0F", onPress: () => void session2.setTun(false) }
          ]
        })
      ];
    }
    if (snapshot.tun.blocker) {
      return [
        ui.note({
          key: "tun-blocked",
          tint: "alert",
          symbol: "hand.raised",
          title: "\u589E\u5F3A\u6A21\u5F0F\u88AB\u522B\u7684 VPN \u62E6\u7740",
          body: `${snapshot.tun.blocker}
\u4E24\u4E2A TUN \u540C\u65F6\u63A5\u7BA1\u7F51\u7EDC\u4F1A\u4E92\u76F8\u62A2\u8DEF\u7531\u3002\u5148\u5173\u6389\u5B83\uFF0C\u518D\u6253\u5F00\u8FD9\u91CC\u7684\u589E\u5F3A\u6A21\u5F0F\uFF1B\u6216\u8005\u6539\u7528\u7CFB\u7EDF\u4EE3\u7406\u6A21\u5F0F\u3002`,
          actions: [{ id: "tun-off", title: "\u6539\u7528\u7CFB\u7EDF\u4EE3\u7406\u6A21\u5F0F", onPress: () => void session2.setTun(false) }]
        })
      ];
    }
    const subtitle = tunSubtitle({ ...snapshot.tun, active: false });
    if (subtitle && snapshot.phase !== "running") {
      return [ui.note({ key: "tun-password", tint: "blue", symbol: "key", title: "\u589E\u5F3A\u6A21\u5F0F\u8981\u4E00\u6B21\u7BA1\u7406\u5458\u6388\u6743", body: `${subtitle}\u3002\u7CFB\u7EDF\u4F1A\u5F39\u51FA\u5BC6\u7801\u6846\uFF0C\u90A3\u662F macOS \u81EA\u5DF1\u7684\u7A97\u53E3\u3002\u7F51\u7EDC\u52A9\u624B\u53EF\u4EE5\u5728 \u8BBE\u7F6E \xB7 \u6269\u5C55 \xB7\u300C\u4EE3\u7406\u300D\u91CC\u5378\u6389\u3002` })];
    }
    return [];
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
  function groupsSection(session2, snapshot) {
    return ui.section({
      key: "groups",
      title: "\u7B56\u7565\u7EC4 \xB7 GROUPS",
      trailing: snapshot.surge ? `\u6765\u81EA ${snapshot.surge.sourceName}` : void 0,
      children: snapshot.groups.map(
        (group) => ui.picker({
          key: `group:${group.name}`,
          label: group.name,
          value: group.selected,
          layout: "full",
          options: group.members.map((member) => ({ value: member.tag, title: memberTitle(member.title) })),
          onChange: (value) => void session2.selectGroupMember(group, value)
        })
      )
    });
  }
  function rulesSummarySection(session2, snapshot) {
    const parts = [`${snapshot.pageRules.length} \u6761\u9875\u9762\u89C4\u5219`];
    if (snapshot.surge) parts.push(snapshot.preferences.useSurgeRules ? `Surge \u914D\u7F6E\u300C${snapshot.surge.sourceName}\u300D` : `\u5BFC\u5165\u4E86 Surge \u914D\u7F6E\uFF08\u8BBE\u7F6E\u91CC\u5173\u7740\uFF09`);
    else parts.push(snapshot.preferences.chinaRules ? "\u5185\u7F6E\uFF1A\u5C40\u57DF\u7F51\u4E0E\u4E2D\u56FD\u5927\u9646\u76F4\u8FDE" : "\u5185\u7F6E\uFF1A\u53EA\u6709\u5C40\u57DF\u7F51\u76F4\u8FDE");
    return ui.section({
      key: "rules-summary",
      title: "\u89C4\u5219 \xB7 RULES",
      actions: [
        { id: "import", title: "\u5BFC\u5165 Surge \u914D\u7F6E", symbol: "square.and.arrow.down", help: "\u6311\u4E00\u4EFD Surge \u7684 .conf\uFF0C\u628A\u89C4\u5219\u3001\u7B56\u7565\u7EC4\u4E0E TUN \u76F8\u5173\u7684\u8BBE\u7F6E\u8F6C\u6210 sing-box", onPress: () => void session2.importSurge() }
      ],
      children: [
        ui.row({ key: "rules-open", symbol: "list.bullet.rectangle", title: "\u89C4\u5219\u4E0E\u5F53\u524D\u9875\u9762", subtitle: parts.join(" \xB7 "), accessory: "chevron", onPress: () => session2.openWindow("rules") })
      ]
    });
  }
  function policyChips(session2, snapshot, keyPrefix, domain) {
    const rule = pageRuleFor(snapshot.pageRules, domain);
    const policies = ["proxy", "direct", "reject", ...snapshot.groups.map((group) => `group:${group.name}`)];
    const chips = policies.map(
      (policy) => ui.chip({
        key: `${keyPrefix}:${policy}`,
        title: policyTitle(policy),
        selected: rule?.policy === policy,
        disabled: session2.core.busy !== null,
        onPress: () => void session2.setPageRule(domain, rule?.policy === policy ? null : policy)
      })
    );
    return ui.stack({ key: `${keyPrefix}:chips`, axis: "horizontal", spacing: "tight", children: chips });
  }
  function currentPageSection(session2, snapshot) {
    const page = session2.currentPage;
    const children = [];
    if (!page) {
      children.push(ui.text({ key: "page-hint", style: "footnote", text: "\u8BFB\u524D\u53F0\u6D4F\u89C8\u5668\uFF08Safari\u3001Chrome\u3001Edge\u3001Arc\u3001Brave\uFF09\u5F53\u524D\u6807\u7B7E\u7684\u5730\u5740\uFF0C\u518D\u52A0\u4E0A\u5B83\u6700\u8FD1 30 \u79D2\u8FDE\u8FC7\u7684\u57DF\u540D\uFF0C\u4E00\u952E\u7ED9\u5B83\u4EEC\u5B9A\u300C\u8D70\u4EE3\u7406 / \u76F4\u8FDE / \u62D2\u7EDD\u300D\u3002\u7B2C\u4E00\u6B21\u8BFB\u67D0\u4E2A\u6D4F\u89C8\u5668\u65F6\u7CFB\u7EDF\u4F1A\u95EE\u4E00\u6B21\u300C\u81EA\u52A8\u5316\u300D\u6388\u6743\u3002" }));
    } else {
      if (page.status !== "ok") children.push(ui.text({ key: "page-status", style: "footnote", tint: "alert", text: page.message || "\u8BFB\u4E0D\u5230\u5730\u5740" }));
      else children.push(ui.text({ key: "page-where", style: "footnote", text: `${page.browser ?? "\u6D4F\u89C8\u5668"} \xB7 ${page.host}` }));
      for (const [index, domain] of page.domains.entries()) {
        const parts = [`${domain.connections} \u6761\u8FDE\u63A5`];
        if (domain.failed > 0) parts.push(`${domain.failed} \u5931\u8D25`);
        if (domain.route) parts.push(`\u6B64\u523B ${memberTitle(domain.route)}`);
        if (domain.hosts.length > 0) parts.push(domain.hosts.join("\u3001"));
        children.push(
          ui.row({ key: `page-domain:${index}`, symbol: domain.isPage ? "globe" : "link", title: domain.domain, subtitle: parts.join(" \xB7 "), ...domain.failed > 0 ? { tint: "alert" } : {} }),
          policyChips(session2, snapshot, `page-policy:${index}`, domain.domain)
        );
      }
      if (page.domains.length === 0 && page.status === "ok") children.push(ui.text({ key: "page-empty", style: "footnote", text: "\u8FD9\u4E00\u9875\u8FD8\u6CA1\u6709\u7ECF\u8FC7\u4EE3\u7406\u7684\u8FDE\u63A5\uFF1A\u4EE3\u7406\u5F00\u7740\u65F6\u5237\u65B0\u4E00\u4E0B\u9875\u9762\u518D\u8BFB\u3002" }));
    }
    return ui.section({
      key: "current-page",
      title: "\u5F53\u524D\u9875\u9762 \xB7 PAGE",
      actions: [{ id: "read-page", title: page ? "\u91CD\u8BFB" : "\u8BFB\u53D6\u5F53\u524D\u9875\u9762", symbol: "safari", disabled: session2.core.busy !== null, onPress: () => void session2.readPage() }],
      children
    });
  }
  function pageRulesSection(session2, snapshot) {
    const shown = snapshot.pageRules.slice(0, pageRuleRows);
    const now = Date.now();
    const children = [
      ui.list({
        key: "page-rules",
        children: shown.map(
          (rule) => ui.row({
            key: `page-rule:${rule.id}`,
            symbol: rule.policy === "reject" ? "nosign" : rule.policy === "direct" ? "arrow.right" : "point.3.connected.trianglepath.dotted",
            title: rule.value,
            subtitle: `${rule.kind === "domain_suffix" ? "\u542B\u5B50\u57DF\u540D" : "\u53EA\u8FD9\u4E00\u4E2A"} \xB7 ${policyTitle(rule.policy)}${rule.createdAt ? ` \xB7 ${formatAge(rule.createdAt, now)}` : ""}`,
            actions: [
              ...["proxy", "direct", "reject"].filter((policy) => policy !== rule.policy).map((policy) => ({ id: policy, title: policyTitle(policy), onPress: () => void session2.setPageRule(rule.value, policy) })),
              { id: "delete", title: "\u5220\u9664", symbol: "trash", tint: "danger", onPress: () => void session2.removePageRule(rule.id) }
            ]
          })
        ),
        emptyState: ui.empty({ key: "no-page-rules", symbol: "list.bullet.rectangle", title: "\u8FD8\u6CA1\u6709\u9875\u9762\u89C4\u5219", hint: "\u5728\u83DC\u5355\u680F\u300C\u5F53\u524D\u9875\u9762\u300D\u300C\u6700\u8FD1\u8BF7\u6C42\u300D\u91CC\uFF0C\u6216\u4E0A\u9762\u90A3\u4E00\u6BB5\uFF0C\u7ED9\u7F51\u7AD9\u5B9A\u8D70\u4EE3\u7406\u8FD8\u662F\u76F4\u8FDE\u3002" })
      })
    ];
    if (snapshot.pageRules.length > shown.length) children.push(ui.text({ key: "page-rules-more", style: "footnote", text: `\u53E6\u6709 ${snapshot.pageRules.length - shown.length} \u6761\u6CA1\u5217\u51FA\u6765` }));
    return ui.section({ key: "page-rules-section", title: "\u9875\u9762\u89C4\u5219 \xB7 PAGE RULES", trailing: `${snapshot.pageRules.length} \u6761 \xB7 \u6392\u5728\u6240\u6709\u89C4\u5219\u4E4B\u524D`, children });
  }
  function surgeSection(session2, snapshot) {
    const surge = snapshot.surge;
    const busy = session2.core.busy !== null;
    const actions = [{ id: "import", title: surge ? "\u91CD\u65B0\u5BFC\u5165" : "\u5BFC\u5165 Surge \u914D\u7F6E", symbol: "square.and.arrow.down", disabled: busy, onPress: () => void session2.importSurge() }];
    if (!surge) {
      return ui.section({
        key: "surge",
        title: "SURGE \u914D\u7F6E \xB7 IMPORT",
        actions,
        children: [
          ui.text({
            key: "surge-hint",
            style: "footnote",
            text: "\u6311\u4E00\u4EFD Surge \u7684 .conf\uFF1A[Rule] \u91CC\u7684\u57DF\u540D\u3001IP\u3001GEOIP\u3001\u8FDB\u7A0B\u3001\u903B\u8F91\u89C4\u5219\u4E0E\u5916\u90E8\u89C4\u5219\u96C6\uFF0C[Proxy Group] \u7684\u7B56\u7565\u7EC4\uFF0C[General] \u91CC TUN \u76F8\u5173\u7684\u51E0\u9879\uFF08tun-excluded-routes\u3001bypass-tun\u3001always-real-ip\u3001dns-server\u3001skip-proxy\uFF09\u4E0E [Host] \u90FD\u4F1A\u8F6C\u6210 sing-box\u3002USER-AGENT\u3001URL Rewrite\u3001MITM\u3001Script \u8F6C\u4E0D\u4E86\uFF0C\u5BFC\u5165\u540E\u9010\u7C7B\u5217\u51FA\u6765\u3002\u8282\u70B9\u4ECD\u7136\u6765\u81EA\u8BA2\u9605\u3002"
          })
        ]
      });
    }
    actions.push({ id: "clear", title: "\u64A4\u6389", symbol: "trash", tint: "danger", disabled: busy, onPress: () => void session2.clearSurge() });
    const report = surge.report;
    const children = [
      ui.readout({ key: "surge-rules", label: "\u89C4\u5219", value: `${convertedCount(report)} / ${report.ruleLines} \u6761\u8F6C\u6210 sing-box\uFF08\u5408\u5E76\u6210 ${report.compiledRules} \u6761\uFF09` }),
      ui.readout({ key: "surge-groups", label: "\u7B56\u7565\u7EC4", value: surge.groups.length > 0 ? surge.groups.map((group) => group.name).join("\u3001") : "\u6CA1\u6709" }),
      ui.readout({
        key: "surge-tun",
        label: "TUN",
        value: `\u4E0D\u8FDB TUN \u7684\u8DEF\u7531 ${surge.general.tunExcludedRoutes.length + surge.general.bypassTun.length} \u6761 \xB7 \u771F\u5B9E IP \u57DF\u540D ${surge.general.alwaysRealIP.length} \u4E2A \xB7 DNS ${surge.general.dnsServers.join("\u3001") || "\u9ED8\u8BA4"}`
      })
    ];
    if (!snapshot.preferences.useSurgeRules) {
      children.push(ui.text({ key: "surge-off", style: "footnote", tint: "alert", text: "\u8BBE\u7F6E\u91CC\u300C\u4F7F\u7528\u5BFC\u5165\u7684 Surge \u89C4\u5219\u300D\u5173\u7740\uFF1A\u6B64\u523B\u7528\u7684\u662F\u5185\u7F6E\u89C4\u5219\u3002" }));
    }
    if (surge.ruleSets.length > 0) {
      const records = new Map(snapshot.ruleSetRecords.map((record) => [record.tag, record]));
      const allowed = new Set(snapshot.ruleSetURLs);
      const missing = surge.ruleSets.filter((ref) => !allowed.has(ref.url)).map((ref) => ref.url);
      children.push(
        ui.list({
          key: "rule-sets",
          children: surge.ruleSets.map((ref) => {
            const record = records.get(ref.tag);
            const name = ref.url.split("/").pop() || ref.host;
            const subtitle = !allowed.has(ref.url) ? "\u6CA1\u8D34\u8FDB\u300C\u89C4\u5219\u96C6\u5730\u5740\u300D\uFF1A\u8FD9\u4E00\u7EC4\u89C4\u5219\u6682\u65F6\u8DF3\u8FC7" : record?.error ? `\u6CA1\u62C9\u5230\uFF1A${record.error}` : record?.fetchedAt ? `${record.total} \u6761 \xB7 \u62C9\u4E8E${formatAge(record.fetchedAt, Date.now())}${record.skipped > 0 ? ` \xB7 ${record.skipped} \u6761\u8F6C\u4E0D\u4E86` : ""}` : "\u8FD8\u6CA1\u62C9";
            return ui.row({ key: `rule-set:${ref.tag}`, symbol: record?.fetchedAt ? "checklist" : "exclamationmark.triangle", title: name, subtitle, ...record?.fetchedAt ? {} : { tint: "amber" } });
          })
        })
      );
      if (missing.length > 0) {
        children.push(
          ui.text({ key: "rule-sets-help", style: "footnote", text: `${missing.length} \u4E2A\u5916\u90E8\u89C4\u5219\u96C6\u8981\u8054\u7F51\u62C9\uFF0C\u5730\u5740\u6765\u81EA\u4F60\u6311\u7684\u6587\u4EF6\u2014\u2014Jarvis \u53EA\u653E\u884C\u4F60\u4EB2\u624B\u586B\u8FDB\u8BBE\u7F6E\u7684\u5730\u5740\u3002\u590D\u5236\u4E0B\u9762\u8FD9\u4E9B\uFF0C\u8D34\u8FDB \u8BBE\u7F6E \xB7 \u6269\u5C55 \xB7\u300C\u4EE3\u7406\u300D\xB7\u300C\u89C4\u5219\u96C6\u5730\u5740\u300D\uFF08\u4E00\u6B21\u8D34\u591A\u884C\u4F1A\u62C6\u6210\u591A\u6761\uFF09\u3002` }),
          ui.copy({ key: "rule-sets-copy", text: missing.join("\n"), label: "\u590D\u5236\u8FD9\u4E9B\u5730\u5740", variant: "chip" })
        );
      }
      actions.push({ id: "update-sets", title: "\u62C9\u89C4\u5219\u96C6", symbol: "arrow.clockwise", disabled: busy || missing.length === surge.ruleSets.length, onPress: () => void session2.updateRuleSets() });
    }
    if (report.unsupported.length > 0) {
      children.push(
        ui.list({
          key: "surge-unsupported",
          children: report.unsupported.map(
            (kind) => ui.row({
              key: `unsupported:${kind.kind}`,
              symbol: "xmark.circle",
              title: `${kind.kind} \xB7 ${kind.count} \u9879`,
              subtitle: kind.samples.length > 0 ? `${kind.reason}\uFF1A${kind.samples.slice(0, 2).join("\uFF1B")}` : kind.reason
            })
          )
        })
      );
    }
    return ui.section({ key: "surge", title: "SURGE \u914D\u7F6E \xB7 IMPORT", trailing: `${surge.sourceName} \xB7 \u5BFC\u5165\u4E8E${formatAge(surge.importedAt, Date.now())}`, actions, children });
  }
  function builtinRulesSection(snapshot) {
    const lines = ["\u5C40\u57DF\u7F51\uFF08\u79C1\u6709\u5730\u5740\u3001localhost\u3001.local\uFF09\u4E00\u5F8B\u76F4\u8FDE", "\u51FA\u7AD9\u6A21\u5F0F\u300C\u5168\u5C40\u300D\u300C\u76F4\u8FDE\u300D\u6392\u5728\u9875\u9762\u89C4\u5219\u4E4B\u524D"];
    if (!snapshot.surge || !snapshot.preferences.useSurgeRules) lines.push(snapshot.preferences.chinaRules ? "\u4E2D\u56FD\u5927\u9646\u7684\u57DF\u540D\u4E0E IP \u76F4\u8FDE\uFF08geosite-cn\u3001geoip-cn\uFF09" : "\u300C\u4E2D\u56FD\u5927\u9646\u76F4\u8FDE\u300D\u5173\u7740\uFF1A\u9664\u5C40\u57DF\u7F51\u5916\u90FD\u8D70\u8282\u70B9");
    lines.push(snapshot.kernel === "tunnel" ? "\u589E\u5F3A\u6A21\u5F0F\uFF1ADNS \u7531 sing-box \u7B54\uFF08fake-ip / \u771F\u5B9E IP \u89C1\u8BBE\u7F6E\uFF09\uFF0Calways-real-ip \u7684\u57DF\u540D\u7ED9\u771F\u5B9E\u5730\u5740" : "\u5176\u4F59\u8D70\u300C\u8282\u70B9\u9009\u62E9\u300D");
    return ui.section({ key: "builtin-rules", title: "\u5185\u7F6E \xB7 BUILT-IN", children: lines.map((line, index) => ui.text({ key: `builtin:${index}`, style: "footnote", text: `\xB7 ${line}` })) });
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
    const children = [];
    const showEditor = detailed || snapshot.subscriptionCount === 0 || session2.manageSubscriptions;
    if (showEditor) children.push(layout.preference({ key: "subscriptions-editor", preference: "subscriptions" }));
    if (snapshot.subscriptions.length > 0 || !showEditor) {
      children.push(
        ui.list({
          key: "subscriptions",
          children: rows,
          emptyState: ui.empty({
            key: "no-subscriptions",
            symbol: "link.badge.plus",
            title: snapshot.subscriptionCount > 0 ? "\u8FD8\u6CA1\u6709\u62C9\u8FC7\u8BA2\u9605" : "\u8FD8\u6CA1\u6709\u8BA2\u9605\u5730\u5740",
            hint: snapshot.subscriptionCount > 0 ? "\u70B9\u53F3\u4E0A\u89D2\u300C\u66F4\u65B0\u8BA2\u9605\u300D\u62C9\u4E00\u6B21\u3002" : "\u70B9\u300C\u7BA1\u7406\u8BA2\u9605\u300D\u586B\u8BA2\u9605\u5730\u5740\u3002"
          })
        })
      );
    }
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
        ...!detailed && snapshot.subscriptionCount > 0 ? [
          {
            id: "manage",
            title: session2.manageSubscriptions ? "\u6536\u8D77" : "\u7BA1\u7406\u8BA2\u9605",
            symbol: session2.manageSubscriptions ? "chevron.up" : "link.badge.plus",
            help: session2.manageSubscriptions ? "\u6536\u8D77\u8BA2\u9605\u5730\u5740" : "\u52A0\u3001\u6539\u3001\u5220\u8BA2\u9605\u5730\u5740",
            onPress: () => session2.toggleManageSubscriptions()
          }
        ] : [],
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
  function ruleActions(session2, host) {
    const domain = registrableDomain(host.replace(/:\d+$/, ""));
    if (!domain) return [];
    return ["proxy", "direct", "reject"].map((policy) => ({ id: policy, title: `${domain} ${policyTitle(policy)}`, onPress: () => void session2.setPageRule(domain, policy) }));
  }
  function failuresSection(session2) {
    const failures = session2.meter.recent(Date.now(), 200).filter((attempt) => attempt.outcome === "failed").slice(0, failedRows);
    if (failures.length === 0) return null;
    return ui.section({
      key: "failed-section",
      title: "\u5931\u8D25 \xB7 FAILED",
      tint: "alert",
      trailing: `\u6700\u8FD1 ${failures.length} \u6761`,
      children: [
        ui.list({
          key: "failed",
          children: failures.map(
            (attempt) => ui.row({
              key: `failed:${attempt.id}`,
              symbol: "xmark.octagon",
              tint: "alert",
              title: attempt.port ? `${attempt.host}:${attempt.port}` : attempt.host,
              subtitle: [attempt.reason, attempt.process.split("/").pop() ?? ""].filter((part) => part.length > 0).join(" \xB7 "),
              actions: ruleActions(session2, attempt.host)
            })
          )
        })
      ]
    });
  }

  // extensions/proxy/src/session.ts
  var legacyViews = {
    nodes: "policies",
    subscriptions: "policies",
    connections: "processes",
    logs: "processes",
    rules: "rules"
  };
  var internetTestURL = "https://www.apple.com/library/test/success.html";
  var externalIPURL = "https://api.ipify.org?format=json";
  var externalIPTTL = 5 * 60 * 1e3;
  var internetEveryTicks = 30;
  var surgeProfilesDirectory = "~/Library/Application Support/Surge/Profiles";
  function parseExternalIP(text) {
    try {
      const body = JSON.parse(text);
      return typeof body.ip === "string" && /^[0-9a-fA-F.:]{3,45}$/.test(body.ip) ? body.ip : null;
    } catch {
      return null;
    }
  }
  var messageDwell = 6e3;
  var maximumLogLines = 500;
  var installWaitMs = 10 * 60 * 1e3;
  var chartPoints = 60;
  var Session = class {
    constructor() {
      this.core = new ProxyCore(() => jarvis.ui.update());
      this.surface = "toolbox";
      this.snapshot = null;
      this.view = "activity";
      /** 工具箱「订阅」那一段展开了「管理订阅」（宿主画的地址列表，P-2）。 */
      this.manageSubscriptions = false;
      /** 「流量」卡看哪一份。 */
      this.trafficScope = "all";
      /** Top 10 看哪一类。 */
      this.topCategory = "processes";
      /** 此刻的主网络接口；没读过为 `null`。 */
      this.network = null;
      /** 外部 IP 与查到的时刻；`ip` 为 `null` = 查过但没查到。 */
      this.externalIP = null;
      /** 「Internet 延迟」：毫秒；`null` 测过但不通；`undefined` 还没测。 */
      this.internetDelay = void 0;
      /** 今天的流量（后台会话每分钟写一次存储，这里每 10 秒读一次）。 */
      this.stats = null;
      /** 本次开启以来的规则命中（同上）。 */
      this.ruleHits = null;
      /** 此刻的路由（规则页那张表）。 */
      this.routes = null;
      /** 每个程序此刻的速率（进程页）。 */
      this.processes = [];
      /** 节点搜索框里的字。 */
      this.filter = "";
      /** 进程页选中的程序；`null` = 右边看全部程序的连接（jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-7）。 */
      this.processSelection = null;
      /** 进程页页头搜索框里的字：按程序名或主机筛两张表。 */
      this.processFilter = "";
      /** 策略页左栏选中的策略组（「节点选择」或导入的 Surge 策略组名）。 */
      this.policyGroup = SELECTOR_TAG;
      /** 上一个动作的结果（页面上那一行）。 */
      this.message = null;
      /** `message` 是什么时候记下的（Unix 毫秒）：窗口页头里成功的那一句只停留 {@link messageDwell}。 */
      this.messageAt = 0;
      this.rate = null;
      this.connections = null;
      this.logs = [];
      /** 「自动选择」此刻选中的节点。 */
      this.autoPick = null;
      /** 点「在终端中安装」的时刻；不在等为 `null`。 */
      this.installingSince = null;
      /** 这一页自己的成败统计（「连接」页的失败列表、状态段的读数）。 */
      this.meter = new TrafficMeter();
      this.reading = null;
      /** 状态段那块曲线：这一页开着以来最近 60 秒的有效速率（旧的在前，jarvis-mac `specs/20261028-130540-proxy-walkthrough-fixes` W-3）。页面关掉就丢。 */
      this.history = { upload: [], download: [] };
      /** 「规则」页里读到的当前页面；没读过为 `null`。 */
      this.currentPage = null;
      this.sample = null;
      /** 上一次看到的订阅地址（换行拼起来）；还没看过为 `null`。 */
      this.knownSubscriptions = null;
      this.generation = 0;
      this.unobserveDaemon = null;
      this.unobserveTunnel = null;
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
      await this.core.migrateTunSelection();
      await this.refresh();
      this.knownSubscriptions = null;
      await this.checkSubscriptions();
      this.observe();
      if (!this.unwatch) this.unwatch = jarvis.preferences.onChange((changes) => void this.onPreferencesChanged(changes));
      if (this.surface === "window") {
        await this.loadLogs();
        await this.loadDashboard(true);
      }
      void this.loop(generation);
    }
    deactivate() {
      this.generation += 1;
      this.unobserveDaemon?.();
      this.unobserveDaemon = null;
      this.unobserveTunnel?.();
      this.unobserveTunnel = null;
      this.unwatch?.();
      this.unwatch = null;
      this.sample = null;
      this.rate = null;
      this.reading = null;
      this.history = { upload: [], download: [] };
      this.meter.reset();
    }
    /**
     * 偏好变了：重读、重画；「规则集地址」变了就去拉一遍。
     * 「增强模式」被设置页改了时换内核的是后台会话（它常驻、只有它一处换，见 `Background.onPreferencesChanged`），这里只跟着重画。
     * @param changes 变了的几项。
     */
    async onPreferencesChanged(changes) {
      if ("ruleSets" in changes && this.snapshot?.granted.includes("network.https")) {
        const result = await this.core.updateRuleSets();
        if (result.message) this.setMessage(result);
      }
      await this.refresh();
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
          this.reading = null;
          this.history = { upload: [], download: [] };
          this.meter.reset();
        }
        if (this.installingSince !== null && (snapshot.phase !== "notInstalled" || Date.now() - this.installingSince > installWaitMs)) {
          this.installingSince = null;
        }
        jarvis.ui.update();
        await pushMenu(snapshot, { autoPick: this.autoPick, rate: null, busy: this.core.busy });
      } catch (error) {
        this.setMessage({ ok: false, message: `\u8BFB\u4E0D\u51FA\u72B6\u6001\uFF1A${errorMessage2(error)}` });
        jarvis.ui.update();
      }
    }
    observe() {
      const granted = this.snapshot?.granted ?? [];
      const listener = (event) => {
        if (event.kind === "output") {
          this.logs = [...this.logs, ...event.lines].slice(-maximumLogLines);
          this.meter.ingestLines(event.lines, Date.now());
          if (this.surface === "window" && this.view === "processes") jarvis.ui.update();
          return;
        }
        void this.onExit(event.expected, event.lines);
      };
      if (!this.unobserveDaemon && granted.includes(requiredCapability)) this.unobserveDaemon = jarvis.daemon.observe("sing-box", listener);
      if (!this.unobserveTunnel && granted.includes(tunnelCapability)) this.unobserveTunnel = jarvis.tunnel.observe(listener);
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
            const now = Date.now();
            const sample = { at: now, upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
            this.rate = trafficRate(this.sample, sample) ?? this.rate;
            const seconds = this.sample ? (now - this.sample.at) / 1e3 : 1;
            this.processes = processRates(this.connections, snapshot, seconds);
            this.sample = sample;
            this.connections = snapshot;
            const effective = this.meter.ingestSnapshot(snapshot, now);
            if (effective) {
              this.history = {
                upload: [...this.history.upload, effective.upload].slice(-chartPoints),
                download: [...this.history.download, effective.download].slice(-chartPoints)
              };
            }
            this.reading = this.meter.reading(now);
            jarvis.ui.update();
          }
        }
        if (tick % 2 === 0 && this.editingSubscriptions() || tick % 10 === 0) await this.checkSubscriptions();
        if (generation !== this.generation) return;
        const waitingInstall = this.installingSince !== null && tick % 2 === 0;
        if (waitingInstall || tick % 10 === 0) await this.refresh();
        if (this.surface === "window" && tick % 10 === 0) await this.loadDashboard(tick % internetEveryTicks === 0);
      }
    }
    /** 订阅地址框此刻在不在屏幕上（工具箱「订阅」那一段展开着、或窗口在策略页）。 */
    editingSubscriptions() {
      if (this.surface === "window") return this.view === "policies";
      return this.manageSubscriptions || this.snapshot?.subscriptionCount === 0;
    }
    /**
     * 订阅地址变了没有（P-2）：地址进钥匙串，宿主不把它放进偏好变更通知，所以每 2 秒现问一次。
     * 多了新地址（工具箱里刚填的、设置页里加的）就当场拉一遍；只是删了就重读状态。
     */
    async checkSubscriptions() {
      let urls;
      try {
        urls = await this.core.subscriptionURLs();
      } catch {
        return;
      }
      const key = urls.join("\n");
      const known = this.knownSubscriptions;
      this.knownSubscriptions = key;
      if (known === null || key === known) return;
      const before = new Set(known.split("\n"));
      const added = urls.some((url) => !before.has(url));
      if (added && this.snapshot?.granted.includes("network.https")) await this.update();
      else await this.refresh();
    }
    /**
     * 窗口里「活动」「规则」两页要的那几样（P-3）：今天的统计与规则命中（后台写的存储）、此刻的路由、网络接口、外部 IP、Internet 延迟。
     * 每一样读不出都只是那一格写「—」，不进错误屏。
     * @param probe 这一次连网络接口与延迟也重测（开窗口时、每 30 秒）。
     */
    async loadDashboard(probe) {
      const now = Date.now();
      try {
        const [stats, hits] = await Promise.all([jarvis.storage.get(storageKeys.statsToday), jarvis.storage.get(storageKeys.ruleHits)]);
        this.stats = restoreDay(stats, now);
        this.ruleHits = hits && typeof hits === "object" ? hits : null;
      } catch {
        this.stats = this.stats ?? restoreDay(void 0, now);
      }
      const snapshot = this.snapshot;
      if (snapshot) {
        try {
          this.routes = await this.core.routeTable(snapshot);
        } catch {
          this.routes = null;
        }
      }
      if (probe) {
        try {
          this.network = await networkStatus();
        } catch {
          this.network = null;
        }
        this.internetDelay = snapshot?.phase === "running" ? await this.core.internetLatency(internetTestURL) : void 0;
      }
      await this.loadExternalIP(now);
      jarvis.ui.update();
    }
    /**
     * 外部 IP：五分钟内查过就不再查（P-3）。经宿主的 `net.fetch`——它走系统此刻的路由，代理开着时查到的就是出口。
     * @param now 此刻。
     */
    async loadExternalIP(now) {
      if (this.externalIP && now - this.externalIP.at < externalIPTTL) return;
      if (!this.snapshot?.granted.includes("network.https")) return;
      let ip = null;
      try {
        const response = await jarvis.net.fetch(externalIPURL, { method: "GET" });
        ip = response.status === 200 ? parseExternalIP(response.text) : null;
      } catch {
        ip = null;
      }
      this.externalIP = { ip, at: now };
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
      this.setMessage(result.message ? result : null);
      await this.refresh();
    }
    setMessage(result) {
      this.message = result;
      this.messageAt = Date.now();
    }
    /**
     * 窗口页头此刻要不要写上一个动作的结果（jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-2）：
     * 出错的一直留到下一个动作；成功的停 {@link messageDwell} 就换回这一页的状态——不然「代理已开启」会一直挡着实时的状态行。
     * @param now Unix 毫秒。
     * @returns 要写的那一句；不写为 `null`。
     */
    headerMessage(now) {
      if (!this.message) return null;
      return !this.message.ok || now - this.messageAt < messageDwell ? this.message : null;
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
        await this.refresh();
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
     * @param view 哪一页（认旧页名：工具箱里「去窗口里看订阅 / 日志」那几处）。
     */
    openWindow(view) {
      this.view = legacyViews[view] ?? view;
      void jarvis.window.open().catch(() => void 0);
    }
    /**
     * 换窗口里的页（左边栏）。
     * @param view 哪一页。
     */
    async showView(view) {
      this.view = view;
      jarvis.ui.update();
      if (view === "processes") await this.loadLogs();
      if (view === "rules" || view === "activity") await this.loadDashboard(false);
    }
    /** 展开 / 收起工具箱「订阅」那一段的地址列表。 */
    toggleManageSubscriptions() {
      this.manageSubscriptions = !this.manageSubscriptions;
      jarvis.ui.update();
    }
    /**
     * 「流量」卡换一份。
     * @param scope 全部 / 仅代理。
     */
    setTrafficScope(scope) {
      this.trafficScope = scope;
      jarvis.ui.update();
    }
    /**
     * Top 10 换一类。
     * @param category 进程与设备 / 域名 / 策略。
     */
    setTopCategory(category) {
      this.topCategory = category;
      jarvis.ui.update();
    }
    /**
     * 「活动」页的「系统代理」开关（P-3）：开着时就是设 / 还原系统代理；关着时打开它 = 开启代理（开启时按偏好顺手设系统代理）。
     * @param on 开还是关。
     */
    activitySystemProxy(on) {
      if (this.snapshot?.phase === "running") return this.setSystemProxy(on);
      return on ? this.toggle(true) : Promise.resolve();
    }
    /**
     * 「活动」页的「增强模式」开关：开着时换内核；关着时打开它 = 记下要增强模式并开启代理，关掉只记下。
     * @param on 开还是关。
     */
    activityTun(on) {
      if (this.snapshot?.phase === "running" || !on) return this.setTun(on);
      return this.run(async () => {
        const result = await this.core.setTun(true);
        if (!result.ok) return result;
        return this.core.turnOn();
      });
    }
    /**
     * 策略页点一张节点卡（P-3）：选它，并只测它一个的延迟。
     * @param name 节点名或「自动选择」。
     */
    pickNode(name) {
      return this.run(async () => {
        const result = await this.core.selectNode(name);
        if (!result.ok) return result;
        if (this.snapshot?.phase !== "running") return { ok: true, message: "" };
        const tested = await this.core.testLatency([name]);
        return tested.ok ? { ok: true, message: "" } : tested;
      });
    }
    /**
     * 策略页点导入的策略组里的一张卡：选它，并测它的延迟。
     * @param group 组。
     * @param member 组员 tag。
     */
    pickGroupMember(group, member) {
      return this.run(async () => {
        const result = await this.core.selectGroupMember(group, member);
        if (!result.ok) return result;
        if (this.snapshot?.phase !== "running") return { ok: true, message: "" };
        const tested = await this.core.testLatency([member]);
        return tested.ok ? { ok: true, message: "" } : tested;
      });
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
    /** 开 / 关增强模式（开着就换内核重开；第一次打开时宿主弹管理员密码框）。 */
    setTun(on) {
      return this.run(() => this.core.setTun(on));
    }
    /** 只问增强模式这一项授权（只在用户按下的回调里有效）。 */
    grantTunnel() {
      return this.run(async () => {
        const result = await jarvis.permissions.request([tunnelCapability]);
        await this.refresh();
        this.observe();
        return result.granted.includes(tunnelCapability) ? { ok: true, message: "" } : { ok: false, message: "\u6CA1\u6709\u6388\u6743\u589E\u5F3A\u6A21\u5F0F\uFF1A\u7167\u5E38\u7528\u7CFB\u7EDF\u4EE3\u7406\u6A21\u5F0F" };
      });
    }
    /** 给导入的一个策略组换组员。 */
    selectGroupMember(group, member) {
      return this.run(() => this.core.selectGroupMember(group, member));
    }
    /** 重新载入配置（不断进程）。 */
    reload() {
      return this.run(() => this.core.reload());
    }
    /**
     * 给一个域名定策略（`null` = 删掉它的规则）。
     * @param domain 可注册域名。
     * @param policy 策略。
     */
    setPageRule(domain, policy) {
      return this.run(() => this.core.setPageRule(domain, policy));
    }
    /** 删一条页面规则。 */
    removePageRule(id) {
      return this.run(() => this.core.removePageRule(id));
    }
    /** 读一次浏览器的当前页面（「规则」页上那一段）。 */
    readPage() {
      return this.run(async () => {
        if (!this.snapshot?.granted.includes("browser.activeTab")) {
          const result = await jarvis.permissions.request(["browser.activeTab"]);
          if (!result.granted.includes("browser.activeTab")) return { ok: false, message: "\u6CA1\u6709\u6388\u6743\u8BFB\u53D6\u6D4F\u89C8\u5668\u5F53\u524D\u9875" };
        }
        const granted = await this.core.granted();
        const page = await this.core.currentPage(granted, seenConnections(this.meter.recent(Date.now(), 2e3)));
        this.currentPage = page;
        return page.status === "ok" || page.status === "unsupported" ? { ok: true, message: "" } : { ok: false, message: page.message || "\u8BFB\u4E0D\u5230\u6D4F\u89C8\u5668\u7684\u5730\u5740" };
      });
    }
    /** 挑一份 Surge 配置导入（宿主画打开面板，起点是 Surge 存配置的地方）。 */
    importSurge() {
      return this.run(async () => {
        if (!this.snapshot?.granted.includes("files.pick")) {
          const result = await jarvis.permissions.request(["files.pick"]);
          if (!result.granted.includes("files.pick")) return { ok: false, message: "\u6CA1\u6709\u6388\u6743\u6311\u6587\u4EF6\uFF1A\u5BFC\u5165\u8981\u4F60\u5728\u6253\u5F00\u9762\u677F\u91CC\u4EB2\u624B\u6311\u90A3\u4EFD\u914D\u7F6E" };
        }
        const picked = await jarvis.files.pick({ title: "\u9009\u4E00\u4EFD Surge \u914D\u7F6E\uFF08.conf\uFF09", directory: surgeProfilesDirectory, extensions: ["conf", "txt"] });
        if (!picked) return { ok: true, message: "" };
        this.view = "rules";
        return this.core.importSurge(picked.text, picked.name);
      });
    }
    /** 撤掉导入的 Surge 配置。 */
    clearSurge() {
      return this.run(() => this.core.clearSurge());
    }
    /** 拉一遍外部规则集。 */
    updateRuleSets() {
      return this.run(async () => {
        const result = await this.core.updateRuleSets();
        return result.message ? result : { ok: true, message: "\u6CA1\u6709\u8981\u62C9\u7684\u5916\u90E8\u89C4\u5219\u96C6" };
      });
    }
    /**
     * 命令（菜单栏「导入 Surge 配置」「规则」经它开窗口）。
     * @param id 命令 id。
     */
    async command(id) {
      this.view = "rules";
      void this.loadDashboard(false);
      jarvis.ui.update();
      if (id === "import-surge") await this.importSurge();
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
    /**
     * 进程页点一个程序（D-7）：右边只看它的连接；再点一次已选中的那一个 = 回到全部。
     * @param name 程序名（进程表那一行的 id）。
     */
    selectProcess(name) {
      this.processSelection = this.processSelection === name ? null : name;
      jarvis.ui.update();
    }
    /**
     * 进程页页头的搜索框。
     * @param value 字。
     */
    searchProcesses(value) {
      this.processFilter = value;
      jarvis.ui.update();
    }
    /**
     * 策略页左栏换一个策略组（D-7）；节点搜索框随之清空——它搜的是上一组的节点。
     * @param name 组名。
     */
    showPolicyGroup(name) {
      if (this.policyGroup === name) return;
      this.policyGroup = name;
      this.filter = "";
      jarvis.ui.update();
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
      toggle: (context) => background.command(context),
      // 菜单栏「导入 Surge 配置」「规则」：窗口命令跑在前台会话——挑文件要用户在场。
      "import-surge": () => session.command("import-surge"),
      rules: () => session.command("rules")
    }
  });
})();
