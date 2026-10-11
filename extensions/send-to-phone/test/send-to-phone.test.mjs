/**
 * 对着构建产物跑：宿主替身在线缆另一端扮演 Jarvis 与快传服务。
 *
 * 两半：
 * - **工具箱页面**（前台会话）：读剪贴板、开快传要用户按、发完在 Inbox 留一条；
 * - **`/phone` 静默指令**（后台会话）：`runSilent` 跑它的那段时间里 `panel.*` / `ui.*` / `window.*` 全以
 *   `surface.unavailable` 拒绝——与宿主的后台会话一样。断言它不碰界面、不替用户开快传、每条路都以一条 Inbox 消息收尾。
 *
 * 快传、剪贴板、Inbox 全是桩；每条测试开始前归零，可以单独跑任意一条。
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost } from "../../../sdk/dist/testing.js";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "dist", "extension.js");

const RUNNING = {
  state: "running",
  url: "http://192.168.1.8:8787",
  peers: [{ label: "iPhone 15", address: "192.168.1.20", paired: true }],
  activeTransfers: 0,
};
const STOPPED = { state: "stopped", peers: [], activeTransfers: 0 };

let transferStatus;
let clipboardText;
/** 非空时 `quickTransfer.sendText` 以它拒绝。 */
let sendError;
/** 非空时 `inbox.post` 以它拒绝。 */
let inboxError;
let starts;
const sentTexts = [];
const inboxPosts = [];
/** `false` = 此刻在后台会话里：界面类调用一律 `surface.unavailable`。 */
let surfaceAvailable = true;
const surfaceOnly = (stub) => async (params) => {
  if (!surfaceAvailable) throw { code: "surface.unavailable", message: "后台会话里没有界面" };
  return stub(params);
};

const host = createTestHost({
  async: {
    "clipboard.read": async () => clipboardText,
    "quickTransfer.status": async () => transferStatus,
    "quickTransfer.observe": async () => undefined,
    "quickTransfer.unsubscribe": async () => undefined,
    "quickTransfer.start": async () => {
      starts += 1;
      transferStatus = RUNNING;
      return transferStatus;
    },
    "quickTransfer.sendText": async ({ text }) => {
      if (sendError) throw sendError;
      sentTexts.push(text);
    },
    "inbox.post": async (message) => {
      if (inboxError) throw inboxError;
      inboxPosts.push(message);
    },
    "permissions.request": async ({ ids }) => ({ granted: ids, denied: [] }),
    "preferences.observe": async () => undefined,
    "preferences.unsubscribe": async () => undefined,
    "panel.hold": surfaceOnly(async () => "hold-1"),
    "panel.release": surfaceOnly(async () => undefined),
    "panel.present": surfaceOnly(async () => undefined),
    "window.open": surfaceOnly(async () => undefined),
    "ui.dismissPopover": surfaceOnly(async () => undefined),
  },
});
await import(bundlePath); // IIFE：加载即 defineExtension

const ALL = ["clipboard.read", "quickTransfer.status", "quickTransfer.control", "quickTransfer.send", "inbox.post"];
const PREFS = { trimWhitespace: true, confirmBeforeSend: false };
const COMMANDS = [{ id: "send-text", title: "发到手机", slash: "/phone", presentation: "silent" }];

