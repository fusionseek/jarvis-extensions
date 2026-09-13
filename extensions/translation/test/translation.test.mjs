/**
 * 对着构建产物跑：宿主替身在线缆另一端扮演 Jarvis，断言的是"按下 ⌥⌘T 之后线缆上发生了什么、
 * 弹窗与页面里画了什么"。截图、OCR、Google 全是桩——这里证明的是编排与两棵树，不是 Vision 与 Google。
 * 每条测试开始前把桩与会话都归零，因此可以单独跑任意一条。
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost } from "../../../sdk/dist/testing.js";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "dist", "extension.js");

// 三行英文，第一行以连字符断词——合并后应是一段、连字符接回、行间加空格。
const LINES = [
  { text: "Extensions run inside a JavaScriptCore con-", box: { x: 0.1, y: 0.1, width: 0.8, height: 0.05 }, confidence: 0.9 },
  { text: "text. The host renders the tree natively,", box: { x: 0.1, y: 0.16, width: 0.8, height: 0.05 }, confidence: 0.9 },
  { text: "so hover never round-trips through JS.", box: { x: 0.1, y: 0.22, width: 0.7, height: 0.05 }, confidence: 0.9 },
];
const MERGED = "Extensions run inside a JavaScriptCore context. The host renders the tree natively, so hover never round-trips through JS.";
const CHINESE_LINES = [
  { text: "扩展在 JavaScriptCore 上下文里运行。", box: { x: 0.1, y: 0.1, width: 0.8, height: 0.05 }, confidence: 0.9 },
  { text: "宿主用原生方式渲染节点树。", box: { x: 0.1, y: 0.16, width: 0.8, height: 0.05 }, confidence: 0.9 },
];
const SHOT = { file: { id: "shot-1", name: "shot.png", byteCount: 10, extension: "png" }, width: 724, height: 188 };
const TRANSLATED = "扩展在 JavaScriptCore 上下文里运行。宿主用原生方式渲染节点树，因此悬停从不经过 JS 往返。";
const gtx = (text, src = "en") => ({ status: 200, headers: {}, text: JSON.stringify({ sentences: [{ trans: text }], src }) });

let captureBehaviour;
let fetchBehaviour;
let apiKey;
let clipboardText;
let clipboardImage;
const written = [];
const posted = [];
const spoken = [];
const dismissedPopovers = [];

const host = createTestHost({
  async: {
    "screenshot.capture": async (params) => captureBehaviour(params),
    "net.fetch": async (params) => fetchBehaviour(params),
    "clipboard.write": async ({ text }) => void written.push(text),
    "clipboard.read": async () => clipboardText,
    "clipboard.readImage": async () => clipboardImage,
    "ocr.recognize": async () => ({ text: "", lines: LINES }),
    "notifications.post": async (content) => void posted.push(content),
    "speech.speak": async (params) => void spoken.push(params),
    "permissions.request": async ({ ids }) => ({ granted: ids, denied: [] }),
    "permissions.openSystemSettings": async () => undefined,
    "preferences.get": async ({ key }) => (key === "apiKey" ? apiKey : undefined),
    "preferences.observe": async () => undefined,
    "preferences.unsubscribe": async () => undefined,
    "panel.hold": async () => "hold-1",
    "panel.release": async () => undefined,
    "commands.run": async () => undefined,
    "system.openExtensionSettings": async () => undefined,
    "ui.dismissPopover": async () => void dismissedPopovers.push(true),
  },
  sync: {
    "text.language.detect": ({ text }) => ({ code: /[一-鿿]/.test(text) ? "zh-Hans" : "en", confidence: 0.9, candidates: [] }),
    // 宿主按用户区域本地化；认不出的原样返回（扩展会退回自己目录里的标题）。
    "text.language.displayName": ({ code }) => ({ en: "英语", "zh-Hans": "简体中文" })[code] ?? code,
  },
});
await import(bundlePath); // IIFE：加载即 defineExtension

const ALL = ["screenshot.capture", "ocr.recognize", "clipboard.read", "clipboard.write", "network.https", "notifications.post", "speech.speak", "hotkeys.register"];
const PREFS = { targetLanguage: "zh-CN", alternateLanguage: "en", ocrLanguages: ["zh-Hans", "en-US"], autoCopy: false };
const COMMANDS = [
  { id: "capture-translate", title: "截屏翻译", hotkey: "⌥⌘T", presentation: "popover" },
  { id: "capture-copy", title: "截屏译文入剪贴板", hotkey: "⌥⌘O", presentation: "silent" },
  { id: "translate-clipboard", title: "翻译剪贴板", presentation: "panel" },
];

const runCommand = async (id, granted = ALL, preferences = PREFS) => {
  host.dispatch({ type: "command", context: { id, trigger: "hotkey", granted, preferences } });
  await host.settle();
};
const activate = async (surface, granted = ALL) => {
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { entry: "command", surface, granted, preferences: PREFS, commands: COMMANDS } });
  await host.settle();
};
const byKey = (key) => host.find((n) => n.key === key);
const pressAction = async (node, actionID) => {
  const action = node.props.actions.find((a) => a.id === actionID);
  assert.ok(action, `应有动作 ${actionID}`);
  host.dispatch({ type: "ui", handler: action.on.press, payload: {} });
  await host.settle();
};
/**
 * 真的等一段墙上时间再收敛。
 *
 * 退避重试用的是**真的** `setTimeout`（宿主注入、Node 原生都是），`host.settle()` 只排空
 * 微任务，排不到它。凡是断言"退避之后发生了什么"的用例都要先在这里等够。
 */
