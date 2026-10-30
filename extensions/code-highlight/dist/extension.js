// jarvis-extension bundle · code-highlight@1.0.4 · sdk 2.13.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
      globalThis.__jarvisRuntime = { dispatch: (json2) => this.dispatch(json2) };
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
            const engine2 = implementation;
            switch (call2.method) {
              case "status":
                return Promise.resolve(engine2.status(context));
              case "run":
                return engine2.run(
                  context,
                  (progress) => {
                    if (signal.cancelled) return;
                    this.invoke("service", "progress", { callId: call2.callId, progress }).catch(() => void 0);
                  },
                  signal
                );
              case "action":
                return Promise.resolve(engine2.action ? engine2.action(call2.params.actionId ?? "", context) : {});
            }
            break;
          }
          case "project.engine": {
            const engine2 = implementation;
            const request = call2.params.request ?? {};
            switch (call2.method) {
              case "describe":
                return Promise.resolve(engine2.describe(context));
              case "listProjects":
                return engine2.listProjects(request, context, signal);
              case "readSchema":
                return engine2.readSchema(request, context, signal);
              case "readItems":
                return engine2.readItems(request, context, signal);
              case "applyEdit":
                return engine2.applyEdit(request, context, signal);
              case "createField":
                if (!engine2.createField) break;
                return engine2.createField(request, context, signal);
              case "createOption":
                if (!engine2.createOption) break;
                return engine2.createOption(request, context, signal);
              case "createIteration":
                if (!engine2.createIteration) break;
                return engine2.createIteration(request, context, signal);
              case "createItem":
                if (!engine2.createItem) break;
                return engine2.createItem(request, context, signal);
              case "addItem":
                if (!engine2.addItem) break;
                return engine2.addItem(request, context, signal);
            }
            break;
          }
          case "launcher.apps": {
            const engine2 = implementation;
            if (call2.method === "catalog") return Promise.resolve(engine2.catalog(context));
            break;
          }
          case "code.format": {
            const engine2 = implementation;
            if (call2.method === "describe") return Promise.resolve(engine2.describe(context));
            if (call2.method === "format") return engine2.format(call2.params.request, context, signal);
            break;
          }
          case "code.highlight": {
            const engine2 = implementation;
            if (call2.method === "describe") return Promise.resolve(engine2.describe(context));
            if (call2.method === "highlight") return Promise.resolve(engine2.highlight(call2.params.request, context, signal));
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
    dispatch(json2) {
      const event = JSON.parse(json2);
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

  // extensions/code-highlight/src/encode.ts
  var maximumTokens = 3e5;
  function encode(documents) {
    const kinds = [];
    const index = /* @__PURE__ */ new Map();
    let budget = maximumTokens;
    const flat = documents.map((tokens) => {
      const numbers = [];
      for (const token of tokens) {
        if (budget <= 0) break;
        if (token.length <= 0) continue;
        let kindIndex = index.get(token.kind);
        if (kindIndex === void 0) {
          kindIndex = kinds.length;
          kinds.push(token.kind);
          index.set(token.kind, kindIndex);
        }
        numbers.push(token.start, token.length, kindIndex);
        budget -= 1;
      }
      return numbers;
    });
    return { kinds, documents: flat };
  }

  // extensions/code-highlight/src/scanner.ts
  function atLineStart(text, index) {
    for (let i = index - 1; i >= 0; i -= 1) {
      const c2 = text.charCodeAt(i);
      if (c2 === 10) return true;
      if (c2 !== 32 && c2 !== 9) return false;
    }
    return true;
  }
  function nextNonSpace(text, index) {
    for (let i = index; i < text.length; i += 1) {
      const c2 = text.charCodeAt(i);
      if (c2 === 10) return "";
      if (c2 !== 32 && c2 !== 9) return text[i];
    }
    return "";
  }
  function previousNonSpace(text, index) {
    for (let i = index - 1; i >= 0; i -= 1) {
      const c2 = text.charCodeAt(i);
      if (c2 !== 32 && c2 !== 9 && c2 !== 10 && c2 !== 13) return text[i];
    }
    return "";
  }
  function scan(text, spec) {
    const out = [];
    const n = text.length;
    let i = 0;
    let previousWord = null;
    outer: while (i < n) {
      const c2 = text.charCodeAt(i);
      if (c2 === 32 || c2 === 9 || c2 === 10 || c2 === 13) {
        i += 1;
        continue;
      }
      for (const rule of spec.rules) {
        if (rule.lineStart && !atLineStart(text, i)) continue;
        let length = 0;
        if (rule.pattern) {
          rule.pattern.lastIndex = i;
          const match = rule.pattern.exec(text);
          if (!match || match[0].length === 0) continue;
          length = match[0].length;
          if (rule.emit) rule.emit(match, i, out);
          else if (rule.kind) out.push({ start: i, length, kind: rule.kind });
        } else if (rule.match) {
          length = rule.match(text, i);
          if (length <= 0) continue;
          if (rule.kind) out.push({ start: i, length, kind: rule.kind });
        } else {
          continue;
        }
        i += length;
        previousWord = null;
        continue outer;
      }
      if (spec.word) {
        spec.word.lastIndex = i;
        const match = spec.word.exec(text);
        if (match && match[0].length > 0) {
          const word = match[0];
          const end = i + word.length;
          const kind = spec.classify?.(word, { previousWord, next: nextNonSpace(text, end), previous: previousNonSpace(text, i) }) ?? null;
          if (kind) out.push({ start: i, length: word.length, kind });
          previousWord = word;
          i = end;
          continue;
        }
      }
      previousWord = c2 === 46 ? "." : null;
      i += 1;
    }
    return out;
  }
  function sticky(source, flags = "") {
    return new RegExp(source, flags.includes("y") ? flags : flags + "y");
  }
  function nestedBlockComment(open = "/*", close = "*/") {
    return {
      kind: "comment",
      match(text, at) {
        if (!text.startsWith(open, at)) return 0;
        let depth = 0;
        let i = at;
        while (i < text.length) {
          if (text.startsWith(open, i)) {
            depth += 1;
            i += open.length;
          } else if (text.startsWith(close, i)) {
            depth -= 1;
            i += close.length;
            if (depth === 0) break;
          } else {
            i += 1;
          }
        }
        return i - at;
      }
    };
  }

  // extensions/code-highlight/src/markup.ts
  function push(out, start, length, kind) {
    if (length > 0) out.push({ start, length, kind });
  }
  function lineEnd(text, from) {
    const end = text.indexOf("\n", from);
    return end < 0 ? text.length : end;
  }
  function scanMarkdown(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      const end = lineEnd(text, i);
      const line = text.slice(i, end);
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        const marker = fence[1];
        let cursor = end + 1;
        let close = text.length;
        while (cursor < text.length) {
          const next = lineEnd(text, cursor);
          if (new RegExp("^ {0,3}" + marker[0] + "{" + marker.length + ",}\\s*$").test(text.slice(cursor, next))) {
            close = next;
            break;
          }
          cursor = next + 1;
        }
        push(out, i, close - i, "code");
        i = close + 1;
        continue;
      }
      if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
        push(out, i, line.length, "heading");
      } else if (/^ {0,3}>/.test(line)) {
        push(out, i, line.length, "quote");
      } else if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        push(out, i, line.length, "marker");
      } else {
        const list = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s/.exec(line);
        let from = 0;
        if (list) {
          push(out, i + list[1].length, list[2].length + (list[3]?.length ?? 0), "marker");
          from = list[0].length;
        }
        inlineMarkdown(text, i + from, end, out);
      }
      i = end + 1;
    }
    return out;
  }
  function inlineMarkdown(text, from, to, out) {
    const pattern = /`[^`\n]+`|!?\[[^\]\n]*\]\([^)\n]*\)|<https?:\/\/[^>\s]+>|<!--[\s\S]*?-->|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*|(?<![\w])_[^_\s][^_\n]*_(?![\w])/g;
    pattern.lastIndex = from;
    const segment = text.slice(0, to);
    let match;
    while ((match = pattern.exec(segment)) !== null) {
      const token = match[0];
      const kind = token.startsWith("`") ? "code" : token.startsWith("<!--") ? "comment" : token.startsWith("[") || token.startsWith("![") || token.startsWith("<") ? "link" : "emphasis";
      push(out, match.index, token.length, kind);
    }
  }
  function scanHTML(text) {
    const out = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
      const lt = text.indexOf("<", i);
      const amp = text.indexOf("&", i);
      const next = lt < 0 ? amp : amp < 0 ? lt : Math.min(lt, amp);
      if (next < 0) break;
      i = next;
      if (text[i] === "&") {
        const entity = /&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][\w]*);/y;
        entity.lastIndex = i;
        const match = entity.exec(text);
        if (match) push(out, i, match[0].length, "constant");
        i += match ? match[0].length : 1;
        continue;
      }
      if (text.startsWith("<!--", i)) {
        const close = text.indexOf("-->", i + 4);
        const end = close < 0 ? n : close + 3;
        push(out, i, end - i, "comment");
        i = end;
        continue;
      }
      if (text.startsWith("<![CDATA[", i)) {
        const close = text.indexOf("]]>", i);
        const end = close < 0 ? n : close + 3;
        push(out, i, end - i, "string");
        i = end;
        continue;
      }
      if (text.startsWith("<?", i) || text.startsWith("<!", i)) {
        const close = text.indexOf(">", i);
        const end = close < 0 ? n : close + 1;
        push(out, i, end - i, "preprocessor");
        i = end;
        continue;
      }
      const tag = /<\/?[A-Za-z][\w:.-]*/y;
      tag.lastIndex = i;
      const name = tag.exec(text);
      if (!name) {
        i += 1;
        continue;
      }
      push(out, i, name[0].length, "tag");
      i += name[0].length;
      const attribute = /\s*(?:([^\s=>/"']+)(?:\s*=\s*("[^"]*"?|'[^']*'?|[^\s>]+))?|(\/?>))/y;
      while (i < n) {
        attribute.lastIndex = i;
        const match = attribute.exec(text);
        if (!match || match[0].length === 0) break;
        const base = i + match[0].length - match[0].trimStart().length;
        if (match[3]) {
          push(out, i + match[0].length - match[3].length, match[3].length, "tag");
          i += match[0].length;
          break;
        }
        if (match[1]) push(out, base, match[1].length, "attribute");
        if (match[2]) push(out, i + match[0].length - match[2].length, match[2].length, "string");
        i += match[0].length;
      }
    }
    return out;
  }
  function scanCSS(text) {
    const out = [];
    const n = text.length;
    let depth = 0;
    let i = 0;
    let declarationStart = true;
    while (i < n) {
      const c2 = text[i];
      if (c2 === " " || c2 === "	" || c2 === "\n" || c2 === "\r") {
        i += 1;
        continue;
      }
      if (text.startsWith("/*", i)) {
        const close = text.indexOf("*/", i + 2);
        const end = close < 0 ? n : close + 2;
        push(out, i, end - i, "comment");
        i = end;
        continue;
      }
      if (text.startsWith("//", i) && !/url\($/.test(text.slice(Math.max(0, i - 4), i))) {
        const end = lineEnd(text, i);
        push(out, i, end - i, "comment");
        i = end;
        continue;
      }
      if (c2 === '"' || c2 === "'") {
        const string = c2 === '"' ? /"(?:[^"\\\n]|\\.)*"?/y : /'(?:[^'\\\n]|\\.)*'?/y;
        string.lastIndex = i;
        const match2 = string.exec(text);
        push(out, i, match2[0].length, "string");
        i += match2[0].length;
        continue;
      }
      if (c2 === "{") {
        depth += 1;
        declarationStart = true;
        i += 1;
        continue;
      }
      if (c2 === "}") {
        depth = Math.max(0, depth - 1);
        declarationStart = true;
        i += 1;
        continue;
      }
      if (c2 === ";") {
        declarationStart = true;
        i += 1;
        continue;
      }
      if (c2 === "@" && /[\w-]/.test(text[i + 1] ?? "")) {
        const at = /@[\w-]+/y;
        at.lastIndex = i;
        const match2 = at.exec(text);
        const isVariable = /^\s*:/.test(text.slice(i + match2[0].length, i + match2[0].length + 8)) && depth > 0;
        push(out, i, match2[0].length, isVariable ? "variable" : "keyword");
        i += match2[0].length;
        declarationStart = false;
        continue;
      }
      const rest = /[^{};]*/y;
      rest.lastIndex = i;
      const segment = rest.exec(text)[0];
      const selector = text[i + segment.length] === "{";
      if (selector) {
        scanSelector(text, i, i + segment.length, out);
        i += segment.length;
        declarationStart = false;
        continue;
      }
      if (declarationStart) {
        const property = /(--[\w-]+|\$[\w-]+|[\w-]+)(\s*:)/y;
        property.lastIndex = i;
        const match2 = property.exec(text);
        if (match2) {
          push(out, i, match2[1].length, match2[1].startsWith("--") || match2[1].startsWith("$") ? "variable" : "property");
          i += match2[0].length;
          declarationStart = false;
          continue;
        }
      }
      declarationStart = false;
      const value = /(#[0-9a-fA-F]{3,8}\b)|(-?(?:\d+\.?\d*|\.\d+)(?:[a-zA-Z%]+)?)|(!important)|(var\(--[\w-]+\)|--[\w-]+|\$[\w-]+)|([\w-]+(?=\())|([\w-]+)/y;
      value.lastIndex = i;
      const match = value.exec(text);
      if (!match) {
        i += 1;
        continue;
      }
      const kind = match[1] ? "constant" : match[2] ? "number" : match[3] ? "keyword" : match[4] ? "variable" : match[5] ? "function" : null;
      if (kind) push(out, i, match[0].length, kind);
      i += match[0].length;
    }
    return out;
  }
  function scanSelector(text, from, to, out) {
    const pattern = /(\.[\w-]+)|(#[\w-]+)|(::?[\w-]+)|(\[[^\]]*\])|(&)|([A-Za-z][\w-]*)/g;
    pattern.lastIndex = from;
    const segment = text.slice(0, to);
    let match;
    while ((match = pattern.exec(segment)) !== null) {
      const kind = match[1] ? "type" : match[2] ? "attribute" : match[3] ? "keyword" : match[4] ? "attribute" : match[5] ? "keyword" : "tag";
      push(out, match.index, match[0].length, kind);
    }
  }
  function scanYAML(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      const end = lineEnd(text, i);
      const line = text.slice(i, end);
      if (/^(?:---|\.\.\.)(?:\s|$)/.test(line)) {
        push(out, i, 3, "marker");
        scanYAMLValue(text, i + 3, end, out);
        i = end + 1;
        continue;
      }
      const prefix = /^(\s*)((?:-\s+)*)/.exec(line);
      let cursor = i + prefix[0].length;
      if (prefix[2].length > 0) {
        for (const dash of prefix[2].matchAll(/-/g)) push(out, i + prefix[1].length + dash.index, 1, "marker");
      }
      const key = /("[^"\n]*"|'[^'\n]*'|[^\s#:'"{[][^:#\n]*?)\s*:(?=\s|$)/y;
      key.lastIndex = cursor;
      const keyMatch = key.exec(text);
      if (keyMatch && keyMatch.index === cursor && cursor < end) {
        push(out, cursor, keyMatch[1].length, "property");
        cursor += keyMatch[0].length;
      }
      scanYAMLValue(text, cursor, end, out);
      i = end + 1;
    }
    return out;
  }
  function scanYAMLValue(text, from, to, out) {
    let commentAt = -1;
    for (let i = from; i < to; i += 1) {
      const c2 = text[i];
      if (c2 === "#" && (i === from || text[i - 1] === " " || text[i - 1] === "	")) {
        commentAt = i;
        break;
      }
      if (c2 === '"' || c2 === "'") {
        const close = text.indexOf(c2, i + 1);
        if (close < 0 || close >= to) break;
        i = close;
      }
    }
    const valueEnd = commentAt < 0 ? to : commentAt;
    const value = text.slice(from, valueEnd);
    const trimmed = value.trim();
    const at = from + value.indexOf(trimmed);
    if (trimmed.length > 0) {
      if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(trimmed)) {
        push(out, at, trimmed.length, "constant");
      } else if (/^[-+]?(?:\d[\d_]*(?:\.\d+)?(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|\.inf|\.nan)$/i.test(trimmed)) {
        push(out, at, trimmed.length, "number");
      } else if (/^[|>][-+]?\d*$/.test(trimmed)) {
        push(out, at, trimmed.length, "marker");
      } else {
        const pattern = /"(?:[^"\\]|\\.)*"?|'(?:[^']|'')*'?|[&*][\w-]+|![\w!./-]*/g;
        let match;
        while ((match = pattern.exec(value)) !== null) {
          const token = match[0];
          const kind = token.startsWith('"') || token.startsWith("'") ? "string" : token.startsWith("!") ? "attribute" : "variable";
          push(out, from + match.index, token.length, kind);
        }
      }
    }
    if (commentAt >= 0) push(out, commentAt, to - commentAt, "comment");
  }

  // extensions/code-highlight/src/languages.ts
  var words = (list) => new Set(list.split(/\s+/).filter(Boolean));
  var lineComment = (prefix) => ({ pattern: sticky(prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "[^\\n]*"), kind: "comment" });
  var blockComment = { pattern: /\/\*[\s\S]*?(?:\*\/|$)/y, kind: "comment" };
  var doubleQuoted = { pattern: /"(?:[^"\\\n]|\\.)*"?/y, kind: "string" };
  var singleQuoted = { pattern: /'(?:[^'\\\n]|\\.)*'?/y, kind: "string" };
  var backtickTemplate = { pattern: /`(?:[^`\\]|\\[\s\S])*`?/y, kind: "string" };
  var number = {
    pattern: /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/y,
    kind: "number"
  };
  var annotation = { pattern: /@[A-Za-z_][\w.]*/y, kind: "attribute" };
  var identifier = /[A-Za-z_][\w]*/y;
  var identifierWithDollar = /[A-Za-z_$][\w$]*/y;
  var preprocessor = {
    pattern: /#\s*(?:include|import)\s*(?:<[^>\n]*>|"[^"\n]*")?|#\s*[A-Za-z]+/y,
    lineStart: true,
    emit(match, at, out) {
      const text = match[0];
      const path = /[<"]/.exec(text);
      if (path) {
        out.push({ start: at, length: path.index, kind: "preprocessor" });
        out.push({ start: at + path.index, length: text.length - path.index, kind: "string" });
      } else {
        out.push({ start: at, length: text.length, kind: "preprocessor" });
      }
    }
  };
  function classifier(table) {
    return (word, context) => {
      const fold = (text) => table.caseInsensitive ? text.toLowerCase() : text;
      const key = fold(word);
      const previousWord = context.previousWord ? fold(context.previousWord) : null;
      if (context.previous !== "." && table.keywords.has(key)) return "keyword";
      if (table.constants.has(key)) return "constant";
      if (previousWord && table.functionDeclarations?.has(previousWord)) return "function";
      if (previousWord && table.typeDeclarations?.has(previousWord)) return "type";
      if (table.types.has(key)) return "type";
      if (!table.caseInsensitive && /^[A-Z][A-Z0-9_]+$/.test(word)) return "constant";
      if (table.capitalizedTypes && /^[A-Z]/.test(word) && /[a-z]/.test(word)) return "type";
      if (context.next === "(") return "function";
      return null;
    };
  }
  var cKeywords = "auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local alignas alignof";
  var cTypes = "void char short int long float double signed unsigned bool _Bool _Complex size_t ssize_t ptrdiff_t intptr_t uintptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE";
  var cppKeywords = cKeywords + " class namespace template typename public private protected virtual override final new delete this throw try catch using operator friend explicit mutable constexpr consteval constinit decltype noexcept static_cast dynamic_cast reinterpret_cast const_cast co_await co_return co_yield concept requires export import module";
  var c = {
    rules: [lineComment("//"), blockComment, preprocessor, doubleQuoted, singleQuoted, number],
    word: identifier,
    classify: classifier({ keywords: words(cKeywords), types: words(cTypes), constants: words("NULL true false"), typeDeclarations: words("struct enum union") })
  };
  var cpp = {
    rules: [lineComment("//"), blockComment, preprocessor, { pattern: /R"([^(\s]*)\([\s\S]*?\)\1"/y, kind: "string" }, doubleQuoted, singleQuoted, number],
    word: identifier,
    classify: classifier({
      keywords: words(cppKeywords),
      types: words(cTypes + " string wstring vector map unordered_map set array optional shared_ptr unique_ptr std"),
      constants: words("nullptr NULL true false"),
      typeDeclarations: words("class struct enum union namespace"),
      capitalizedTypes: true
    })
  };
  var objc = {
    rules: [
      lineComment("//"),
      blockComment,
      preprocessor,
      { pattern: /@"(?:[^"\\\n]|\\.)*"?/y, kind: "string" },
      { pattern: /@[A-Za-z]+/y, kind: "keyword" },
      doubleQuoted,
      singleQuoted,
      number
    ],
    word: identifier,
    classify: classifier({
      keywords: words(cKeywords + " self super in out inout oneway bycopy byref nonatomic atomic strong weak copy assign retain readonly readwrite nullable nonnull"),
      types: words(cTypes + " id instancetype BOOL NSInteger NSUInteger CGFloat SEL IMP Class"),
      constants: words("YES NO nil Nil NULL true false"),
      typeDeclarations: words("struct enum"),
      capitalizedTypes: true
    })
  };
  var java = {
    rules: [lineComment("//"), blockComment, { pattern: /"""[\s\S]*?(?:"""|$)/y, kind: "string" }, doubleQuoted, singleQuoted, annotation, number],
    word: identifier,
    classify: classifier({
      keywords: words("abstract assert break case catch class continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try volatile while var record sealed permits yield"),
      types: words("boolean byte char double float int long short void"),
      constants: words("true false null"),
      typeDeclarations: words("class interface enum record"),
      capitalizedTypes: true
    })
  };
  var kotlin = {
    rules: [lineComment("//"), nestedBlockComment(), { pattern: /"""[\s\S]*?(?:"""|$)/y, kind: "string" }, doubleQuoted, singleQuoted, annotation, number],
    word: identifier,
    classify: classifier({
      keywords: words("as break class continue do else for fun if in interface is object package return super this throw try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg value it"),
      types: words("Int Long Short Byte Double Float Boolean Char String Unit Any Nothing Array List Map Set"),
      constants: words("true false null"),
      functionDeclarations: words("fun"),
      typeDeclarations: words("class interface object typealias"),
      capitalizedTypes: true
    })
  };
  var swift = {
    rules: [
      lineComment("//"),
      nestedBlockComment(),
      { pattern: /(#*)"""[\s\S]*?(?:"""\1|$)/y, kind: "string" },
      { pattern: /(#*)"(?:[^"\\\n]|\\.)*(?:"\1)?/y, kind: "string" },
      { pattern: /#[A-Za-z_]\w*/y, kind: "preprocessor" },
      annotation,
      number
    ],
    word: identifier,
    classify: classifier({
      keywords: words("associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default defer do else fallthrough for guard if in repeat return throw switch where while as await is throws try async actor some any convenience dynamic didSet final get indirect lazy mutating nonmutating optional override required set unowned weak willSet macro consume borrowing consuming self Self super"),
      types: words("Int Int8 Int16 Int32 Int64 UInt UInt8 UInt16 UInt32 UInt64 Double Float Bool String Character Void Any AnyObject Optional Array Dictionary Set"),
      constants: words("true false nil"),
      functionDeclarations: words("func"),
      typeDeclarations: words("class struct enum protocol extension actor typealias associatedtype"),
      capitalizedTypes: true
    })
  };
  var csharp = {
    rules: [
      lineComment("//"),
      blockComment,
      { pattern: /#\s*[A-Za-z]+/y, lineStart: true, kind: "preprocessor" },
      { pattern: /"""[\s\S]*?(?:"""|$)/y, kind: "string" },
      { pattern: /\$?@"(?:[^"]|"")*"?|@\$"(?:[^"]|"")*"?/y, kind: "string" },
      { pattern: /\$?"(?:[^"\\\n]|\\.)*"?/y, kind: "string" },
      singleQuoted,
      number
    ],
    word: identifier,
    classify: classifier({
      keywords: words("abstract as base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using virtual volatile while add alias ascending async await by descending dynamic equals from get global group init into join let nameof notnull on orderby partial record remove required select set unmanaged value var when where with yield"),
      types: words("bool byte char decimal double float int long object sbyte short string uint ulong ushort void nint nuint"),
      constants: words("true false null"),
      typeDeclarations: words("class struct interface enum record namespace"),
      capitalizedTypes: true
    })
  };
  var jsKeywords = "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set from as";
  var javascript = {
    rules: [lineComment("//"), blockComment, backtickTemplate, doubleQuoted, singleQuoted, annotation, number],
    word: identifierWithDollar,
    classify: classifier({
      keywords: words(jsKeywords),
      types: words(""),
      constants: words("true false null undefined NaN Infinity"),
      functionDeclarations: words("function"),
      typeDeclarations: words("class"),
      capitalizedTypes: true
    })
  };
  var typescript = {
    rules: javascript.rules,
    word: identifierWithDollar,
    classify: classifier({
      keywords: words(jsKeywords + " interface type enum implements namespace declare abstract readonly private protected public keyof infer is asserts satisfies override module unique"),
      types: words("string number boolean any unknown never void object symbol bigint"),
      constants: words("true false null undefined NaN Infinity"),
      functionDeclarations: words("function"),
      typeDeclarations: words("class interface type enum namespace"),
      capitalizedTypes: true
    })
  };
  var go = {
    rules: [lineComment("//"), blockComment, { pattern: /`[^`]*`?/y, kind: "string" }, doubleQuoted, singleQuoted, number],
    word: identifier,
    classify: classifier({
      keywords: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
      types: words("bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any comparable"),
      constants: words("true false nil iota"),
      functionDeclarations: words("func"),
      typeDeclarations: words("type")
    })
  };
  var rust = {
    rules: [
      lineComment("//"),
      nestedBlockComment(),
      { pattern: /#!?\[[^\]\n]*\]?/y, kind: "attribute" },
      { pattern: /b?r(#*)"[\s\S]*?(?:"\1|$)/y, kind: "string" },
      { pattern: /b?"(?:[^"\\]|\\[\s\S])*"?/y, kind: "string" },
      { pattern: /b?'(?:\\.|[^'\\\n])'/y, kind: "string" },
      { pattern: /'[A-Za-z_]\w*/y, kind: "attribute" },
      { pattern: /[A-Za-z_]\w*!(?=\s*[([{])/y, kind: "function" },
      number
    ],
    word: identifier,
    classify: classifier({
      keywords: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while union"),
      types: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box"),
      constants: words("true false None"),
      functionDeclarations: words("fn"),
      typeDeclarations: words("struct enum trait type union"),
      capitalizedTypes: true
    })
  };
  var python = {
    rules: [
      lineComment("#"),
      { pattern: /[rRbBuUfF]{0,2}("""|''')[\s\S]*?(?:\1|$)/y, kind: "string" },
      { pattern: /[rRbBuUfF]{1,2}(?:"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/y, kind: "string" },
      doubleQuoted,
      singleQuoted,
      { pattern: /@[A-Za-z_][\w.]*/y, lineStart: true, kind: "attribute" },
      number
    ],
    word: identifier,
    classify: classifier({
      keywords: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls"),
      types: words("int str float bool list dict set tuple bytes bytearray object type complex frozenset Exception"),
      constants: words("True False None NotImplemented Ellipsis"),
      functionDeclarations: words("def"),
      typeDeclarations: words("class"),
      capitalizedTypes: true
    })
  };
  var shell = {
    rules: [
      { pattern: /\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|\$[0-9@#?$!*-]/y, kind: "variable" },
      { pattern: /#[^\n]*/y, kind: "comment" },
      { pattern: /"(?:[^"\\]|\\[\s\S])*"?/y, kind: "string" },
      { pattern: /'[^']*'?/y, kind: "string" },
      { pattern: /\d+(?![\w])/y, kind: "number" }
    ],
    word: /[A-Za-z_][\w-]*/y,
    classify: (word, context) => {
      if (shellKeywords.has(word)) return "keyword";
      if (context.previousWord === "function") return "function";
      if (context.next === "(" && context.previous !== "$") return "function";
      if (shellBuiltins.has(word) && context.previous !== "-") return "function";
      return null;
    }
  };
  var shellKeywords = words("if then else elif fi for while until do done case esac function in select return local export readonly declare typeset set unset shift exit source alias break continue time");
  var shellBuiltins = words("echo printf read cd pwd test eval exec trap wait kill true false");
  var sql = {
    rules: [
      lineComment("--"),
      blockComment,
      { pattern: /'(?:[^']|'')*'?/y, kind: "string" },
      { pattern: /"(?:[^"]|"")*"?|`[^`\n]*`?|\[[^\]\n]*\]/y, kind: "property" },
      number
    ],
    word: identifier,
    classify: classifier({
      keywords: words("select from where and or not insert into values update set delete create table view index drop alter add column primary key foreign references join inner left right full outer cross on as group by order having limit offset union all distinct case when then else end is in like between exists default constraint unique check returning with recursive begin commit rollback transaction if replace trigger pragma asc desc"),
      types: words("int integer bigint smallint tinyint real float double decimal numeric char varchar text blob date time datetime timestamp boolean bool serial uuid json jsonb"),
      constants: words("null true false current_timestamp current_date"),
      typeDeclarations: words("table view index into from join update"),
      caseInsensitive: true
    })
  };
  var json = {
    rules: [
      lineComment("//"),
      blockComment,
      {
        // 键（字符串后面跟着冒号）是属性，其余字符串是值。
        pattern: /"(?:[^"\\\n]|\\.)*"?/y,
        emit(match, at, out) {
          out.push({ start: at, length: match[0].length, kind: /^\s*:/.test(match.input.slice(at + match[0].length, at + match[0].length + 64)) ? "property" : "string" });
        }
      },
      { pattern: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, kind: "number" }
    ],
    word: identifier,
    classify: (word) => word === "true" || word === "false" || word === "null" ? "constant" : null
  };
  var scanners = {
    c: (text) => scan(text, c),
    cpp: (text) => scan(text, cpp),
    objc: (text) => scan(text, objc),
    java: (text) => scan(text, java),
    kotlin: (text) => scan(text, kotlin),
    swift: (text) => scan(text, swift),
    csharp: (text) => scan(text, csharp),
    javascript: (text) => scan(text, javascript),
    typescript: (text) => scan(text, typescript),
    go: (text) => scan(text, go),
    rust: (text) => scan(text, rust),
    python: (text) => scan(text, python),
    shell: (text) => scan(text, shell),
    sql: (text) => scan(text, sql),
    json: (text) => scan(text, json),
    yaml: scanYAML,
    css: scanCSS,
    html: (text) => scanHTML(text),
    xml: (text) => scanHTML(text),
    markdown: scanMarkdown
  };
  var supportedLanguages = Object.keys(scanners);
  function tokenize(language, text) {
    const scanner = scanners[language];
    return scanner ? scanner(text) : [];
  }

  // extensions/code-highlight/src/index.ts
  var engine = {
    describe() {
      return { languages: supportedLanguages };
    },
    highlight(request) {
      return encode(request.documents.map((text) => tokenize(request.language, text)));
    }
  };
  defineExtension({
    services: {
      syntax: engine
    }
  });
})();
