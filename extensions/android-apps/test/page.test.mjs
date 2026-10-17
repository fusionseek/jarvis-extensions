/**
 * 对着构建产物跑：宿主替身扮演 Jarvis，SDK 的 `fakeAndroid()` 扮演连着的手机（按宿主的规则答 `android.*`）。
 * 断言的是「手机是这个样子时，线缆上提交了什么树、问了宿主什么」。
 *
 * 详情缓存按「序列号 + 包名」活在扩展的上下文里（关了页面再开还在），因此每条测试用自己的序列号，互不沾边。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost, fakeAndroid } from "../../../sdk/dist/testing.js";
import { app, apps, icon } from "./support.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "dist", "extension.js");

const phone = fakeAndroid();
/** 非空时 `permissions.request` 照它答。 */
let grantResult = null;
/** 非空时 `android.apps` 每一次调用都挂起，等测试按顺序放行（造「晚到的旧结果」）。 */
let appsGates = null;

const host = createTestHost({
  async: {
    ...phone.stubs,
    "android.apps": async (params, testHost) => {
      if (appsGates) await new Promise((resolve) => appsGates.push(resolve));
      return phone.stubs["android.apps"](params, testHost);
    },
    "permissions.request": async ({ ids }) => grantResult ?? { granted: ids, denied: [] },
  },
});
await import(bundlePath); // IIFE：加载即 defineExtension

const ALL = ["android.apps.read", "android.tools.open"];

const activate = async (granted = ALL) => {
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { entry: "toolbox", surface: "toolbox", granted, preferences: {}, commands: [] } });
  await host.settle();
};
/** 挂着调用时不能 settle（它会一直等）：只让事件循环转几圈。 */
const spin = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const byKey = (key) => host.find((node) => node.key === key);
const collect = (node, predicate, out = []) => {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) collect(child, predicate, out);
  return out;
};
const rows = () => collect(host.latest, (node) => node.kind === "row");
const rowOf = (name) => rows().find((node) => node.key === name);
const press = async (handler) => {
  host.dispatch({ type: "ui", handler, payload: {} });
  await host.settle();
};
const pressAction = async (node, id) => {
  const action = (node.props.actions ?? []).find((candidate) => candidate.id === id);
  assert.ok(action, `${node.key} 上应有动作 ${id}`);
  await press(action.on.press);
};
const detailCalls = (serial) => phone.calls.filter((call) => call.method === "appDetails" && call.params.serial === serial);
const requestedPackages = (serial) => detailCalls(serial).flatMap((call) => call.params.packages);
const countNodes = (node) => {
  let count = 1;
  for (const child of node.children ?? []) count += countNodes(child);
  for (const name of ["hoverCard", "emptyState"]) if (node.props[name]?.kind) count += countNodes(node.props[name]);
  return count;
};

/** 一台 ready 的手机：`count` 个用户应用（越往后越小）、两个系统应用；每个用户应用都读得到名字，奇数号有图标。 */
function device(serial, count = 50, extra = {}) {
  const list = [...apps(`com.${serial.toLowerCase()}`, count), app(`com.android.${serial.toLowerCase()}.settings`, { apk: 30, system: true }), app("com.android.phone", { apk: 20, system: true })];
  const details = {};
  list.forEach((entry, index) => {
    if (entry.system) return;
    details[entry.package] = { label: `应用 ${String(index + 1).padStart(2, "0")}`, versionName: `1.${index}`, ...(index % 2 === 0 ? { icon: icon(entry.package) } : {}) };
  });
  return { serial, name: `Phone ${serial}`, apps: list, details, ...extra };
}

test("进入即可读：第一棵树就是「正在找设备」，不等 adb 回话（这一条必须排第一：上下文里还没有任何设备）", async () => {
  phone.devices = [device("FIRST", 2)];
  const before = host.commits.length;
  await activate();
  const first = host.commits[before];
  assert.ok(collect(first, (node) => node.key === "devices-progress").length === 1, "第一次提交就有「正在找连着的安卓设备」");
  assert.equal(rows().length, 2);
});

test("没有读取应用的授权：一屏说明 + 授权；不问 adb 任何事；授权后开始扫描", async () => {
  phone.devices = [device("DENY", 3)];
  const before = phone.calls.length;
  await activate([]);
  const denied = byKey("denied");
  assert.equal(denied.kind, "empty");
  assert.equal(denied.props.title, "没有读取手机应用的授权");
  assert.equal(phone.calls.length, before, "没授权时一个 android 调用都不发");
  await press(denied.props.action.on.press);
  assert.equal(rows().length, 3, "授权之后列出三个用户应用");
});

