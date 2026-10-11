/**
 * 对着构建产物跑：宿主替身在线缆另一端扮演 Jarvis，断言的是"敲进去一串字之后线缆上提交了什么树"。
 *
 * 这个扩展没有网络、没有截图、没有 OCR，因此桩只有几个（读剪贴板、开链接、问授权、开窗口）——
 * 也正因为这样，最后一条测试可以直接断言：**从头到尾一个 net 调用都没有**。
 *
 * 三面（工具箱 / 窗口 / 原地弹窗）都在宿主的前台会话里，共用一个 `Session`；
 * 测试用 `activate(surface)` 在三面之间切，与宿主「在面板里打开」「在窗口中打开」同一个顺序（先 deactivate）。
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost } from "../../../sdk/dist/testing.js";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "dist", "extension.js");

let clipboardText = null;
const opened = [];
let grantResult = null;
let windowOpens = 0;
/** 非空时 `window.open` 以它拒绝（这一版宿主没有窗口域、或者此刻在后台会话里）。 */
let windowOpenError = null;

const host = createTestHost({
  async: {
    "clipboard.read": async () => clipboardText,
    "system.openURL": async ({ url }) => void opened.push(url),
    "permissions.request": async ({ ids }) => grantResult ?? { granted: ids, denied: [] },
    "preferences.observe": async () => undefined,
    "preferences.unsubscribe": async () => undefined,
    "commands.run": async () => undefined,
    "window.open": async () => {
      if (windowOpenError) throw windowOpenError;
      windowOpens += 1;
    },
  },
});
await import(bundlePath); // IIFE：加载即 defineExtension

const ALL = ["clipboard.read", "system.openURL", "hotkeys.register"];
const PREFS = { copyFormat: "name", specSource: "rfc", includeUnofficial: true };
const COMMANDS = [
  { id: "lookup", title: "查状态码", hotkey: "⌥⌘H", presentation: "toolbox" },
  { id: "explain-clipboard", title: "解释剪贴板里的码", hotkey: "⌥⌘/", presentation: "popover" },
  { id: "explain", title: "解释状态码", slash: "/http", presentation: "popover" },
];

const activate = async (surface = "toolbox", granted = ALL, preferences = PREFS) => {
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { entry: "toolbox", surface, granted, preferences, commands: COMMANDS } });
  await host.settle();
};
const runCommand = async (id, granted = ALL, preferences = PREFS, extra = {}) => {
  host.dispatch({ type: "command", context: { id, trigger: "hotkey", granted, preferences, ...extra } });
  await host.settle();
};
/** `/http <argument>` 回车：宿主跑 `explain`，随即在指针旁开弹窗（这里用 activate("popover") 代替）。 */
const slash = async (argument, scope = "launcher") => {
  await runCommand("explain", ALL, PREFS, { trigger: "slash", scope, ...(argument === undefined ? {} : { argument }) });
  await activate("popover");
};
const byKey = (key) => host.find((n) => n.key === key);
const type = async (text) => {
  const box = byKey("query");
  assert.ok(box, "该有搜索框");
  await host.fire(box, "change", text);
};
const collect = (node, predicate, out = []) => {
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) collect(child, predicate, out);
  return out;
};
const rowCodes = () => collect(host.latest, (n) => n.kind === "row" && /^\d{3}$/.test(n.key ?? "")).map((n) => Number(n.key));
const pressAction = async (node, actionID) => {
  const action = node.props.actions.find((a) => a.id === actionID);
  assert.ok(action, `应有动作 ${actionID}`);
  host.dispatch({ type: "ui", handler: action.on.press, payload: {} });
  await host.settle();
};

beforeEach(async () => {
  clipboardText = null;
  grantResult = null;
  opened.length = 0;
  windowOpens = 0;
  windowOpenError = null;
  await activate("toolbox");
  await runCommand("lookup"); // 会话状态跨测试留着；⌥⌘H 就是"回到干净的一屏"
});