const waitRealTime = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await host.settle();
};
const fetches = () => host.invocations.filter((i) => i.namespace === "net" && i.method === "fetch");
const lastFetch = () => fetches()[fetches().length - 1];

beforeEach(async () => {
  captureBehaviour = () => ({ ...SHOT, ocr: { text: "", lines: LINES } });
  fetchBehaviour = () => gtx(TRANSLATED);
  apiKey = null;
  clipboardText = null;
  clipboardImage = null;
  written.length = 0;
  posted.length = 0;
  spoken.length = 0;
  dismissedPopovers.length = 0;
  // 会话状态跨测试留着（宿主也这样）：用页面上的「清空」回到空屏。
  await activate("page");
  const source = byKey("source-section");
  if (source) await pressAction(source, "clear");
});

test("⌥⌘T：只框选、带提示与识别语言；行合成段、连字符接回；译文画在弹窗里", async () => {
  await runCommand("capture-translate");
  const capture = host.invocations.filter((i) => i.namespace === "screenshot" && i.method === "capture").pop();
  assert.deepEqual(capture.params, {
    selectionOnly: true,
    recognizeText: true,
    ocr: { languages: ["zh-Hans", "en-US"], level: "accurate" },
    hint: "松手即翻译",
    // 不压暗、不画参照线：用户此刻在读屏幕上那段字（SDK 1.3 的 appearance）。
    appearance: { dim: false, guides: false, cursorSymbol: "translate" },
  });
  const request = lastFetch();
  // GET，q 放查询串，与 Easydict 一致；第一个候选就是它走的那一个。
  assert.equal(request.params.init?.method ?? "GET", "GET");
  assert.equal(request.params.init?.body, undefined, "GET 不带正文");
  assert.match(request.params.url, /^https:\/\/translate\.google\.com\/translate_a\/single\?/);
  assert.match(request.params.url, /client=gtx/);
  assert.match(request.params.url, /sl=auto/);
  assert.match(request.params.url, /tl=zh-CN/);
  assert.match(request.params.url, /dj=1/);
  assert.ok(decodeURIComponent(request.params.url).includes(`q=${MERGED}`), "原文该在查询串里");

  await activate("popover");
  assert.equal(host.latestSurface, "popover");
  assert.equal(byKey("source-card").children[0].props.value, MERGED);
  assert.equal(byKey("detected").props.title, "识别为 英语");
  assert.equal(byKey("source-meta").props.text, "3 行 · 724×188");
  assert.equal(byKey("translation").props.text, TRANSLATED);
  assert.equal(byKey("result-card").props.tint, "accent");
  assert.match(byKey("backend").props.text, /^Google · 免费端点 · \d+\.\d s$/);
  assert.equal(byKey("copy-translation").props.disabled, false);
  assert.equal(byKey("to").props.value, "zh-CN");
  assert.equal(byKey("to").props.layout, "compact");
  assert.equal(JSON.stringify(host.latest).includes("function"), false, "线缆上没有函数");
});

