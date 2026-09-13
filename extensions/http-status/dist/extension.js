// jarvis-extension bundle · http-status@0.1.0 · sdk 1.5.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
  var sdkVersion = "1.5.0";
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
      update: () => runtime.requestUpdate(),
      dismissPopover: () => runtime.invoke("ui", "dismissPopover", {})
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
        encode: (text, options) => sync.text("base64.encode", { text, ...options }),
        decode: (text, options) => sync.text("base64.decode", { text, ...options })
      },
      hash: {
        digest: (algorithm, text, options) => sync.text("hash.digest", { algorithm, text, ...options })
      },
      json: {
        format: (text, options) => sync.text("json.format", { text, ...options }),
        minify: (text, options) => sync.text("json.minify", { text, ...options })
      },
      url: {
        parse: (text) => sync.text("url.parse", { text }),
        build: (parts) => sync.text("url.build", parts)
      },
      regex: {
        test: (pattern, text, flags) => sync.text("regex.test", { pattern, text, flags })
      },
      language: {
        detect: (text, options) => sync.text("language.detect", { text, ...options }),
        displayName: (code) => sync.text("language.displayName", { code })
      }
    },
    time: {
      parse: (text, unit) => sync.time("parse", { text, unit }),
      format: (epochMilliseconds, pattern, timeZone) => sync.time("format", { epochMilliseconds, pattern, timeZone }),
      timeZones: () => sync.time("timeZones")
    },
    color: {
      convert: (hex) => sync.color("convert", { hex })
    },
    clipboard: {
      read: () => call.clipboard("read"),
      readImage: () => call.clipboard("readImage"),
      write: (text) => call.clipboard("write", { text }),
      history: (options) => call.clipboard("history", options),
      entryText: (id) => call.clipboard("entryText", { id }),
      observe: (listener) => runtime.subscribe("clipboard", "observe", listener)
    },
    quickTransfer: {
      status: () => call.quickTransfer("status"),
      observe: (listener) => runtime.subscribe("quickTransfer", "observe", listener),
      start: () => call.quickTransfer("start"),
      stop: () => call.quickTransfer("stop"),
      sendText: (text) => call.quickTransfer("sendText", { text }),
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
      speak: (text, options) => call.speech("speak", { text, ...options }),
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

  // extensions/http-status/src/data.ts
  var rfc9110 = (section) => `https://www.rfc-editor.org/rfc/rfc9110#section-${section}`;
  var rfc = (number, section) => `https://www.rfc-editor.org/rfc/rfc${number}${section ? `#section-${section}` : ""}`;
  var entries = [
    // ── 1xx 信息 ────────────────────────────────────────────────────────────
    {
      code: 100,
      name: "Continue",
      zh: "\u7EE7\u7EED",
      summary: "\u670D\u52A1\u7AEF\u6536\u5230\u4E86\u8BF7\u6C42\u5934\uFF0C\u613F\u610F\u63A5\u7740\u6536\u6B63\u6587\u3002\u53EA\u6709\u5BA2\u6237\u7AEF\u5148\u53D1\u4E86 Expect: 100-continue \u624D\u4F1A\u51FA\u73B0\u3002",
      causes: ["\u5BA2\u6237\u7AEF\u5E26 Expect: 100-continue \u53D1\u4E86\u4E00\u4E2A\u5927 body"],
      fix: ["\u4E0D\u7528\u5904\u7406\uFF1AHTTP \u5E93\u4F1A\u81EA\u5DF1\u63A5\u7740\u53D1 body\uFF0C\u6700\u7EC8\u72B6\u6001\u662F\u540E\u9762\u90A3\u4E2A"],
      related: [417, 413],
      spec: "RFC 9110 \xA715.2.1",
      specUrl: rfc9110("15.2.1"),
      cacheable: false,
      retriable: "no",
      aliases: ["expect"]
    },
    {
      code: 101,
      name: "Switching Protocols",
      zh: "\u5207\u6362\u534F\u8BAE",
      summary: "\u670D\u52A1\u7AEF\u540C\u610F\u6309 Upgrade \u5934\u6362\u534F\u8BAE\uFF0C\u8FD9\u6761\u8FDE\u63A5\u4E4B\u540E\u4E0D\u518D\u662F\u666E\u901A HTTP\u3002ws:// \u63E1\u624B\u6210\u529F\u5C31\u662F\u5B83\u3002",
      causes: ["ws:// \u63E1\u624B\uFF08Upgrade: websocket\uFF09", "h2c \u5347\u7EA7"],
      fix: ["\u63E1\u624B\u6210\u529F\uFF1A\u63A5\u7740\u6309\u65B0\u534F\u8BAE\u8BFB\u5199\u8FD9\u6761\u8FDE\u63A5"],
      related: [426, 400],
      spec: "RFC 9110 \xA715.2.2",
      specUrl: rfc9110("15.2.2"),
      cacheable: false,
      retriable: "no",
      aliases: ["websocket", "upgrade", "ws"]
    },
    {
      code: 102,
      name: "Processing",
      zh: "\u5904\u7406\u4E2D",
      summary: "WebDAV \u7684\u4E34\u65F6\u54CD\u5E94\uFF1A\u8BF7\u6C42\u6536\u5230\u4E86\u3001\u8FD8\u5728\u505A\uFF0C\u522B\u8D85\u65F6\u3002\u5DF2\u5F88\u5C11\u89C1\u3002",
      related: [207],
      spec: "RFC 2518 \xA710.1",
      specUrl: rfc(2518, "10.1"),
      cacheable: false,
      retriable: "no",
      aliases: ["webdav"]
    },
    {
      code: 103,
      name: "Early Hints",
      zh: "\u65E9\u671F\u63D0\u793A",
      summary: "\u6B63\u5F0F\u54CD\u5E94\u4E4B\u524D\u5148\u628A Link \u5934\u53D1\u7ED9\u4F60\uFF0C\u8BA9\u6D4F\u89C8\u5668\u63D0\u524D\u9884\u8FDE\u63A5\u3001\u9884\u52A0\u8F7D\u3002\u540E\u9762\u4E00\u5B9A\u8FD8\u6709\u4E00\u4E2A\u6B63\u5F0F\u72B6\u6001\u3002",
      causes: ["CDN \u6216\u6846\u67B6\u5F00\u4E86 early hints \u6765\u62A2\u9996\u5C4F"],
      fix: ["\u5BA2\u6237\u7AEF\u5FFD\u7565\u5B83\u5373\u53EF\uFF1B\u771F\u6B63\u7684\u7ED3\u679C\u5728\u540E\u9762\u90A3\u4E2A\u54CD\u5E94\u91CC"],
      related: [200],
      spec: "RFC 8297",
      specUrl: rfc(8297),
      cacheable: false,
      retriable: "no",
      aliases: ["preload", "\u9884\u52A0\u8F7D"]
    },
    // ── 2xx 成功 ────────────────────────────────────────────────────────────
    {
      code: 200,
      name: "OK",
      zh: "\u6210\u529F",
      summary: "\u8BF7\u6C42\u6210\u529F\uFF0Cbody \u91CC\u662F\u7ED3\u679C\u3002\u6CE8\u610F\uFF1A\u4E1A\u52A1\u5931\u8D25\u4E5F\u53EF\u80FD\u88F9\u5728 200 \u91CC\u8FD4\u56DE\uFF0C\u522B\u53EA\u770B\u72B6\u6001\u7801\u3002",
      causes: ["\u4E00\u5207\u6B63\u5E38"],
      fix: ["\u63A5\u53E3\u628A\u9519\u8BEF\u585E\u8FDB 200 \u7684 body \u65F6\uFF0C\u76D1\u63A7\u8981\u8BFB body \u800C\u4E0D\u662F\u53EA\u8BFB\u72B6\u6001\u7801"],
      related: [201, 204, 206],
      spec: "RFC 9110 \xA715.3.1",
      specUrl: rfc9110("15.3.1"),
      cacheable: true,
      retriable: "yes",
      aliases: ["ok", "\u6210\u529F"]
    },
    {
      code: 201,
      name: "Created",
      zh: "\u5DF2\u521B\u5EFA",
      summary: "\u8D44\u6E90\u5EFA\u597D\u4E86\uFF0CLocation \u5934\u6307\u5411\u5B83\u3002POST \u5EFA\u8D44\u6E90\u7684\u6807\u51C6\u7B54\u6848\u3002",
      causes: ["POST / PUT \u65B0\u5EFA\u4E86\u8D44\u6E90"],
      fix: ["\u5FC5\u987B\u5E26 Location\uFF1Bbody \u91CC\u7ED9\u65B0\u8D44\u6E90\u7684\u8868\u793A\u6216\u5B83\u7684 id"],
      related: [200, 202, 204],
      spec: "RFC 9110 \xA715.3.2",
      specUrl: rfc9110("15.3.2"),
      cacheable: false,
      retriable: "no",
      aliases: ["created", "\u521B\u5EFA"]
    },
    {
      code: 202,
      name: "Accepted",
      zh: "\u5DF2\u63A5\u53D7",
      summary: "\u6536\u4E0B\u4E86\uFF0C\u4F46\u8FD8\u6CA1\u505A\u5B8C\uFF0C\u751A\u81F3\u53EF\u80FD\u6700\u540E\u4E0D\u505A\u3002\u5F02\u6B65\u4EFB\u52A1\u7684\u5165\u53E3\uFF0C\u4E0D\u4FDD\u8BC1\u7ED3\u679C\u3002",
      causes: ["\u8BF7\u6C42\u8FDB\u4E86\u961F\u5217\uFF0C\u7531\u540E\u53F0 worker \u5904\u7406"],
      fix: ["\u7ED9\u4E00\u4E2A\u80FD\u67E5\u8FDB\u5EA6\u7684\u5730\u5740\uFF0C\u5426\u5219\u8C03\u7528\u65B9\u65E0\u4ECE\u77E5\u9053\u7ED3\u5C40"],
      related: [201, 303],
      spec: "RFC 9110 \xA715.3.3",
      specUrl: rfc9110("15.3.3"),
      cacheable: false,
      retriable: "no",
      aliases: ["async", "\u5F02\u6B65"]
    },
    {
      code: 203,
      name: "Non-Authoritative Information",
      zh: "\u975E\u6743\u5A01\u4FE1\u606F",
      summary: "\u6210\u529F\uFF0C\u4F46 body \u88AB\u4E2D\u95F4\u4EE3\u7406\u6539\u8FC7\uFF0C\u4E0D\u662F\u6E90\u7AD9\u7684\u539F\u8BDD\u3002",
      related: [200],
      spec: "RFC 9110 \xA715.3.4",
      specUrl: rfc9110("15.3.4"),
      cacheable: true,
      retriable: "yes",
      aliases: ["proxy", "\u4EE3\u7406"]
    },
    {
      code: 204,
      name: "No Content",
      zh: "\u65E0\u5185\u5BB9",
      summary: "\u6210\u529F\uFF0C\u800C\u4E14\u660E\u786E\u6CA1\u6709 body\u3002DELETE \u4E0E PUT \u66F4\u65B0\u6700\u5E38\u7528\u5B83\u3002",
      causes: ["\u5220\u9664\u6210\u529F", "\u66F4\u65B0\u6210\u529F\u4F46\u4E0D\u9700\u8981\u56DE\u5185\u5BB9"],
      fix: ["\u522B\u5728 204 \u91CC\u585E body\u2014\u2014\u5F88\u591A\u5BA2\u6237\u7AEF\u4F1A\u76F4\u63A5\u5FFD\u7565\uFF0C\u6216\u8005\u62A5\u534F\u8BAE\u9519"],
      related: [200, 205, 304],
      spec: "RFC 9110 \xA715.3.5",
      specUrl: rfc9110("15.3.5"),
      cacheable: true,
      retriable: "yes",
      aliases: ["empty", "\u7A7A"]
    },
    {
      code: 205,
      name: "Reset Content",
      zh: "\u91CD\u7F6E\u5185\u5BB9",
      summary: "\u6210\u529F\uFF0C\u5E76\u4E14\u8BF7\u5BA2\u6237\u7AEF\u628A\u8868\u5355\u6E05\u7A7A\u3002\u51E0\u4E4E\u53EA\u5728\u8001\u5F0F\u8868\u5355\u91CC\u89C1\u5F97\u5230\u3002",
      related: [204],
      spec: "RFC 9110 \xA715.3.6",
      specUrl: rfc9110("15.3.6"),
      cacheable: false,
      retriable: "yes"
    },
    {
      code: 206,
      name: "Partial Content",
      zh: "\u90E8\u5206\u5185\u5BB9",
      summary: "\u6309 Range \u5934\u53EA\u7ED9\u4E86\u4E00\u6BB5\u3002\u65AD\u70B9\u7EED\u4F20\u4E0E\u89C6\u9891\u62D6\u8FDB\u5EA6\u6761\u9760\u5B83\u3002",
      causes: ["\u5BA2\u6237\u7AEF\u53D1\u4E86 Range \u5934", "\u64AD\u653E\u5668\u5728\u62D6\u8FDB\u5EA6"],
      fix: ["\u5FC5\u987B\u5E26 Content-Range\uFF1B\u591A\u6BB5\u7528 multipart/byteranges"],
      related: [200, 416, 304],
      spec: "RFC 9110 \xA715.3.7",
      specUrl: rfc9110("15.3.7"),
      cacheable: true,
      retriable: "yes",
      aliases: ["range", "\u65AD\u70B9\u7EED\u4F20", "\u5206\u6BB5"]
    },
    {
      code: 207,
      name: "Multi-Status",
      zh: "\u591A\u72B6\u6001",
      summary: "WebDAV\uFF1A\u4E00\u6B21\u8BF7\u6C42\u91CC\u6BCF\u4E2A\u5B50\u8D44\u6E90\u5404\u6709\u5404\u7684\u72B6\u6001\uFF0Cbody \u662F\u4E00\u4EFD XML \u6E05\u5355\u3002",
      related: [102, 208],
      spec: "RFC 4918 \xA711.1",
      specUrl: rfc(4918, "11.1"),
      cacheable: false,
      retriable: "no",
      aliases: ["webdav"]
    },
    {
      code: 208,
      name: "Already Reported",
      zh: "\u5DF2\u62A5\u544A",
      summary: "WebDAV\uFF1A\u540C\u4E00\u4E2A\u8D44\u6E90\u5728\u8FD9\u6B21\u591A\u72B6\u6001\u54CD\u5E94\u91CC\u5DF2\u7ECF\u5217\u8FC7\u4E86\uFF0C\u4E0D\u518D\u91CD\u590D\u3002",
      related: [207],
      spec: "RFC 5842 \xA77.1",
      specUrl: rfc(5842, "7.1"),
      cacheable: false,
      retriable: "no",
      aliases: ["webdav"]
    },
    {
      code: 226,
      name: "IM Used",
      zh: "\u5DF2\u5E94\u7528\u5DEE\u91CF",
      summary: "\u54CD\u5E94\u662F\u5BF9\u67D0\u4E2A\u5DF2\u6709\u7248\u672C\u7684\u5DEE\u91CF\uFF08delta encoding\uFF09\uFF0C\u4E0D\u662F\u5B8C\u6574\u8868\u793A\u3002\u6781\u5C11\u89C1\u3002",
      related: [200],
      spec: "RFC 3229 \xA710.4.1",
      specUrl: rfc(3229, "10.4.1"),
      cacheable: true,
      retriable: "yes",
      aliases: ["delta"]
    },
    // ── 3xx 重定向 ──────────────────────────────────────────────────────────
    {
      code: 300,
      name: "Multiple Choices",
      zh: "\u591A\u79CD\u9009\u62E9",
      summary: "\u540C\u4E00\u4E2A\u5730\u5740\u6709\u597D\u51E0\u4E2A\u8868\u793A\uFF0C\u8BF7\u5BA2\u6237\u7AEF\u6311\u4E00\u4E2A\u3002\u6CA1\u6709\u7EDF\u4E00\u7684\u6311\u9009\u683C\u5F0F\uFF0C\u5B9E\u9645\u4E0A\u6CA1\u4EBA\u7528\u3002",
      related: [301, 406],
      spec: "RFC 9110 \xA715.4.1",
      specUrl: rfc9110("15.4.1"),
      cacheable: true,
      retriable: "yes"
    },
    {
      code: 301,
      name: "Moved Permanently",
      zh: "\u6C38\u4E45\u79FB\u52A8",
      summary: "\u8D44\u6E90\u6C38\u4E45\u6362\u4E86\u5730\u5740\uFF0C\u4EE5\u540E\u76F4\u63A5\u7528 Location \u91CC\u90A3\u4E2A\u3002\u6D4F\u89C8\u5668\u4F1A\u628A\u5B83\u8BB0\u5F88\u4E45\uFF0C\u6539\u9519\u4E86\u5F88\u96BE\u6536\u56DE\u3002",
      causes: ["\u57DF\u540D\u6216\u8DEF\u5F84\u8FC1\u79FB", "\u5F3A\u5236 https\u3001\u5F3A\u5236\u5E26/\u4E0D\u5E26 www"],
      fix: ["\u786E\u8BA4\u65B0\u5730\u5740\u7A33\u5B9A\u4E4B\u540E\u518D\u4E0A\uFF1B\u5148\u7528 302 \u8DD1\u4E00\u6BB5\u65F6\u95F4\u66F4\u5B89\u5168", "\u5E26\u4E0A Location\uFF1B\u7F13\u5B58\u671F\u9760 Cache-Control \u63A7\u5236\uFF0C\u522B\u53EA\u9760\u9ED8\u8BA4"],
      related: [308, 302, 410],
      spec: "RFC 9110 \xA715.4.2",
      specUrl: rfc9110("15.4.2"),
      cacheable: true,
      retriable: "yes",
      aliases: ["redirect", "\u91CD\u5B9A\u5411", "\u8DF3\u8F6C", "\u6C38\u4E45"]
    },
    {
      code: 302,
      name: "Found",
      zh: "\u4E34\u65F6\u79FB\u52A8",
      summary: "\u4E34\u65F6\u53BB Location \u90A3\u4E2A\u5730\u5740\uFF0C\u4E0B\u6B21\u8FD8\u6765\u8FD9\u91CC\u3002\u5386\u53F2\u4E0A\u5404\u5BB6\u5B9E\u73B0\u4F1A\u628A POST \u6539\u5199\u6210 GET\u2014\u2014\u8981\u660E\u786E\u8BED\u4E49\u5C31\u7528 303 \u6216 307\u3002",
      causes: ["\u767B\u5F55\u540E\u8DF3\u56DE", "\u7070\u5EA6\u6216 A/B \u5206\u6D41"],
      fix: ["\u60F3\u5F3A\u5236\u53D8 GET \u7528 303\uFF1B\u60F3\u4FDD\u6301\u65B9\u6CD5\u4E0E body \u7528 307"],
      related: [303, 307, 301],
      spec: "RFC 9110 \xA715.4.3",
      specUrl: rfc9110("15.4.3"),
      cacheable: false,
      retriable: "yes",
      aliases: ["redirect", "\u91CD\u5B9A\u5411", "\u8DF3\u8F6C", "\u4E34\u65F6"]
    },
    {
      code: 303,
      name: "See Other",
      zh: "\u53C2\u89C1\u5176\u4ED6",
      summary: "\u53BB Location \u90A3\u4E2A\u5730\u5740\u7528 GET \u770B\u7ED3\u679C\u3002POST \u4E4B\u540E\u9632\u91CD\u590D\u63D0\u4EA4\u7684\u6807\u51C6\u505A\u6CD5\uFF08POST/Redirect/GET\uFF09\u3002",
      causes: ["\u8868\u5355\u63D0\u4EA4\u5B8C\u8DF3\u5230\u7ED3\u679C\u9875"],
      fix: ["\u65E0\u8BBA\u539F\u8BF7\u6C42\u662F\u4EC0\u4E48\u65B9\u6CD5\uFF0C\u5BA2\u6237\u7AEF\u90FD\u6539\u7528 GET"],
      related: [302, 307, 201],
      spec: "RFC 9110 \xA715.4.4",
      specUrl: rfc9110("15.4.4"),
      cacheable: false,
      retriable: "yes",
      aliases: ["redirect", "\u91CD\u5B9A\u5411", "prg"]
    },
    {
      code: 304,
      name: "Not Modified",
      zh: "\u672A\u4FEE\u6539",
      summary: "\u4F60\u624B\u91CC\u90A3\u4EFD\u8FD8\u662F\u65B0\u7684\uFF0C\u6CA1\u6709 body\u3002\u6761\u4EF6\u8BF7\u6C42\uFF08If-None-Match / If-Modified-Since\uFF09\u547D\u4E2D\u7F13\u5B58\u3002",
      causes: ["\u5BA2\u6237\u7AEF\u5E26\u4E86 ETag \u6216 Last-Modified \u6765\u95EE"],
      fix: ["304 \u91CC\u4E0D\u8BB8\u5E26 body\uFF1BETag \u5FC5\u987B\u4E0E 200 \u65F6\u7684\u4E00\u81F4", "\u63A5\u53E3\u660E\u660E\u53D8\u4E86\u8FD8\u8FD4 304\uFF0C\u5148\u67E5 ETag \u662F\u4E0D\u662F\u6309\u5185\u5BB9\u7B97\u7684"],
      related: [200, 412, 204],
      spec: "RFC 9110 \xA715.4.5",
      specUrl: rfc9110("15.4.5"),
      cacheable: true,
      retriable: "yes",
      aliases: ["cache", "etag", "\u7F13\u5B58"]
    },
    {
      code: 305,
      name: "Use Proxy",
      zh: "\u4F7F\u7528\u4EE3\u7406",
      summary: "\u5DF2\u5E9F\u5F03\uFF1A\u51FA\u4E8E\u5B89\u5168\u539F\u56E0\uFF0C\u5BA2\u6237\u7AEF\u4E0D\u5F97\u9075\u5B88\u5B83\u3002",
      related: [302],
      spec: "RFC 9110 \xA715.4.6",
      specUrl: rfc9110("15.4.6"),
      cacheable: false,
      retriable: "no",
      aliases: ["deprecated", "\u5E9F\u5F03"]
    },
    {
      code: 306,
      name: "(Unused)",
      zh: "\u672A\u4F7F\u7528",
      summary: "\u65E9\u671F\u8349\u6848\u7528\u8FC7\uFF0C\u73B0\u5728\u4FDD\u7559\u4E0D\u5206\u914D\u3002\u770B\u5230\u5B83\u591A\u534A\u662F\u6709\u4EBA\u5728\u81EA\u9020\u7801\u3002",
      related: [305],
      spec: "RFC 9110 \xA715.4.7",
      specUrl: rfc9110("15.4.7"),
      cacheable: false,
      retriable: "no",
      aliases: ["unused", "\u4FDD\u7559"]
    },
    {
      code: 307,
      name: "Temporary Redirect",
      zh: "\u4E34\u65F6\u91CD\u5B9A\u5411",
      summary: "\u4E34\u65F6\u6362\u5730\u5740\uFF0C\u800C\u4E14\u300C\u65B9\u6CD5\u4E0E body \u539F\u6837\u4FDD\u7559\u300D\u3002302 \u8BED\u4E49\u542B\u7CCA\u65F6\u7528\u5B83\u3002",
      causes: ["\u7EF4\u62A4\u671F\u628A\u5199\u8BF7\u6C42\u5F15\u5230\u5907\u7528\u5730\u5740"],
      fix: ["POST \u4ECD\u7136\u662F POST\uFF1A\u76EE\u6807\u7AEF\u8981\u63A5\u5F97\u4F4F\u540C\u6837\u7684 body"],
      related: [302, 303, 308],
      spec: "RFC 9110 \xA715.4.8",
      specUrl: rfc9110("15.4.8"),
      cacheable: false,
      retriable: "yes",
      aliases: ["redirect", "\u91CD\u5B9A\u5411", "\u4E34\u65F6"]
    },
    {
      code: 308,
      name: "Permanent Redirect",
      zh: "\u6C38\u4E45\u91CD\u5B9A\u5411",
      summary: "\u6C38\u4E45\u6362\u5730\u5740\uFF0C\u65B9\u6CD5\u4E0E body \u539F\u6837\u4FDD\u7559\u3002301 \u7684\u300C\u4E0D\u6539\u65B9\u6CD5\u300D\u7248\u672C\u3002",
      causes: ["API \u7248\u672C\u8FC1\u79FB\uFF0CPOST \u4E5F\u8981\u8DDF\u7740\u8D70"],
      fix: ["\u548C 301 \u4E00\u6837\u4F1A\u88AB\u957F\u671F\u7F13\u5B58\uFF1A\u5148\u786E\u8BA4\u65B0\u5730\u5740\u662F\u7EC8\u6001"],
      related: [301, 307],
      spec: "RFC 9110 \xA715.4.9",
      specUrl: rfc9110("15.4.9"),
      cacheable: true,
      retriable: "yes",
      aliases: ["redirect", "\u91CD\u5B9A\u5411", "\u6C38\u4E45"]
    },
    // ── 4xx 客户端错误 ──────────────────────────────────────────────────────
    {
      code: 400,
      name: "Bad Request",
      zh: "\u8BF7\u6C42\u6709\u8BEF",
      summary: "\u670D\u52A1\u7AEF\u8BA4\u4E3A\u8FD9\u4E2A\u8BF7\u6C42\u672C\u8EAB\u5C31\u4E0D\u5408\u6CD5\uFF0C\u4E0D\u6253\u7B97\u518D\u7406\u89E3\u5B83\u3002\u5F88\u591A\u6846\u67B6\u4E5F\u628A\u53C2\u6570\u6821\u9A8C\u5931\u8D25\u585E\u8FDB\u8FD9\u91CC\u3002",
      causes: ["JSON \u8BED\u6CD5\u9519\u3001\u5B57\u6BB5\u7C7B\u578B\u4E0D\u5BF9\u3001\u5FC5\u586B\u9879\u7F3A\u5931", "\u8BF7\u6C42\u884C\u6216\u5934\u90E8\u4E0D\u5408\u8BED\u6CD5\uFF08\u7F51\u5173\u76F4\u63A5\u6321\u4E0B\uFF09", "Content-Length \u4E0E\u5B9E\u9645 body \u5BF9\u4E0D\u4E0A"],
      fix: ["\u5148\u5206\u6E05\u662F\u7F51\u5173\u6321\u7684\u8FD8\u662F\u5E94\u7528\u8FD4\u7684\uFF1A\u7F51\u5173\u7684 400 \u901A\u5E38\u6CA1\u6709 JSON body", "body \u91CC\u5199\u6E05\u695A\u54EA\u4E2A\u5B57\u6BB5\u9519\u4E86\uFF1B\u53EA\u56DE\u4E00\u53E5 Bad Request \u7B49\u4E8E\u4EC0\u4E48\u90FD\u6CA1\u8BF4", "\u53C2\u6570\u6821\u9A8C\u5931\u8D25\u66F4\u51C6\u786E\u7684\u7801\u662F 422\uFF08\u8BED\u6CD5\u5BF9\u3001\u8BED\u4E49\u4E0D\u5BF9\uFF09"],
      related: [422, 404, 500],
      spec: "RFC 9110 \xA715.5.1",
      specUrl: rfc9110("15.5.1"),
      cacheable: false,
      retriable: "no",
      aliases: ["bad request", "\u53C2\u6570\u9519\u8BEF", "\u8BF7\u6C42\u9519\u8BEF"]
    },
    {
      code: 401,
      name: "Unauthorized",
      zh: "\u672A\u8BA4\u8BC1",
      summary: "\u540D\u5B57\u9A97\u4EBA\uFF1A\u5B83\u8BF4\u7684\u662F\u300C\u6CA1\u8BA4\u8BC1\u300D\uFF08\u4F60\u662F\u8C01\u4E0D\u77E5\u9053\uFF09\uFF0C\u4E0D\u662F\u6CA1\u6743\u9650\u3002\u5FC5\u987B\u5E26 WWW-Authenticate \u5934\u544A\u8BC9\u5BA2\u6237\u7AEF\u600E\u4E48\u8BA4\u8BC1\u3002",
      causes: ["\u6CA1\u5E26 Authorization \u5934", "token \u8FC7\u671F\u6216\u7B7E\u540D\u4E0D\u5BF9", "Cookie \u4F1A\u8BDD\u5DF2\u5931\u6548"],
      fix: ["\u54CD\u5E94\u5FC5\u987B\u5E26 WWW-Authenticate\uFF0C\u5426\u5219\u4E0D\u5408\u89C4\u8303", "\u5BA2\u6237\u7AEF\u62FF\u5230\u5B83\u5E94\u5F53\u53BB\u5237\u65B0 token\uFF0C\u800C\u4E0D\u662F\u539F\u6837\u91CD\u8BD5", "\u5DF2\u8BA4\u8BC1\u4F46\u6743\u9650\u4E0D\u591F\uFF0C\u8BE5\u8FD4 403"],
      related: [403, 407, 440],
      spec: "RFC 9110 \xA715.5.2",
      specUrl: rfc9110("15.5.2"),
      cacheable: false,
      retriable: "no",
      aliases: ["unauthorized", "auth", "\u8BA4\u8BC1", "\u767B\u5F55", "token"]
    },
    {
      code: 402,
      name: "Payment Required",
      zh: "\u9700\u8981\u4ED8\u8D39",
      summary: "\u9884\u7559\u7ED9\u4ED8\u8D39\u573A\u666F\u3002\u89C4\u8303\u91CC\u4E00\u76F4\u6CA1\u5B9A\u4E0B\u6765\uFF0C\u5B9E\u9645\u542B\u4E49\u7531\u5404\u5BB6 API \u81EA\u5DF1\u8BF4\uFF08\u914D\u989D\u7528\u5B8C\u3001\u8D26\u6237\u6B20\u8D39\uFF09\u3002",
      causes: ["SaaS \u914D\u989D\u7528\u5C3D\u6216\u8D26\u5355\u672A\u4ED8"],
      fix: ["\u81EA\u5BB6\u7528\u5B83\u5C31\u628A\u8D26\u5355\u9875\u5730\u5740\u5199\u8FDB body\uFF0C\u522B\u8BA9\u8C03\u7528\u65B9\u731C"],
      related: [403, 429],
      spec: "RFC 9110 \xA715.5.3",
      specUrl: rfc9110("15.5.3"),
      cacheable: false,
      retriable: "no",
      aliases: ["payment", "\u4ED8\u8D39", "\u914D\u989D"]
    },
    {
      code: 403,
      name: "Forbidden",
      zh: "\u7981\u6B62\u8BBF\u95EE",
      summary: "\u77E5\u9053\u4F60\u662F\u8C01\uFF0C\u5C31\u662F\u4E0D\u8BA9\u3002\u91CD\u65B0\u8BA4\u8BC1\u6CA1\u6709\u7528\u2014\u2014\u6362\u4E2A\u8EAB\u4EFD\u624D\u6709\u7528\u3002",
      causes: ["\u6743\u9650\u4E0D\u8DB3\u3001\u8D8A\u6743\u8BBF\u95EE\u522B\u4EBA\u7684\u8D44\u6E90", "IP / \u5730\u57DF / WAF \u89C4\u5219\u6321\u4E0B", "\u76EE\u5F55\u6CA1\u6709\u7D22\u5F15\u6743\u9650\uFF08\u9759\u6001\u7AD9\u70B9\u5E38\u89C1\uFF09"],
      fix: ["\u4E0D\u60F3\u66B4\u9732\u8D44\u6E90\u662F\u5426\u5B58\u5728\u65F6\uFF0C\u89C4\u8303\u5141\u8BB8\u6539\u7528 404", "WAF \u62E6\u622A\u7684 403 \u901A\u5E38\u6CA1\u6709\u5E94\u7528\u65E5\u5FD7\uFF1A\u5148\u770B\u7F51\u5173\u90A3\u4E00\u4FA7", "\u8EAB\u4EFD\u6CA1\u8BA4\u51FA\u6765\u5E94\u8BE5\u8FD4 401\uFF0C\u4E0D\u662F 403"],
      related: [401, 404, 451],
      spec: "RFC 9110 \xA715.5.4",
      specUrl: rfc9110("15.5.4"),
      cacheable: false,
      retriable: "no",
      aliases: ["forbidden", "\u6743\u9650", "\u7981\u6B62"]
    },
    {
      code: 404,
      name: "Not Found",
      zh: "\u672A\u627E\u5230",
      summary: "\u670D\u52A1\u5668\u8BA4\u5F97\u8FD9\u53F0\u4E3B\u673A\uFF0C\u4F46\u8FD9\u6761\u8DEF\u5F84\u4E0A\u6CA1\u6709\u8D44\u6E90\u3002\u5B83\u4E0D\u8868\u793A\u6C38\u4E45\u2014\u2014\u6C38\u4E45\u79FB\u9664\u8BE5\u8FD4\u56DE 410\u3002",
      causes: ["\u8DEF\u5F84\u62FC\u9519\u3001\u5927\u5C0F\u5199\u4E0D\u7B26\u3001\u5C11\u4E86\u5C3E\u659C\u6760", "SPA \u5237\u65B0\u65F6\u524D\u7AEF\u8DEF\u7531\u6CA1\u843D\u5230 index.html", "\u7F51\u5173\u6309 host \u9009\u9519 upstream\uFF0C\u6216\u8D44\u6E90\u771F\u7684\u5DF2\u5220"],
      fix: ["\u5148\u5206\u6E05\u662F\u6E90\u7AD9\u8FD8\u662F\u7F51\u5173\u8FD4\u7684\uFF1A\u770B Via / X-Cache \u5934", "\u6C38\u4E45\u79FB\u9664\u8FD4 410\uFF1B\u6362\u4E86\u5730\u5740\u8FD4 301 + Location", "\u540C\u4E00\u4E2A URL \u91CD\u8BD5\u4E0D\u4F1A\u53D8\u6210 200\uFF0C\u522B\u9000\u907F\u91CD\u8BD5"],
      related: [410, 403, 301, 400],
      spec: "RFC 9110 \xA715.5.5",
      specUrl: rfc9110("15.5.5"),
      cacheable: true,
      retriable: "no",
      aliases: ["not found", "\u627E\u4E0D\u5230", "404"]
    },
    {
      code: 405,
      name: "Method Not Allowed",
      zh: "\u65B9\u6CD5\u4E0D\u5141\u8BB8",
      summary: "\u5730\u5740\u5B58\u5728\uFF0C\u4F46\u4E0D\u63A5\u53D7\u8FD9\u4E2A\u65B9\u6CD5\u3002\u54CD\u5E94\u5FC5\u987B\u5E26 Allow \u5934\u5217\u51FA\u63A5\u53D7\u54EA\u4E9B\u3002",
      causes: ["\u7528 POST \u6253\u4E86\u53EA\u8BFB\u63A5\u53E3", "CORS \u9884\u68C0\u7684 OPTIONS \u6CA1\u6709\u88AB\u8DEF\u7531\u5904\u7406"],
      fix: ["\u5FC5\u987B\u5E26 Allow: GET, POST \u2026", "OPTIONS \u88AB 405 \u6321\u6389\u65F6\uFF0C\u8DE8\u57DF\u9884\u68C0\u4F1A\u6574\u4E2A\u5931\u8D25"],
      related: [501, 400, 404],
      spec: "RFC 9110 \xA715.5.6",
      specUrl: rfc9110("15.5.6"),
      cacheable: true,
      retriable: "no",
      aliases: ["method", "\u65B9\u6CD5"]
    },
    {
      code: 406,
      name: "Not Acceptable",
      zh: "\u65E0\u6CD5\u63A5\u53D7",
      summary: "\u6309\u4F60\u7684 Accept \u5934\u6311\u4E0D\u51FA\u80FD\u7ED9\u7684\u8868\u793A\u3002\u5B9E\u9645\u4E0A\u5927\u591A\u6570\u670D\u52A1\u7AEF\u4F1A\u5FFD\u7565 Accept \u76F4\u63A5\u8FD4\u56DE\u9ED8\u8BA4\u683C\u5F0F\u3002",
      causes: ["Accept: application/xml \u4F46\u63A5\u53E3\u53EA\u51FA JSON"],
      fix: ["\u8981\u4E48\u653E\u5BBD Accept\uFF0C\u8981\u4E48\u8BA9\u670D\u52A1\u7AEF\u7ED9\u9ED8\u8BA4\u8868\u793A"],
      related: [415, 300],
      spec: "RFC 9110 \xA715.5.7",
      specUrl: rfc9110("15.5.7"),
      cacheable: false,
      retriable: "no",
      aliases: ["accept", "\u5185\u5BB9\u534F\u5546"]
    },
    {
      code: 407,
      name: "Proxy Authentication Required",
      zh: "\u9700\u8981\u4EE3\u7406\u8BA4\u8BC1",
      summary: "401 \u7684\u4EE3\u7406\u7248\uFF1A\u8981\u5148\u5411\u300C\u4EE3\u7406\u300D\u8BA4\u8BC1\u3002\u5FC5\u987B\u5E26 Proxy-Authenticate \u5934\u3002",
      causes: ["\u516C\u53F8\u7F51\u7EDC\u7684\u51FA\u53E3\u4EE3\u7406\u8981\u8D26\u53F7"],
      fix: ["\u5E26 Proxy-Authorization \u91CD\u8BD5\uFF1B\u8FD9\u6761\u4E0E\u6E90\u7AD9\u7684\u9274\u6743\u65E0\u5173"],
      related: [401, 502],
      spec: "RFC 9110 \xA715.5.8",
      specUrl: rfc9110("15.5.8"),
      cacheable: false,
      retriable: "no",
      aliases: ["proxy", "\u4EE3\u7406"]
    },
    {
      code: 408,
      name: "Request Timeout",
      zh: "\u8BF7\u6C42\u8D85\u65F6",
      summary: "\u5BA2\u6237\u7AEF\u6CA1\u5728\u670D\u52A1\u7AEF\u613F\u610F\u7B49\u7684\u65F6\u95F4\u91CC\u628A\u8BF7\u6C42\u53D1\u5B8C\u3002\u8BF4\u7684\u662F\u300C\u53D1\u8BF7\u6C42\u300D\u8FD9\u4E00\u6BB5\uFF0C\u4E0D\u662F\u5904\u7406\u6162\u3002",
      causes: ["keep-alive \u7A7A\u95F2\u8FDE\u63A5\u88AB\u670D\u52A1\u7AEF\u56DE\u6536", "\u4E0A\u4F20\u6162\u6216\u4E2D\u9014\u65AD\u6D41", "\u5BA2\u6237\u7AEF\u5F00\u4E86\u8FDE\u63A5\u5374\u8FDF\u8FDF\u4E0D\u53D1\u8BF7\u6C42\u5934"],
      fix: ["\u5E42\u7B49\u8BF7\u6C42\u53EF\u4EE5\u76F4\u63A5\u91CD\u5F00\u4E00\u6761\u8FDE\u63A5\u91CD\u8BD5", "\u8C03\u5927 nginx \u7684 client_header_timeout / client_body_timeout"],
      related: [504, 425, 499],
      spec: "RFC 9110 \xA715.5.9",
      specUrl: rfc9110("15.5.9"),
      cacheable: false,
      retriable: "yes",
      aliases: ["timeout", "\u8D85\u65F6"]
    },
    {
      code: 409,
      name: "Conflict",
      zh: "\u51B2\u7A81",
      summary: "\u8BF7\u6C42\u4E0E\u8D44\u6E90\u6B64\u523B\u7684\u72B6\u6001\u51B2\u7A81\uFF0C\u91CD\u8BD5\u540C\u6837\u7684\u5185\u5BB9\u8FD8\u662F\u4F1A\u51B2\u7A81\u2014\u2014\u8981\u5148\u89E3\u51B3\u51B2\u7A81\u3002",
      causes: ["\u4E50\u89C2\u9501\u7248\u672C\u53F7\u5BF9\u4E0D\u4E0A", "\u552F\u4E00\u952E\u91CD\u590D\uFF08\u7528\u6237\u540D\u5DF2\u88AB\u5360\u7528\uFF09"],
      fix: ["body \u91CC\u8BF4\u6E05\u695A\u8DDF\u4EC0\u4E48\u51B2\u7A81\u4E86\uFF0C\u8BA9\u8C03\u7528\u65B9\u80FD\u81EA\u5DF1\u89E3\u51B3", "\u5E76\u53D1\u66F4\u65B0\u7528 ETag + If-Match\uFF0C\u51B2\u7A81\u65F6\u8FD4 412 \u66F4\u51C6\u786E"],
      related: [412, 422, 423],
      spec: "RFC 9110 \xA715.5.10",
      specUrl: rfc9110("15.5.10"),
      cacheable: false,
      retriable: "no",
      aliases: ["conflict", "\u51B2\u7A81", "\u91CD\u590D"]
    },
    {
      code: 410,
      name: "Gone",
      zh: "\u5DF2\u6C38\u4E45\u5220\u9664",
      summary: "\u66FE\u7ECF\u6709\uFF0C\u73B0\u5728\u6C38\u4E45\u6CA1\u4E86\uFF0C\u522B\u518D\u6765\u95EE\u3002\u6BD4 404 \u66F4\u660E\u786E\uFF0C\u4E5F\u66F4\u9002\u5408\u8BA9\u641C\u7D22\u5F15\u64CE\u5220\u7D22\u5F15\u3002",
      causes: ["\u8D44\u6E90\u88AB\u4E3B\u52A8\u4E0B\u7EBF\u4E14\u4E0D\u6253\u7B97\u6062\u590D"],
      fix: ["\u4E0D\u786E\u5B9A\u662F\u4E0D\u662F\u6C38\u4E45\u5C31\u7528 404\u2014\u2014410 \u662F\u4E2A\u627F\u8BFA"],
      related: [404, 301, 451],
      spec: "RFC 9110 \xA715.5.11",
      specUrl: rfc9110("15.5.11"),
      cacheable: true,
      retriable: "no",
      aliases: ["gone", "\u5220\u9664", "\u4E0B\u7EBF"]
    },
    {
      code: 411,
      name: "Length Required",
      zh: "\u9700\u8981\u957F\u5EA6",
      summary: "\u670D\u52A1\u7AEF\u62D2\u7EDD\u6CA1\u6709 Content-Length \u7684\u8BF7\u6C42\u3002",
      causes: ["\u7528\u4E86\u5206\u5757\u4F20\u8F93\u4F46\u670D\u52A1\u7AEF\u4E0D\u63A5\u53D7"],
      fix: ["\u8865\u4E0A Content-Length\uFF0C\u6216\u8005\u8BA9\u670D\u52A1\u7AEF\u63A5\u53D7 chunked"],
      related: [400, 413],
      spec: "RFC 9110 \xA715.5.12",
      specUrl: rfc9110("15.5.12"),
      cacheable: false,
      retriable: "no"
    },
    {
      code: 412,
      name: "Precondition Failed",
      zh: "\u524D\u7F6E\u6761\u4EF6\u5931\u8D25",
      summary: "\u6761\u4EF6\u8BF7\u6C42\u91CC\u7684\u6761\u4EF6\u4E0D\u6210\u7ACB\uFF08If-Match / If-Unmodified-Since\uFF09\u3002\u5E76\u53D1\u66F4\u65B0\u7684\u6807\u51C6\u4FDD\u62A4\u3002",
      causes: ["\u522B\u4EBA\u5148\u6539\u4E86\uFF0CETag \u5DF2\u7ECF\u53D8\u4E86"],
      fix: ["\u91CD\u65B0 GET \u62FF\u5230\u65B0 ETag\uFF0C\u5408\u5E76\u4E4B\u540E\u518D\u63D0\u4EA4"],
      related: [409, 428, 304],
      spec: "RFC 9110 \xA715.5.13",
      specUrl: rfc9110("15.5.13"),
      cacheable: false,
      retriable: "no",
      aliases: ["etag", "\u5E76\u53D1"]
    },
    {
      code: 413,
      name: "Content Too Large",
      zh: "\u8BF7\u6C42\u4F53\u8FC7\u5927",
      summary: "body \u8D85\u8FC7\u670D\u52A1\u7AEF\u613F\u610F\u6536\u7684\u5927\u5C0F\u3002\u65E7\u540D\u5B57\u662F Payload Too Large\u3002",
      causes: ["\u4E0A\u4F20\u8D85\u8FC7 nginx \u7684 client_max_body_size", "\u7F51\u5173\u6216\u51FD\u6570\u8BA1\u7B97\u7684\u8BF7\u6C42\u4F53\u4E0A\u9650"],
      fix: ["\u5206\u7247\u4E0A\u4F20\uFF0C\u6216\u8C03\u5927\u7F51\u5173\u4E0E\u5E94\u7528\u4E24\u5904\u7684\u4E0A\u9650\u2014\u2014\u5B83\u4EEC\u901A\u5E38\u4E0D\u662F\u540C\u4E00\u4E2A\u503C", "\u670D\u52A1\u7AEF\u53EF\u4EE5\u5E26 Retry-After \u8868\u793A\u53EA\u662F\u4E34\u65F6\u9650"],
      related: [414, 431, 411],
      spec: "RFC 9110 \xA715.5.14",
      specUrl: rfc9110("15.5.14"),
      cacheable: false,
      retriable: "no",
      aliases: ["too large", "\u8FC7\u5927", "\u4E0A\u4F20"]
    },
    {
      code: 414,
      name: "URI Too Long",
      zh: "URI \u8FC7\u957F",
      summary: "\u5730\u5740\u592A\u957F\uFF0C\u670D\u52A1\u7AEF\u4E0D\u6536\u3002\u901A\u5E38\u662F\u628A\u8BE5\u653E body \u7684\u4E1C\u897F\u653E\u8FDB\u4E86\u67E5\u8BE2\u4E32\u3002",
      causes: ["GET \u5E26\u4E86\u4E00\u5927\u4E32\u67E5\u8BE2\u53C2\u6570", "\u91CD\u5B9A\u5411\u7ED5\u6210\u4E86\u73AF\uFF0C\u53C2\u6570\u8D8A\u6EDA\u8D8A\u957F"],
      fix: ["\u6539\u7528 POST \u628A\u53C2\u6570\u653E\u8FDB body"],
      related: [413, 431],
      spec: "RFC 9110 \xA715.5.15",
      specUrl: rfc9110("15.5.15"),
      cacheable: true,
      retriable: "no",
      aliases: ["uri", "url", "\u8FC7\u957F"]
    },
    {
      code: 415,
      name: "Unsupported Media Type",
      zh: "\u5A92\u4F53\u7C7B\u578B\u4E0D\u652F\u6301",
      summary: "body \u7684 Content-Type \u670D\u52A1\u7AEF\u4E0D\u8BA4\u3002\u6700\u5E38\u89C1\u7684\u539F\u56E0\u662F\u538B\u6839\u6CA1\u5E26\u8FD9\u4E2A\u5934\u3002",
      causes: ["\u53D1 JSON \u5374\u6CA1\u6709 Content-Type: application/json", "\u5E26\u4E86 charset \u6216\u989D\u5916\u53C2\u6570\u5BFC\u81F4\u4E0D\u5339\u914D"],
      fix: ["\u5BF9\u9F50 Content-Type\uFF1B\u63A5\u53E3\u6587\u6863\u91CC\u628A\u5B83\u5199\u51FA\u6765"],
      related: [406, 400, 422],
      spec: "RFC 9110 \xA715.5.16",
      specUrl: rfc9110("15.5.16"),
      cacheable: false,
      retriable: "no",
      aliases: ["media type", "content-type", "\u7C7B\u578B"]
    },
    {
      code: 416,
      name: "Range Not Satisfiable",
      zh: "\u8303\u56F4\u65E0\u6CD5\u6EE1\u8DB3",
      summary: "Range \u5934\u8981\u7684\u533A\u95F4\u8D85\u51FA\u4E86\u8D44\u6E90\u5927\u5C0F\u3002",
      causes: ["\u7EED\u4F20\u65F6\u6587\u4EF6\u5DF2\u7ECF\u53D8\u77ED\u6216\u88AB\u66FF\u6362"],
      fix: ["\u4E22\u6389\u672C\u5730\u5206\u7247\u91CD\u65B0\u4E0B\uFF1B\u54CD\u5E94\u5E94\u5E26 Content-Range: bytes */\u957F\u5EA6"],
      related: [206, 200],
      spec: "RFC 9110 \xA715.5.17",
      specUrl: rfc9110("15.5.17"),
      cacheable: false,
      retriable: "no",
      aliases: ["range", "\u65AD\u70B9\u7EED\u4F20"]
    },
    {
      code: 417,
      name: "Expectation Failed",
      zh: "\u9884\u671F\u5931\u8D25",
      summary: "Expect \u5934\u91CC\u7684\u8981\u6C42\u670D\u52A1\u7AEF\u6EE1\u8DB3\u4E0D\u4E86\uFF08\u5B9E\u9645\u4E0A\u53EA\u6709 100-continue \u8FD9\u4E00\u79CD\uFF09\u3002",
      related: [100],
      spec: "RFC 9110 \xA715.5.18",
      specUrl: rfc9110("15.5.18"),
      cacheable: false,
      retriable: "no",
      aliases: ["expect"]
    },
    {
      code: 421,
      name: "Misdirected Request",
      zh: "\u8BF7\u6C42\u53D1\u9519\u4E86\u5730\u65B9",
      summary: "\u8FD9\u6761\u8FDE\u63A5\u4E0D\u8BE5\u7528\u6765\u8BF7\u6C42\u8FD9\u4E2A authority\u3002HTTP/2 \u8FDE\u63A5\u590D\u7528\u65F6\uFF0C\u8BC1\u4E66\u8986\u76D6\u4E86\u591A\u4E2A\u57DF\u540D\u624D\u4F1A\u649E\u89C1\u3002",
      causes: ["HTTP/2 \u628A\u4E0D\u540C\u57DF\u540D\u7684\u8BF7\u6C42\u5408\u5E76\u5230\u4E86\u540C\u4E00\u6761\u8FDE\u63A5"],
      fix: ["\u5BA2\u6237\u7AEF\u5E94\u5F53\u6362\u4E00\u6761\u8FDE\u63A5\u91CD\u8BD5\uFF1B\u8FD9\u662F\u5C11\u6570\u503C\u5F97\u81EA\u52A8\u91CD\u8BD5\u7684 4xx"],
      related: [400, 502],
      spec: "RFC 9110 \xA715.5.20",
      specUrl: rfc9110("15.5.20"),
      cacheable: false,
      retriable: "yes",
      aliases: ["http2", "h2"]
    },
    {
      code: 422,
      name: "Unprocessable Content",
      zh: "\u65E0\u6CD5\u5904\u7406\u7684\u5185\u5BB9",
      summary: "\u8BED\u6CD5\u6CA1\u95EE\u9898\uFF0C\u8BED\u4E49\u4E0D\u5BF9\u2014\u2014JSON \u89E3\u6790\u5F97\u4E86\uFF0C\u4F46\u5B57\u6BB5\u7684\u503C\u8BF4\u4E0D\u901A\u3002\u4E1A\u52A1\u6821\u9A8C\u5931\u8D25\u7684\u51C6\u786E\u7B54\u6848\u3002",
      causes: ["\u65E5\u671F\u683C\u5F0F\u5BF9\u4F46\u843D\u5728\u672A\u6765", "\u4E24\u4E2A\u5B57\u6BB5\u4E92\u76F8\u77DB\u76FE"],
      fix: ["\u9010\u5B57\u6BB5\u7ED9\u51FA\u9519\u8BEF\u539F\u56E0\uFF0C\u522B\u53EA\u7ED9\u4E00\u53E5\u8BDD", "\u8BED\u6CD5\u672C\u8EAB\u5C31\u9519\u4E86\u8BE5\u7528 400"],
      related: [400, 409, 415],
      spec: "RFC 9110 \xA715.5.21",
      specUrl: rfc9110("15.5.21"),
      cacheable: false,
      retriable: "no",
      aliases: ["validation", "\u6821\u9A8C", "\u53C2\u6570"]
    },
    {
      code: 423,
      name: "Locked",
      zh: "\u5DF2\u9501\u5B9A",
      summary: "WebDAV\uFF1A\u8D44\u6E90\u88AB\u9501\u4F4F\u4E86\u3002",
      related: [409, 424],
      spec: "RFC 4918 \xA711.3",
      specUrl: rfc(4918, "11.3"),
      cacheable: false,
      retriable: "maybe",
      aliases: ["webdav", "\u9501"]
    },
    {
      code: 424,
      name: "Failed Dependency",
      zh: "\u4F9D\u8D56\u5931\u8D25",
      summary: "WebDAV\uFF1A\u56E0\u4E3A\u524D\u4E00\u4E2A\u8BF7\u6C42\u5931\u8D25\uFF0C\u8FD9\u4E2A\u4E5F\u505A\u4E0D\u4E86\u3002",
      related: [423, 207],
      spec: "RFC 4918 \xA711.4",
      specUrl: rfc(4918, "11.4"),
      cacheable: false,
      retriable: "no",
      aliases: ["webdav"]
    },
    {
      code: 425,
      name: "Too Early",
      zh: "\u592A\u65E9\u4E86",
      summary: "\u670D\u52A1\u7AEF\u4E0D\u613F\u5904\u7406 TLS 0-RTT \u65E9\u671F\u6570\u636E\u91CC\u7684\u8BF7\u6C42\uFF0C\u6015\u91CD\u653E\u3002",
      causes: ["\u5F00\u4E86 TLS 1.3 early data"],
      fix: ["\u7B49\u63E1\u624B\u5B8C\u6210\u518D\u91CD\u53D1\uFF1B\u8FD9\u4E00\u6761\u91CD\u8BD5\u662F\u5B89\u5168\u7684"],
      related: [408, 429],
      spec: "RFC 8470 \xA75.2",
      specUrl: rfc(8470, "5.2"),
      cacheable: false,
      retriable: "yes",
      aliases: ["tls", "0-rtt"]
    },
    {
      code: 426,
      name: "Upgrade Required",
      zh: "\u9700\u8981\u5347\u7EA7\u534F\u8BAE",
      summary: "\u5FC5\u987B\u6362\u534F\u8BAE\u624D\u4F3A\u5019\uFF0C\u54CD\u5E94\u5E26 Upgrade \u5934\u8BF4\u660E\u6362\u6210\u4EC0\u4E48\u3002",
      causes: ["\u63A5\u53E3\u53EA\u6536 HTTP/2 \u6216\u53EA\u6536 TLS"],
      fix: ["\u6309 Upgrade \u5934\u6362\u534F\u8BAE\u91CD\u8BD5"],
      related: [101, 505],
      spec: "RFC 9110 \xA715.5.22",
      specUrl: rfc9110("15.5.22"),
      cacheable: false,
      retriable: "no",
      aliases: ["upgrade", "\u5347\u7EA7"]
    },
    {
      code: 428,
      name: "Precondition Required",
      zh: "\u9700\u8981\u524D\u7F6E\u6761\u4EF6",
      summary: "\u670D\u52A1\u7AEF\u8981\u6C42\u4F60\u5E26\u6761\u4EF6\u5934\u518D\u6765\uFF0C\u514D\u5F97\u8986\u76D6\u522B\u4EBA\u7684\u4FEE\u6539\uFF08\u4E22\u5931\u66F4\u65B0\u95EE\u9898\uFF09\u3002",
      causes: ["PUT \u6CA1\u5E26 If-Match"],
      fix: ["\u5148 GET \u62FF ETag\uFF0C\u518D\u5E26 If-Match \u63D0\u4EA4"],
      related: [412, 409],
      spec: "RFC 6585 \xA73",
      specUrl: rfc(6585, "3"),
      cacheable: false,
      retriable: "no",
      aliases: ["etag", "\u5E76\u53D1"]
    },
    {
      code: 429,
      name: "Too Many Requests",
      zh: "\u8BF7\u6C42\u8FC7\u591A",
      summary: "\u4F60\u88AB\u9650\u6D41\u4E86\u3002\u54CD\u5E94\u901A\u5E38\u5E26 Retry-After\uFF1A\u90A3\u662F\u7B49\u5F85\u65F6\u95F4\u7684\u771F\u6E90\uFF0C\u522B\u81EA\u5DF1\u62CD\u8111\u888B\u3002",
      causes: ["\u8D85\u8FC7\u6BCF\u5206\u949F\u914D\u989D", "\u91CD\u8BD5\u98CE\u66B4\u628A\u81EA\u5DF1\u538B\u6B7B"],
      fix: ["\u8BFB Retry-After\uFF1B\u6CA1\u6709\u5C31\u6307\u6570\u9000\u907F + \u6296\u52A8", "\u9650\u6D41\u5E38\u5E38\u6309 (IP, \u5BA2\u6237\u7AEF\u6807\u8BC6) \u8BA1\u7B97\u2014\u2014\u6362\u4E2A client \u53C2\u6570\u53EF\u80FD\u5C31\u901A\u4E86", "\u522B\u5728\u5931\u8D25\u65F6\u7ACB\u523B\u91CD\u8BD5\uFF1A\u90A3\u6B63\u662F\u9650\u6D41\u5728\u7EDF\u8BA1\u7684\u4E1C\u897F"],
      related: [503, 402, 425],
      spec: "RFC 6585 \xA74",
      specUrl: rfc(6585, "4"),
      cacheable: false,
      retriable: "maybe",
      aliases: ["rate limit", "\u9650\u6D41", "429", "\u9000\u907F"]
    },
    {
      code: 431,
      name: "Request Header Fields Too Large",
      zh: "\u8BF7\u6C42\u5934\u8FC7\u5927",
      summary: "\u8BF7\u6C42\u5934\u6574\u4F53\u6216\u67D0\u4E00\u884C\u592A\u5927\u3002Cookie \u6512\u592A\u591A\u662F\u5934\u53F7\u539F\u56E0\u3002",
      causes: ["Cookie \u7D2F\u79EF\u5230\u51E0 KB", "Authorization \u91CC\u585E\u4E86\u8D85\u957F JWT"],
      fix: ["\u6E05 Cookie\uFF1B\u628A\u5927\u6570\u636E\u632A\u51FA\u8BF7\u6C42\u5934", "nginx \u8C03 large_client_header_buffers"],
      related: [413, 414, 494],
      spec: "RFC 6585 \xA75",
      specUrl: rfc(6585, "5"),
      cacheable: false,
      retriable: "no",
      aliases: ["header", "cookie", "\u8BF7\u6C42\u5934"]
    },
    {
      code: 451,
      name: "Unavailable For Legal Reasons",
      zh: "\u56E0\u6CD5\u5F8B\u539F\u56E0\u4E0D\u53EF\u7528",
      summary: "\u56E0\u4E3A\u6CD5\u5F8B\u8981\u6C42\u4E0D\u7ED9\u770B\u3002\u54CD\u5E94\u5E94\u5E26 Link \u6307\u5411\u505A\u51FA\u8981\u6C42\u7684\u90A3\u4E00\u65B9\u3002",
      causes: ["\u7248\u6743\u4E0B\u67B6\u3001\u5730\u533A\u5C01\u7981"],
      fix: ["\u4E0E 403 \u7684\u533A\u522B\u662F\u539F\u56E0\uFF1A451 \u660E\u8BF4\u662F\u6CD5\u5F8B"],
      related: [403, 410],
      spec: "RFC 7725 \xA73",
      specUrl: rfc(7725, "3"),
      cacheable: true,
      retriable: "no",
      aliases: ["legal", "\u6CD5\u5F8B", "\u5C01\u7981"]
    },
    // ── 5xx 服务端错误 ──────────────────────────────────────────────────────
    {
      code: 500,
      name: "Internal Server Error",
      zh: "\u670D\u52A1\u5668\u5185\u90E8\u9519\u8BEF",
      summary: "\u670D\u52A1\u7AEF\u81EA\u5DF1\u51FA\u4E86\u95EE\u9898\uFF0C\u800C\u4E14\u6CA1\u6709\u66F4\u5177\u4F53\u7684\u8BDD\u53EF\u8BF4\u3002\u5B83\u662F\u515C\u5E95\uFF0C\u4E0D\u662F\u8BCA\u65AD\u3002",
      causes: ["\u672A\u6355\u83B7\u7684\u5F02\u5E38", "\u4F9D\u8D56\u7684\u6570\u636E\u5E93\u6216\u4E0B\u6E38\u70B8\u4E86", "\u914D\u7F6E\u9519\u8BEF\uFF08\u5BC6\u94A5\u3001\u8DEF\u5F84\u3001\u6743\u9650\uFF09"],
      fix: ["\u53BB\u670D\u52A1\u7AEF\u65E5\u5FD7\u6309\u65F6\u95F4\u4E0E trace id \u627E\u90A3\u6B21\u8BF7\u6C42\uFF0C\u5BA2\u6237\u7AEF\u8FD9\u8FB9\u770B\u4E0D\u51FA\u539F\u56E0", "\u522B\u628A 500 \u5F53\u4E1A\u52A1\u9519\u8BEF\u7528\uFF1A\u8C03\u7528\u65B9\u65E0\u6CD5\u636E\u6B64\u505A\u4EFB\u4F55\u51B3\u5B9A", "\u5E42\u7B49\u8BF7\u6C42\u53EF\u4EE5\u9000\u907F\u91CD\u8BD5\u4E00\u6B21\uFF1B\u975E\u5E42\u7B49\u7684\u5148\u786E\u8BA4\u6709\u6CA1\u6709\u843D\u5E93"],
      related: [502, 503, 400],
      spec: "RFC 9110 \xA715.6.1",
      specUrl: rfc9110("15.6.1"),
      cacheable: false,
      retriable: "maybe",
      aliases: ["internal", "\u670D\u52A1\u5668\u9519\u8BEF", "500"]
    },
    {
      code: 501,
      name: "Not Implemented",
      zh: "\u672A\u5B9E\u73B0",
      summary: "\u670D\u52A1\u7AEF\u4E0D\u652F\u6301\u8FD9\u4E2A\u65B9\u6CD5\u672C\u8EAB\uFF08\u4E0D\u662F\u300C\u8FD9\u4E2A\u5730\u5740\u4E0D\u652F\u6301\u300D\u2014\u2014\u90A3\u662F 405\uFF09\u3002",
      causes: ["\u4EE3\u7406\u4E0D\u8BA4\u8BC6\u81EA\u5B9A\u4E49\u65B9\u6CD5", "\u8001\u670D\u52A1\u7AEF\u4E0D\u652F\u6301 PATCH"],
      fix: ["\u786E\u8BA4\u65B9\u6CD5\u62FC\u5199\uFF1B\u6362\u6210\u670D\u52A1\u7AEF\u652F\u6301\u7684\u65B9\u6CD5"],
      related: [405, 502],
      spec: "RFC 9110 \xA715.6.2",
      specUrl: rfc9110("15.6.2"),
      cacheable: true,
      retriable: "no",
      aliases: ["not implemented", "\u672A\u5B9E\u73B0"]
    },
    {
      code: 502,
      name: "Bad Gateway",
      zh: "\u9519\u8BEF\u7F51\u5173",
      summary: "\u7F51\u5173\u8FDE\u4E0A\u4E86\u4E0A\u6E38\uFF0C\u4F46\u4E0A\u6E38\u56DE\u7684\u4E1C\u897F\u4E0D\u5408\u6CD5\uFF0C\u6216\u8005\u6839\u672C\u8FDE\u4E0D\u4E0A\u2014\u2014\u95EE\u9898\u5728\u4E0A\u6E38\u6216\u5B83\u4EEC\u4E4B\u95F4\uFF0C\u4E0D\u5728\u4F60\u8FD9\u4E00\u4FA7\u3002",
      causes: ["\u4E0A\u6E38\u8FDB\u7A0B\u6302\u4E86\u3001\u7AEF\u53E3\u4E0D\u901A\u3001TLS \u63E1\u624B\u5931\u8D25", "\u4E0A\u6E38\u5410\u4E86\u4E0D\u5408 HTTP \u7684\u5B57\u8282\uFF0C\u591A\u534A\u662F\u5D29\u6E83\u6808", "\u5BB9\u5668\u521A\u91CD\u542F\uFF0C\u7F51\u5173\u8FD8\u6307\u7740\u65E7\u5B9E\u4F8B"],
      fix: ["\u5148\u770B\u7F51\u5173\u65E5\u5FD7\u91CC\u7684 upstream \u5730\u5740\uFF0C\u518D\u53BB\u90A3\u53F0\u673A\u5668\u4E0A\u9A8C", "\u5E42\u7B49\u8BF7\u6C42\u9000\u907F\u91CD\u8BD5\u6709\u610F\u4E49\uFF1B\u8FDE\u7740\u51E0\u6B21 502 \u8BF4\u660E\u4E0A\u6E38\u662F\u771F\u7684\u4E0B\u7EBF\u4E86", "\u5065\u5EB7\u68C0\u67E5\u4E0E\u6458\u9664\u7B56\u7565\u6BD4\u91CD\u8BD5\u66F4\u80FD\u89E3\u51B3\u5B83"],
      related: [503, 504, 500],
      spec: "RFC 9110 \xA715.6.3",
      specUrl: rfc9110("15.6.3"),
      cacheable: false,
      retriable: "yes",
      aliases: ["bad gateway", "\u7F51\u5173", "502"]
    },
    {
      code: 503,
      name: "Service Unavailable",
      zh: "\u670D\u52A1\u4E0D\u53EF\u7528",
      summary: "\u670D\u52A1\u7AEF\u6B64\u523B\u5904\u7406\u4E0D\u4E86\u2014\u2014\u8FC7\u8F7D\u6216\u5728\u7EF4\u62A4\u3002\u5B83\u662F\u300C\u4E34\u65F6\u300D\u7684\uFF0C\u800C\u4E14\u5E94\u5F53\u5E26 Retry-After\u3002",
      causes: ["\u8FC7\u8F7D\u3001\u7EBF\u7A0B\u6C60\u6253\u6EE1", "\u8BA1\u5212\u5185\u7EF4\u62A4", "\u6EDA\u52A8\u53D1\u5E03\u671F\u95F4\u5B9E\u4F8B\u5168\u5728\u91CD\u542F"],
      fix: ["\u8BFB Retry-After\uFF1B\u6CA1\u6709\u5C31\u6307\u6570\u9000\u907F + \u6296\u52A8", "\u7EF4\u62A4\u9875\u8981\u8FD4 503 \u800C\u4E0D\u662F 200\uFF0C\u5426\u5219\u641C\u7D22\u5F15\u64CE\u4F1A\u628A\u7EF4\u62A4\u9875\u5F53\u6B63\u6587\u6536\u5F55"],
      related: [429, 502, 504],
      spec: "RFC 9110 \xA715.6.4",
      specUrl: rfc9110("15.6.4"),
      cacheable: false,
      retriable: "maybe",
      aliases: ["unavailable", "\u4E0D\u53EF\u7528", "\u7EF4\u62A4", "\u8FC7\u8F7D"]
    },
    {
      code: 504,
      name: "Gateway Timeout",
      zh: "\u7F51\u5173\u8D85\u65F6",
      summary: "\u7F51\u5173\u7B49\u4E0A\u6E38\u54CD\u5E94\u7B49\u5230\u4E86\u81EA\u5DF1\u7684\u4E0A\u9650\u3002\u8BF4\u7684\u662F\u7F51\u5173\u4E0E\u4E0A\u6E38\u4E4B\u95F4\uFF0C\u4E0D\u662F\u4F60\u4E0E\u7F51\u5173\u4E4B\u95F4\u3002",
      causes: ["\u4E0A\u6E38\u5904\u7406\u6162\uFF08\u6162\u67E5\u8BE2\u3001\u5916\u90E8\u4F9D\u8D56\u5361\u4F4F\uFF09", "\u7F51\u5173\u7684\u8BFB\u8D85\u65F6\u7A97\u53E3\u6BD4\u4E0A\u6E38\u7684\u5904\u7406\u65F6\u95F4\u77ED"],
      fix: ["\u5148\u91CF\u4E0A\u6E38\u81EA\u5DF1\u7684\u8017\u65F6\uFF0C\u518D\u51B3\u5B9A\u662F\u8C03\u8D85\u65F6\u8FD8\u662F\u4F18\u5316\u5904\u7406", "\u957F\u4EFB\u52A1\u6539\u6210 202 + \u8F6E\u8BE2\uFF0C\u522B\u8BA9\u7F51\u5173\u66FF\u4F60\u7B49"],
      related: [502, 408, 524],
      spec: "RFC 9110 \xA715.6.5",
      specUrl: rfc9110("15.6.5"),
      cacheable: false,
      retriable: "yes",
      aliases: ["gateway timeout", "\u8D85\u65F6", "\u7F51\u5173"]
    },
    {
      code: 505,
      name: "HTTP Version Not Supported",
      zh: "HTTP \u7248\u672C\u4E0D\u652F\u6301",
      summary: "\u670D\u52A1\u7AEF\u4E0D\u652F\u6301\u8BF7\u6C42\u91CC\u90A3\u4E2A HTTP \u4E3B\u7248\u672C\u3002",
      related: [426, 400],
      spec: "RFC 9110 \xA715.6.6",
      specUrl: rfc9110("15.6.6"),
      cacheable: true,
      retriable: "no",
      aliases: ["version", "\u7248\u672C"]
    },
    {
      code: 506,
      name: "Variant Also Negotiates",
      zh: "\u53D8\u4F53\u4E5F\u8981\u534F\u5546",
      summary: "\u900F\u660E\u5185\u5BB9\u534F\u5546\u914D\u7F6E\u6210\u4E86\u73AF\u3002\u6781\u5C11\u89C1\uFF0C\u5C5E\u4E8E\u670D\u52A1\u7AEF\u914D\u7F6E\u9519\u8BEF\u3002",
      related: [300, 500],
      spec: "RFC 2295 \xA78.1",
      specUrl: rfc(2295, "8.1"),
      cacheable: false,
      retriable: "no"
    },
    {
      code: 507,
      name: "Insufficient Storage",
      zh: "\u5B58\u50A8\u4E0D\u8DB3",
      summary: "WebDAV\uFF1A\u670D\u52A1\u7AEF\u5B58\u4E0D\u4E0B\u8FD9\u6B21\u8BF7\u6C42\u8981\u4FDD\u5B58\u7684\u4E1C\u897F\u3002",
      causes: ["\u78C1\u76D8\u6EE1\u3001\u914D\u989D\u7528\u5C3D"],
      fix: ["\u6E05\u7A7A\u95F4\u6216\u52A0\u914D\u989D\uFF1B\u8FD9\u4E00\u6761\u91CD\u8BD5\u4E4B\u524D\u5148\u786E\u8BA4\u7A7A\u95F4\u771F\u7684\u56DE\u6765\u4E86"],
      related: [413, 500],
      spec: "RFC 4918 \xA711.5",
      specUrl: rfc(4918, "11.5"),
      cacheable: false,
      retriable: "maybe",
      aliases: ["webdav", "\u78C1\u76D8", "\u5B58\u50A8"]
    },
    {
      code: 508,
      name: "Loop Detected",
      zh: "\u68C0\u6D4B\u5230\u5FAA\u73AF",
      summary: "WebDAV\uFF1A\u5904\u7406\u8FC7\u7A0B\u4E2D\u53D1\u73B0\u4E86\u65E0\u9650\u5FAA\u73AF\uFF0C\u4E3B\u52A8\u505C\u4E0B\u3002",
      related: [507, 506],
      spec: "RFC 5842 \xA77.2",
      specUrl: rfc(5842, "7.2"),
      cacheable: false,
      retriable: "no",
      aliases: ["webdav", "\u5FAA\u73AF"]
    },
    {
      code: 510,
      name: "Not Extended",
      zh: "\u9700\u8981\u6269\u5C55",
      summary: "\u5DF2\u5E9F\u5F03\u7684\u5B9E\u9A8C\u6027\u6269\u5C55\u673A\u5236\uFF08RFC 2774\uFF09\u3002\u6CE8\u518C\u8868\u91CC\u6807\u7740 OBSOLETED\u3002",
      related: [426],
      spec: "RFC 2774 \xA77",
      specUrl: rfc(2774, "7"),
      cacheable: false,
      retriable: "no",
      aliases: ["obsolete", "\u5E9F\u5F03"]
    },
    {
      code: 511,
      name: "Network Authentication Required",
      zh: "\u9700\u8981\u7F51\u7EDC\u8BA4\u8BC1",
      summary: "\u8981\u5148\u5728\u7F51\u7EDC\u5165\u53E3\u5904\u767B\u5F55\uFF08\u673A\u573A\u3001\u9152\u5E97\u7684 Portal\uFF09\u3002\u300C\u53EA\u5E94\u7531\u62E6\u622A\u7684\u4E2D\u95F4\u8BBE\u5907\u8FD4\u56DE\u300D\uFF0C\u6E90\u7AD9\u4E0D\u8BE5\u7528\u5B83\u3002",
      causes: ["\u8FDE\u4E0A\u4E86\u8981\u6C42 Portal \u767B\u5F55\u7684 Wi-Fi"],
      fix: ["\u6253\u5F00\u6D4F\u89C8\u5668\u5B8C\u6210 Portal \u767B\u5F55\u518D\u91CD\u8BD5"],
      related: [401, 407],
      spec: "RFC 6585 \xA76",
      specUrl: rfc(6585, "6"),
      cacheable: false,
      retriable: "yes",
      aliases: ["portal", "wifi", "\u8BA4\u8BC1"]
    },
    // ── 非标准码：不在 IANA 注册表里，各家自己造的 ──────────────────────────
    {
      code: 418,
      name: "I'm a Teapot",
      zh: "\u6211\u662F\u8336\u58F6",
      summary: "1998 \u5E74\u611A\u4EBA\u8282 RFC 2324\uFF08\u8D85\u6587\u672C\u5496\u5561\u58F6\u63A7\u5236\u534F\u8BAE\uFF09\u91CC\u7684\u73A9\u7B11\u7801\u3002\u6CE8\u518C\u8868\u628A 418 \u6807\u4E3A Unused\uFF0C\u4E0D\u8981\u5728\u771F\u63A5\u53E3\u4E0A\u7528\u5B83\u3002",
      causes: ["\u6709\u4EBA\u62FF\u5B83\u5F53\u5360\u4F4D", "\u670D\u52A1\u7AEF\u5728\u7528\u5B83\u6321\u722C\u866B"],
      fix: ["\u628A\u5B83\u6362\u6210\u771F\u6B63\u60F3\u8868\u8FBE\u7684\u90A3\u4E2A\u7801\uFF08\u591A\u534A\u662F 400 / 403 / 501\uFF09"],
      related: [400, 501],
      spec: "RFC 2324 \xA72.3.2",
      specUrl: rfc(2324, "2.3.2"),
      cacheable: false,
      retriable: "no",
      unofficial: "\u73A9\u7B11\u7801",
      aliases: ["teapot", "\u8336\u58F6", "\u5F69\u86CB"]
    },
    {
      code: 440,
      name: "Login Time-out",
      zh: "\u767B\u5F55\u8D85\u65F6",
      summary: "IIS\uFF1A\u4F1A\u8BDD\u8FC7\u671F\uFF0C\u8981\u91CD\u65B0\u767B\u5F55\u3002\u6807\u51C6\u505A\u6CD5\u662F 401\u3002",
      fix: ["\u91CD\u65B0\u8BA4\u8BC1\u4E4B\u540E\u518D\u53D1\u4E00\u6B21"],
      related: [401, 408],
      spec: "IIS \u81EA\u5B9A\u4E49",
      specUrl: "https://learn.microsoft.com/iis/",
      cacheable: false,
      retriable: "no",
      unofficial: "IIS",
      aliases: ["iis", "\u767B\u5F55", "\u4F1A\u8BDD"]
    },
    {
      code: 444,
      name: "No Response",
      zh: "\u4E0D\u4F5C\u54CD\u5E94",
      summary: "nginx \u5185\u90E8\u7801\uFF1A\u76F4\u63A5\u5173\u6389\u8FDE\u63A5\uFF0C\u4E00\u4E2A\u5B57\u8282\u90FD\u4E0D\u56DE\u3002\u65E5\u5FD7\u91CC\u770B\u5F97\u5230\uFF0C\u5BA2\u6237\u7AEF\u53EA\u4F1A\u770B\u5230\u8FDE\u63A5\u88AB\u65AD\u3002",
      causes: ["\u914D\u7F6E\u91CC\u7528 return 444 \u6321\u6076\u610F\u8BF7\u6C42"],
      fix: ["\u5B83\u4E0D\u4F1A\u51FA\u73B0\u5728\u5BA2\u6237\u7AEF\uFF1B\u6293\u5305\u770B\u5230\u7684\u662F RST \u6216 EOF"],
      related: [499, 403],
      spec: "nginx \u81EA\u5B9A\u4E49",
      specUrl: "https://nginx.org/en/docs/http/ngx_http_rewrite_module.html",
      cacheable: false,
      retriable: "no",
      unofficial: "nginx",
      aliases: ["nginx"]
    },
    {
      code: 494,
      name: "Request Header Too Large",
      zh: "\u8BF7\u6C42\u5934\u8FC7\u5927",
      summary: "nginx \u5185\u90E8\u7801\uFF0C\u6807\u51C6\u5BF9\u5E94\u7684\u662F 431\u3002",
      fix: ["\u8C03 large_client_header_buffers\uFF0C\u6216\u8005\u5C11\u53D1\u70B9 Cookie"],
      related: [431, 413],
      spec: "nginx \u81EA\u5B9A\u4E49",
      specUrl: "https://nginx.org/en/docs/http/ngx_http_core_module.html",
      cacheable: false,
      retriable: "no",
      unofficial: "nginx",
      aliases: ["nginx", "\u8BF7\u6C42\u5934"]
    },
    {
      code: 495,
      name: "SSL Certificate Error",
      zh: "\u5BA2\u6237\u7AEF\u8BC1\u4E66\u9519\u8BEF",
      summary: "nginx\uFF1A\u53CC\u5411 TLS \u91CC\u5BA2\u6237\u7AEF\u8BC1\u4E66\u6821\u9A8C\u6CA1\u8FC7\u3002",
      causes: ["\u5BA2\u6237\u7AEF\u8BC1\u4E66\u8FC7\u671F\u6216\u4E0D\u662F\u8FD9\u4E2A CA \u7B7E\u7684"],
      fix: ["\u6362\u4E00\u5F20\u6709\u6548\u7684\u5BA2\u6237\u7AEF\u8BC1\u4E66\uFF1B\u670D\u52A1\u7AEF\u770B ssl_client_verify"],
      related: [497, 526, 403],
      spec: "nginx \u81EA\u5B9A\u4E49",
      specUrl: "https://nginx.org/en/docs/http/ngx_http_ssl_module.html",
      cacheable: false,
      retriable: "no",
      unofficial: "nginx",
      aliases: ["nginx", "ssl", "tls", "\u8BC1\u4E66", "mtls"]
    },
    {
      code: 497,
      name: "HTTP Request Sent to HTTPS Port",
      zh: "\u660E\u6587\u8BF7\u6C42\u6253\u5230\u4E86 HTTPS \u7AEF\u53E3",
      summary: "nginx\uFF1A\u5F80 TLS \u7AEF\u53E3\u53D1\u4E86\u660E\u6587 HTTP\u3002",
      causes: ["\u5BA2\u6237\u7AEF\u628A https \u5199\u6210\u4E86 http", "\u5185\u7F51\u8C03\u7528\u5FD8\u4E86\u6539 scheme"],
      fix: ["\u6539\u7528 https://\uFF1B\u6216\u8005\u5728 80 \u7AEF\u53E3\u4E0A\u505A\u8DF3\u8F6C"],
      related: [400, 426],
      spec: "nginx \u81EA\u5B9A\u4E49",
      specUrl: "https://nginx.org/en/docs/http/ngx_http_ssl_module.html",
      cacheable: false,
      retriable: "no",
      unofficial: "nginx",
      aliases: ["nginx", "https", "\u660E\u6587"]
    },
    {
      code: 499,
      name: "Client Closed Request",
      zh: "\u5BA2\u6237\u7AEF\u63D0\u524D\u65AD\u5F00",
      summary: "nginx\uFF1A\u54CD\u5E94\u8FD8\u6CA1\u5199\u5B8C\uFF0C\u5BA2\u6237\u7AEF\u5148\u628A\u8FDE\u63A5\u5173\u4E86\u3002\u5B83\u8BB0\u5F55\u7684\u662F\u300C\u5BA2\u6237\u7AEF\u8D70\u4E86\u300D\uFF0C\u4E0D\u662F\u670D\u52A1\u7AEF\u9519\u4E86\u3002",
      causes: ["\u7528\u6237\u5173\u4E86\u9875\u9762\u6216\u70B9\u4E86\u53D6\u6D88", "\u4E0A\u6E38\u592A\u6162\uFF0C\u5BA2\u6237\u7AEF\u81EA\u5DF1\u7684\u8D85\u65F6\u5148\u5230\u4E86", "\u8D1F\u8F7D\u5747\u8861\u7684\u7A7A\u95F2\u8D85\u65F6\u6BD4\u540E\u7AEF\u5904\u7406\u65F6\u95F4\u77ED"],
      fix: ["\u5927\u91CF 499 \u901A\u5E38\u610F\u5473\u7740\u540E\u7AEF\u53D8\u6162\u4E86\uFF1A\u5148\u770B upstream_response_time", "\u5B83\u4E0D\u8BE5\u8BA1\u5165\u670D\u52A1\u7AEF\u9519\u8BEF\u7387\uFF0C\u5426\u5219\u4F1A\u8BEF\u62A5"],
      related: [408, 504],
      spec: "nginx \u81EA\u5B9A\u4E49",
      specUrl: "https://nginx.org/en/docs/http/ngx_http_log_module.html",
      cacheable: false,
      retriable: "no",
      unofficial: "nginx",
      aliases: ["nginx", "\u65AD\u5F00", "\u53D6\u6D88"]
    },
    {
      code: 520,
      name: "Web Server Returned an Unknown Error",
      zh: "\u6E90\u7AD9\u8FD4\u56DE\u4E86\u672A\u77E5\u9519\u8BEF",
      summary: "Cloudflare\uFF1A\u6E90\u7AD9\u7684\u54CD\u5E94\u5B83\u89E3\u6790\u4E0D\u4E86\u3002\u662F\u4E2A\u515C\u5E95\uFF0C\u672C\u8EAB\u4E0D\u8BF4\u660E\u539F\u56E0\u3002",
      causes: ["\u6E90\u7AD9\u8FD4\u56DE\u4E86\u7A7A\u54CD\u5E94\u6216\u975E\u6CD5\u5934", "\u6E90\u7AD9\u5D29\u6E83\u3001\u8FDE\u63A5\u88AB\u91CD\u7F6E"],
      fix: ["\u7ED5\u8FC7 Cloudflare \u76F4\u8FDE\u6E90\u7AD9\u9A8C\u4E00\u6B21\uFF0C\u5C31\u80FD\u5206\u6E05\u662F\u54EA\u4E00\u4FA7\u7684\u95EE\u9898"],
      related: [521, 502],
      spec: "Cloudflare \u81EA\u5B9A\u4E49",
      specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
      cacheable: false,
      retriable: "maybe",
      unofficial: "Cloudflare",
      aliases: ["cloudflare", "cf"]
    },
    {
      code: 521,
      name: "Web Server Is Down",
      zh: "\u6E90\u7AD9\u5DF2\u5173\u95ED",
      summary: "Cloudflare\uFF1A\u8FDE\u4E0D\u4E0A\u6E90\u7AD9\u2014\u2014\u7AEF\u53E3\u4E0D\u901A\u6216\u8FDB\u7A0B\u6CA1\u8D77\u3002",
      causes: ["\u6E90\u7AD9\u8FDB\u7A0B\u6302\u4E86", "\u9632\u706B\u5899\u628A Cloudflare \u7684 IP \u6321\u4E86"],
      fix: ["\u786E\u8BA4\u6E90\u7AD9\u5728\u8DD1\uFF0C\u5E76\u653E\u884C Cloudflare \u7684 IP \u6BB5"],
      related: [520, 522, 502],
      spec: "Cloudflare \u81EA\u5B9A\u4E49",
      specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
      cacheable: false,
      retriable: "maybe",
      unofficial: "Cloudflare",
      aliases: ["cloudflare", "cf", "\u6E90\u7AD9"]
    },
    {
      code: 522,
      name: "Connection Timed Out",
      zh: "\u8FDE\u63A5\u8D85\u65F6",
      summary: "Cloudflare\uFF1ATCP \u63E1\u624B\u5C31\u6CA1\u6210\u2014\u2014\u5728\u5EFA\u7ACB\u8FDE\u63A5\u8FD9\u4E00\u6B65\u8D85\u65F6\uFF0C\u6BD4 524 \u66F4\u65E9\u3002",
      causes: ["\u6E90\u7AD9\u8FC7\u8F7D\u5230\u63A5\u4E0D\u4E86\u65B0\u8FDE\u63A5", "\u4E22\u5305\u6216\u8DEF\u7531\u95EE\u9898", "\u9632\u706B\u5899\u9759\u9ED8\u4E22\u5F03"],
      fix: ["\u4ECE\u522B\u7684\u7F51\u7EDC\u76F4\u8FDE\u6E90\u7AD9\u7684\u7AEF\u53E3\u8BD5\u4E00\u6B21\uFF0C\u770B\u662F\u4E0D\u662F\u53EA\u6709 Cloudflare \u8FDE\u4E0D\u4E0A"],
      related: [524, 521, 504],
      spec: "Cloudflare \u81EA\u5B9A\u4E49",
      specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
      cacheable: false,
      retriable: "yes",
      unofficial: "Cloudflare",
      aliases: ["cloudflare", "cf", "timeout", "\u8D85\u65F6"]
    },
    {
      code: 524,
      name: "A Timeout Occurred",
      zh: "\u6E90\u7AD9\u8D85\u65F6",
      summary: "Cloudflare\uFF1A\u8FDE\u63A5\u5EFA\u8D77\u6765\u4E86\uFF0C\u4F46\u6E90\u7AD9\u6CA1\u5728\u7A97\u53E3\u5185\uFF08\u9ED8\u8BA4 100 \u79D2\uFF09\u628A\u54CD\u5E94\u5199\u5B8C\u3002",
      causes: ["\u6E90\u7AD9\u6709\u4E2A\u957F\u4EFB\u52A1\u5728\u8DD1", "\u540C\u6B65\u5BFC\u51FA\u3001\u5927\u62A5\u8868\u8FD9\u7C7B\u63A5\u53E3"],
      fix: ["\u957F\u4EFB\u52A1\u6539\u6210\u5F02\u6B65\uFF1A\u5148 202 \u518D\u8F6E\u8BE2", "\u4F01\u4E1A\u7248\u53EF\u4EE5\u8C03\u7A97\u53E3\uFF0C\u5176\u4ED6\u7248\u672C\u53EA\u80FD\u6539\u63A5\u53E3"],
      related: [522, 504, 202],
      spec: "Cloudflare \u81EA\u5B9A\u4E49",
      specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
      cacheable: false,
      retriable: "maybe",
      unofficial: "Cloudflare",
      aliases: ["cloudflare", "cf", "timeout", "\u8D85\u65F6"]
    },
    {
      code: 526,
      name: "Invalid SSL Certificate",
      zh: "\u6E90\u7AD9\u8BC1\u4E66\u65E0\u6548",
      summary: "Cloudflare\uFF1A\u56DE\u6E90\u65F6\u6821\u9A8C\u6E90\u7AD9\u8BC1\u4E66\u6CA1\u8FC7\uFF08Full (strict) \u6A21\u5F0F\u4E0B\uFF09\u3002",
      causes: ["\u6E90\u7AD9\u8BC1\u4E66\u8FC7\u671F\u3001\u81EA\u7B7E\u540D\u3001\u57DF\u540D\u4E0D\u5339\u914D"],
      fix: ["\u6362\u4E00\u5F20\u53D7\u4FE1\u4EFB\u7684\u8BC1\u4E66\uFF0C\u6216\u628A\u52A0\u5BC6\u6A21\u5F0F\u964D\u5230 Full\uFF08\u4E0D\u63A8\u8350\uFF09"],
      related: [495, 497, 521],
      spec: "Cloudflare \u81EA\u5B9A\u4E49",
      specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
      cacheable: false,
      retriable: "no",
      unofficial: "Cloudflare",
      aliases: ["cloudflare", "cf", "ssl", "\u8BC1\u4E66"]
    }
  ];
  var catalog = [...entries].sort((a, b) => a.code - b.code);
  var byCode = (code) => catalog.find((entry) => entry.code === code);
  var classOf = (code) => code >= 100 && code <= 599 ? Math.floor(code / 100) : 0;
  var standardCount = catalog.filter((e) => !e.unofficial).length;
  var unofficialCount = catalog.filter((e) => e.unofficial).length;

  // extensions/http-status/src/search.ts
  var CLASS_PATTERN = /^([1-5])\s*x{2}$/i;
  var DIGITS_ONLY = /^\d{1,3}$/;
  function filtered(entries2, options) {
    return entries2.filter((entry) => {
      if (entry.unofficial && !options.includeUnofficial) return false;
      if (options.classFilter && classOf(entry.code) !== options.classFilter) return false;
      return true;
    });
  }
  function extractCode(text) {
    if (!text) return null;
    const patterns = [
      /HTTP\/\d(?:\.\d)?\s+([1-5]\d{2})\b/i,
      /\b(?:status(?:\s*code)?|code|状态码|返回码)\s*[:：=]?\s*([1-5]\d{2})\b/i,
      /(?:^|[^\d.])([1-5]\d{2})(?![\d.])/
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match?.[1]) {
        const code = Number(match[1]);
        if (code >= 100 && code <= 599) return code;
      }
    }
    return null;
  }
  function matchesKeyword(entry, needle) {
    if (entry.name.toLowerCase().includes(needle)) return true;
    if (entry.zh.includes(needle)) return true;
    return (entry.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle));
  }
  function search(query, options) {
    const trimmed = query.trim();
    if (trimmed === "") return { kind: "browse" };
    const classMatch = CLASS_PATTERN.exec(trimmed);
    if (classMatch?.[1]) {
      const klass = Number(classMatch[1]);
      const entries3 = filtered(catalog.filter((entry) => classOf(entry.code) === klass), options);
      return entries3.length ? { kind: "list", entries: entries3, label: `${klass}xx \xB7 ${entries3.length} \u4E2A` } : { kind: "empty", reason: "no-match" };
    }
    if (DIGITS_ONLY.test(trimmed)) {
      if (trimmed.length === 3) {
        const code = Number(trimmed);
        const entry = byCode(code);
        if (entry) return { kind: "exact", entry };
        return { kind: "empty", reason: classOf(code) === 0 ? "out-of-range" : "no-such-code" };
      }
      const entries3 = filtered(catalog.filter((entry) => String(entry.code).startsWith(trimmed)), options);
      return entries3.length ? { kind: "list", entries: entries3, label: `${trimmed}\u2026 \xB7 ${entries3.length} \u4E2A` } : { kind: "empty", reason: "no-such-code" };
    }
    const embedded = extractCode(trimmed);
    if (embedded !== null) {
      const entry = byCode(embedded);
      if (entry) return { kind: "exact", entry };
    }
    const needle = trimmed.toLowerCase();
    const entries2 = filtered(catalog.filter((entry) => matchesKeyword(entry, needle)), options);
    if (entries2.length === 1 && entries2[0]) return { kind: "exact", entry: entries2[0] };
    return entries2.length ? { kind: "list", entries: entries2, label: `${entries2.length} \u4E2A` } : { kind: "empty", reason: "no-match" };
  }
  var CLASS_META = {
    1: { title: "1xx \xB7 \u4FE1\u606F", symbol: "info.circle", tint: "neutral" },
    2: { title: "2xx \xB7 \u6210\u529F", symbol: "checkmark.circle", tint: "live" },
    3: { title: "3xx \xB7 \u91CD\u5B9A\u5411", symbol: "arrow.triangle.turn.up.right.circle", tint: "blue" },
    4: { title: "4xx \xB7 \u5BA2\u6237\u7AEF\u9519\u8BEF", symbol: "exclamationmark.triangle", tint: "alert" },
    5: { title: "5xx \xB7 \u670D\u52A1\u7AEF\u9519\u8BEF", symbol: "xmark.octagon", tint: "danger" }
  };
  function classSummaries() {
    return [1, 2, 3, 4, 5].map((klass) => {
      const entries2 = catalog.filter((entry) => !entry.unofficial && classOf(entry.code) === klass);
      const preview = entries2.slice(0, 5).map((entry) => entry.code).join(" ");
      const meta = CLASS_META[klass];
      return {
        klass,
        title: meta.title,
        symbol: meta.symbol,
        tint: meta.tint,
        preview: entries2.length > 5 ? `${preview} \u2026` : preview,
        count: entries2.length
      };
    });
  }
  function tintFor(code) {
    return CLASS_META[classOf(code) || 1].tint;
  }
  function symbolFor(code) {
    return CLASS_META[classOf(code) || 1].symbol;
  }

  // extensions/http-status/src/page.ts
  var COMMON_CODES = [404, 500, 502, 429, 301];
  var CLASS_TITLE = { 1: "\u4FE1\u606F", 2: "\u6210\u529F", 3: "\u91CD\u5B9A\u5411", 4: "\u5BA2\u6237\u7AEF\u9519\u8BEF", 5: "\u670D\u52A1\u7AEF\u9519\u8BEF" };
  function classBadge(entry) {
    return ui.badge({ key: "class", title: CLASS_TITLE[Math.floor(entry.code / 100)] ?? "\u672A\u77E5", tint: tintFor(entry.code) });
  }
  function retryBadge(entry) {
    const map = {
      yes: { title: "\u53EF\u4EE5\u91CD\u8BD5", tint: "live" },
      maybe: { title: "\u770B Retry-After", tint: "amber" },
      no: { title: "\u91CD\u8BD5\u6CA1\u7528", tint: "neutral" }
    };
    const it = map[entry.retriable];
    return ui.badge({ key: "retry", title: it.title, tint: it.tint });
  }
  function facts(entry) {
    const children = [
      classBadge(entry),
      ui.badge({ key: "cache", title: entry.cacheable ? "\u9ED8\u8BA4\u53EF\u7F13\u5B58" : "\u4E0D\u53EF\u7F13\u5B58", tint: "neutral" }),
      retryBadge(entry)
    ];
    if (entry.unofficial) children.push(ui.badge({ key: "unofficial", title: `\u975E\u6807\u51C6 \xB7 ${entry.unofficial}`, tint: "amber" }));
    return ui.stack({ key: "facts", axis: "horizontal", spacing: "tight", children });
  }
  async function openDoc(session2, url) {
    if (!session2.has("system.openURL")) {
      const result = await jarvis.permissions.request(["system.openURL"]);
      if (!result.granted.includes("system.openURL")) {
        session2.urlDenied = true;
        jarvis.ui.update();
        return;
      }
      session2.grantLocally("system.openURL");
    }
    await jarvis.system.openURL(url);
  }
  function searchBox(session2) {
    return ui.search({
      key: "query",
      value: session2.query,
      placeholder: "\u8F93\u5165\u72B6\u6001\u7801\u6216\u5173\u952E\u8BCD\uFF0C\u5982 404 / \u8D85\u65F6 / redirect",
      label: "\u67E5\u72B6\u6001\u7801",
      onChange: (value) => session2.setQuery(value)
    });
  }
  function footnote(text, key = "footnote") {
    return ui.text({ key, text, style: "footnote" });
  }
  var offlineNote = `\u79BB\u7EBF \xB7 ${standardCount} \u4E2A\u6807\u51C6\u7801 + ${unofficialCount} \u4E2A\u975E\u6807\u51C6\u7801 \xB7 \u4E00\u4E2A\u8BF7\u6C42\u90FD\u4E0D\u53D1`;
  function browse(session2) {
    return [
      ui.section({
        key: "lookup",
        title: "\u67E5\u8BE2 \xB7 LOOKUP",
        trailing: session2.hotkey("lookup"),
        children: [searchBox(session2)]
      }),
      ui.section({
        key: "classes",
        title: "\u5206\u7C7B \xB7 CLASSES",
        trailing: `${standardCount} \u4E2A\u6807\u51C6\u7801`,
        children: classSummaries().map(
          (summary) => ui.row({
            key: `class-${summary.klass}`,
            symbol: summary.symbol,
            tint: summary.tint,
            title: summary.title,
            // 说全「标准码」：点进去的清单默认带上这一类的非标准码（4xx 多 7 条、5xx 多 5 条），
            // 只写「28 个」会和清单顶上那句「4xx · 35 个」读成矛盾
            subtitle: `${summary.count} \u4E2A\u6807\u51C6\u7801 \xB7 ${summary.preview}`,
            accessory: "chevron",
            onPress: () => session2.setQuery(`${summary.klass}xx`)
          })
        )
      }),
      footnote(offlineNote)
    ];
  }
  function compactBrowse(session2) {
    return [
      ui.section({
        key: "lookup",
        title: "\u67E5\u8BE2 \xB7 LOOKUP",
        trailing: session2.hotkey("lookup"),
        children: [
          searchBox(session2),
          ui.stack({
            key: "common",
            axis: "horizontal",
            spacing: "tight",
            alignment: "center",
            children: [
              ...COMMON_CODES.map(
                (code) => ui.chip({
                  key: `common-${code}`,
                  title: String(code),
                  tint: tintFor(code),
                  help: byCode(code)?.zh,
                  onPress: () => session2.openCode(code)
                })
              ),
              ui.spacer(),
              ui.text({ key: "common-label", text: "\u5E38\u67E5", style: "footnote" })
            ]
          })
        ]
      })
    ];
  }
  function chipTitle(entry) {
    return Array.from(entry.zh).length > 6 ? String(entry.code) : `${entry.code} ${entry.zh}`;
  }
  function bullets(prefix, lines) {
    return lines.map((line, index) => ui.text({ key: `${prefix}-${index}`, text: `\xB7 ${line}`, style: "subtle" }));
  }
  function detail(session2, entry) {
    const children = [];
    if (session2.previousQuery !== null) {
      children.push(
        ui.button({
          key: "back",
          title: `\u2190 \u56DE\u5230\u300C${session2.previousQuery}\u300D`,
          variant: "link",
          size: "inline",
          onPress: () => session2.back()
        })
      );
    }
    children.push(
      ui.readout({
        key: "readout",
        label: `${entry.zh} \xB7 ${CLASS_TITLE[Math.floor(entry.code / 100)] ?? ""}`,
        value: session2.copyText(entry),
        tint: tintFor(entry.code),
        copy: true
      }),
      facts(entry),
      ui.text({ key: "summary", text: entry.summary, style: "body", selectable: true })
    );
    if (entry.causes?.length) {
      children.push(ui.section({ key: "causes", title: "\u5E38\u89C1\u6210\u56E0 \xB7 CAUSES", children: bullets("cause", entry.causes) }));
    }
    if (entry.fix?.length) {
      children.push(ui.section({ key: "fix", title: "\u600E\u4E48\u5904\u7406 \xB7 FIX", children: bullets("fix", entry.fix) }));
    }
    if (entry.related?.length) {
      children.push(
        ui.section({
          key: "related",
          title: "\u76F8\u5173 \xB7 RELATED",
          trailing: entry.spec,
          children: [
            ui.stack({
              key: "related-chips",
              axis: "horizontal",
              spacing: "tight",
              children: entry.related.map((code) => byCode(code)).filter((related) => Boolean(related)).slice(0, 3).map(
                (related) => ui.chip({
                  key: `related-${related.code}`,
                  title: chipTitle(related),
                  tint: tintFor(related.code),
                  help: `${related.name} \xB7 ${related.zh}`,
                  onPress: () => session2.openCode(related.code, session2.query)
                })
              )
            })
          ]
        })
      );
    }
    const links = session2.links(entry);
    if (session2.urlDenied) {
      children.push(
        ui.note({
          key: "url-denied",
          tint: "neutral",
          symbol: "link",
          title: "\u6CA1\u6709\u6253\u5F00\u94FE\u63A5\u7684\u6388\u6743",
          body: `\u51FA\u5904\u662F ${entry.spec}\uFF1A${links[0]?.url ?? ""}\u3002\u628A\u5B83\u590D\u5236\u51FA\u53BB\u81EA\u5DF1\u6253\u5F00\u4E5F\u4E00\u6837\uFF1B\u60F3\u6539\u4E3B\u610F\u5C31\u5728 \u8BBE\u7F6E \u203A \u6269\u5C55 \u91CC\u628A\u300C\u6253\u5F00\u94FE\u63A5\u300D\u6253\u5F00\u3002`
        })
      );
    }
    children.push(
      ui.stack({
        key: "actions",
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          ...session2.urlDenied ? [ui.copy({ key: "copy-url", text: links[0]?.url ?? "", variant: "chip", label: `\u590D\u5236 ${entry.spec} \u7684\u5730\u5740` })] : [],
          ...(session2.urlDenied ? [] : links).map(
            (link, index) => ui.button({
              key: `link-${index}`,
              title: link.title,
              variant: "link",
              size: "inline",
              help: link.url,
              onPress: () => void openDoc(session2, link.url)
            })
          ),
          ui.spacer(),
          ui.copy({ key: "copy", text: session2.copyText(entry), variant: "chip", label: `\u590D\u5236 ${session2.copyText(entry)}` })
        ]
      })
    );
    return children;
  }
  var RETRY_LABEL = { yes: "\u53EF\u4EE5\u91CD\u8BD5", maybe: "\u770B Retry-After", no: "\u91CD\u8BD5\u6CA1\u7528" };
  function hoverCard(entry) {
    return ui.card({
      tint: tintFor(entry.code),
      children: [
        ui.stack({
          key: "head",
          axis: "horizontal",
          spacing: "tight",
          alignment: "center",
          children: [
            ui.text({ key: "code", text: `${entry.code} \xB7 ${entry.name.toUpperCase()}`, style: "sectionTitle", tint: tintFor(entry.code) }),
            ui.spacer(),
            ui.text({ key: "retry", text: RETRY_LABEL[entry.retriable], style: "footnote" })
          ]
        }),
        ui.text({ key: "summary", text: entry.summary, style: "body" }),
        ui.text({ key: "hint", text: "\u70B9\u8FD9\u4E00\u884C\u5C55\u5F00\u5B8C\u6574\u4E00\u5C4F \xB7 \u6307\u9488\u79FB\u5F00\u5373\u6536", style: "footnote" })
      ]
    });
  }
  function rowSubtitle(entry) {
    if (entry.unofficial) return `${entry.zh} \xB7 \u975E\u6807\u51C6 \xB7 ${entry.unofficial}`;
    const firstSentence = entry.summary.split("\u3002")[0] ?? entry.summary;
    return `${entry.zh} \xB7 ${firstSentence}`;
  }
  function results(session2, entries2, label) {
    const from = session2.query;
    return [
      ui.section({
        key: "results",
        title: "\u7ED3\u679C \xB7 RESULTS",
        trailing: label,
        children: [
          ui.list({
            key: "result-list",
            children: entries2.map(
              (entry) => ui.row({
                key: String(entry.code),
                symbol: symbolFor(entry.code),
                tint: tintFor(entry.code),
                title: `${entry.code} \xB7 ${entry.name}`,
                subtitle: rowSubtitle(entry),
                accessory: "chevron",
                label: `${entry.code} ${entry.name} \xB7 ${entry.zh}`,
                onPress: () => session2.openCode(entry.code, from),
                hoverCard: hoverCard(entry)
              })
            )
          })
        ]
      }),
      ui.stack({
        key: "filters",
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          ui.chip({
            key: "unofficial",
            title: session2.includeUnofficial ? "\u2713 \u542B\u975E\u6807\u51C6\u7801" : "\u542B\u975E\u6807\u51C6\u7801",
            tint: "amber",
            selected: session2.includeUnofficial,
            help: "nginx\u3001IIS\u3001Cloudflare \u81EA\u5DF1\u9020\u7684\u7801\uFF1B\u5B83\u4EEC\u4E0D\u5728 IANA \u6CE8\u518C\u8868\u91CC",
            onPress: () => {
              session2.includeUnofficial = !session2.includeUnofficial;
            }
          }),
          ui.chip({
            key: "only-5xx",
            title: "\u53EA\u770B 5xx",
            tint: "danger",
            selected: session2.classFilter === 5,
            help: "\u53EA\u7559\u670D\u52A1\u7AEF\u9519\u8BEF",
            onPress: () => {
              session2.classFilter = session2.classFilter === 5 ? null : 5;
            }
          }),
          ui.spacer(),
          ui.text({ key: "total", text: `${standardCount + unofficialCount} \u4E2A\u7801\u5728\u8868\u91CC`, style: "footnote" })
        ]
      }),
      footnote("\u70B9\u4E00\u884C\u5C55\u5F00 \xB7 \u6307\u9488\u505C 320ms \u6D6E\u51FA\u6458\u8981 \xB7 Esc \u6E05\u7A7A\u641C\u7D22")
    ];
  }
  function emptyScreen(session2, reason) {
    const query = session2.query.trim();
    const clear = { id: "clear", title: "\u6E05\u7A7A\u641C\u7D22", symbol: "xmark.circle", help: "\u56DE\u5230\u5206\u7C7B", onPress: () => session2.clear() };
    const title = reason === "no-match" ? `\u6CA1\u6709\u5339\u914D\u300C${query}\u300D\u7684\u7801` : `\u6CA1\u6709 ${query} \u8FD9\u4E2A\u7801`;
    const hint = reason === "out-of-range" ? "\u72B6\u6001\u7801\u53EA\u6709 100\u2013599 \u8FD9\u4E00\u6BB5\u3002999 \u8FD9\u7C7B\u662F\u6293\u53D6\u88AB\u6321\u4E0B\u65F6\u5E38\u89C1\u7684\u81EA\u9020\u7801\uFF0C\u4E0D\u5728\u4EFB\u4F55\u6CE8\u518C\u8868\u91CC\u3002" : reason === "no-such-code" ? session2.includeUnofficial ? "\u5B83\u5728 100\u2013599 \u4E4B\u95F4\uFF0C\u4F46\u6CA1\u6709\u4EFB\u4F55\u89C4\u8303\u6216\u5382\u5546\u5B9A\u4E49\u8FC7\u5B83\u2014\u2014\u591A\u534A\u662F\u67D0\u4E2A\u670D\u52A1\u81EA\u5DF1\u9020\u7684\u3002" : "\u5B83\u6CA1\u6709\u88AB\u4EFB\u4F55\u89C4\u8303\u5B9A\u4E49\u8FC7\uFF1B\u5982\u679C\u662F nginx / Cloudflare \u90A3\u7C7B\u81EA\u9020\u7801\uFF0C\u628A\u300C\u542B\u975E\u6807\u51C6\u7801\u300D\u6253\u5F00\u518D\u641C\u4E00\u6B21\u3002" : "\u6362\u4E2A\u8BCD\u8BD5\u8BD5\uFF1A\u4E2D\u6587\u540D\u3001\u82F1\u6587\u540D\u3001\u522B\u540D\u4E0E\u4E09\u4F4D\u6570\u5B57\u90FD\u6536\uFF0C\u4E5F\u53EF\u4EE5\u76F4\u63A5\u7C98\u4E00\u6574\u884C\u54CD\u5E94\u8FDB\u6765\u3002";
    return [
      ui.empty({ key: "empty", symbol: "questionmark.circle", title, hint, action: clear }),
      ui.note({
        key: "scope",
        tint: "neutral",
        symbol: "info.circle",
        title: "\u8FD9\u91CC\u53EA\u6536\u72B6\u6001\u7801",
        body: "Cache-Control\u3001Retry-After \u8FD9\u4E9B\u54CD\u5E94\u5934\uFF0C\u8FD8\u6709\u8BF7\u6C42\u65B9\u6CD5\u4E0E MIME \u7C7B\u578B\uFF0C\u90FD\u4E0D\u5728\u8FD9\u5F20\u8868\u91CC\u2014\u2014\u67E5\u4E0D\u5230\u4E0D\u7B49\u4E8E\u4E0D\u5B58\u5728\u3002"
      }),
      footnote(offlineNote)
    ];
  }
  function deniedSection(session2) {
    return [
      ui.section({
        key: "clipboard",
        title: "\u526A\u8D34\u677F \xB7 CLIPBOARD",
        tint: "alert",
        trailing: "\u672A\u6388\u6743",
        children: [
          ui.note({
            key: "denied",
            tint: "alert",
            symbol: "lock",
            title: "\u6CA1\u6709\u8BFB\u526A\u8D34\u677F\u7684\u6388\u6743",
            body: `\u7B2C\u4E00\u6B21\u8FDB\u5165\u65F6\u4F60\u6CA1\u52FE\u300C\u8BFB\u526A\u8D34\u677F\u300D\u3002\u6CA1\u6709\u5B83\uFF0C${session2.commandRef("explain-clipboard", "\u89E3\u91CA\u526A\u8D34\u677F\u91CC\u7684\u7801")}\u8FD9\u6761\u547D\u4EE4\u8DD1\u4E0D\u8D77\u6765\uFF1B\u9875\u9762\u91CC\u624B\u8F93\u72B6\u6001\u7801\u4E0D\u53D7\u5F71\u54CD\u3002`,
            actions: [{ id: "grant", title: "\u6388\u6743", symbol: "lock.open", help: "\u518D\u95EE\u4E00\u6B21\u8BFB\u526A\u8D34\u677F\u7684\u6388\u6743", onPress: () => void session2.requestClipboard() }]
          })
        ]
      }),
      ui.hairline()
    ];
  }
  function renderPage(session2) {
    const denied2 = session2.clipboard.kind === "denied";
    const outcome = session2.outcome();
    const children = [];
    if (denied2) children.push(...deniedSection(session2));
    switch (outcome.kind) {
      case "browse":
        children.push(...denied2 ? compactBrowse(session2) : browse(session2));
        break;
      case "exact":
        children.push(searchBox(session2), ...detail(session2, outcome.entry));
        break;
      case "list":
        children.push(searchBox(session2), ...results(session2, outcome.entries, outcome.label));
        break;
      case "empty":
        children.push(searchBox(session2), ...emptyScreen(session2, outcome.reason));
        break;
    }
    if (denied2) {
      children.push(footnote(`\u6388\u6743\u4E4B\u540E${session2.commandRef("explain-clipboard", "\u89E3\u91CA\u526A\u8D34\u677F\u91CC\u7684\u7801")}\u4F1A\u5728\u6307\u9488\u65C1\u539F\u5730\u5F39\u51FA\u7ED3\u679C\uFF0C\u9762\u677F\u4E0D\u52A8\u3002\u968F\u65F6\u53EF\u4EE5\u5728 \u8BBE\u7F6E \u203A \u6269\u5C55 \u91CC\u6539\u3002`, "denied-footnote"));
    }
    return ui.scroll({ children });
  }

  // extensions/http-status/src/popover.ts
  var CLASS_TITLE2 = { 1: "\u4FE1\u606F", 2: "\u6210\u529F", 3: "\u91CD\u5B9A\u5411", 4: "\u5BA2\u6237\u7AEF\u9519\u8BEF", 5: "\u670D\u52A1\u7AEF\u9519\u8BEF" };
  function sourceCard(session2, hit2) {
    return ui.card({
      key: "source",
      children: [
        ui.stack({
          key: "meta",
          axis: "horizontal",
          spacing: "tight",
          alignment: "center",
          children: [
            ui.text({ key: "length", text: `\u526A\u8D34\u677F \xB7 ${session2.clipboardLength()} \u5B57\u7B26`, style: "footnote" }),
            ui.spacer(),
            ui.text({ key: "hit", text: hit2 ? "\u547D\u4E2D 1 \u4E2A\u7801" : "\u6CA1\u6709 100\u2013599", style: "footnote", tint: hit2 ? "accent" : "neutral" })
          ]
        }),
        ui.text({ key: "excerpt", text: session2.clipboardExcerpt(), style: "mono", lines: 2, selectable: true })
      ]
    });
  }
  function facts2(entry) {
    const retry = { yes: { title: "\u53EF\u4EE5\u91CD\u8BD5", tint: "live" }, maybe: { title: "\u770B Retry-After", tint: "amber" }, no: { title: "\u91CD\u8BD5\u6CA1\u7528", tint: "neutral" } }[entry.retriable];
    const children = [
      ui.badge({ key: "class", title: CLASS_TITLE2[Math.floor(entry.code / 100)] ?? "\u672A\u77E5", tint: tintFor(entry.code) }),
      ui.badge({ key: "retry", title: retry.title, tint: retry.tint }),
      ui.badge({ key: "cache", title: entry.cacheable ? "\u9ED8\u8BA4\u53EF\u7F13\u5B58" : "\u4E0D\u53EF\u7F13\u5B58", tint: "neutral" })
    ];
    if (entry.unofficial) children.push(ui.badge({ key: "unofficial", title: `\u975E\u6807\u51C6 \xB7 ${entry.unofficial}`, tint: "amber" }));
    return ui.stack({ key: "facts", axis: "horizontal", spacing: "tight", children });
  }
  function hit(session2, entry) {
    const related = (entry.related ?? []).slice(0, 2);
    return [
      sourceCard(session2, true),
      ui.readout({
        key: "readout",
        label: `${entry.zh} \xB7 ${CLASS_TITLE2[Math.floor(entry.code / 100)] ?? ""}`,
        value: session2.copyText(entry),
        tint: tintFor(entry.code),
        copy: true
      }),
      facts2(entry),
      ui.text({ key: "summary", text: entry.summary, style: "body" }),
      ...(entry.causes ?? []).slice(0, 2).map((cause, index) => ui.text({ key: `cause-${index}`, text: `\xB7 ${cause}`, style: "subtle" })),
      ui.stack({
        key: "actions",
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          ui.copy({ key: "copy", text: session2.copyText(entry), variant: "chip", label: `\u590D\u5236 ${session2.copyText(entry)}` }),
          ui.spacer(),
          ...related.length ? [ui.text({ key: "related", text: `\u76F8\u5173 ${related.join(" \xB7 ")}`, style: "footnote" })] : []
        ]
      })
    ];
  }
  function nothingFound(session2) {
    return [
      sourceCard(session2, false),
      ui.note({
        key: "empty",
        tint: "neutral",
        symbol: "info.circle",
        title: "\u526A\u8D34\u677F\u91CC\u6CA1\u6709\u72B6\u6001\u7801",
        body: `\u8BFB\u5230\u7684\u8FD9\u4E00\u6BB5\u91CC\u6CA1\u6709 100\u2013599 \u7684\u6574\u6570\u3002\u590D\u5236\u54CD\u5E94\u884C\u3001\u65E5\u5FD7\u884C\u6216\u5355\u72EC\u7684\u6570\u5B57\u518D\u8DD1\u4E00\u6B21 ${session2.commandRef("explain-clipboard", "\u89E3\u91CA\u526A\u8D34\u677F\u91CC\u7684\u7801")}\uFF1B\u4E5F\u53EF\u4EE5\u6253\u5F00\u9762\u677F\u624B\u8F93\u3002`,
        actions: [
          {
            id: "open-panel",
            title: session2.hotkey("lookup") ? `\u6253\u5F00\u9762\u677F\u8F93\u5165 ${session2.hotkey("lookup")}` : "\u6253\u5F00\u9762\u677F\u8F93\u5165",
            symbol: "magnifyingglass",
            help: "\u628A\u9762\u677F\u5C55\u5F00\u5230\u8FD9\u4E2A\u6269\u5C55\u7684\u9875\u9762",
            onPress: () => void jarvis.commands.run("lookup")
          }
        ]
      })
    ];
  }
  function denied(session2) {
    return [
      ui.note({
        key: "denied",
        tint: "alert",
        symbol: "lock",
        title: "\u6CA1\u6709\u8BFB\u526A\u8D34\u677F\u7684\u6388\u6743",
        body: "\u8FD9\u6761\u547D\u4EE4\u8981\u8BFB\u4E00\u6B21\u526A\u8D34\u677F\u624D\u80FD\u627E\u5230\u91CC\u9762\u7684\u72B6\u6001\u7801\u3002\u6388\u6743\u4E4B\u540E\u5B83\u53EA\u5728\u4F60\u6309\u5FEB\u6377\u952E\u7684\u90A3\u4E00\u523B\u8BFB\u4E00\u6B21\uFF0C\u4E0D\u4F1A\u5728\u540E\u53F0\u76EF\u7740\u526A\u8D34\u677F\u3002",
        actions: [{ id: "grant", title: "\u6388\u6743", symbol: "lock.open", help: "\u518D\u95EE\u4E00\u6B21\u8BFB\u526A\u8D34\u677F\u7684\u6388\u6743", onPress: () => void session2.requestClipboard() }]
      })
    ];
  }
  function failed(message) {
    return [
      ui.note({
        key: "failed",
        tint: "danger",
        symbol: "exclamationmark.triangle",
        title: "\u6CA1\u8BFB\u5230\u526A\u8D34\u677F",
        body: message
      })
    ];
  }
  function renderPopover(session2) {
    const state = session2.clipboard;
    const children = state.kind === "hit" ? hit(session2, state.entry) : state.kind === "empty" ? nothingFound(session2) : state.kind === "denied" ? denied(session2) : state.kind === "failed" ? failed(state.message) : failed("\u8FD9\u4E00\u8F6E\u6CA1\u6709\u8BFB\u5230\u4EFB\u4F55\u5185\u5BB9\u3002");
    return ui.scroll({ children });
  }

  // extensions/http-status/src/session.ts
  var MDN = (code) => `https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status/${code}`;
  var Session = class {
    constructor() {
      /** 输入框里的字。空串 = 分类那一屏。 */
      this.query = "";
      /** 从清单点进详情之前那串字；有它时详情屏上多一条「回到…」。 */
      this.previousQuery = null;
      /** 会话值，从偏好初始化。 */
      this.includeUnofficial = true;
      this.classFilter = null;
      this.clipboard = { kind: "idle" };
      /** 用户刚拒了「打开链接」：详情屏改成把地址交给他自己去开，而不是再问一次。 */
      this.urlDenied = false;
      this.granted = [];
      this.preferences = {};
      this.commands = [];
      this.unwatch = null;
    }
    // ── 宿主给的上下文 ────────────────────────────────────────────────────
    adopt(context) {
      this.granted = context.granted;
      this.preferences = context.preferences;
      if ("commands" in context) this.commands = context.commands;
      this.includeUnofficial = this.preference("includeUnofficial", true);
      if (this.has("clipboard.read") && this.clipboard.kind === "denied") this.clipboard = { kind: "idle" };
      if (this.has("system.openURL")) this.urlDenied = false;
    }
    /** 面板开着期间用户在设置里改了偏好：把会话值拉回新的默认，并重画。 */
    watchPreferences() {
      if (this.unwatch) return;
      this.unwatch = jarvis.preferences.onChange((changes) => {
        this.preferences = { ...this.preferences, ...changes };
        if ("includeUnofficial" in changes) this.includeUnofficial = this.preference("includeUnofficial", true);
        jarvis.ui.update();
      });
    }
    stopWatchingPreferences() {
      this.unwatch?.();
      this.unwatch = null;
    }
    has(capability) {
      return this.granted.includes(capability);
    }
    /**
     * 刚在按钮回调里问到了一项能力：先记在本地。
     * 宿主随后会发 `permissionsChanged`，下一次 `activate` 也会带来权威的清单——
     * 这里只是让**这一次点击**的后半段能接着跑，不必等下一轮。
     */
    grantLocally(capability) {
      if (!this.granted.includes(capability)) this.granted = [...this.granted, capability];
    }
    /** 用户此刻配置的快捷键显示串（用户改过就是改过的那个）；没配为 `undefined`。 */
    hotkey(commandId) {
      return this.commands.find((command) => command.id === commandId)?.hotkey;
    }
    /**
     * 文案里怎么称呼一条命令。
     *
     * 有快捷键就用快捷键（用户改过就是改过的那个），没有就用命令名——
     * `hotkeys.register` 被拒时全局快捷键根本没注册，界面上再写「⌥⌘/」就是在骗人。
     */
    commandRef(id, title) {
      const key = this.hotkey(id);
      return key ? `${key}\u300C${title}\u300D` : `\u300C${title}\u300D`;
    }
    preference(key, fallback) {
      const value = this.preferences[key];
      return value === void 0 ? fallback : value;
    }
    // ── 搜索 ──────────────────────────────────────────────────────────────
    outcome() {
      return search(this.query, { includeUnofficial: this.includeUnofficial, classFilter: this.classFilter });
    }
    setQuery(next) {
      if (next.trim() === "") this.previousQuery = null;
      this.query = next;
    }
    /** 点清单里的一行、点一枚相关码：改 `query`，并记住从哪儿来的。 */
    openCode(code, from) {
      this.previousQuery = from && from.trim() !== "" && !/^\d{3}$/.test(from.trim()) ? from : null;
      this.query = String(code);
    }
    back() {
      if (this.previousQuery === null) return;
      this.query = this.previousQuery;
      this.previousQuery = null;
    }
    clear() {
      this.query = "";
      this.previousQuery = null;
      this.classFilter = null;
      this.includeUnofficial = this.preference("includeUnofficial", true);
    }
    // ── 一条码的周边 ──────────────────────────────────────────────────────
    /** 复制钮写进剪贴板的那串字，形状由偏好定。 */
    copyText(entry) {
      const format = this.preference("copyFormat", "name");
      if (format === "code") return String(entry.code);
      if (format === "line") return `HTTP/1.1 ${entry.code} ${entry.name}`;
      return `${entry.code} ${entry.name}`;
    }
    /**
     * 「打开原文」那一两颗按钮。
     *
     * 标准码有两边（RFC 与 MDN），偏好决定谁排前面；非标准码只有厂商文档那一边——
     * MDN 上没有 499 这一页，给一个必定 404 的链接不如不给。
     */
    links(entry) {
      if (entry.unofficial) return [{ title: `\u6253\u5F00 ${entry.unofficial} \u6587\u6863`, url: entry.specUrl }];
      const rfc2 = { title: `\u6253\u5F00 ${entry.spec.split(" \xA7")[0]}`, url: entry.specUrl };
      const mdn = { title: "MDN", url: MDN(entry.code) };
      return this.preference("specSource", "rfc") === "mdn" ? [{ ...mdn, title: "\u6253\u5F00 MDN" }, { ...rfc2, title: entry.spec.split(" \xA7")[0] }] : [rfc2, mdn];
    }
    // ── ⌥⌘/：读一次剪贴板 ────────────────────────────────────────────────
    async readClipboard() {
      if (!this.has("clipboard.read")) {
        this.clipboard = { kind: "denied" };
        return;
      }
      try {
        const text = await jarvis.clipboard.read();
        if (text === null || text.trim() === "") {
          this.clipboard = { kind: "failed", message: "\u526A\u8D34\u677F\u662F\u7A7A\u7684\uFF0C\u6216\u8005\u91CC\u9762\u7684\u5185\u5BB9\u88AB\u6807\u8BB0\u4E3A\u673A\u5BC6\u3002" };
          return;
        }
        const code = extractCode(text);
        const entry = code === null ? void 0 : byCode(code);
        if (entry) {
          this.clipboard = { kind: "hit", text, entry };
          this.query = String(entry.code);
          this.previousQuery = null;
          return;
        }
        this.clipboard = { kind: "empty", text };
      } catch (error) {
        const code = error.code;
        if (code === "permission.denied") {
          this.clipboard = { kind: "denied" };
          return;
        }
        this.clipboard = { kind: "failed", message: error.message || "\u8BFB\u526A\u8D34\u677F\u5931\u8D25\u3002" };
      }
    }
    /** 弹窗或页面上那颗「授权」。只能在用户动作 1 秒内调，因此它只从按钮回调里走。 */
    async requestClipboard() {
      const result = await jarvis.permissions.request(["clipboard.read"]);
      this.granted = [.../* @__PURE__ */ new Set([...this.granted, ...result.granted])];
      if (this.has("clipboard.read")) {
        this.clipboard = { kind: "idle" };
        await this.readClipboard();
      }
      jarvis.ui.update();
    }
    /** 剪贴板里读到的那一段，画在弹窗上给人核对"翻的是哪一段"。太长就截断。 */
    clipboardExcerpt(limit = 72) {
      const text = this.clipboard.kind === "hit" || this.clipboard.kind === "empty" ? this.clipboard.text : "";
      const flat = text.replace(/\s+/g, " ").trim();
      return flat.length > limit ? `${flat.slice(0, limit)}\u2026` : flat;
    }
    clipboardLength() {
      const text = this.clipboard.kind === "hit" || this.clipboard.kind === "empty" ? this.clipboard.text : "";
      return Array.from(text).length;
    }
  };

  // extensions/http-status/src/index.ts
  var session = new Session();
  function lookup(context) {
    session.adopt(context);
    session.clear();
  }
  async function explainClipboard(context) {
    session.adopt(context);
    await session.readClipboard();
  }
  defineExtension({
    page: {
      activate: (context) => {
        session.adopt(context);
        session.watchPreferences();
      },
      deactivate: () => session.stopWatchingPreferences(),
      render: () => renderPage(session)
    },
    popover: {
      activate: (context) => session.adopt(context),
      render: () => renderPopover(session)
    },
    commands: {
      lookup,
      "explain-clipboard": explainClipboard
    }
  });
})();
