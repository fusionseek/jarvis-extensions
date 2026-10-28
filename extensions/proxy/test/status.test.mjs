/**
 * 「此刻处在哪一步、怎么说、菜单栏画什么」的纯函数：三处界面读同一份判断。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./support.mjs";

const {
  normalizePreferences,
  defaultPreferences,
  normalizeSelection,
  phaseOf,
  describeFailure,
  isRuleSetFailure,
  lastMeaningfulLine,
  parseToggleArgument,
  systemProxyCondition,
  buildMenuModel,
  parseMenuItemId,
  nodeItemId,
  menuText,
  restartReasons,
  maximumMenuNodes,
} = await loadSource();

const ALL = ["process.daemon", "system.proxy", "network.https", "terminal.run", "notifications.post", "clipboard.write"];
const stopped = { id: "sing-box", state: "stopped", executable: "/opt/homebrew/bin/sing-box" };
const running = { id: "sing-box", state: "running", pid: 1, startedAt: 1, controlPort: 19090, executable: "/opt/homebrew/bin/sing-box" };

test("偏好：缺的、类型不对的、越界的回到 manifest 默认", () => {
  assert.deepEqual(normalizePreferences(undefined), defaultPreferences);
  const prefs = normalizePreferences({ mixedPort: 80, controlPort: 20000, testURL: "http://example.com/204", updateInterval: "hourly", showSpeed: "yes", singBoxPath: "  /usr/local/bin/sing-box  " });
  assert.equal(prefs.mixedPort, 7890, "1024 以下要 root");
  assert.equal(prefs.controlPort, 20000);
  assert.equal(prefs.testURL, defaultPreferences.testURL, "sing-box 的测速丢弃 http:// 地址");
  assert.equal(prefs.updateInterval, "daily");
  assert.equal(prefs.showSpeed, false);
  assert.equal(prefs.singBoxPath, "/usr/local/bin/sing-box");
  assert.deepEqual(normalizeSelection({ mode: "enhanced", node: 3 }), { mode: "rule", node: "自动选择" });
  assert.deepEqual(normalizeSelection({ mode: "global", node: "香港" }), { mode: "global", node: "香港" });
});

test("处在哪一步：授权 > 在跑 > 没装 > 没节点 > 失败 > 关着", () => {
  const base = { granted: ALL, daemon: stopped, nodeCount: 3, failure: null };
  assert.equal(phaseOf({ ...base, granted: ["system.proxy"] }), "notGranted");
  assert.equal(phaseOf({ ...base, daemon: running }), "running");
  assert.equal(phaseOf({ ...base, daemon: running, nodeCount: 0, failure: { message: "x" } }), "running", "在跑就是在跑");
  assert.equal(phaseOf({ ...base, daemon: { ...stopped, executable: "" } }), "notInstalled");
  assert.equal(phaseOf({ ...base, nodeCount: 0 }), "noNodes");
  assert.equal(phaseOf({ ...base, failure: { at: 1, message: "x", lines: [], hint: "" } }), "failed");
  assert.equal(phaseOf({ ...base, daemon: { ...stopped, state: "exited", exitCode: 1 } }), "failed");
  assert.equal(phaseOf(base), "stopped");
  assert.equal(phaseOf({ ...base, daemon: null }), "stopped", "读不出状态时不冒充没装");
});

test("失败怎么说：端口被占说清是哪个端口；规则集、版本太旧、REALITY 各有出路", () => {
  const prefs = normalizePreferences({});
  assert.deepEqual(describeFailure(["FATAL[0000] start service: start inbound/mixed[mixed-in]: listen tcp 127.0.0.1:7890: bind: address already in use"], prefs), {
    message: "本地端口 7890 被别的程序占着",
    hint: "在设置里换一个本地端口，或者先关掉占着它的程序。",
  });
  assert.equal(describeFailure(["listen tcp 127.0.0.1:19090: bind: address already in use"], prefs).message, "控制端口 19090 被别的程序占着");
  assert.equal(describeFailure(["bind: address already in use"], prefs).message, "端口被别的程序占着");
  assert.ok(isRuleSetFailure("FATAL[0000] start service: initial rule-set: geosite-cn: EOF"));
  assert.equal(describeFailure(["initial rule-set: geoip-cn: timeout"], prefs).message, "中国大陆分流规则集下载失败");
  assert.match(describeFailure(["FATAL decode config at config.json: outbounds[2].tls: json: unknown field \"ech\""], prefs).hint, /brew upgrade sing-box/);
  assert.equal(describeFailure(["ERROR outbound/vless[JMS]: REALITY: processed invalid connection"], prefs).message, "REALITY 握手失败");
  assert.deepEqual(describeFailure(["\u001b[31mFATAL\u001b[0m[0000] something odd", ""], prefs), { message: "FATAL[0000] something odd", hint: "" });
  assert.equal(lastMeaningfulLine(["+0800 2026-10-28 10:00:01 FATAL[0010] boom", "   "]), "FATAL[0010] boom");
  assert.equal(lastMeaningfulLine([]), "");
});

test("/proxy 的参数", () => {
  assert.equal(parseToggleArgument(undefined), "toggle");
  assert.equal(parseToggleArgument("  "), "toggle");
  for (const word of ["开", "开启", "打开", "on", "ON", "start"]) assert.equal(parseToggleArgument(word), "on", word);
  for (const word of ["关", "关闭", "停止", "off", "Stop"]) assert.equal(parseToggleArgument(word), "off", word);
  assert.equal(parseToggleArgument("明天"), null);
});

test("系统代理的状况", () => {
  assert.deepEqual(systemProxyCondition({ owner: "self", port: 7890, effective: true }, ALL), { kind: "active" });
  assert.deepEqual(systemProxyCondition({ owner: "none", effective: false, blocker: { serviceName: "Surge", address: "127.0.0.1:6152", message: "被 Surge 拦着" } }, ALL), {
    kind: "blocked",
    message: "被 Surge 拦着",
  });
  assert.deepEqual(systemProxyCondition({ owner: "other", effective: false, otherName: "另一个代理" }, ALL), { kind: "other", message: "系统代理已由「另一个代理」接管" });
  assert.deepEqual(systemProxyCondition({ owner: "self", port: 7890, effective: true }, ["process.daemon"]), { kind: "notGranted" });
  assert.deepEqual(systemProxyCondition(null, ALL), { kind: "off" });
});

/** 一份合法的菜单输入。 */
const input = (overrides = {}) => ({
  phase: "running",
  preferences: normalizePreferences({}),
  selection: { mode: "rule", node: "自动选择" },
  nodes: [
    { name: "香港 01", protocol: "vless" },
    { name: "日本 02", protocol: "shadowsocks" },
  ],
  latency: { "香港 01": 88, "日本 02": null },
  proxy: { owner: "self", port: 7890, effective: true },
  granted: ALL,
  autoPick: "香港 01",
  rate: null,
  failure: null,
  busy: null,
  ...overrides,
});