test("弹窗里换目标语言立刻重翻", async () => {
  await runCommand("capture-translate");
  await activate("popover");
  const before = fetches().length;
  await host.fire(byKey("to"), "change", "ja");
  assert.equal(fetches().length, before + 1);
  assert.match(lastFetch().params.url, /tl=ja/);
  assert.equal(byKey("to").props.value, "ja");
});

test("「在面板里打开」：页面画的是同一份结果——原文、缩略图、译文、再截一块", async () => {
  await runCommand("capture-translate");
  await activate("popover");
  await activate("page");
  assert.equal(host.latestSurface, "page");
  assert.equal(byKey("shot").props.label, "刚截到的那一块 · 724×188");
  assert.equal(byKey("source-section").props.trailing, "英语 · 3 行");
  assert.equal(byKey("translation").props.text, TRANSLATED);
  assert.equal(byKey("translation").props.copy, true);
  assert.equal(byKey("capture-button").props.title, "再截一块");
  assert.ok(byKey("copy-translation"));
  assert.match(byKey("footnote").props.text, /s · translate\.googleapis\.com$/);
});

test("原文已经是目标语言时改翻成备选语言", async () => {
  captureBehaviour = () => ({ ...SHOT, ocr: { text: "", lines: CHINESE_LINES } });
  fetchBehaviour = () => gtx("Extensions run inside a JavaScriptCore context.", "zh-CN");
  await runCommand("capture-translate");
  assert.match(lastFetch().params.url, /tl=en/);
  assert.ok(
    decodeURIComponent(lastFetch().params.url).includes("q=扩展在 JavaScriptCore 上下文里运行。宿主用原生方式渲染节点树。"),
    "原文该在查询串里"
  );
  await activate("popover");
  assert.equal(byKey("detected").props.title, "识别为 简体中文");
});

test("填了 API key 就走官方 Translation API v2", async () => {
  apiKey = "AIza-test";
  fetchBehaviour = () => ({ status: 200, headers: {}, text: JSON.stringify({ data: { translations: [{ translatedText: "official", detectedSourceLanguage: "en" }] } }) });
  await runCommand("capture-translate");
  const request = lastFetch();
  assert.equal(request.params.url, "https://translation.googleapis.com/language/translate/v2?key=AIza-test");
  assert.deepEqual(JSON.parse(request.params.body), { q: [MERGED], target: "zh-CN", format: "text" });
  await activate("popover");
  assert.equal(byKey("translation").props.text, "official");
  assert.match(byKey("backend").props.text, /官方接口/);
});

test("⌥⌘O：静默命令写剪贴板、弹一条「已复制译文」，不碰面板", async () => {
  fetchBehaviour = () => gtx("静默的译文");
  await runCommand("capture-copy");
  assert.deepEqual(written, ["静默的译文"]);
  assert.deepEqual(posted, [{ title: "已复制译文", body: "静默的译文" }]);
  assert.ok(!host.invocations.some((i) => i.namespace === "panel" && i.method === "present"));
});

test("翻译完自动复制的偏好", async () => {
  await runCommand("capture-translate", ALL, { ...PREFS, autoCopy: true });
  assert.deepEqual(written, [TRANSLATED]);
  await activate("page");
  assert.match(byKey("footnote").props.text, /^已自动复制译文 · /);
});