test("打开就是分类那一屏：五行、只数标准码", async () => {
  const classes = collect(host.latest, (n) => n.kind === "row" && String(n.key).startsWith("class-"));
  assert.equal(classes.length, 5);
  assert.deepEqual(classes.map((n) => n.props.title), ["1xx · 信息", "2xx · 成功", "3xx · 重定向", "4xx · 客户端错误", "5xx · 服务端错误"]);
  // 计数写在副标里（`row` 没有右端读数那一格），非标准码不算进任何一类
  assert.match(classes[3].props.subtitle, /^28 个标准码 · 400 401 402 403 404 …/);
  assert.match(classes[4].props.subtitle, /^11 个标准码 /);
  const section = host.find((n) => n.kind === "section" && n.key === "classes");
  assert.equal(section.props.trailing, "62 个标准码");
  // 段标题右端那句是用户此刻配置的快捷键，不是 manifest 里的默认值
  assert.equal(host.find((n) => n.key === "lookup" && n.kind === "section").props.trailing, "⌥⌘H");
});

test("分类点进去会带上这一类的非标准码，行上的计数说清自己数的是什么", async () => {
  const classes = collect(host.latest, (n) => n.kind === "row" && String(n.key).startsWith("class-"));
  await host.fire(classes[3], "press");
  assert.equal(host.find((n) => n.kind === "section" && n.key === "results").props.trailing, "4xx · 35 个");
  assert.equal(rowCodes().length, 35, "28 个标准码 + 7 个 4xx 非标准码");
  await host.fire(byKey("unofficial"), "press");
  assert.equal(rowCodes().length, 28, "关掉 chip 就回到行上写的那个数");
  await host.fire(byKey("unofficial"), "press");
});

test("敲三位数直接进详情：读数、事实徽标、相关码与出处", async () => {
  await type("404");
  const readout = byKey("readout");
  assert.equal(readout.props.value, "404 Not Found");
  assert.equal(readout.props.label, "未找到 · 客户端错误");
  assert.equal(readout.props.tint, "alert");
  const badges = collect(host.latest, (n) => n.kind === "badge").map((n) => n.props.title);
  assert.deepEqual(badges, ["客户端错误", "默认可缓存", "重试没用"]);
  // 一行最多三枚；「已永久删除」是 6 个字，正好留得住中文名
  const chips = collect(host.latest, (n) => n.kind === "chip" && String(n.key).startsWith("related-"));
  assert.deepEqual(chips.map((n) => n.props.title), ["410 已永久删除", "403 禁止访问", "301 永久移动"]);
  assert.equal(chips[0].props.help, "Gone · 已永久删除", "省掉的英文名进 tooltip 与 VoiceOver");
  assert.equal(host.find((n) => n.kind === "section" && n.key === "related").props.trailing, "RFC 9110 §15.5.5");
  assert.equal(byKey("copy").props.text, "404 Not Found");
});

test("相关码点得动，并留一条回得去的路", async () => {
  await type("超时");
  const row = host.find((n) => n.kind === "row" && n.key === "504");
  await host.fire(row, "press");
  assert.equal(byKey("readout").props.value, "504 Gateway Timeout");
  const back = byKey("back");
  assert.equal(back.props.title, "← 回到「超时」");
  await host.fire(back, "press");
  assert.deepEqual(rowCodes(), [408, 440, 504, 522, 524]);
});

test("关键词搜中英文都收；「含非标准码」是会话值，关掉只剩标准码", async () => {
  await type("超时");
  // 440「登录超时」是 IIS 的自造码，也带「超时」：中文名怎么翻就怎么命中，不为了凑整齐改译名
  assert.deepEqual(rowCodes(), [408, 440, 504, 522, 524]);
  assert.equal(host.find((n) => n.kind === "section" && n.key === "results").props.trailing, "5 个");
  const toggle = byKey("unofficial");
  await host.fire(toggle, "press");
  assert.deepEqual(rowCodes(), [408, 504], "非标准码关掉之后只剩注册表里的两条");
  await host.fire(byKey("unofficial"), "press");
  await type("timeout");
  assert.deepEqual(rowCodes(), [408, 504, 522, 524], "英文别名少一条：440 的英文名是 Login Time-out，分开写的");
});

test("一整行日志粘进搜索框也认", async () => {
  await type("< HTTP/1.1 502 Bad Gateway");
  assert.equal(byKey("readout").props.value, "502 Bad Gateway");
});

test("查不到时说清楚为什么，三种理由各说各的话", async () => {
  await type("999");
  const empty = byKey("empty");
  assert.equal(empty.props.title, "没有 999 这个码");
  assert.match(empty.props.hint, /只有 100–599/);
  assert.ok(byKey("scope"), "还要说清楚这里只收状态码");

  await type("450");
  assert.match(byKey("empty").props.hint, /没有任何规范或厂商定义过它/);

  await type("茶壶壶");
  assert.equal(byKey("empty").props.title, "没有匹配「茶壶壶」的码");
});