test("没有连着的设备：空屏说怎么连，重新扫描之后列出来", async () => {
  phone.devices = [];
  await activate();
  const empty = byKey("no-device");
  assert.equal(empty.props.title, "没有连着的安卓设备");
  assert.equal(empty.props.hint, "用 USB 连上手机、打开 USB 调试，再点重新扫描");
  phone.devices = [device("LATE", 2)];
  const before = host.commits.length;
  await press(empty.props.action.on.press);
  assert.ok(
    host.commits.slice(before).some((tree) => collect(tree, (node) => node.key === "devices-progress").length === 1),
    "按下重新扫描先回到「正在找」，屏幕不是一动不动",
  );
  assert.equal(rows().length, 2);
});

test("只有没允许调试的手机：说「在手机上点允许 USB 调试」，不去列应用", async () => {
  phone.devices = [{ serial: "LOCKED", name: "Pixel 8", state: "unauthorized" }];
  const before = phone.calls.filter((call) => call.method === "apps").length;
  await activate();
  const issue = byKey("device-issue");
  assert.equal(issue.props.title, "Pixel 8 还没允许这台电脑调试");
  assert.match(issue.props.hint, /在手机上点「允许 USB 调试」/);
  assert.equal(phone.calls.filter((call) => call.method === "apps").length, before);
});

test("找不到 adb：宿主那句话原样给出来，附重新扫描", async () => {
  phone.devices = [device("ADB", 1)];
  phone.failNext("devices", { code: "host.failure", message: "未找到 adb" });
  await activate();
  const error = byKey("devices-error");
  assert.equal(error.props.title, "读不到设备");
  assert.equal(error.props.hint, "未找到 adb");
  await press(error.props.action.on.press);
  assert.equal(rows().length, 1);
});

test("一台手机：先画包名与大小，名字与图标一批至多 8 个、一次一批、只读画出来的 40 行", async () => {
  phone.devices = [device("ONE", 50)];
  await activate();
  const list = rows();
  assert.equal(list.length, 40, "第一页 40 行");
  assert.deepEqual(
    list.slice(0, 3).map((row) => row.key),
    ["com.one.app01", "com.one.app02", "com.one.app03"],
    "按大小：大的在前",
  );
  const calls = detailCalls("ONE");
  assert.ok(calls.every((call) => call.params.packages.length <= 8), "每批至多 8 个");
  assert.equal(calls.length, 5, "40 行 = 5 批");
  assert.deepEqual(new Set(requestedPackages("ONE")), new Set(list.map((row) => row.key)), "只读画出来的那些");
  assert.equal(phone.maxDetailsInFlight, 1, "一次只有一批在途");

  const first = rowOf("com.one.app01");
  assert.equal(first.props.title, "应用 01");
  assert.deepEqual(first.props.image, icon("com.one.app01"), "读到图标就换成宿主颁发的图");
  assert.equal(first.props.symbol, undefined);
  assert.equal(first.props.subtitle, "com.one.app01 · 1.1 GB · 安装包 1 GB / 数据 100 MB");
  assert.match(first.props.label, /^应用 01，版本 1\.0，共 1\.1 GB$/);
  const second = rowOf("com.one.app02");
  assert.equal(second.props.symbol, "app", "读不到图标的行回落通用符号");
  assert.equal(second.props.image, undefined);

  const section = byKey("apps-section");
  assert.match(section.props.trailing, /^50 个应用 · 共 \d+(\.\d)? GB$/);
  assert.equal(byKey("details-progress"), undefined, "读完就撤掉进度条");
});

test("行尾两颗：APK 扫描与数据导出，用内置工具自己的符号，把包名交过去", async () => {
  const row = rowOf("com.one.app01");
  const [apk, exported] = row.props.actions;
  assert.deepEqual([apk.title, apk.symbol, exported.title, exported.symbol], ["APK 扫描", "shippingbox", "数据导出", "square.and.arrow.down"]);
  assert.ok(row.props.actions.every((action) => action.help && !action.title.endsWith("…")));
  await pressAction(row, "apk-scan");
  await pressAction(row, "data-export");
  assert.deepEqual(phone.opened.slice(-2), [
    { tool: "apkScan", package: "com.one.app01" },
    { tool: "dataExport", package: "com.one.app01" },
  ]);
});

test("滚到底：再列 10 个，接着只读那 10 个的名字", async () => {
  const before = requestedPackages("ONE").length;
  assert.ok(byKey("load-more"), "还有没列的时候底部有一颗「再列 10 个」");
  assert.equal(byKey("load-more").props.title, "再列 10 个");
  await press(byKey("apps").on.loadMore);
  assert.equal(rows().length, 50);
  const added = requestedPackages("ONE").slice(before);
  assert.equal(added.length, 10);
  assert.deepEqual(detailCalls("ONE").slice(-2).map((call) => call.params.packages.length), [8, 2]);
  assert.equal(byKey("load-more"), undefined);
  assert.equal(byKey("apps").on?.loadMore, undefined, "列完了就不再挂哨兵");
});