test("Esc 取消框选：不翻译、不报错，页面还是空屏", async () => {
  captureBehaviour = () => {
    throw { code: "cancelled", message: "用户取消" };
  };
  const before = fetches().length;
  await runCommand("capture-translate");
  assert.equal(fetches().length, before);
  await activate("page");
  assert.ok(host.find((n) => n.kind === "empty"), "空屏上是那块虚线占位");
  assert.equal(host.find((n) => n.kind === "note"), undefined);
});

test("Jarvis 自己没有屏幕录制权限：多一张「打开系统设置」的 note", async () => {
  captureBehaviour = () => {
    throw { code: "permission.unavailable", message: "没有屏幕录制权限" };
  };
  await runCommand("capture-translate");
  await activate("page");
  const note = byKey("system-permission");
  assert.equal(note.props.title, "Jarvis 还没有屏幕录制权限");
  await pressAction(note, "system-settings");
  const call = host.invocations.filter((i) => i.namespace === "permissions" && i.method === "openSystemSettings").pop();
  assert.deepEqual(call.params, { kind: "screenRecording" });
});

test("没有截图授权：页面画拒绝态与「授权」，按下去再问一次", async () => {
  await activate("page", ALL.filter((id) => id !== "screenshot.capture"));
  const note = byKey("capture-denied");
  assert.equal(note.props.title, "没有截图的授权");
  assert.ok(byKey("fallback"), "还能做的：翻译剪贴板");
  assert.equal(byKey("language"), undefined, "拒绝态不画语言段");
  await pressAction(note, "grant-capture");
  const request = host.invocations.filter((i) => i.namespace === "permissions" && i.method === "request").pop();
  assert.deepEqual(request.params, { ids: ["screenshot.capture"] });
  assert.equal(byKey("capture-denied"), undefined, "授权之后回到截屏段");
  assert.ok(host.find((n) => n.kind === "empty"));
});

test("翻译失败：note 带「重试」与「填 API key」，重试成功后回到译文", async () => {
  fetchBehaviour = () => {
    throw new Error("连不上 translate.googleapis.com（30 秒超时）");
  };
  await runCommand("capture-translate");
  await activate("popover");
  const note = byKey("failure");
  assert.equal(note.props.title, "翻译失败");
  assert.match(note.props.body, /连不上 translate\.googleapis\.com/);
  assert.deepEqual(note.props.actions.map((a) => a.id), ["retry", "settings"]);
  await pressAction(note, "settings");
  assert.ok(host.invocations.some((i) => i.namespace === "system" && i.method === "openExtensionSettings"));
  fetchBehaviour = () => gtx("重试之后的译文");
  await pressAction(note, "retry");
  assert.equal(byKey("translation").props.text, "重试之后的译文");
  assert.equal(byKey("failure"), undefined);
});

test("框空了：当这一次没发生过——不问 Google，也一个字都不提交", async () => {
  // 框到一块没有字的地方几乎总是误拖。为一次误拖弹一个"没认出文字"的框，
  // 是拿一件用户不关心的事去打断他；而且宿主是"扩展第一次提交才开弹窗"，
  // 只要这里不提交，屏幕上就什么都不会出现。
  captureBehaviour = () => ({ ...SHOT, ocr: { text: "", lines: [] } });
  const beforeFetches = fetches().length;
  const beforeCommits = host.commits.length;
  await runCommand("capture-translate");
  assert.equal(fetches().length, beforeFetches, "不该问 Google");
  assert.equal(dismissedPopovers.length, 1, "必须明说这一轮不值得弹，否则 SDK 那次自动提交会把空弹窗开出来");
  assert.equal(byKey("failure"), undefined, "不留错误屏");
  assert.ok(host.commits.length > beforeCommits, "SDK 仍会自动提交一次，这是 dismissPopover 存在的理由");
});

