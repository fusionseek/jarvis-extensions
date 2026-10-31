// jarvis-extension bundle · send-to-phone@2.0.11 · sdk 2.13.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
          case "files.actions": {
            const engine = implementation;
            if (call2.method === "describe") return Promise.resolve(engine.describe(context));
            if (call2.method === "run") {
              return engine.run(
                call2.params.request,
                context,
                (progress) => {
                  if (signal.cancelled) return;
                  this.invoke("service", "progress", { callId: call2.callId, progress }).catch(() => void 0);
                },
                signal
              );
            }
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
        encode: (text2, options) => sync.text("base64.encode", { text: text2, ...options }),
        decode: (text2, options) => sync.text("base64.decode", { text: text2, ...options })
      },
      hash: {
        digest: (algorithm, text2, options) => sync.text("hash.digest", { algorithm, text: text2, ...options })
      },
      language: {
        detect: (text2, options) => sync.text("language.detect", { text: text2, ...options }),
        displayName: (code) => sync.text("language.displayName", { code })
      }
    },
    clipboard: {
      read: () => call.clipboard("read"),
      readImage: () => call.clipboard("readImage"),
      write: (text2) => call.clipboard("write", { text: text2 })
    },
    quickTransfer: {
      status: () => call.quickTransfer("status"),
      observe: (listener) => runtime.subscribe("quickTransfer", "observe", listener),
      start: () => call.quickTransfer("start"),
      stop: () => call.quickTransfer("stop"),
      sendText: (text2) => call.quickTransfer("sendText", { text: text2 })
    },
    screenshot: {
      capture: (options) => call.screenshot("capture", options)
    },
    ocr: {
      recognize: (file, options) => call.ocr("recognize", { file, ...options })
    },
    speech: {
      speak: (text2, options) => call.speech("speak", { text: text2, ...options }),
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

  // extensions/send-to-phone/src/index.ts
  var text = "";
  var granted = /* @__PURE__ */ new Set();
  var status = null;
  var statusProblem = null;
  var sending = false;
  var lastSentAt = null;
  var failure = null;
  var prefs = { trimWhitespace: true, confirmBeforeSend: false };
  var unsubscribeStatus = null;
  var unsubscribePrefs = null;
  function has(id) {
    return granted.has(id);
  }
  function readPrefs(raw) {
    return {
      trimWhitespace: Boolean(raw["trimWhitespace"] ?? true),
      confirmBeforeSend: Boolean(raw["confirmBeforeSend"] ?? false)
    };
  }
  function describe(e) {
    if (e instanceof JarvisError) return e.detail ?? e.message;
    return e instanceof Error ? e.message : String(e);
  }
  function peerLabel(current) {
    const paired = current?.peers.filter((p) => p.paired) ?? [];
    if (paired.length === 1) return paired[0]?.label ?? null;
    if (paired.length > 1) return `${paired.length} \u53F0\u8BBE\u5907`;
    return null;
  }
  function excerpt(value, limit) {
    const flat = Array.from(value.replace(/\s+/g, " ").trim());
    return flat.length > limit ? `${flat.slice(0, limit).join("")}\u2026` : flat.join("");
  }
  async function refreshStatus() {
    if (!has("quickTransfer.status")) return;
    try {
      status = await jarvis.quickTransfer.status();
      statusProblem = null;
    } catch (e) {
      statusProblem = describe(e);
    }
    jarvis.ui.update();
  }
  async function requestCapabilities(ids) {
    const result = await jarvis.permissions.request(ids);
    granted = /* @__PURE__ */ new Set([...granted, ...result.granted]);
    await refreshStatus();
  }
  async function readClipboard() {
    try {
      const clip = await jarvis.clipboard.read();
      text = clip ?? "";
      failure = clip === null ? "\u526A\u8D34\u677F\u91CC\u662F\u88AB\u5BC6\u7801\u7BA1\u7406\u5668\u6807\u8BB0\u4E3A\u673A\u5BC6\u7684\u5185\u5BB9\uFF0CJarvis \u4E0D\u653E\u884C\u3002" : null;
    } catch (e) {
      failure = e instanceof JarvisError && e.code === "permission.denied" ? null : describe(e);
    }
    jarvis.ui.update();
  }
  async function startTransfer() {
    try {
      status = await jarvis.quickTransfer.start();
      failure = null;
    } catch (e) {
      failure = describe(e);
    }
    jarvis.ui.update();
  }
  async function postToInbox(message, can) {
    if (!can("inbox.post")) {
      jarvis.log.warn("\u6CA1\u6709 Inbox \u6388\u6743\uFF0C\u8FD9\u6761\u56DE\u6267\u6CA1\u6295", message);
      return;
    }
    try {
      await jarvis.inbox.post(message);
    } catch (e) {
      jarvis.log.warn("Inbox \u56DE\u6267\u6CA1\u6295\u51FA\u53BB", describe(e));
    }
  }
  async function send() {
    const payload = prefs.trimWhitespace ? text.trim() : text;
    if (payload.trim() === "" || sending) return;
    sending = true;
    failure = null;
    jarvis.ui.update();
    const hold = jarvis.panel.hold("\u6B63\u5728\u628A\u6587\u5B57\u63A8\u5230\u624B\u673A");
    let sent = false;
    try {
      await jarvis.quickTransfer.sendText(payload);
      lastSentAt = (/* @__PURE__ */ new Date()).toISOString();
      sent = true;
    } catch (e) {
      failure = describe(e);
    } finally {
      hold.release();
      sending = false;
      jarvis.ui.update();
    }
    if (sent) {
      const peer = peerLabel(status);
      await postToInbox({ title: peer ? `\u5DF2\u63A8\u5230 ${peer}` : "\u5DF2\u63A8\u5230\u624B\u673A", body: excerpt(payload, 120), level: "success" }, has);
    }
  }
  var HOW_TO_START = "\u8FD9\u6761\u6307\u4EE4\u4E0D\u4F1A\u66FF\u4F60\u6253\u5F00\u5FEB\u4F20\uFF1A\u5728\u5DE5\u5177\u7BB1\u91CC\u6253\u5F00\u300C\u53D1\u5230\u624B\u673A\u300D\u6309\u300C\u5F00\u542F\u5FEB\u4F20\u300D\uFF0C\u6216\u5728\u5FEB\u4F20\u9762\u677F\u91CC\u5F00\u542F\uFF0C\u624B\u673A\u626B\u7801\u63A5\u5165\u4E4B\u540E\u518D\u53D1\u4E00\u6B21\u3002";
  function notRunningMessage(current, payload) {
    const title = current.state === "starting" ? "\u5FEB\u4F20\u8FD8\u5728\u542F\u52A8\uFF0C\u6CA1\u6709\u53D1\u51FA\u53BB" : current.state === "failed" ? "\u5FEB\u4F20\u6CA1\u8D77\u6765\uFF0C\u6CA1\u6709\u53D1\u51FA\u53BB" : "\u5FEB\u4F20\u6CA1\u5F00\uFF0C\u6CA1\u6709\u53D1\u51FA\u53BB";
    const reason = current.state === "failed" && current.failureReason ? `${current.failureReason}\u3002` : "";
    return { title, body: `${reason}${HOW_TO_START}\u6CA1\u53D1\u51FA\u53BB\u7684\u662F\uFF1A\u300C${excerpt(payload, 60)}\u300D`, level: "warning" };
  }
  async function sendTextSilently(context) {
    const allowed = new Set(context.granted);
    const can = (id) => allowed.has(id);
    const { trimWhitespace } = readPrefs(context.preferences);
    if (!can("quickTransfer.send")) {
      await postToInbox(
        { title: "\u6CA1\u6709\u7ECF\u5FEB\u4F20\u53D1\u9001\u7684\u6388\u6743", body: "\u8FD9\u6761\u6307\u4EE4\u8981\u628A\u6587\u5B57\u7ECF\u5FEB\u4F20\u63A8\u5230\u624B\u673A\u3002\u5728 \u8BBE\u7F6E \u203A \u6269\u5C55 \u203A \u53D1\u5230\u624B\u673A \u91CC\u6253\u5F00\u300C\u7ECF\u5FEB\u4F20\u53D1\u9001\u300D\u3002", level: "warning" },
        can
      );
      return;
    }
    let raw = context.argument ?? "";
    if (raw.trim() === "") {
      if (!can("clipboard.read")) {
        await postToInbox(
          { title: "\u6CA1\u6709\u8981\u53D1\u9001\u7684\u6587\u5B57", body: "/phone \u540E\u9762\u6CA1\u8DDF\u5B57\uFF0C\u800C\u8BFB\u526A\u8D34\u677F\u7684\u6388\u6743\u5173\u7740\u3002\u5728 / \u540E\u9762\u8DDF\u4E0A\u8981\u53D1\u7684\u5B57\uFF0C\u6216\u5728 \u8BBE\u7F6E \u203A \u6269\u5C55 \u203A \u53D1\u5230\u624B\u673A \u91CC\u6253\u5F00\u300C\u8BFB\u53D6\u526A\u8D34\u677F\u300D\u3002", level: "warning" },
          can
        );
        return;
      }
      try {
        const clip = await jarvis.clipboard.read();
        if (clip === null) {
          await postToInbox({ title: "\u526A\u8D34\u677F\u91CC\u662F\u673A\u5BC6\u5185\u5BB9", body: "\u5BC6\u7801\u7BA1\u7406\u5668\u6807\u8BB0\u4E3A\u673A\u5BC6\u7684\u5185\u5BB9 Jarvis \u4E0D\u653E\u884C\u3002\u5728 /phone \u540E\u9762\u76F4\u63A5\u8DDF\u4E0A\u8981\u53D1\u7684\u5B57\u3002", level: "warning" }, can);
          return;
        }
        raw = clip;
      } catch (e) {
        await postToInbox({ title: "\u6CA1\u8BFB\u5230\u526A\u8D34\u677F", body: describe(e), level: "error" }, can);
        return;
      }
    }
    const payload = trimWhitespace ? raw.trim() : raw;
    if (payload.trim() === "") {
      await postToInbox({ title: "\u6CA1\u6709\u8981\u53D1\u9001\u7684\u6587\u5B57", body: "/phone \u540E\u9762\u6CA1\u8DDF\u5B57\uFF0C\u526A\u8D34\u677F\u91CC\u4E5F\u662F\u7A7A\u7684\u3002", level: "warning" }, can);
      return;
    }
    let current = null;
    if (can("quickTransfer.status")) {
      try {
        current = await jarvis.quickTransfer.status();
      } catch {
        current = null;
      }
      if (current && current.state !== "running") {
        await postToInbox(notRunningMessage(current, payload), can);
        return;
      }
    }
    try {
      await jarvis.quickTransfer.sendText(payload);
    } catch (e) {
      const body = e instanceof JarvisError && e.code === "host.failure" && current === null ? `${describe(e)}\u3002\u5FEB\u4F20\u591A\u534A\u6CA1\u5F00\uFF1A${HOW_TO_START}` : describe(e);
      await postToInbox({ title: "\u6CA1\u6709\u53D1\u51FA\u53BB", body, level: "error" }, can);
      return;
    }
    const peer = peerLabel(current);
    await postToInbox({ title: peer ? `\u5DF2\u63A8\u5230 ${peer}` : "\u5DF2\u63A8\u5230\u624B\u673A", body: excerpt(payload, 120), level: "success" }, can);
  }
  function deniedNote(id, title, body) {
    return ui.note({
      tint: "alert",
      symbol: "lock",
      title,
      body,
      actions: [{ id: `grant-${id}`, title: "\u6388\u6743", onPress: () => void requestCapabilities([id]) }]
    });
  }
  function contentSection() {
    const children = [
      ui.editor({
        key: "text",
        value: text,
        rows: 3,
        maxRows: 8,
        placeholder: "\u4ECE\u526A\u8D34\u677F\u8BFB\uFF0C\u6216\u76F4\u63A5\u5728\u8FD9\u91CC\u5199\u2026",
        label: "\u8981\u53D1\u9001\u7684\u6587\u5B57",
        onChange: (value) => {
          text = value;
        }
      })
    ];
    if (!has("clipboard.read")) {
      children.unshift(deniedNote("clipboard.read", "\u6CA1\u6709\u8BFB\u53D6\u526A\u8D34\u677F\u7684\u6388\u6743", "\u6388\u6743\u4E4B\u540E\u300C\u8BFB\u526A\u8D34\u677F\u300D\u90A3\u9897\u6309\u94AE\u624D\u6709\u7528\uFF1B\u4F60\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5728\u4E0B\u9762\u8F93\u5165\u3002"));
    }
    return ui.section({
      key: "content",
      title: "\u5185\u5BB9 \xB7 CONTENT",
      trailing: text === "" ? void 0 : `${Array.from(text).length} \u5B57\u7B26`,
      actions: [
        {
          id: "paste",
          title: "\u8BFB\u526A\u8D34\u677F",
          symbol: "doc.on.clipboard",
          help: "\u628A\u7CFB\u7EDF\u526A\u8D34\u677F\u7684\u5185\u5BB9\u653E\u8FDB\u6765",
          disabled: !has("clipboard.read"),
          onPress: () => void readClipboard()
        },
        {
          id: "clear",
          title: "\u6E05\u7A7A",
          symbol: "xmark.circle",
          help: "\u6E05\u7A7A",
          disabled: text === "",
          onPress: () => {
            text = "";
          }
        }
      ],
      children
    });
  }
  function transferSection() {
    if (!has("quickTransfer.status")) {
      return ui.section({
        key: "transfer",
        title: "\u5FEB\u4F20 \xB7 TRANSFER",
        children: [deniedNote("quickTransfer.status", "\u770B\u4E0D\u5230\u5FEB\u4F20\u7684\u72B6\u6001", "\u6CA1\u6709\u8FD9\u9879\u6388\u6743\u65F6\u65E0\u6CD5\u77E5\u9053\u670D\u52A1\u5F00\u6CA1\u5F00\u3001\u624B\u673A\u8FDE\u6CA1\u8FDE\u3002")]
      });
    }
    if (statusProblem) {
      return ui.section({
        key: "transfer",
        title: "\u5FEB\u4F20 \xB7 TRANSFER",
        children: [ui.note({ tint: "danger", symbol: "exclamationmark.triangle", title: "\u8BFB\u4E0D\u5230\u5FEB\u4F20\u72B6\u6001", body: statusProblem })]
      });
    }
    if (!status || status.state === "stopped" || status.state === "failed") {
      const canStart = has("quickTransfer.control");
      return ui.section({
        key: "transfer",
        title: "\u5FEB\u4F20 \xB7 TRANSFER",
        trailing: "\u672A\u5F00\u542F",
        children: [
          ui.note({
            key: "not-running",
            tint: "alert",
            symbol: "antenna.radiowaves.left.and.right",
            title: status?.state === "failed" ? "\u5FEB\u4F20\u6CA1\u8D77\u6765" : "\u5FEB\u4F20\u8FD8\u6CA1\u5F00",
            body: status?.failureReason ?? "\u53D1\u9001\u8981\u5148\u628A\u5FEB\u4F20\u5F00\u8D77\u6765\uFF0C\u624B\u673A\u626B\u7801\u63A5\u5165\u4E4B\u540E\u624D\u6536\u5F97\u5230\u3002",
            actions: canStart ? [{ id: "start", title: "\u5F00\u542F\u5FEB\u4F20", onPress: () => void startTransfer() }] : [{ id: "grant-control", title: "\u6388\u6743\u5F00\u542F", onPress: () => void requestCapabilities(["quickTransfer.control"]) }]
          })
        ]
      });
    }
    const peer = peerLabel(status);
    return ui.section({
      key: "transfer",
      title: "\u5FEB\u4F20 \xB7 TRANSFER",
      trailing: status.state === "starting" ? "\u542F\u52A8\u4E2D" : "\u670D\u52A1\u4E2D",
      children: [
        ui.readout({ key: "address", label: "\u5730\u5740", value: status.url ?? "\u2014", tint: "accent", copy: true }),
        ui.readout({ key: "peer", label: "\u5DF2\u63A5\u5165", value: peer ?? "\u8FD8\u6CA1\u6709\u624B\u673A\u63A5\u5165 \xB7 \u5728\u5FEB\u4F20\u91CC\u626B\u7801", tint: peer ? "live" : "neutral" })
      ]
    });
  }
  function actionSection() {
    const ready = status?.state === "running" && has("quickTransfer.send") && text.trim() !== "" && !sending;
    const children = [];
    if (!has("quickTransfer.send")) {
      children.push(deniedNote("quickTransfer.send", "\u6CA1\u6709\u7ECF\u5FEB\u4F20\u53D1\u9001\u7684\u6388\u6743", "\u8FD9\u662F\u8FD9\u4E2A\u6269\u5C55\u552F\u4E00\u8981\u505A\u7684\u4E8B\u3002"));
    }
    if (failure) {
      children.push(ui.note({ key: "failure", tint: "danger", symbol: "exclamationmark.triangle", body: failure }));
    }
    if (lastSentAt && !failure) {
      children.push(ui.text({ key: "last-sent", text: `\u4E0A\u6B21\u53D1\u9001 ${new Date(lastSentAt).toLocaleTimeString()}`, style: "footnote" }));
    }
    const button = ui.button({
      key: "send",
      title: sending ? "\u53D1\u9001\u4E2D\u2026" : "\u53D1\u5230\u624B\u673A",
      symbol: "paperplane",
      variant: "primary",
      size: "bar",
      disabled: !ready,
      help: ready ? "\u7ECF\u5FEB\u4F20\u628A\u4E0A\u9762\u7684\u6587\u5B57\u63A8\u5230\u5DF2\u63A5\u5165\u7684\u624B\u673A" : "\u8981\u5148\u5F00\u542F\u5FEB\u4F20\u3001\u6709\u6587\u5B57\u3001\u4E14\u5DF2\u6388\u6743",
      onPress: () => void send(),
      ...prefs.confirmBeforeSend ? { confirm: { title: "\u786E\u8BA4\u53D1\u9001", timeoutSeconds: 4 } } : {}
    });
    children.push(button);
    children.push(ui.text({ key: "slash-hint", text: "\u5168\u5C40\u641C\u7D22\u6216\u901F\u8BB0\u91CC\u8F93\u5165 /phone \u540E\u9762\u8DDF\u4E00\u6BB5\u5B57\uFF0C\u4E0D\u5F00\u9762\u677F\u76F4\u63A5\u53D1", style: "footnote" }));
    return ui.section({ key: "send-section", title: "\u53D1\u9001 \xB7 SEND", children });
  }
  defineExtension({
    toolbox: {
      async activate(context) {
        granted = new Set(context.granted);
        prefs = readPrefs(context.preferences);
        await refreshStatus();
        if (has("quickTransfer.status") && !unsubscribeStatus) {
          unsubscribeStatus = jarvis.quickTransfer.observe((next) => {
            status = next;
            jarvis.ui.update();
          });
        }
        if (!unsubscribePrefs) {
          unsubscribePrefs = jarvis.preferences.onChange((changes) => {
            if ("trimWhitespace" in changes) prefs.trimWhitespace = Boolean(changes["trimWhitespace"]);
            if ("confirmBeforeSend" in changes) prefs.confirmBeforeSend = Boolean(changes["confirmBeforeSend"]);
          });
        }
      },
      render() {
        return ui.scroll({ children: [contentSection(), transferSection(), actionSection()] });
      },
      deactivate() {
        unsubscribeStatus?.();
        unsubscribeStatus = null;
        unsubscribePrefs?.();
        unsubscribePrefs = null;
      }
    },
    commands: {
      "send-text": sendTextSilently
    }
  });
})();
