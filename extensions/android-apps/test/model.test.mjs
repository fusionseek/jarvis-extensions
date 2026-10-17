/**
 * 纯函数：大小的读法、排序、搜索、分页与分批、缓存是否还新、选哪台设备、设备为什么读不了、错误里的那句话。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { app, loadModel } from "./support.mjs";

const model = await loadModel();
const none = () => undefined;

test("字节数：十进制单位，100 以下一位小数，进位先升单位", () => {
  assert.equal(model.formatBytes(0), "0 B");
  assert.equal(model.formatBytes(999), "999 B");
  assert.equal(model.formatBytes(1000), "1 KB");
  assert.equal(model.formatBytes(1_234_567_890), "1.2 GB");
  assert.equal(model.formatBytes(45_300_000), "45.3 MB");
  assert.equal(model.formatBytes(312_400_000), "312 MB");
  assert.equal(model.formatBytes(999_700_000), "1 GB", "999.7 MB 写成 1 GB，不写 1000 MB");
  assert.equal(model.formatBytes(-5), "0 B");
  assert.equal(model.formatBytes(Number.NaN), "0 B");
});

test("总大小只加知道的那几块；全不知道是 null，不是 0", () => {
  assert.equal(model.totalBytes(app("a", { apk: 300, data: 900, cache: 100 })), 1_300_000_000);
  assert.equal(model.totalBytes(app("a", { apk: 300, data: null, cache: null })), 300_000_000);
  assert.equal(model.totalBytes(app("a", { apk: null, data: null, cache: null })), null);
});

test("行上的大小：安装包与数据都知道时分开写，数据含缓存；只知道一部分写总数；全不知道明说", () => {
  assert.equal(model.sizeLine(app("a", { apk: 300, data: 800, cache: 100 })), "1.2 GB · 安装包 300 MB / 数据 900 MB");
  assert.equal(model.sizeLine(app("a", { apk: 42, data: null, cache: null })), "42 MB");
  assert.equal(model.sizeLine(app("a", { apk: null, data: null, cache: null })), "大小读不出");
});

test("标题与说明：读到名字用名字并补上包名；没读到就是包名，不重复；「全部」里标出系统应用", () => {
  const chat = app("com.example.chat", { apk: 100, data: null, cache: null });
  const detail = { package: chat.package, label: " 聊天 ", versionName: "8.0", icon: null, problem: null };
  assert.equal(model.displayName(chat, detail), "聊天");
  assert.equal(model.displayName(chat, undefined), "com.example.chat");
  assert.equal(model.displayName(chat, { ...detail, label: "  " }), "com.example.chat", "空白名字当没读到");
  assert.equal(model.rowSubtitle(chat, detail, "user"), "com.example.chat · 100 MB");
  assert.equal(model.rowSubtitle(chat, undefined, "user"), "100 MB");
  const settings = app("com.android.settings", { apk: 30, data: null, cache: null, system: true });
  assert.equal(model.rowSubtitle(settings, undefined, "all"), "系统 · 30 MB");
  assert.equal(model.rowSubtitle(settings, undefined, "user"), "30 MB");
});

test("搜索：包名或应用名，不分大小写、去掉首尾空白；没读到名字的只按包名", () => {
  const chat = app("com.Example.Chat");
  const detail = { package: chat.package, label: "WeChat 聊天", versionName: null, icon: null, problem: null };
  assert.equal(model.matchesQuery(chat, undefined, "  "), true);
  assert.equal(model.matchesQuery(chat, undefined, "example.chat"), true);
  assert.equal(model.matchesQuery(chat, detail, "wechat"), true);
  assert.equal(model.matchesQuery(chat, detail, " 聊天 "), true);
  assert.equal(model.matchesQuery(chat, undefined, "聊天"), false);
});

test("按大小：大的在前，读不出大小的排最后，同样大的按名字；不改入参", () => {
  const input = [
    app("com.small", { apk: 1, data: 0, cache: 0 }),
    app("com.unknown", { apk: null, data: null, cache: null }),
    app("com.big", { apk: 900, data: 0, cache: 0 }),
    app("com.b-tie", { apk: 5, data: 0, cache: 0 }),
    app("com.a-tie", { apk: 5, data: 0, cache: 0 }),
  ];
  const sorted = model.sortApps(input, "size", none).map((entry) => entry.package);
  assert.deepEqual(sorted, ["com.big", "com.a-tie", "com.b-tie", "com.small", "com.unknown"]);
  assert.equal(input[0].package, "com.small");
});

test("按名称：中文按拼音、数字按数值；没读到名字的按包名，排在汉字名字之后（zh 的排序规则里汉字在拉丁字母之前）", () => {
  const labels = { "p.z": "支付宝", "p.w": "微信", "p.a": "阿里巴巴", "p.b": "百度", "p.n10": "地图 10", "p.n2": "地图 2" };
  const input = Object.keys(labels).map((name) => app(name)).concat(app("p.unnamed"));
  const detailOf = (name) => (labels[name] ? { package: name, label: labels[name], versionName: null, icon: null, problem: null } : undefined);
  const titles = model.sortApps(input, "name", detailOf).map((entry) => model.displayName(entry, detailOf(entry.package)));
  assert.deepEqual(titles, ["阿里巴巴", "百度", "地图 2", "地图 10", "微信", "支付宝", "p.unnamed"]);
});

test("汇总与段标题右端那一行", () => {
  const all = model.summarize([app("a", { apk: 1000, data: 200, cache: 0 }), app("b", { apk: null, data: null, cache: null }), app("c", { apk: 0.5, data: 0, cache: 0 })]);
  assert.deepEqual(all, { count: 3, bytes: 1_200_500_000, unknown: 1 });
  assert.equal(model.summaryLine(all, all, false), "3 个应用 · 共 1.2 GB");
  const matched = model.summarize([app("c", { apk: 0.5, data: 0, cache: 0 })]);
  assert.equal(model.summaryLine(matched, all, true), "匹配 1 / 3 · 共 500 KB");
});

test("分页：一次 40 行，至多 400 行（500 个节点的上限留出余量）", () => {
  assert.equal(model.pageSize, 40);
  assert.equal(model.maximumRows, 400);
  assert.equal(model.rowsToRender(25, 40), 25);
  assert.equal(model.rowsToRender(90, 40), 40);
  assert.equal(model.rowsToRender(900, 440), 400);
  assert.equal(model.canLoadMore(90, 40), true);
  assert.equal(model.canLoadMore(40, 40), false);
  assert.equal(model.canLoadMore(900, 400), false);
  assert.equal(model.nextVisibleCount(40), 80);
  assert.equal(model.nextVisibleCount(380), 400);
});

test("下一批：按屏幕顺序挑没读过的，去重，至多 limit 个", () => {
  const known = new Set(["b", "d"]);
  const isKnown = (name) => known.has(name);
  assert.deepEqual(model.nextDetailsBatch(["a", "b", "c", "a", "d", "e", "f"], isKnown, 3), ["a", "c", "e"]);
  assert.deepEqual(model.nextDetailsBatch(["b", "d"], isKnown, 8), []);
  const many = Array.from({ length: 20 }, (_, index) => `p${index}`);
  assert.equal(model.nextDetailsBatch(many, () => false, 8).length, 8);
});

test("缓存还新不新：读它时的安装包大小与此刻一样", () => {
  const entry = { detail: { package: "a", label: "A", versionName: null, icon: null, problem: null }, apkBytes: 10_000_000 };
  assert.equal(model.isCacheFresh(entry, app("a", { apk: 10 })), true);
  assert.equal(model.isCacheFresh(entry, app("a", { apk: 11 })), false, "更新过的应用重读");
  assert.equal(model.isCacheFresh({ ...entry, apkBytes: null }, app("a", { apk: null })), true, "两边都不知道大小时照用");
});

test("选设备：刚才那台还 ready 就不动，否则第一台 ready 的，没有为 null", () => {
  const devices = [
    { serial: "A", name: "A", state: "unauthorized", ready: false },
    { serial: "B", name: "B", state: "device", ready: true },
    { serial: "C", name: "C", state: "device", ready: true },
  ];
  assert.equal(model.chooseSerial(devices, "C"), "C");
  assert.equal(model.chooseSerial(devices, "A"), "B", "选着的那台不 ready 了就换");
  assert.equal(model.chooseSerial(devices, null), "B");
  assert.equal(model.chooseSerial(devices.slice(0, 1), "A"), null);
});

test("设备为什么读不了：没允许调试、离线、别的模式各说各的", () => {
  const unauthorized = model.deviceIssue({ serial: "S", name: "Pixel 8", state: "unauthorized", ready: false });
  assert.equal(unauthorized.title, "Pixel 8 还没允许这台电脑调试");
  assert.match(unauthorized.hint, /在手机上点「允许 USB 调试」/);
  assert.match(model.deviceIssue({ serial: "S", name: "S", state: "offline", ready: false }).title, /离线/);
  assert.match(model.deviceIssue({ serial: "S", name: "S", state: "other", ready: false }).hint, /recovery/);
});

test("错误里的那句话：detail 优先，其次 message，都没有用兜底", () => {
  assert.deepEqual(model.describeError({ code: "host.failure", message: "失败", detail: "未找到 adb" }, "兜底"), { code: "host.failure", message: "未找到 adb" });
  assert.deepEqual(model.describeError({ code: "host.failure", message: "没有 aapt2" }, "兜底"), { code: "host.failure", message: "没有 aapt2" });
  assert.deepEqual(model.describeError(new Error(""), "兜底"), { code: undefined, message: "兜底" });
  assert.deepEqual(model.describeError(undefined, "兜底"), { code: undefined, message: "兜底" });
});