test("只认出标点也算框空：一两个符号不值得翻译", async () => {
  captureBehaviour = () => ({
    ...SHOT,
    ocr: { text: "", lines: [{ text: "· —", box: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, confidence: 0.5 }] },
  });
  const beforeFetches = fetches().length;
  const beforeCommits = host.commits.length;
  await runCommand("capture-translate");
  assert.equal(fetches().length, beforeFetches);
  assert.equal(dismissedPopovers.length, 1);
});

test("翻译剪贴板：是图先 OCR，页面里标成「剪贴板里的图片」", async () => {
  clipboardImage = { id: "clip-1", name: "clip.png", byteCount: 5, extension: "png" };
  fetchBehaviour = () => gtx("剪贴板图片的译文");
  await runCommand("translate-clipboard");
  assert.ok(host.invocations.some((i) => i.namespace === "ocr" && i.method === "recognize"));
  await activate("page");
  assert.equal(byKey("shot").props.label, "剪贴板里的图片");
  assert.equal(byKey("translation").props.text, "剪贴板图片的译文");
});

test("翻译剪贴板：空剪贴板说清「剪贴板是空的」", async () => {
  clipboardText = "   ";
  await runCommand("translate-clipboard");
  await activate("page");
  assert.equal(byKey("failure").props.title, "剪贴板是空的");
});

test("静默命令失败时用横幅说原因，点横幅展开的页面画着错误屏", async () => {
  fetchBehaviour = () => {
    throw new Error("Google 返回 503");
  };
  await runCommand("capture-copy");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].title, "翻译失败");
  assert.deepEqual(written, []);
  host.dispatch({ type: "notificationActivated" });
  await activate("page");
  assert.equal(byKey("failure").props.title, "翻译失败");
});

test("朗读走 speech.speak，带上检测出的语言", async () => {
  await runCommand("capture-translate");
  await activate("popover");
  await host.fire(byKey("speak-source"), "press");
  assert.deepEqual(spoken, [{ text: MERGED, language: "en" }]);
  await host.fire(byKey("speak-translation"), "press");
  assert.deepEqual(spoken[1], { text: TRANSLATED, language: "zh-CN" });
});

test("产物体积在预算内：不压缩也该远小于 512 KB 的上限", () => {
  const size = statSync(bundlePath).size;
  console.log(`[translation] dist/extension.js = ${size} 字节`);
  assert.ok(size <= 96 * 1024, `产物 ${size} 字节，超过 96 KB 的自设预算`);
});

test("被限流：立刻换下一个候选，不在原地等", async () => {
  // 实测过的那件事：同一秒里 client=gtx 被 429，而换一个 client 立刻 200。
  // 限流按 (主机, client) 算，所以正确的反应是换候选，不是对着同一个退避。
  let calls = 0;
  fetchBehaviour = () => {
    calls += 1;
    return calls === 1 ? { status: 429, headers: {}, text: "" } : gtx("换了候选之后的译文");
  };
  const before = fetches().length;
  await runCommand("capture-translate");
  await activate("popover");
  assert.equal(byKey("translation").props.text, "换了候选之后的译文");
  assert.equal(fetches().length - before, 2, "第一个候选被拒就该立刻试第二个");
  assert.equal(byKey("failure"), undefined, "换成了就不该留下错误提示");
});

test("换候选时不许在原地等：整轮扫完之前一次 sleep 都不该有", async () => {
  // 这一条守的是"快"。上一版对着同一个组合退避 0.5 + 1.5 + 4 秒才放弃，
  // 用户等了六秒拿到一句"被限流了"，而隔壁候选一直是通的。
  fetchBehaviour = ({ url }) =>
    url.includes("client=dict-chrome-ex") ? gtx("最后一个候选的译文") : { status: 429, headers: {}, text: "" };
  const started = Date.now();
  await runCommand("capture-translate");
  await activate("popover");
  assert.equal(byKey("translation").props.text, "最后一个候选的译文");
  assert.ok(Date.now() - started < 500, `一轮之内不该有退避，实际用了 ${Date.now() - started}ms`);
});