/** 菜单里全部可点的条目（含子菜单里的）。 */
const items = (list) => list.flatMap((item) => (item.kind === "submenu" ? items(item.items) : item.kind === "item" ? [item] : []));

test("菜单：开着时的样子", () => {
  const model = buildMenuModel(input());
  assert.equal(model.symbol, "network");
  assert.equal(model.title, undefined, "没开「显示速率」时只有图标");
  assert.deepEqual(model.items[0], { kind: "header", title: "已开启 · 规则 · 127.0.0.1:7890" });
  const byId = Object.fromEntries(items(model.items).map((item) => [item.id, item]));
  assert.equal(byId.toggle.title, "关闭代理");
  assert.equal(byId.systemProxy.checked, true);
  assert.equal(byId["mode:rule"].checked, true);
  assert.equal(byId["mode:global"].checked, false);
  assert.equal(byId["node:auto"].checked, true);
  assert.equal(byId["node:auto"].subtitle, "此刻：香港 01");
  assert.equal(byId["node:0"].subtitle, "VLESS · 88 ms");
  assert.equal(byId["node:1"].subtitle, "Shadowsocks · 超时");
  assert.equal(byId.test.enabled, true);
  assert.equal(byId.copy.enabled, true);
  assert.ok(!items(model.items).some((item) => /…$/.test(item.title)), "菜单项结尾不带省略号");
  assert.ok(!items(model.items).some((item) => /打开|设置/.test(item.title)), "「打开」「设置」由宿主追加");
});