test("⌥⌘/ 抓到码：弹窗画在 popover 那一面，读到的原文也在", async () => {
  clipboardText = "< HTTP/1.1 502 Bad Gateway\n< server: nginx/1.25.3";
  await runCommand("explain-clipboard");
  await activate("popover");
  assert.equal(host.latestSurface, "popover");
  assert.equal(byKey("readout").props.value, "502 Bad Gateway");
  assert.match(byKey("excerpt").props.text, /HTTP\/1\.1 502 Bad Gateway/);
  assert.equal(byKey("hit").props.text, "命中 1 个码");
  // 抓到之后面板里那一屏也跟着停在同一条码上：两棵树读的是同一个会话
  await activate("toolbox");
  assert.equal(byKey("readout").props.value, "502 Bad Gateway");
});

test("⌥⌘/ 没抓到码：说抓不到，并给一条进面板的路——不静默", async () => {
  clipboardText = "Error: connect ECONNREFUSED 127.0.0.1:8080";
  await runCommand("explain-clipboard");
  await activate("popover");
  const note = byKey("empty");
  assert.equal(note.props.title, "剪贴板里没有状态码");
  assert.match(note.props.body, /没有 100–599 的整数/);
  assert.equal(note.props.actions[0].title, "打开面板输入 ⌥⌘H");
  assert.equal(host.invocations.filter((i) => i.namespace === "ui" && i.method === "dismissPopover").length, 0, "按过快捷键就得有回音");
});

test("没有 clipboard.read：弹窗与页面各说一次，页面其余部分照常能用", async () => {
  const granted = ["system.openURL", "hotkeys.register"];
  await runCommand("explain-clipboard", granted);
  await activate("popover", granted);
  assert.equal(byKey("denied").props.title, "没有读剪贴板的授权");

  await activate("toolbox", granted);
  assert.ok(byKey("clipboard"), "页面上多一段「剪贴板 · 未授权」");
  assert.ok(byKey("query"), "搜索框还在");
  const common = collect(host.latest, (n) => n.kind === "chip" && String(n.key).startsWith("common-")).map((n) => n.props.title);
  assert.deepEqual(common, ["404", "500", "502", "429", "301"]);

  // 「授权」按下去：宿主给了之后立刻把这一轮补上
  clipboardText = "status: 429";
  await pressAction(byKey("denied"), "grant");
  assert.equal(byKey("readout").props.value, "429 Too Many Requests");
});

test("复制格式跟着偏好走", async () => {
  await activate("toolbox", ALL, { ...PREFS, copyFormat: "line" });
  await type("404");
  assert.equal(byKey("readout").props.value, "HTTP/1.1 404 Not Found");
  assert.equal(byKey("copy").props.text, "HTTP/1.1 404 Not Found");
  await activate("toolbox", ALL, { ...PREFS, copyFormat: "code" });
  assert.equal(byKey("copy").props.text, "404");
});

test("出处按偏好排序；非标准码不给 MDN，只给厂商文档", async () => {
  await type("404");
  const links = collect(host.latest, (n) => n.kind === "button" && String(n.key).startsWith("link-")).map((n) => n.props.title);
  assert.deepEqual(links, ["打开 RFC 9110", "MDN"]);
  await host.fire(byKey("link-0"), "press");
  assert.equal(opened.pop(), "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5");

  await activate("toolbox", ALL, { ...PREFS, specSource: "mdn" });
  await type("404");
  await host.fire(byKey("link-0"), "press");
  assert.equal(opened.pop(), "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status/404");

  await type("499");
  const vendor = collect(host.latest, (n) => n.kind === "button" && String(n.key).startsWith("link-")).map((n) => n.props.title);
  assert.deepEqual(vendor, ["打开 nginx 文档"], "MDN 上没有 499 这一页，给个必定 404 的链接不如不给");
});

test("拒了「打开链接」就把地址交出去，不再追着问", async () => {
  const granted = ["clipboard.read", "hotkeys.register"];
  await activate("toolbox", granted);
  await type("404");
  grantResult = { granted: [], denied: ["system.openURL"] };
  await host.fire(byKey("link-0"), "press");
  assert.equal(opened.length, 0);
  assert.equal(byKey("url-denied").props.title, "没有打开链接的授权");
  assert.equal(byKey("copy-url").props.text, "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5");
  assert.equal(byKey("link-0"), undefined, "拒过之后不再画那两颗按钮");
});