test("被限流的另一副面孔：200 但正文是验证码 HTML", async () => {
  let calls = 0;
  fetchBehaviour = () => {
    calls += 1;
    // 实测：被挡住时这个端点给的就是 429 加一张 sorry 页。但它也会用 200 发同一张页，
    // 只看状态码的话会落到「返回的不是 JSON」那条分支上，提示词变成"格式可能变了"，
    // 而用户照着那句话去查格式，查不出任何东西。
    return calls === 1
      ? { status: 200, headers: {}, text: "<!DOCTYPE html><html><head><title>Error 429 (Too Many Requests)</title></head></html>" }
      : gtx("认出验证码页之后的译文");
  };
  await runCommand("capture-translate");
  await activate("popover");
  assert.equal(byKey("translation").props.text, "认出验证码页之后的译文");
});

test("所有候选都被限流：只扫一轮就放弃，不再等着重扫", async () => {
  // 上一版在这里等 1.2 秒再扫一轮，也就是多四个注定失败的请求——
  // 而限流正是按用量算的，那四个请求只会加深它。Google 的窗口是分钟量级，
  // 一秒之后重扫不会有别的结果。
  fetchBehaviour = () => ({ status: 429, headers: {}, text: "" });
  const before = fetches().length;
  const started = Date.now();
  await runCommand("capture-translate");
  await activate("popover");
  assert.match(byKey("failure").props.body, /限流/);
  assert.equal(fetches().length - before, 4, "四个候选各一次，就这些");
  assert.ok(Date.now() - started < 500, "不该在里面等");
});

test("被限流的候选进冷却：下一次翻译一个请求都不发", async () => {
  fetchBehaviour = () => ({ status: 429, headers: {}, text: "" });
  await runCommand("capture-translate");
  const after = fetches().length;
  // 换一段原文绕开缓存。
  captureBehaviour = () => ({
    ...SHOT,
    ocr: { text: "", lines: [{ text: "Another capture entirely.", box: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 }, confidence: 0.9 }] },
  });
  await runCommand("capture-translate");
  assert.equal(fetches().length, after, "全在冷却里就该安静地等，而不是继续敲");
  await activate("popover");
  assert.match(byKey("failure").props.body, /冷却/);
});

test("这个候选答得不对也换下一个：500 之后接着试", async () => {
  const seen = [];
  fetchBehaviour = ({ url }) => {
    seen.push(url);
    return url.includes("translate.googleapis.com") && url.includes("client=at")
      ? gtx("第三个候选的译文")
      : { status: 500, headers: {}, text: "" };
  };
  await runCommand("capture-translate");
  await activate("popover");
  assert.equal(byKey("translation").props.text, "第三个候选的译文");
  assert.equal(seen.length, 3, "前两个候选都答得不对，第三个才成");
});

test("缓存：同一段原文再翻一次不打网络", async () => {
  await runCommand("capture-translate");
  const after = fetches().length;
  await runCommand("capture-translate");
  assert.equal(fetches().length, after, "命中缓存就不该再问 Google——那是唯一能真正减少 IP 暴露的手段");
});

test("记住上一次成功的候选：第二次翻译不再撞那个被限流的", async () => {
  // 少发请求本身就是止损：被压住的那个候选如果每次都先撞一遍，
  // 那些注定失败的请求本身就在加深限流。
  fetchBehaviour = ({ url }) =>
    url.includes("client=gtx") ? { status: 429, headers: {}, text: "" } : gtx("第三个候选的译文");
  await runCommand("capture-translate");
  const firstRound = fetches().length;
  await activate("popover");
  assert.equal(byKey("translation").props.text, "第三个候选的译文");
  assert.equal(firstRound >= 3, true, "第一次要撞过两个被限流的才走到第三个");

  // 换一段原文，绕开缓存。
  captureBehaviour = () => ({
    ...SHOT,
    ocr: { text: "", lines: [{ text: "A second capture.", box: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 }, confidence: 0.9 }] },
  });
  const before = fetches().length;
  await runCommand("capture-translate");
  assert.equal(fetches().length - before, 1, "第二次该直接从上次成功的那个开始");
});
