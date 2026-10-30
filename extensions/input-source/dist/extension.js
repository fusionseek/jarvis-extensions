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

  // extensions/input-source/src/model.ts
  var defaultSettings = {
    others: "keep",
    hud: true,
    hudAnchor: "caret",
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
      hudAnchor: pick(preferences.hudAnchor, ["caret", "pointer", "screen"], defaultSettings.hudAnchor),
      hudOnManual: flag(preferences.hudOnManual, defaultSettings.hudOnManual),
      menuBarLabel: flag(preferences.menuBarLabel, defaultSettings.menuBarLabel),
      paused: flag(preferences.paused, defaultSettings.paused)
    };
  }
  var emptyMemory = { rules: {}, lastUsed: {} };
  var maximumRules = 300;
  var maximumRemembered = 300;
  function resolveTarget(bundleId, memory, settings, enabled) {
    const rule = memory.rules[bundleId];
    let target;
    if (rule) {
      if (rule.mode === "fixed") target = rule.source;
      else if (rule.mode === "remember") target = memory.lastUsed[bundleId];
      else return void 0;
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
    if (choice === "ignore") return { mode: "ignore", name };
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
  function ruleTitle(rule, sources, settings) {
    if (!rule) return `\u6CA1\u5199\u89C4\u5219 \xB7 ${othersTitle(settings.others)}`;
    switch (rule.mode) {
      case "fixed": {
        const source = sources.find((candidate) => candidate.id === rule.source);
        return source ? source.name : "\u90A3\u4E2A\u8F93\u5165\u6CD5\u5DF2\u7ECF\u505C\u7528\u4E86";
      }
      case "remember":
        return "\u8BB0\u4F4F\u4E0A\u6B21\u7528\u7684";
      case "ignore":
        return "\u4E0D\u7BA1\u5B83";
    }
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
    if (itemId === "remember" || itemId === "ignore" || itemId === "none") return itemId;
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
        { kind: "item", id: "ignore", title: "\u4E0D\u7BA1\u5B83", checked: choice === "ignore" },
        {
          kind: "item",
          id: "none",
          title: "\u4E0D\u5199\u89C4\u5219",
          subtitle: clip(`\u8DDF\u7740\u300C\u6CA1\u5199\u89C4\u5219\u7684\u5E94\u7528\u300D\uFF1A${othersTitle(state.settings.others)}`, 80),
          checked: choice === "none"
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
  function clip(text, limit) {
    const characters = [...text];
    return characters.length <= limit ? text : characters.slice(0, limit).join("");
  }

  // extensions/input-source/src/storage.ts
  var storageKeys = {
    rules: "rules",
    lastUsed: "lastUsed",
    fallbackSource: "fallbackSource"
  };
  function isRule(value) {
    if (typeof value !== "object" || value === null) return false;
    const rule = value;
    if (typeof rule.name !== "string") return false;
    if (rule.mode === "fixed") return typeof rule.source === "string" && rule.source.length > 0;
    return rule.mode === "remember" || rule.mode === "ignore";
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

  // extensions/input-source/src/controller.ts
  var HUD_LIMIT = 24;
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
      await this.render();
    }
    /**
     * 菜单里点了一项：给此刻的应用定规则，或暂停 / 恢复。
     * @param itemId 菜单项 id。
     * @param context 此刻的授权与偏好。
     */
    async select(itemId, context) {
      await this.ensureStarted(context);
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
      await this.render();
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
    async onFrontmost(app) {
      const switched = this.app?.bundleId !== app.bundleId;
      this.app = app;
      if (!this.primed) {
        this.primed = true;
        return this.render();
      }
      if (!switched || this.settings.paused || !this.granted.includes("inputSources.select")) return this.render();
      await this.loadRules();
      if (this.sources.length === 0) await this.reloadSources();
      const target = resolveTarget(app.bundleId, this.memory, this.settings, this.sources.map((source) => source.id));
      if (target !== void 0 && target !== this.currentId) await this.switchTo(target);
      await this.render();
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
    async switchTo(target) {
      try {
        const result = await jarvis.inputSources.select(target);
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
      const art = source?.icon ? { image: source.icon } : symbol ? { symbol } : {};
      await jarvis.hud.show({ text: clipped, anchor: this.settings.hudAnchor, ...art }).catch(() => void 0);
    }
    // MARK: - 存储
    async loadMemory() {
      const [rules, lastUsed, fallbackSource] = await Promise.all([readRules(), readLastUsed(), readFallback()]);
      this.memory = { rules, lastUsed, fallbackSource };
    }
    async loadRules() {
      const [rules, fallbackSource] = await Promise.all([readRules(), readFallback()]);
      this.memory = { ...this.memory, rules, fallbackSource };
    }
    async render() {
      this.menuSources = this.sources;
      await jarvis.menuBar.update(menuModel({ app: this.app, rules: this.memory.rules, sources: this.sources, currentId: this.currentId, settings: this.settings })).catch(() => void 0);
    }
  };

  // extensions/input-source/src/page.ts
  var pageCapabilities = ["system.activity", "inputSources.read", "inputSources.select", "hud.show"];
  var PageSession = class {
    constructor() {
      this.status = { kind: "loading" };
      this.sources = [];
      this.rules = {};
      this.settings = readSettings({});
      this.granted = [];
    }
    /**
     * 页面出现了。
     * @param context 此刻的授权与偏好。
     */
    async activate(context) {
      this.granted = context.granted;
      this.settings = readSettings(context.preferences);
      this.editing = void 0;
      await this.load();
    }
    /** 页面不在了。 */
    deactivate() {
      this.editing = void 0;
    }
    async load() {
      if (!this.granted.includes("inputSources.read") || !this.granted.includes("system.activity")) {
        this.status = { kind: "denied" };
        return;
      }
      try {
        const [sources, current, app, rules, fallbackSource] = await Promise.all([
          jarvis.inputSources.list(),
          jarvis.inputSources.current(),
          jarvis.frontmostApp.current(),
          readRules(),
          readFallback()
        ]);
        this.sources = sources;
        this.currentId = current.id;
        this.app = app ?? void 0;
        this.rules = rules;
        this.fallbackSource = fallbackSource;
        this.status = { kind: "ready" };
      } catch (error) {
        this.status = { kind: "failed", message: error instanceof Error ? error.message : String(error) };
      }
    }
    /**
     * 改一条规则（`none` = 删掉）。
     * @param bundleId 哪个应用。
     * @param name 应用名。
     * @param choice 选择器的值。
     */
    async setRule(bundleId, name, choice) {
      this.rules = setRule(this.rules, bundleId, ruleFromChoice(choice, name));
      await jarvis.storage.set(storageKeys.rules, this.rules);
    }
    /**
     * 删掉一条规则。
     * @param bundleId 哪个应用。
     */
    async removeRule(bundleId) {
      if (this.editing === bundleId) this.editing = void 0;
      await this.setRule(bundleId, "", "none");
    }
    /** 展开 / 收起一条规则的选择器。 */
    toggleEditing(bundleId) {
      this.editing = this.editing === bundleId ? void 0 : bundleId;
    }
    /**
     * 没写规则的应用怎么办。
     * @param value 偏好值。
     */
    async setOthers(value) {
      this.settings = readSettings({ ...this.settings, others: value });
      await jarvis.preferences.set("others", this.settings.others);
    }
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
    /** 选择器的选项：各输入法、记住上次、不管它、不写规则。 */
    ruleOptions() {
      return [
        ...this.sources.map((source) => ({ value: `fixed:${source.id}`, title: source.name })),
        { value: "remember", title: "\u8BB0\u4F4F\u4E0A\u6B21\u7528\u7684" },
        { value: "ignore", title: "\u4E0D\u7BA1\u5B83" },
        { value: "none", title: "\u4E0D\u5199\u89C4\u5219", detail: `\u8DDF\u7740\u300C\u6CA1\u5199\u89C4\u5219\u7684\u5E94\u7528\u300D\uFF1A${othersTitle(this.settings.others)}` }
      ];
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
        return ready(session);
    }
  }
  function ready(session) {
    const current = session.sources.find((source) => source.id === session.currentId);
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
    children.push(nowSection(session, current), rulesSection(session), othersSection(session));
    children.push(
      ui.text({
        key: "how",
        style: "footnote",
        text: "\u5728\u54EA\u4E2A\u5E94\u7528\u91CC\uFF0C\u5C31\u70B9\u83DC\u5355\u680F\u4E0A\u7684\u952E\u76D8\u56FE\u6807\u7ED9\u5B83\u9009\u8F93\u5165\u6CD5\u3002\u4E2D\u6587\u8F93\u5165\u6CD5\u91CC\u6309 \u21E7 \u5207\u5230\u7684\u82F1\u6587\u6A21\u5F0F\u4E0D\u7B97\u6362\u4E86\u8F93\u5165\u6CD5\uFF0C\u89C4\u5219\u7BA1\u4E0D\u5230\u5B83\u3002"
      })
    );
    return ui.scroll({ key: "page", children: [ui.stack({ key: "content", children })] });
  }
  function nowSection(session, current) {
    const app = session.app;
    const children = [];
    if (app) {
      const rule = session.rules[app.bundleId];
      children.push(
        ui.row({
          key: "now:app",
          symbol: "app",
          image: app.icon,
          title: app.name,
          subtitle: ruleTitle(rule, session.sources, session.settings),
          accessory: "none"
        }),
        ui.picker({
          key: "now:rule",
          label: `\u5728\u300C${app.name}\u300D\u91CC\u7528`,
          options: session.ruleOptions(),
          value: ruleChoice(rule),
          searchable: true,
          onChange: (value) => void session.setRule(app.bundleId, app.name, value)
        })
      );
    } else {
      children.push(ui.text({ key: "now:none", style: "footnote", text: "\u5207\u5230\u4E00\u4E2A\u5E94\u7528\u518D\u6253\u5F00\u8FD9\u4E00\u9875\uFF0C\u5C31\u80FD\u7ED9\u5B83\u5B9A\u8F93\u5165\u6CD5" }));
    }
    return ui.section({ key: "now", title: "\u6B64\u523B \xB7 NOW", trailing: current ? `\u6B63\u5728\u7528 ${current.name}` : void 0, children });
  }
  function rulesSection(session) {
    const entries = Object.entries(session.rules).sort(([, a], [, b]) => a.name.localeCompare(b.name, "zh-Hans"));
    const children = [];
    for (const [bundleId, rule] of entries) {
      const icon = session.app?.bundleId === bundleId ? session.app.icon : void 0;
      children.push(
        ui.row({
          key: `rule:${bundleId}`,
          symbol: "app",
          image: icon,
          title: rule.name || bundleId,
          subtitle: ruleTitle(rule, session.sources, session.settings),
          selected: session.editing === bundleId,
          accessory: "none",
          onPress: () => session.toggleEditing(bundleId),
          actions: [{ id: "remove", title: "\u5220\u9664\u89C4\u5219", symbol: "xmark", help: "\u5220\u9664\u8FD9\u6761\u89C4\u5219", onPress: () => void session.removeRule(bundleId) }]
        })
      );
      if (session.editing === bundleId) {
        children.push(
          ui.picker({
            key: `rule:${bundleId}:picker`,
            label: `\u5728\u300C${rule.name || bundleId}\u300D\u91CC\u7528`,
            options: session.ruleOptions(),
            value: ruleChoice(rule),
            searchable: true,
            onChange: (value) => void session.setRule(bundleId, rule.name, value)
          })
        );
      }
    }
    if (children.length === 0) {
      children.push(ui.text({ key: "rules:empty", style: "footnote", text: "\u8FD8\u6CA1\u6709\u89C4\u5219\u3002\u5728\u54EA\u4E2A\u5E94\u7528\u91CC\uFF0C\u5C31\u70B9\u83DC\u5355\u680F\u4E0A\u7684\u952E\u76D8\u56FE\u6807\u7ED9\u5B83\u9009\u4E00\u4E2A" }));
    }
    return ui.section({ key: "rules", title: "\u5E94\u7528\u89C4\u5219 \xB7 RULES", trailing: `${entries.length} \u4E2A`, children });
  }
  function othersSection(session) {
    const children = [
      ui.picker({
        key: "others",
        label: "\u6CA1\u5199\u89C4\u5219\u7684\u5E94\u7528",
        options: ["keep", "remember", "default"].map((value) => ({ value, title: othersTitle(value) })),
        value: session.settings.others,
        onChange: (value) => void session.setOthers(value)
      })
    ];
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
    return ui.section({ key: "others", title: "\u6CA1\u5199\u89C4\u5219\u7684\u5E94\u7528 \xB7 OTHERS", children });
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