const activate = async (granted = ALL, preferences = PREFS) => {
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { entry: "toolbox", surface: "toolbox", granted, preferences, commands: COMMANDS } });
  await host.settle();
};
/** 像宿主那样在后台会话里跑 `/phone`：跑的这段时间里界面类调用全被拒。 */
const runSilent = async (argument, { granted = ALL, preferences = PREFS, scope = "launcher" } = {}) => {
  surfaceAvailable = false;
  try {
    host.dispatch({
      type: "command",
      context: { id: "send-text", trigger: "slash", scope, granted, preferences, ...(argument === undefined ? {} : { argument }) },
    });
    await host.settle();
  } finally {
    surfaceAvailable = true;
  }
};
const byKey = (key) => host.find((n) => n.key === key);
const byTitle = (title) => host.find((n) => n.props?.title === title);
const pressAction = async (node, actionID) => {
  const action = node.props.actions.find((a) => a.id === actionID);
  assert.ok(action, `应有动作 ${actionID}`);
  host.dispatch({ type: "ui", handler: action.on.press, payload: {} });
  await host.settle();
};
const lastPost = () => inboxPosts[inboxPosts.length - 1];
const callsSince = (before) => host.invocations.slice(before);

beforeEach(async () => {
  transferStatus = RUNNING;
  clipboardText = "";
  sendError = null;
  inboxError = null;
  starts = 0;
  sentTexts.length = 0;
  inboxPosts.length = 0;
  surfaceAvailable = true;
  await activate();
  // 页面状态跨测试留着（宿主也这样）：读一次空剪贴板，编辑框与失败提示一起归零。
  await pressAction(byKey("content"), "paste");
});

// ---------------------------------------------------------------------------
// 工具箱页面
// ---------------------------------------------------------------------------

test("页面：快传服务中、一台 iPhone 接入——地址与已接入两行；没有文字时「发到手机」按不了", async () => {
  assert.equal(byKey("transfer").props.trailing, "服务中");
  assert.equal(byKey("address").props.value, "http://192.168.1.8:8787");
  assert.equal(byKey("peer").props.value, "iPhone 15");
  assert.equal(byKey("send").props.disabled, true);
  assert.match(byKey("slash-hint").props.text, /\/phone/);
});

test("页面：读剪贴板 → 发到手机——按偏好去掉首尾空白，Inbox 留一条 success（没有卡片 id、没有动作）", async () => {
  clipboardText = "  https://example.com/a  \n";
  await pressAction(byKey("content"), "paste");
  assert.equal(byKey("text").props.value, clipboardText);
  assert.equal(byKey("send").props.disabled, false);
  await host.fire(byKey("send"), "press");
  assert.deepEqual(sentTexts, ["https://example.com/a"]);
  assert.deepEqual(inboxPosts, [{ title: "已推到 iPhone 15", body: "https://example.com/a", level: "success" }]);
  assert.ok(byKey("last-sent"), "页面上留一句「上次发送」");
  assert.equal(byKey("failure"), undefined);
  // 传输期间摁住面板，传完放开
  const panelCalls = host.invocations.filter((i) => i.namespace === "panel").map((i) => i.method);
  assert.ok(panelCalls.includes("hold"));
});

test("页面：「去掉首尾空白」关掉时原样发", async () => {
  await activate(ALL, { ...PREFS, trimWhitespace: false });
  clipboardText = "  keep the spaces  ";
  await pressAction(byKey("content"), "paste");
  await host.fire(byKey("send"), "press");
  assert.deepEqual(sentTexts, ["  keep the spaces  "]);
});

test("页面：快传没开时给「开启快传」，按了才开——不替用户悄悄打开", async () => {
  transferStatus = STOPPED;
  await activate();
  const note = byKey("not-running");
  assert.equal(note.props.title, "快传还没开");
  assert.equal(starts, 0, "进页面不该自己开快传");
  assert.equal(byKey("send").props.disabled, true);
  await pressAction(note, "start");
  assert.equal(starts, 1);
  assert.equal(byKey("transfer").props.trailing, "服务中");
});

test("页面：没有「开启快传」的授权时那颗按钮换成「授权开启」", async () => {
  transferStatus = STOPPED;
  await activate(ALL.filter((id) => id !== "quickTransfer.control"));
  const note = byKey("not-running");
  assert.deepEqual(note.props.actions.map((a) => a.id), ["grant-control"]);
});

