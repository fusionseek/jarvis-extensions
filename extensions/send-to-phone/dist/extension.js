// jarvis-extension bundle · send-to-phone@1.0.0 · sdk 1.3.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
  var bridgeProtocolVersion = 1;
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
    image: make("image")
  };

  // sdk/src/index.ts
  var sdkVersion = "1.3.0";
  var Runtime = class {
    constructor() {
      this.definition = null;
      this.nextRequestId = 1;
      this.generation = 0;
      this.pending = /* @__PURE__ */ new Map();
      this.handlers = /* @__PURE__ */ new Map();
      this.subscriptions = /* @__PURE__ */ new Map();
      this.updateQueued = false;
      /** 此刻开着的那一面；`null` = 既没有页面也没有弹窗，`render()` 不会被调。 */
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
    /** 把 `dispatch` 挂到全局。幂等；`defineExtension` 与任何一次能力调用都会确保它挂上了。 */
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
    /** 让宿主再调一次 render。同一拍里的多次请求合并成一次提交；页面与弹窗都没开着时是空操作。 */
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
    /**
     * 订阅宿主事件。宿主拒绝订阅（没授权、没这个能力）时**不抛到扩展里**：一条被拒的订阅只是收不到事件，
     * 让它变成未处理的 rejection 会把整个上下文拖垮。拒绝记一条 warn 日志，开发者模式看得见。
     */
    subscribe(namespace, method, listener) {
      const token = `${namespace}.${method}#${this.nextRequestId++}`;
      this.subscriptions.set(token, listener);
      this.invoke(namespace, method, { token }).catch((error) => {
        this.subscriptions.delete(token);
        this.log("warn", `\u8BA2\u9605 ${namespace}.${method} \u88AB\u5BBF\u4E3B\u62D2\u7EDD`, error instanceof Error ? error.message : String(error));
      });
      return () => {
        this.subscriptions.delete(token);
        this.invoke(namespace, "unsubscribe", { token }).catch(() => void 0);
      };
    }
    log(level, message, data) {
      this.host().log(level, message, data === void 0 ? null : JSON.stringify(data));
    }
    /** 开着的那一面的定义：弹窗（没给时退回页面）或页面。 */
    surfaceDefinition(surface) {
      const definition = this.definition;
      if (surface === "popover" && definition?.popover) return definition.popover;
      return definition?.page;
    }
    /** 此刻那一面的树：弹窗、自定义页面，或按命令清单画的默认页。 */
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
                subtitle: command.hotkey ? `\u5FEB\u6377\u952E ${command.hotkey}` : command.description ?? "\u6CA1\u6709\u5FEB\u6377\u952E\uFF0C\u5728\u8FD9\u91CC\u8FD0\u884C",
                onPress: () => void jarvis.commands.run(command.id)
              })
            ) : [ui.empty({ symbol: "bolt.slash", title: "\u8FD9\u4E2A\u6269\u5C55\u6CA1\u6709\u547D\u4EE4", hint: "\u5B83\u7684 manifest \u91CC\u65E2\u6CA1\u6709\u9875\u9762\u4E5F\u6CA1\u6709\u547D\u4EE4\u3002" })]
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
    dispatch(json) {
      const event = JSON.parse(json);
      const definition = this.definition;
      switch (event.type) {
        case "activate": {
          const surface = event.context.surface ?? "page";
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
        case "subscription": {
          this.subscriptions.get(event.token)?.(event.payload);
          return;
        }
        case "preferencesChanged":
        case "permissionsChanged": {
          this.requestUpdate();
          return;
        }
        case "inboxAction": {
          void definition?.onInboxAction?.(event.cardId, event.actionId);
          return;
        }
        case "notificationActivated": {
          void definition?.onNotificationActivated?.();
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
    memo: namespaced("memo"),
    calendar: namespaced("calendar"),
    tasks: namespaced("tasks"),
    net: namespaced("net"),
    files: namespaced("files"),
    system: namespaced("system")
  };
  var sync = {
    text: syncNamespaced("text"),
    time: syncNamespaced("time"),
    color: syncNamespaced("color"),
    host: syncNamespaced("host")
  };
  var jarvis = {
    sdk: { version: sdkVersion },
    get host() {
      return sync.host("info");
    },
    get environment() {
      return sync.host("environment");
    },
    ui: {
      update: () => runtime.requestUpdate()
    },
    panel: {
      hold(reason) {
        let released = false;
        const id = runtime.invoke("panel", "hold", { reason });
        return {
          release() {
            if (released) return;
            released = true;
            void id.then((handle) => call.panel("release", { handle }));
          }
        };
      },
      collapse: () => call.panel("collapse"),
      present: () => call.panel("present")
    },
    commands: {
      run: (id) => call.commands("run", { id })
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
        encode: (text2, options) => sync.text("base64.encode", { text: text2, ...options }),
        decode: (text2, options) => sync.text("base64.decode", { text: text2, ...options })
      },
      hash: {
        digest: (algorithm, text2, options) => sync.text("hash.digest", { algorithm, text: text2, ...options })
      },
      json: {
        format: (text2, options) => sync.text("json.format", { text: text2, ...options }),
        minify: (text2, options) => sync.text("json.minify", { text: text2, ...options })
      },
      url: {
        parse: (text2) => sync.text("url.parse", { text: text2 }),
        build: (parts) => sync.text("url.build", parts)
      },
      regex: {
        test: (pattern, text2, flags) => sync.text("regex.test", { pattern, text: text2, flags })
      },
      language: {
        detect: (text2, options) => sync.text("language.detect", { text: text2, ...options }),
        displayName: (code) => sync.text("language.displayName", { code })
      }
    },
    time: {
      parse: (text2, unit) => sync.time("parse", { text: text2, unit }),
      format: (epochMilliseconds, pattern, timeZone) => sync.time("format", { epochMilliseconds, pattern, timeZone }),
      timeZones: () => sync.time("timeZones")
    },
    color: {
      convert: (hex) => sync.color("convert", { hex })
    },
    clipboard: {
      read: () => call.clipboard("read"),
      readImage: () => call.clipboard("readImage"),
      write: (text2) => call.clipboard("write", { text: text2 }),
      history: (options) => call.clipboard("history", options),
      entryText: (id) => call.clipboard("entryText", { id }),
      observe: (listener) => runtime.subscribe("clipboard", "observe", listener)
    },
    quickTransfer: {
      status: () => call.quickTransfer("status"),
      observe: (listener) => runtime.subscribe("quickTransfer", "observe", listener),
      start: () => call.quickTransfer("start"),
      stop: () => call.quickTransfer("stop"),
      sendText: (text2) => call.quickTransfer("sendText", { text: text2 }),
      sendFile: (file) => call.quickTransfer("sendFile", { file }),
      records: (options) => call.quickTransfer("records", options)
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
      post: (card) => call.inbox("post", card),
      dismiss: (cardId) => call.inbox("dismiss", { cardId })
    },
    memo: {
      list: (options) => call.memo("list", options),
      create: (body) => call.memo("create", { body }),
      complete: (id) => call.memo("complete", { id })
    },
    calendar: {
      runs: (range) => call.calendar("runs", range)
    },
    tasks: {
      recent: () => call.tasks("recent"),
      observe: (listener) => runtime.subscribe("tasks", "observe", listener)
    },
    net: {
      fetch: (url, init) => call.net("fetch", { url, ...init })
    },
    files: {
      pick: (options) => call.files("pick", options),
      readText: (file) => call.files("readText", { file }),
      readBytes: (file) => call.files("readBytes", { file }),
      reveal: (file) => call.files("reveal", { file })
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
  var unsubscribe = null;
  function has(id) {
    return granted.has(id);
  }
  async function refreshStatus() {
    if (!has("quickTransfer.status")) return;
    try {
      status = await jarvis.quickTransfer.status();
      statusProblem = null;
    } catch (e) {
      statusProblem = e instanceof JarvisError ? e.detail ?? e.message : String(e);
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
  async function send() {
    const payload = prefs.trimWhitespace ? text.trim() : text;
    if (payload === "" || sending) return;
    sending = true;
    failure = null;
    jarvis.ui.update();
    const hold = jarvis.panel.hold("\u6B63\u5728\u628A\u6587\u5B57\u63A8\u5230\u624B\u673A");
    try {
      await jarvis.quickTransfer.sendText(payload);
      lastSentAt = (/* @__PURE__ */ new Date()).toISOString();
      if (has("inbox.post")) {
        await jarvis.inbox.post({
          id: "sent",
          title: peerLabel() ? `\u5DF2\u63A8\u5230 ${peerLabel()}` : "\u5DF2\u63A8\u5230\u624B\u673A",
          body: payload.slice(0, 60),
          tint: "live",
          actions: [{ id: "again", title: "\u518D\u53D1\u4E00\u6B21" }]
        });
      }
    } catch (e) {
      failure = describe(e);
    } finally {
      hold.release();
      sending = false;
      jarvis.ui.update();
    }
  }
  function describe(e) {
    if (e instanceof JarvisError) return e.detail ?? e.message;
    return e instanceof Error ? e.message : String(e);
  }
  function peerLabel() {
    const paired = status?.peers.filter((p) => p.paired) ?? [];
    if (paired.length === 1) return paired[0]?.label ?? null;
    if (paired.length > 1) return `${paired.length} \u53F0\u8BBE\u5907`;
    return null;
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
        title: "\u5FEB\u4F20 \xB7 TRANSFER",
        children: [deniedNote("quickTransfer.status", "\u770B\u4E0D\u5230\u5FEB\u4F20\u7684\u72B6\u6001", "\u6CA1\u6709\u8FD9\u9879\u6388\u6743\u65F6\u65E0\u6CD5\u77E5\u9053\u670D\u52A1\u5F00\u6CA1\u5F00\u3001\u624B\u673A\u8FDE\u6CA1\u8FDE\u3002")]
      });
    }
    if (statusProblem) {
      return ui.section({
        title: "\u5FEB\u4F20 \xB7 TRANSFER",
        children: [ui.note({ tint: "danger", symbol: "exclamationmark.triangle", title: "\u8BFB\u4E0D\u5230\u5FEB\u4F20\u72B6\u6001", body: statusProblem })]
      });
    }
    if (!status || status.state === "stopped" || status.state === "failed") {
      const canStart = has("quickTransfer.control");
      return ui.section({
        title: "\u5FEB\u4F20 \xB7 TRANSFER",
        trailing: "\u672A\u5F00\u542F",
        children: [
          ui.note({
            tint: "alert",
            symbol: "antenna.radiowaves.left.and.right",
            title: status?.state === "failed" ? "\u5FEB\u4F20\u6CA1\u8D77\u6765" : "\u5FEB\u4F20\u8FD8\u6CA1\u5F00",
            body: status?.failureReason ?? "\u53D1\u9001\u8981\u5148\u628A\u5FEB\u4F20\u5F00\u8D77\u6765\uFF0C\u624B\u673A\u626B\u7801\u63A5\u5165\u4E4B\u540E\u624D\u6536\u5F97\u5230\u3002",
            actions: canStart ? [{ id: "start", title: "\u5F00\u542F\u5FEB\u4F20", onPress: () => void startTransfer() }] : [{ id: "grant-control", title: "\u6388\u6743\u5F00\u542F", onPress: () => void requestCapabilities(["quickTransfer.control"]) }]
          })
        ]
      });
    }
    const peer = peerLabel();
    return ui.section({
      title: "\u5FEB\u4F20 \xB7 TRANSFER",
      trailing: status.state === "starting" ? "\u542F\u52A8\u4E2D" : "\u670D\u52A1\u4E2D",
      children: [
        ui.readout({ label: "\u5730\u5740", value: status.url ?? "\u2014", tint: "accent", copy: true }),
        ui.readout({ label: "\u5DF2\u63A5\u5165", value: peer ?? "\u8FD8\u6CA1\u6709\u624B\u673A\u63A5\u5165 \xB7 \u5728\u5FEB\u4F20\u91CC\u626B\u7801", tint: peer ? "live" : "neutral" })
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
      children.push(ui.note({ tint: "danger", symbol: "exclamationmark.triangle", body: failure }));
    }
    if (lastSentAt && !failure) {
      children.push(ui.text({ text: `\u4E0A\u6B21\u53D1\u9001 ${new Date(lastSentAt).toLocaleTimeString()}`, style: "footnote" }));
    }
    const button = ui.button({
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
    return ui.section({ title: "\u53D1\u9001 \xB7 SEND", children });
  }
  defineExtension({
    page: {
      async activate(context) {
        granted = new Set(context.granted);
        prefs = {
          trimWhitespace: Boolean(context.preferences["trimWhitespace"] ?? true),
          confirmBeforeSend: Boolean(context.preferences["confirmBeforeSend"] ?? false)
        };
        await refreshStatus();
        if (has("quickTransfer.status")) {
          unsubscribe = jarvis.quickTransfer.observe((next) => {
            status = next;
            jarvis.ui.update();
          });
        }
        jarvis.preferences.onChange((changes) => {
          if ("trimWhitespace" in changes) prefs.trimWhitespace = Boolean(changes["trimWhitespace"]);
          if ("confirmBeforeSend" in changes) prefs.confirmBeforeSend = Boolean(changes["confirmBeforeSend"]);
        });
      },
      render() {
        return ui.scroll({ children: [contentSection(), transferSection(), actionSection()] });
      },
      deactivate() {
        unsubscribe?.();
        unsubscribe = null;
      }
    },
    async onInboxAction(cardId, actionId) {
      if (cardId === "sent" && actionId === "again") {
        await send();
      }
    }
  });
})();
