// jarvis-extension bundle · screenshot-translate@0.1.0 · sdk 1.1.0 · 由 scripts/build-extension.mjs 生成，请勿手改
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
  var sdkVersion = "1.1.0";
  var Runtime = class {
    constructor() {
      this.definition = null;
      this.nextRequestId = 1;
      this.generation = 0;
      this.pending = /* @__PURE__ */ new Map();
      this.handlers = /* @__PURE__ */ new Map();
      this.subscriptions = /* @__PURE__ */ new Map();
      this.updateQueued = false;
      this.pageActive = false;
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
    /** 让宿主再调一次 render。同一拍里的多次请求合并成一次提交；页面没开着时是空操作。 */
    requestUpdate() {
      if (this.updateQueued || !this.pageActive) return;
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
    subscribe(namespace, method, listener) {
      const token = `${namespace}.${method}#${this.nextRequestId++}`;
      this.subscriptions.set(token, listener);
      void this.invoke(namespace, method, { token });
      return () => {
        this.subscriptions.delete(token);
        void this.invoke(namespace, "unsubscribe", { token });
      };
    }
    log(level, message, data) {
      this.host().log(level, message, data === void 0 ? null : JSON.stringify(data));
    }
    /** 页面：自定义的，或按命令清单画的默认页。 */
    renderPage() {
      const page = this.definition?.page;
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
      if (!this.definition || !this.pageActive) return;
      this.handlers.clear();
      const register = (fn) => {
        const handlerId = `h${this.handlers.size + 1}`;
        this.handlers.set(handlerId, fn);
        return handlerId;
      };
      const root = serialize(this.renderPage(), register);
      const count = countNodes(root);
      if (count > maximumNodesPerRender) {
        throw new Error(`\u4E00\u6B21 render \u63D0\u4EA4\u4E86 ${count} \u4E2A\u8282\u70B9\uFF0C\u4E0A\u9650 ${maximumNodesPerRender}\u3002`);
      }
      this.generation += 1;
      this.host().commit(JSON.stringify({ protocol: bridgeProtocolVersion, generation: this.generation, root }));
    }
    dispatch(json) {
      const event = JSON.parse(json);
      const definition = this.definition;
      switch (event.type) {
        case "activate": {
          this.pageActive = true;
          this.commandSummaries = event.context.commands ?? [];
          void Promise.resolve(definition?.page?.activate?.(event.context)).then(() => this.commit());
          return;
        }
        case "deactivate": {
          this.pageActive = false;
          this.handlers.clear();
          void definition?.page?.deactivate?.();
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
      openURL: (url) => call.system("openURL", { url })
    }
  };

  // extensions/screenshot-translate/src/google.ts
  var chunkLength = 4e3;
  function describe(error) {
    if (error instanceof JarvisError) return error.detail ?? error.message;
    return error instanceof Error ? error.message : String(error);
  }
  function form(params) {
    return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  }
  async function gtx(text, target2) {
    const query = form({ client: "gtx", sl: "auto", tl: target2, dt: "t", dj: "1" });
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
    const sentences = body.sentences ?? [];
    const translated = sentences.map((s) => s.trans ?? "").join("");
    if (translated.trim() === "") throw new Error("Google \u6CA1\u6709\u8FD4\u56DE\u8BD1\u6587");
    return { text: translated, detectedSource: body.src ?? null, backend: "gtx" };
  }
  async function v2(text, target2, apiKey) {
    const response = await jarvis.net.fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ q: [text], target: target2, format: "text" })
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
  async function translate(text, target2, apiKey) {
    const pieces = ocr.chunk(text, chunkLength);
    if (pieces.length === 0) throw new Error("\u6CA1\u6709\u53EF\u7FFB\u8BD1\u7684\u6587\u5B57");
    const results = [];
    for (const piece of pieces) {
      try {
        results.push(apiKey ? await v2(piece, target2, apiKey) : await gtx(piece, target2));
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

  // extensions/screenshot-translate/src/index.ts
  var phase = "idle";
  var source = "";
  var sourceOrigin = "typed";
  var sourceLines = 0;
  var image = null;
  var detected = { code: null, name: "" };
  var target = "zh-CN";
  var translation = null;
  var failure = null;
  var granted = /* @__PURE__ */ new Set();
  var prefs = { targetLanguage: "zh-CN", alternateLanguage: "en", ocrLanguages: ["zh-Hans", "en-US"], autoCopy: false };
  var translatedAt = null;
  var has = (id) => granted.has(id);
  function describe2(error) {
    if (error instanceof JarvisError) return error.detail ?? error.message;
    return error instanceof Error ? error.message : String(error);
  }
  function readPrefs(raw) {
    prefs = {
      targetLanguage: typeof raw["targetLanguage"] === "string" ? raw["targetLanguage"] : prefs.targetLanguage,
      alternateLanguage: typeof raw["alternateLanguage"] === "string" ? raw["alternateLanguage"] : prefs.alternateLanguage,
      ocrLanguages: Array.isArray(raw["ocrLanguages"]) ? raw["ocrLanguages"] : prefs.ocrLanguages,
      autoCopy: typeof raw["autoCopy"] === "boolean" ? raw["autoCopy"] : prefs.autoCopy
    };
    if (target === "" || target === prefs.targetLanguage) target = prefs.targetLanguage;
  }
  function sameLanguage(a, b) {
    if (!a) return false;
    const norm = (code) => code.toLowerCase().replace("zh-hans", "zh-cn").replace("zh-hant", "zh-tw").replace("_", "-");
    const x = norm(a);
    const y = norm(b);
    return x === y || x.split("-")[0] === y.split("-")[0] && !x.startsWith("zh");
  }
  function resolveTarget(detectedCode) {
    return sameLanguage(detectedCode, prefs.targetLanguage) ? prefs.alternateLanguage : prefs.targetLanguage;
  }
  function detectLanguage(text) {
    try {
      const result = jarvis.text.language.detect(text, { hints: prefs.ocrLanguages });
      detected = { code: result.code, name: result.code ? jarvis.text.language.displayName(result.code) : "" };
    } catch {
      detected = { code: null, name: "" };
    }
  }
  async function captureAndRecognize() {
    phase = "capturing";
    failure = null;
    jarvis.ui.update();
    try {
      const shot = await jarvis.screenshot.capture({
        selectionOnly: true,
        recognizeText: true,
        ocr: { languages: prefs.ocrLanguages, level: "accurate" }
      });
      image = shot.file;
      adoptOCR(shot.ocr, "screenshot");
      return source.trim() !== "";
    } catch (error) {
      if (error instanceof JarvisError && error.code === "cancelled") {
        phase = translation ? "done" : "idle";
        return false;
      }
      failure = describe2(error);
      phase = "failed";
      return false;
    } finally {
      jarvis.ui.update();
    }
  }
  function adoptOCR(result, origin) {
    const lines = result?.lines ?? [];
    sourceLines = lines.length;
    sourceOrigin = origin;
    if (lines.length === 0) {
      source = "";
      detected = { code: null, name: "" };
      failure = "\u8FD9\u5757\u533A\u57DF\u91CC\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u6587\u5B57";
      phase = "failed";
      return;
    }
    const draft = ocr.mergeLines(lines);
    detectLanguage(draft);
    source = ocr.mergeLines(lines, detected.code ? { language: detected.code } : {});
    phase = "recognizing";
  }
  async function translateSource() {
    const text = source.trim();
    if (text === "") return false;
    phase = "translating";
    failure = null;
    jarvis.ui.update();
    const hold = jarvis.panel.hold("\u6B63\u5728\u7FFB\u8BD1");
    try {
      if (!detected.code) detectLanguage(text);
      target = resolveTarget(detected.code);
      const apiKey = await readAPIKey();
      translation = await translate(text, target, apiKey);
      if (!detected.code && translation.detectedSource) {
        detected = { code: translation.detectedSource, name: jarvis.text.language.displayName(translation.detectedSource) };
      }
      translatedAt = (/* @__PURE__ */ new Date()).toISOString();
      phase = "done";
      if (prefs.autoCopy && has("clipboard.write")) await jarvis.clipboard.write(translation.text);
      return true;
    } catch (error) {
      failure = describe2(error);
      phase = "failed";
      return false;
    } finally {
      hold.release();
      jarvis.ui.update();
    }
  }
  async function readAPIKey() {
    try {
      const key = await jarvis.preferences.get("apiKey");
      return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
    } catch {
      return null;
    }
  }
  async function readClipboard() {
    failure = null;
    try {
      const picture = await jarvis.clipboard.readImage();
      if (picture) {
        image = picture;
        phase = "recognizing";
        jarvis.ui.update();
        adoptOCR(await jarvis.ocr.recognize(picture, { languages: prefs.ocrLanguages, level: "accurate" }), "clipboard");
        return;
      }
      const text = await jarvis.clipboard.read();
      if (text === null || text.trim() === "") {
        failure = "\u526A\u8D34\u677F\u91CC\u6CA1\u6709\u6587\u5B57\uFF0C\u4E5F\u6CA1\u6709\u56FE\u7247";
        phase = "failed";
        return;
      }
      source = text;
      sourceOrigin = "clipboard";
      sourceLines = text.split(/\r?\n/).length;
      image = null;
      detectLanguage(text);
      phase = "recognizing";
    } catch (error) {
      failure = describe2(error);
      phase = "failed";
    } finally {
      jarvis.ui.update();
    }
  }
  async function requestCapabilities(ids) {
    const result = await jarvis.permissions.request(ids);
    granted = /* @__PURE__ */ new Set([...granted, ...result.granted]);
    jarvis.ui.update();
  }
  async function commandCaptureTranslate(context) {
    granted = new Set(context.granted);
    readPrefs(context.preferences);
    if (!await captureAndRecognize()) return;
    await translateSource();
  }
  async function commandCaptureCopy(context) {
    granted = new Set(context.granted);
    readPrefs(context.preferences);
    if (!await captureAndRecognize()) return;
    if (!await translateSource() || !translation) return;
    try {
      await jarvis.clipboard.write(translation.text);
      if (has("notifications.post")) {
        await jarvis.notifications.post({ title: "\u5DF2\u590D\u5236\u8BD1\u6587", body: translation.text.slice(0, 120) });
      }
    } catch (error) {
      failure = describe2(error);
      phase = "failed";
      await jarvis.panel.present();
    }
  }
  async function commandTranslateClipboard(context) {
    granted = new Set(context.granted);
    readPrefs(context.preferences);
    await readClipboard();
    if (phase === "recognizing") await translateSource();
  }
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
  function deniedNote(id, title, body) {
    return ui.note({
      tint: "alert",
      symbol: "lock",
      title,
      body,
      actions: [{ id: `grant-${id}`, title: "\u6388\u6743", onPress: () => void requestCapabilities([id]) }]
    });
  }
  function sourceSection() {
    const children = [];
    if (!has("screenshot.capture")) {
      children.push(deniedNote("screenshot.capture", "\u6CA1\u6709\u622A\u56FE\u7684\u6388\u6743", "\u622A\u5C4F\u7FFB\u8BD1\u8981\u5148\u6846\u9009\u5C4F\u5E55\u4E0A\u7684\u4E00\u5757\u3002\u4F60\u4E5F\u53EF\u4EE5\u76F4\u63A5\u628A\u6587\u5B57\u7C98\u8FDB\u4E0B\u9762\u7684\u6846\u91CC\u3002"));
    }
    if (image) {
      children.push(ui.image({ key: "shot", file: image, label: sourceOrigin === "screenshot" ? "\u521A\u622A\u5230\u7684\u90A3\u4E00\u5757" : "\u526A\u8D34\u677F\u91CC\u7684\u56FE\u7247", size: "small" }));
    }
    children.push(
      ui.editor({
        key: "source",
        value: source,
        rows: 4,
        maxRows: 10,
        placeholder: "\u6309 \u2325\u2318T \u622A\u4E00\u5757\u5C4F\u5E55\uFF0C\u6216\u628A\u8981\u7FFB\u8BD1\u7684\u6587\u5B57\u653E\u5230\u8FD9\u91CC\u2026",
        label: "\u539F\u6587",
        onChange: (value) => {
          source = value;
          sourceOrigin = "typed";
          if (value.trim() !== "") detectLanguage(value);
        }
      })
    );
    const meta = [];
    if (detected.name) meta.push(`\u68C0\u6D4B\u4E3A ${detected.name}`);
    if (sourceOrigin === "screenshot" && sourceLines > 0) meta.push(`\u8BC6\u522B\u81EA\u622A\u56FE \xB7 ${sourceLines} \u884C`);
    if (meta.length) children.push(ui.text({ text: meta.join(" \xB7 "), style: "footnote" }));
    const actions = [
      {
        id: "clipboard",
        title: "\u8BFB\u526A\u8D34\u677F",
        symbol: "doc.on.clipboard",
        help: "\u628A\u526A\u8D34\u677F\u91CC\u7684\u6587\u5B57\u6216\u56FE\u7247\u62FF\u6765\u7FFB\u8BD1",
        disabled: !has("clipboard.read") || phase === "capturing" || phase === "translating",
        onPress: () => void readClipboard()
      },
      {
        id: "speak",
        title: "\u6717\u8BFB",
        symbol: "speaker.wave.2",
        help: "\u6717\u8BFB\u539F\u6587",
        disabled: !has("speech.speak") || source.trim() === "",
        onPress: () => void jarvis.speech.speak(source, detected.code ? { language: detected.code } : {})
      },
      {
        id: "clear",
        title: "\u6E05\u7A7A",
        symbol: "xmark.circle",
        help: "\u6E05\u7A7A\u539F\u6587\u4E0E\u8BD1\u6587",
        disabled: source === "" && translation === null,
        onPress: () => {
          source = "";
          translation = null;
          image = null;
          detected = { code: null, name: "" };
          failure = null;
          phase = "idle";
        }
      }
    ];
    return ui.section({
      title: "\u539F\u6587 \xB7 SOURCE",
      trailing: source === "" ? void 0 : `${Array.from(source).length} \u5B57\u7B26`,
      actions,
      children
    });
  }
  function targetSection() {
    return ui.section({
      title: "\u7FFB\u8BD1\u6210 \xB7 TARGET",
      children: [
        ui.picker({
          key: "target",
          options: languageOptions,
          value: target,
          label: "\u76EE\u6807\u8BED\u8A00",
          onChange: (value) => {
            target = value;
          }
        })
      ]
    });
  }
  function translationSection() {
    const children = [];
    if (!has("network.https")) {
      children.push(deniedNote("network.https", "\u6CA1\u6709\u8BBF\u95EE Google \u7FFB\u8BD1\u7684\u6388\u6743", "\u8BD1\u6587\u8981\u7ECF translate.googleapis.com \u53D6\u56DE\uFF1B\u4E0D\u6388\u6743\u5C31\u53EA\u80FD\u8BC6\u5B57\uFF0C\u4E0D\u80FD\u7FFB\u8BD1\u3002"));
    }
    if (phase === "translating") {
      children.push(ui.progress({ tint: "accent", label: "\u6B63\u5728\u7FFB\u8BD1\u2026" }));
    }
    if (phase === "capturing") {
      children.push(ui.note({ tint: "accent", symbol: "viewfinder", body: "\u5728\u5C4F\u5E55\u4E0A\u6846\u4E00\u5757\uFF1B\u6309 Esc \u53D6\u6D88\u3002" }));
    }
    if (failure) {
      children.push(ui.note({ tint: "danger", symbol: "exclamationmark.triangle", title: "\u8FD9\u4E00\u6B21\u6CA1\u6210", body: failure }));
    }
    children.push(
      ui.result({
        key: "translation",
        text: translation?.text ?? "",
        mono: false,
        copy: true,
        empty: source.trim() === "" ? "\u8BD1\u6587\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC" : "\u6309\u300C\u7FFB\u8BD1\u300D\u628A\u4E0A\u9762\u7684\u539F\u6587\u7FFB\u51FA\u6765"
      })
    );
    if (translation && translatedAt) {
      const when = new Date(translatedAt).toLocaleTimeString();
      children.push(ui.text({ text: `${when} \xB7 Google ${translation.backend === "v2" ? "\u5B98\u65B9\u63A5\u53E3" : "\u514D\u8D39\u7AEF\u70B9"} \xB7 ${detected.name || "\u672A\u77E5\u8BED\u8A00"} \u2192 ${languageOptions.find((o) => o.value === target)?.title ?? target}`, style: "footnote" }));
    }
    return ui.section({
      title: "\u8BD1\u6587 \xB7 TRANSLATION",
      actions: [
        {
          id: "speak-translation",
          title: "\u6717\u8BFB\u8BD1\u6587",
          symbol: "speaker.wave.2",
          help: "\u6717\u8BFB\u8BD1\u6587",
          disabled: !has("speech.speak") || !translation,
          onPress: () => void jarvis.speech.speak(translation?.text ?? "", { language: target })
        }
      ],
      children
    });
  }
  function actionSection() {
    const busy = phase === "capturing" || phase === "translating";
    return ui.section({
      title: "\u52A8\u4F5C \xB7 ACTIONS",
      children: [
        ui.stack({
          axis: "horizontal",
          spacing: "regular",
          children: [
            ui.button({
              title: "\u622A\u5C4F\u7FFB\u8BD1",
              symbol: "viewfinder",
              variant: "primary",
              size: "bar",
              disabled: busy || !has("screenshot.capture"),
              help: "\u6846\u9009\u5C4F\u5E55\u4E0A\u7684\u4E00\u5757\uFF0C\u8BC6\u5B57\u5E76\u7FFB\u8BD1\uFF08\u2325\u2318T\uFF09",
              onPress: () => void jarvis.commands.run("capture-translate")
            }),
            ui.button({
              title: "\u7FFB\u8BD1",
              symbol: "arrow.right",
              variant: "secondary",
              size: "bar",
              disabled: busy || source.trim() === "" || !has("network.https"),
              help: "\u628A\u4E0A\u9762\u7684\u539F\u6587\u7FFB\u8BD1\u6210\u76EE\u6807\u8BED\u8A00",
              onPress: () => void translateSource()
            })
          ]
        })
      ]
    });
  }
  defineExtension({
    page: {
      activate(context) {
        granted = new Set(context.granted);
        readPrefs(context.preferences);
        jarvis.preferences.onChange((changes) => readPrefs({ ...prefs, ...changes }));
      },
      render() {
        return ui.scroll({ children: [sourceSection(), targetSection(), translationSection(), actionSection()] });
      }
    },
    commands: {
      "capture-translate": commandCaptureTranslate,
      "capture-copy": commandCaptureCopy,
      "translate-clipboard": commandTranslateClipboard
    }
  });
})();