test("搜索：应用名或包名、不分大小写；名字没读到时空结果那一屏说清楚，并给「读全部应用名」", async () => {
  phone.devices = [device("FIND", 50)];
  await activate();
  await host.fire(byKey("query"), "change", "APP0");
  assert.deepEqual(rows().map((row) => row.key).slice(0, 2), ["com.find.app01", "com.find.app02"]);
  assert.match(byKey("apps-section").props.trailing, /^匹配 9 \/ 50 · 共/);

  await host.fire(byKey("query"), "change", "应用 45");
  assert.equal(rows().length, 0, "第 45 个还没轮到读名字");
  const empty = byKey("apps").props.emptyState;
  assert.equal(empty.props.title, "没有匹配「应用 45」的应用");
  assert.match(empty.props.hint, /已读 40 \/ 50/);
  await press(byKey("read-all").on.press);
  assert.deepEqual(rows().map((row) => row.key), ["com.find.app45"], "读完全部名字之后搜得到");
  assert.equal(new Set(requestedPackages("FIND")).size, 50);
  await host.fire(byKey("query"), "change", "");
});

test("按名称排：标题换成应用名的顺序", async () => {
  await host.fire(byKey("sort"), "change", "name");
  assert.deepEqual(rows().slice(0, 3).map((row) => row.props.title), ["应用 01", "应用 02", "应用 03"]);
  await host.fire(byKey("sort"), "change", "size");
});

test("范围：「全部」把系统应用也列出来并标「系统」", async () => {
  await host.fire(byKey("scope"), "change", "all");
  assert.match(byKey("apps-section").props.trailing, /^52 个应用/);
  const scopes = phone.calls.filter((call) => call.method === "apps" && call.params.serial === "FIND").map((call) => call.params.scope);
  assert.deepEqual(scopes.slice(-2), ["user", "all"]);
  // 系统应用小，按大小排在第 40 行之后：搜出来看
  await host.fire(byKey("query"), "change", "settings");
  const settings = rowOf("com.android.find.settings");
  assert.ok(settings, "系统应用出现了");
  assert.equal(settings.props.subtitle, "系统 · 36 MB · 安装包 30 MB / 数据 6 MB", "系统应用没有名字可读：标题是包名，说明不再重复包名");
  await host.fire(byKey("query"), "change", "");
  await host.fire(byKey("scope"), "change", "user");
  assert.match(byKey("apps-section").props.trailing, /^50 个应用/);
});

test("多台手机：下拉换设备；没授权调试的那台说一句；换设备时晚到的旧列表与旧名字都不画到新设备上", async () => {
  const shared = (label) => ({ "com.shared": { label } });
  phone.devices = [
    { serial: "A1", name: "Phone A", apps: [app("com.shared", { apk: 50 })], details: shared("A 的应用") },
    { serial: "B1", name: "Phone B", apps: [app("com.shared", { apk: 50 })], details: shared("B 的应用") },
    { serial: "C1", name: "Phone C", state: "unauthorized" },
  ];
  await activate();
  const picker = byKey("device");
  assert.deepEqual(picker.props.options.map((option) => option.value), ["A1", "B1"], "只列 ready 的");
  assert.match(byKey("blocked").props.text, /Phone C 还没允许这台电脑调试/);
  assert.equal(rowOf("com.shared").props.title, "A 的应用");

  // 让 B1、再 A1、再 B1 的三次列表都挂着；先放最后那次，再放前两次——前两次是晚到的旧结果
  appsGates = [];
  host.dispatch({ type: "ui", handler: picker.on.change, payload: "B1" });
  await spin();
  host.dispatch({ type: "ui", handler: byKey("device").on.change, payload: "A1" });
  await spin();
  host.dispatch({ type: "ui", handler: byKey("device").on.change, payload: "B1" });
  await spin();
  assert.equal(appsGates.length, 3);
  const gates = appsGates;
  appsGates = null;
  gates[2]();
  await spin();
  gates[0]();
  gates[1]();
  await host.settle();
  assert.equal(byKey("device").props.value, "B1");
  assert.equal(rowOf("com.shared").props.title, "B 的应用", "A1 晚到的列表与缓存都没有画到 B1 上");
  assert.equal(phone.maxDetailsInFlight, 1);
});

