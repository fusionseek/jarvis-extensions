// jarvis-extension bundle · media-info@1.0.0 · sdk 2.14.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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

  // sdk/src/services.ts
  var fileDetailsLimits = {
    /** 段数。 */
    sections: 16,
    /** 每段的行数。 */
    rows: 80,
    /** 段标题的字数。 */
    title: 32,
    /** 标签的字数。 */
    label: 40,
    /** 值的字数。 */
    value: 500,
    /** `notice` 的字数。 */
    notice: 200,
    /** `describe` 里扩展名的个数。 */
    extensions: 128
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

  // extensions/media-info/src/claims.ts
  var claimedCategories = ["video", "audio"];
  var claimedExtensions = [
    // Matroska 家族与 WebM
    "mkv",
    "mka",
    "mks",
    "webm",
    // Flash、AVI、Windows Media
    "flv",
    "f4v",
    "avi",
    "wmv",
    "wma",
    "asf",
    // MPEG 传输流 / 节目流（蓝光、DVD）
    "ts",
    "mts",
    "m2ts",
    "vob",
    // Ogg 家族
    "ogg",
    "ogv",
    "oga",
    "opus",
    // 无损与各家的音频
    "flac",
    "ape",
    "wv",
    "dts",
    "ac3",
    "eac3",
    "mpc",
    // RealMedia、专业封装、手机
    "rm",
    "rmvb",
    "mxf",
    "3gp",
    "3g2",
    "amr",
    // Apple 与常见的那几种
    "caf",
    "aiff",
    "aif",
    "m4v",
    "m4a",
    "mp4",
    "mov",
    "mp3",
    "aac",
    "wav"
  ];
  function describeClaims() {
    const extensions = [...new Set(claimedExtensions.map((extension) => extension.toLowerCase()))].slice(0, fileDetailsLimits.extensions);
    return { categories: [...claimedCategories], extensions };
  }

  // extensions/media-info/src/failures.ts
  var MediaReadFailure = class extends Error {
    /**
     * @param kind 哪一种读不出。
     */
    constructor(kind) {
      super(kind);
      this.kind = kind;
      this.name = "MediaReadFailure";
    }
  };

  // extensions/media-info/src/units.ts
  function numberOf(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
    if (typeof value !== "string") return void 0;
    const text2 = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(text2)) return void 0;
    const parsed = Number(text2);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  function positive(value) {
    const parsed = numberOf(value);
    return parsed !== void 0 && parsed > 0 ? parsed : void 0;
  }
  function textOf(value) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value !== "string") return void 0;
    const text2 = value.trim();
    return text2.length > 0 ? text2 : void 0;
  }
  function grouped(value) {
    const rounded = Math.round(Math.abs(value));
    const digits = String(rounded);
    let out = "";
    for (let index = 0; index < digits.length; index += 1) {
      if (index > 0 && (digits.length - index) % 3 === 0) out += " ";
      out += digits[index];
    }
    return value < 0 && rounded !== 0 ? `-${out}` : out;
  }
  function trimZeros(text2) {
    return text2.indexOf(".") === -1 ? text2 : text2.replace(/0+$/, "").replace(/\.$/, "");
  }
  function bitRateText(bitsPerSecond) {
    if (bitsPerSecond < 1e3) return `${Math.round(bitsPerSecond)} b/s`;
    const kilobits = bitsPerSecond / 1e3;
    if (Math.round(kilobits) < 1e4) return `${grouped(kilobits)} kb/s`;
    const megabits = bitsPerSecond / 1e6;
    return megabits < 99.95 ? `${megabits.toFixed(1)} Mb/s` : `${grouped(megabits)} Mb/s`;
  }
  function durationText(seconds) {
    const milliseconds = Math.round(seconds * 1e3);
    if (milliseconds < 1e3) return `${milliseconds} \u6BEB\u79D2`;
    if (milliseconds < 6e4) {
      const whole = Math.floor(milliseconds / 1e3);
      const rest = milliseconds % 1e3;
      return rest > 0 ? `${whole} \u79D2 ${rest} \u6BEB\u79D2` : `${whole} \u79D2`;
    }
    const total = Math.round(milliseconds / 1e3);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const secs = total % 60;
    const parts2 = [];
    if (hours > 0) parts2.push(`${hours} \u5C0F\u65F6`);
    if (minutes > 0 || hours > 0 && secs > 0) parts2.push(`${minutes} \u5206`);
    if (secs > 0) parts2.push(`${secs} \u79D2`);
    return parts2.join(" ");
  }
  function timestampText(seconds) {
    const milliseconds = Math.max(0, Math.round(seconds * 1e3));
    const hours = Math.floor(milliseconds / 36e5);
    const minutes = Math.floor(milliseconds % 36e5 / 6e4);
    const secs = Math.floor(milliseconds % 6e4 / 1e3);
    const rest = milliseconds % 1e3;
    const pad = (value, width) => String(value).padStart(width, "0");
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(rest, 3)}`;
  }
  function samplingRateText(hertz) {
    if (hertz < 1e3) return `${Math.round(hertz)} Hz`;
    const kilohertz = hertz / 1e3;
    const text2 = Number.isInteger(kilohertz) ? kilohertz.toFixed(1) : trimZeros(kilohertz.toFixed(3));
    return `${text2} kHz`;
  }
  function frameRateText(framesPerSecond) {
    return `${framesPerSecond.toFixed(3)} fps`;
  }
  function fileSizeText(bytes) {
    if (bytes < 1e3) return `${Math.round(bytes)} \u5B57\u8282`;
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let value = bytes / 1e3;
    let index = 0;
    while (value >= 1e3 && index < units.length - 1) {
      value /= 1e3;
      index += 1;
    }
    const digits = index === 0 ? 0 : index === 1 ? 1 : 2;
    return `${trimZeros(value.toFixed(digits))} ${units[index]}`;
  }
  function resolutionText(width, height) {
    return `${grouped(width)} \xD7 ${grouped(height)} \u50CF\u7D20`;
  }
  function bitDepthText(bits) {
    return `${Math.round(bits)} \u4F4D`;
  }
  var namedAspectRatios = [
    [0.5625, "9:16"],
    [0.75, "3:4"],
    [1, "1:1"],
    [1.25, "5:4"],
    [1.333, "4:3"],
    [1.5, "3:2"],
    [1.6, "16:10"],
    [1.667, "5:3"],
    [1.778, "16:9"],
    [1.85, "1.85:1"],
    [1.896, "1.90:1"],
    [2, "2.00:1"],
    [2.2, "2.20:1"],
    [2.333, "21:9"],
    [2.35, "2.35:1"],
    [2.37, "2.37:1"],
    [2.39, "2.39:1"],
    [2.4, "2.40:1"]
  ];
  function aspectRatioText(ratio) {
    let best;
    for (const entry of namedAspectRatios) {
      const distance = Math.abs(entry[0] - ratio);
      if (distance <= 0.01 && (!best || distance < Math.abs(best[0] - ratio))) best = entry;
    }
    return best ? best[1] : `${ratio.toFixed(2)}:1`;
  }
  var modeNames = {
    CBR: "\u6052\u5B9A",
    VBR: "\u53EF\u53D8",
    ABR: "\u5E73\u5747",
    CFR: "\u6052\u5B9A",
    VFR: "\u53EF\u53D8",
    Lossy: "\u6709\u635F",
    Lossless: "\u65E0\u635F"
  };
  function modeText(value) {
    return value.split(" / ").map((part) => modeNames[part.trim()] ?? part.trim()).filter((part) => part.length > 0).join(" / ");
  }
  var scanNames = {
    Progressive: "\u9010\u884C",
    Interlaced: "\u9694\u884C",
    MBAFF: "\u9694\u884C\uFF08MBAFF\uFF09",
    PAFF: "\u9694\u884C\uFF08PAFF\uFF09",
    Mixed: "\u9010\u884C\u4E0E\u9694\u884C\u6DF7\u5408"
  };
  var scanOrderNames = {
    TFF: "\u4E0A\u573A\u4F18\u5148",
    BFF: "\u4E0B\u573A\u4F18\u5148"
  };
  function scanText(type, order) {
    const name = scanNames[type] ?? type;
    const orderName = order ? scanOrderNames[order] ?? order : void 0;
    return orderName && name !== "\u9010\u884C" ? `${name}\uFF08${orderName}\uFF09` : name;
  }
  var languageNames = {
    en: "\u82F1\u8BED",
    eng: "\u82F1\u8BED",
    zh: "\u4E2D\u6587",
    chi: "\u4E2D\u6587",
    zho: "\u4E2D\u6587",
    cmn: "\u666E\u901A\u8BDD",
    yue: "\u7CA4\u8BED",
    ja: "\u65E5\u8BED",
    jpn: "\u65E5\u8BED",
    ko: "\u97E9\u8BED",
    kor: "\u97E9\u8BED",
    fr: "\u6CD5\u8BED",
    fre: "\u6CD5\u8BED",
    fra: "\u6CD5\u8BED",
    de: "\u5FB7\u8BED",
    ger: "\u5FB7\u8BED",
    deu: "\u5FB7\u8BED",
    es: "\u897F\u73ED\u7259\u8BED",
    spa: "\u897F\u73ED\u7259\u8BED",
    it: "\u610F\u5927\u5229\u8BED",
    ita: "\u610F\u5927\u5229\u8BED",
    ru: "\u4FC4\u8BED",
    rus: "\u4FC4\u8BED",
    pt: "\u8461\u8404\u7259\u8BED",
    por: "\u8461\u8404\u7259\u8BED",
    ar: "\u963F\u62C9\u4F2F\u8BED",
    ara: "\u963F\u62C9\u4F2F\u8BED",
    hi: "\u5370\u5730\u8BED",
    hin: "\u5370\u5730\u8BED",
    th: "\u6CF0\u8BED",
    tha: "\u6CF0\u8BED",
    vi: "\u8D8A\u5357\u8BED",
    vie: "\u8D8A\u5357\u8BED",
    id: "\u5370\u5C3C\u8BED",
    ind: "\u5370\u5C3C\u8BED",
    ms: "\u9A6C\u6765\u8BED",
    may: "\u9A6C\u6765\u8BED",
    msa: "\u9A6C\u6765\u8BED",
    nl: "\u8377\u5170\u8BED",
    dut: "\u8377\u5170\u8BED",
    nld: "\u8377\u5170\u8BED",
    sv: "\u745E\u5178\u8BED",
    swe: "\u745E\u5178\u8BED",
    no: "\u632A\u5A01\u8BED",
    nor: "\u632A\u5A01\u8BED",
    nb: "\u632A\u5A01\u8BED",
    nob: "\u632A\u5A01\u8BED",
    da: "\u4E39\u9EA6\u8BED",
    dan: "\u4E39\u9EA6\u8BED",
    fi: "\u82AC\u5170\u8BED",
    fin: "\u82AC\u5170\u8BED",
    pl: "\u6CE2\u5170\u8BED",
    pol: "\u6CE2\u5170\u8BED",
    cs: "\u6377\u514B\u8BED",
    cze: "\u6377\u514B\u8BED",
    ces: "\u6377\u514B\u8BED",
    hu: "\u5308\u7259\u5229\u8BED",
    hun: "\u5308\u7259\u5229\u8BED",
    tr: "\u571F\u8033\u5176\u8BED",
    tur: "\u571F\u8033\u5176\u8BED",
    el: "\u5E0C\u814A\u8BED",
    gre: "\u5E0C\u814A\u8BED",
    ell: "\u5E0C\u814A\u8BED",
    he: "\u5E0C\u4F2F\u6765\u8BED",
    heb: "\u5E0C\u4F2F\u6765\u8BED",
    uk: "\u4E4C\u514B\u5170\u8BED",
    ukr: "\u4E4C\u514B\u5170\u8BED",
    mul: "\u591A\u8BED\u79CD"
  };
  var regionNames = {
    CN: "\u4E2D\u56FD\u5927\u9646",
    TW: "\u53F0\u6E7E",
    HK: "\u9999\u6E2F",
    SG: "\u65B0\u52A0\u5761",
    Hans: "\u7B80\u4F53",
    Hant: "\u7E41\u4F53",
    US: "\u7F8E\u56FD",
    GB: "\u82F1\u56FD",
    AU: "\u6FB3\u5927\u5229\u4E9A",
    CA: "\u52A0\u62FF\u5927",
    BR: "\u5DF4\u897F",
    PT: "\u8461\u8404\u7259",
    MX: "\u58A8\u897F\u54E5",
    ES: "\u897F\u73ED\u7259",
    "419": "\u62C9\u4E01\u7F8E\u6D32"
  };
  function languageText(code) {
    const text2 = code.trim();
    if (text2.length === 0) return void 0;
    const parts2 = text2.split(/[-_]/);
    const base = parts2[0].toLowerCase();
    if (base === "und" || base === "zxx" || base === "mis") return void 0;
    const name = languageNames[base];
    if (!name) return text2;
    const extras = parts2.slice(1).map((part) => regionNames[part] ?? regionNames[part.toUpperCase()] ?? part);
    return extras.length > 0 ? `${name}\uFF08${extras.join("\uFF0C")}\uFF09` : name;
  }
  function withDetails(main, ...details) {
    if (!main) return void 0;
    const extras = details.filter((detail) => detail !== void 0 && detail.length > 0 && detail !== main);
    return extras.length > 0 ? `${main}\uFF08${extras.join("\uFF0C")}\uFF09` : main;
  }
  function dateText(raw) {
    if (!raw) return void 0;
    let text2 = raw.trim();
    const legacy = /^UTC (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(text2);
    if (legacy) text2 = `${legacy[1]} UTC`;
    const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/.exec(text2);
    if (iso) text2 = `${iso[1]} ${iso[2]} UTC`;
    if (/^(1904|1970)-01-01 00:00:00/.test(text2) || /^0000-/.test(text2)) return void 0;
    return text2.length > 0 ? text2 : void 0;
  }

  // extensions/media-info/src/ffprobe.ts
  function dict(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function tag(tags, name) {
    const source = dict(tags);
    const wanted = name.toLowerCase();
    for (const key of Object.keys(source)) {
      if (key.toLowerCase() === wanted) return textOf(source[key]);
    }
    return void 0;
  }
  var videoFormats = {
    h264: "AVC",
    hevc: "HEVC",
    vvc: "VVC",
    av1: "AV1",
    vp9: "VP9",
    vp8: "VP8",
    mpeg4: "MPEG-4 Visual",
    mpeg2video: "MPEG Video",
    mpeg1video: "MPEG Video",
    h263: "H.263",
    mjpeg: "JPEG",
    prores: "ProRes",
    dnxhd: "VC-3",
    vc1: "VC-1",
    wmv3: "VC-1",
    wmv2: "WMV2",
    wmv1: "WMV1",
    theora: "Theora",
    ffv1: "FFV1",
    cfhd: "CineForm",
    flv1: "Sorenson Spark",
    rv40: "RealVideo 4",
    rv30: "RealVideo 3",
    png: "PNG",
    gif: "GIF",
    bmp: "BMP",
    tiff: "TIFF",
    webp: "WebP",
    rawvideo: "YUV"
  };
  var audioFormats = {
    aac: { format: "AAC" },
    mp3: { format: "MPEG Audio", profile: "Layer 3" },
    mp2: { format: "MPEG Audio", profile: "Layer 2" },
    mp1: { format: "MPEG Audio", profile: "Layer 1" },
    ac3: { format: "AC-3", commercial: "Dolby Digital" },
    eac3: { format: "E-AC-3", commercial: "Dolby Digital Plus" },
    truehd: { format: "MLP FBA", commercial: "Dolby TrueHD" },
    mlp: { format: "MLP" },
    dts: { format: "DTS" },
    flac: { format: "FLAC" },
    alac: { format: "ALAC" },
    opus: { format: "Opus" },
    vorbis: { format: "Vorbis" },
    wmav1: { format: "WMA" },
    wmav2: { format: "WMA" },
    wmapro: { format: "WMA", profile: "Pro" },
    wmalossless: { format: "WMA", profile: "Lossless" },
    amr_nb: { format: "AMR" },
    amr_wb: { format: "AMR", profile: "Wide band" },
    ape: { format: "Monkey's Audio" },
    wavpack: { format: "WavPack" },
    tta: { format: "TTA" },
    speex: { format: "Speex" },
    musepack7: { format: "Musepack SV7" },
    musepack8: { format: "Musepack SV8" },
    cook: { format: "Cooker" }
  };
  var losslessAudio = /* @__PURE__ */ new Set(["flac", "alac", "ape", "wavpack", "tta", "truehd", "mlp", "wmalossless"]);
  var lossyAudio = /* @__PURE__ */ new Set(["aac", "mp3", "mp2", "mp1", "ac3", "eac3", "opus", "vorbis", "wmav1", "wmav2", "wmapro", "amr_nb", "amr_wb", "speex", "musepack7", "musepack8", "cook"]);
  var subtitleFormats = {
    subrip: "SubRip\uFF08SRT\uFF09",
    srt: "SubRip\uFF08SRT\uFF09",
    ass: "ASS",
    ssa: "SSA",
    webvtt: "WebVTT",
    mov_text: "Timed Text",
    hdmv_pgs_subtitle: "PGS",
    dvd_subtitle: "VobSub",
    dvb_subtitle: "DVB Subtitle",
    dvb_teletext: "Teletext",
    eia_608: "EIA-608",
    text: "Text",
    ttml: "TTML",
    microdvd: "MicroDVD"
  };
  var primaryNames = {
    bt709: "BT.709",
    bt2020: "BT.2020",
    smpte170m: "BT.601 NTSC",
    bt470bg: "BT.601 PAL",
    bt470m: "BT.470 System M",
    smpte240m: "SMPTE 240M",
    smpte431: "DCI P3",
    smpte432: "Display P3",
    film: "Film",
    smpte428: "SMPTE 428M"
  };
  var transferNames = {
    bt709: "BT.709",
    smpte2084: "PQ",
    "arib-std-b67": "HLG",
    "iec61966-2-1": "sRGB/sYCC",
    "bt2020-10": "BT.2020 (10-bit)",
    "bt2020-12": "BT.2020 (12-bit)",
    smpte170m: "BT.601",
    gamma22: "BT.470 System M",
    gamma28: "BT.470 System B/G",
    linear: "Linear",
    smpte240m: "SMPTE 240M",
    smpte428: "SMPTE 428M",
    log100: "Logarithmic (100:1)"
  };
  function colorName(table, value) {
    const raw = textOf(value);
    if (!raw || raw === "unknown" || raw === "reserved" || raw === "unspecified") return void 0;
    return table[raw] ?? raw;
  }
  var brandProfiles = {
    isom: "Base Media",
    iso2: "Base Media",
    iso4: "Base Media",
    iso5: "Base Media",
    iso6: "Base Media",
    mp41: "Base Media / Version 1",
    mp42: "Base Media / Version 2",
    qt: "QuickTime",
    M4A: "Apple audio with iTunes info",
    "3gp4": "3GPP Media Release 4",
    "3gp5": "3GPP Media Release 5",
    "3gp6": "3GPP Media Release 6",
    "3g2a": "3GPP2 Media",
    dash: "DASH"
  };
  var containerNames = {
    mpegts: "MPEG-TS",
    mpeg: "MPEG-PS",
    avi: "AVI",
    asf: "Windows Media",
    flv: "Flash Video",
    ogg: "Ogg",
    wav: "Wave",
    w64: "Wave64",
    aiff: "AIFF",
    flac: "FLAC",
    mp3: "MPEG Audio",
    aac: "ADTS",
    ac3: "AC-3",
    eac3: "E-AC-3",
    dts: "DTS",
    ape: "Monkey's Audio",
    wv: "WavPack",
    caf: "CAF",
    mxf: "MXF",
    rm: "RealMedia",
    amr: "AMR",
    mpc: "Musepack",
    mpc8: "Musepack",
    truehd: "MLP",
    tta: "TTA",
    "3gp": "MPEG-4"
  };
  function container(format, extension) {
    const names = textOf(format.format_name) ?? "";
    if (names.startsWith("mov,mp4")) {
      const brand = (tag(format.tags, "major_brand") ?? "").trim();
      return { format: "MPEG-4", profile: brand ? brandProfiles[brand] ?? brand : void 0 };
    }
    if (names.startsWith("matroska")) return { format: extension === "webm" ? "WebM" : "Matroska" };
    const first = names.split(",")[0];
    return { format: containerNames[first] ?? textOf(format.format_long_name) ?? (first || void 0) };
  }
  function rate(value) {
    const text2 = textOf(value);
    if (!text2) return void 0;
    const match = /^(\d+)\/(\d+)$/.exec(text2);
    if (!match) return positive(text2);
    const denominator = Number(match[2]);
    if (denominator === 0) return void 0;
    const result = Number(match[1]) / denominator;
    return result > 0 ? result : void 0;
  }
  function ffprobeProfile(codec, profile, level) {
    let levelText;
    if (level !== void 0 && level > 0) {
      if (codec === "h264") levelText = String(level / 10);
      else if (codec === "hevc") levelText = String(Math.round(level / 30 * 10) / 10);
      else if (codec === "av1") levelText = `${2 + (level >> 2)}.${level & 3}`;
    }
    const pieces = [profile, levelText ? `L${levelText}` : void 0].filter((piece) => piece !== void 0 && piece.length > 0);
    return pieces.length > 0 ? pieces.join("@") : void 0;
  }
  function pixelFormat(value) {
    const format = textOf(value);
    if (!format) return {};
    const depthMatch = /p(\d{2})(?:le|be)?$/.exec(format) ?? /^p0(\d{2})/.exec(format);
    const depth = depthMatch ? Number(depthMatch[1]) : void 0;
    if (/^(yuv|yuvj|yuva|nv12|nv21|p0)/.test(format)) {
      const chroma = /420|nv12|nv21|^p0/.test(format) ? "4:2:0" : /422/.test(format) ? "4:2:2" : /444/.test(format) ? "4:4:4" : /411/.test(format) ? "4:1:1" : /440/.test(format) ? "4:4:0" : void 0;
      return { colorSpace: format.startsWith("yuva") ? "YUVA" : "YUV", chromaSubsampling: chroma, bitDepth: depth ?? 8 };
    }
    if (/^(rgb|bgr|gbr|argb|abgr|rgba|bgra)/.test(format)) return { colorSpace: /a/.test(format.replace(/^gbr/, "")) ? "RGBA" : "RGB", bitDepth: depth ?? 8 };
    if (/^gray/.test(format)) return { colorSpace: "Y", bitDepth: depth ?? 8 };
    return {};
  }
  function scan(fieldOrder) {
    switch (textOf(fieldOrder)) {
      case "progressive":
        return { scanType: "Progressive" };
      case "tt":
      case "bt":
        return { scanType: "Interlaced", scanOrder: "TFF" };
      case "bb":
      case "tb":
        return { scanType: "Interlaced", scanOrder: "BFF" };
      default:
        return {};
    }
  }
  function ffprobeHdr(stream) {
    const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list.map(dict) : [];
    const transfer = textOf(stream.color_transfer);
    const formats = [];
    const dovi = sideData.find((entry) => textOf(entry.side_data_type) === "DOVI configuration record");
    if (dovi) {
      const major = numberOf(dovi.dv_version_major);
      const minor = numberOf(dovi.dv_version_minor);
      const profile = numberOf(dovi.dv_profile);
      const compatibility = numberOf(dovi.dv_bl_signal_compatibility_id);
      const level = numberOf(dovi.dv_level);
      const layers = [numberOf(dovi.bl_present_flag) ? "BL" : void 0, numberOf(dovi.el_present_flag) ? "EL" : void 0, numberOf(dovi.rpu_present_flag) ? "RPU" : void 0].filter((layer) => layer !== void 0).join("+");
      const compatibleWith = compatibility === 1 || compatibility === 6 ? "HDR10" : compatibility === 2 ? "SDR" : compatibility === 4 ? "HLG" : void 0;
      formats.push(
        [
          "Dolby Vision",
          major !== void 0 ? `\u7248\u672C ${major}.${minor ?? 0}` : void 0,
          profile !== void 0 ? `\u914D\u7F6E ${profile}${compatibility ? `.${compatibility}` : ""}` : void 0,
          level ? `\u7EA7\u522B ${level}` : void 0,
          layers || void 0,
          compatibleWith ? `\u517C\u5BB9 ${compatibleWith}` : void 0
        ].filter((piece) => piece !== void 0).join("\uFF0C")
      );
    }
    if (sideData.some((entry) => textOf(entry.side_data_type) === "Mastering display metadata")) {
      formats.push("SMPTE ST 2086\uFF0C\u517C\u5BB9 HDR10");
    } else if (transfer === "smpte2084" && !dovi) {
      formats.push("HDR10\uFF08PQ\uFF09");
    }
    if (transfer === "arib-std-b67" && formats.length === 0) formats.push("HLG");
    return formats.length > 0 ? formats.join(" / ") : void 0;
  }
  function disposition(stream) {
    const flags2 = dict(stream.disposition);
    return { isDefault: numberOf(flags2.default) === 1, isForced: numberOf(flags2.forced) === 1 };
  }
  function streamBitRate(stream) {
    return positive(stream.bit_rate) ?? positive(tag(stream.tags, "BPS")) ?? positive(tag(stream.tags, "BPS-eng"));
  }
  function video(stream) {
    const codec = textOf(stream.codec_name) ?? "";
    const pixels = pixelFormat(stream.pix_fmt);
    const width = positive(stream.width);
    const height = positive(stream.height);
    const display = textOf(stream.display_aspect_ratio);
    const sar = rate(textOf(stream.sample_aspect_ratio)?.replace(":", "/"));
    const average = textOf(stream.avg_frame_rate);
    const frames = textOf(stream.avg_frame_rate) && rate(average) ? average : textOf(stream.r_frame_rate);
    const fraction = frames && /^(\d+)\/(\d+)$/.exec(frames);
    const tagString = textOf(stream.codec_tag_string);
    return {
      format: videoFormats[codec] ?? textOf(stream.codec_long_name) ?? (codec || void 0),
      profile: ffprobeProfile(codec, textOf(stream.profile), numberOf(stream.level)),
      codecId: tagString && !tagString.startsWith("[") ? tagString : void 0,
      bitRate: streamBitRate(stream),
      width,
      height,
      aspectRatio: display && /^\d+:\d+$/.test(display) && !display.startsWith("0:") ? display : width && height ? aspectRatioText(width / height * (sar ?? 1)) : void 0,
      frameRate: rate(frames),
      frameRateFraction: fraction && fraction[2] !== "1" ? `${fraction[1]}/${fraction[2]}` : void 0,
      colorSpace: pixels.colorSpace,
      chromaSubsampling: pixels.chromaSubsampling,
      bitDepth: positive(stream.bits_per_raw_sample) ?? pixels.bitDepth,
      ...scan(stream.field_order),
      hdr: ffprobeHdr(stream),
      primaries: colorName(primaryNames, stream.color_primaries),
      transfer: colorName(transferNames, stream.color_transfer),
      language: tag(stream.tags, "language"),
      title: tag(stream.tags, "title")
    };
  }
  function audio(stream) {
    const codec = textOf(stream.codec_name) ?? "";
    const known = audioFormats[codec] ?? (codec.startsWith("pcm_") ? { format: "PCM" } : codec.startsWith("dsd_") ? { format: "DSD" } : codec.startsWith("adpcm_") ? { format: "ADPCM" } : void 0);
    const profile = textOf(stream.profile);
    const lossless = losslessAudio.has(codec) || codec.startsWith("pcm_") || codec.startsWith("dsd_") || codec === "dts" && profile === "DTS-HD MA";
    return {
      format: known?.format ?? textOf(stream.codec_long_name) ?? (codec || void 0),
      profile: profile ?? known?.profile,
      commercial: known?.commercial,
      bitRate: streamBitRate(stream),
      channels: positive(stream.channels),
      layout: textOf(stream.channel_layout),
      samplingRate: positive(stream.sample_rate),
      bitDepth: positive(stream.bits_per_raw_sample) ?? positive(stream.bits_per_sample),
      compression: lossless ? "Lossless" : lossyAudio.has(codec) ? "Lossy" : void 0,
      language: tag(stream.tags, "language"),
      title: tag(stream.tags, "title"),
      ...disposition(stream)
    };
  }
  function subtitle(stream) {
    const codec = textOf(stream.codec_name) ?? "";
    return {
      format: subtitleFormats[codec] ?? textOf(stream.codec_long_name) ?? (codec || void 0),
      language: tag(stream.tags, "language"),
      title: tag(stream.tags, "title"),
      ...disposition(stream)
    };
  }
  function picture(stream) {
    const codec = textOf(stream.codec_name) ?? "";
    return {
      format: videoFormats[codec] ?? (codec.toUpperCase() || void 0),
      width: positive(stream.width),
      height: positive(stream.height)
    };
  }
  function parseFFprobe(output, extension) {
    let document;
    try {
      document = JSON.parse(output);
    } catch {
      throw new MediaReadFailure("malformed");
    }
    if (document === null || typeof document !== "object" || Array.isArray(document)) throw new MediaReadFailure("malformed");
    const root = document;
    const format = dict(root.format);
    const streams = (Array.isArray(root.streams) ? root.streams : []).map(dict);
    if (Object.keys(format).length === 0 && streams.length === 0) throw new MediaReadFailure("unrecognized");
    const report = { general: {}, videos: [], audios: [], texts: [], images: [], chapters: [] };
    for (const stream of streams) {
      switch (textOf(stream.codec_type)) {
        case "video":
          if (numberOf(dict(stream.disposition).attached_pic) === 1) report.images.push(picture(stream));
          else report.videos.push(video(stream));
          break;
        case "audio":
          report.audios.push(audio(stream));
          break;
        case "subtitle":
          report.texts.push(subtitle(stream));
          break;
      }
    }
    const named = container(format, extension);
    const general2 = {
      format: named.format,
      profile: named.profile,
      fileSize: numberOf(format.size),
      duration: positive(format.duration),
      bitRate: positive(format.bit_rate),
      encodedDate: tag(format.tags, "creation_time"),
      application: tag(format.tags, "encoder"),
      title: tag(format.tags, "title"),
      artist: tag(format.tags, "artist") ?? tag(format.tags, "album_artist"),
      album: tag(format.tags, "album")
    };
    report.general = general2;
    const chapters = [];
    for (const chapter of (Array.isArray(root.chapters) ? root.chapters : []).map(dict)) {
      const start = numberOf(chapter.start_time);
      if (start !== void 0) chapters.push({ start, title: tag(chapter.tags, "title") });
    }
    report.chapters = chapters;
    return report;
  }

  // extensions/media-info/src/mediainfo.ts
  function yes(value) {
    return textOf(value) === "Yes";
  }
  function parts(value) {
    if (typeof value !== "string" || value.trim().length === 0) return [];
    return value.split("/").map((part) => part.trim());
  }
  function videoProfile(track) {
    const profile = textOf(track.Format_Profile);
    const level = textOf(track.Format_Level);
    const tier = textOf(track.Format_Tier);
    const pieces = [profile, level ? `L${level}` : void 0, tier].filter((piece) => piece !== void 0);
    return pieces.length > 0 ? pieces.join("@") : void 0;
  }
  function hdrFormat(track) {
    const formats = parts(track.HDR_Format);
    if (formats.length === 0) return void 0;
    const versions = parts(track.HDR_Format_Version);
    const profiles = parts(track.HDR_Format_Profile);
    const levels = parts(track.HDR_Format_Level);
    const settings = parts(track.HDR_Format_Settings);
    const compatibility = parts(track.HDR_Format_Compatibility);
    return formats.map((format, index) => {
      const profile = profiles[index] ? levels[index] ? `${profiles[index]}.${levels[index]}` : profiles[index] : void 0;
      return [
        format,
        versions[index] ? `\u7248\u672C ${versions[index]}` : void 0,
        profile,
        settings[index] || void 0,
        compatibility[index] ? `\u517C\u5BB9 ${compatibility[index]}` : void 0
      ].filter((piece) => piece !== void 0 && piece.length > 0).join("\uFF0C");
    }).filter((piece) => piece.length > 0).join(" / ");
  }
  var chapterKey = /^_(\d{2,})_(\d{2})_(\d{2})_(\d{3})$/;
  var chapterLanguage = /^(?:[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)?:(?=.)/;
  function menuChapters(track) {
    const chapters = [];
    const extra = track.extra && typeof track.extra === "object" ? track.extra : {};
    for (const source of [track, extra]) {
      for (const key of Object.keys(source)) {
        const match = chapterKey.exec(key);
        if (!match) continue;
        const start = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1e3;
        const raw = textOf(source[key]);
        chapters.push({ start, title: raw ? raw.replace(chapterLanguage, "").trim() : void 0 });
      }
    }
    return chapters;
  }
  function general(track) {
    const version = textOf(track.Format_Version);
    return {
      format: textOf(track.Format),
      profile: textOf(track.Format_Profile) ?? (version ? `\u7248\u672C ${version}` : void 0),
      fileSize: numberOf(track.FileSize),
      duration: positive(track.Duration),
      bitRate: positive(track.OverallBitRate),
      bitRateMode: textOf(track.OverallBitRate_Mode),
      frameRate: positive(track.FrameRate),
      encodedDate: textOf(track.Encoded_Date),
      application: textOf(track.Encoded_Application),
      library: textOf(track.Encoded_Library),
      title: textOf(track.Title) ?? textOf(track.Movie) ?? textOf(track.Track),
      artist: textOf(track.Performer) ?? textOf(track.Album_Performer),
      album: textOf(track.Album)
    };
  }
  function video2(track) {
    const numerator = textOf(track.FrameRate_Num);
    const denominator = textOf(track.FrameRate_Den);
    const aspect = numberOf(track.DisplayAspectRatio);
    return {
      format: textOf(track.Format),
      profile: videoProfile(track),
      codecId: textOf(track.CodecID),
      bitRate: positive(track.BitRate),
      nominalBitRate: positive(track.BitRate_Nominal),
      bitRateMode: textOf(track.BitRate_Mode),
      width: positive(track.Width),
      height: positive(track.Height),
      aspectRatio: aspect !== void 0 && aspect > 0 ? aspect : textOf(track.DisplayAspectRatio),
      frameRate: positive(track.FrameRate),
      frameRateFraction: numerator && denominator && denominator !== "1" ? `${numerator}/${denominator}` : void 0,
      frameRateMode: textOf(track.FrameRate_Mode),
      colorSpace: textOf(track.ColorSpace),
      chromaSubsampling: textOf(track.ChromaSubsampling),
      bitDepth: positive(track.BitDepth),
      scanType: textOf(track.ScanType),
      scanOrder: textOf(track.ScanOrder),
      hdr: hdrFormat(track),
      primaries: textOf(track.colour_primaries),
      transfer: textOf(track.transfer_characteristics),
      language: textOf(track.Language),
      title: textOf(track.Title)
    };
  }
  function audio2(track) {
    const format = textOf(track.Format);
    const profile = [textOf(track.Format_Profile), textOf(track.Format_AdditionalFeatures)].filter((piece) => piece !== void 0).join(" ");
    const channels = textOf(track.Channels);
    return {
      format,
      profile: profile.length > 0 ? profile : void 0,
      commercial: textOf(track.Format_Commercial_IfAny),
      bitRate: positive(track.BitRate),
      nominalBitRate: positive(track.BitRate_Nominal),
      bitRateMode: textOf(track.BitRate_Mode),
      channels: channels === void 0 ? void 0 : numberOf(channels) ?? channels,
      layout: textOf(track.ChannelLayout),
      samplingRate: positive(track.SamplingRate),
      bitDepth: positive(track.BitDepth),
      compression: textOf(track.Compression_Mode),
      language: textOf(track.Language),
      title: textOf(track.Title),
      isDefault: yes(track.Default),
      isForced: yes(track.Forced)
    };
  }
  function text(track) {
    return {
      format: textOf(track.Format),
      language: textOf(track.Language),
      title: textOf(track.Title),
      isDefault: yes(track.Default),
      isForced: yes(track.Forced)
    };
  }
  function image(track) {
    return {
      format: textOf(track.Format),
      width: positive(track.Width),
      height: positive(track.Height),
      bitDepth: positive(track.BitDepth)
    };
  }
  function parseMediaInfo(output) {
    let document;
    try {
      document = JSON.parse(output);
    } catch {
      throw new MediaReadFailure("malformed");
    }
    const media = document && typeof document === "object" ? document.media : void 0;
    if (media === null) throw new MediaReadFailure("unrecognized");
    if (!media || typeof media !== "object") throw new MediaReadFailure("malformed");
    const raw = media.track;
    const tracks = (Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : []).filter(
      (track) => track !== null && typeof track === "object"
    );
    const report = { general: {}, videos: [], audios: [], texts: [], images: [], chapters: [] };
    let sawGeneral = false;
    for (const track of tracks) {
      switch (track["@type"]) {
        case "General":
          if (!sawGeneral) report.general = general(track);
          sawGeneral = true;
          break;
        case "Video":
          report.videos.push(video2(track));
          break;
        case "Audio":
          report.audios.push(audio2(track));
          break;
        case "Text":
          report.texts.push(text(track));
          break;
        case "Image":
          report.images.push(image(track));
          break;
        case "Menu":
          report.chapters.push(...menuChapters(track));
          break;
      }
    }
    const streams = report.videos.length + report.audios.length + report.texts.length + report.images.length;
    if (report.general.format === void 0 && streams === 0) throw new MediaReadFailure("unrecognized");
    return report;
  }

  // extensions/media-info/src/report.ts
  var maximumChapterRows = 40;
  var Rows = class {
    constructor() {
      this.rows = [];
    }
    add(label, value) {
      if (value !== void 0 && value.trim().length > 0) this.rows.push({ label, value });
    }
  };
  function numbered(title, index, count) {
    return count > 1 ? `${title} #${index + 1}` : title;
  }
  function bitRateValue(bitRate, nominal, mode) {
    const modeName = mode ? modeText(mode) : void 0;
    if (bitRate !== void 0) return withDetails(bitRateText(bitRate), modeName);
    if (nominal !== void 0) return withDetails(bitRateText(nominal), "\u6807\u79F0", modeName);
    return void 0;
  }
  function channelsValue(channels, layout) {
    if (channels === void 0) return void 0;
    const count = typeof channels === "number" ? `${channels} \u58F0\u9053` : /声道$/.test(channels) ? channels : `${channels} \u58F0\u9053`;
    const layoutName = layout === "M" || layout === "mono" ? "\u5355\u58F0\u9053" : layout === "stereo" ? "\u7ACB\u4F53\u58F0" : layout;
    return withDetails(count, layoutName);
  }
  function flags(rows, facts, siblings) {
    if (facts.isDefault && siblings > 1) rows.add("\u9ED8\u8BA4", "\u662F");
    if (facts.isForced) rows.add("\u5F3A\u5236", "\u662F");
  }
  function languageValue(code) {
    return code ? languageText(code) : void 0;
  }
  function summarySection(general2, firstVideo) {
    const rows = new Rows();
    rows.add("\u683C\u5F0F", withDetails(general2.format, general2.profile));
    rows.add("\u6587\u4EF6\u5927\u5C0F", general2.fileSize !== void 0 ? fileSizeText(general2.fileSize) : void 0);
    rows.add("\u65F6\u957F", general2.duration !== void 0 ? durationText(general2.duration) : void 0);
    rows.add("\u603B\u7801\u7387", bitRateValue(general2.bitRate, void 0, general2.bitRateMode));
    const frameRate = general2.frameRate ?? firstVideo?.frameRate;
    rows.add("\u5E27\u7387", frameRate !== void 0 ? frameRateText(frameRate) : void 0);
    rows.add("\u7F16\u7801\u65E5\u671F", dateText(general2.encodedDate));
    rows.add("\u5199\u5165\u7A0B\u5E8F", general2.application);
    if (general2.library !== general2.application) rows.add("\u7F16\u7801\u5E93", general2.library);
    rows.add("\u6807\u9898", general2.title);
    rows.add("\u827A\u672F\u5BB6", general2.artist);
    rows.add("\u4E13\u8F91", general2.album);
    return { title: "\u6982\u8981", rows: rows.rows };
  }
  function videoSection(video3, index, count) {
    const rows = new Rows();
    rows.add("\u683C\u5F0F", withDetails(video3.format, video3.profile));
    rows.add("\u7F16\u7801 ID", video3.codecId);
    rows.add("\u7801\u7387", bitRateValue(video3.bitRate, video3.nominalBitRate, video3.bitRateMode));
    rows.add("\u5206\u8FA8\u7387", video3.width !== void 0 && video3.height !== void 0 ? resolutionText(video3.width, video3.height) : void 0);
    rows.add("\u663E\u793A\u5BBD\u9AD8\u6BD4", typeof video3.aspectRatio === "number" ? aspectRatioText(video3.aspectRatio) : video3.aspectRatio);
    rows.add(
      "\u5E27\u7387",
      video3.frameRate !== void 0 ? withDetails(frameRateText(video3.frameRate), video3.frameRateFraction, video3.frameRateMode ? modeText(video3.frameRateMode) : void 0) : void 0
    );
    rows.add("\u8272\u5F69\u7A7A\u95F4", video3.colorSpace);
    rows.add("\u8272\u5EA6\u62BD\u6837", video3.chromaSubsampling);
    rows.add("\u4F4D\u6DF1", video3.bitDepth !== void 0 ? bitDepthText(video3.bitDepth) : void 0);
    rows.add("\u626B\u63CF\u65B9\u5F0F", video3.scanType ? scanText(video3.scanType, video3.scanOrder) : void 0);
    rows.add("HDR \u683C\u5F0F", video3.hdr);
    rows.add("\u8272\u5F69\u539F\u8272", video3.primaries);
    rows.add("\u4F20\u8F93\u7279\u6027", video3.transfer);
    rows.add("\u8BED\u8A00", languageValue(video3.language));
    rows.add("\u6807\u9898", video3.title);
    return { title: numbered("\u89C6\u9891", index, count), rows: rows.rows };
  }
  function audioSection(audio3, index, count) {
    const rows = new Rows();
    rows.add("\u683C\u5F0F", withDetails(audio3.format, audio3.profile, audio3.commercial));
    rows.add("\u7801\u7387", bitRateValue(audio3.bitRate, audio3.nominalBitRate, audio3.bitRateMode));
    rows.add("\u58F0\u9053", channelsValue(audio3.channels, audio3.layout));
    rows.add("\u91C7\u6837\u7387", audio3.samplingRate !== void 0 ? samplingRateText(audio3.samplingRate) : void 0);
    rows.add("\u4F4D\u6DF1", audio3.bitDepth !== void 0 ? bitDepthText(audio3.bitDepth) : void 0);
    rows.add("\u538B\u7F29\u6A21\u5F0F", audio3.compression ? modeText(audio3.compression) : void 0);
    rows.add("\u8BED\u8A00", languageValue(audio3.language));
    rows.add("\u6807\u9898", audio3.title);
    flags(rows, audio3, count);
    return { title: numbered("\u97F3\u9891", index, count), rows: rows.rows };
  }
  function textSection(text2, index, count) {
    const rows = new Rows();
    rows.add("\u683C\u5F0F", text2.format);
    rows.add("\u8BED\u8A00", languageValue(text2.language));
    rows.add("\u6807\u9898", text2.title);
    flags(rows, text2, count);
    return { title: numbered("\u5B57\u5E55", index, count), rows: rows.rows };
  }
  function imageSection(image2, index, count) {
    const rows = new Rows();
    rows.add("\u683C\u5F0F", image2.format);
    rows.add("\u5206\u8FA8\u7387", image2.width !== void 0 && image2.height !== void 0 ? resolutionText(image2.width, image2.height) : void 0);
    rows.add("\u4F4D\u6DF1", image2.bitDepth !== void 0 ? bitDepthText(image2.bitDepth) : void 0);
    return { title: numbered("\u56FE\u50CF", index, count), rows: rows.rows };
  }
  function chapterSection(chapters) {
    if (chapters.length === 0) return void 0;
    const sorted = [...chapters].sort((a, b) => a.start - b.start);
    const shown = sorted.length > maximumChapterRows ? sorted.slice(0, maximumChapterRows - 1) : sorted;
    const rows = shown.map((chapter, index) => ({
      label: timestampText(chapter.start),
      value: chapter.title && chapter.title.trim().length > 0 ? chapter.title.trim() : `\u7B2C ${index + 1} \u7AE0`
    }));
    if (shown.length < sorted.length) {
      rows.push({ label: "\u5176\u4F59", value: `\u5171 ${sorted.length} \u7AE0\uFF0C\u8FD9\u91CC\u53EA\u5217\u51FA\u524D ${shown.length} \u7AE0` });
    }
    return { title: "\u7AE0\u8282", rows };
  }
  function buildSections(report) {
    const summary = summarySection(report.general, report.videos[0]);
    const tracks = [
      ...report.videos.map((video3, index) => videoSection(video3, index, report.videos.length)),
      ...report.audios.map((audio3, index) => audioSection(audio3, index, report.audios.length)),
      ...report.texts.map((text2, index) => textSection(text2, index, report.texts.length)),
      ...report.images.map((image2, index) => imageSection(image2, index, report.images.length))
    ].filter((section) => section.rows.length > 0);
    const chapters = chapterSection(report.chapters);
    const fixed = [summary, chapters].filter((section) => section !== void 0 && section.rows.length > 0);
    const limit = fileDetailsLimits.sections;
    if (fixed.length + tracks.length <= limit) {
      return [...summary.rows.length > 0 ? [summary] : [], ...tracks, ...chapters ? [chapters] : []];
    }
    const room = limit - fixed.length - 1;
    const kept = tracks.slice(0, room);
    const rest = tracks.slice(room);
    const maximumRows = fileDetailsLimits.rows;
    const restRows = rest.slice(0, rest.length > maximumRows ? maximumRows - 1 : rest.length).map((section) => ({
      label: section.title,
      value: section.rows.slice(0, 4).map((row) => row.value).join("\uFF0C")
    }));
    if (rest.length > restRows.length) restRows.push({ label: "\u2026\u2026", value: `\u8FD8\u6709 ${rest.length - restRows.length} \u6761\u8F68\u9053\u6CA1\u5217\u51FA` });
    return [
      ...summary.rows.length > 0 ? [summary] : [],
      ...kept,
      { title: "\u5176\u4F59\u8F68\u9053", rows: restRows },
      ...chapters ? [chapters] : []
    ];
  }
  function flatten(text2) {
    return text2.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  }
  function truncate(text2, limit) {
    if (text2.length <= limit) return text2;
    let cut = limit - 1;
    const code = text2.charCodeAt(cut - 1);
    if (code >= 55296 && code <= 56319) cut -= 1;
    return `${text2.slice(0, cut)}\u2026`;
  }
  function clampResult(sections, notice) {
    const limits = fileDetailsLimits;
    const clamped = [];
    for (const section of sections) {
      const rows = [];
      for (const row of section.rows) {
        const label = truncate(flatten(row.label), limits.label);
        const value = truncate(flatten(row.value), limits.value);
        if (label.length > 0 && value.length > 0) rows.push({ label, value });
        if (rows.length === limits.rows) break;
      }
      const title = truncate(flatten(section.title), limits.title);
      if (rows.length > 0 && title.length > 0) clamped.push({ title, rows });
      if (clamped.length === limits.sections) break;
    }
    const result = { sections: clamped };
    const note = notice ? truncate(flatten(notice), limits.notice) : "";
    if (note.length > 0) result.notice = note;
    return result;
  }

  // extensions/media-info/src/engine.ts
  var mediainfoTool = {
    name: "mediainfo",
    formula: "media-info",
    preference: "mediainfoPath",
    arguments: (handle) => ["--Output=JSON", { file: handle }],
    parse: (output) => parseMediaInfo(output)
  };
  var ffprobeTool = {
    name: "ffprobe",
    formula: "ffmpeg",
    preference: "ffprobePath",
    arguments: (handle) => ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", { file: handle }],
    parse: (output, extension) => parseFFprobe(output, extension)
  };
  var mediaTools = [mediainfoTool, ffprobeTool];
  var missingToolsMessage = "\u6CA1\u627E\u5230 mediainfo \u6216 ffprobe\uFF1A\u5728\u300C\u8BBE\u7F6E \xB7 \u6587\u4EF6 \xB7 \u6587\u4EF6\u8BE6\u60C5\u300D\u91CC\u88C5\u4E00\u4E2A\uFF08brew install media-info \u6216 brew install ffmpeg\uFF09";
  var ffprobeNotice = "\u7528\u7684\u662F ffprobe\uFF1B\u88C5\u4E0A MediaInfo \u547D\u4EE4\u884C\uFF08brew install media-info\uFF09\u80FD\u8BFB\u51FA\u66F4\u591A\u3002";
  var ToolFailure = class extends Error {
    constructor(tool, kind, message, reason) {
      super(message);
      this.tool = tool;
      this.kind = kind;
      this.reason = reason;
      this.name = "ToolFailure";
    }
  };
  var brokenInstall = /Library not loaded|Symbol not found|dyld\[\d+\]/;
  function lastErrorLine(stderr) {
    const lines = stderr.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    const last = lines[lines.length - 1];
    if (!last) return void 0;
    const cut = last.lastIndexOf(": ");
    const tail = cut >= 0 ? last.slice(cut + 2).trim() : last;
    const text2 = tail.length > 0 ? tail : last;
    return text2.length > 160 ? `${text2.slice(0, 159)}\u2026` : text2;
  }
  function failureOf(tool, result) {
    if (brokenInstall.test(result.stderr)) {
      return new ToolFailure(
        tool,
        "broken",
        `${tool.name} \u8D77\u4E0D\u6765\uFF1A\u5B83\u4F9D\u8D56\u7684\u5E93\u88AB Homebrew \u5347\u7EA7\u6362\u6389\u4E86\u3002\u5728\u7EC8\u7AEF\u91CC\u8DD1 brew upgrade ${tool.formula}\uFF08\u4E0D\u884C\u5C31 brew reinstall ${tool.formula}\uFF09\u518D\u8BD5\u3002`,
        "\u5B83\u8D77\u4E0D\u6765"
      );
    }
    const line = lastErrorLine(result.stderr);
    return new ToolFailure(
      tool,
      "failed",
      line ? `${tool.name} \u8BFB\u4E0D\u4E86\u8FD9\u4E2A\u6587\u4EF6\uFF1A${line}` : `${tool.name} \u8BFB\u4E0D\u4E86\u8FD9\u4E2A\u6587\u4EF6\uFF08\u9000\u51FA\u7801 ${result.exitCode}\uFF09`,
      `\u9000\u51FA\u7801 ${result.exitCode}`
    );
  }
  function parseFailureOf(tool, kind) {
    return kind === "malformed" ? new ToolFailure(tool, kind, `${tool.name} \u4EA4\u56DE\u7684\u4E0D\u662F JSON\uFF1A\u5B83\u7684\u7248\u672C\u53EF\u80FD\u592A\u65E7\uFF0C\u8DD1\u4E00\u6B21 brew upgrade ${tool.formula} \u518D\u8BD5\u3002`, "\u8F93\u51FA\u4E0D\u662F JSON") : new ToolFailure(tool, kind, `${tool.name} \u8BA4\u4E0D\u51FA\u8FD9\u4E2A\u6587\u4EF6\u7684\u683C\u5F0F\uFF1A\u5B83\u53EF\u80FD\u4E0D\u662F\u5F71\u97F3\u6587\u4EF6\uFF0C\u6216\u8005\u5DF2\u7ECF\u635F\u574F\u3002`, "\u8BA4\u4E0D\u51FA\u683C\u5F0F");
  }
  function cancelledError() {
    return new JarvisError({ code: "cancelled", message: "\u5DF2\u53D6\u6D88" });
  }
  async function read(tool, executable, handle, extension, signal) {
    const run = jarvis.process.run({ executable, arguments: tool.arguments(handle), output: "text" });
    signal.onCancel(() => run.cancel());
    let result;
    try {
      result = await run.result;
    } catch (error) {
      if (signal.cancelled) throw cancelledError();
      if (error instanceof JarvisError && error.code === "host.failure") {
        throw new ToolFailure(tool, "failed", `${tool.name} \u6CA1\u8DD1\u5B8C\uFF1A${error.message}`, "\u6CA1\u8DD1\u5B8C");
      }
      throw error;
    }
    if (signal.cancelled) throw cancelledError();
    if (result.exitCode !== 0) throw failureOf(tool, result);
    try {
      return tool.parse(result.stdout ?? "", extension);
    } catch (error) {
      if (error instanceof MediaReadFailure) throw parseFailureOf(tool, error.kind);
      throw error;
    }
  }
  function finalMessage(failures) {
    if (failures.length > 1 && failures.every((failure) => failure.kind === "unrecognized")) {
      return `${failures.map((failure) => failure.tool.name).join(" \u4E0E ")} \u90FD\u8BA4\u4E0D\u51FA\u8FD9\u4E2A\u6587\u4EF6\u7684\u683C\u5F0F\uFF1A\u5B83\u53EF\u80FD\u4E0D\u662F\u5F71\u97F3\u6587\u4EF6\uFF0C\u6216\u8005\u5DF2\u7ECF\u635F\u574F\u3002`;
    }
    return failures[0].message;
  }
  async function inspectFile(request, signal, tools = mediaTools, preferences = {}) {
    const file = request.files[0];
    if (!file) throw new JarvisError({ code: "invalid.argument", message: "\u6CA1\u6709\u8981\u8BFB\u7684\u6587\u4EF6" });
    if (file.folder) throw new JarvisError({ code: "invalid.argument", message: "\u5A92\u4F53\u4FE1\u606F\u4E0D\u8BFB\u6587\u4EF6\u5939" });
    const failures = [];
    for (const tool of tools) {
      if (signal.cancelled) throw cancelledError();
      const chosen = typeof preferences[tool.preference] === "string" ? preferences[tool.preference].trim() : "";
      const where = await jarvis.process.locate(chosen || tool.name);
      if (signal.cancelled) throw cancelledError();
      if (where.path === null) {
        if (chosen) {
          failures.push(new ToolFailure(tool, "failed", `\u8BBE\u7F6E\u91CC\u9009\u7684 ${tool.name} \u4E0D\u53EF\u7528\uFF1A${chosen}\u3002\u5728\u300C\u8BBE\u7F6E \xB7 \u6587\u4EF6\u300D\u91CC\u6E05\u9664\u6216\u91CD\u65B0\u9009\u62E9\u3002`, "\u9009\u7684\u8DEF\u5F84\u4E0D\u53EF\u7528"));
        }
        continue;
      }
      try {
        const report = await read(tool, where.path, file.file, file.extension, signal);
        const sections = buildSections(report);
        if (sections.length === 0) throw parseFailureOf(tool, "unrecognized");
        const notice = tool.name === "ffprobe" ? failures.length > 0 ? `${failures[0].tool.name} \u6CA1\u8BFB\u51FA\u6765\uFF08${failures[0].reason}\uFF09\uFF0C\u8FD9\u6B21\u7528\u7684\u662F ffprobe\u3002` : ffprobeNotice : void 0;
        return clampResult(sections, notice);
      } catch (error) {
        if (error instanceof ToolFailure) {
          failures.push(error);
          continue;
        }
        throw error;
      }
    }
    if (failures.length === 0) throw new JarvisError({ code: "host.failure", message: missingToolsMessage });
    throw new JarvisError({ code: "host.failure", message: finalMessage(failures) });
  }
  var mediaEngine = {
    describe() {
      return describeClaims();
    },
    inspect(request, context, signal) {
      return inspectFile(request, signal, mediaTools, context.preferences);
    }
  };

  // extensions/media-info/src/index.ts
  defineExtension({
    services: {
      media: mediaEngine
    }
  });
})();
