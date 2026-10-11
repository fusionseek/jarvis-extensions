// jarvis-extension bundle · mole-clean@1.0.0 · sdk 2.0.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
          props[name] = value.map((action2) => {
            const { onPress, ...rest } = action2;
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
  var sdkVersion = "2.0.0";
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
     */
    subscribe(namespace, method, listener) {
      const token = this.token(namespace, method);
      this.listen(token, listener);
      this.invoke(namespace, method, { token }).catch((error) => {
        this.forget(token);
        this.log("warn", `\u8BA2\u9605 ${namespace}.${method} \u88AB\u5BBF\u4E3B\u62D2\u7EDD`, error instanceof Error ? error.message : String(error));
      });
      return () => {
        this.forget(token);
        this.invoke(namespace, "unsubscribe", { token }).catch(() => void 0);
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
    system: namespaced("system")
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
    const result = runtime.invoke("process", "run", { executable: options.executable, arguments: options.arguments, token }).finally(() => runtime.forget(token));
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

  // extensions/mole-clean/src/command.ts
  var defaultCommand = "mo";
  function commandPreference(preferences) {
    const raw = preferences.command;
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    return trimmed || defaultCommand;
  }
  function describeProblem(problem, command) {
    switch (problem) {
      case "notFound":
        return `\u6CA1\u6709\u627E\u5230 ${command} \u547D\u4EE4`;
      case "missing":
        return `\u586B\u7684\u8DEF\u5F84 ${command} \u4E0D\u5B58\u5728`;
      case "notExecutable":
        return `${command} \u4E0D\u662F\u53EF\u6267\u884C\u6587\u4EF6`;
    }
  }
  function parseVersion(lines) {
    for (const line of lines) {
      const match = /Mole version (\S+)/.exec(line);
      if (match) return match[1];
    }
    return null;
  }

  // extensions/mole-clean/src/limits.ts
  var limits = {
    /** `junkCleanStatus.summary` / `problem`。 */
    statusText: 200,
    /** `junkCleanActionResult.message`。 */
    actionMessage: 200,
    /** `junkCleanProgress.sectionTitle`、`junkCleanSection.id / title`。 */
    sectionTitle: 80,
    /** `junkCleanProgress.currentItem`。 */
    currentItem: 1024,
    /** `junkCleanReport.sections`。Mole 自己只有十几个区段，这条只防一个失控的输出。 */
    sections: 64,
    /** `junkCleanSection.failures` / `notes` 的条数。 */
    sectionList: 8,
    /** `junkCleanReport.notes` 的条数。 */
    reportNotes: 12,
    /** 报告里每一条字符串（失败、说明、整次失败）。 */
    text: 400
  };
  function clampText(text, max) {
    if (text.length <= max) return text;
    let cut = text.slice(0, max - 1);
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut}\u2026`;
  }
  function clampPath(path, max) {
    if (path.length <= max) return path;
    let cut = path.slice(path.length - (max - 1));
    if (/^[\uDC00-\uDFFF]/.test(cut)) cut = cut.slice(1);
    return `\u2026${cut}`;
  }
  function clampList(items, max, overflow) {
    if (items.length <= max) return items;
    const kept = items.slice(0, max - 1);
    return [...kept, clampText(overflow(items.length - kept.length), limits.text)];
  }

  // extensions/mole-clean/src/output-parser.ts
  var headings = /* @__PURE__ */ new Set(["Cleanup complete", "Cleanup cancelled", "Cleanup interrupted", "Cleanup incomplete"]);
  var sectionOrder = [
    "System",
    "User essentials",
    "App caches",
    "Browsers",
    "Cloud & Office",
    "Developer tools",
    "Apps & utilities",
    "Virtualization",
    "Application Support",
    "App leftovers",
    "Apple Silicon updates",
    "Device backups & firmware",
    "Time Machine",
    "Large files",
    "Project artifacts"
  ];
  var decimalPattern = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  function bytesFromToken(text) {
    const units2 = [
      ["TB", 1e12],
      ["GB", 1e9],
      ["MB", 1e6],
      ["KB", 1e3],
      ["B", 1]
    ];
    for (const [suffix, scale] of units2) {
      if (!text.endsWith(suffix)) continue;
      const number = text.slice(0, text.length - suffix.length);
      if (!decimalPattern.test(number)) return null;
      const value = Number(number);
      if (!Number.isFinite(value) || value < 0) return null;
      return Math.round(value * scale);
    }
    return null;
  }
  function strictInteger(text) {
    return /^[+-]?\d+$/.test(text) ? Number(text) : null;
  }
  function stripANSI(text) {
    return text.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");
  }
  function sectionHeading(raw) {
    const trimmed = stripANSI(raw).trim();
    if (!trimmed.startsWith("\u27A4 ")) return null;
    return trimmed.slice(2).trim();
  }
  function localizedTitle(title) {
    switch (title) {
      case "System":
        return "\u7CFB\u7EDF\uFF08\u9700\u7BA1\u7406\u5458\u6743\u9650\uFF09";
      case "User essentials":
        return "\u7528\u6237\u7F13\u5B58\u3001\u65E5\u5FD7\u4E0E\u5E9F\u7EB8\u7BD3";
      case "App caches":
        return "\u5E94\u7528\u7F13\u5B58";
      case "Browsers":
        return "\u6D4F\u89C8\u5668\u7F13\u5B58";
      case "Cloud & Office":
        return "\u4E91\u76D8\u4E0E\u529E\u516C";
      case "Developer tools":
        return "\u5F00\u53D1\u5DE5\u5177\u7F13\u5B58";
      case "Apps & utilities":
        return "\u5E94\u7528\u4E0E\u5DE5\u5177";
      case "Virtualization":
        return "\u865A\u62DF\u5316";
      case "Application Support":
        return "\u5E94\u7528\u652F\u6301\u65E5\u5FD7";
      case "App leftovers":
        return "\u5DF2\u5378\u8F7D\u5E94\u7528\u6B8B\u7559";
      case "Apple Silicon updates":
        return "Apple \u82AF\u7247\u66F4\u65B0\u7F13\u5B58";
      case "Device backups & firmware":
        return "\u8BBE\u5907\u56FA\u4EF6";
      case "Time Machine":
        return "\u65F6\u95F4\u673A\u5668\u672A\u5B8C\u6210\u5907\u4EFD";
      case "Large files":
        return "\u5927\u6587\u4EF6\uFF08\u4EC5\u63D0\u793A\uFF09";
      case "Project artifacts":
        return "\u9879\u76EE\u6784\u5EFA\u4EA7\u7269\uFF08\u4EC5\u63D0\u793A\uFF09";
      case "External volume":
        return "\u5916\u63A5\u5377";
      default:
        return title;
    }
  }
  var CleanOutputParser = class {
    constructor() {
      /** 按出现顺序的区段。 */
      this.sections = [];
      /** `Tracked cleanup` 的总数（字节）。 */
      this.trackedBytes = null;
      /** `Items cleaned` 的总数。 */
      this.trackedItems = null;
      /** `Free space` 的变化原文（例如 `+4.50GB`）。 */
      this.freeSpaceDelta = null;
      /** 收尾标题（`Cleanup complete` / `Cleanup cancelled` / …）。 */
      this.heading = null;
      /** 系统级那一段因为没有 sudo 被跳过。 */
      this.systemSkipped = false;
    }
    /**
     * 喂一行。
     * @param raw 标准输出的一行（不含换行）。
     * @returns 无返回值。
     */
    consume(raw) {
      const title = sectionHeading(raw);
      if (title !== null) {
        this.sections.push({ title, freedBytes: 0, itemCount: 0, notes: [] });
        return;
      }
      const trimmed = stripANSI(raw).trim();
      if (trimmed.includes("System-level cleanup skipped")) this.systemSkipped = true;
      if (headings.has(trimmed)) {
        this.heading = trimmed;
        return;
      }
      if (trimmed.startsWith("Tracked cleanup:")) {
        const parts = trimmed.slice("Tracked cleanup:".length).split("|").filter((part) => part.length > 0).map((part) => part.trim());
        const first = parts[0];
        if (first !== void 0) this.trackedBytes = bytesFromToken(first.replace(/At least /g, ""));
        const items = parts.slice(1).find((part) => part.startsWith("Items cleaned:"));
        if (items !== void 0) this.trackedItems = strictInteger(items.slice("Items cleaned:".length).trim());
        return;
      }
      if (trimmed.startsWith("Free space:")) {
        const open = trimmed.indexOf("(");
        const close = trimmed.lastIndexOf(")");
        if (open >= 0 && open < close) this.freeSpaceDelta = trimmed.slice(open + 1, close);
        return;
      }
      const section = this.sections[this.sections.length - 1];
      if (!trimmed.startsWith("\u2713 ") || section === void 0) return;
      const body = trimmed.slice(2);
      const pieces = body.split(" \xB7 ");
      const detail = pieces.length >= 2 ? pieces[pieces.length - 1] : body;
      if (detail.startsWith("skipped")) {
        section.notes.push(`${pieces[0]}\uFF1A${detail}`);
        return;
      }
      const counted = /(\d+) (items?|files?|dirs?|stubs?|removed)\b/.exec(detail) ?? /(Cleaned|removed) (\d+)/.exec(detail);
      const tokens = detail.split(/[ ,()]/).filter((token) => token.length > 0);
      let size = null;
      for (let index = tokens.length - 1; index >= 0 && size === null; index -= 1) size = bytesFromToken(tokens[index]);
      if (pieces.length < 2 && counted === null && size === null) return;
      if (size !== null) section.freedBytes += size;
      let count = 1;
      if (counted !== null) {
        for (const word of counted[0].split(" ")) {
          const value = strictInteger(word);
          if (value !== null) {
            count = value;
            break;
          }
        }
      }
      section.itemCount += count;
    }
    /**
     * 按读到的区段估一个进度：最靠后的那个已知区段**刚开始**时的位置（第 i 段 → i / 15）。
     * 没读到任何已知区段时为 0；不认识的区段不推进、也不倒退。
     */
    get estimatedFraction() {
      let last = -1;
      for (const section of this.sections) last = Math.max(last, sectionOrder.indexOf(section.title));
      return last < 0 ? 0 : last / sectionOrder.length;
    }
  };

  // extensions/mole-clean/src/operation-log.ts
  var operationLogPath = "~/Library/Logs/mole/operations.log";
  var markerPrefix = "# ========== ";
  var markerSuffix = " ==========";
  function commandAndRun(tag) {
    const at = tag.indexOf(" run=");
    if (at < 0) return null;
    const command = tag.slice(0, at);
    const run2 = tag.slice(at + " run=".length);
    if (!command || !run2 || run2.includes(" ")) return null;
    return { command, run: run2 };
  }
  function parseOperationLogLine(raw) {
    const line = raw.trim();
    if (line.startsWith(markerPrefix) && line.endsWith(markerSuffix)) {
      const inner = line.slice(markerPrefix.length, line.length - markerSuffix.length);
      const started = inner.indexOf(" session started at ");
      if (started >= 0) {
        const tag2 = commandAndRun(inner.slice(0, started));
        return tag2 ? { kind: "sessionStarted", ...tag2 } : null;
      }
      const ended = inner.indexOf(" session ended at ");
      if (ended >= 0) {
        const tag2 = commandAndRun(inner.slice(0, ended));
        if (!tag2) return null;
        const tail = inner.slice(ended + " session ended at ".length).split(", ");
        const items = tail.length >= 2 ? strictInteger(tail[tail.length - 2].replace(/ items/g, "")) : null;
        const size = tail.length >= 3 ? tail[tail.length - 1] : null;
        return { kind: "sessionEnded", ...tag2, items, size };
      }
      return null;
    }
    if (!line.startsWith("[")) return null;
    const firstClose = line.indexOf("]");
    if (firstClose < 0) return null;
    const afterTime = line.slice(firstClose + 1).replace(/^ +/, "");
    if (!afterTime.startsWith("[")) return null;
    const tagClose = afterTime.indexOf("]");
    if (tagClose < 0) return null;
    const tag = commandAndRun(afterTime.slice(1, tagClose));
    if (!tag) return null;
    const rest = afterTime.slice(tagClose + 1).replace(/^ +/, "");
    const space = rest.indexOf(" ");
    if (space < 0) return null;
    const action2 = rest.slice(0, space);
    if (!/^[\p{Uppercase}_]+$/u.test(action2)) return null;
    let path = rest.slice(space + 1);
    let detail = null;
    if (path.endsWith(")")) {
      const open = path.lastIndexOf(" (");
      if (open >= 0) {
        detail = path.slice(open + 2, path.length - 1);
        path = path.slice(0, open);
      }
    }
    if (!path) return null;
    return { kind: "operation", ...tag, action: action2, path, detail };
  }
  var failureLimit = 3;
  var OperationLogParser = class {
    constructor() {
      /** 认下的那一次会话。 */
      this.run = null;
      /** 会话结束了（读到了结束标记）。之后的行一律不计。 */
      this.ended = false;
      /** Mole 自己在结束标记里写的条目数与大小原文。 */
      this.endedItems = null;
      this.endedSize = null;
      /** 按类累计。键是标准输出里区段的下标（`-1` = 第一个区段之前）。 */
      this.buckets = /* @__PURE__ */ new Map();
      /** 受保护 / 白名单跳过的条目数。 */
      this.skippedCount = 0;
      /** 最近删掉的那一项（绝对路径）。 */
      this.lastRemoved = null;
    }
    /** 认下了会话：明细可信。 */
    get isBound() {
      return this.run !== null;
    }
    /** 全部类加起来释放的字节数。 */
    get freedBytes() {
      let total = 0;
      for (const bucket of this.buckets.values()) total += bucket.freedBytes;
      return total;
    }
    /** 全部类加起来删掉的条目数。 */
    get removedCount() {
      let total = 0;
      for (const bucket of this.buckets.values()) total += bucket.removedCount;
      return total;
    }
    /**
     * 喂一行。
     * @param raw 日志的一行（不含换行）。
     * @param section 此刻标准输出停在第几个区段（`-1` = 还没有）。
     * @returns 无返回值。
     */
    consume(raw, section) {
      const line = parseOperationLogLine(raw);
      if (!line) return;
      switch (line.kind) {
        case "sessionStarted":
          if (this.run === null && line.command === "clean") this.run = line.run;
          return;
        case "sessionEnded":
          if (line.run !== this.run) return;
          this.ended = true;
          this.endedItems = line.items;
          this.endedSize = line.size;
          return;
        case "operation": {
          if (line.run !== this.run || this.ended) return;
          const bucket = this.buckets.get(section) ?? { freedBytes: 0, removedCount: 0, failures: [], failureCount: 0 };
          switch (line.action) {
            case "REMOVED": {
              bucket.removedCount += 1;
              const bytes = line.detail === null ? null : bytesFromToken(line.detail);
              if (bytes !== null) bucket.freedBytes += bytes;
              this.lastRemoved = line.path;
              break;
            }
            case "FAILED":
              bucket.failureCount += 1;
              if (bucket.failures.length < failureLimit) {
                bucket.failures.push(line.detail === null ? line.path : `${line.path} \xB7 ${line.detail}`);
              }
              break;
            case "SKIPPED":
              this.skippedCount += 1;
              break;
            default:
              break;
          }
          this.buckets.set(section, bucket);
          return;
        }
      }
    }
  };
  var maximumTailRounds = 64;
  var OperationLogReader = class _OperationLogReader {
    constructor(files, path, offset, inode) {
      this.files = files;
      this.path = path;
      this.offset = offset;
      this.inode = inode;
    }
    /**
     * 从文件此刻的末尾开始读：开跑之前的会话不算。文件此刻不在时从 0 开始——Mole 开跑时才建它。
     * @param files 宿主的 `files` 能力（单测注入替身）。
     * @param path 日志路径（manifest 里声明的那一串）。
     * @returns 读取器；宿主不让读（没授权、没声明）时为 `null`，调用方只看标准输出。
     */
    static async open(files, path = operationLogPath) {
      try {
        const stat = await files.stat(path);
        return new _OperationLogReader(files, path, stat?.size ?? 0, stat?.inode ?? null);
      } catch {
        return null;
      }
    }
    /**
     * 读出新增的完整行。文件不在、或宿主这一次拒绝时什么都不返回——明细缺一拍不该让整次清理失败。
     * @returns 新增的行（不含换行）。
     */
    async readNewLines() {
      const lines = [];
      try {
        const stat = await this.files.stat(this.path);
        if (!stat) return lines;
        if (stat.inode !== this.inode || stat.size < this.offset) {
          this.inode = stat.inode;
          this.offset = 0;
        }
        if (stat.size <= this.offset) return lines;
        for (let round = 0; round < maximumTailRounds; round += 1) {
          const requested = this.offset;
          const tail = await this.files.tail(this.path, requested);
          if (!tail) break;
          if (tail.inode !== this.inode || tail.size < requested) {
            this.inode = tail.inode;
            this.offset = 0;
            continue;
          }
          lines.push(...tail.lines);
          this.offset = tail.offset;
          if (tail.offset <= requested || tail.offset >= tail.size) break;
        }
      } catch {
      }
      return lines;
    }
  };

  // extensions/mole-clean/src/live-state.ts
  function progressKey(progress) {
    return JSON.stringify([
      progress.sectionTitle ?? null,
      progress.freedBytes,
      progress.itemCount,
      progress.completedSections,
      progress.fraction ?? null,
      progress.currentItem ?? null
    ]);
  }
  var LiveState = class {
    /**
     * 建一份状态。
     * @param reader 操作日志读取器；`null` 时只看标准输出（没授权 `files.read`、宿主不让读）。
     */
    constructor(reader) {
      this.reader = reader;
      /** 标准输出的解析结果。 */
      this.parser = new CleanOutputParser();
      /** 操作日志的累计结果。 */
      this.log = new OperationLogParser();
      this.queue = Promise.resolve();
      this.lastEmitted = null;
    }
    /**
     * 喂一行标准输出；数字或区段变了时给出一份进度。
     * @param line 一行。
     * @returns 进度；没变时为 `null`。
     */
    consume(line) {
      return this.serial(async () => {
        if (sectionHeading(line) !== null) await this.drainLog();
        this.parser.consume(line);
        return this.emitIfChanged();
      });
    }
    /**
     * 读一次操作日志；数字变了时给出一份进度。
     * @returns 进度；没变时为 `null`。
     */
    poll() {
      return this.serial(async () => {
        await this.drainLog();
        return this.emitIfChanged();
      });
    }
    /**
     * 等队列里已经排着的事全部做完。
     * @returns 做完时兑现。
     */
    idle() {
      return this.serial(async () => void 0);
    }
    serial(work) {
      const next = this.queue.then(work);
      this.queue = next.catch(() => void 0);
      return next;
    }
    async drainLog() {
      if (!this.reader) return;
      const section = this.parser.sections.length - 1;
      for (const line of await this.reader.readNewLines()) this.log.consume(line, section);
    }
    emitIfChanged() {
      let freed = 0;
      let items = 0;
      this.parser.sections.forEach((section, index) => {
        const bucket = this.log.buckets.get(index);
        freed += Math.max(section.freedBytes, bucket?.freedBytes ?? 0);
        items += Math.max(section.itemCount, bucket?.removedCount ?? 0);
      });
      const before = this.log.buckets.get(-1);
      freed += before?.freedBytes ?? 0;
      items += before?.removedCount ?? 0;
      const current = this.parser.sections[this.parser.sections.length - 1];
      const snapshot = {
        freedBytes: freed,
        itemCount: items,
        completedSections: Math.max(0, this.parser.sections.length - 1),
        fraction: this.parser.estimatedFraction
      };
      if (current) snapshot.sectionTitle = clampText(localizedTitle(current.title), limits.sectionTitle);
      if (this.log.lastRemoved !== null) snapshot.currentItem = clampPath(this.log.lastRemoved, limits.currentItem);
      const key = progressKey(snapshot);
      if (key === this.lastEmitted) return null;
      this.lastEmitted = key;
      return snapshot;
    }
  };

  // extensions/mole-clean/src/size-format.ts
  var units = ["B", "KB", "MB", "GB", "TB"];
  function panelSize(bytes) {
    const total = Math.max(0, bytes);
    if (total < 1e3) return `${total} B`;
    let value = total;
    let unit = 0;
    while (value >= 1e3 && unit < units.length - 1) {
      value /= 1e3;
      unit += 1;
    }
    if (value >= 999.5 && unit < units.length - 1) {
      value /= 1e3;
      unit += 1;
    }
    if (value < 9.995) return `${value.toFixed(2)} ${units[unit]}`;
    if (value < 99.95) return `${value.toFixed(1)} ${units[unit]}`;
    return `${value.toFixed(0)} ${units[unit]}`;
  }

  // extensions/mole-clean/src/report.ts
  var cancelledText = "\u5DF2\u53D6\u6D88";
  var trackedMismatchThreshold = 1e6;
  function failureReport(failure) {
    return { sections: [], notes: [], failure: clampText(failure, limits.text) };
  }
  function buildReport(parser, log, outcome) {
    const sections = parser.sections.slice(0, limits.sections).map((section, index) => {
      const bucket = log.buckets.get(index);
      const freed = Math.max(section.freedBytes, bucket?.freedBytes ?? 0);
      const items = Math.max(section.itemCount, bucket?.removedCount ?? 0);
      const failures = [...bucket?.failures ?? []];
      if (bucket && bucket.failureCount > bucket.failures.length) {
        failures.push(`\u53E6\u6709 ${bucket.failureCount - bucket.failures.length} \u9879\u6CA1\u5220\u6389`);
      }
      const result = {
        id: clampText(section.title, limits.sectionTitle),
        title: clampText(localizedTitle(section.title), limits.sectionTitle),
        freedBytes: freed,
        itemCount: items
      };
      if (items === 0 && freed === 0) result.skipped = { reason: "notPresent" };
      if (failures.length > 0) {
        result.failures = clampList(
          failures.map((failure2) => clampText(failure2, limits.text)),
          limits.sectionList,
          (hidden) => `\u53E6\u6709 ${hidden} \u6761\u5931\u8D25\u660E\u7EC6\u4ECE\u7565`
        );
      }
      if (section.notes.length > 0) {
        result.notes = clampList(
          section.notes.map((note) => clampText(note, limits.text)),
          limits.sectionList,
          (hidden) => `\u53E6\u6709 ${hidden} \u6761\u8BF4\u660E\u4ECE\u7565`
        );
      }
      return result;
    });
    const notes = [];
    if (parser.systemSkipped) notes.push("\u7CFB\u7EDF\u7EA7\u6E05\u7406\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650\uFF0C\u8FD9\u6B21\u7531 Mole \u81EA\u52A8\u8DF3\u8FC7\u3002");
    if (parser.freeSpaceDelta !== null) {
      notes.push(`\u78C1\u76D8\u53EF\u7528\u7A7A\u95F4\u53D8\u5316 ${parser.freeSpaceDelta}\uFF08\u542B\u5E9F\u7EB8\u7BD3\u4E0E Homebrew \u7B49\u672A\u8BA1\u5165\u660E\u7EC6\u7684\u90E8\u5206\uFF09\u3002`);
    }
    if (log.skippedCount > 0) notes.push(`\u6309 Mole \u7684\u53D7\u4FDD\u62A4\u540D\u5355\u4E0E\u767D\u540D\u5355\u8DF3\u8FC7\u4E86 ${log.skippedCount} \u9879\u3002`);
    if (parser.trackedBytes !== null) {
      const sum = sections.reduce((total, section) => total + section.freedBytes, 0);
      if (Math.abs(parser.trackedBytes - sum) > trackedMismatchThreshold) {
        notes.push(
          `Mole \u81EA\u5DF1\u7EDF\u8BA1\u7684\u603B\u6570\u4E3A ${panelSize(parser.trackedBytes)}\uFF1A\u5B83\u4E0D\u8BA1\u6D4F\u89C8\u5668 Service Worker \u7B49\u51E0\u9879\uFF0C\u8FD9\u91CC\u6309\u9010\u9879\u5220\u9664\u8BB0\u5F55\u4E0E\u6BCF\u4E00\u7C7B\u7684\u5C0F\u7ED3\u53D6\u5927\u7684\u90A3\u4E2A\u3002`
        );
      }
    }
    let failure;
    if (parser.heading === null) {
      if (outcome.kind === "cancelled") {
        failure = cancelledText;
      } else if (outcome.exitCode !== 0) {
        const tail = outcome.stderr.split("\n").filter((line) => line.length > 0).slice(-3).join(" ");
        failure = `mo clean \u9000\u51FA\u7801 ${outcome.exitCode}${tail ? `\uFF1A${tail}` : ""}`;
      }
    } else if (parser.heading !== "Cleanup complete") {
      notes.push(`Mole \u62A5\u544A\uFF1A${parser.heading}\u3002`);
    }
    const report = {
      sections,
      notes: clampList(
        notes.map((note) => clampText(note, limits.text)),
        limits.reportNotes,
        (hidden) => `\u53E6\u6709 ${hidden} \u6761\u8BF4\u660E\u4ECE\u7565`
      )
    };
    if (failure !== void 0) report.failure = clampText(failure, limits.text);
    return report;
  }

  // extensions/mole-clean/src/engine.ts
  var logPollInterval = 500;
  var versionTimeout = 5e3;
  var installScriptId = "install";
  var notAllowedToRun = "\u8FD8\u6CA1\u6709\u5141\u8BB8\u8FD9\u4E2A\u6269\u5C55\u8FD0\u884C\u547D\u4EE4\uFF08process.run\uFF09\u3002\u5728\u8BBE\u7F6E \xB7 \u6269\u5C55\u91CC\u5B83\u90A3\u5757\u9762\u677F\u4E0A\u6253\u5F00\u6388\u6743\u540E\u518D\u8BD5\u3002";
  var installAction = { id: installScriptId, title: "\u5728\u7EC8\u7AEF\u4E2D\u5B89\u88C5", prominent: true };
  function messageOf(error) {
    if (error instanceof JarvisError) {
      return error.detail && error.detail !== error.message ? `${error.message}\uFF08${error.detail}\uFF09` : error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }
  function isCancellation(error) {
    return typeof error === "object" && error !== null && error.code === "cancelled";
  }
  function granted(context, capability) {
    return context.granted.includes(capability);
  }
  async function locate(command) {
    try {
      return { location: await jarvis.process.locate(command) };
    } catch (error) {
      return { error: messageOf(error) };
    }
  }
  async function probeVersion(executable) {
    const lines = [];
    let handle;
    try {
      handle = jarvis.process.run({ executable, arguments: ["--version"], onLine: (line) => lines.push(line) });
    } catch {
      return null;
    }
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), versionTimeout);
    });
    try {
      if (await Promise.race([handle.result, timeout]) === "timeout") handle.cancel();
    } catch {
    } finally {
      if (timer !== void 0) clearTimeout(timer);
    }
    return parseVersion(lines);
  }
  async function status(context) {
    const unavailable = (text, actions = []) => {
      const clamped = clampText(text, limits.statusText);
      return { ready: false, summary: clamped, problem: clamped, actions };
    };
    if (!granted(context, "process.run")) return unavailable(notAllowedToRun);
    const command = commandPreference(context.preferences);
    const located = await locate(command);
    if ("error" in located) return unavailable(located.error);
    const { location } = located;
    if (location.path === null) {
      return unavailable(describeProblem(location.problem, command), location.problem === "notFound" ? [installAction] : []);
    }
    const version = await probeVersion(location.path);
    const summary = version === null ? location.path : `${location.path} \xB7 v${version}`;
    return { ready: true, summary: clampText(summary, limits.statusText), actions: [] };
  }
  async function run(context, progress, signal) {
    if (!granted(context, "process.run")) return failureReport(notAllowedToRun);
    const command = commandPreference(context.preferences);
    const located = await locate(command);
    if ("error" in located) return failureReport(located.error);
    const { location } = located;
    if (location.path === null) return failureReport(describeProblem(location.problem, command));
    if (signal.cancelled) return failureReport(cancelledText);
    const reader = granted(context, "files.read") ? await OperationLogReader.open(jarvis.files, operationLogPath) : null;
    const state = new LiveState(reader);
    const report = (snapshot) => {
      if (snapshot) progress(snapshot);
    };
    let handle;
    try {
      handle = jarvis.process.run({
        executable: location.path,
        arguments: ["clean"],
        // 解析与读日志本身不会拒绝（读取器把宿主的拒绝吞成「这一拍没有新行」）；兜一层只为不留下未处理的拒绝。
        onLine: (line) => void state.consume(line).then(report, () => void 0)
      });
    } catch (error) {
      return failureReport(`mo clean \u6CA1\u80FD\u542F\u52A8\uFF1A${messageOf(error)}`);
    }
    signal.onCancel(() => handle.cancel());
    let running = true;
    void (async () => {
      while (running) {
        await sleep(logPollInterval);
        if (!running) return;
        report(await state.poll());
      }
    })().catch(() => void 0);
    let outcome;
    try {
      const result = await handle.result;
      outcome = { kind: "exited", exitCode: result.exitCode, stderr: result.stderr };
    } catch (error) {
      running = false;
      if (!signal.cancelled && !isCancellation(error)) {
        await state.idle();
        return failureReport(`mo clean \u6CA1\u80FD\u542F\u52A8\uFF1A${messageOf(error)}`);
      }
      outcome = { kind: "cancelled" };
    }
    running = false;
    report(await state.poll());
    return buildReport(state.parser, state.log, outcome);
  }
  async function action(id, context) {
    if (id !== installScriptId) {
      throw new JarvisError({ code: "invalid.argument", message: `\u4E0D\u8BA4\u8BC6\u7684\u52A8\u4F5C\u300C${id}\u300D` });
    }
    if (!granted(context, "terminal.run")) {
      throw new JarvisError({
        code: "permission.denied",
        message: "\u8FD8\u6CA1\u6709\u5141\u8BB8\u8FD9\u4E2A\u6269\u5C55\u6253\u5F00\u7EC8\u7AEF\uFF08terminal.run\uFF09\u3002\u5728\u8BBE\u7F6E \xB7 \u6269\u5C55\u91CC\u5B83\u90A3\u5757\u9762\u677F\u4E0A\u6253\u5F00\u6388\u6743\uFF0C\u6216\u8005\u81EA\u5DF1\u5728\u7EC8\u7AEF\u91CC\u8FD0\u884C brew install mole\u3002"
      });
    }
    await jarvis.terminal.run(installScriptId);
    return { message: "\u6B63\u5728\u7EC8\u7AEF\u91CC\u5B89\u88C5 Mole\u2026\u88C5\u597D\u540E\u4F1A\u81EA\u52A8\u6362\u6210 Mole \u6E05\u7406\u3002", watchStatus: true };
  }
  var moleEngine = { status, run, action };

  // extensions/mole-clean/src/index.ts
  defineExtension({
    services: {
      mole: moleEngine
    }
  });
})();