test("页面：没给读剪贴板的授权——内容段有一张「授权」说明，读剪贴板那颗按不了", async () => {
  await activate(ALL.filter((id) => id !== "clipboard.read"));
  assert.ok(byTitle("没有读取剪贴板的授权"));
  const paste = byKey("content").props.actions.find((a) => a.id === "paste");
  assert.equal(paste.disabled, true);
});

test("页面：发送失败画一张失败说明，不往 Inbox 投「已推到」", async () => {
  clipboardText = "will fail";
  await pressAction(byKey("content"), "paste");
  sendError = { code: "host.failure", message: "快传没有在服务", detail: "快传没有在服务" };
  await host.fire(byKey("send"), "press");
  assert.equal(byKey("failure").props.body, "快传没有在服务");
  assert.deepEqual(inboxPosts, []);
});

test("页面：Inbox 回执没投出去（10 秒内投过一次）不算发送失败", async () => {
  clipboardText = "receipt will be rate limited";
  await pressAction(byKey("content"), "paste");
  inboxError = { code: "rate.limited", message: "10 秒内最多投一次" };
  await host.fire(byKey("send"), "press");
  assert.deepEqual(sentTexts, ["receipt will be rate limited"]);
  assert.equal(byKey("failure"), undefined, "推到手机已经成了");
  assert.ok(host.logs.some((l) => l.level === "warn" && /Inbox 回执没投出去/.test(l.message)));
});

// ---------------------------------------------------------------------------
// `/phone <文字>`（静默，后台会话）
// ---------------------------------------------------------------------------

test("/phone <文字>：后台会话里直接发，Inbox 一条 success；不碰任何界面", async () => {
  const before = host.invocations.length;
  await runSilent("在路上看这个链接 https://example.com/b");
  assert.deepEqual(sentTexts, ["在路上看这个链接 https://example.com/b"]);
  assert.deepEqual(lastPost(), { title: "已推到 iPhone 15", body: "在路上看这个链接 https://example.com/b", level: "success" });
  const calls = callsSince(before);
  assert.equal(calls.some((i) => ["panel", "ui", "window"].includes(i.namespace)), false, "后台会话里不碰界面");
  assert.equal(calls.some((i) => i.namespace === "clipboard"), false, "跟了字就不读剪贴板");
  assert.equal(host.logs.filter((l) => l.level === "error").length, 0);
});

test("/phone 快传没开：不替你开，也不发；Inbox 一条 warning 说快传没开、怎么打开", async () => {
  transferStatus = STOPPED;
  const before = host.invocations.length;
  await runSilent("这一条发不出去");
  assert.deepEqual(sentTexts, []);
  assert.equal(starts, 0);
  assert.equal(callsSince(before).some((i) => i.namespace === "quickTransfer" && (i.method === "start" || i.method === "sendText")), false);
  const post = lastPost();
  assert.equal(post.level, "warning");
  assert.match(post.title, /快传没开/);
  assert.match(post.body, /开启快传/);
  assert.match(post.body, /这一条发不出去/, "说清是哪一条没走");
});

test("/phone 快传没起来 / 还在启动：同样不发，标题说清是哪一种", async () => {
  transferStatus = { state: "failed", peers: [], activeTransfers: 0, failureReason: "端口 8787 被占用" };
  await runSilent("failed state");
  assert.equal(lastPost().title, "快传没起来，没有发出去");
  assert.match(lastPost().body, /端口 8787 被占用/);
  transferStatus = { state: "starting", peers: [], activeTransfers: 0 };
  await runSilent("starting state");
  assert.equal(lastPost().title, "快传还在启动，没有发出去");
  assert.deepEqual(sentTexts, []);
});

test("/phone 没跟字：读一次剪贴板，按偏好去掉首尾空白", async () => {
  clipboardText = "  from the clipboard \n";
  await runSilent(undefined);
  assert.deepEqual(sentTexts, ["from the clipboard"]);
  assert.equal(lastPost().level, "success");

  await runSilent("", { preferences: { ...PREFS, trimWhitespace: false } });
  assert.deepEqual(sentTexts[1], "  from the clipboard \n", "偏好关着时原样发");
});