test("没注册成全局快捷键时，文案里不硬写 ⌥⌘/", async () => {
  const granted = ["system.openURL"];
  await runCommand("explain-clipboard", granted);
  await activate("toolbox", granted, PREFS);
  // 宿主这一轮没带 commands（快捷键没注册），文案退回命令名
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { entry: "toolbox", surface: "toolbox", granted, preferences: PREFS, commands: [] } });
  await host.settle();
  const body = byKey("denied").props.body;
  assert.match(body, /「解释剪贴板里的码」这条命令跑不起来/);
  assert.equal(body.includes("⌥⌘"), false);
  assert.equal(host.find((n) => n.kind === "section" && n.key === "lookup").props.trailing, undefined);
});

test("工具箱那一面：搜索框旁有「在窗口中打开」，按下去在工作区开标签", async () => {
  const button = byKey("open-window");
  assert.ok(button, "工具箱那一面该有这一颗");
  assert.equal(button.kind, "iconButton");
  assert.equal(button.props.label, "在窗口中打开");
  await host.fire(button, "press");
  assert.equal(windowOpens, 1);
  // 详情、清单、查不到三屏的搜索框旁同样有它：4xx 有 35 行，放在页面底部等于藏起来
  await type("404");
  assert.ok(byKey("open-window"));
  await type("超时");
  assert.ok(byKey("open-window"));
});

test("窗口那一面画同一屏，接着刚才那一条；已经在窗口里了就不再画「在窗口中打开」", async () => {
  await type("504");
  await host.fire(byKey("open-window"), "press");
  // 宿主随即把前台会话 activate 在窗口那一面
  await activate("window");
  assert.equal(host.latestSurface, "window");
  assert.equal(byKey("readout").props.value, "504 Gateway Timeout", "query 不动，窗口接着显示刚才那一屏");
  assert.equal(byKey("open-window"), undefined);
  assert.ok(byKey("query"), "搜索框照常在");
  await type("超时");
  assert.deepEqual(rowCodes(), [408, 440, 504, 522, 524]);
  // 窗口里也订阅偏好：标签可以开着很久
  const observes = host.invocations.filter((i) => i.namespace === "preferences" && i.method === "observe");
  assert.ok(observes.length > 0);
});

test("宿主拒绝开窗口：只记一条日志，页面照常", async () => {
  const before = host.logs.length;
  windowOpenError = { code: "surface.unavailable", message: "这一版宿主还没有窗口域" };
  await host.fire(byKey("open-window"), "press");
  assert.equal(windowOpens, 0);
  const warns = host.logs.slice(before).filter((l) => l.level === "warn");
  assert.equal(warns.length, 1);
  assert.match(warns[0].message, /在窗口中打开失败/);
  assert.equal(host.logs.slice(before).filter((l) => l.level === "error").length, 0);
  assert.ok(byKey("classes"), "页面还在分类那一屏");
});

test("/http 404：弹窗里是那条码的说明，没有剪贴板那张原文卡", async () => {
  await slash("404");
  assert.equal(host.latestSurface, "popover");
  assert.equal(byKey("readout").props.value, "404 Not Found");
  assert.equal(byKey("readout").props.label, "未找到 · 客户端错误");
  assert.equal(byKey("source"), undefined, "用户刚亲手打过字，不必再给他看一遍原文");
  assert.equal(byKey("copy").props.text, "404 Not Found");
  // 「在面板里打开」：页面接着画同一条码
  await activate("toolbox");
  assert.equal(byKey("readout").props.value, "404 Not Found");
});

test("/http 不读剪贴板：查的就是敲进来的那段字", async () => {
  clipboardText = "HTTP/1.1 502 Bad Gateway";
  const before = host.invocations.length;
  await slash("< HTTP/1.1 503 Service Unavailable");
  assert.equal(host.invocations.slice(before).some((i) => i.namespace === "clipboard"), false);
  assert.equal(byKey("readout").props.value, "503 Service Unavailable", "整行粘进来也认，与页面搜索框同一套查法");
});

