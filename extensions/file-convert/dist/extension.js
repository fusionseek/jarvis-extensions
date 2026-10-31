// jarvis-extension bundle · file-convert@1.0.0 · sdk 2.14.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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

  // extensions/file-convert/src/engines.ts
  var IN = "\0in";
  var OUT = "\0out";
  var tools = [
    { name: "sips", builtin: true },
    { name: "afconvert", builtin: true },
    { name: "avconvert", builtin: true, progress: "avconvert" },
    { name: "textutil", builtin: true },
    { name: "plutil", builtin: true },
    { name: "ffmpeg", builtin: false, preference: "ffmpegPath", progress: "ffmpeg" },
    { name: "ffprobe", builtin: false, preference: "ffprobePath" },
    { name: "magick", builtin: false, preference: "magickPath" },
    { name: "pandoc", builtin: false, preference: "pandocPath" },
    { name: "soffice", builtin: false, preference: "sofficePath", namesOutputItself: true }
  ];
  function tool(name) {
    const found = tools.find((entry) => entry.name === name);
    if (!found) throw new Error(`\u6CA1\u6709 ${name} \u8FD9\u4E2A\u5F15\u64CE`);
    return found;
  }
  var durationTemplate = ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", IN];

  // extensions/file-convert/src/media.ts
  var sipsReadable = ["png", "jpg", "heic", "tiff", "gif", "bmp", "webp", "avif", "jp2", "psd", "tga", "svg"];
  var sipsFormats = { png: "png", jpg: "jpeg", heic: "heic", tiff: "tiff", gif: "gif", bmp: "bmp", avif: "avif", jp2: "jp2", pdf: "pdf" };
  var magickReadable = ["png", "jpg", "heic", "tiff", "gif", "bmp", "webp", "avif", "jp2", "psd", "tga", "svg", "ico"];
  var magickTargets = ["png", "jpg", "webp", "avif", "tiff", "gif", "bmp"];
  var afconvertReadable = ["m4a", "mp3", "wav", "aiff", "caf", "flac", "aac"];
  var afconvertFormats = {
    m4a: ["m4af", "aac"],
    wav: ["WAVE", "LEI16"],
    aiff: ["AIFF", "BEI16"],
    caf: ["caff", "aac"],
    flac: ["flac", "flac"]
  };
  var avconvertReadable = ["mov", "mp4", "m4v"];
  var ffmpegVideo = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "flv", "wmv", "mpg", "ts", "3gp"];
  var ffmpegAudio = ["m4a", "mp3", "wav", "aiff", "flac", "caf", "ogg", "opus", "aac"];
  var ffmpegCodecs = {
    mp4: ["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
    m4v: ["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
    mov: ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"],
    mkv: ["-c:v", "libx264", "-preset", "medium", "-crf", "22", "-c:a", "aac", "-b:a", "192k"],
    webm: ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-c:a", "libopus", "-b:a", "128k"],
    // GIF 动图：12 帧、宽 480。不用 palettegen 两段滤镜（那要 `;`，manifest 不收 shell 记号）。
    gif: ["-vf", "fps=12,scale=480:-1:flags=lanczos", "-loop", "0"],
    mp3: ["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
    m4a: ["-vn", "-c:a", "aac", "-b:a", "192k"],
    wav: ["-vn", "-c:a", "pcm_s16le"],
    aiff: ["-vn", "-c:a", "pcm_s16be"],
    flac: ["-vn", "-c:a", "flac"],
    ogg: ["-vn", "-c:a", "libvorbis", "-q:a", "5"],
    opus: ["-vn", "-c:a", "libopus", "-b:a", "128k"],
    webp: ["-c:v", "libwebp", "-quality", "85"]
  };
  function ffmpegTemplate(target) {
    return ["-hide_banner", "-nostdin", "-y", "-i", IN, ...ffmpegCodecs[target], "-progress", "pipe:1", "-nostats", OUT];
  }
  var mediaConversions = [
    // 图像 · sips
    ...Object.keys(sipsFormats).map((to) => ({
      tool: "sips",
      from: sipsReadable.filter((from) => from !== to),
      to,
      cost: 1,
      template: ["-s", "format", sipsFormats[to], IN, "--out", OUT]
    })),
    // 图像 · ImageMagick（按产物扩展名定格式）；ICO 要先缩到图标的几档尺寸
    ...magickTargets.map((to) => ({ tool: "magick", from: magickReadable.filter((from) => from !== to), to, cost: 2, template: [IN, OUT] })),
    { tool: "magick", from: magickReadable.filter((from) => from !== "ico"), to: "ico", cost: 2, template: [IN, "-define", "icon:auto-resize=256,128,64,48,32,16", OUT] },
    // 图像 · ffmpeg 写 WebP（没装 ImageMagick 时）
    { tool: "ffmpeg", from: ["png", "jpg", "bmp", "tiff", "gif"], to: "webp", cost: 3, template: ffmpegTemplate("webp") },
    // 音频 · afconvert
    ...Object.entries(afconvertFormats).map(([to, [fileType, dataFormat]]) => ({
      tool: "afconvert",
      from: afconvertReadable.filter((from) => from !== to),
      to,
      cost: 1,
      template: ["-f", fileType, "-d", dataFormat, IN, OUT]
    })),
    // 音频 · ffmpeg
    ...["mp3", "m4a", "wav", "aiff", "flac", "ogg", "opus"].map((to) => ({
      tool: "ffmpeg",
      from: [...ffmpegAudio, ...ffmpegVideo].filter((from) => from !== to),
      to,
      cost: 2,
      template: ffmpegTemplate(to)
    })),
    // 视频 · avconvert
    ...["mp4", "mov", "m4v"].map((to) => ({
      tool: "avconvert",
      from: avconvertReadable.filter((from) => from !== to),
      to,
      cost: 1,
      template: ["--source", IN, "--preset", "PresetHighestQuality", "--output", OUT, "--progress", "--replace"]
    })),
    { tool: "avconvert", from: avconvertReadable, to: "m4a", cost: 1.5, template: ["--source", IN, "--preset", "PresetAppleM4A", "--output", OUT, "--progress", "--replace"] },
    // 视频 · ffmpeg
    ...["mp4", "mov", "m4v", "mkv", "webm", "gif"].map((to) => ({
      tool: "ffmpeg",
      from: ffmpegVideo.filter((from) => from !== to),
      to,
      cost: 2,
      template: ffmpegTemplate(to)
    }))
  ];

  // extensions/file-convert/src/office.ts
  var documents = ["doc", "docx", "odt", "rtf", "txt", "html"];
  var spreadsheets = ["xlsx", "xls", "ods", "csv"];
  var presentations = ["pptx", "ppt", "odp"];
  var filters = {
    pdf: "pdf",
    docx: "docx",
    odt: "odt",
    xlsx: "xlsx",
    ods: "ods",
    csv: "csv:Text-CSV:44,34,76,1",
    pptx: "pptx",
    odp: "odp"
  };
  function soffice(from, to) {
    return { tool: "soffice", from: from.filter((source) => source !== to), to, cost: 2.5, template: ["--headless", "--convert-to", filters[to], IN] };
  }
  var officeConversions = [
    soffice([...documents, ...spreadsheets, ...presentations], "pdf"),
    soffice(documents, "docx"),
    soffice(documents, "odt"),
    soffice(spreadsheets, "xlsx"),
    soffice(spreadsheets, "ods"),
    soffice(spreadsheets.filter((source) => source !== "csv"), "csv"),
    soffice(presentations, "pptx"),
    soffice(presentations, "odp")
  ];

  // extensions/file-convert/src/text.ts
  var textutilWritable = { txt: "txt", html: "html", rtf: "rtf", doc: "doc", docx: "docx", odt: "odt" };
  var textutilReadable = ["txt", "html", "rtf", "doc", "docx", "odt", "webarchive"];
  var pandocReadable = ["md", "html", "docx", "odt", "epub", "rtf"];
  var textConversions = [
    ...Object.entries(textutilWritable).map(([to, name]) => ({
      tool: "textutil",
      from: textutilReadable.filter((from) => from !== to),
      to,
      cost: 1,
      template: ["-convert", name, IN, "-output", OUT]
    })),
    // pandoc：Markdown 写成 GitHub 风格（读起来最常见）；纯文本要点名 plain（.txt 认不出格式）；其余按产物扩展名定，HTML 带完整的头尾。
    { tool: "pandoc", from: pandocReadable.filter((from) => from !== "md"), to: "md", cost: 2, template: [IN, "-t", "gfm", "-o", OUT] },
    { tool: "pandoc", from: pandocReadable, to: "txt", cost: 2, template: [IN, "-t", "plain", "-o", OUT] },
    ...["html", "docx", "odt", "epub", "rtf"].map((to) => ({
      tool: "pandoc",
      from: pandocReadable.filter((from) => from !== to),
      to,
      cost: 2,
      template: [IN, "-s", "-o", OUT]
    })),
    { tool: "plutil", from: ["plist"], to: "json", cost: 1, template: ["-convert", "json", "-o", OUT, IN] },
    { tool: "plutil", from: ["json"], to: "plist", cost: 1, template: ["-convert", "xml1", "-o", OUT, IN] }
  ];

  // extensions/file-convert/src/routes.ts
  var conversions = [...mediaConversions, ...textConversions, ...officeConversions];
  var maximumSteps = 2;
  var stepPenalty = 0.5;
  function plan(from, to, available, edges = conversions) {
    if (from === to) return void 0;
    const usable = edges.filter((edge) => available.has(edge.tool));
    let best;
    for (const first of usable) {
      if (!first.from.includes(from)) continue;
      if (first.to === to) {
        const cost = first.cost;
        if (!best || cost < best.cost) best = { cost, steps: [{ conversion: first, from, to }] };
        continue;
      }
      if (maximumSteps < 2) continue;
      for (const second of usable) {
        if (second.to !== to || !second.from.includes(first.to)) continue;
        const cost = first.cost + second.cost + stepPenalty;
        if (!best || cost < best.cost) {
          best = { cost, steps: [{ conversion: first, from, to: first.to }, { conversion: second, from: first.to, to }] };
        }
      }
    }
    return best?.steps;
  }
  function reachableSources(to, available, sources, edges = conversions) {
    return sources.filter((from) => plan(from, to, available, edges) !== void 0);
  }

  // extensions/file-convert/src/commands.ts
  function expand(template, input, output) {
    return template.map((part) => {
      if (part === IN) return input;
      if (part === OUT) {
        if (output === void 0) throw new Error("\u8FD9\u6761\u547D\u4EE4\u8981\u4E00\u4E2A\u4EA7\u7269\u540D");
        return { output };
      }
      return part;
    });
  }

  // extensions/file-convert/src/formats.ts
  var formats = [
    // 图像
    { id: "png", title: "PNG", family: "image", extensions: ["png"] },
    { id: "jpg", title: "JPEG", family: "image", extensions: ["jpg", "jpeg"] },
    { id: "heic", title: "HEIC", family: "image", extensions: ["heic", "heif"] },
    { id: "tiff", title: "TIFF", family: "image", extensions: ["tiff", "tif"] },
    { id: "gif", title: "GIF", family: "image", extensions: ["gif"] },
    { id: "bmp", title: "BMP", family: "image", extensions: ["bmp"] },
    { id: "webp", title: "WebP", family: "image", extensions: ["webp"] },
    { id: "avif", title: "AVIF", family: "image", extensions: ["avif"] },
    { id: "jp2", title: "JPEG 2000", family: "image", extensions: ["jp2"] },
    { id: "ico", title: "ICO", family: "image", extensions: ["ico"] },
    { id: "psd", title: "PSD", family: "image", extensions: ["psd"] },
    { id: "svg", title: "SVG", family: "image", extensions: ["svg"] },
    { id: "tga", title: "TGA", family: "image", extensions: ["tga"] },
    // PDF：图片与办公文档都能转成它
    { id: "pdf", title: "PDF", family: "pdf", extensions: ["pdf"] },
    // 音频
    { id: "m4a", title: "M4A", family: "audio", extensions: ["m4a"] },
    { id: "mp3", title: "MP3", family: "audio", extensions: ["mp3"] },
    { id: "wav", title: "WAV", family: "audio", extensions: ["wav"] },
    { id: "aiff", title: "AIFF", family: "audio", extensions: ["aiff", "aif"] },
    { id: "flac", title: "FLAC", family: "audio", extensions: ["flac"] },
    { id: "caf", title: "CAF", family: "audio", extensions: ["caf"] },
    { id: "ogg", title: "OGG", family: "audio", extensions: ["ogg", "oga"] },
    { id: "opus", title: "Opus", family: "audio", extensions: ["opus"] },
    { id: "aac", title: "AAC", family: "audio", extensions: ["aac"] },
    // 视频
    { id: "mp4", title: "MP4", family: "video", extensions: ["mp4"] },
    { id: "mov", title: "MOV", family: "video", extensions: ["mov", "qt"] },
    { id: "m4v", title: "M4V", family: "video", extensions: ["m4v"] },
    { id: "mkv", title: "MKV", family: "video", extensions: ["mkv"] },
    { id: "webm", title: "WebM", family: "video", extensions: ["webm"] },
    { id: "avi", title: "AVI", family: "video", extensions: ["avi"] },
    { id: "flv", title: "FLV", family: "video", extensions: ["flv"] },
    { id: "wmv", title: "WMV", family: "video", extensions: ["wmv"] },
    { id: "mpg", title: "MPEG", family: "video", extensions: ["mpg", "mpeg"] },
    { id: "ts", title: "TS", family: "video", extensions: ["ts", "m2ts", "mts"] },
    { id: "3gp", title: "3GP", family: "video", extensions: ["3gp"] },
    // 文本
    { id: "md", title: "Markdown", family: "text", extensions: ["md", "markdown"] },
    { id: "html", title: "HTML", family: "text", extensions: ["html", "htm"] },
    { id: "txt", title: "\u7EAF\u6587\u672C", family: "text", extensions: ["txt"] },
    { id: "rtf", title: "RTF", family: "text", extensions: ["rtf"] },
    { id: "epub", title: "EPUB", family: "text", extensions: ["epub"] },
    { id: "webarchive", title: "Web \u5F52\u6863", family: "text", extensions: ["webarchive"] },
    // 数据
    { id: "json", title: "JSON", family: "data", extensions: ["json"] },
    { id: "plist", title: "plist", family: "data", extensions: ["plist"] },
    // 办公
    { id: "docx", title: "Word", family: "office", extensions: ["docx"] },
    { id: "doc", title: "Word 97", family: "office", extensions: ["doc"] },
    { id: "odt", title: "ODT", family: "office", extensions: ["odt"] },
    { id: "xlsx", title: "Excel", family: "office", extensions: ["xlsx"] },
    { id: "xls", title: "Excel 97", family: "office", extensions: ["xls"] },
    { id: "ods", title: "ODS", family: "office", extensions: ["ods"] },
    { id: "csv", title: "CSV", family: "office", extensions: ["csv"] },
    { id: "pptx", title: "PowerPoint", family: "office", extensions: ["pptx"] },
    { id: "ppt", title: "PPT 97", family: "office", extensions: ["ppt"] },
    { id: "odp", title: "ODP", family: "office", extensions: ["odp"] }
  ];
  var byId = new Map(formats.map((format) => [format.id, format]));
  var byExtension = new Map(formats.flatMap((format) => format.extensions.map((extension) => [extension, format])));
  function formatById(id) {
    return byId.get(id);
  }
  function formatOfExtension(extension) {
    return byExtension.get(extension.toLowerCase());
  }
  function symbolOf(family) {
    switch (family) {
      case "image":
        return "photo";
      case "audio":
        return "music.note";
      case "video":
        return "film";
      case "text":
        return "doc.text";
      case "office":
        return "doc.richtext";
      case "data":
        return "curlybraces";
      case "pdf":
        return "doc.richtext.fill";
    }
  }

  // extensions/file-convert/src/progress.ts
  function ffmpegFraction(line, duration) {
    const trimmed = line.trim();
    if (trimmed === "progress=end") return 1;
    if (!duration || duration <= 0) return void 0;
    const match = /^out_time_(us|ms)=(\d+)$/.exec(trimmed);
    if (!match) return void 0;
    const seconds = Number(match[2]) / 1e6;
    return Math.min(Math.max(seconds / duration, 0), 0.99);
  }
  function avconvertFraction(line) {
    const match = /avconvert progress:\s*([\d.]+)%/.exec(line);
    if (!match) return void 0;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.min(Math.max(value / 100, 0), 1) : void 0;
  }
  function parseDuration(output) {
    const value = Number(output.trim().split("\n")[0]);
    return Number.isFinite(value) && value > 0 ? value : void 0;
  }

  // extensions/file-convert/src/service.ts
  var group = { id: "convert", title: "\u683C\u5F0F\u8F6C\u6362", symbol: "arrow.triangle.2.circlepath" };
  var maximumFiles = 50;
  async function locateTools(preferences = {}) {
    const located = /* @__PURE__ */ new Map();
    for (const entry of tools) {
      const chosen = entry.preference && typeof preferences[entry.preference] === "string" ? preferences[entry.preference].trim() : "";
      const where = await jarvis.process.locate(chosen || entry.name);
      if (where.path) located.set(entry.name, where.path);
    }
    return located;
  }
  function actionId(target) {
    return `to-${target}`;
  }
  function describeActions(available) {
    const sourceIds = formats.map((format) => format.id);
    const actions = [];
    for (const target of formats) {
      const sources = reachableSources(target.id, available, sourceIds);
      if (sources.length === 0) continue;
      const extensions = [...new Set(sources.flatMap((id) => formatById(id)?.extensions ?? []))].slice(0, 64);
      actions.push({
        id: actionId(target.id),
        title: target.title,
        symbol: symbolOf(target.family),
        extensions,
        maximum: maximumFiles,
        group: group.id,
        produces: target.id
      });
    }
    return { groups: [group], actions: actions.slice(0, 64) };
  }
  function outputName(name, extension, taken) {
    const dot = name.lastIndexOf(".");
    const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/^\.+/, "") || "\u672A\u547D\u540D";
    let candidate = `${stem}.${extension}`;
    for (let index = 2; taken.has(candidate.toLowerCase()); index += 1) candidate = `${stem} ${index}.${extension}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  }
  function stemOf(name) {
    const dot = name.lastIndexOf(".");
    return (dot > 0 ? name.slice(0, dot) : name).replace(/^\.+/, "") || "\u672A\u547D\u540D";
  }
  function lastErrorLine(stderr) {
    const lines = stderr.split(/\r?\n|\r/).map((line) => line.trim()).filter((line) => line.length > 0);
    const last = lines[lines.length - 1];
    if (!last) return void 0;
    return last.length > 120 ? `${last.slice(0, 119)}\u2026` : last;
  }
  var brokenInstall = /Library not loaded|Symbol not found|dyld\[\d+\]/;
  var FileFailure = class extends Error {
  };
  function cancelledError() {
    return new JarvisError({ code: "cancelled", message: "\u5DF2\u53D6\u6D88" });
  }
  async function runStep(step, input, inputName, output, located, directory, signal, onFraction) {
    const entry = tool(step.conversion.tool);
    const executable = located.get(entry.name);
    if (!executable) throw new FileFailure(`\u6CA1\u627E\u5230 ${entry.name}`);
    let duration;
    if (entry.progress === "ffmpeg" && located.has("ffprobe")) {
      const probe = jarvis.process.run({ executable: located.get("ffprobe"), arguments: expand(durationTemplate, input), directory, output: "text" });
      signal.onCancel(() => probe.cancel());
      const result2 = await probe.result.catch(() => void 0);
      duration = result2 && result2.exitCode === 0 ? parseDuration(result2.stdout ?? "") : void 0;
    }
    if (signal.cancelled) throw cancelledError();
    const produced = entry.namesOutputItself ? `${stemOf(inputName)}.${step.to}` : output;
    const run = jarvis.process.run({
      executable,
      arguments: expand(step.conversion.template, input, entry.namesOutputItself ? void 0 : output),
      directory,
      onLine: (line) => {
        const fraction = entry.progress === "ffmpeg" ? ffmpegFraction(line, duration) : entry.progress === "avconvert" ? avconvertFraction(line) : void 0;
        if (fraction !== void 0) onFraction(fraction);
      }
    });
    signal.onCancel(() => run.cancel());
    let result;
    try {
      result = await run.result;
    } catch (error) {
      if (signal.cancelled) throw cancelledError();
      if (error instanceof JarvisError && error.code === "host.failure") throw new FileFailure(`${entry.name} \u6CA1\u8DD1\u5B8C\uFF1A${error.message}`);
      throw error;
    }
    if (signal.cancelled) throw cancelledError();
    if (result.exitCode !== 0) {
      if (brokenInstall.test(result.stderr)) throw new FileFailure(`${entry.name} \u8D77\u4E0D\u6765\uFF1A\u5B83\u4F9D\u8D56\u7684\u5E93\u88AB Homebrew \u5347\u7EA7\u6362\u6389\u4E86\uFF0C\u5728\u300C\u8BBE\u7F6E \xB7 \u6587\u4EF6\u300D\u91CC\u4FEE\u590D\u5B83`);
      const line = lastErrorLine(result.stderr);
      throw new FileFailure(line ? `${entry.name}\uFF1A${line}` : `${entry.name} \u9000\u51FA\u7801 ${result.exitCode}`);
    }
    return produced;
  }
  async function convertFiles(request, progress, signal, located) {
    const target = request.action.startsWith("to-") ? formatById(request.action.slice(3)) : void 0;
    if (!target) throw new JarvisError({ code: "invalid.argument", message: `\u4E0D\u8BA4\u8BC6\u7684\u52A8\u4F5C ${request.action}` });
    const available = new Set(located.keys());
    const outputs = [];
    const failures = [];
    const taken = /* @__PURE__ */ new Set();
    const total = request.files.length;
    const fractions = request.files.map(() => 0);
    let lastReport = 0;
    let lastReported = -1;
    const report = (index, fraction, force = false) => {
      fractions[index] = fraction;
      const now = Date.now();
      if (!force && now - lastReport < 100 && Math.abs(fraction - lastReported) < 0.05) return;
      lastReport = now;
      lastReported = fraction;
      const overall = fractions.reduce((sum, value) => sum + value, 0) / total;
      progress({ fraction: overall, message: `\u7B2C ${index + 1} / ${total} \u4E2A\uFF1A${request.files[index].name}`, files: [{ index, fraction }] });
    };
    for (const [index, file] of request.files.entries()) {
      if (signal.cancelled) throw cancelledError();
      report(index, 0, true);
      try {
        outputs.push(await convertOne(file, target.id, available, located, request.directory, taken, signal, (fraction) => report(index, fraction)));
        report(index, 1, true);
      } catch (error) {
        if (error instanceof FileFailure) {
          failures.push(`${file.name}\uFF1A${error.message}`);
          report(index, 1, true);
          continue;
        }
        throw error;
      }
    }
    if (outputs.length === 0 && failures.length > 0) {
      throw new JarvisError({ code: "host.failure", message: failures.slice(0, 3).join("\n") });
    }
    return { outputs, message: failures.length > 0 ? `${failures.length} \u4E2A\u6CA1\u8F6C\u6210\uFF1A${failures[0]}` : void 0 };
  }
  async function convertOne(file, target, available, located, directory, taken, signal, onFraction) {
    const source = formatOfExtension(file.extension);
    if (!source) throw new FileFailure(`\u8BA4\u4E0D\u51FA .${file.extension} \u662F\u4EC0\u4E48\u683C\u5F0F`);
    const steps = plan(source.id, target, available);
    if (!steps) throw new FileFailure(`\u6CA1\u6709\u80FD\u628A ${source.title} \u8F6C\u6210 ${formatById(target)?.title ?? target} \u7684\u5DE5\u5177\uFF08${toolsHint(target)}\uFF09`);
    let input = { file: file.file };
    let inputName = file.name;
    let produced = "";
    for (const [index, step] of steps.entries()) {
      const isLast = index === steps.length - 1;
      const namesItself = tool(step.conversion.tool).namesOutputItself === true;
      let name;
      if (isLast && namesItself) {
        name = `${stemOf(inputName)}.${step.to}`;
        if (taken.has(name.toLowerCase())) throw new FileFailure(`\u540C\u4E00\u6279\u91CC\u5DF2\u7ECF\u6709\u300C${name}\u300D\uFF08LibreOffice \u4E0D\u8BA9\u53E6\u8D77\u540D\u5B57\uFF09`);
        taken.add(name.toLowerCase());
      } else {
        name = isLast ? outputName(file.name, step.to, taken) : `${stemOf(file.name)}.${step.to}`;
      }
      const share = 1 / steps.length;
      produced = await runStep(step, input, inputName, name, located, directory, signal, (fraction) => onFraction(index * share + fraction * share));
      input = { output: produced };
      inputName = produced;
    }
    return produced;
  }
  function toolsHint(target) {
    const family = formatById(target)?.family;
    if (family === "video" || family === "audio") return "\u88C5 FFmpeg \u80FD\u8F6C\u66F4\u591A\u5F71\u97F3\u683C\u5F0F";
    if (family === "office" || target === "pdf") return "\u88C5 LibreOffice \u80FD\u8F6C\u529E\u516C\u6587\u6863";
    if (target === "md" || target === "epub") return "\u88C5 pandoc \u80FD\u8F6C Markdown \u4E0E EPUB";
    return "\u5728\u300C\u8BBE\u7F6E \xB7 \u6587\u4EF6\u300D\u91CC\u770B\u770B\u7F3A\u54EA\u4E2A\u5DE5\u5177";
  }
  var convertEngine = {
    async describe(context) {
      const located = await locateTools(context.preferences ?? {});
      return describeActions(new Set(located.keys()));
    },
    async run(request, context, progress, signal) {
      const located = await locateTools(context.preferences ?? {});
      return convertFiles(request, progress, signal, located);
    }
  };

  // extensions/file-convert/src/index.ts
  defineExtension({
    services: {
      convert: convertEngine
    }
  });
})();