test("/phone 没跟字、剪贴板也是空的：warning，什么都不发", async () => {
  clipboardText = "   ";
  await runSilent(undefined);
  assert.deepEqual(sentTexts, []);
  assert.equal(lastPost().title, "没有要发送的文字");
  assert.equal(lastPost().level, "warning");
});

test("/phone 没跟字、剪贴板是机密内容：说清为什么不发", async () => {
  clipboardText = null;
  await runSilent(undefined);
  assert.deepEqual(sentTexts, []);
  assert.equal(lastPost().title, "剪贴板里是机密内容");
});

test("/phone 没跟字、也没有读剪贴板的授权：不去读，说清两条出路", async () => {
  const before = host.invocations.length;
  await runSilent(undefined, { granted: ALL.filter((id) => id !== "clipboard.read") });
  assert.equal(callsSince(before).some((i) => i.namespace === "clipboard"), false);
  assert.equal(lastPost().title, "没有要发送的文字");
  assert.match(lastPost().body, /读取剪贴板/);
});

test("/phone 没有经快传发送的授权：不发、说清去哪开", async () => {
  await runSilent("no send permission", { granted: ALL.filter((id) => id !== "quickTransfer.send") });
  assert.deepEqual(sentTexts, []);
  assert.equal(lastPost().title, "没有经快传发送的授权");
  assert.match(lastPost().body, /设置 › 扩展 › 发到手机/);
});

test("/phone 没有查看状态的授权：直接发；宿主说服务没开（host.failure）就照实说并给出路", async () => {
  const granted = ALL.filter((id) => id !== "quickTransfer.status");
  sendError = { code: "host.failure", message: "快传没有在服务", detail: "快传没有在服务" };
  await runSilent("without status", { granted });
  assert.equal(lastPost().level, "error");
  assert.equal(lastPost().title, "没有发出去");
  assert.match(lastPost().body, /快传没有在服务/);
  assert.match(lastPost().body, /开启快传/);
  // 成功时没有 peers 可读：标题不编一个设备名出来
  sendError = null;
  await runSilent("without status ok", { granted });
  assert.deepEqual(lastPost(), { title: "已推到手机", body: "without status ok", level: "success" });
});

test("/phone 不读页面的状态：编辑框里那段草稿不会被发出去", async () => {
  // 页面编辑框里有一段草稿
  await host.fire(byKey("text"), "change", "页面里的草稿");
  clipboardText = "剪贴板里的那段";
  await runSilent(undefined);
  assert.deepEqual(sentTexts, ["剪贴板里的那段"]);
  // 反过来也一样：静默指令不改页面
  await activate();
  assert.equal(byKey("text").props.value, "页面里的草稿");
});

test("/发到手机 从速记输入框来：同一个处理函数；Inbox 没授权时只记日志，不抛", async () => {
  const errorsBefore = host.logs.filter((l) => l.level === "error").length;
  await runSilent("from memo", { scope: "memo", granted: ALL.filter((id) => id !== "inbox.post") });
  assert.deepEqual(sentTexts, ["from memo"]);
  assert.deepEqual(inboxPosts, []);
  assert.ok(host.logs.some((l) => l.level === "warn" && /没有 Inbox 授权/.test(l.message)));
  assert.equal(host.logs.filter((l) => l.level === "error").length, errorsBefore);
});

test("长文字：Inbox 正文压成一行、按字符截断", async () => {
  const long = `${"段".repeat(130)}\n第二行`;
  await runSilent(long);
  assert.equal(sentTexts[0], long, "发出去的是全文");
  assert.equal(Array.from(lastPost().body).length, 121, "120 个字加一个省略号");
  assert.equal(lastPost().body.includes("\n"), false);
});
