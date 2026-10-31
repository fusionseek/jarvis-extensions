// jarvis-extension bundle · input-source@1.0.0 · sdk 2.13.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
          ...options.monogram === void 0 ? {} : { monogram: options.monogram },
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
      activeTab: () => call.browser("activeTab"),
      // SDK 2.13（jarvis-mac `specs/20261030-234919-input-source-site-rules` S-1）：退订走 `browser.unsubscribe`。
      watchActiveTab: (listener) => runtime.subscribe("browser", "watchActiveTab", listener)
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
      list: () => call.apps("list"),
      // SDK 2.13：图标按需取，去重后上线缆（宿主拒绝重复）。
      icons: (bundleIds) => call.apps("icons", { bundleIds: [...new Set(bundleIds)] })
    },
    system: {
      openURL: (url) => call.system("openURL", { url }),
      openExtensionSettings: () => call.system("openExtensionSettings")
    }
  };

  // extensions/input-source/src/model.ts
  var defaultSettings = {
    others: "keep",
    hud: true,
    hudAnchor: "screen",
    hudOnManual: false,
    menuBarLabel: true,
    paused: false
  };
  function readSettings(preferences) {
    const pick = (value, allowed, fallback) => typeof value === "string" && allowed.includes(value) ? value : fallback;
    const flag = (value, fallback) => typeof value === "boolean" ? value : fallback;
    return {
      others: pick(preferences.others, ["keep", "remember", "default"], defaultSettings.others),
      hud: flag(preferences.hud, defaultSettings.hud),
      // 原来的 caret / window / pointer 三档去掉了（仓库主人要固定的位置）：存着它们的读作默认。
      hudAnchor: pick(preferences.hudAnchor, ["screen", "orb"], defaultSettings.hudAnchor),
      hudOnManual: flag(preferences.hudOnManual, defaultSettings.hudOnManual),
      menuBarLabel: flag(preferences.menuBarLabel, defaultSettings.menuBarLabel),
      paused: flag(preferences.paused, defaultSettings.paused)
    };
  }
  var emptyMemory = { rules: {}, lastUsed: {}, sites: [] };
  var maximumRules = 300;
  var maximumRemembered = 300;
  function resolveTarget(bundleId, memory, settings, enabled, page2) {
    if (page2 && page2.bundleId === bundleId) {
      const site = matchSite(page2.url, memory.sites);
      if (site && enabled.includes(site.source)) return site.source;
    }
    const rule = memory.rules[bundleId];
    let target;
    if (rule) {
      target = rule.mode === "fixed" ? rule.source : memory.lastUsed[bundleId];
    } else if (settings.others === "remember") {
      target = memory.lastUsed[bundleId];
    } else if (settings.others === "default") {
      target = memory.fallbackSource;
    }
    return target !== void 0 && enabled.includes(target) ? target : void 0;
  }
  function remember(lastUsed, bundleId, source) {
    if (lastUsed[bundleId] === source) return lastUsed;
    const next = {};
    const keys = Object.keys(lastUsed).filter((key) => key !== bundleId);
    for (const key of keys.slice(Math.max(0, keys.length - (maximumRemembered - 1)))) next[key] = lastUsed[key];
    next[bundleId] = source;
    return next;
  }
  function ruleChoice(rule) {
    if (!rule) return "none";
    return rule.mode === "fixed" ? `fixed:${rule.source}` : rule.mode;
  }
  function ruleFromChoice(choice, name) {
    if (choice.startsWith("fixed:")) return { mode: "fixed", source: choice.slice("fixed:".length), name };
    if (choice === "remember") return { mode: "remember", name };
    return void 0;
  }
  function setRule(rules, bundleId, rule) {
    const next = { ...rules };
    if (rule === void 0) {
      delete next[bundleId];
      return next;
    }
    if (!(bundleId in next) && Object.keys(next).length >= maximumRules) return rules;
    next[bundleId] = rule;
    return next;
  }
  var othersTitles = {
    keep: "\u4E0D\u52A8",
    remember: "\u8BB0\u4F4F\u4E0A\u6B21\u7528\u7684",
    default: "\u6362\u6210\u9ED8\u8BA4\u8F93\u5165\u6CD5"
  };
  function othersTitle(others) {
    return othersTitles[others];
  }
  function isSystemSource(source) {
    return source.id.startsWith("com.apple.");
  }
  function shortLabel(source) {
    if (!source) return "";
    const language = source.languages[0] ?? "";
    if (language.startsWith("zh")) return language === "zh-Hant" ? "\u7E41" : "\u4E2D";
    if (language.startsWith("ja")) return "\u3042";
    if (language.startsWith("ko")) return "\uD55C";
    const first = [...source.name.trim()][0] ?? "";
    return first.toUpperCase();
  }
  function fixedItemID(index) {
    return `fixed:${index}`;
  }
  function choiceFromMenuItem(itemId, sources) {
    if (itemId === "pause") return "pause";
    if (itemId === "remember" || itemId === "none") return itemId;
    if (itemId.startsWith("site:")) return void 0;
    const match = /^fixed:(\d+)$/.exec(itemId);
    if (!match) return void 0;
    const source = sources[Number(match[1])];
    return source ? `fixed:${source.id}` : void 0;
  }
  function menuModel(state) {
    const current = state.sources.find((source) => source.id === state.currentId);
    const items = [];
    if (state.app) {
      const rule = state.rules[state.app.bundleId];
      const choice = ruleChoice(rule);
      items.push({ kind: "header", title: clip(`\u5728\u300C${state.app.name}\u300D\u91CC\u7528`, 80) });
      state.sources.forEach((source, index) => {
        items.push({ kind: "item", id: fixedItemID(index), title: clip(source.name, 80), checked: choice === `fixed:${source.id}` });
      });
      items.push(
        { kind: "item", id: "remember", title: "\u8BB0\u4F4F\u4E0A\u6B21\u7528\u7684", checked: choice === "remember" },
        {
          kind: "item",
          id: "none",
          title: "\u65E0\u89C4\u5219",
          subtitle: clip(`\u8DDF\u7740\u300C\u65E0\u89C4\u5219\u7684\u5E94\u7528\u300D\uFF1A${othersTitle(state.settings.others)}`, 80),
          checked: choice === "none"
        },
        { kind: "separator" }
      );
    }
    const site = state.page ? sitePatternFor(state.page.url, state.sites ?? []) : void 0;
    if (site) {
      const matched = matchSite(state.page.url, state.sites ?? []);
      items.push({ kind: "header", title: clip(`\u5728\u300C${site}\u300D\u4E0A\u7528`, 80) });
      state.sources.forEach((source, index) => {
        items.push({ kind: "item", id: siteItemID(index), title: clip(source.name, 80), checked: matched?.source === source.id });
      });
      items.push(
        {
          kind: "item",
          id: "site:none",
          title: "\u8DDF\u968F\u5E94\u7528",
          subtitle: matched ? "\u5220\u6389\u8FD9\u4E2A\u7F51\u7AD9\u7684\u89C4\u5219" : "\u8FD9\u4E2A\u7F51\u7AD9\u6CA1\u6709\u89C4\u5219\uFF0C\u6309\u5E94\u7528\u7684\u6765",
          checked: !matched
        },
        { kind: "separator" }
      );
    }
    items.push({
      kind: "item",
      id: "pause",
      title: "\u6682\u505C\u81EA\u52A8\u5207\u6362",
      subtitle: state.settings.paused ? "\u53EA\u8BB0\u4E0B\u4F60\u7528\u7684\u8F93\u5165\u6CD5\uFF0C\u4E0D\u66FF\u4F60\u5207" : void 0,
      checked: state.settings.paused
    });
    const label = state.settings.menuBarLabel ? shortLabel(current) : "";
    return {
      symbol: state.settings.paused ? "keyboard.badge.ellipsis" : "keyboard",
      ...label ? { title: label } : {},
      tooltip: clip(current ? `\u6B64\u523B\uFF1A${current.name}${state.settings.paused ? "\uFF08\u81EA\u52A8\u5207\u6362\u5DF2\u6682\u505C\uFF09" : ""}` : "\u8F93\u5165\u6CD5\u5207\u6362", 80),
      items
    };
  }
  function choiceTitle(choice, sources) {
    if (choice.startsWith("fixed:")) {
      const id = choice.slice("fixed:".length);
      const source = sources.find((candidate) => candidate.id === id);
      return source ? `\u7528 ${source.name}` : "\u7528\u4E00\u4E2A\u5DF2\u505C\u7528\u7684\u8F93\u5165\u6CD5";
    }
    if (choice === "remember") return "\u8BB0\u4F4F\u4E0A\u6B21\u7528\u7684";
    return "\u65E0\u89C4\u5219";
  }
  function choiceChips(sources) {
    const chips = sources.map((source) => ({
      value: `fixed:${source.id}`,
      title: source.name,
      help: `\u5207\u5230\u8FD9\u4E2A\u5E94\u7528\u5C31\u6362\u6210 ${source.name}`,
      image: source.icon,
      symbol: "keyboard"
    }));
    chips.push(
      { value: "remember", title: "\u8BB0\u4F4F\u4E0A\u6B21", help: "\u6362\u6210\u4F60\u4E0A\u6B21\u5728\u8FD9\u4E2A\u5E94\u7528\u91CC\u7528\u7684\u90A3\u4E2A", symbol: "arrow.uturn.backward" },
      { value: "none", title: "\u65E0\u89C4\u5219", help: "\u4E0D\u7ED9\u5B83\u5B9A\u89C4\u5219\uFF0C\u8DDF\u7740\u300C\u65E0\u89C4\u5219\u7684\u5E94\u7528\u300D\u90A3\u4E00\u6761\u8D70\uFF08\u9ED8\u8BA4\u4E0D\u52A8\uFF09", symbol: "circle.dashed" }
    );
    return chips;
  }
  function groupRules(rules, sources) {
    const byName = (a, b) => (a.rule.name || a.bundleId).localeCompare(b.rule.name || b.bundleId, "zh-Hans");
    const entries = Object.entries(rules).map(([bundleId, rule]) => ({ bundleId, rule }));
    const enabled = new Set(sources.map((source) => source.id));
    const groups = sources.map((source) => ({
      key: `fixed:${source.id}`,
      title: `\u7528 ${source.name}`,
      source,
      entries: entries.filter((entry) => entry.rule.mode === "fixed" && entry.rule.source === source.id).sort(byName),
      addable: true
    }));
    const remembered = entries.filter((entry) => entry.rule.mode === "remember").sort(byName);
    if (remembered.length > 0) groups.push({ key: "remember", title: "\u8BB0\u4F4F\u4E0A\u6B21\u7528\u7684", entries: remembered, addable: true });
    const stale = entries.filter((entry) => entry.rule.mode === "fixed" && !enabled.has(entry.rule.source)).sort(byName);
    if (stale.length > 0) groups.push({ key: "stale", title: "\u8F93\u5165\u6CD5\u5DF2\u505C\u7528", entries: stale, addable: false });
    return groups;
  }
  function siteList(sites, sources) {
    return [...sites].sort((a, b) => a.pattern.localeCompare(b.pattern)).map((site) => ({ site, source: sources.find((source) => source.id === site.source) }));
  }
  function learnsOnLeave(bundleId, memory, page2) {
    if (memory.rules[bundleId]?.mode === "fixed") return false;
    if (page2 && page2.bundleId === bundleId && matchSite(page2.url, memory.sites)) return false;
    return true;
  }
  var maximumCandidates = 60;
  function candidates(apps, query) {
    const byBundle = /* @__PURE__ */ new Map();
    for (const app of apps) {
      if (!app.bundleId) continue;
      const existing = byBundle.get(app.bundleId);
      if (existing && (existing.lastUsedAt ?? -1) >= (app.lastUsedAt ?? -1)) continue;
      byBundle.set(app.bundleId, { bundleId: app.bundleId, name: app.name, lastUsedAt: app.lastUsedAt, category: app.category });
    }
    const needle = query.trim().toLowerCase();
    const all = [...byBundle.values()].filter((app) => !needle || app.name.toLowerCase().includes(needle) || app.bundleId.toLowerCase().includes(needle)).sort((a, b) => {
      if (a.lastUsedAt !== b.lastUsedAt) return (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1);
      return a.name.localeCompare(b.name, "zh-Hans");
    });
    return { list: all.slice(0, maximumCandidates), truncated: all.length > maximumCandidates };
  }
  var maximumSuggestions = 6;
  var suggestionWindowMs = 30 * 24 * 60 * 60 * 1e3;
  function suggestions(apps, rules, sources, now) {
    const layout2 = sources.find((source) => source.kind === "keyboardLayout");
    const cjk = sources.find((source) => source.languages.some((language) => /^(zh|ja|ko)/.test(language)));
    const targetFor = (category) => {
      if (category === "public.app-category.developer-tools") return layout2;
      if (category === "public.app-category.social-networking") return cjk;
      return void 0;
    };
    const seen = /* @__PURE__ */ new Set();
    return candidates(apps, "").list.filter((app) => app.lastUsedAt !== null && now - app.lastUsedAt <= suggestionWindowMs && !(app.bundleId in rules)).flatMap((app) => {
      const target = targetFor(app.category);
      if (!target || seen.has(app.bundleId)) return [];
      seen.add(app.bundleId);
      return [{ bundleId: app.bundleId, name: app.name, choice: `fixed:${target.id}` }];
    }).slice(0, maximumSuggestions);
  }
  function suggestionSummary(list, sources) {
    const byChoice = /* @__PURE__ */ new Map();
    for (const item of list) byChoice.set(item.choice, [...byChoice.get(item.choice) ?? [], item.name]);
    return [...byChoice.entries()].map(([choice, names]) => `${names.join("\u3001")} \u2192 ${choiceTitle(choice, sources).replace(/^用 /, "")}`).join("\uFF1B");
  }
  function lastUsedTitle(lastUsedAt, now) {
    if (lastUsedAt === null) return void 0;
    const days = Math.floor((now - lastUsedAt) / (24 * 60 * 60 * 1e3));
    if (days <= 0) return "\u4ECA\u5929\u7528\u8FC7";
    if (days === 1) return "\u6628\u5929\u7528\u8FC7";
    if (days < 30) return `${days} \u5929\u524D\u7528\u8FC7`;
    const months = Math.floor(days / 30);
    return months < 12 ? `${months} \u4E2A\u6708\u524D\u7528\u8FC7` : "\u4E00\u5E74\u591A\u6CA1\u7528\u8FC7";
  }
  function clip(text, limit) {
    const characters = [...text];
    return characters.length <= limit ? text : characters.slice(0, limit).join("");
  }
  var maximumSites = 200;
  var HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
  function locate(text) {
    let rest = text.trim();
    const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(rest);
    if (scheme) rest = rest.slice(scheme[0].length);
    rest = rest.replace(/[?#].*$/, "");
    const slash = rest.indexOf("/");
    let host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
    let path = slash < 0 ? "" : rest.slice(slash);
    host = host.replace(/^[^@]*@/, "").replace(/:\d*$/, "").replace(/^\*\./, "").replace(/^\.+/, "").replace(/\.+$/, "");
    if (host.startsWith("www.")) host = host.slice(4);
    path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    if (!host || host.length > 253 || !HOST_PATTERN.test(host)) return void 0;
    return { host, path };
  }
  function normalizePattern(input) {
    const location = locate(input);
    return location ? location.host + location.path : void 0;
  }
  function split(pattern) {
    const slash = pattern.indexOf("/");
    return slash < 0 ? { host: pattern, path: "" } : { host: pattern.slice(0, slash), path: pattern.slice(slash) };
  }
  function matchSite(url, sites) {
    if (!/^https?:\/\//i.test(url)) return void 0;
    const page2 = locate(url);
    if (!page2) return void 0;
    let best;
    for (const site of sites) {
      const { host, path } = split(site.pattern);
      if (page2.host !== host && !page2.host.endsWith(`.${host}`)) continue;
      if (path && page2.path !== path && !page2.path.startsWith(`${path}/`)) continue;
      if (!best || site.pattern.length > best.pattern.length) best = site;
    }
    return best;
  }
  function sitePatternFor(url, sites) {
    if (!/^https?:\/\//i.test(url)) return void 0;
    return matchSite(url, sites)?.pattern ?? locate(url)?.host;
  }
  function setSite(sites, pattern, source) {
    const others = sites.filter((site) => site.pattern !== pattern);
    if (source === void 0) return others;
    if (others.length === sites.length && sites.length >= maximumSites) return [...sites];
    return [...others, { pattern, source }];
  }
  function siteItemID(index) {
    return `site:${index}`;
  }
  function siteChoiceFromMenuItem(itemId, sources) {
    if (itemId === "site:none") return { source: void 0 };
    const match = /^site:(\d+)$/.exec(itemId);
    if (!match) return void 0;
    const source = sources[Number(match[1])];
    return source ? { source: source.id } : void 0;
  }

  // extensions/input-source/src/storage.ts
  var storageKeys = {
    rules: "rules",
    lastUsed: "lastUsed",
    fallbackSource: "fallbackSource",
    sites: "sites"
  };
  function isRule(value) {
    if (typeof value !== "object" || value === null) return false;
    const rule = value;
    if (typeof rule.name !== "string") return false;
    if (rule.mode === "fixed") return typeof rule.source === "string" && rule.source.length > 0;
    return rule.mode === "remember";
  }
  async function readRules() {
    const raw = await jarvis.storage.get(storageKeys.rules).catch(() => null);
    const rules = {};
    if (typeof raw === "object" && raw !== null) {
      for (const [bundleId, rule] of Object.entries(raw)) if (isRule(rule)) rules[bundleId] = rule;
    }
    return rules;
  }
  async function readLastUsed() {
    const raw = await jarvis.storage.get(storageKeys.lastUsed).catch(() => null);
    const lastUsed = {};
    if (typeof raw === "object" && raw !== null) {
      for (const [bundleId, source] of Object.entries(raw)) if (typeof source === "string" && source) lastUsed[bundleId] = source;
    }
    return lastUsed;
  }
  async function readFallback() {
    const raw = await jarvis.storage.get(storageKeys.fallbackSource).catch(() => null);
    return typeof raw === "string" && raw ? raw : void 0;
  }
  async function readSites() {
    const raw = await jarvis.storage.get(storageKeys.sites).catch(() => null);
    const sites = [];
    if (!Array.isArray(raw)) return sites;
    const seen = /* @__PURE__ */ new Set();
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const { pattern, source } = item;
      if (typeof pattern !== "string" || typeof source !== "string" || !source) continue;
      const normalized = normalizePattern(pattern);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      sites.push({ pattern: normalized, source });
      if (sites.length >= maximumSites) break;
    }
    return sites;
  }

  // extensions/input-source/src/controller.ts
  var HUD_LIMIT = 24;
  var ORB_DURATION_MS = 2e3;
  var VERIFY_DELAY_MS = 300;
  var Controller = class {
    constructor() {
      this.settings = defaultSettings;
      this.memory = emptyMemory;
      this.sources = [];
      /** 推最后一份菜单时的输入法：菜单项按序号引用它。 */
      this.menuSources = [];
      this.granted = [];
      this.started = false;
      /** 订阅之后宿主先补发一条此刻的前台：那一条只记下来，不切——启动、点了「允许」不该替你换掉正在用的输入法。 */
      this.primed = false;
      /** 前台事件一条一条处理（F-1）：并发处理时，切到上一个应用的那一次可能晚落地，把这一次覆盖掉。 */
      this.queue = Promise.resolve();
      /** 第几次换前台（或换了页）：处理到一条时后面已经又换了，这一条作废（只认最新一次）。 */
      this.activation = 0;
      /** 每个浏览器的上一页（S-2）：切回浏览器、地址没变时宿主不再推，靠这份缓存当场对上。 */
      this.pages = /* @__PURE__ */ new Map();
      /**
       * 跳过下一条网页事件：启动、刚允许、从菜单定了第一条网站规则时订阅，宿主补发的那一条只记下、不切（同 `primed`）。
       * 至多跳一条；下一次真的换了前台就不再跳。订阅发生在「切到浏览器」的那一次处理里时不跳——那一条正是用户刚切过来的那一页。
       */
      this.skipReplay = false;
    }
    /** 此刻在前台的应用（测试读）。 */
    get frontmost() {
      return this.app;
    }
    /** 此刻的记忆（测试读）。 */
    get state() {
      return this.memory;
    }
    /**
     * 菜单栏域的 `start`（应用启动、启用 / 更新时各一次；图标关着也照样来）。重复调用不会多订一份。
     * @param preferences 此刻的偏好。
     * @param granted 此刻的授权。
     */
    async start(preferences, granted) {
      this.settings = readSettings(preferences);
      if (!this.started) {
        this.started = true;
        await this.loadMemory();
        this.stopPreferences = jarvis.preferences.onChange(() => void this.reloadPreferences());
        this.stopPermissions = jarvis.permissions.onChange((now) => void this.applyGrants(now));
      }
      await this.applyGrants(granted);
    }
    /** 菜单点开的那一刻：页面可能刚改过规则，重读一次再画。 */
    async open(context) {
      await this.ensureStarted(context);
      await this.loadRules();
      await this.readPageOnce();
      await this.render();
    }
    /**
     * 菜单里点了一项：给此刻的应用定规则，或暂停 / 恢复。
     * @param itemId 菜单项 id。
     * @param context 此刻的授权与偏好。
     */
    async select(itemId, context) {
      await this.ensureStarted(context);
      const site = siteChoiceFromMenuItem(itemId, this.menuSources);
      if (site) return this.applySite(site.source);
      const choice = choiceFromMenuItem(itemId, this.menuSources);
      if (choice === void 0) return;
      if (choice === "pause") return this.togglePause();
      if (!this.app) return;
      await this.applyRule(this.app, choice);
    }
    /** 静默命令 `previous`：切回上一个输入法。 */
    async previous(context) {
      await this.ensureStarted(context);
      if (!this.previousId || !this.granted.includes("inputSources.select")) return;
      const target = this.previousId;
      const result = await jarvis.inputSources.select(target).catch(() => void 0);
      if (result?.effective) {
        this.note(target);
        await this.showHUD(this.source(target)?.name ?? target, this.source(target));
      }
    }
    /** 静默命令 `remember-here`：把此刻的输入法定给当前应用。 */
    async rememberHere(context) {
      await this.ensureStarted(context);
      if (!this.app || !this.currentId) return;
      await this.applyRule(this.app, `fixed:${this.currentId}`);
      const source = this.source(this.currentId);
      await this.showHUD(`${this.app.name} \u7528 ${source?.name ?? this.currentId}`, source);
    }
    /** 静默命令 `pause`：暂停 / 恢复自动切换。 */
    async pause(context) {
      await this.ensureStarted(context);
      await this.togglePause();
    }
    // MARK: - 订阅
    async ensureStarted(context) {
      if (!this.started) await this.start(context.preferences, context.granted);
      else if ([...context.granted].sort().join() !== this.granted.join()) await this.applyGrants(context.granted);
    }
    /** 按授权订 / 退两条订阅。用户刚在页面里点了「允许」时，宿主的 `permissionsChanged` 走到这里。 */
    async applyGrants(granted) {
      this.granted = [...granted].sort();
      if (granted.includes("inputSources.read")) {
        this.stopSources ?? (this.stopSources = jarvis.inputSources.observe((event) => void this.onInputSource(event)));
        await this.reloadSources();
      } else {
        this.stopSources?.();
        this.stopSources = void 0;
      }
      if (granted.includes("system.activity")) {
        if (!this.stopFrontmost) {
          this.primed = false;
          this.stopFrontmost = jarvis.frontmostApp.observe((app) => void this.onFrontmost(app));
        }
      } else {
        this.stopFrontmost?.();
        this.stopFrontmost = void 0;
      }
      this.memory = { ...this.memory, sites: await readSites() };
      this.updateBrowserWatch(false);
      await this.render();
    }
    /**
     * 订 / 退前台浏览器当前页（S-2）：有 `browser.activeTab.watch` 授权、且至少一条网站规则才订——没有网站规则的人不付这份代价。
     * @param actOnReplay 订阅时宿主补发的那一条要不要照规则切（在「切到浏览器」的那一次处理里订的才要）。
     */
    updateBrowserWatch(actOnReplay) {
      const wanted = this.granted.includes("browser.activeTab.watch") && this.memory.sites.length > 0;
      if (wanted && !this.stopBrowser) {
        this.skipReplay = !actOnReplay;
        this.stopBrowser = jarvis.browser.watchActiveTab((page2) => void this.onPage(page2));
      } else if (!wanted && this.stopBrowser) {
        this.stopBrowser();
        this.stopBrowser = void 0;
        this.pages.clear();
      }
    }
    /** 前台那个浏览器缓存着的一页；不是浏览器、没读到为 `undefined`。 */
    pageFor(bundleId) {
      const url = this.pages.get(bundleId);
      return url === void 0 ? void 0 : { bundleId, url };
    }
    /** 菜单点开时，没订着当前页就读一次（有 `browser.activeTab` 授权才读）：第一条网站规则也能从菜单里定。 */
    async readPageOnce() {
      if (this.stopBrowser || !this.app || !this.granted.includes("browser.activeTab")) return;
      const tab = await jarvis.browser.activeTab().catch(() => null);
      if (!tab || tab.browser.bundleId !== this.app.bundleId || !tab.frontmost) return;
      if (tab.status === "ok" && tab.url) this.pages.set(tab.browser.bundleId, tab.url);
      else this.pages.delete(tab.browser.bundleId);
    }
    async reloadSources() {
      try {
        const [sources, current] = await Promise.all([jarvis.inputSources.list(), jarvis.inputSources.current()]);
        this.sources = sources;
        if (current.id !== this.currentId) this.note(current.id);
      } catch (error) {
        jarvis.log.warn("\u8BFB\u4E0D\u51FA\u8F93\u5165\u6CD5", error instanceof Error ? error.message : String(error));
      }
    }
    async reloadPreferences() {
      this.settings = readSettings(await jarvis.preferences.all());
      await this.render();
    }
    /**
     * 前台换了。
     * @param app 换到的应用。
     */
    onFrontmost(app) {
      const left = this.app;
      const switched = left?.bundleId !== app.bundleId;
      this.app = app;
      const token = ++this.activation;
      const primed = this.primed;
      this.primed = true;
      if (primed) this.skipReplay = false;
      return this.enqueue(async () => {
        if (!primed) return this.render();
        if (switched && left) this.learn(left.bundleId);
        if (token !== this.activation) return;
        if (!switched || this.settings.paused || !this.granted.includes("inputSources.select")) return this.render();
        await this.loadRules();
        this.updateBrowserWatch(true);
        if (this.sources.length === 0) await this.reloadSources();
        const target = resolveTarget(app.bundleId, this.memory, this.settings, this.sources.map((source) => source.id), this.pageFor(app.bundleId));
        this.decided = target;
        if (target !== void 0 && token === this.activation) {
          const actual = (await jarvis.inputSources.current().catch(() => void 0))?.id;
          if (token !== this.activation) return;
          if (actual !== target) await this.switchTo(target, token);
        }
        await this.render();
      });
    }
    /**
     * 前台浏览器换了页（宿主 `browser.watchActiveTab`，S-2）。缓存先记下（同步：下一次切回这个浏览器要用）；
     * 决定出来的目标和这一次停留里已经决定过的一样就不切——同一网站里翻页不切，你在这一页上手动换了的也不换回去。
     * @param page 宿主推来的一页。
     */
    onPage(page2) {
      const bundleId = page2.browser.bundleId;
      if (page2.status === "ok" && page2.url) this.pages.set(bundleId, page2.url);
      else this.pages.delete(bundleId);
      const acts = !this.skipReplay;
      this.skipReplay = false;
      const token = ++this.activation;
      return this.enqueue(async () => {
        if (token !== this.activation) return;
        const app = this.app;
        if (!app || app.bundleId !== bundleId) return this.render();
        await this.loadRules();
        if (this.sources.length === 0) await this.reloadSources();
        const target = resolveTarget(bundleId, this.memory, this.settings, this.sources.map((source) => source.id), this.pageFor(bundleId));
        if (!acts || target === this.decided) {
          this.decided = target;
          return this.render();
        }
        this.decided = target;
        if (target === void 0 || this.settings.paused || !this.granted.includes("inputSources.select")) return this.render();
        const actual = (await jarvis.inputSources.current().catch(() => void 0))?.id;
        if (token !== this.activation) return;
        if (actual !== target) await this.switchTo(target, token);
        await this.render();
      });
    }
    /**
     * 换走一个应用时，把此刻用着的输入法记成「上次在它里面用的」（jarvis-mac `specs/20261031-080909-input-source-walkthrough-fixes` W-2）。
     * 只从手动换的那一下学，刚装上时谁都没记过：在 Warp 里一直用拼音、切到 Rider 换成 ABC、再切回 Warp，「记住上次」不知道该换回拼音。
     * 输入法是规则定的（固定规则、命中网站规则的那一页）不记。写库不等：下一次切换马上就要用内存里的这一份。
     * @param bundleId 被换走的应用。
     */
    learn(bundleId) {
      const id = this.currentId;
      if (id === void 0 || !learnsOnLeave(bundleId, this.memory, this.pageFor(bundleId))) return;
      const next = remember(this.memory.lastUsed, bundleId, id);
      if (next === this.memory.lastUsed) return;
      this.memory = { ...this.memory, lastUsed: next };
      void jarvis.storage.set(storageKeys.lastUsed, next).catch(() => void 0);
    }
    /** 排进前台事件的队列；出错只记日志，队列不断。 */
    enqueue(task) {
      const run = this.queue.then(task).catch((error) => {
        jarvis.log.warn("\u6309\u89C4\u5219\u6362\u8F93\u5165\u6CD5\u65F6\u51FA\u9519", error instanceof Error ? error.message : String(error));
      });
      this.queue = run;
      return run;
    }
    /**
     * 切完 300 ms 核对一次：前台还是它、输入源却不是目标，就再切一次，只补一次（F-1）。不循环：真有别的工具在抢，循环只会和它打架。
     * @param target 目标。
     * @param token 切的那一次是第几次换前台。
     */
    async verify(target, token) {
      if (token !== this.activation || this.settings.paused) return;
      const actual = (await jarvis.inputSources.current().catch(() => void 0))?.id;
      if (actual === void 0 || actual === target || token !== this.activation) return;
      jarvis.log.warn("\u5207\u8FC7\u53BB\u4E4B\u540E\u53C8\u88AB\u6539\u56DE\u53BB\u4E86\uFF0C\u518D\u5207\u4E00\u6B21", { target, actual });
      const result = await jarvis.inputSources.select(target).catch(() => void 0);
      if (result?.effective) this.note(target);
    }
    /**
     * 输入法换了（谁换的都推）。
     * @param event 宿主推来的一条。
     */
    async onInputSource(event) {
      if (event.type === "listChanged") {
        await this.reloadSources();
        return this.render();
      }
      this.note(event.id);
      if (!event.bySelf && this.app) {
        const next = remember(this.memory.lastUsed, this.app.bundleId, event.id);
        if (next !== this.memory.lastUsed) {
          this.memory = { ...this.memory, lastUsed: next };
          await jarvis.storage.set(storageKeys.lastUsed, next).catch(() => void 0);
        }
        if (this.settings.hud && this.settings.hudOnManual) await this.showHUD(this.source(event.id)?.name ?? event.id, this.source(event.id));
      }
      await this.render();
    }
    // MARK: - 动作
    async switchTo(target, token) {
      try {
        const result = await jarvis.inputSources.select(target);
        if (token !== void 0) setTimeout(() => void this.enqueue(() => this.verify(target, token)), VERIFY_DELAY_MS);
        if (!result.effective) {
          jarvis.log.warn("\u7CFB\u7EDF\u63A5\u4E86\u5374\u6CA1\u6362\u8FC7\u53BB", target);
          return;
        }
        this.note(target);
        if (this.settings.hud) await this.showHUD(this.source(target)?.name ?? target, this.source(target));
      } catch (error) {
        jarvis.log.warn("\u6362\u8F93\u5165\u6CD5\u5931\u8D25", error instanceof Error ? error.message : String(error));
      }
    }
    async applyRule(app, choice) {
      await this.loadRules();
      const rule = ruleFromChoice(choice, app.name);
      const rules = setRule(this.memory.rules, app.bundleId, rule);
      this.memory = { ...this.memory, rules };
      await jarvis.storage.set(storageKeys.rules, rules).catch(() => void 0);
      if (rule?.mode === "fixed" && rule.source !== this.currentId && this.granted.includes("inputSources.select")) await this.switchTo(rule.source);
      await this.render();
    }
    /**
     * 菜单里给此刻这一页定输入法（`source` 为 `undefined` = 删掉，跟随应用）。落到已经命中的那条上，没有就是这一页的主机名。
     * @param source 输入法 id。
     */
    async applySite(source) {
      const app = this.app;
      const url = app ? this.pages.get(app.bundleId) : void 0;
      if (!app || url === void 0) return;
      await this.loadRules();
      const pattern = sitePatternFor(url, this.memory.sites);
      if (!pattern) return;
      const sites = setSite(this.memory.sites, pattern, source);
      this.memory = { ...this.memory, sites };
      await jarvis.storage.set(storageKeys.sites, sites).catch(() => void 0);
      this.updateBrowserWatch(false);
      this.decided = resolveTarget(app.bundleId, this.memory, this.settings, this.sources.map((item) => item.id), this.pageFor(app.bundleId));
      if (this.decided !== void 0 && this.decided !== this.currentId && this.granted.includes("inputSources.select")) await this.switchTo(this.decided);
      await this.render();
    }
    async togglePause() {
      const paused = !this.settings.paused;
      this.settings = { ...this.settings, paused };
      await jarvis.preferences.set("paused", paused).catch(() => void 0);
      await this.showHUD(paused ? "\u81EA\u52A8\u5207\u6362\u5DF2\u6682\u505C" : "\u81EA\u52A8\u5207\u6362\u5DF2\u6062\u590D", void 0, paused ? "pause.fill" : "play.fill");
      await this.render();
    }
    note(id) {
      if (this.currentId !== void 0 && this.currentId !== id) this.previousId = this.currentId;
      this.currentId = id;
    }
    source(id) {
      return this.sources.find((source) => source.id === id);
    }
    async showHUD(text, source, symbol) {
      if (!this.granted.includes("hud.show")) return;
      const clipped = [...text].slice(0, HUD_LIMIT).join("");
      const art = hudArt(source, symbol);
      const anchor = this.settings.hudAnchor;
      await jarvis.hud.show({ text: clipped, anchor, ...anchor === "orb" ? { duration: ORB_DURATION_MS } : {}, ...art }).catch(() => void 0);
    }
    // MARK: - 存储
    async loadMemory() {
      const [rules, lastUsed, fallbackSource, sites] = await Promise.all([readRules(), readLastUsed(), readFallback(), readSites()]);
      this.memory = { rules, lastUsed, fallbackSource, sites };
    }
    async loadRules() {
      const [rules, fallbackSource, sites] = await Promise.all([readRules(), readFallback(), readSites()]);
      this.memory = { ...this.memory, rules, fallbackSource, sites };
    }
    async render() {
      this.menuSources = this.sources;
      await jarvis.menuBar.update(
        menuModel({
          app: this.app,
          page: this.app ? this.pageFor(this.app.bundleId) : void 0,
          sites: this.memory.sites,
          rules: this.memory.rules,
          sources: this.sources,
          currentId: this.currentId,
          settings: this.settings
        })
      ).catch(() => void 0);
    }
  };
  function hudArt(source, symbol) {
    if (source && isSystemSource(source)) {
      const label = shortLabel(source);
      if (label) return { monogram: label };
    }
    if (source?.icon) return { image: source.icon };
    return symbol ? { symbol } : {};
  }

  // extensions/input-source/src/page.ts
  var pageCapabilities = ["system.activity", "inputSources.read", "inputSources.select", "hud.show", "apps.read"];
  var siteCapabilities = ["browser.activeTab", "browser.activeTab.watch"];
  var ICON_BATCH = 40;
  var ICON_DEBOUNCE_MS = 300;
  var SUGGESTIONS_DISMISSED = "suggestionsDismissed";
  var GROUP_TINTS = ["blue", "violet", "amber", "live"];
  var CHIP_COLUMN_MINIMUM = 80;
  var PageSession = class {
    constructor() {
      this.status = { kind: "loading" };
      this.stage = { kind: "groups" };
      this.sources = [];
      this.rules = {};
      this.sites = [];
      /** 加网站那一步填的字。 */
      this.siteDraft = "";
      this.settings = readSettings({});
      /** 加应用那一步的搜索词。 */
      this.query = "";
      this.suggestionsDismissed = false;
      /** 应用图标（这个会话拿到的句柄）。 */
      this.icons = /* @__PURE__ */ new Map();
      this.granted = [];
    }
    /** 此刻（测试与渲染读）。 */
    now() {
      return Date.now();
    }
    /**
     * 页面出现了。
     * @param context 此刻的授权与偏好。
     */
    async activate(context) {
      this.granted = context.granted;
      this.settings = readSettings(context.preferences);
      this.stage = { kind: "groups" };
      this.editing = void 0;
      this.highlight = void 0;
      this.stopPreferences ?? (this.stopPreferences = jarvis.preferences.onChange((changes) => {
        this.settings = readSettings({ ...this.settings, ...changes });
        jarvis.ui.update();
      }));
      await this.load();
      if (this.status.kind === "ready") {
        await this.loadApps();
        await this.fetchIcons(this.visibleBundleIDs());
      }
    }
    /** 页面不在了。 */
    deactivate() {
      this.stopPreferences?.();
      this.stopPreferences = void 0;
      if (this.iconTimer !== void 0) clearTimeout(this.iconTimer);
      this.iconTimer = void 0;
    }
    async load() {
      if (!this.granted.includes("inputSources.read") || !this.granted.includes("system.activity")) {
        this.status = { kind: "denied" };
        return;
      }
      try {
        const [sources, current, app, rules, fallbackSource, dismissed, sites, page2] = await Promise.all([
          jarvis.inputSources.list(),
          jarvis.inputSources.current(),
          jarvis.frontmostApp.current(),
          readRules(),
          readFallback(),
          jarvis.storage.get(SUGGESTIONS_DISMISSED).catch(() => void 0),
          readSites(),
          this.readPage()
        ]);
        this.sites = sites;
        this.page = page2;
        this.sources = sources;
        this.currentId = current.id;
        this.app = app ?? void 0;
        if (app?.icon) this.icons.set(app.bundleId, app.icon);
        this.rules = rules;
        this.fallbackSource = fallbackSource;
        this.suggestionsDismissed = dismissed === true;
        this.status = { kind: "ready" };
      } catch (error) {
        this.status = { kind: "failed", message: error instanceof Error ? error.message : String(error) };
      }
    }
    /** 读一次此刻这一页（有 `browser.activeTab` 授权才读；读不到不当错）。 */
    async readPage() {
      if (!this.granted.includes("browser.activeTab")) return void 0;
      return jarvis.browser.activeTab().catch(() => null);
    }
    async loadApps() {
      if (this.apps !== void 0 || !this.granted.includes("apps.read")) return;
      this.apps = await jarvis.apps.list().catch(() => void 0);
    }
    /** 此刻画在屏上的那些应用：分组页是全部规则；加应用那一步是列表的前一屏。 */
    visibleBundleIDs() {
      if (this.stage.kind === "add") return candidates(this.apps ?? [], this.query).list.map((app) => app.bundleId);
      return Object.keys(this.rules);
    }
    /** 补没取过的图标（一次至多 40 个）。 */
    async fetchIcons(bundleIds) {
      if (!this.granted.includes("apps.read")) return;
      const missing = bundleIds.filter((id) => !this.icons.has(id)).slice(0, ICON_BATCH);
      if (missing.length === 0) return;
      const icons = await jarvis.apps.icons(missing).catch(() => []);
      for (const item of icons) if (item.icon) this.icons.set(item.bundleId, item.icon);
      jarvis.ui.update();
    }
    // MARK: - 规则
    /**
     * 给一个应用定规则（`none` = 删掉）。
     * @param bundleId 哪个应用。
     * @param name 应用名。
     * @param choice 选择。
     */
    async assign(bundleId, name, choice) {
      this.rules = setRule(this.rules, bundleId, ruleFromChoice(choice, name || this.rules[bundleId]?.name || bundleId));
      this.highlight = choice === "none" ? void 0 : bundleId;
      this.editing = void 0;
      await jarvis.storage.set(storageKeys.rules, this.rules);
    }
    /**
     * 删掉一条规则。
     * @param bundleId 哪个应用。
     */
    async remove(bundleId) {
      if (this.editing === bundleId) this.editing = void 0;
      if (this.highlight === bundleId) this.highlight = void 0;
      await this.assign(bundleId, "", "none");
    }
    /**
     * 给一个网站定输入法（`none` = 删掉，跟随应用）。
     * @param pattern 规范化过的 pattern。
     * @param choice 选择：`fixed:<id>` 或 `none`。
     */
    async assignSite(pattern, choice) {
      const source = choice.startsWith("fixed:") ? choice.slice("fixed:".length) : void 0;
      this.sites = setSite(this.sites, pattern, source);
      this.highlight = source === void 0 ? void 0 : siteKey(pattern);
      this.editing = void 0;
      await jarvis.storage.set(storageKeys.sites, this.sites);
    }
    /**
     * 删掉一条网站规则。
     * @param pattern 哪个网站。
     */
    async removeSite(pattern) {
      if (this.editing === siteKey(pattern)) this.editing = void 0;
      if (this.highlight === siteKey(pattern)) this.highlight = void 0;
      await this.assignSite(pattern, "none");
    }
    /**
     * 加网站。还没给读地址的两项授权时先问（只在按钮回调里调）；不给也照样能填，只是后台跟不上网页。
     * @param target 先选中的输入法（`fixed:<id>`）；不给时选此刻正在用的那一个（W-3）。
     */
    async startAddSite(target = this.defaultSiteTarget()) {
      if (!this.hasSiteAccess()) {
        const result = await jarvis.permissions.request([...siteCapabilities]);
        this.granted = result.granted;
      }
      this.stage = { kind: "addSite", target };
      this.siteDraft = "";
      this.editing = void 0;
      this.page = await this.readPage();
      jarvis.ui.update();
    }
    /**
     * 「添加网站」先选中哪个输入法：此刻正在用的那一个——你在网页里手动换成拼音、想让它以后自动换，打开就是拼音（W-3）。
     * @returns `fixed:<id>`。
     */
    defaultSiteTarget() {
      const id = this.sources.some((source) => source.id === this.currentId) ? this.currentId : this.sources[0]?.id;
      return `fixed:${id ?? ""}`;
    }
    /**
     * 加网站那一步换了输入法。
     * @param target `fixed:<id>`。
     */
    setSiteTarget(target) {
      if (this.stage.kind === "addSite") this.stage = { kind: "addSite", target };
    }
    /** 再问一次读地址的两项授权（加网站那一步的「允许」，只在按钮回调里调）。 */
    async requestSiteAccess() {
      const result = await jarvis.permissions.request([...siteCapabilities]);
      this.granted = result.granted;
      this.page = await this.readPage();
      jarvis.ui.update();
    }
    /** 此刻有没有读地址的两项授权（渲染读）。 */
    hasSiteAccess() {
      return siteCapabilities.every((id) => this.granted.includes(id));
    }
    /**
     * 加网站那一步填的字变了。
     * @param text 填的字。
     */
    setSiteDraft(text) {
      this.siteDraft = text;
    }
    /**
     * 用选中的输入法加上这个网站，回到分组页。
     * @param pattern 规范化过的 pattern。
     */
    async pickSite(pattern) {
      if (this.stage.kind !== "addSite") return;
      const target = this.stage.target;
      this.stage = { kind: "groups" };
      this.siteDraft = "";
      await this.assignSite(pattern, target);
    }
    /** 展开 / 收起一条规则的「换成」。 */
    toggleEditing(bundleId) {
      this.editing = this.editing === bundleId ? void 0 : bundleId;
      this.highlight = void 0;
    }
    // MARK: - 加应用那一步
    /**
     * 往一组里加应用。还没给应用列表的授权时先问（只在按钮回调里调）。
     * @param target 那一组的选择。
     */
    async startAdd(target) {
      if (!this.granted.includes("apps.read")) {
        const result = await jarvis.permissions.request(["apps.read"]);
        this.granted = result.granted;
        if (!this.granted.includes("apps.read")) return;
      }
      this.stage = { kind: "add", target };
      this.query = "";
      this.editing = void 0;
      await this.loadApps();
      await this.fetchIcons(this.visibleBundleIDs());
    }
    /**
     * 「此刻」卡上的刷新（C-4）：重读前台应用、此刻输入法与规则。面板钉住时切过应用，卡上还是打开那一刻的。
     * 点按钮不会把 Jarvis 拉到前台（面板只在点进输入框时才激活自己），读到的仍是用户刚才在用的那个应用。
     */
    async refresh() {
      if (this.status.kind !== "ready") return;
      this.editing = void 0;
      await this.load();
      if (this.status.kind === "ready") await this.fetchIcons(this.visibleBundleIDs());
      jarvis.ui.update();
    }
    /** 不加了，回到分组页。 */
    cancelAdd() {
      this.stage = { kind: "groups" };
      this.siteDraft = "";
    }
    /**
     * 搜索词变了：停下 300 ms 再补图标。
     * @param query 搜索词。
     */
    setQuery(query) {
      this.query = query;
      if (this.iconTimer !== void 0) clearTimeout(this.iconTimer);
      this.iconTimer = setTimeout(() => {
        this.iconTimer = void 0;
        void this.fetchIcons(this.visibleBundleIDs());
      }, ICON_DEBOUNCE_MS);
    }
    /**
     * 点了一个应用：加进那一组，回到分组页。
     * @param bundleId 应用。
     * @param name 应用名。
     */
    async pick(bundleId, name) {
      if (this.stage.kind !== "add") return;
      const target = this.stage.target;
      this.stage = { kind: "groups" };
      await this.assign(bundleId, name, target);
    }
    // MARK: - 推荐
    /** 此刻的推荐（不用了之后为空）。 */
    currentSuggestions() {
      if (this.suggestionsDismissed || this.apps === void 0) return [];
      return suggestions(this.apps, this.rules, this.sources, this.now());
    }
    /** 推荐全部加上。 */
    async acceptSuggestions() {
      let rules = this.rules;
      for (const item of this.currentSuggestions()) rules = setRule(rules, item.bundleId, ruleFromChoice(item.choice, item.name));
      this.rules = rules;
      await jarvis.storage.set(storageKeys.rules, rules);
      await this.dismissSuggestions();
      await this.fetchIcons(Object.keys(rules));
    }
    /** 不用了：这张卡不再出现。 */
    async dismissSuggestions() {
      this.suggestionsDismissed = true;
      await jarvis.storage.set(SUGGESTIONS_DISMISSED, true);
    }
    // MARK: - 其余
    /**
     * 默认输入法。
     * @param id 输入法 id。
     */
    async setFallback(id) {
      this.fallbackSource = id;
      await jarvis.storage.set(storageKeys.fallbackSource, id);
    }
    /** 恢复自动切换（交给后台：暂停状态与提示在那里）。 */
    async resume() {
      this.settings = { ...this.settings, paused: false };
      await jarvis.commands.run("pause");
    }
    /** 再问一次授权（只在按钮回调里调）。 */
    async requestAccess() {
      const result = await jarvis.permissions.request([...pageCapabilities]);
      await this.activate({ granted: result.granted, preferences: this.settings });
    }
  };
  function renderPage(session) {
    const status = session.status;
    switch (status.kind) {
      case "loading":
        return ui.empty({ key: "loading", symbol: "keyboard", title: "\u6B63\u5728\u8BFB\u8F93\u5165\u6CD5" });
      case "denied":
        return ui.empty({
          key: "denied",
          symbol: "lock",
          title: "\u8FD8\u6CA1\u5141\u8BB8\u8BFB\u8F93\u5165\u6CD5\u4E0E\u524D\u53F0\u5E94\u7528",
          hint: "\u5207\u5230\u4E00\u4E2A\u5E94\u7528\u65F6\u8981\u77E5\u9053\u662F\u54EA\u4E2A\u5E94\u7528\u3001\u6B64\u523B\u7528\u7684\u662F\u54EA\u4E2A\u8F93\u5165\u6CD5\uFF0C\u624D\u80FD\u6309\u89C4\u5219\u6362\u3002\u53EA\u77E5\u9053\u662F\u54EA\u4E2A\u5E94\u7528\uFF0C\u4E0D\u77E5\u9053\u4F60\u5728\u91CC\u9762\u505A\u4EC0\u4E48",
          action: { id: "grant", title: "\u5141\u8BB8", onPress: () => void session.requestAccess() }
        });
      case "failed":
        return ui.empty({ key: "failed", symbol: "exclamationmark.triangle", title: "\u6CA1\u8BFB\u51FA\u6765", hint: status.message });
      case "ready":
        if (session.stage.kind === "add") return addStage(session, session.stage.target);
        if (session.stage.kind === "addSite") return addSiteStage(session, session.stage.target);
        return groupsStage(session);
    }
  }
  function groupsStage(session) {
    const children = [];
    if (session.settings.paused) {
      children.push(
        ui.note({
          key: "paused",
          tint: "amber",
          symbol: "pause.circle",
          body: "\u81EA\u52A8\u5207\u6362\u5DF2\u6682\u505C\uFF1A\u53EA\u8BB0\u4E0B\u4F60\u5728\u5404\u4E2A\u5E94\u7528\u91CC\u7528\u7684\u8F93\u5165\u6CD5\uFF0C\u4E0D\u66FF\u4F60\u5207",
          actions: [{ id: "resume", title: "\u6062\u590D", onPress: () => void session.resume() }]
        })
      );
    }
    children.push(nowCard(session));
    const recommended = session.currentSuggestions();
    if (recommended.length > 0) {
      children.push(
        ui.note({
          key: "suggestions",
          tint: "accent",
          symbol: "sparkles",
          title: "\u5148\u7ED9\u5E38\u7528\u7684\u5E94\u7528\u5B9A\u597D",
          body: suggestionSummary(recommended, session.sources),
          actions: [
            { id: "accept", title: "\u5168\u90E8\u6DFB\u52A0", onPress: () => void session.acceptSuggestions() },
            { id: "dismiss", title: "\u4E0D\u7528\u4E86", onPress: () => void session.dismissSuggestions() }
          ]
        })
      );
    }
    for (const group of groupRules(session.rules, session.sources)) children.push(groupCard(session, group));
    children.push(sitesCard(session));
    children.push(othersCard(session));
    return ui.scroll({ key: "page", children: [ui.stack({ key: "content", children })] });
  }
  function card(key, tint, section) {
    return ui.card({ key: `card:${key}`, ...tint ? { tint, stripe: true } : {}, children: [ui.section(section)] });
  }
  function nowCard(session) {
    const app = session.app;
    const current = session.sources.find((source) => source.id === session.currentId);
    const children = [];
    if (app) {
      const choice = ruleChoice(session.rules[app.bundleId]);
      children.push(
        ui.row({
          key: "now:app",
          symbol: "app",
          image: session.icons.get(app.bundleId) ?? app.icon,
          title: app.name,
          subtitle: choice === "none" ? `\u65E0\u89C4\u5219 \xB7 ${othersTitle(session.settings.others)}` : choiceTitle(choice, session.sources),
          accessory: "none"
        }),
        chipGrid("now", choiceChips(session.sources), choice, (value) => void session.assign(app.bundleId, app.name, value)),
        ...nowPage(session, app.bundleId)
      );
    } else {
      children.push(ui.text({ key: "now:none", style: "footnote", text: "\u5207\u5230\u4E00\u4E2A\u5E94\u7528\u518D\u70B9\u53F3\u4E0A\u89D2\u7684\u5237\u65B0\uFF0C\u5C31\u80FD\u4E00\u70B9\u7ED9\u5B83\u5B9A\u8F93\u5165\u6CD5" }));
    }
    return card("now", "accent", {
      key: "now",
      title: "\u6B64\u523B \xB7 NOW",
      trailing: current ? `\u6B63\u5728\u7528 ${current.name}` : void 0,
      actions: [
        { id: "refresh", title: "\u5237\u65B0", symbol: "arrow.clockwise", help: "\u91CD\u65B0\u8BFB\u6B64\u523B\u5728\u524D\u53F0\u7684\u5E94\u7528\u4E0E\u8F93\u5165\u6CD5", onPress: () => void session.refresh() }
      ],
      children
    });
  }
  function nowPage(session, bundleId) {
    const page2 = session.page;
    if (!page2 || page2.browser.bundleId !== bundleId) return [];
    if (page2.status === "denied") {
      return [
        ui.text({
          key: "now:site:denied",
          style: "footnote",
          text: `\u8BFB\u4E0D\u5230\u8FD9\u4E00\u9875\u7684\u5730\u5740\uFF1A\u5728 \u7CFB\u7EDF\u8BBE\u7F6E \u203A \u9690\u79C1\u4E0E\u5B89\u5168\u6027 \u203A \u81EA\u52A8\u5316 \u91CC\u5141\u8BB8 Jarvis \u63A7\u5236\u300C${page2.browser.name}\u300D`
        })
      ];
    }
    const url = page2.status === "ok" ? page2.url : void 0;
    const pattern = url ? sitePatternFor(url, session.sites) : void 0;
    if (!url || !pattern) return [];
    const matched = matchSite(url, session.sites);
    const source = matched ? session.sources.find((item) => item.id === matched.source) : void 0;
    return [
      ui.row({
        key: "now:site",
        symbol: "globe",
        title: pattern,
        subtitle: matched ? `\u7F51\u7AD9\u89C4\u5219 \xB7 \u7528 ${source?.name ?? "\u4E00\u4E2A\u5DF2\u505C\u7528\u7684\u8F93\u5165\u6CD5"}` : "\u8FD9\u4E2A\u7F51\u7AD9\u6CA1\u6709\u89C4\u5219\uFF0C\u8DDF\u7740\u5E94\u7528\u7684",
        accessory: "none"
      }),
      chipGrid("now:site", siteChips(session.sources), matched ? `fixed:${matched.source}` : "none", (value) => void session.assignSite(pattern, value))
    ];
  }
  function siteChips(sources) {
    return [
      ...choiceChips(sources).filter((chip) => chip.value.startsWith("fixed:")),
      { value: "none", title: "\u8DDF\u968F\u5E94\u7528", help: "\u4E0D\u7ED9\u8FD9\u4E2A\u7F51\u7AD9\u5B9A\u89C4\u5219\uFF0C\u6309\u6D4F\u89C8\u5668\u8FD9\u4E2A\u5E94\u7528\u7684\u89C4\u5219\u8D70", symbol: "arrow.turn.down.right" }
    ];
  }
  function siteKey(pattern) {
    return `site:${pattern}`;
  }
  function chipGrid(keyPrefix, all, selected, onPick, exclude) {
    const chips = all.filter((chip) => chip.value !== exclude);
    return layout.grid({
      key: `${keyPrefix}:choices`,
      minimum: CHIP_COLUMN_MINIMUM,
      spacing: "tight",
      children: chips.map(
        (chip) => ui.chip({
          key: `${keyPrefix}:${chip.value}`,
          title: chip.title,
          image: chip.image,
          symbol: chip.symbol,
          help: chip.help,
          // 选中的那枚点亮成青色（与工具箱里别的工具的选中 chip 同一种）；不给 tint 时选中只是灰一档，看不出选了哪个。
          tint: "accent",
          selected: chip.value === selected,
          onPress: () => onPick(chip.value)
        })
      )
    });
  }
  function groupTint(group, sources) {
    if (group.key === "stale") return "danger";
    const index = sources.findIndex((source) => `fixed:${source.id}` === group.key);
    return index < 0 ? "neutral" : GROUP_TINTS[index % GROUP_TINTS.length];
  }
  function groupCard(session, group) {
    const children = [];
    for (const { bundleId, rule } of group.entries) {
      const name = rule.name || bundleId;
      const editing = session.editing === bundleId;
      children.push(
        ui.row({
          key: `rule:${bundleId}`,
          symbol: "app",
          image: session.icons.get(bundleId),
          title: name,
          subtitle: session.app?.bundleId === bundleId ? "\u6B64\u523B\u5728\u524D\u53F0" : group.key === "stale" ? "\u70B9\u4E00\u4E0B\uFF0C\u6362\u4E00\u4E2A\u8FD8\u542F\u7528\u7740\u7684" : void 0,
          selected: editing || session.highlight === bundleId,
          accessory: "none",
          onPress: () => session.toggleEditing(bundleId),
          actions: [{ id: "remove", title: "\u5220\u9664\u89C4\u5219", symbol: "xmark", help: `\u5220\u9664\u300C${name}\u300D\u7684\u89C4\u5219`, onPress: () => void session.remove(bundleId) }]
        })
      );
      if (editing) {
        children.push(
          ui.text({ key: `rule:${bundleId}:label`, style: "footnote", text: `\u300C${name}\u300D\u6362\u6210` }),
          chipGrid(`rule:${bundleId}`, choiceChips(session.sources), ruleChoice(rule), (value) => void session.assign(bundleId, name, value), group.key)
        );
      }
    }
    if (group.entries.length === 0) {
      children.push(ui.text({ key: `${group.key}:empty`, style: "footnote", text: "\u8FD8\u6CA1\u6709\u5E94\u7528\u3002\u70B9\u53F3\u4E0A\u89D2\u7684 + \u52A0\u51E0\u4E2A" }));
    }
    const actions = group.addable ? [{ id: "add", title: "\u6DFB\u52A0\u5E94\u7528", symbol: "plus", help: `\u6DFB\u52A0${group.title}\u7684\u5E94\u7528`, onPress: () => void session.startAdd(group.key) }] : void 0;
    return card(`group:${group.key}`, groupTint(group, session.sources), {
      key: `group:${group.key}`,
      title: group.title,
      trailing: `${group.entries.length} \u4E2A\u5E94\u7528`,
      actions,
      children
    });
  }
  function sitesCard(session) {
    const children = [];
    const here = session.page?.status === "ok" && session.page.url ? matchSite(session.page.url, session.sites)?.pattern : void 0;
    for (const entry of siteList(session.sites, session.sources)) children.push(...siteRows(session, entry, here));
    if (children.length === 0) {
      children.push(
        ui.text({
          key: "sites:empty",
          style: "footnote",
          text: "\u8FD8\u6CA1\u6709\u7F51\u7AD9\u89C4\u5219\u3002\u7F51\u7AD9\u89C4\u5219\u6BD4\u6D4F\u89C8\u5668\u81EA\u5DF1\u7684\u89C4\u5219\u4F18\u5148\uFF1A\u6BD4\u5982 Chrome \u7528 ABC\uFF0C\u4F46\u5728 feishu.cn \u4E0A\u7528\u62FC\u97F3\u3002\u70B9\u53F3\u4E0A\u89D2\u7684\u300C\u6DFB\u52A0\u7F51\u7AD9\u300D"
        })
      );
    }
    return card("sites", "neutral", {
      key: "sites",
      title: "\u7F51\u7AD9 \xB7 WEBSITES",
      trailing: `${session.sites.length} \u4E2A\u7F51\u7AD9`,
      actions: [{ id: "addSite", title: "\u6DFB\u52A0\u7F51\u7AD9", help: "\u7ED9\u4E00\u4E2A\u7F51\u7AD9\u5B9A\u8F93\u5165\u6CD5", onPress: () => void session.startAddSite() }],
      children
    });
  }
  function siteRows(session, { site, source }, here) {
    const key = siteKey(site.pattern);
    const editing = session.editing === key;
    let subtitle = source ? `\u7528 ${source.name}` : "\u8F93\u5165\u6CD5\u5DF2\u505C\u7528 \xB7 \u70B9\u4E00\u4E0B\u6362\u4E00\u4E2A\u8FD8\u542F\u7528\u7740\u7684";
    if (source && here === site.pattern) subtitle += " \xB7 \u6B64\u523B\u5728\u770B";
    const rows = [
      ui.row({
        key: `site:${site.pattern}`,
        symbol: "globe",
        title: site.pattern,
        subtitle,
        selected: editing || session.highlight === key,
        accessory: "none",
        onPress: () => session.toggleEditing(key),
        actions: [{ id: "remove", title: "\u5220\u9664\u89C4\u5219", symbol: "xmark", help: `\u5220\u9664\u300C${site.pattern}\u300D\u7684\u89C4\u5219`, onPress: () => void session.removeSite(site.pattern) }]
      })
    ];
    if (editing) {
      rows.push(
        ui.text({ key: `site:${site.pattern}:label`, style: "footnote", text: `\u5728\u300C${site.pattern}\u300D\u4E0A\u6362\u6210` }),
        chipGrid(`site:${site.pattern}`, siteChips(session.sources), `fixed:${site.source}`, (value) => void session.assignSite(site.pattern, value))
      );
    }
    return rows;
  }
  function othersCard(session) {
    const children = [layout.preference({ key: "others", preference: "others" })];
    if (session.settings.others === "default") {
      const value = session.fallbackSource && session.sources.some((source) => source.id === session.fallbackSource) ? session.fallbackSource : "";
      children.push(
        ui.picker({
          key: "fallback",
          label: "\u9ED8\u8BA4\u8F93\u5165\u6CD5",
          options: [{ value: "", title: "\u9009\u4E00\u4E2A\u8F93\u5165\u6CD5" }, ...session.sources.map((source) => ({ value: source.id, title: source.name }))],
          value,
          onChange: (id) => {
            if (id) void session.setFallback(id);
          }
        })
      );
    }
    children.push(
      ui.text({
        key: "how",
        style: "footnote",
        text: "\u4E5F\u53EF\u4EE5\u5728\u4EFB\u4F55\u5E94\u7528\u91CC\u70B9\u83DC\u5355\u680F\u4E0A\u7684\u952E\u76D8\u56FE\u6807\uFF0C\u7ED9\u5B83\u4E00\u70B9\u5373\u5B9A\u3002\u7F51\u7AD9\u89C4\u5219\u6BD4\u5E94\u7528\u89C4\u5219\u4F18\u5148\uFF0C\u53EA\u5728\u90A3\u4E00\u9875\u5F00\u5728\u524D\u53F0\u7684\u6D4F\u89C8\u5668\u91CC\u65F6\u751F\u6548\u3002\u4E2D\u6587\u8F93\u5165\u6CD5\u91CC\u6309 \u21E7 \u5207\u5230\u7684\u82F1\u6587\u6A21\u5F0F\u4E0D\u7B97\u6362\u4E86\u8F93\u5165\u6CD5\uFF0C\u89C4\u5219\u7BA1\u4E0D\u5230\u5B83\u3002"
      })
    );
    return card("others", void 0, { key: "others", title: "\u65E0\u89C4\u5219\u7684\u5E94\u7528 \xB7 OTHERS", children });
  }
  function addStage(session, target) {
    const title = choiceTitle(target, session.sources);
    const children = [
      ui.row({
        key: "add:back",
        symbol: "chevron.left",
        title: `\u52A0\u5230\u300C${title}\u300D`,
        subtitle: "\u70B9\u4E00\u4E2A\u5E94\u7528\u5C31\u52A0\u8FDB\u53BB\uFF1B\u5DF2\u7ECF\u6709\u89C4\u5219\u7684\u4F1A\u632A\u8FC7\u6765",
        accessory: "none",
        onPress: () => session.cancelAdd(),
        label: `\u8FD4\u56DE\u3002\u52A0\u5230\u300C${title}\u300D`
      }),
      ui.search({ key: "add:search", value: session.query, placeholder: "\u641C\u5E94\u7528\u540D\u6216 Bundle ID", label: "\u641C\u5E94\u7528", onChange: (query) => session.setQuery(query) })
    ];
    if (session.apps === void 0) {
      children.push(ui.text({ key: "add:loading", style: "footnote", text: "\u8BFB\u4E0D\u5230\u5E94\u7528\u5217\u8868\uFF1A\u8981\u300C\u8BFB\u53D6\u672C\u673A\u5E94\u7528\u5217\u8868\u300D\u7684\u6388\u6743" }));
    } else {
      const { list, truncated } = candidates(session.apps, session.query);
      const now = session.now();
      for (const app of list) {
        const rule = session.rules[app.bundleId];
        const choice = ruleChoice(rule);
        const already = choice === target;
        children.push(
          ui.row({
            key: `app:${app.bundleId}`,
            symbol: "app",
            image: session.icons.get(app.bundleId),
            title: app.name,
            subtitle: rule ? already ? "\u5DF2\u7ECF\u5728\u8FD9\u4E00\u7EC4" : `\u73B0\u5728\uFF1A${choiceTitle(choice, session.sources)}` : lastUsedTitle(app.lastUsedAt, now),
            selected: already,
            accessory: already ? "dot" : "none",
            onPress: () => void session.pick(app.bundleId, app.name)
          })
        );
      }
      if (list.length === 0) children.push(ui.text({ key: "add:none", style: "footnote", text: "\u6CA1\u627E\u5230\u3002\u6362\u4E2A\u540D\u5B57\uFF0C\u6216\u8005\u7528 Bundle ID \u641C" }));
      if (truncated) children.push(ui.text({ key: "add:more", style: "footnote", text: "\u53EA\u5217\u4E86\u6700\u8FD1\u7528\u8FC7\u7684 60 \u4E2A\uFF0C\u8F93\u5165\u540D\u5B57\u627E\u522B\u7684" }));
    }
    return ui.scroll({ key: "add", children: [ui.stack({ key: "add:content", children })] });
  }
  function addSiteStage(session, target) {
    const children = [
      ui.row({
        key: "addSite:back",
        symbol: "chevron.left",
        title: "\u6DFB\u52A0\u7F51\u7AD9",
        subtitle: "\u9009\u8FD9\u4E2A\u7F51\u7AD9\u7528\u54EA\u4E2A\u8F93\u5165\u6CD5\uFF0C\u518D\u586B\u7F51\u5740\u6216\u4E3B\u673A\u540D\uFF1Bgithub.com \u4E5F\u7BA1\u5B83\u7684\u5B50\u57DF",
        accessory: "none",
        onPress: () => session.cancelAdd(),
        label: "\u8FD4\u56DE\u3002\u6DFB\u52A0\u7F51\u7AD9"
      })
    ];
    if (!session.hasSiteAccess()) {
      children.push(
        ui.note({
          key: "addSite:access",
          tint: "amber",
          symbol: "lock",
          body: "\u8FD8\u6CA1\u5141\u8BB8\u8BFB\u6D4F\u89C8\u5668\u5F53\u524D\u9875\uFF1A\u89C4\u5219\u7167\u6837\u80FD\u52A0\uFF0C\u4F46\u4E0D\u4F1A\u8DDF\u7740\u7F51\u9875\u6362\u8F93\u5165\u6CD5",
          actions: [{ id: "grant", title: "\u5141\u8BB8", onPress: () => void session.requestSiteAccess() }]
        })
      );
    }
    children.push(
      ui.text({ key: "addSite:sourceLabel", style: "footnote", text: "\u5728\u8FD9\u4E2A\u7F51\u7AD9\u4E0A\u7528" }),
      chipGrid("addSite", siteChips(session.sources).filter((chip) => chip.value !== "none"), target, (value) => session.setSiteTarget(value)),
      ui.field({
        key: "addSite:field",
        value: session.siteDraft,
        placeholder: "github.com \u6216 docs.google.com/spreadsheets",
        label: "\u7F51\u5740\u6216\u4E3B\u673A\u540D",
        mono: true,
        autoFocus: true,
        onChange: (text) => session.setSiteDraft(text),
        onSubmit: (text) => {
          const pattern = normalizePattern(text);
          if (pattern) void session.pickSite(pattern);
        }
      })
    );
    const draft = session.siteDraft.trim();
    if (draft) {
      const pattern = normalizePattern(draft);
      if (pattern) {
        const existing = session.sites.find((site) => site.pattern === pattern);
        const already = existing !== void 0 && `fixed:${existing.source}` === target;
        let subtitle = `${choiceTitle(target, session.sources)}\uFF1B\u4E5F\u7BA1 docs.${pattern} \u8FD9\u6837\u7684\u5B50\u57DF`;
        if (pattern.includes("/")) subtitle = `${choiceTitle(target, session.sources)}\uFF1B\u8FD9\u4E2A\u7F51\u7AD9\u4E0A\u4EE5\u8FD9\u6BB5\u8DEF\u5F84\u5F00\u5934\u7684\u9875`;
        if (existing && !already) subtitle = `\u73B0\u5728\uFF1A${choiceTitle(`fixed:${existing.source}`, session.sources)}\uFF0C\u70B9\u4E00\u4E0B\u6539\u6210${choiceTitle(target, session.sources)}`;
        children.push(
          ui.row({
            key: "addSite:add",
            symbol: "plus.circle",
            title: already ? `${pattern} \u5DF2\u7ECF\u662F\u8FD9\u4E2A\u8F93\u5165\u6CD5` : `\u6DFB\u52A0 ${pattern}`,
            subtitle,
            selected: already,
            accessory: "none",
            onPress: () => void session.pickSite(pattern)
          })
        );
      } else {
        children.push(ui.text({ key: "addSite:invalid", style: "footnote", text: "\u8FD9\u4E0D\u50CF\u4E00\u4E2A\u7F51\u5740\uFF1A\u586B\u4E3B\u673A\u540D\uFF08github.com\uFF09\u6216\u6574\u4E2A\u7F51\u5740" }));
      }
    }
    const page2 = session.page;
    const url = page2?.status === "ok" ? page2.url : void 0;
    const current = url ? sitePatternFor(url, session.sites) : void 0;
    if (page2 && current) {
      children.push(
        ui.row({
          key: "addSite:current",
          symbol: "safari",
          title: current,
          subtitle: `${page2.frontmost ? "\u6B64\u523B" : "\u521A\u624D"}\u5728\u300C${page2.browser.name}\u300D\u91CC\u770B\u7684\u8FD9\u4E00\u9875`,
          accessory: "none",
          onPress: () => void session.pickSite(current)
        })
      );
    }
    children.push(
      ui.text({
        key: "addSite:how",
        style: "footnote",
        text: "\u8BFB\u5730\u5740\u65F6\u7CFB\u7EDF\u4F1A\u95EE\u4E00\u6B21\u662F\u5426\u5141\u8BB8 Jarvis \u63A7\u5236\u8FD9\u4E2A\u6D4F\u89C8\u5668\uFF08\u7CFB\u7EDF\u8BBE\u7F6E \u203A \u9690\u79C1\u4E0E\u5B89\u5168\u6027 \u203A \u81EA\u52A8\u5316\uFF09\u3002\u6362\u6807\u7B7E\u5C31\u8DDF\u7740\u6362\uFF0C\u8981 Jarvis \u6709\u8F85\u52A9\u529F\u80FD\u6743\u9650\uFF1B\u6CA1\u6709\u65F6\u53EA\u5728\u5207\u5230\u6D4F\u89C8\u5668\u65F6\u5BF9\u4E00\u6B21\u3002Firefox \u8BFB\u4E0D\u4E86\u5730\u5740\u3002"
      })
    );
    return ui.scroll({ key: "addSite", children: [ui.stack({ key: "addSite:content", children })] });
  }

  // extensions/input-source/src/index.ts
  var controller = new Controller();
  var page = new PageSession();
  defineExtension({
    toolbox: {
      activate: (context) => page.activate(context),
      deactivate: () => page.deactivate(),
      render: () => renderPage(page)
    },
    commands: {
      previous: (context) => controller.previous(context),
      "remember-here": (context) => controller.rememberHere(context),
      pause: (context) => controller.pause(context)
    },
    menuBar: {
      start: (context) => controller.start(context.preferences, context.granted),
      open: (context) => controller.open(context),
      select: (context, itemId) => controller.select(itemId, context)
    }
  });
})();