test("菜单：关着、出错、没装、没授权、被拦着、速率", () => {
  const off = buildMenuModel(input({ phase: "stopped", proxy: { owner: "none", effective: false }, autoPick: null }));
  assert.equal(off.symbol, "network.slash");
  const offItems = Object.fromEntries(items(off.items).map((item) => [item.id, item]));
  assert.equal(offItems.toggle.title, "开启代理");
  assert.equal(offItems.systemProxy.enabled, false, "关着时系统代理那一项点不了");
  assert.equal(offItems.test.enabled, false);
  assert.equal(offItems["node:auto"].subtitle, "按延迟自动挑最快的");

  const failed = buildMenuModel(input({ phase: "failed", failure: { at: 1, message: "本地端口 7890 被别的程序占着", lines: [], hint: "" } }));
  assert.equal(failed.symbol, "exclamationmark.triangle");
  assert.equal(failed.items[0].title, "出错了：本地端口 7890 被别的程序占着");

  const missing = buildMenuModel(input({ phase: "notInstalled" }));
  assert.equal(missing.items[0].title, "没有找到 sing-box");
  assert.ok(items(missing.items).some((item) => item.id === "install"));
  assert.ok(!items(missing.items).some((item) => item.id === "toggle"));
  const badPath = buildMenuModel(input({ phase: "notInstalled", preferences: normalizePreferences({ singBoxPath: "/x/sing-box" }) }));
  assert.equal(badPath.items[0].title, "设置里填的 sing-box 路径不可用");
  assert.ok(!items(badPath.items).some((item) => item.id === "install"), "坏路径不给安装");

  const denied = buildMenuModel(input({ phase: "notGranted", granted: [] }));
  assert.equal(denied.items[0].title, "还没授权：打开「代理」点授权");
  assert.equal(items(denied.items).find((item) => item.id === "copy").enabled, false);

  const blocked = buildMenuModel(input({ proxy: { owner: "none", effective: false, blocker: { serviceName: "Surge", address: "127.0.0.1:6152", message: "当前系统代理由「Surge」提供" } } }));
  const proxyItem = items(blocked.items).find((item) => item.id === "systemProxy");
  assert.equal(proxyItem.checked, false);
  assert.equal(proxyItem.subtitle, "当前系统代理由「Surge」提供");

  const busy = buildMenuModel(input({ busy: "正在测速" }));
  assert.equal(busy.items[0].title, "正在测速");
  assert.equal(items(busy.items).find((item) => item.id === "toggle").enabled, false);

  const speed = buildMenuModel(input({ preferences: normalizePreferences({ showSpeed: true }), rate: { up: 36 * 1024, down: 1.2 * 1024 * 1024 } }));
  assert.equal(speed.title, "↓1.2M ↑36K");
});

test("菜单：节点太多时截到上限、整份不超过 300 项；长名字剪到 80 字、不补省略号", () => {
  const nodes = Array.from({ length: 400 }, (_, index) => ({ name: `节点 ${index} ${"长".repeat(index === 0 ? 100 : 0)}`, protocol: "trojan" }));
  const model = buildMenuModel(input({ nodes, latency: {} }));
  const all = items(model.items);
  assert.ok(all.length + model.items.length <= 300);
  assert.equal(all.filter((item) => /^node:\d+$/.test(item.id)).length, maximumMenuNodes);
  const more = all.find((item) => item.id === "nodes-more");
  assert.equal(more.title, "另有 150 个节点，在「代理」窗口里看");
  assert.equal(more.enabled, false);
  assert.equal(all.find((item) => item.id === "node:0").title.length, 80);
  assert.equal(menuText("a".repeat(79) + "😀"), "a".repeat(79), "剪在代理对中间时退一位");
});

test("菜单项 id 的往返", () => {
  assert.deepEqual(parseMenuItemId("toggle"), { kind: "toggle" });
  assert.deepEqual(parseMenuItemId("mode:global"), { kind: "mode", mode: "global" });
  assert.deepEqual(parseMenuItemId(nodeItemId(-1)), { kind: "node", index: -1 });
  assert.deepEqual(parseMenuItemId(nodeItemId(12)), { kind: "node", index: 12 });
  assert.equal(parseMenuItemId("mode:enhanced"), null);
  assert.equal(parseMenuItemId("nodes-more"), null);
  assert.match(nodeItemId(299), /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, "符合 bridge schema 的 menuBarItemID");
});

test("要不要重开：端口、节点、分流改过；规则集下载失败那一次不算", () => {
  const prefs = normalizePreferences({});
  const control = { secret: "s", controlPort: 19090, mixedPort: 7890, chinaRules: true, ruleSetFallback: false, testURL: prefs.testURL, nodesDigest: "d", startedAt: 1, starting: false };
  assert.deepEqual(restartReasons(null, prefs, "d"), []);
  assert.deepEqual(restartReasons(control, prefs, "d"), []);
  assert.deepEqual(restartReasons(control, normalizePreferences({ mixedPort: 7891, chinaRules: false }), "e"), ["订阅更新过", "本地端口改过", "中国大陆直连改过"]);
  assert.deepEqual(restartReasons({ ...control, chinaRules: false, ruleSetFallback: true }, prefs, "d"), []);
});
