// jarvis-extension bundle · github-project@1.3.5 · sdk 2.13.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
    let count2 = 1;
    for (const child of node.children ?? []) count2 += countNodes(child);
    for (const name of ["hoverCard", "emptyState"]) {
      const nested = node.props[name];
      if (nested && typeof nested === "object" && "kind" in nested) count2 += countNodes(nested);
    }
    return count2;
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

  // sdk/src/services.ts
  var projectEngineContractVersion = 1;

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
      return new Promise((resolve2, reject) => {
        this.pending.set(id, { resolve: resolve2, reject });
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
      const count2 = countNodes(root);
      if (count2 > maximumNodesPerRender) {
        throw new Error(`\u4E00\u6B21 render \u63D0\u4EA4\u4E86 ${count2} \u4E2A\u8282\u70B9\uFF0C\u4E0A\u9650 ${maximumNodesPerRender}\u3002`);
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
      list: () => call.apps("list"),
      // SDK 2.13：图标按需取，去重后上线缆（宿主拒绝重复）。
      icons: (bundleIds) => call.apps("icons", { bundleIds: [...new Set(bundleIds)] })
    },
    system: {
      openURL: (url) => call.system("openURL", { url }),
      openExtensionSettings: () => call.system("openExtensionSettings")
    }
  };

  // extensions/github-project/src/limits.ts
  var hosting = "github";
  var itemsPerPage = 100;
  var fieldValuesPerItem = 50;
  var projectsPerList = 50;
  var fieldsPerProject = 100;
  var assigneesPerItem = 20;
  var labelsPerItem = 50;
  var blockedByPerItem = 20;
  var issueTypesPerOwner = 50;
  var milestonesPerSearch = 100;
  var currentAssignees = 50;
  var maxLength = {
    id: 200,
    title: 200,
    owner: 100,
    url: 500,
    name: 100,
    color: 20,
    text: 2e3,
    itemTitle: 500,
    login: 100,
    label: 100,
    milestone: 200,
    issueType: 100,
    cursor: 500,
    summary: 200
  };
  function clamp(text, limit) {
    const points = Array.from(text);
    return points.length <= limit ? text : points.slice(0, limit).join("");
  }
  function nonEmpty(value, limit) {
    return typeof value === "string" && value.length > 0 ? clamp(value, limit) : void 0;
  }
  function day(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return void 0;
    return value.slice(0, 10);
  }
  function timestamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) return void 0;
    return value;
  }
  function addDays(date, days) {
    const time = Date.parse(`${date}T00:00:00Z`) + days * 864e5;
    return new Date(time).toISOString().slice(0, 10);
  }

  // extensions/github-project/src/documents.ts
  var projectSummaryFragment = `fragment ProjectSummaryFields on ProjectV2 {
  id
  number
  title
  url
  closed
  updatedAt
  owner { __typename ... on Organization { login } ... on User { login } }
  items { totalCount }
}`;
  var fieldConfigFragment = `fragment FieldConfig on ProjectV2FieldConfiguration {
  ... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name color description } }
  ... on ProjectV2MultiSelectField { multiSelectOptions { id name color description } }
  ... on ProjectV2IterationField {
    configuration {
      duration
      iterations { id title startDate duration }
      completedIterations { id title startDate duration }
    }
  }
}`;
  var fieldIdFragment = `fragment FieldId on ProjectV2FieldConfiguration {
  ... on ProjectV2FieldCommon { id }
}`;
  var itemFragment = `fragment ItemFields on ProjectV2Item {
  id
  updatedAt
  isArchived
  type
  fieldValues(first: ${fieldValuesPerItem}) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldTextValue { text field { ...FieldId } }
      ... on ProjectV2ItemFieldNumberValue { number field { ...FieldId } }
      ... on ProjectV2ItemFieldDateValue { date field { ...FieldId } }
      ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ...FieldId } }
      ... on ProjectV2ItemFieldMultiSelectValue { options { id } field { ...FieldId } }
      ... on ProjectV2ItemFieldIterationValue { iterationId field { ...FieldId } }
    }
  }
  content {
    __typename
    ... on Issue {
      number
      title
      url
      closed
      createdAt
      closedAt
      author { login }
      assignees(first: ${assigneesPerItem}) { nodes { login } }
      labels(first: ${labelsPerItem}) { nodes { name } }
      milestone { title dueOn }
      issueType { name }
      repository { nameWithOwner }
      parent { number repository { nameWithOwner } }
      blockedBy(first: ${blockedByPerItem}) { nodes { number repository { nameWithOwner } } }
      subIssuesSummary { total completed }
    }
    ... on PullRequest {
      number
      title
      url
      closed
      createdAt
      closedAt
      author { login }
      assignees(first: ${assigneesPerItem}) { nodes { login } }
      labels(first: ${labelsPerItem}) { nodes { name } }
      milestone { title dueOn }
      repository { nameWithOwner }
    }
    ... on DraftIssue {
      title
      createdAt
      assignees(first: ${assigneesPerItem}) { nodes { login } }
    }
  }
}
${fieldIdFragment}`;
  var projectOrder = `orderBy: { field: UPDATED_AT, direction: DESC }`;
  var listViewerProjects = `query ListViewerProjects {
  viewer {
    projectsV2(first: ${projectsPerList}, ${projectOrder}) { nodes { ...ProjectSummaryFields } }
  }
}
${projectSummaryFragment}`;
  var listOwnerProjects = `query ListOwnerProjects($owner: String!) {
  repositoryOwner(login: $owner) {
    __typename
    ... on Organization { projectsV2(first: ${projectsPerList}, ${projectOrder}) { nodes { ...ProjectSummaryFields } } }
    ... on User { projectsV2(first: ${projectsPerList}, ${projectOrder}) { nodes { ...ProjectSummaryFields } } }
  }
}
${projectSummaryFragment}`;
  var listRepositoryProjects = `query ListRepositoryProjects($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: ${projectsPerList}, ${projectOrder}) { nodes { ...ProjectSummaryFields } }
  }
}
${projectSummaryFragment}`;
  var readSchema = `query ReadSchema($id: ID!) {
  node(id: $id) {
    __typename
    ... on ProjectV2 {
      ...ProjectSummaryFields
      fields(first: ${fieldsPerProject}) { nodes { ...FieldConfig } }
    }
  }
}
${projectSummaryFragment}
${fieldConfigFragment}`;
  var organizationIssueTypes = `query OrganizationIssueTypes($login: String!) {
  organization(login: $login) { issueTypes(first: ${issueTypesPerOwner}) { nodes { id name isEnabled } } }
}`;
  var readItems = `query ReadItems($id: ID!, $cursor: String) {
  node(id: $id) {
    __typename
    ... on ProjectV2 {
      items(first: ${itemsPerPage}, after: $cursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...ItemFields }
      }
    }
  }
}
${itemFragment}`;
  var readItemsSince = `query ReadItemsSince($id: ID!, $cursor: String, $q: String!) {
  node(id: $id) {
    __typename
    ... on ProjectV2 {
      items(first: ${itemsPerPage}, after: $cursor, query: $q) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...ItemFields }
      }
    }
  }
}
${itemFragment}`;
  var readItemsByIds = `query ReadItemsByIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on ProjectV2Item { project { id } ...ItemFields }
  }
}
${itemFragment}`;
  var readItem = `query ReadItem($id: ID!) {
  node(id: $id) {
    __typename
    ... on ProjectV2Item { ...ItemFields }
  }
}
${itemFragment}`;
  var repositoryId = `query RepositoryId($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id }
}`;
  var issueId = `query IssueId($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { id title url state } }
}`;
  var readField = `query ReadField($id: ID!) {
  node(id: $id) {
    __typename
    ...FieldConfig
  }
}
${fieldConfigFragment}`;
  function mutationDocument(spec) {
    const name = spec.field[0].toUpperCase() + spec.field.slice(1);
    const selection = spec.selection ?? "clientMutationId";
    return `mutation ${name}($input: ${spec.input}!) {
  ${spec.field}(input: $input) { ${selection} }
}${spec.fragments ? `
${spec.fragments}` : ""}`;
  }
  var specs = {
    updateProjectV2ItemFieldValue: { field: "updateProjectV2ItemFieldValue", input: "UpdateProjectV2ItemFieldValueInput", title: "\u6539\u5B57\u6BB5\u503C" },
    clearProjectV2ItemFieldValue: { field: "clearProjectV2ItemFieldValue", input: "ClearProjectV2ItemFieldValueInput", title: "\u6E05\u7A7A\u5B57\u6BB5\u503C" },
    closeIssue: { field: "closeIssue", input: "CloseIssueInput", title: "\u5173\u95ED Issue" },
    reopenIssue: { field: "reopenIssue", input: "ReopenIssueInput", title: "\u91CD\u65B0\u6253\u5F00 Issue" },
    updateIssueIssueType: { field: "updateIssueIssueType", input: "UpdateIssueIssueTypeInput", title: "\u6539 Issue Type" },
    addLabelsToLabelable: { field: "addLabelsToLabelable", input: "AddLabelsToLabelableInput", title: "\u52A0\u6807\u7B7E" },
    removeLabelsFromLabelable: { field: "removeLabelsFromLabelable", input: "RemoveLabelsFromLabelableInput", title: "\u53BB\u6389\u6807\u7B7E" },
    updateIssue: { field: "updateIssue", input: "UpdateIssueInput", title: "\u6539\u91CC\u7A0B\u7891" },
    addAssigneesToAssignable: { field: "addAssigneesToAssignable", input: "AddAssigneesToAssignableInput", title: "\u52A0\u6307\u6D3E\u4EBA" },
    removeAssigneesFromAssignable: { field: "removeAssigneesFromAssignable", input: "RemoveAssigneesFromAssignableInput", title: "\u53BB\u6389\u6307\u6D3E\u4EBA" },
    addSubIssue: { field: "addSubIssue", input: "AddSubIssueInput", title: "\u8BBE\u7236 Issue" },
    removeSubIssue: { field: "removeSubIssue", input: "RemoveSubIssueInput", title: "\u8131\u79BB\u7236 Issue" },
    addBlockedBy: { field: "addBlockedBy", input: "AddBlockedByInput", title: "\u52A0\u4F9D\u8D56" },
    removeBlockedBy: { field: "removeBlockedBy", input: "RemoveBlockedByInput", title: "\u53BB\u6389\u4F9D\u8D56" },
    createProjectV2Field: {
      field: "createProjectV2Field",
      input: "CreateProjectV2FieldInput",
      title: "\u5EFA\u5B57\u6BB5",
      selection: "projectV2Field { ...FieldConfig }",
      fragments: fieldConfigFragment
    },
    updateProjectV2Field: {
      field: "updateProjectV2Field",
      input: "UpdateProjectV2FieldInput",
      title: "\u52A0\u9009\u9879",
      selection: "projectV2Field { ...FieldConfig }",
      fragments: fieldConfigFragment
    },
    createIssue: { field: "createIssue", input: "CreateIssueInput", title: "\u5EFA Issue", selection: "issue { id number url }" },
    addProjectV2ItemById: { field: "addProjectV2ItemById", input: "AddProjectV2ItemByIdInput", title: "\u52A0\u8FDB Project", selection: "item { id }" }
  };
  var mutations = Object.fromEntries(
    Object.entries(specs).map(([name, spec]) => [name, { name, title: spec.title, document: mutationDocument(spec) }])
  );

  // extensions/github-project/src/graphql.ts
  var terminalErrorTypes = /* @__PURE__ */ new Set(["NOT_FOUND", "FORBIDDEN", "INSUFFICIENT_SCOPES", "RATE_LIMITED"]);
  function describeErrors(errors) {
    const list2 = errors ?? [];
    if (list2.some((error) => error.type === "INSUFFICIENT_SCOPES")) {
      return "token \u7F3A\u5C11 Projects \u6743\u9650\uFF08\u53EA\u8BFB\u9700 read:project\uFF0C\u5199\u56DE\u9700 project\uFF09\uFF1A\u5230 \u8BBE\u7F6E \xB7 Git \xB7 GitHub \u66F4\u65B0 token";
    }
    if (list2.some((error) => error.type === "RATE_LIMITED")) return "GitHub \u9650\u6D41\u4E86\uFF1A\u7B49\u4E00\u4F1A\u513F\u518D\u8BD5";
    const first = list2[0];
    if (!first) return "GitHub \u6CA1\u6709\u8FD4\u56DE\u6570\u636E";
    return clamp(first.message || first.type || "GitHub \u8FD4\u56DE\u4E86\u9519\u8BEF", maxLength.summary);
  }
  function throwIfCancelled(signal) {
    if (signal?.cancelled) throw new JarvisError({ code: "cancelled", message: "\u5DF2\u53D6\u6D88" });
  }
  function rawQuery(document, variables) {
    return jarvis.git.hosting.query({ hosting, query: document, variables });
  }
  async function query(document, variables, what) {
    return outcome(await rawQuery(document, variables), what);
  }
  function outcome(response, what) {
    const errors = response.errors ?? [];
    if (response.data === null || response.data === void 0) {
      throw new GitHubError(`${what}${/[A-Za-z0-9]$/.test(what) ? " " : ""}\u5931\u8D25\uFF1A${describeErrors(errors)}`, errors);
    }
    if (errors.length) jarvis.log.warn(`${what}\uFF1AGitHub \u90E8\u5206\u6210\u529F`, errors.slice(0, 3).map((error) => error.message));
    return { data: response.data, errors };
  }
  async function mutate(document, variables, what) {
    const response = await jarvis.git.hosting.mutate({ hosting, query: document, variables });
    const errors = response.errors ?? [];
    if (errors.length || response.data === null || response.data === void 0) {
      throw new GitHubError(`GitHub \u62D2\u7EDD\u4E86\u300C${what}\u300D\uFF1A${describeErrors(errors)}`, errors);
    }
    return response.data;
  }
  var GitHubError = class extends Error {
    constructor(message, errors) {
      super(message);
      this.name = "GitHubError";
      this.errors = errors;
    }
  };
  function messageOf(error) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object" && "message" in error) return String(error.message);
    return String(error);
  }

  // extensions/github-project/src/mapping.ts
  function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
  }
  function nodes(connection) {
    const list2 = object(connection)?.["nodes"];
    return Array.isArray(list2) ? list2.map(object) : [];
  }
  function count(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : void 0;
  }
  var dataTypes = {
    TEXT: "text",
    NUMBER: "number",
    DATE: "date",
    SINGLE_SELECT: "singleSelect",
    MULTI_SELECT: "multiSelect",
    ITERATION: "iteration",
    TITLE: "title",
    ASSIGNEES: "assignees",
    LABELS: "labels",
    MILESTONE: "milestone",
    REPOSITORY: "repository",
    ISSUE_TYPE: "issueType",
    PARENT_ISSUE: "parentIssue",
    SUB_ISSUES_PROGRESS: "subIssuesProgress",
    LINKED_PULL_REQUESTS: "linkedPullRequests",
    REVIEWERS: "reviewers"
  };
  function mapDataType(value) {
    return typeof value === "string" && dataTypes[value] || "other";
  }
  var creatableTypes = {
    text: "TEXT",
    number: "NUMBER",
    date: "DATE",
    singleSelect: "SINGLE_SELECT",
    multiSelect: "MULTI_SELECT",
    iteration: "ITERATION"
  };
  function ownerLogin(owner) {
    return nonEmpty(object(owner)?.["login"], maxLength.owner) ?? "";
  }
  function mapProjectSummary(raw) {
    const id = nonEmpty(raw?.["id"], maxLength.id);
    if (!raw || !id) return null;
    const number = count(raw["number"]) ?? 0;
    const title = nonEmpty(raw["title"], maxLength.title) ?? `Project #${number}`;
    const summary = {
      id,
      number,
      title,
      owner: ownerLogin(raw["owner"]),
      url: nonEmpty(raw["url"], maxLength.url) ?? ""
    };
    const itemCount = count(object(raw["items"])?.["totalCount"]);
    if (itemCount !== void 0) summary.itemCount = itemCount;
    const updatedAt = timestamp(raw["updatedAt"]);
    if (updatedAt) summary.updatedAt = updatedAt;
    if (typeof raw["closed"] === "boolean") summary.closed = raw["closed"];
    return summary;
  }
  function mapOptions(list2) {
    if (!Array.isArray(list2)) return [];
    const options = [];
    for (const entry of list2) {
      const raw = object(entry);
      const id = nonEmpty(raw?.["id"], maxLength.id);
      const name = nonEmpty(raw?.["name"], maxLength.name);
      if (!id || !name) continue;
      const option = { id, name };
      const color = nonEmpty(raw?.["color"], maxLength.color);
      if (color) option.color = color;
      options.push(option);
      if (options.length === 200) break;
    }
    return options;
  }
  function mapIteration(raw, completed) {
    const id = nonEmpty(raw?.["id"], maxLength.id);
    const title = nonEmpty(raw?.["title"], maxLength.name);
    const startDate = day(raw?.["startDate"]);
    const durationDays = count(raw?.["duration"]);
    if (!id || !title || !startDate || durationDays === void 0 || durationDays < 1 || durationDays > 365) return null;
    return { id, title, startDate, durationDays, completed };
  }
  function mapField(raw, issueTypes) {
    const id = nonEmpty(raw?.["id"], maxLength.id);
    const name = nonEmpty(raw?.["name"], maxLength.name);
    if (!raw || !id || !name) return null;
    const dataType = mapDataType(raw["dataType"]);
    const field = { id, name, dataType };
    if (dataType === "singleSelect") field.options = mapOptions(raw["options"]);
    if (dataType === "multiSelect") field.options = mapOptions(raw["multiSelectOptions"]);
    if (dataType === "issueType" && issueTypes && issueTypes.length > 0) field.options = issueTypes.slice(0, 200);
    if (dataType === "iteration") {
      const configuration = object(raw["configuration"]);
      const iterations = [
        ...nodesOf(configuration?.["completedIterations"]).map((entry) => mapIteration(entry, true)),
        ...nodesOf(configuration?.["iterations"]).map((entry) => mapIteration(entry, false))
      ].filter((entry) => entry !== null);
      iterations.sort((a, b) => a.startDate.localeCompare(b.startDate));
      field.iterations = iterations.slice(-200);
      const duration = count(configuration?.["duration"]);
      if (duration !== void 0 && duration >= 1 && duration <= 365) field.iterationDurationDays = duration;
    }
    return field;
  }
  function nodesOf(list2) {
    return Array.isArray(list2) ? list2.map(object) : [];
  }
  function mapFieldValue(raw) {
    const fieldId = nonEmpty(object(raw?.["field"])?.["id"], maxLength.id);
    if (!raw || !fieldId) return null;
    switch (raw["__typename"]) {
      case "ProjectV2ItemFieldTextValue":
        return typeof raw["text"] === "string" ? { fieldId, value: { text: clamp(raw["text"], maxLength.text) } } : null;
      case "ProjectV2ItemFieldNumberValue":
        return typeof raw["number"] === "number" && Number.isFinite(raw["number"]) ? { fieldId, value: { number: raw["number"] } } : null;
      case "ProjectV2ItemFieldDateValue": {
        const date = day(raw["date"]);
        return date ? { fieldId, value: { date } } : null;
      }
      case "ProjectV2ItemFieldSingleSelectValue": {
        const optionId = nonEmpty(raw["optionId"], maxLength.id);
        return optionId ? { fieldId, value: { optionId } } : null;
      }
      case "ProjectV2ItemFieldMultiSelectValue": {
        const options = Array.isArray(raw["options"]) ? raw["options"] : [];
        const optionIds = options.map((entry) => nonEmpty(object(entry)?.["id"], maxLength.id)).filter((entry) => entry !== void 0).slice(0, 50);
        return { fieldId, value: { optionIds } };
      }
      case "ProjectV2ItemFieldIterationValue": {
        const iterationId = nonEmpty(raw["iterationId"], maxLength.id);
        return iterationId ? { fieldId, value: { iterationId } } : null;
      }
      default:
        return null;
    }
  }
  function mapRef(raw) {
    const repository = nonEmpty(object(raw?.["repository"])?.["nameWithOwner"], 200);
    const number = count(raw?.["number"]);
    if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository) || !number) return null;
    return { repository, number };
  }
  function logins(connection, limit) {
    return nodes(connection).map((node) => nonEmpty(node?.["login"], maxLength.login)).filter((entry) => entry !== void 0).slice(0, limit);
  }
  var contentTypes = {
    Issue: "issue",
    PullRequest: "pullRequest",
    DraftIssue: "draftIssue"
  };
  function mapItem(raw) {
    const id = nonEmpty(raw?.["id"], maxLength.id);
    const updatedAt = timestamp(raw?.["updatedAt"]);
    const rawContent = object(raw?.["content"]);
    const contentType = contentTypes[String(rawContent?.["__typename"])];
    if (!raw || !id || !updatedAt || !rawContent || !contentType) return null;
    const content = {
      title: typeof rawContent["title"] === "string" ? clamp(rawContent["title"], maxLength.itemTitle) : ""
    };
    if (contentType !== "draftIssue") {
      const ref = mapRef(rawContent);
      if (!ref) return null;
      content.repository = ref.repository;
      content.number = ref.number;
      const url = nonEmpty(rawContent["url"], maxLength.url);
      if (url) content.url = url;
      if (typeof rawContent["closed"] === "boolean") content.isOpen = !rawContent["closed"];
      const author = nonEmpty(object(rawContent["author"])?.["login"], maxLength.login);
      if (author) content.author = author;
      const labels = nodes(rawContent["labels"]).map((node) => nonEmpty(node?.["name"], maxLength.label)).filter((entry) => entry !== void 0).slice(0, 50);
      if (labels.length) content.labels = labels;
      const milestone = object(rawContent["milestone"]);
      const milestoneTitle = nonEmpty(milestone?.["title"], maxLength.milestone);
      if (milestoneTitle) content.milestone = milestoneTitle;
      const due = day(milestone?.["dueOn"]);
      if (milestoneTitle && due) content.milestoneDueOn = due;
      const issueType = nonEmpty(object(rawContent["issueType"])?.["name"], maxLength.issueType);
      if (issueType) content.issueType = issueType;
      const closedAt = timestamp(rawContent["closedAt"]);
      if (closedAt) content.closedAt = closedAt;
    }
    const assignees = logins(rawContent["assignees"], 20);
    if (assignees.length) content.assignees = assignees;
    const createdAt = timestamp(rawContent["createdAt"]);
    if (createdAt) content.createdAt = createdAt;
    const item = { id, contentType, updatedAt, content };
    if (raw["isArchived"] === true) item.archived = true;
    const values = {};
    let valueCount = 0;
    for (const node of nodes(raw["fieldValues"])) {
      const mapped = mapFieldValue(node);
      if (!mapped || mapped.fieldId in values) continue;
      values[mapped.fieldId] = mapped.value;
      valueCount += 1;
      if (valueCount === 100) break;
    }
    if (valueCount) item.values = values;
    if (contentType === "issue") {
      const relations = {};
      const parent = mapRef(object(rawContent["parent"]));
      if (parent) relations.parent = parent;
      const blockedBy = nodes(rawContent["blockedBy"]).map(mapRef).filter((entry) => entry !== null).slice(0, 50);
      if (blockedBy.length) relations.blockedBy = blockedBy;
      const summary = object(rawContent["subIssuesSummary"]);
      const total = count(summary?.["total"]);
      const completed = count(summary?.["completed"]);
      if (total !== void 0) {
        relations.subIssueTotal = total;
        relations.subIssueDone = Math.min(completed ?? 0, total);
      }
      if (Object.keys(relations).length) item.relations = relations;
    }
    return item;
  }

  // extensions/github-project/src/projects.ts
  function summaries(connection) {
    const projects = (connection?.nodes ?? []).map(mapProjectSummary).filter((entry) => entry !== null);
    return { projects: projects.slice(0, 200) };
  }
  function splitRepository(repository) {
    const match = /^([^/\s]+)\/([^/\s]+)$/.exec(repository);
    if (!match) throw new Error(`\u4ED3\u5E93\u8981\u5199\u6210 owner/name\uFF0C\u6536\u5230\u7684\u662F\u300C${repository}\u300D`);
    return { owner: match[1], name: match[2] };
  }
  async function listProjects(request, signal) {
    throwIfCancelled(signal);
    if (request.repository) {
      const { owner, name } = splitRepository(request.repository);
      const { data: data2 } = await query(
        listRepositoryProjects,
        { owner, name },
        "\u8BFB\u4ED3\u5E93\u5173\u8054\u7684 Project"
      );
      if (!data2.repository) throw new GitHubError(`\u627E\u4E0D\u5230\u4ED3\u5E93 ${request.repository}\uFF08\u6216 token \u770B\u4E0D\u5230\u5B83\uFF09`, []);
      return summaries(data2.repository.projectsV2);
    }
    if (request.owner) {
      const { data: data2 } = await query(
        listOwnerProjects,
        { owner: request.owner },
        "\u8BFB\u8D26\u53F7\u7684 Project"
      );
      if (!data2.repositoryOwner) throw new GitHubError(`\u627E\u4E0D\u5230 GitHub \u8D26\u53F7\u6216\u7EC4\u7EC7\u300C${request.owner}\u300D`, []);
      return summaries(data2.repositoryOwner.projectsV2);
    }
    const { data } = await query(listViewerProjects, {}, "\u8BFB\u4F60\u7684 Project");
    return summaries(data.viewer?.projectsV2);
  }
  async function readIssueTypes(login) {
    try {
      const { data } = await query(
        organizationIssueTypes,
        { login },
        "\u8BFB\u7EC4\u7EC7\u7684 Issue Type"
      );
      const nodes2 = (data.organization?.issueTypes?.nodes ?? []).filter((node) => node?.["isEnabled"] !== false);
      return mapOptions(nodes2);
    } catch {
      return [];
    }
  }
  async function readSchema2(request, signal) {
    if (!request.projectId) throw new Error("\u7F3A\u5C11 projectId");
    throwIfCancelled(signal);
    const { data } = await query(readSchema, { id: request.projectId }, "\u8BFB\u5B57\u6BB5\u7ED3\u6784");
    const node = data.node;
    if (!node) throw new GitHubError("\u627E\u4E0D\u5230\u8FD9\u4E2A Project\uFF08\u6216 token \u770B\u4E0D\u5230\u5B83\uFF09", []);
    if (node.__typename !== "ProjectV2") throw new GitHubError(`\u300C${request.projectId}\u300D\u4E0D\u662F\u4E00\u4E2A Project`, []);
    const project = mapProjectSummary(node);
    if (!project) throw new GitHubError("\u8FD9\u4E2A Project \u7684\u6982\u8981\u8BFB\u4E0D\u51FA\u6765", []);
    const rawFields = (node.fields?.nodes ?? []).slice(0, fieldsPerProject);
    let issueTypes;
    const ownerIsOrganization = node.owner?.__typename === "Organization" && Boolean(node.owner.login);
    if (ownerIsOrganization && rawFields.some((field) => field?.["dataType"] === "ISSUE_TYPE")) {
      throwIfCancelled(signal);
      issueTypes = await readIssueTypes(node.owner.login);
    }
    const fields = rawFields.map((field) => mapField(field, issueTypes)).filter((field) => field !== null);
    return { project, fields };
  }

  // extensions/github-project/src/add.ts
  function planAddItem(request) {
    if (!request.projectId) throw new Error("\u7F3A\u5C11 projectId");
    if (!request.repository) throw new Error("\u7F3A\u5C11 Issue \u6240\u5728\u7684\u4ED3\u5E93");
    const { owner, name } = splitRepository(request.repository);
    const number = request.number;
    if (typeof number !== "number" || !Number.isInteger(number) || number < 1) throw new Error("Issue \u7F16\u53F7\u8981\u662F\u4E00\u4E2A\u6B63\u6574\u6570");
    return { projectId: request.projectId, repository: request.repository, owner, name, number };
  }
  function minimalAddedItem(itemId, plan, issue) {
    const content = {
      repository: plan.repository,
      number: plan.number,
      title: clamp(issue.title || `#${plan.number}`, maxLength.itemTitle),
      isOpen: issue.isOpen
    };
    const url = nonEmpty(issue.url, maxLength.url);
    if (url) content.url = url;
    return { id: itemId, contentType: "issue", updatedAt: (/* @__PURE__ */ new Date()).toISOString(), content, values: {} };
  }
  async function addItem(request, signal) {
    const plan = planAddItem(request);
    throwIfCancelled(signal);
    const { data } = await query(issueId, { owner: plan.owner, name: plan.name, number: plan.number }, "\u8BFB Issue");
    const issue = data.repository?.["issue"] ?? null;
    const contentId = issue?.["id"];
    if (typeof contentId !== "string" || !contentId) {
      throw new GitHubError(`\u627E\u4E0D\u5230 ${plan.repository}#${plan.number}\uFF08\u4E0D\u5B58\u5728\u3001\u662F Pull Request\uFF0C\u6216 token \u770B\u4E0D\u5230\u5B83\uFF09`, []);
    }
    const title = typeof issue?.["title"] === "string" ? issue["title"] : "";
    const url = typeof issue?.["url"] === "string" ? issue["url"] : void 0;
    const isOpen = issue?.["state"] !== "CLOSED";
    throwIfCancelled(signal);
    const add = mutations.addProjectV2ItemById;
    const added = await mutate(add.document, { input: { projectId: plan.projectId, contentId } }, add.title);
    const itemId = added.addProjectV2ItemById?.item?.["id"];
    if (typeof itemId !== "string" || !itemId) throw new GitHubError(`GitHub \u62D2\u7EDD\u4E86\u300C${add.title}\u300D\uFF1A\u6CA1\u6709\u4EA4\u56DE Project \u6761\u76EE`, []);
    try {
      const { data: read } = await query(readItem, { id: itemId }, "\u8BFB\u56DE\u6761\u76EE");
      const item = mapItem(read.node);
      if (item) return { item };
      jarvis.log.warn("Issue \u5DF2\u52A0\u8FDB Project\uFF0C\u8BFB\u56DE\u7684\u90A3\u4E00\u6761\u8BFB\u4E0D\u51FA\uFF1B\u5148\u4EA4\u56DE\u6700\u5C0F\u6761\u76EE\uFF0C\u5BBF\u4E3B\u4E0B\u6B21\u540C\u6B65\u4F1A\u6821\u6B63", itemId);
    } catch (error) {
      jarvis.log.warn("Issue \u5DF2\u52A0\u8FDB Project\uFF0C\u8BFB\u56DE\u90A3\u4E00\u6761\u5931\u8D25\uFF1B\u5148\u4EA4\u56DE\u6700\u5C0F\u6761\u76EE\uFF0C\u5BBF\u4E3B\u4E0B\u6B21\u540C\u6B65\u4F1A\u6821\u6B63", messageOf(error));
    }
    return { item: minimalAddedItem(itemId, plan, { title, ...url ? { url } : {}, isOpen }) };
  }

  // extensions/github-project/src/create.ts
  var maxIssueTitle = 256;
  var maxIssueBody = 65536;
  function planCreateItem(request) {
    if (!request.projectId) throw new Error("\u7F3A\u5C11 projectId");
    if (!request.repository) throw new Error("\u7F3A\u5C11\u8981\u5EFA Issue \u7684\u4ED3\u5E93");
    const { owner, name } = splitRepository(request.repository);
    const title = typeof request.title === "string" ? request.title.trim() : "";
    if (!title) throw new Error("Issue \u6807\u9898\u4E0D\u80FD\u662F\u7A7A\u7684");
    if (Array.from(title).length > maxIssueTitle) throw new Error(`Issue \u6807\u9898\u8D85\u8FC7 ${maxIssueTitle} \u5B57`);
    const plan = { projectId: request.projectId, repository: request.repository, owner, name, title };
    if (typeof request.body === "string" && request.body.length > 0) {
      if (Array.from(request.body).length > maxIssueBody) throw new Error("Issue \u6B63\u6587\u8D85\u8FC7 65,536 \u5B57");
      plan.body = request.body;
    }
    return plan;
  }
  function minimalItem(itemId, plan, issue) {
    const content = {
      repository: plan.repository,
      number: issue.number,
      title: clamp(plan.title, maxLength.itemTitle),
      isOpen: true
    };
    const url = nonEmpty(issue.url, maxLength.url);
    if (url) content.url = url;
    return { id: itemId, contentType: "issue", updatedAt: (/* @__PURE__ */ new Date()).toISOString(), content, values: {} };
  }
  function createdIssue(raw) {
    const id = raw?.["id"];
    const number = raw?.["number"];
    if (typeof id !== "string" || !id || typeof number !== "number" || !Number.isInteger(number) || number < 1) return null;
    const url = raw?.["url"];
    return typeof url === "string" ? { id, number, url } : { id, number };
  }
  async function createItem(request, signal) {
    const plan = planCreateItem(request);
    throwIfCancelled(signal);
    const { data } = await query(repositoryId, { owner: plan.owner, name: plan.name }, "\u8BFB\u4ED3\u5E93");
    const repositoryNode = data.repository?.["id"];
    if (typeof repositoryNode !== "string" || !repositoryNode) {
      throw new GitHubError(`\u627E\u4E0D\u5230\u4ED3\u5E93 ${plan.repository}\uFF08\u6216 token \u770B\u4E0D\u5230\u5B83\uFF09`, []);
    }
    throwIfCancelled(signal);
    const create = mutations.createIssue;
    const input = { repositoryId: repositoryNode, title: plan.title };
    if (plan.body !== void 0) input["body"] = plan.body;
    const created = await mutate(create.document, { input }, create.title);
    const issue = createdIssue(created.createIssue?.issue);
    if (!issue) throw new GitHubError(`GitHub \u62D2\u7EDD\u4E86\u300C${create.title}\u300D\uFF1A\u6CA1\u6709\u4EA4\u56DE\u5EFA\u597D\u7684 Issue`, []);
    let itemId;
    try {
      const add = mutations.addProjectV2ItemById;
      const added = await mutate(
        add.document,
        { input: { projectId: plan.projectId, contentId: issue.id } },
        add.title
      );
      const id = added.addProjectV2ItemById?.item?.["id"];
      if (typeof id !== "string" || !id) throw new GitHubError(`GitHub \u62D2\u7EDD\u4E86\u300C${add.title}\u300D\uFF1A\u6CA1\u6709\u4EA4\u56DE Project \u6761\u76EE`, []);
      itemId = id;
    } catch (error) {
      const message = `Issue #${issue.number} \u5DF2\u5EFA\u5728 ${plan.repository}\uFF0C\u4F46\u6CA1\u80FD\u52A0\u8FDB Project\uFF1A${messageOf(error)}`;
      if (error instanceof JarvisError) throw new JarvisError({ code: error.code, message, ...error.detail ? { detail: error.detail } : {} });
      throw new Error(message);
    }
    try {
      const { data: read } = await query(readItem, { id: itemId }, "\u8BFB\u56DE\u6761\u76EE");
      const item = mapItem(read.node);
      if (item) return { item };
      jarvis.log.warn("Issue \u5DF2\u5EFA\u597D\u5E76\u52A0\u8FDB Project\uFF0C\u8BFB\u56DE\u7684\u90A3\u4E00\u6761\u8BFB\u4E0D\u51FA\uFF1B\u5148\u4EA4\u56DE\u6700\u5C0F\u6761\u76EE\uFF0C\u5BBF\u4E3B\u4E0B\u6B21\u540C\u6B65\u4F1A\u6821\u6B63", itemId);
    } catch (error) {
      jarvis.log.warn("Issue \u5DF2\u5EFA\u597D\u5E76\u52A0\u8FDB Project\uFF0C\u8BFB\u56DE\u90A3\u4E00\u6761\u5931\u8D25\uFF1B\u5148\u4EA4\u56DE\u6700\u5C0F\u6761\u76EE\uFF0C\u5BBF\u4E3B\u4E0B\u6B21\u540C\u6B65\u4F1A\u6821\u6B63", messageOf(error));
    }
    return { item: minimalItem(itemId, plan, issue) };
  }

  // extensions/github-project/src/describe.ts
  var features = [
    "nativeHierarchy",
    "nativeDependencies",
    "issueTypes",
    "createFields",
    "draftIssues",
    "createIterations",
    "createItems",
    "readItemsById",
    "addItems"
  ];
  var missingScopeProblem = "token \u7F3A\u5C11 project \u6743\u9650\uFF08\u53EA\u8BFB\u9700 read:project\uFF09";
  async function describe(context) {
    const base = { contractVersion: projectEngineContractVersion, hosting, features };
    const unavailable = (summary2, problem) => ({
      ...base,
      ready: false,
      summary: clamp(summary2, maxLength.summary),
      problem: clamp(problem, maxLength.summary)
    });
    if (!context.granted.includes("git.hosting.read")) {
      return unavailable("\u8FD8\u6CA1\u6709\u6388\u6743\u8BFB\u53D6 GitHub", "\u6CA1\u6709\u300C\u8BFB\u53D6 Git \u670D\u52A1\u6570\u636E\u300D\u6388\u6743\uFF1A\u5230 \u8BBE\u7F6E \xB7 \u6269\u5C55 \xB7 GitHub \u9879\u76EE \u91CC\u6253\u5F00\u5B83");
    }
    let viewer;
    try {
      viewer = await jarvis.git.hosting.viewer({ hosting });
    } catch (error) {
      return unavailable("\u8FDE\u4E0D\u4E0A GitHub", messageOf(error));
    }
    const who = viewer.login ? `GitHub \xB7 ${viewer.login}` : "GitHub";
    if (viewer.projectAccess === "none") return unavailable(`\u5DF2\u63A5\u4E0A ${who}\uFF0C\u4F46 token \u8BFB\u4E0D\u4E86 Project`, missingScopeProblem);
    const limits = [];
    if (viewer.projectAccess === "readOnly") limits.push("token \u53EA\u6709 read:project\uFF0C\u53EA\u80FD\u8BFB");
    if (viewer.projectAccess === "unknown") limits.push("fine-grained token \u770B\u4E0D\u51FA Projects \u6743\u9650\uFF0C\u8BFB\u5199\u65F6\u624D\u77E5\u9053");
    if (!context.granted.includes("git.hosting.write")) limits.push("\u6CA1\u6709\u6388\u6743\u4FEE\u6539\uFF0C\u53EA\u8BFB\u6D4F\u89C8");
    const summary = limits.length ? `\u5DF2\u63A5\u4E0A ${who}\uFF08${limits.join("\uFF1B")}\uFF09` : `\u5DF2\u63A5\u4E0A ${who}`;
    return { ...base, ready: true, summary: clamp(summary, maxLength.summary) };
  }

  // extensions/github-project/src/edit.ts
  function changeTitle(change) {
    switch (change.op) {
      case "setFieldValue":
        return "\u6539\u5B57\u6BB5\u503C";
      case "clearFieldValue":
        return "\u6E05\u7A7A\u5B57\u6BB5\u503C";
      case "setIssueState":
        return change.open ? "\u91CD\u65B0\u6253\u5F00 Issue" : "\u5173\u95ED Issue";
      case "setIssueType":
        return "\u6539 Issue Type";
      case "setLabels":
        return "\u6539\u6807\u7B7E";
      case "setMilestone":
        return "\u6539\u91CC\u7A0B\u7891";
      case "setAssignees":
        return "\u6539\u6307\u6D3E\u4EBA";
      case "setParent":
        return "\u6539\u7236 Issue";
      case "addBlockedBy":
        return "\u52A0\u4F9D\u8D56";
      case "removeBlockedBy":
        return "\u53BB\u6389\u4F9D\u8D56";
    }
  }
  function fieldValueInput(value) {
    if ("text" in value) return { text: value.text };
    if ("number" in value) return { number: value.number };
    if ("date" in value) return { date: value.date };
    if ("optionId" in value) return { singleSelectOptionId: value.optionId };
    if ("optionIds" in value) return value.optionIds.length ? { multiSelectOptionIds: value.optionIds } : null;
    return { iterationId: value.iterationId };
  }
  function refKey(ref) {
    return `${ref.repository.toLowerCase()}#${ref.number}`;
  }
  function touchesContent(change) {
    return change.op !== "setFieldValue" && change.op !== "clearFieldValue";
  }
  function planResolve(ref, changes) {
    const { owner, name } = splitRepository(ref.repository);
    const variables = { owner, name, number: ref.number };
    const declarations = ["$owner: String!", "$name: String!", "$number: Int!"];
    const inRepository = [];
    const atRoot = [];
    const labels = /* @__PURE__ */ new Map();
    const users = /* @__PURE__ */ new Map();
    const refs = /* @__PURE__ */ new Map();
    let milestones = false;
    let issueTypes = false;
    const addRef = (other) => {
      const key = refKey(other);
      if (refs.has(key)) return;
      const alias = `r${refs.size}`;
      refs.set(key, alias);
      const parts = splitRepository(other.repository);
      declarations.push(`$${alias}Owner: String!`, `$${alias}Name: String!`, `$${alias}Number: Int!`);
      Object.assign(variables, { [`${alias}Owner`]: parts.owner, [`${alias}Name`]: parts.name, [`${alias}Number`]: other.number });
      atRoot.push(
        `${alias}: repository(owner: $${alias}Owner, name: $${alias}Name) { issueOrPullRequest(number: $${alias}Number) { __typename ... on Issue { id } } }`
      );
    };
    for (const change of changes) {
      switch (change.op) {
        case "setLabels":
          for (const label of [...change.add, ...change.remove]) {
            if (labels.has(label)) continue;
            const alias = `l${labels.size}`;
            labels.set(label, alias);
            declarations.push(`$${alias}: String!`);
            variables[alias] = label;
            inRepository.push(`${alias}: label(name: $${alias}) { id name }`);
          }
          break;
        case "setMilestone":
          if (change.title !== null && !milestones) {
            milestones = true;
            declarations.push("$milestone: String");
            variables["milestone"] = change.title;
            inRepository.push(`milestones(first: ${milestonesPerSearch}, query: $milestone, states: [OPEN, CLOSED]) { nodes { id title } }`);
          }
          break;
        case "setIssueType":
          if (!issueTypes) {
            issueTypes = true;
            inRepository.push(`issueTypes(first: ${issueTypesPerOwner}) { nodes { id name isEnabled } }`);
          }
          break;
        case "setAssignees":
          for (const login of change.logins) {
            const key = login.toLowerCase();
            if (users.has(key)) continue;
            const alias = `u${users.size}`;
            users.set(key, alias);
            declarations.push(`$${alias}: String!`);
            variables[alias] = login;
            atRoot.push(`${alias}: user(login: $${alias}) { id login }`);
          }
          break;
        case "setParent":
          if (change.parent) addRef(change.parent);
          break;
        case "addBlockedBy":
        case "removeBlockedBy":
          addRef(change.ref);
          break;
        default:
          break;
      }
    }
    const assignees = `assignees(first: ${currentAssignees}) { nodes { id login } }`;
    const document = `query ResolveEdit(${declarations.join(", ")}) {
  repository(owner: $owner, name: $name) {
    target: issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { id closed parent { id number repository { nameWithOwner } } ${assignees} }
      ... on PullRequest { id closed ${assignees} }
    }
${inRepository.map((line) => `    ${line}`).join("\n")}
  }
${atRoot.map((line) => `  ${line}`).join("\n")}
}`;
    return { document, variables, labels, users, refs, milestones, issueTypes };
  }
  function list(value) {
    const nodes2 = value?.nodes;
    return Array.isArray(nodes2) ? nodes2 : [];
  }
  function str(value) {
    return typeof value === "string" && value.length > 0 ? value : void 0;
  }
  async function resolve(ref, changes) {
    const plan = planResolve(ref, changes);
    const { data } = await query(plan.document, plan.variables, "\u8BFB\u8981\u6539\u7684 Issue");
    const repository = data["repository"];
    if (!repository) throw new Error(`\u627E\u4E0D\u5230\u4ED3\u5E93 ${ref.repository}\uFF08\u6216 token \u770B\u4E0D\u5230\u5B83\uFF09`);
    const target = repository["target"];
    const kind = target?.["__typename"];
    const id = str(target?.["id"]);
    if (!target || !id || kind !== "Issue" && kind !== "PullRequest") throw new Error(`\u627E\u4E0D\u5230 ${ref.repository}#${ref.number}`);
    const rawParent = target["parent"];
    const parentRepository = str(rawParent?.["repository"]?.["nameWithOwner"]);
    const parentNumber = rawParent?.["number"];
    const parentID = str(rawParent?.["id"]);
    const resolved = {
      ref,
      kind,
      id,
      closed: target["closed"] === true,
      parent: parentID ? {
        id: parentID,
        key: parentRepository && typeof parentNumber === "number" ? refKey({ repository: parentRepository, number: parentNumber }) : null
      } : null,
      assignees: list(target["assignees"]).flatMap((node) => {
        const personID = str(node?.["id"]);
        const login = str(node?.["login"]);
        return personID && login ? [{ id: personID, login }] : [];
      }),
      labelIds: /* @__PURE__ */ new Map(),
      milestones: list(repository["milestones"]).flatMap((node) => {
        const milestoneID = str(node?.["id"]);
        const title = str(node?.["title"]);
        return milestoneID && title ? [{ id: milestoneID, title }] : [];
      }),
      issueTypes: list(repository["issueTypes"]).flatMap((node) => {
        const typeID = str(node?.["id"]);
        const name = str(node?.["name"]);
        return typeID && name && node?.["isEnabled"] !== false ? [{ id: typeID, name }] : [];
      }),
      userIds: /* @__PURE__ */ new Map(),
      refIds: /* @__PURE__ */ new Map()
    };
    for (const [label, alias] of plan.labels) {
      const labelID = str(repository[alias]?.["id"]);
      if (labelID) resolved.labelIds.set(label, labelID);
    }
    for (const [login, alias] of plan.users) {
      const userID = str(data[alias]?.["id"]);
      if (userID) resolved.userIds.set(login, userID);
    }
    for (const [key, alias] of plan.refs) {
      const issue = data[alias]?.["issueOrPullRequest"];
      const issueID = issue?.["__typename"] === "Issue" ? str(issue["id"]) : void 0;
      if (issueID) resolved.refIds.set(key, issueID);
    }
    return resolved;
  }
  function send(name, input) {
    const mutation = mutations[name];
    return mutate(mutation.document, { input }, mutation.title);
  }
  function requireIssue(target, change) {
    const resolved = requireContent(target, change);
    if (resolved.kind !== "Issue") {
      throw new Error(`${resolved.ref.repository}#${resolved.ref.number} \u662F Pull Request\uFF0C\u300C${changeTitle(change)}\u300D\u53EA\u5BF9 Issue \u6709\u6548`);
    }
    return resolved;
  }
  function requireContent(target, change) {
    if (!target) throw new Error(`\u8349\u7A3F\u8FD8\u4E0D\u662F Issue\uFF0C\u4E0D\u80FD${changeTitle(change)}`);
    return target;
  }
  function refID(target, ref) {
    const id = target.refIds.get(refKey(ref));
    if (!id) throw new Error(`\u627E\u4E0D\u5230 Issue ${ref.repository}#${ref.number}\uFF08\u6216\u5B83\u662F PR\u3001token \u770B\u4E0D\u5230\u5B83\uFF09`);
    return id;
  }
  async function applyOne(request, target, change) {
    const item = { projectId: request.projectId, itemId: request.itemId };
    switch (change.op) {
      case "setFieldValue": {
        const value = fieldValueInput(change.value);
        if (value) await send("updateProjectV2ItemFieldValue", { ...item, fieldId: change.fieldId, value });
        else await send("clearProjectV2ItemFieldValue", { ...item, fieldId: change.fieldId });
        return;
      }
      case "clearFieldValue":
        await send("clearProjectV2ItemFieldValue", { ...item, fieldId: change.fieldId });
        return;
      case "setIssueState": {
        const issue = requireIssue(target, change);
        if (change.open === !issue.closed) return;
        if (change.open) await send("reopenIssue", { issueId: issue.id });
        else await send("closeIssue", { issueId: issue.id, stateReason: change.reason === "notPlanned" ? "NOT_PLANNED" : "COMPLETED" });
        issue.closed = !change.open;
        return;
      }
      case "setIssueType": {
        const issue = requireIssue(target, change);
        const wanted = change.name.trim().toLowerCase();
        const type = issue.issueTypes.find((entry) => entry.name.toLowerCase() === wanted);
        if (!type) {
          throw new Error(
            issue.issueTypes.length ? `\u4ED3\u5E93 ${issue.ref.repository} \u6CA1\u6709\u540D\u4E3A\u300C${change.name}\u300D\u7684 Issue Type` : `\u4ED3\u5E93 ${issue.ref.repository} \u7528\u4E0D\u4E86 Issue Type\uFF08\u53EA\u6709\u7EC4\u7EC7\u4ED3\u5E93\u91CC\u6709\uFF09`
          );
        }
        await send("updateIssueIssueType", { issueId: issue.id, issueTypeId: type.id });
        return;
      }
      case "setLabels": {
        const content = requireContent(target, change);
        const missing = change.add.filter((label) => !content.labelIds.has(label));
        if (missing.length) throw new Error(`\u4ED3\u5E93 ${content.ref.repository} \u91CC\u6CA1\u6709\u6807\u7B7E\u300C${missing.join("\u300D\u300C")}\u300D`);
        const add = change.add.map((label) => content.labelIds.get(label));
        const remove = change.remove.flatMap((label) => {
          const id = content.labelIds.get(label);
          return id ? [id] : [];
        });
        if (add.length) await send("addLabelsToLabelable", { labelableId: content.id, labelIds: add });
        if (remove.length) await send("removeLabelsFromLabelable", { labelableId: content.id, labelIds: remove });
        return;
      }
      case "setMilestone": {
        const issue = requireIssue(target, change);
        if (change.title === null) {
          await send("updateIssue", { id: issue.id, milestoneId: null });
          return;
        }
        const title = change.title;
        const milestone = issue.milestones.find((entry) => entry.title === title) ?? issue.milestones.find((entry) => entry.title.toLowerCase() === title.toLowerCase());
        if (!milestone) throw new Error(`\u4ED3\u5E93 ${issue.ref.repository} \u91CC\u6CA1\u6709\u91CC\u7A0B\u7891\u300C${title}\u300D`);
        await send("updateIssue", { id: issue.id, milestoneId: milestone.id });
        return;
      }
      case "setAssignees": {
        const content = requireContent(target, change);
        const wanted = new Set(change.logins.map((login) => login.toLowerCase()));
        const current = new Set(content.assignees.map((person) => person.login.toLowerCase()));
        const toAdd = change.logins.filter((login) => !current.has(login.toLowerCase()));
        const missing = toAdd.filter((login) => !content.userIds.has(login.toLowerCase()));
        if (missing.length) throw new Error(`\u627E\u4E0D\u5230 GitHub \u7528\u6237\u300C${missing.join("\u300D\u300C")}\u300D`);
        const addIDs = [...new Set(toAdd.map((login) => content.userIds.get(login.toLowerCase())))];
        const remove = content.assignees.filter((person) => !wanted.has(person.login.toLowerCase()));
        if (addIDs.length) await send("addAssigneesToAssignable", { assignableId: content.id, assigneeIds: addIDs });
        if (remove.length) await send("removeAssigneesFromAssignable", { assignableId: content.id, assigneeIds: remove.map((person) => person.id) });
        return;
      }
      case "setParent": {
        const issue = requireIssue(target, change);
        if (change.parent === null) {
          if (!issue.parent) return;
          await send("removeSubIssue", { issueId: issue.parent.id, subIssueId: issue.id });
          issue.parent = null;
          return;
        }
        const key = refKey(change.parent);
        if (issue.parent?.key === key) return;
        const parentID = refID(issue, change.parent);
        await send("addSubIssue", { issueId: parentID, subIssueId: issue.id, replaceParent: true });
        issue.parent = { id: parentID, key };
        return;
      }
      case "addBlockedBy": {
        const issue = requireIssue(target, change);
        await send("addBlockedBy", { issueId: issue.id, blockingIssueId: refID(issue, change.ref) });
        return;
      }
      case "removeBlockedBy": {
        const issue = requireIssue(target, change);
        await send("removeBlockedBy", { issueId: issue.id, blockingIssueId: refID(issue, change.ref) });
        return;
      }
    }
  }
  async function applyEdit(request, signal) {
    if (!request.projectId || !request.itemId) throw new Error("\u7F3A\u5C11 projectId \u6216 itemId");
    const changes = request.changes ?? [];
    if (!changes.length) throw new Error("\u6CA1\u6709\u8981\u6267\u884C\u7684\u7F16\u8F91");
    throwIfCancelled(signal);
    let target = null;
    if (changes.some(touchesContent) && request.contentRef) target = await resolve(request.contentRef, changes);
    for (const [index, change] of changes.entries()) {
      try {
        throwIfCancelled(signal);
        await applyOne(request, target, change);
      } catch (error) {
        if (error instanceof JarvisError && error.code === "cancelled") throw error;
        const done = index > 0 ? `\uFF1B\u524D ${index} \u6B65\u5DF2\u7ECF\u5199\u5165` : "";
        const message = `\u7B2C ${index + 1} \u6B65\uFF08${changeTitle(change)}\uFF09\u6CA1\u505A\u6210\uFF1A${messageOf(error)}${done}`;
        if (error instanceof JarvisError) throw new JarvisError({ code: error.code, message, ...error.detail ? { detail: error.detail } : {} });
        throw new Error(message);
      }
    }
    try {
      const { data } = await query(readItem, { id: request.itemId }, "\u8BFB\u56DE\u6761\u76EE");
      const item = mapItem(data.node);
      return item ? { item } : {};
    } catch (error) {
      jarvis.log.warn("\u7F16\u8F91\u5DF2\u5199\u5165\uFF0C\u8BFB\u56DE\u90A3\u4E00\u6761\u5931\u8D25\uFF1B\u5BBF\u4E3B\u4E0B\u6B21\u540C\u6B65\u4F1A\u6821\u6B63", messageOf(error));
      return {};
    }
  }

  // extensions/github-project/src/fields.ts
  var newOptionColor = "GRAY";
  var defaultIterationDays = 14;
  var initialIterations = 3;
  function iterationConfiguration(durationDays, today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)) {
    return {
      startDate: today,
      duration: durationDays,
      iterations: Array.from({ length: initialIterations }, (_, index) => ({
        title: `Iteration ${index + 1}`,
        startDate: addDays(today, index * durationDays),
        duration: durationDays
      }))
    };
  }
  function createFieldInput(request, today) {
    const name = request.name?.trim();
    if (!name) throw new Error("\u5B57\u6BB5\u540D\u4E0D\u80FD\u662F\u7A7A\u7684");
    const dataType = creatableTypes[request.dataType];
    if (!dataType) throw new Error(`GitHub Project \u5EFA\u4E0D\u4E86\u300C${String(request.dataType)}\u300D\u7C7B\u578B\u7684\u5B57\u6BB5`);
    const input = { projectId: request.projectId, dataType, name: clamp(name, maxLength.name) };
    const options = (request.options ?? []).map((option) => option.trim()).filter((option) => option.length > 0).map((option) => ({ name: clamp(option, maxLength.name), color: newOptionColor, description: "" }));
    if (request.dataType === "singleSelect" && options.length) input["singleSelectOptions"] = options;
    if (request.dataType === "multiSelect" && options.length) input["multiSelectOptions"] = options;
    if (request.dataType === "iteration") {
      const days = request.iterationDurationDays ?? defaultIterationDays;
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("\u8FED\u4EE3\u5468\u671F\u8981\u5728 1\u2013365 \u5929\u4E4B\u95F4");
      input["iterationConfiguration"] = iterationConfiguration(days, today);
    }
    return input;
  }
  function fieldFrom(raw, what) {
    const field = mapField(raw);
    if (!field) throw new GitHubError(`${what}\u4E4B\u540E\uFF0CGitHub \u4EA4\u56DE\u7684\u5B57\u6BB5\u8BFB\u4E0D\u51FA\u6765`, []);
    return field;
  }
  async function createField(request, signal) {
    if (!request.projectId) throw new Error("\u7F3A\u5C11 projectId");
    const input = createFieldInput(request);
    throwIfCancelled(signal);
    const mutation = mutations.createProjectV2Field;
    const data = await mutate(mutation.document, { input }, mutation.title);
    return { field: fieldFrom(data.createProjectV2Field?.projectV2Field, "\u5EFA\u5B57\u6BB5") };
  }
  function existingOptions(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      const option = entry;
      const id = option?.["id"];
      const name = option?.["name"];
      if (typeof id !== "string" || typeof name !== "string") return [];
      const color = typeof option?.["color"] === "string" ? option["color"] : newOptionColor;
      const description = typeof option?.["description"] === "string" ? option["description"] : "";
      return [{ id, name, color, description }];
    });
  }
  async function createOption(request, signal) {
    if (!request.fieldId) throw new Error("\u7F3A\u5C11 fieldId");
    const name = request.name?.trim();
    if (!name) throw new Error("\u9009\u9879\u540D\u4E0D\u80FD\u662F\u7A7A\u7684");
    throwIfCancelled(signal);
    const { data } = await query(readField, { id: request.fieldId }, "\u8BFB\u5B57\u6BB5");
    const node = data.node;
    if (!node) throw new GitHubError("\u627E\u4E0D\u5230\u8FD9\u4E2A\u5B57\u6BB5\uFF08\u6216 token \u770B\u4E0D\u5230\u5B83\uFF09", []);
    const dataType = node["dataType"];
    if (dataType !== "SINGLE_SELECT" && dataType !== "MULTI_SELECT") {
      throw new GitHubError(`\u300C${String(node["name"] ?? request.fieldId)}\u300D\u4E0D\u662F\u5355\u9009\u6216\u591A\u9009\u5B57\u6BB5\uFF0C\u52A0\u4E0D\u4E86\u9009\u9879`, []);
    }
    const key = dataType === "SINGLE_SELECT" ? "options" : "multiSelectOptions";
    const existing = existingOptions(node[key]);
    if (existing.some((option) => option.name.trim().toLowerCase() === name.toLowerCase())) {
      return { field: fieldFrom(node, "\u8BFB\u5B57\u6BB5") };
    }
    const options = [...existing, { name: clamp(name, maxLength.name), color: newOptionColor, description: "" }];
    const input = { fieldId: request.fieldId, [dataType === "SINGLE_SELECT" ? "singleSelectOptions" : "multiSelectOptions"]: options };
    throwIfCancelled(signal);
    const mutation = mutations.updateProjectV2Field;
    const result = await mutate(mutation.document, { input }, mutation.title);
    const field = fieldFrom(result.updateProjectV2Field?.projectV2Field, "\u52A0\u9009\u9879");
    const kept = new Set((field.options ?? []).map((option) => option.id));
    const lost = existing.filter((option) => !kept.has(option.id));
    if (lost.length) jarvis.log.warn("\u52A0\u9009\u9879\u4E4B\u540E\uFF0C\u5DF2\u6709\u9009\u9879\u7684 id \u53D8\u4E86", lost.map((option) => option.name));
    return { field };
  }
  function existingIterations(configuration) {
    const raw = configuration ?? {};
    const lists = [raw?.["completedIterations"], raw?.["iterations"]];
    return lists.flatMap((list2) => Array.isArray(list2) ? list2 : []).flatMap((entry) => {
      const iteration = entry;
      const id = iteration?.["id"];
      const title = iteration?.["title"];
      const startDate = day(iteration?.["startDate"]);
      const duration = iteration?.["duration"];
      if (typeof id !== "string" || typeof title !== "string" || !startDate || typeof duration !== "number") return [];
      return [{ id, title, startDate, duration }];
    }).sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  function createIterationInput(fieldId, configuration, request) {
    const title = request.name?.trim();
    if (!title) throw new Error("\u8FED\u4EE3\u540D\u4E0D\u80FD\u662F\u7A7A\u7684");
    const startDate = day(request.startDate);
    if (!startDate) throw new Error("\u5F00\u59CB\u65E5\u8981\u5199\u6210 YYYY-MM-DD");
    const days = request.iterationDurationDays;
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("\u8FED\u4EE3\u5468\u671F\u8981\u5728 1\u2013365 \u5929\u4E4B\u95F4");
    const existing = existingIterations(configuration);
    if (existing.some((iteration) => iteration.title.trim().toLowerCase() === title.toLowerCase())) {
      throw new GitHubError(`\u5DF2\u7ECF\u6709\u53EB\u300C${title}\u300D\u7684\u8FED\u4EE3`, []);
    }
    const iterations = [...existing, { title: clamp(title, maxLength.name), startDate, duration: days }].sort(
      (a, b) => a.startDate.localeCompare(b.startDate)
    );
    const configured = (configuration ?? {})?.["duration"];
    const duration = typeof configured === "number" && configured >= 1 && configured <= 365 ? configured : days;
    return { fieldId, iterationConfiguration: { startDate: iterations[0].startDate, duration, iterations } };
  }
  async function createIteration(request, signal) {
    if (!request.fieldId) throw new Error("\u7F3A\u5C11 fieldId");
    throwIfCancelled(signal);
    const { data } = await query(readField, { id: request.fieldId }, "\u8BFB\u5B57\u6BB5");
    const node = data.node;
    if (!node) throw new GitHubError("\u627E\u4E0D\u5230\u8FD9\u4E2A\u5B57\u6BB5\uFF08\u6216 token \u770B\u4E0D\u5230\u5B83\uFF09", []);
    if (node["dataType"] !== "ITERATION") {
      throw new GitHubError(`\u300C${String(node["name"] ?? request.fieldId)}\u300D\u4E0D\u662F\u8FED\u4EE3\u5B57\u6BB5\uFF0C\u52A0\u4E0D\u4E86\u8FED\u4EE3`, []);
    }
    const existing = existingIterations(node["configuration"]);
    const input = createIterationInput(request.fieldId, node["configuration"], request);
    throwIfCancelled(signal);
    const mutation = mutations.updateProjectV2Field;
    const result = await mutate(mutation.document, { input }, "\u52A0\u8FED\u4EE3");
    const field = fieldFrom(result.updateProjectV2Field?.projectV2Field, "\u52A0\u8FED\u4EE3");
    const kept = new Set((field.iterations ?? []).map((iteration) => iteration.id));
    const lost = existing.filter((iteration) => iteration.id && !kept.has(iteration.id));
    if (lost.length) jarvis.log.warn("\u52A0\u8FED\u4EE3\u4E4B\u540E\uFF0C\u5DF2\u6709\u8FED\u4EE3\u7684 id \u53D8\u4E86", lost.map((iteration) => iteration.title));
    return { field };
  }

  // extensions/github-project/src/items.ts
  var fullScanPrefix = "all:";
  function sinceFilter(since) {
    if (!since || Number.isNaN(Date.parse(since))) return void 0;
    const date = day(new Date(Date.parse(since)).toISOString());
    return date ? `updated:>=${addDays(date, -1)}` : void 0;
  }
  function planPage(request) {
    const cursor = request.cursor || void 0;
    if (cursor?.startsWith(fullScanPrefix)) {
      return { after: cursor.slice(fullScanPrefix.length) || void 0, filter: void 0, fullScan: true };
    }
    return { after: cursor, filter: sinceFilter(request.since), fullScan: false };
  }
  function fetchPage(projectId, plan) {
    const variables = { id: projectId, cursor: plan.after ?? null };
    if (plan.filter) variables["q"] = plan.filter;
    return rawQuery(plan.filter ? readItemsSince : readItems, variables);
  }
  function requestedIds(ids) {
    const seen = /* @__PURE__ */ new Set();
    for (const id of ids) {
      if (typeof id === "string" && id.length > 0 && id.length <= maxLength.id) seen.add(id);
    }
    if (seen.size > itemsPerPage) throw new Error(`\u4E00\u6B21\u81F3\u591A\u6309 id \u8BFB ${itemsPerPage} \u6761`);
    return [...seen];
  }
  async function readItemsById(projectId, ids, signal) {
    const wanted = requestedIds(ids);
    if (wanted.length === 0) return { items: [] };
    throwIfCancelled(signal);
    const response = await rawQuery(readItemsByIds, { ids: wanted });
    const errors = response.errors ?? [];
    const unexpected = errors.filter((error) => error.type !== "NOT_FOUND");
    if (response.data === null || response.data === void 0 || unexpected.length > 0) {
      throw new GitHubError(`\u8BFB\u6761\u76EE\u5931\u8D25\uFF1A${describeErrors(unexpected.length > 0 ? unexpected : errors)}`, errors);
    }
    const wantedSet = new Set(wanted);
    const items = (response.data.nodes ?? []).filter((node) => node !== null && node !== void 0 && node["__typename"] === "ProjectV2Item").filter((node) => node["project"]?.id === projectId).map(mapItem).filter((item) => item !== null && wantedSet.has(item.id));
    return { items };
  }
  async function readItems2(request, signal) {
    if (!request.projectId) throw new Error("\u7F3A\u5C11 projectId");
    throwIfCancelled(signal);
    if (Array.isArray(request.itemIds)) return readItemsById(request.projectId, request.itemIds, signal);
    let plan = planPage(request);
    let response = await fetchPage(request.projectId, plan);
    const rejectedFilter = plan.filter !== void 0 && !response.data?.node?.items && (response.errors ?? []).length > 0 && !(response.errors ?? []).some((error) => error.type !== void 0 && terminalErrorTypes.has(error.type));
    if (rejectedFilter) {
      jarvis.log.warn("GitHub \u4E0D\u8BA4\u589E\u91CF\u8FC7\u6EE4\u4E32\uFF0C\u8FD9\u4E00\u6B21\u56DE\u843D\u5230\u5168\u91CF", (response.errors ?? []).slice(0, 2).map((error) => error.message));
      throwIfCancelled(signal);
      plan = { after: void 0, filter: void 0, fullScan: true };
      response = await fetchPage(request.projectId, plan);
    }
    const { data } = outcome(response, "\u8BFB\u6761\u76EE");
    const node = data.node;
    if (!node) throw new GitHubError("\u627E\u4E0D\u5230\u8FD9\u4E2A Project\uFF08\u6216 token \u770B\u4E0D\u5230\u5B83\uFF09", []);
    const connection = node.items;
    if (!connection) throw new GitHubError(`\u300C${request.projectId}\u300D\u4E0D\u662F\u4E00\u4E2A Project`, []);
    const items = (connection.nodes ?? []).map(mapItem).filter((item) => item !== null).slice(0, 100);
    const page = { items };
    const end = connection.pageInfo?.endCursor;
    if (connection.pageInfo?.hasNextPage && end) {
      const next = plan.fullScan ? `${fullScanPrefix}${end}` : end;
      if (next.length > maxLength.cursor) throw new GitHubError("GitHub \u7684\u7FFB\u9875\u6E38\u6807\u8D85\u8FC7\u4E86 500 \u5B57\uFF0C\u8BFB\u4E0D\u4E86\u4E0B\u4E00\u9875", []);
      page.nextCursor = next;
    }
    if (typeof connection.totalCount === "number") page.totalCount = Math.max(0, Math.floor(connection.totalCount));
    return page;
  }

  // extensions/github-project/src/engine.ts
  var githubProjectEngine = {
    describe: (context) => describe(context),
    listProjects: (request, _context, signal) => listProjects(request, signal),
    readSchema: (request, _context, signal) => readSchema2(request, signal),
    readItems: (request, _context, signal) => readItems2(request, signal),
    applyEdit: (request, _context, signal) => applyEdit(request, signal),
    createField: (request, _context, signal) => createField(request, signal),
    createOption: (request, _context, signal) => createOption(request, signal),
    createIteration: (request, _context, signal) => createIteration(request, signal),
    createItem: (request, _context, signal) => createItem(request, signal),
    addItem: (request, _context, signal) => addItem(request, signal)
  };

  // extensions/github-project/src/index.ts
  defineExtension({
    services: {
      github: githubProjectEngine
    }
  });
})();
