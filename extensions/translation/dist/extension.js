// jarvis-extension bundle · translation@0.1.0 · sdk 1.2.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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

  // sdk/src/ocr.ts
  var cjkRanges = [
    [12288, 12351],
    // CJK 标点
    [12352, 12543],
    // 平假名、片假名
    [13312, 19903],
    [19968, 40959],
    [44032, 55215],
    // 谚文
    [63744, 64255],
    [65280, 65519],
    // 全角
    [131072, 196607]
  ];
  function isCJK(codePoint) {
    return cjkRanges.some(([lo, hi]) => codePoint >= lo && codePoint <= hi);
  }
  function lastCodePoint(text) {
    return text.codePointAt(Math.max(0, text.length - (text.length > 1 && isLowSurrogate(text.charCodeAt(text.length - 1)) ? 2 : 1)));
  }
  function isLowSurrogate(unit) {
    return unit >= 56320 && unit <= 57343;
  }
  function languageIsCJK(language) {
    if (!language) return void 0;
    const base = language.toLowerCase().split(/[-_]/)[0];
    return base === "zh" || base === "ja" || base === "ko";
  }
  function joiner(left, right, language) {
    const trimmedLeft = left.replace(/\s+$/, "");
    const trimmedRight = right.replace(/^\s+/, "");
    if (trimmedLeft === "" || trimmedRight === "") return "";
    const leftEnd = lastCodePoint(trimmedLeft);
    const rightStart = trimmedRight.codePointAt(0);
    if (trimmedLeft.endsWith("-") && rightStart !== void 0 && /\p{Ll}/u.test(String.fromCodePoint(rightStart))) {
      const beforeHyphen = trimmedLeft.codePointAt(trimmedLeft.length - 2);
      if (beforeHyphen !== void 0 && /\p{Ll}/u.test(String.fromCodePoint(beforeHyphen))) return "\0";
    }
    const forced = languageIsCJK(language);
    if (forced === true) return "";
    if (forced === false) return " ";
    const leftCJK = leftEnd !== void 0 && isCJK(leftEnd);
    const rightCJK = rightStart !== void 0 && isCJK(rightStart);
    return leftCJK && rightCJK ? "" : " ";
  }
  function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function paragraphs(lines, options = {}) {
    const gapRatio = options.paragraphGapRatio ?? 0.8;
    const indentRatio = options.indentRatio ?? 1.2;
    const ordered = [...lines].filter((line) => line.text.trim() !== "").sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    if (ordered.length === 0) return [];
    const lineHeight = median(ordered.map((line) => line.box.height)) || 0.02;
    const leftEdge = median(ordered.map((line) => line.box.x));
    const groups = [];
    let current = [];
    let previous;
    for (const line of ordered) {
      if (previous) {
        const gap = line.box.y - (previous.box.y + previous.box.height);
        const indent = line.box.x - leftEdge;
        if (gap > lineHeight * gapRatio || indent > lineHeight * indentRatio) {
          groups.push(current);
          current = [];
        }
      }
      current.push(line);
      previous = line;
    }
    if (current.length) groups.push(current);
    return groups;
  }
  function joinParagraph(lines, language) {
    let text = "";
    for (const line of lines) {
      const piece = line.text.trim();
      if (piece === "") continue;
      if (text === "") {
        text = piece;
        continue;
      }
      const glue = joiner(text, piece, language);
      text = glue === "\0" ? text.replace(/-\s*$/, "") + piece : text + glue + piece;
    }
    return text;
  }
  function mergeLines(lines, options = {}) {
    return paragraphs(lines, options).map((group) => joinParagraph(group, options.language)).filter((paragraph) => paragraph !== "").join("\n\n");
  }
  function chunk(text, maxLength) {
    if (maxLength <= 0) throw new RangeError("maxLength \u5FC5\u987B\u5927\u4E8E 0");
    const out = [];
    let current = "";
    const push = (piece) => {
      if (piece === "") return;
      if (current === "") {
        current = piece;
      } else if (current.length + 1 + piece.length <= maxLength) {
        current += "\n" + piece;
      } else {
        out.push(current);
        current = piece;
      }
    };
    for (const paragraph of text.split(/\n{2,}/)) {
      const trimmed = paragraph.trim();
      if (trimmed === "") continue;
      if (trimmed.length <= maxLength) {
        push(trimmed);
        continue;
      }
      for (const sentence of trimmed.match(/[^。！？.!?]+[。！？.!?]*\s*/gu) ?? [trimmed]) {
        const s = sentence.trim();
        if (s.length <= maxLength) {
          push(s);
          continue;
        }
        for (let i = 0; i < s.length; i += maxLength) push(s.slice(i, i + maxLength));
      }
    }
    if (current !== "") out.push(current);
    return out;
  }
  var ocr = { isCJK, joiner, paragraphs, joinParagraph, mergeLines, chunk };

  // sdk/src/index.ts
  var sdkVersion = "1.2.0";
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

  // extensions/translation/src/google.ts
  var chunkLength = 4e3;
  function describe(error) {
    if (error instanceof JarvisError) return error.detail ?? error.message;
    return error instanceof Error ? error.message : String(error);
  }
  function form(params) {
    return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  }
  async function gtx(text, target, source) {
    const query = form({ client: "gtx", sl: source ?? "auto", tl: target, dt: "t", dj: "1" });
    const response = await jarvis.net.fetch(`https://translate.googleapis.com/translate_a/single?${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        // 这个端点对空 UA 偶尔 403；给一个浏览器样子的 UA 是 Easydict 等客户端的通行做法。
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
      },
      body: form({ q: text })
    });
    if (response.status !== 200) {
      throw new Error(response.status === 429 ? "Google \u514D\u8D39\u7AEF\u70B9\u9650\u6D41\u4E86\uFF0C\u7A0D\u540E\u518D\u8BD5\u6216\u586B\u4E00\u4E2A API key" : `Google \u8FD4\u56DE ${response.status}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new Error("Google \u8FD4\u56DE\u7684\u4E0D\u662F JSON\uFF0C\u514D\u8D39\u7AEF\u70B9\u7684\u683C\u5F0F\u53EF\u80FD\u53D8\u4E86");
    }
    const body = parsed;
    const translated = (body.sentences ?? []).map((s) => s.trans ?? "").join("");
    if (translated.trim() === "") throw new Error("Google \u6CA1\u6709\u8FD4\u56DE\u8BD1\u6587");
    return { text: translated, detectedSource: body.src ?? null, backend: "gtx" };
  }
  async function v2(text, target, source, apiKey) {
    const response = await jarvis.net.fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ q: [text], target, format: "text", ...source ? { source } : {} })
    });
    if (response.status === 403 || response.status === 400) {
      throw new Error("Google \u62D2\u7EDD\u4E86\u8FD9\u4E2A API key\uFF08\u68C0\u67E5\u5B83\u662F\u5426\u542F\u7528\u4E86 Cloud Translation API\uFF09");
    }
    if (response.status !== 200) throw new Error(`Google Translation API \u8FD4\u56DE ${response.status}`);
    const body = JSON.parse(response.text);
    const first = body.data?.translations?.[0];
    if (!first?.translatedText) throw new Error("Google Translation API \u6CA1\u6709\u8FD4\u56DE\u8BD1\u6587");
    return { text: first.translatedText, detectedSource: first.detectedSourceLanguage ?? null, backend: "v2" };
  }
  async function translate(text, target, apiKey, source = null) {
    const pieces = ocr.chunk(text, chunkLength);
    if (pieces.length === 0) throw new Error("\u6CA1\u6709\u53EF\u7FFB\u8BD1\u7684\u6587\u5B57");
    const results = [];
    for (const piece of pieces) {
      try {
        results.push(apiKey ? await v2(piece, target, source, apiKey) : await gtx(piece, target, source));
      } catch (error) {
        throw new Error(describe(error));
      }
    }
    const first = results[0];
    return {
      text: results.map((r) => r.text).join("\n\n"),
      detectedSource: first.detectedSource,
      backend: first.backend
    };
  }

  // extensions/translation/src/session.ts
  var defaultPrefs = { targetLanguage: "zh-CN", alternateLanguage: "en", ocrLanguages: ["zh-Hans", "en-US"], autoCopy: false };
  var languageOptions = [
    { value: "zh-CN", title: "\u7B80\u4F53\u4E2D\u6587" },
    { value: "zh-TW", title: "\u7E41\u9AD4\u4E2D\u6587" },
    { value: "en", title: "English" },
    { value: "ja", title: "\u65E5\u672C\u8A9E" },
    { value: "ko", title: "\uD55C\uAD6D\uC5B4" },
    { value: "fr", title: "Fran\xE7ais" },
    { value: "de", title: "Deutsch" },
    { value: "es", title: "Espa\xF1ol" }
  ];
  var ocrLanguageOptions = [
    { value: "zh-Hans", title: "\u7B80\u4F53\u4E2D\u6587" },
    { value: "zh-Hant", title: "\u7E41\u9AD4\u4E2D\u6587" },
    { value: "en-US", title: "English" },
    { value: "ja-JP", title: "\u65E5\u672C\u8A9E" },
    { value: "ko-KR", title: "\uD55C\uAD6D\uC5B4" },
    { value: "fr-FR", title: "Fran\xE7ais" },
    { value: "de-DE", title: "Deutsch" },
    { value: "es-ES", title: "Espa\xF1ol" }
  ];
  function toGoogle(code) {
    const lower = code.toLowerCase().replace("_", "-");
    if (lower.startsWith("zh")) return lower.includes("hant") || lower.includes("tw") || lower.includes("hk") ? "zh-TW" : "zh-CN";
    return lower.split("-")[0] ?? lower;
  }
  function sameLanguage(a, b) {
    return a !== null && toGoogle(a) === toGoogle(b);
  }
  function resolveTarget(detected, prefs) {
    return sameLanguage(detected, prefs.targetLanguage) ? prefs.alternateLanguage : prefs.targetLanguage;
  }
  function languageTitle(code) {
    let localized = null;
    try {
      localized = jarvis.text.language.displayName(code);
    } catch {
      localized = null;
    }
    if (localized && localized !== code) return localized;
    return languageOptions.find((o) => o.value === toGoogle(code))?.title ?? code;
  }
  function readPrefs(raw, previous) {
    return {
      targetLanguage: typeof raw["targetLanguage"] === "string" ? raw["targetLanguage"] : previous.targetLanguage,
      alternateLanguage: typeof raw["alternateLanguage"] === "string" ? raw["alternateLanguage"] : previous.alternateLanguage,
      ocrLanguages: Array.isArray(raw["ocrLanguages"]) ? raw["ocrLanguages"] : previous.ocrLanguages,
      autoCopy: typeof raw["autoCopy"] === "boolean" ? raw["autoCopy"] : previous.autoCopy
    };
  }
  function describe2(error) {
    if (error instanceof JarvisError) return error.detail ?? error.message;
    return error instanceof Error ? error.message : String(error);
  }
  function failureFor(error) {
    if (error instanceof JarvisError && error.code === "permission.denied") {
      return { kind: "denied", title: "\u6CA1\u6709\u8FD9\u9879\u6388\u6743", body: `${describe2(error)}\u3002\u70B9\u300C\u6388\u6743\u300D\u518D\u95EE\u4E00\u6B21\uFF0C\u6216\u5728 \u8BBE\u7F6E \u203A \u6269\u5C55 \u91CC\u6253\u5F00\u3002` };
    }
    if (error instanceof JarvisError && error.code === "rate.limited") {
      return { kind: "network", title: "\u8BF7\u6C42\u592A\u9891\u7E41", body: "\u5BBF\u4E3B\u9650\u4E86\u8FD9\u4E2A\u6269\u5C55\u7684\u8C03\u7528\u9891\u7387\uFF0C\u7F13\u4E00\u7F13\u518D\u8BD5\u3002" };
    }
    return { kind: "network", title: "\u7FFB\u8BD1\u5931\u8D25", body: `${describe2(error)}\u3002\u539F\u6587\u8FD8\u7559\u5728\u4E0A\u9762\uFF0C\u91CD\u8BD5\u4E0D\u7528\u518D\u622A\u4E00\u6B21\u3002` };
  }
  var Session = class {
    constructor() {
      this.phase = "idle";
      this.source = "";
      this.origin = "typed";
      /** OCR 认出的行数；打字进来的原文按换行数。 */
      this.lines = 0;
      this.image = null;
      this.imageSize = null;
      this.detected = { code: null, name: "" };
      /** 用户在语言行里手动指定的原文语言（Google 代码）；`null` = 自动检测。 */
      this.sourceOverride = null;
      this.target = defaultPrefs.targetLanguage;
      this.alternate = defaultPrefs.alternateLanguage;
      this.ocrLanguages = defaultPrefs.ocrLanguages;
      this.translation = null;
      this.elapsedMs = 0;
      this.autoCopied = false;
      /** 原文或语言改过、译文还是旧的。 */
      this.dirty = false;
      this.failure = null;
      /** `screenshot.capture` 抛过 `permission.unavailable`：Jarvis 自己还没有屏幕录制权限。 */
      this.systemPermissionMissing = false;
      this.granted = /* @__PURE__ */ new Set();
      this.prefs = defaultPrefs;
      this.commands = [];
      this.targetTouched = false;
      this.alternateTouched = false;
      this.ocrTouched = false;
      this.prefsSubscribed = false;
    }
    has(id) {
      return this.granted.has(id);
    }
    /** 用户此刻配置的快捷键显示串；没配为 `undefined`。 */
    hotkey(commandID) {
      return this.commands.find((c) => c.id === commandID)?.hotkey ?? void 0;
    }
    get busy() {
      return this.phase === "capturing" || this.phase === "recognizing" || this.phase === "translating";
    }
    get targetTitle() {
      return languageTitle(this.target);
    }
    /** 每次进入页面 / 弹窗 / 命令都会拿到最新的授权与偏好；命令上下文没有命令清单，留着上一次的。 */
    adopt(context) {
      this.granted = new Set(context.granted);
      this.applyPrefs(context.preferences);
      if ("commands" in context) this.commands = context.commands;
      if (!this.prefsSubscribed) {
        this.prefsSubscribed = true;
        jarvis.preferences.onChange((changes) => this.applyPrefs({ ...changes }));
      }
    }
    applyPrefs(raw) {
      this.prefs = readPrefs(raw, this.prefs);
      if (!this.targetTouched) this.target = this.prefs.targetLanguage;
      if (!this.alternateTouched) this.alternate = this.prefs.alternateLanguage;
      if (!this.ocrTouched) this.ocrLanguages = this.prefs.ocrLanguages;
    }
    // ---------------------------------------------------------------------------
    // 编排
    // ---------------------------------------------------------------------------
    /** 框选一块并识字。返回 true = 认出了文字，可以接着翻。 */
    async capture() {
      const previous = this.translation ? "done" : "idle";
      this.phase = "capturing";
      this.failure = null;
      jarvis.ui.update();
      try {
        const shot = await jarvis.screenshot.capture({
          selectionOnly: true,
          recognizeText: true,
          ocr: { languages: this.ocrLanguages, level: "accurate" },
          hint: "\u677E\u624B\u5373\u7FFB\u8BD1"
        });
        this.systemPermissionMissing = false;
        this.image = shot.file;
        this.imageSize = { width: shot.width, height: shot.height };
        return this.adoptOCR(shot.ocr, "screenshot");
      } catch (error) {
        if (error instanceof JarvisError && error.code === "cancelled") {
          this.phase = previous;
          return false;
        }
        if (error instanceof JarvisError && error.code === "permission.unavailable") {
          this.systemPermissionMissing = true;
          this.phase = previous;
          return false;
        }
        if (error instanceof JarvisError && error.code === "permission.denied") {
          this.granted.delete("screenshot.capture");
          this.phase = previous;
          return false;
        }
        this.fail(failureFor(error));
        return false;
      } finally {
        jarvis.ui.update();
      }
    }
    /** 把 OCR 的行合成段落、检测语言，作为新的原文。 */
    adoptOCR(result, origin) {
      const lines = result?.lines ?? [];
      this.origin = origin;
      this.lines = lines.length;
      this.translation = null;
      this.dirty = false;
      this.autoCopied = false;
      this.sourceOverride = null;
      if (lines.length === 0) {
        this.source = "";
        this.detected = { code: null, name: "" };
        this.fail({
          kind: "empty",
          title: "\u6CA1\u8BA4\u51FA\u6587\u5B57",
          body: origin === "screenshot" ? "\u8FD9\u5757\u533A\u57DF\u91CC\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u6587\u5B57\u3002\u518D\u622A\u4E00\u5757\uFF0C\u6216\u5728\u8BBE\u7F6E\u91CC\u52A0\u4E00\u79CD\u8BC6\u522B\u8BED\u8A00\u3002" : "\u8FD9\u5F20\u56FE\u91CC\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u6587\u5B57\u3002"
        });
        return false;
      }
      const draft = ocr.mergeLines(lines);
      this.detect(draft);
      this.source = ocr.mergeLines(lines, this.detected.code ? { language: this.detected.code } : {});
      this.phase = "recognizing";
      return this.source.trim() !== "";
    }
    detect(text) {
      try {
        const result = jarvis.text.language.detect(text, { hints: this.ocrLanguages });
        this.detected = { code: result.code, name: result.code ? languageTitle(result.code) : "" };
      } catch {
        this.detected = { code: null, name: "" };
      }
    }
    /** 把当前原文翻成目标语言。返回 true = 有译文了。 */
    async translate() {
      const text = this.source.trim();
      if (text === "") return false;
      this.phase = "translating";
      this.failure = null;
      jarvis.ui.update();
      const hold = jarvis.panel.hold("\u6B63\u5728\u7FFB\u8BD1");
      const started = Date.now();
      try {
        if (!this.detected.code && !this.sourceOverride) this.detect(text);
        const from = this.sourceOverride ?? this.detected.code;
        if (!this.targetTouched) this.target = resolveTarget(from, { ...this.prefs, alternateLanguage: this.alternate });
        const apiKey = await this.readAPIKey();
        this.translation = await translate(text, this.target, apiKey, this.sourceOverride);
        if (!this.detected.code && this.translation.detectedSource) {
          this.detected = { code: this.translation.detectedSource, name: languageTitle(this.translation.detectedSource) };
        }
        this.elapsedMs = Date.now() - started;
        this.dirty = false;
        this.phase = "done";
        this.autoCopied = false;
        if (this.prefs.autoCopy && this.has("clipboard.write")) {
          try {
            await jarvis.clipboard.write(this.translation.text);
            this.autoCopied = true;
          } catch {
          }
        }
        return true;
      } catch (error) {
        this.fail(failureFor(error));
        return false;
      } finally {
        hold.release();
        jarvis.ui.update();
      }
    }
    async readAPIKey() {
      try {
        const key = await jarvis.preferences.get("apiKey");
        return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
      } catch {
        return null;
      }
    }
    /** 剪贴板里是图就先识字，是文字就直接当原文。返回 true = 有原文了。 */
    async readClipboard() {
      this.failure = null;
      try {
        const picture = await jarvis.clipboard.readImage();
        if (picture) {
          this.image = picture;
          this.imageSize = null;
          this.source = "";
          this.phase = "recognizing";
          jarvis.ui.update();
          const result = await jarvis.ocr.recognize(picture, { languages: this.ocrLanguages, level: "accurate" });
          return this.adoptOCR(result, "clipboard");
        }
        const text = await jarvis.clipboard.read();
        if (text === null || text.trim() === "") {
          this.fail({ kind: "clipboard", title: "\u526A\u8D34\u677F\u662F\u7A7A\u7684", body: "\u526A\u8D34\u677F\u91CC\u6CA1\u6709\u6587\u5B57\uFF0C\u4E5F\u6CA1\u6709\u56FE\u7247\u3002\u5148\u590D\u5236\u4E00\u6BB5\u6587\u5B57\u6216\u4E00\u5F20\u56FE\u3002" });
          return false;
        }
        this.source = text;
        this.origin = "clipboard";
        this.lines = text.split(/\r?\n/).length;
        this.image = null;
        this.imageSize = null;
        this.translation = null;
        this.sourceOverride = null;
        this.dirty = false;
        this.detect(text);
        this.phase = "recognizing";
        return true;
      } catch (error) {
        this.fail(failureFor(error));
        return false;
      } finally {
        jarvis.ui.update();
      }
    }
    fail(failure) {
      this.failure = failure;
      this.phase = "failed";
    }
    /** 静默命令没成时也得让用户知道：横幅说清原因，点横幅展开到本扩展的页面（那里画着错误屏）。 */
    async reportFailureSilently() {
      if (!this.failure) return;
      if (!this.has("notifications.post")) {
        jarvis.log.warn("\u9759\u9ED8\u547D\u4EE4\u5931\u8D25\uFF0C\u4F46\u6CA1\u6709\u6A2A\u5E45\u6388\u6743", this.failure);
        return;
      }
      await jarvis.notifications.post({ title: this.failure.title, body: this.failure.body });
    }
    async requestCapabilities(ids) {
      const result = await jarvis.permissions.request(ids);
      this.granted = /* @__PURE__ */ new Set([...this.granted, ...result.granted]);
      jarvis.ui.update();
    }
    async openScreenRecordingSettings() {
      await jarvis.permissions.openSystemSettings("screenRecording");
    }
    speak(text, language) {
      if (!this.has("speech.speak") || text.trim() === "") return;
      void jarvis.speech.speak(text, language ? { language } : {});
    }
    // ---------------------------------------------------------------------------
    // 用户在页面 / 弹窗里改东西
    // ---------------------------------------------------------------------------
    setSource(value) {
      this.source = value;
      this.origin = "typed";
      this.lines = value === "" ? 0 : value.split(/\r?\n/).length;
      this.sourceOverride = null;
      this.dirty = this.translation !== null;
      if (value.trim() !== "") this.detect(value);
      else this.detected = { code: null, name: "" };
      if (this.phase === "failed" && this.failure?.kind === "empty") {
        this.failure = null;
        this.phase = "recognizing";
      }
    }
    setTarget(code) {
      this.target = code;
      this.targetTouched = true;
      this.dirty = this.translation !== null;
    }
    setAlternate(code) {
      this.alternate = code;
      this.alternateTouched = true;
    }
    /** `"auto"` = 让 Google 自己判。 */
    setSourceOverride(code) {
      this.sourceOverride = code === "auto" ? null : code;
      this.dirty = this.translation !== null;
    }
    toggleOCRLanguage(code) {
      this.ocrTouched = true;
      this.ocrLanguages = this.ocrLanguages.includes(code) ? this.ocrLanguages.filter((c) => c !== code) : [...this.ocrLanguages, code];
      if (this.ocrLanguages.length === 0) this.ocrLanguages = [code];
    }
    /** 语言改了就立刻重翻——弹窗里没有「翻译」按钮的位置，也不该有。 */
    retranslate() {
      if (this.source.trim() === "" || this.busy) return;
      void this.translate();
    }
    /** 「清空」：回到空屏。语言行里手动改过的也一并回到偏好——这是用户唯一的"重来"。 */
    clear() {
      this.targetTouched = false;
      this.alternateTouched = false;
      this.ocrTouched = false;
      this.applyPrefs({});
      this.systemPermissionMissing = false;
      this.phase = "idle";
      this.source = "";
      this.origin = "typed";
      this.lines = 0;
      this.image = null;
      this.imageSize = null;
      this.detected = { code: null, name: "" };
      this.sourceOverride = null;
      this.translation = null;
      this.elapsedMs = 0;
      this.autoCopied = false;
      this.dirty = false;
      this.failure = null;
    }
  };

  // extensions/translation/src/page.ts
  var FOOTNOTE = "Vision \u8BC6\u522B\u6587\u5B57\u3001\u5408\u5E76\u6BB5\u843D\u3001\u68C0\u6D4B\u8BED\u8A00\uFF0C\u518D\u7ECF Google \u7FFB\u8BD1\uFF1B\u514D\u8D39\u7AEF\u70B9\u65E0\u9700 key\uFF0C\u586B\u4E86 API key \u8D70\u5B98\u65B9\u63A5\u53E3\u3002";
  function renderPage(s) {
    const children = [];
    const fresh = s.phase === "idle" && s.source === "" && s.translation === null;
    if (!s.has("screenshot.capture")) children.push(deniedCaptureSection(s));
    else if (fresh) children.push(captureSection(s));
    if (fresh) {
      if (!s.has("screenshot.capture")) children.push(fallbackSection(s));
      else children.push(languageSection(s));
      children.push(ui.text({ text: FOOTNOTE, style: "footnote" }));
    } else {
      children.push(sourceSection(s), translationSection(s), actionsRow(s));
      const note = footnote(s);
      if (note) children.push(ui.text({ key: "footnote", text: note, style: "footnote" }));
    }
    return ui.scroll({ children });
  }
  function captureSection(s) {
    const hotkeyT = s.hotkey("capture-translate");
    const hotkeyO = s.hotkey("capture-copy");
    const children = [];
    if (s.systemPermissionMissing) children.push(systemPermissionNote(s));
    children.push(
      ui.empty({ symbol: "viewfinder", title: "\u6846\u9009\u5C4F\u5E55\u4E0A\u4EFB\u610F\u4E00\u5757", hint: "\u677E\u624B\u5C31\u7FFB\u8BD1\uFF0C\u8BD1\u6587\u8D34\u7740\u9009\u533A\u5F39\u51FA\u6765" }),
      ui.stack({
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          ui.button({
            key: "capture-button",
            title: "\u622A\u5C4F\u7FFB\u8BD1",
            symbol: "viewfinder",
            variant: "primary",
            size: "bar",
            disabled: s.busy,
            help: "\u6846\u9009\u5C4F\u5E55\u4E0A\u7684\u4E00\u5757\uFF0C\u8BC6\u5B57\u5E76\u7FFB\u8BD1",
            onPress: () => void jarvis.commands.run("capture-translate")
          }),
          ...hotkeyT ? [ui.keycap({ text: hotkeyT })] : []
        ]
      }),
      ui.stack({
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          clipboardButton(s),
          ui.button({
            key: "capture-copy",
            title: "\u622A\u5C4F\u8BD1\u6587\u5165\u526A\u8D34\u677F",
            variant: "secondary",
            size: "inline",
            disabled: s.busy || !s.has("clipboard.write"),
            help: "\u6846\u9009\u4E00\u5757\uFF0C\u7FFB\u8BD1\u540E\u76F4\u63A5\u590D\u5236\uFF0C\u4E0D\u5F00\u9762\u677F",
            onPress: () => void jarvis.commands.run("capture-copy")
          }),
          ...hotkeyO ? [ui.keycap({ text: hotkeyO })] : []
        ]
      })
    );
    return ui.section({ key: "capture", title: "\u622A\u5C4F \xB7 CAPTURE", trailing: hotkeyT ?? "", children });
  }
  function deniedCaptureSection(s) {
    const children = [deniedCaptureNote(s)];
    if (s.systemPermissionMissing) children.push(systemPermissionNote(s));
    return ui.section({ key: "capture", title: "\u622A\u5C4F \xB7 CAPTURE", trailing: "\u672A\u6388\u6743", tint: "alert", children });
  }
  function fallbackSection(s) {
    return ui.section({
      key: "fallback",
      title: "\u8FD8\u80FD\u505A\u7684 \xB7 FALLBACK",
      children: [
        ui.stack({
          axis: "horizontal",
          spacing: "regular",
          alignment: "center",
          children: [clipboardButton(s), ui.text({ text: "\u526A\u8D34\u677F\u91CC\u662F\u56FE\u5C31\u5148\u8BC6\u5B57\uFF0C\u662F\u6587\u5B57\u5C31\u76F4\u63A5\u7FFB", style: "subtle" })]
        })
      ]
    });
  }
  function languageSection(s) {
    const shown = ocrLanguageOptions.filter((o, i) => i < 4 || s.ocrLanguages.includes(o.value)).slice(0, 5);
    const row = (label, control) => ui.stack({ axis: "horizontal", spacing: "regular", alignment: "center", children: [ui.text({ text: label, style: "body" }), ui.spacer(), control] });
    return ui.section({
      key: "language",
      title: "\u8BED\u8A00 \xB7 LANGUAGE",
      trailing: "AUTO-DETECT",
      children: [
        row("\u7FFB\u8BD1\u6210", ui.picker({ key: "target", layout: "compact", label: "\u7FFB\u8BD1\u6210", options: languageOptions, value: s.target, onChange: (v) => s.setTarget(v) })),
        row(
          "\u539F\u6587\u5DF2\u662F\u76EE\u6807\u8BED\u8A00\u65F6",
          ui.picker({
            key: "alternate",
            layout: "compact",
            label: "\u539F\u6587\u5DF2\u662F\u76EE\u6807\u8BED\u8A00\u65F6\u7FFB\u6210",
            options: languageOptions.filter((o) => o.value !== s.target),
            value: s.alternate,
            onChange: (v) => s.setAlternate(v)
          })
        ),
        row(
          "\u8BC6\u522B\u8BED\u8A00",
          ui.stack({
            axis: "horizontal",
            spacing: "tight",
            children: shown.map(
              (o) => ui.chip({
                key: `ocr-${o.value}`,
                title: o.title,
                selected: s.ocrLanguages.includes(o.value),
                help: `\u8BC6\u522B${o.title}`,
                onPress: () => s.toggleOCRLanguage(o.value)
              })
            )
          })
        )
      ]
    });
  }
  function sourceSection(s) {
    const parts = [];
    if (s.detected.name) parts.push(s.detected.name);
    if (s.lines > 0 && s.origin !== "typed") parts.push(`${s.lines} \u884C`);
    const children = [];
    if (!s.has("screenshot.capture")) children.push(deniedCaptureNote(s));
    if (s.image) {
      const size = s.imageSize ? ` \xB7 ${s.imageSize.width}\xD7${s.imageSize.height}` : "";
      children.push(ui.image({ key: "shot", file: s.image, label: s.origin === "screenshot" ? `\u521A\u622A\u5230\u7684\u90A3\u4E00\u5757${size}` : "\u526A\u8D34\u677F\u91CC\u7684\u56FE\u7247", size: "small" }));
    }
    if (s.phase === "recognizing" && s.source === "") {
      children.push(ui.progress({ tint: "accent", label: "\u8BC6\u522B\u4E2D \xB7 Vision" }));
    } else {
      children.push(
        ui.editor({
          key: "source",
          value: s.source,
          rows: 4,
          maxRows: 10,
          label: "\u539F\u6587",
          placeholder: "\u628A\u8981\u7FFB\u8BD1\u7684\u6587\u5B57\u653E\u5230\u8FD9\u91CC\u2026",
          onChange: (v) => s.setSource(v)
        })
      );
    }
    const actions = [
      { id: "speak-source", title: "\u6717\u8BFB\u539F\u6587", symbol: "speaker.wave.2", help: "\u6717\u8BFB\u539F\u6587", disabled: !s.has("speech.speak") || s.source.trim() === "", onPress: () => s.speak(s.source, s.detected.code) },
      { id: "clear", title: "\u6E05\u7A7A", symbol: "xmark.circle", help: "\u6E05\u7A7A\u539F\u6587\u4E0E\u8BD1\u6587", disabled: s.busy, onPress: () => s.clear() }
    ];
    return ui.section({ key: "source-section", title: "\u539F\u6587 \xB7 SOURCE", trailing: parts.join(" \xB7 ") || `${Array.from(s.source).length} \u5B57\u7B26`, actions, children });
  }
  function translationSection(s) {
    const failed = s.phase === "failed" && s.failure !== null;
    const children = [];
    if (!s.has("network.https")) {
      children.push(
        ui.note({
          key: "network-denied",
          tint: "alert",
          symbol: "lock",
          title: "\u6CA1\u6709\u8BBF\u95EE Google \u7FFB\u8BD1\u7684\u6388\u6743",
          body: "\u8BD1\u6587\u8981\u7ECF translate.googleapis.com \u53D6\u56DE\uFF1B\u4E0D\u6388\u6743\u5C31\u53EA\u80FD\u8BC6\u5B57\uFF0C\u4E0D\u80FD\u7FFB\u8BD1\u3002",
          actions: [{ id: "grant-network", title: "\u6388\u6743", onPress: () => void s.requestCapabilities(["network.https"]) }]
        })
      );
    }
    if (s.phase === "translating") {
      children.push(
        ui.progress({ tint: "accent", label: "\u7FFB\u8BD1\u4E2D \xB7 Google" }),
        ui.note({ key: "hold", tint: "accent", symbol: "hourglass", body: "\u7FFB\u8BD1\u671F\u95F4\u9762\u677F hold \u4F4F\uFF0C\u4E0D\u4F1A\u81EA\u5DF1\u6536\u56DE\uFF1B30 \u79D2\u6CA1\u56DE\u6765\u7B97\u5931\u8D25\u3002" })
      );
    }
    if (failed && s.failure) {
      children.push(ui.note({ key: "failure", tint: "danger", symbol: "exclamationmark.triangle", title: s.failure.title, body: s.failure.body, actions: failureActions(s) }));
    }
    if (s.phase !== "translating" && !failed) {
      children.push(
        ui.result({
          key: "translation",
          text: s.translation?.text ?? "",
          copy: true,
          tint: s.translation ? "accent" : "neutral",
          empty: s.source.trim() === "" ? "\u8BD1\u6587\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC" : "\u6309\u300C\u7FFB\u8BD1\u300D\u628A\u4E0A\u9762\u7684\u539F\u6587\u7FFB\u51FA\u6765"
        })
      );
    }
    const trailing = failed ? "\u5931\u8D25" : s.phase === "translating" ? "\u7FFB\u8BD1\u4E2D" : s.translation ? `GOOGLE \xB7 ${s.targetTitle}` : "";
    const actions = [
      { id: "speak-translation", title: "\u6717\u8BFB\u8BD1\u6587", symbol: "speaker.wave.2", help: "\u6717\u8BFB\u8BD1\u6587", disabled: !s.has("speech.speak") || !s.translation, onPress: () => s.speak(s.translation?.text ?? "", s.target) }
    ];
    return ui.section({ key: "translation-section", title: "\u8BD1\u6587 \xB7 TRANSLATION", trailing, tint: failed ? "danger" : "neutral", actions, children });
  }
  function actionsRow(s) {
    const hotkeyT = s.hotkey("capture-translate");
    const children = [
      ui.button({
        key: "capture-button",
        title: s.translation || s.phase === "failed" ? "\u518D\u622A\u4E00\u5757" : "\u622A\u5C4F\u7FFB\u8BD1",
        symbol: "viewfinder",
        variant: "primary",
        size: "bar",
        disabled: s.busy || !s.has("screenshot.capture"),
        help: "\u6846\u9009\u5C4F\u5E55\u4E0A\u7684\u4E00\u5757\uFF0C\u8BC6\u5B57\u5E76\u7FFB\u8BD1",
        onPress: () => void jarvis.commands.run("capture-translate")
      })
    ];
    if (hotkeyT) children.push(ui.keycap({ text: hotkeyT }));
    if (s.translation && !s.dirty) {
      children.push(ui.copy({ key: "copy-translation", text: s.translation.text, label: "\u590D\u5236\u8BD1\u6587", variant: "chip", disabled: s.busy }));
    } else if (s.phase === "failed" && s.source.trim() !== "") {
      children.push(ui.copy({ key: "copy-source", text: s.source, label: "\u590D\u5236\u539F\u6587", variant: "chip" }));
    } else {
      children.push(
        ui.button({
          key: "translate",
          title: "\u7FFB\u8BD1",
          symbol: "arrow.right",
          variant: "secondary",
          size: "bar",
          disabled: s.busy || s.source.trim() === "" || !s.has("network.https"),
          help: "\u628A\u4E0A\u9762\u7684\u539F\u6587\u7FFB\u8BD1\u6210\u76EE\u6807\u8BED\u8A00",
          onPress: () => void s.translate()
        })
      );
    }
    return ui.stack({ key: "actions", axis: "horizontal", spacing: "regular", alignment: "center", children });
  }
  function footnote(s) {
    if (s.phase === "done" && s.translation) {
      const host = s.translation.backend === "v2" ? "translation.googleapis.com" : "translate.googleapis.com";
      return `${s.autoCopied ? "\u5DF2\u81EA\u52A8\u590D\u5236\u8BD1\u6587 \xB7 " : ""}${(s.elapsedMs / 1e3).toFixed(1)} s \xB7 ${host}`;
    }
    if (s.phase === "translating") return "\u9762\u677F\u5728\u8BD1\u6587\u56DE\u6765\u524D\u4E0D\u4F1A\u81EA\u52A8\u6536\u56DE";
    if (s.dirty) return "\u539F\u6587\u6216\u8BED\u8A00\u6539\u8FC7\u4E86\uFF0C\u6309\u300C\u7FFB\u8BD1\u300D\u91CD\u7FFB";
    return null;
  }
  function clipboardButton(s) {
    return ui.button({
      key: "translate-clipboard",
      title: "\u7FFB\u8BD1\u526A\u8D34\u677F",
      variant: "secondary",
      size: "inline",
      disabled: s.busy || !s.has("clipboard.read"),
      help: "\u628A\u526A\u8D34\u677F\u91CC\u7684\u6587\u5B57\u6216\u56FE\u7247\u62FF\u6765\u7FFB\u8BD1",
      onPress: () => void jarvis.commands.run("translate-clipboard")
    });
  }
  function deniedCaptureNote(s) {
    return ui.note({
      key: "capture-denied",
      tint: "alert",
      symbol: "lock",
      title: "\u6CA1\u6709\u622A\u56FE\u7684\u6388\u6743",
      body: "\u7B2C\u4E00\u6B21\u8FDB\u5165\u65F6\u4F60\u5173\u6389\u4E86\u300C\u622A\u53D6\u5C4F\u5E55\u300D\u3002\u6CA1\u6709\u5B83\uFF0C\u8FD9\u4E2A\u6269\u5C55\u53EA\u80FD\u7FFB\u8BD1\u526A\u8D34\u677F\u91CC\u7684\u6587\u5B57\u6216\u56FE\u7247\u3002",
      actions: [{ id: "grant-capture", title: "\u6388\u6743", onPress: () => void s.requestCapabilities(["screenshot.capture"]) }]
    });
  }
  function systemPermissionNote(s) {
    return ui.note({
      key: "system-permission",
      tint: "neutral",
      symbol: "rectangle.dashed.badge.record",
      title: "Jarvis \u8FD8\u6CA1\u6709\u5C4F\u5E55\u5F55\u5236\u6743\u9650",
      body: "\u7CFB\u7EDF\u90A3\u4E00\u5C42\u4E5F\u8981\u70B9\u5934\uFF1A\u6253\u5F00\u7CFB\u7EDF\u8BBE\u7F6E \u203A \u9690\u79C1\u4E0E\u5B89\u5168\u6027 \u203A \u5C4F\u5E55\u5F55\u5236\uFF0C\u628A Jarvis \u62D6\u8FDB\u5217\u8868\u3002",
      actions: [{ id: "system-settings", title: "\u6253\u5F00\u7CFB\u7EDF\u8BBE\u7F6E", onPress: () => void s.openScreenRecordingSettings() }]
    });
  }
  function failureActions(s) {
    const actions = [];
    const kind = s.failure?.kind;
    if (kind === "denied") {
      actions.push({ id: "grant-network", title: "\u6388\u6743", onPress: () => void s.requestCapabilities(["network.https"]) });
    } else if (kind === "empty" || kind === "clipboard") {
      actions.push({ id: "recapture", title: "\u518D\u622A\u4E00\u5757", disabled: !s.has("screenshot.capture"), onPress: () => void jarvis.commands.run("capture-translate") });
    } else {
      actions.push({ id: "retry", title: "\u91CD\u8BD5", onPress: () => void s.translate() });
    }
    if (kind === "network") {
      actions.push({ id: "settings", title: "\u586B API key \u8D70\u5B98\u65B9\u63A5\u53E3", onPress: () => void jarvis.system.openExtensionSettings() });
    }
    return actions;
  }

  // extensions/translation/src/popover.ts
  function renderPopover(s) {
    return ui.scroll({ children: [sourceCard(s), languageRow(s), resultCard(s)] });
  }
  function sourceCard(s) {
    const meta = [];
    if (s.lines > 0 && s.origin !== "typed") meta.push(`${s.lines} \u884C`);
    if (s.imageSize) meta.push(`${s.imageSize.width}\xD7${s.imageSize.height}`);
    return ui.card({
      key: "source-card",
      children: [
        ui.editor({ key: "source", value: s.source, rows: 3, minRows: 2, maxRows: 6, label: "\u539F\u6587", placeholder: "\u628A\u8981\u7FFB\u8BD1\u7684\u6587\u5B57\u653E\u5230\u8FD9\u91CC\u2026", onChange: (v) => s.setSource(v) }),
        ui.stack({
          axis: "horizontal",
          spacing: "tight",
          alignment: "center",
          children: [
            ...s.detected.name ? [ui.badge({ key: "detected", title: `\u8BC6\u522B\u4E3A ${s.detected.name}`, tint: "neutral" })] : [],
            ui.button({
              key: "speak-source",
              title: "\u6717\u8BFB",
              symbol: "speaker.wave.2",
              variant: "secondary",
              size: "inline",
              disabled: !s.has("speech.speak") || s.source.trim() === "",
              help: "\u6717\u8BFB\u539F\u6587",
              onPress: () => s.speak(s.source, s.detected.code)
            }),
            ui.copy({ key: "copy-source", text: s.source, label: "\u590D\u5236\u539F\u6587", variant: "chip", disabled: s.source.trim() === "" }),
            ui.spacer(),
            ...meta.length ? [ui.text({ key: "source-meta", text: meta.join(" \xB7 "), style: "footnote" })] : []
          ]
        })
      ]
    });
  }
  function languageRow(s) {
    const fromOptions = [{ value: "auto", title: s.detected.name ? `${s.detected.name} \xB7 \u81EA\u52A8\u68C0\u6D4B` : "\u81EA\u52A8\u68C0\u6D4B" }, ...languageOptions];
    return ui.stack({
      key: "language",
      axis: "horizontal",
      spacing: "regular",
      alignment: "center",
      children: [
        ui.picker({
          key: "from",
          layout: "compact",
          label: "\u539F\u6587\u8BED\u8A00",
          options: fromOptions,
          value: s.sourceOverride ?? "auto",
          disabled: s.busy,
          onChange: (v) => {
            s.setSourceOverride(v);
            s.retranslate();
          }
        }),
        ui.symbol({ name: "arrow.left.arrow.right", size: "small", tint: "neutral" }),
        ui.picker({
          key: "to",
          layout: "compact",
          label: "\u7FFB\u8BD1\u6210",
          options: languageOptions,
          value: s.target,
          disabled: s.busy,
          onChange: (v) => {
            s.setTarget(v);
            s.retranslate();
          }
        })
      ]
    });
  }
  function resultCard(s) {
    const done = s.phase === "done" && s.translation !== null;
    const hotkeyT = s.hotkey("capture-translate");
    const children = [];
    if (s.phase === "translating") {
      children.push(
        ui.progress({ tint: "accent", label: "\u7FFB\u8BD1\u4E2D \xB7 Google" }),
        ui.text({ key: "hold", text: "\u539F\u6587\u5DF2\u7ECF\u8BC6\u522B\u51FA\u6765\uFF0C\u8BD1\u6587\u9A6C\u4E0A\u5230\uFF1B\u8FD9\u671F\u95F4\u5F39\u7A97\u4E0D\u4F1A\u81EA\u5DF1\u6536\u3002", style: "subtle" })
      );
    } else if (s.phase === "failed" && s.failure) {
      children.push(ui.note({ key: "failure", tint: "danger", symbol: "exclamationmark.triangle", title: s.failure.title, body: s.failure.body, actions: failureActions(s) }));
    } else {
      children.push(ui.result({ key: "translation", text: s.translation?.text ?? "", copy: false, tint: done ? "accent" : "neutral", empty: "\u8BD1\u6587\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC" }));
    }
    const backend = done && s.translation ? `Google \xB7 ${s.translation.backend === "v2" ? "\u5B98\u65B9\u63A5\u53E3" : "\u514D\u8D39\u7AEF\u70B9"} \xB7 ${(s.elapsedMs / 1e3).toFixed(1)} s` : "Google";
    children.push(
      ui.stack({
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          ui.copy({ key: "copy-translation", text: s.translation?.text ?? "", label: "\u590D\u5236\u8BD1\u6587", variant: "chip", disabled: !done }),
          ui.button({
            key: "speak-translation",
            title: "\u6717\u8BFB",
            symbol: "speaker.wave.2",
            variant: "secondary",
            size: "inline",
            disabled: !done || !s.has("speech.speak"),
            help: "\u6717\u8BFB\u8BD1\u6587",
            onPress: () => s.speak(s.translation?.text ?? "", s.target)
          }),
          ui.button({
            key: "recapture",
            title: hotkeyT ? `\u518D\u622A\u4E00\u5757 ${hotkeyT}` : "\u518D\u622A\u4E00\u5757",
            symbol: "viewfinder",
            variant: "secondary",
            size: "inline",
            disabled: s.busy || !s.has("screenshot.capture"),
            help: "\u6846\u9009\u5C4F\u5E55\u4E0A\u7684\u53E6\u4E00\u5757",
            onPress: () => void jarvis.commands.run("capture-translate")
          }),
          ...s.dirty ? [ui.button({ key: "translate", title: "\u7FFB\u8BD1", variant: "primary", size: "inline", disabled: s.busy || s.source.trim() === "", help: "\u6309\u6539\u8FC7\u7684\u539F\u6587\u91CD\u7FFB", onPress: () => void s.translate() })] : [],
          ui.spacer(),
          ui.text({ key: "backend", text: backend, style: "footnote" })
        ]
      })
    );
    return ui.card({ key: "result-card", tint: done ? "accent" : "neutral", children });
  }

  // extensions/translation/src/index.ts
  var session = new Session();
  async function captureTranslate(context) {
    session.adopt(context);
    if (!await session.capture()) return;
    await session.translate();
  }
  async function captureCopy(context) {
    session.adopt(context);
    if (!await session.capture()) return;
    if (!await session.translate() || !session.translation) {
      await session.reportFailureSilently();
      return;
    }
    try {
      await jarvis.clipboard.write(session.translation.text);
      session.autoCopied = true;
      if (session.has("notifications.post")) {
        await jarvis.notifications.post({ title: "\u5DF2\u590D\u5236\u8BD1\u6587", body: session.translation.text.slice(0, 120) });
      }
    } catch (error) {
      session.fail(failureFor(error));
      await session.reportFailureSilently();
    }
  }
  async function translateClipboard(context) {
    session.adopt(context);
    if (await session.readClipboard()) await session.translate();
  }
  defineExtension({
    page: {
      activate: (context) => session.adopt(context),
      render: () => renderPage(session)
    },
    popover: {
      activate: (context) => session.adopt(context),
      render: () => renderPopover(session)
    },
    commands: {
      "capture-translate": captureTranslate,
      "capture-copy": captureCopy,
      "translate-clipboard": translateClipboard
    },
    // 点了静默命令失败时那条横幅：宿主已经把面板展开到本扩展，错误屏在页面里，这里只要确保重画。
    onNotificationActivated: () => jarvis.ui.update()
  });
})();