test("交给工具没授权：按下时就地问；拒了画一张说明 + 授权，再按就交出去", async () => {
  phone.devices = [device("TOOL", 2)];
  await activate(["android.apps.read"]);
  grantResult = { granted: [], denied: ["android.tools.open"] };
  const opened = phone.opened.length;
  await pressAction(rowOf("com.tool.app01"), "apk-scan");
  assert.equal(phone.opened.length, opened, "拒了就不交");
  const note = byKey("tools-denied");
  assert.equal(note.kind, "note");
  grantResult = null;
  await pressAction(note, "grant-tools");
  assert.equal(byKey("tools-denied"), undefined);
  await pressAction(rowOf("com.tool.app01"), "data-export");
  assert.deepEqual(phone.opened.at(-1), { tool: "dataExport", package: "com.tool.app01" });
});

test("交给工具失败：宿主那句话画成一张说明，知道了就收起", async () => {
  phone.failNext("openTool", { code: "host.failure", message: "数据导出正在导出别的包" });
  await pressAction(rowOf("com.tool.app02"), "data-export");
  const notice = byKey("notice");
  assert.equal(notice.props.title, "没能交给「数据导出」");
  assert.equal(notice.props.body, "数据导出正在导出别的包");
  await pressAction(notice, "dismiss-notice");
  assert.equal(byKey("notice"), undefined);
});

test("读名字整批失败（没有 aapt2）：清单照常、说一句、不再往下问；重试接着读", async () => {
  phone.devices = [device("NOAAPT", 20)];
  phone.failNext("appDetails", { code: "host.failure", message: "没有 aapt2，读不出应用名和图标" });
  await activate();
  assert.equal(rows().length, 20, "包名与大小照常列出");
  assert.equal(detailCalls("NOAAPT").length, 1, "失败一次就停，不连着撞");
  assert.equal(rowOf("com.noaapt.app01").props.title, "com.noaapt.app01");
  const problem = byKey("details-problem");
  assert.match(problem.props.body, /^没有 aapt2，读不出应用名和图标/);
  await pressAction(problem, "retry-details");
  assert.equal(byKey("details-problem"), undefined);
  assert.equal(rowOf("com.noaapt.app01").props.title, "应用 01");
});

test("列应用失败：宿主那句话原样给出来", async () => {
  phone.devices = [device("APPSFAIL", 3)];
  phone.failNext("apps", { code: "host.failure", message: "adb 超时" });
  await activate();
  const note = byKey("apps-error");
  assert.equal(note.props.body, "adb 超时");
  await pressAction(note, "rescan-apps");
  assert.equal(rows().length, 3);
});

test("页面离开：在途那一批回来也不再排下一批；再进来接着读、不重复问", async () => {
  phone.devices = [device("AWAY", 40)];
  const release = phone.holdDetails();
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { entry: "toolbox", surface: "toolbox", granted: ALL, preferences: {}, commands: [] } });
  await spin();
  assert.equal(detailCalls("AWAY").length, 1, "第一批在途");
  host.dispatch({ type: "deactivate" });
  release();
  await host.settle();
  assert.equal(detailCalls("AWAY").length, 1, "离开之后不再排");
  await activate();
  const asked = requestedPackages("AWAY");
  assert.equal(asked.length, 40, "再进来把剩下的读完");
  assert.equal(new Set(asked).size, 40, "第一批读过的不再问");
});

test("重新扫描：没动过的应用不再读，安装包大小变了的重读", async () => {
  const before = requestedPackages("AWAY").length;
  const updated = phone.devices[0].apps.find((entry) => entry.package === "com.away.app03");
  updated.apkBytes += 1;
  phone.devices[0].details["com.away.app03"].label = "应用 03 新版";
  await pressAction(byKey("device-section"), "rescan");
  assert.deepEqual(requestedPackages("AWAY").slice(before), ["com.away.app03"]);
  assert.equal(rowOf("com.away.app03").props.title, "应用 03 新版");
});

test("几百个应用：展开到 400 行就停，说一句用搜索缩小范围；一次提交不超过 500 个节点", async () => {
  phone.devices = [device("MANY", 450)];
  await activate();
  while (byKey("load-more")) await press(byKey("load-more").on.press);
  assert.equal(rows().length, 400);
  assert.equal(byKey("cap").props.text, "只列出前 400 个：用搜索缩小范围");
  assert.ok(countNodes(host.latest) <= 500, `节点数 ${countNodes(host.latest)}`);
  assert.equal(phone.maxDetailsInFlight, 1);
  assert.ok(detailCalls("MANY").every((call) => call.params.packages.length <= 8));
});

test("扩展从不发声明之外的调用：只碰 android.* 与 permissions.request", () => {
  const namespaces = new Set(host.invocations.map((request) => `${request.namespace}.${request.method}`));
  for (const key of namespaces) assert.ok(key.startsWith("android.") || key === "permissions.request", `不该有 ${key}`);
});
