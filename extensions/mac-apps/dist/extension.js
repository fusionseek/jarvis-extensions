// jarvis-extension bundle · mac-apps@1.0.6 · sdk 2.14.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
  var sdkVersion = "2.14.0";
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
          case "files.details": {
            const engine = implementation;
            if (call2.method === "describe") return Promise.resolve(engine.describe(context));
            if (call2.method === "inspect") return Promise.resolve(engine.inspect(call2.params.request, context, signal));
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

  // extensions/mac-apps/src/model.ts
  var groupModes = ["category", "letter", "location", "none"];
  var sortModes = ["name", "recent", "added"];
  var searchLimits = [3, 4, 6];
  var groupTitles = { category: "\u5206\u7C7B", letter: "\u9996\u5B57\u6BCD", location: "\u4F4D\u7F6E", none: "\u4E0D\u5206\u7EC4" };
  var sortTitles = { name: "\u540D\u79F0", recent: "\u6700\u8FD1\u4F7F\u7528", added: "\u6700\u8FD1\u6DFB\u52A0" };
  var defaultSettings = { group: "category", sort: "name", showInSearch: true, searchLimit: 4, includeSystem: true };
  function normalizeSettings(raw) {
    const value = typeof raw === "object" && raw !== null ? raw : {};
    return {
      group: groupModes.includes(value.group) ? value.group : defaultSettings.group,
      sort: sortModes.includes(value.sort) ? value.sort : defaultSettings.sort,
      showInSearch: typeof value.showInSearch === "boolean" ? value.showInSearch : defaultSettings.showInSearch,
      searchLimit: searchLimits.includes(value.searchLimit) ? value.searchLimit : defaultSettings.searchLimit,
      includeSystem: typeof value.includeSystem === "boolean" ? value.includeSystem : defaultSettings.includeSystem
    };
  }
  var collator = (() => {
    try {
      return new Intl.Collator("zh-Hans-u-co-pinyin", { numeric: true, sensitivity: "base" });
    } catch {
      return { compare: (a, b) => a.localeCompare(b) };
    }
  })();
  function compareNames(a, b) {
    const la = letterOf(a);
    const lb = letterOf(b);
    if (la !== lb) {
      if (la === "#") return 1;
      if (lb === "#") return -1;
      return la < lb ? -1 : 1;
    }
    return collator.compare(a, b);
  }
  function sortApps(apps, sort) {
    const byName = (a, b) => compareNames(a.name, b.name);
    if (sort === "name") return [...apps].sort(byName);
    const key = sort === "recent" ? "lastUsedAt" : "addedAt";
    return [...apps].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (x !== y) {
        if (x === null) return 1;
        if (y === null) return -1;
        return y - x;
      }
      return byName(a, b);
    });
  }
  var letterBoundaries = [
    ["A", "\u963F"],
    ["B", "\u516B"],
    ["C", "\u5693"],
    ["D", "\u54D2"],
    ["E", "\u59B8"],
    ["F", "\u53D1"],
    ["G", "\u65EE"],
    ["H", "\u54C8"],
    ["J", "\u8BA5"],
    ["K", "\u5494"],
    ["L", "\u5783"],
    ["M", "\u5463"],
    ["N", "\u62CF"],
    ["O", "\u5662"],
    ["P", "\u5991"],
    ["Q", "\u4E03"],
    ["R", "\u5465"],
    ["S", "\u4EE8"],
    ["T", "\u4ED6"],
    ["W", "\u5C72"],
    ["X", "\u5915"],
    ["Y", "\u4E2B"],
    ["Z", "\u5E00"]
  ];
  function letterOf(name) {
    const first = name.trim().charAt(0);
    if (/[A-Za-z]/.test(first)) return first.toUpperCase();
    if (/[㐀-鿿]/.test(first)) {
      let letter = "#";
      for (const [candidate, boundary] of letterBoundaries) {
        if (collator.compare(first, boundary) >= 0) letter = candidate;
        else break;
      }
      return letter;
    }
    return "#";
  }
  var locationOrder = ["applications", "user", "system", "other"];
  function groupApps(apps, settings) {
    if (settings.group === "none") {
      return apps.length === 0 ? [] : [{ id: "all", title: "\u5168\u90E8\u5E94\u7528", apps: sortApps(apps, settings.sort).map((app) => app.id) }];
    }
    const buckets = /* @__PURE__ */ new Map();
    for (const app of apps) {
      const [id, title] = settings.group === "category" ? [`category:${app.category ?? "other"}`, app.categoryTitle] : settings.group === "letter" ? [`letter:${letterOf(app.name)}`, letterOf(app.name)] : [`location:${app.location}`, app.locationTitle];
      const bucket = buckets.get(id) ?? { id, title, apps: [] };
      bucket.apps.push(app);
      buckets.set(id, bucket);
    }
    const ordered = [...buckets.values()].sort((a, b) => {
      if (settings.group === "location") {
        return locationOrder.indexOf(a.id.slice("location:".length)) - locationOrder.indexOf(b.id.slice("location:".length));
      }
      const lastA = a.id === "category:other" || a.title === "#";
      const lastB = b.id === "category:other" || b.title === "#";
      if (lastA !== lastB) return lastA ? 1 : -1;
      return settings.group === "letter" ? a.title.localeCompare(b.title) : compareNames(a.title, b.title);
    });
    return ordered.map((bucket) => ({ id: bucket.id, title: bucket.title, apps: sortApps(bucket.apps, settings.sort).map((app) => app.id) }));
  }
  function catalog(apps, settings) {
    const visible = settings.includeSystem ? apps : apps.filter((app) => !app.system);
    return { showInSearch: settings.showInSearch, searchLimit: settings.searchLimit, groups: groupApps(visible, settings) };
  }
  function preview(apps, settings) {
    const byID = new Map(apps.map((app) => [app.id, app]));
    return catalog(apps, settings).groups.map((group) => {
      const names = group.apps.slice(0, 3).map((id) => byID.get(id)?.name ?? "");
      const more = group.apps.length > 3 ? " \u7B49" : "";
      return { id: group.id, title: group.title, count: group.apps.length, sample: names.join("\u3001") + more };
    });
  }

  // extensions/mac-apps/src/page.ts
  function searchSection(session2) {
    const { settings } = session2;
    return ui.section({
      key: "search",
      title: "\u5168\u5C40\u641C\u7D22 \xB7 SEARCH",
      children: [
        ui.toggle({
          key: "show",
          title: "\u641C\u7D22\u7ED3\u679C\u91CC\u663E\u793A\u5E94\u7528",
          subtitle: "\u666E\u901A\u6253\u5B57\u65F6\u6392\u5728\u6307\u4EE4\u4E4B\u540E\u3001\u6700\u8FD1\u6253\u5F00\u4E4B\u524D",
          value: settings.showInSearch,
          onChange: (value) => void session2.change({ showInSearch: value })
        }),
        ui.segmented({
          key: "limit",
          label: "\u81F3\u591A\u51E0\u6761",
          layout: "full",
          value: String(settings.searchLimit),
          disabled: !settings.showInSearch,
          options: searchLimits.map((limit) => ({ value: String(limit), title: `${limit} \u6761` })),
          onChange: (value) => void session2.change({ searchLimit: Number(value) })
        }),
        ui.toggle({
          key: "system",
          title: "\u663E\u793A\u7CFB\u7EDF\u5E94\u7528",
          subtitle: "\u8BA1\u7B97\u5668\u3001\u7EC8\u7AEF\u8FD9\u7C7B /System \u4E0B\u81EA\u5E26\u7684\u5E94\u7528\uFF1B\u5173\u6389\u540E\u641C\u7D22\u4E0E\u7F51\u683C\u91CC\u90FD\u4E0D\u51FA",
          value: settings.includeSystem,
          onChange: (value) => void session2.change({ includeSystem: value })
        })
      ]
    });
  }
  function viewSection(session2) {
    const { settings } = session2;
    return ui.section({
      key: "view",
      title: "\u5E94\u7528\u89C6\u56FE \xB7 APP VIEW",
      children: [
        ui.segmented({
          key: "group",
          label: "\u5206\u7EC4",
          layout: "full",
          value: settings.group,
          options: groupModes.map((mode) => ({ value: mode, title: groupTitles[mode] })),
          onChange: (value) => void session2.change({ group: value })
        }),
        ui.segmented({
          key: "sort",
          label: "\u6392\u5E8F",
          layout: "full",
          value: settings.sort,
          options: sortModes.map((mode) => ({ value: mode, title: sortTitles[mode] })),
          onChange: (value) => void session2.change({ sort: value })
        }),
        ui.text({
          key: "how",
          style: "footnote",
          text: "\u5728\u5168\u5C40\u641C\u7D22\uFF08\u2325Space\uFF09\u91CC\u8F93\u5165 app \u7A7A\u683C\u8FDB\u5E94\u7528\u89C6\u56FE\uFF0C\u63A5\u7740\u6253\u5B57\u5C31\u5728\u7F51\u683C\u91CC\u7B5B\uFF1B\u6309\u4F4F\u56FE\u6807\u8FDB\u7F16\u8F91\u6001\u79FB\u5230\u5E9F\u7EB8\u7BD3\uFF0C\u53F3\u952E\u5728\u8BBF\u8FBE\u4E2D\u663E\u793A\u3002\u6539\u52A8\u4E0B\u4E00\u6B21\u5524\u51FA\u751F\u6548\u3002"
        })
      ]
    });
  }
  function previewSection(session2) {
    if (!session2.canRead) {
      return ui.empty({
        key: "denied",
        symbol: "lock",
        title: "\u6CA1\u6709\u8BFB\u53D6\u672C\u673A\u5E94\u7528\u7684\u6388\u6743",
        hint: "\u5168\u5C40\u641C\u7D22\u8981\u5148\u77E5\u9053\u8FD9\u53F0 Mac \u88C5\u4E86\u54EA\u4E9B\u5E94\u7528\uFF1B\u6253\u5F00\u3001\u5220\u9664\u5E94\u7528\u4ECD\u7531\u4F60\u5728\u5168\u5C40\u641C\u7D22\u91CC\u70B9\u3002",
        action: { id: "grant", title: "\u6388\u6743", onPress: () => void session2.requestAccess() }
      });
    }
    if (session2.error) {
      return ui.note({
        key: "error",
        tint: "alert",
        symbol: "exclamationmark.triangle",
        title: "\u8BFB\u4E0D\u51FA\u672C\u673A\u5E94\u7528",
        body: session2.error,
        actions: [{ id: "retry", title: "\u91CD\u8BFB", onPress: () => void session2.refresh() }]
      });
    }
    if (session2.apps === null) {
      return ui.text({ key: "loading", style: "footnote", text: "\u6B63\u5728\u8BFB\u672C\u673A\u5E94\u7528" });
    }
    const groups = preview(session2.apps, session2.settings);
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    return ui.section({
      key: "preview",
      title: "\u9884\u89C8 \xB7 PREVIEW",
      trailing: `${total} \u4E2A\u5E94\u7528 \xB7 ${groups.length} \u7EC4`,
      actions: [{ id: "refresh", title: "\u91CD\u8BFB", symbol: "arrow.clockwise", help: "\u91CD\u8BFB\u672C\u673A\u5E94\u7528", onPress: () => void session2.refresh() }],
      children: [
        ui.list({
          key: "groups",
          emptyState: ui.empty({ key: "none", symbol: "square.grid.3x3", title: "\u6CA1\u6709\u53EF\u663E\u793A\u7684\u5E94\u7528" }),
          children: groups.map(
            (group) => ui.row({ key: group.id, symbol: "square.grid.2x2", title: `${group.title}  ${group.count}`, subtitle: group.sample })
          )
        })
      ]
    });
  }
  function renderPage(session2) {
    return ui.scroll({ children: [searchSection(session2), viewSection(session2), previewSection(session2)] });
  }

  // extensions/mac-apps/src/session.ts
  var settingsKey = "settings";
  async function loadSettings() {
    try {
      return normalizeSettings(await jarvis.storage.get(settingsKey));
    } catch {
      return { ...defaultSettings };
    }
  }
  function describeError(error) {
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
      return error.message;
    }
    return "\u8BFB\u4E0D\u51FA\u672C\u673A\u5E94\u7528";
  }
  var Session = class {
    constructor() {
      this.granted = [];
      this.settings = { ...defaultSettings };
      /** 本机应用；`null` = 还没读。 */
      this.apps = null;
      this.loading = false;
      this.error = null;
    }
    /** 读得了本机应用。 */
    get canRead() {
      return this.granted.includes("apps.read");
    }
    async activate(context) {
      this.granted = [...context.granted];
      this.settings = await loadSettings();
      jarvis.ui.update();
      if (this.canRead) await this.refresh();
    }
    deactivate() {
      this.loading = false;
    }
    /** 重读清单（预览）。 */
    async refresh() {
      if (!this.canRead || this.loading) return;
      this.loading = true;
      this.error = null;
      jarvis.ui.update();
      try {
        this.apps = await jarvis.apps.list();
      } catch (error) {
        this.error = describeError(error);
      }
      this.loading = false;
      jarvis.ui.update();
    }
    /** 改设置：当场写进存储（全局搜索下一次唤出就按新的来）。 */
    async change(patch) {
      this.settings = normalizeSettings({ ...this.settings, ...patch });
      jarvis.ui.update();
      try {
        await jarvis.storage.set(settingsKey, this.settings);
      } catch (error) {
        this.error = `\u8BBE\u7F6E\u6CA1\u5B58\u4E0A\uFF1A${describeError(error)}`;
        jarvis.ui.update();
      }
    }
    /** 页面上的「授权」。 */
    async requestAccess() {
      const result = await jarvis.permissions.request(["apps.read"]);
      if (result.granted.includes("apps.read")) {
        this.granted = [.../* @__PURE__ */ new Set([...this.granted, "apps.read"])];
        await this.refresh();
      }
    }
  };

  // extensions/mac-apps/src/index.ts
  var session = new Session();
  var page = {
    activate: (context) => session.activate(context),
    deactivate: () => session.deactivate(),
    render: () => renderPage(session)
  };
  defineExtension({
    toolbox: page,
    services: {
      apps: {
        async catalog() {
          const [settings, apps] = await Promise.all([loadSettings(), jarvis.apps.list()]);
          return catalog(apps, settings);
        }
      }
    }
  });
})();