test("/http 超时：弹窗里一张清单，点一行换成那一条，并留回得去的路", async () => {
  await slash("超时");
  assert.equal(host.find((n) => n.kind === "section" && n.key === "results").props.trailing, "5 个");
  assert.deepEqual(rowCodes(), [408, 440, 504, 522, 524]);
  assert.equal(byKey("unofficial"), undefined, "弹窗里不画筛选 chip——要筛就进面板");
  await host.fire(host.find((n) => n.kind === "row" && n.key === "504"), "press");
  assert.equal(host.latestSurface, "popover");
  assert.equal(byKey("readout").props.value, "504 Gateway Timeout");
  const back = byKey("back");
  assert.equal(back.props.title, "← 回到「超时」");
  await host.fire(back, "press");
  assert.deepEqual(rowCodes(), [408, 440, 504, 522, 524]);
});

test("/http 999 与 /http 茶壶壶：查不到的说法与页面一字不差", async () => {
  await slash("999");
  const note = byKey("empty");
  assert.equal(note.props.title, "没有 999 这个码");
  assert.match(note.props.body, /只有 100–599/);
  assert.equal(note.props.actions[0].title, "打开面板输入 ⌥⌘H");
  await slash("茶壶壶");
  assert.equal(byKey("empty").props.title, "没有匹配「茶壶壶」的码");
  // 页面那一屏说的是同一句
  await activate("toolbox");
  assert.equal(byKey("empty").props.title, "没有匹配「茶壶壶」的码");
});

test("/http 没跟字：说清怎么写，不弹一个空框", async () => {
  await slash(undefined);
  const prompt = byKey("prompt");
  assert.equal(prompt.props.title, "给一个码或关键词");
  assert.match(prompt.props.body, /\/http 404/);
  await slash("");
  assert.ok(byKey("prompt"));
});

test("/状态码 从速记来：同一个处理函数，上一次留下的「回到…」不带进这一次", async () => {
  await type("超时");
  await host.fire(host.find((n) => n.kind === "row" && n.key === "504"), "press");
  assert.ok(byKey("back"), "页面上先有一条「回到「超时」」");
  await slash("429", "memo");
  assert.equal(byKey("readout").props.value, "429 Too Many Requests");
  assert.equal(byKey("back"), undefined);
});

test("⌥⌘/ 与 /http 轮流用：弹窗跟着最近那一条命令换画法", async () => {
  clipboardText = "status: 500";
  await runCommand("explain-clipboard");
  await activate("popover");
  assert.ok(byKey("source"), "⌥⌘/ 那一种顶上有剪贴板原文卡");
  assert.equal(byKey("readout").props.value, "500 Internal Server Error");
  await slash("301");
  assert.equal(byKey("source"), undefined);
  assert.equal(byKey("readout").props.value, "301 Moved Permanently");
  await runCommand("explain-clipboard");
  await activate("popover");
  assert.ok(byKey("source"));
  assert.equal(byKey("readout").props.value, "500 Internal Server Error");
});

test("这张表自己是对的：码不重复、related 指得到人、出处都是 https", () => {
  const source = readFileSync(join(here, "..", "src", "data.ts"), "utf8");
  const codes = [...source.matchAll(/^ {4}code: (\d{3}), name:/gm)].map((m) => Number(m[1]));
  assert.equal(codes.length, 74);
  assert.equal(new Set(codes).size, 74, "不许有重复的码");
  // 源码按类分组（非标准码单独一组在最后），运行时才排序；搜索结果的升序由上面几条用例守着
  const known = new Set(codes);
  for (const match of source.matchAll(/related: \[([\d, ]+)\]/g)) {
    for (const raw of match[1].split(",")) {
      const code = Number(raw.trim());
      assert.ok(known.has(code), `related 里的 ${code} 不在表里`);
    }
  }
  for (const match of source.matchAll(/specUrl: "([^"]+)"/g)) {
    assert.match(match[1], /^https:\/\//);
  }
});

test("从头到尾一个网络调用都没有，也没碰任何没申请的能力", () => {
  const namespaces = new Set(host.invocations.map((i) => i.namespace));
  // 申请了什么就只用什么：授权清单上没有的命名空间，线缆上一次都不该出现
  for (const forbidden of ["net", "screenshot", "ocr", "quickTransfer", "inbox", "notifications", "files", "speech", "process", "terminal"]) {
    assert.equal(namespaces.has(forbidden), false, `不该调 ${forbidden}`);
  }
  assert.equal(namespaces.has("clipboard"), true);
});
