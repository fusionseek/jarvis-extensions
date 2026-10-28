/**
 * 后台会话（菜单栏、`/proxy`）对着构建产物跑：宿主替身发 `menuBar` / `command` 事件，SDK 的 `fakeDaemons()` 扮演常驻进程与系统代理，
 * 假 Clash API 按 sing-box 1.14 的形状答话。断言的是「用户点了这一项，宿主收到了什么、菜单变成了什么」。
 *
 * 这个文件里没有页面：前台与后台是两个 JSContext，页面的测试在 page.test.mjs，各自一个进程，内存互不相通——
 * 与真机一样，这里能看到的跨会话状态只有存储与宿主手里的那两样。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { base64, jmsLinks, jmsSubscription, UUID } from "./support.mjs";
import { ALL, callsOf, clashCalls, createProxyHost, flush, idle, lastConfig } from "./host.mjs";

const scene = await createProxyHost();
const { host, daemons, storage, clash, timers } = scene;

const JMS = "https://sub.example.com/link/synthetic-token?mu=0";
const EXTRA = "https://extra.example.net/api/v1/client/subscribe?token=synthetic";
const JMS_NAMES = [
  "JMS-1234567@c95s1.example.com:23456",
  "JMS-1234567@c95s2.example.com:443",
  "JMS-1234567@c95s3.example.com:443",
  "JMS-1234567@c95s4.example.com:443",
  "JMS-1234567@c95s5.example.com:443",
  "JMS-1234567@c95s801.example.com:443",
];

const menu = async (event, options = {}) => {
  await host.menuBarEvent(event, { granted: scene.granted, preferences: scene.preferences, ...options });
  await idle(scene);
};
const select = (itemId) => menu("select", { itemId });
const header = () => host.latestMenuBar.items[0].title;
const submenu = (prefix) => host.latestMenuBar.items.find((item) => item.kind === "submenu" && item.title.startsWith(prefix));
const command = async (argument) => {
  host.dispatch({ type: "command", context: { id: "toggle", trigger: "slash", scope: "launcher", argument, granted: scene.granted, preferences: scene.preferences } });
  await idle(scene);
};

/** 回到「装好了、有订阅、关着、没授权缺口」的样子。 */
async function reset() {
  if (daemons.status("sing-box").state === "running") await select("toggle");
  daemons.daemons[0].located = undefined;
  daemons.blockSystemProxy(null);
  scene.granted = [...ALL];
  scene.preferences = {};
  scene.subscriptions = [JMS];
  scene.responses = { [JMS]: { status: 200, headers: { "subscription-userinfo": "upload=1073741824; download=2147483648; total=536870912000; expire=1798732800" }, text: jmsSubscription } };
  scene.notifications.length = 0;
  scene.clipboard.length = 0;
  scene.terminal.length = 0;
  clash.delays = {};
  clash.beforeVersion = null;
}

test("start：没有节点时说清楚；更新订阅之后菜单里有 6 个节点与开关", async () => {
  await reset();
  await menu("start");
  assert.equal(host.latestMenuBar.symbol, "network.slash");
  assert.equal(header(), "没有节点：在设置里填订阅地址");
  assert.equal(host.menuItem("toggle"), undefined, "没有节点时不给开关");

  await select("update");
  assert.equal(scene.fetches.at(-1).url, JMS);
  assert.match(scene.fetches.at(-1).headers["User-Agent"], /sing-box/, "UA 里带 sing-box，机场按它回能认的格式");
  assert.equal(header(), "已关闭");
  assert.equal(host.menuItem("toggle").title, "开启代理");
  const nodes = submenu("节点");
  assert.equal(nodes.title, "节点选择 · 自动选择", "Surge 式：子菜单写组名与此刻选中的组员");
  assert.deepEqual(
    nodes.items.filter((item) => item.kind === "item").map((item) => item.title),
    ["自动选择", ...JMS_NAMES],
  );
  assert.equal(host.menuItem("node:auto").checked, true);
  assert.deepEqual(scene.notifications.at(-1), { title: "代理", body: "更新了 1 条订阅，共 6 个节点" });
  const records = storage.get("subscriptions");
  assert.equal(records.length, 1);
  assert.equal(records[0].host, "sub.example.com");
  assert.equal(records[0].nodeCount, 6);
  assert.equal(records[0].usage.total, 536870912000);
  assert.ok(!JSON.stringify(records).includes("synthetic-token"), "存储里不放带 token 的订阅地址");
  // 宿主固定追加「打开」「设置」两项，扩展自己不写。
  assert.ok(!host.latestMenuBar.items.some((item) => item.kind === "item" && /设置|打开/.test(item.title)));
});

test("开：写配置、带控制口起内核、把模式与节点放回去、设系统代理；关：先还原系统代理再停", async () => {
  await reset();
  await menu("start");
  const startsBefore = callsOf(scene, "daemon.start").length;
  daemons.requests.length = 0;
  await select("toggle");

  const start = callsOf(scene, "daemon.start").at(-1);
  assert.equal(callsOf(scene, "daemon.start").length, startsBefore + 1);
  assert.equal(start.params.controlPort, 19090);
  assert.equal(start.params.executable, undefined, "没填路径时交给宿主定位");
  const config = lastConfig(scene);
  assert.deepEqual(config.inbounds, [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 7890 }]);
  assert.equal(config.experimental.clash_api.external_controller, "127.0.0.1:19090");
  assert.match(config.experimental.clash_api.secret, /^[0-9a-f]{32}$/);
  assert.equal(config.route.rule_set.length, 2, "默认中国大陆直连");
  assert.deepEqual(clashCalls(scene).slice(0, 3), ["GET /version", "PATCH /configs", "PUT /proxies/节点选择"]);
  assert.ok(clashCalls(scene).slice(3).every((call) => call === "GET /proxies/自动选择"), "之后只是读「自动选择」此刻用谁");
  assert.deepEqual(JSON.parse(daemons.requests[1].body), { mode: "Rule" });
  assert.deepEqual(JSON.parse(daemons.requests[2].body), { name: "自动选择" });
  assert.equal(storage.get("control").secret, config.experimental.clash_api.secret, "secret 落进存储，页面那个会话也调得了控制口");

  assert.deepEqual(daemons.systemProxy, { owner: "self", port: 7890, effective: true, current: "127.0.0.1:7890" });
  assert.equal(host.latestMenuBar.symbol, "network");
  assert.equal(header(), "已开启 · 规则 · 127.0.0.1:7890");
  assert.equal(host.menuItem("systemProxy").checked, true);
  assert.equal(host.menuItem("toggle").title, "关闭代理");
  assert.equal(host.menuItem("node:auto").subtitle, `此刻：${JMS_NAMES[0]}`);
  assert.equal(scene.notifications.length, 0, "成功的开关不发横幅：图标自己说明了");

  const disableIndex = daemons.calls.length;
  await select("toggle");
  const tail = daemons.calls.slice(disableIndex).map((call) => call.method);
  assert.ok(tail.indexOf("systemProxy.disable") < tail.indexOf("daemon.stop"), "先还原系统代理，再停内核");
  assert.equal(daemons.status("sing-box").state, "stopped");
  assert.equal(daemons.systemProxy.owner, "none");
  assert.equal(host.latestMenuBar.symbol, "network.slash");
  assert.equal(storage.get("control"), undefined);
});

test("菜单里换模式、换节点、测速、复制终端命令", async () => {
  await reset();
  await menu("start");
  await select("toggle");
  daemons.requests.length = 0;

  await select("mode:global");
  assert.deepEqual(JSON.parse(daemons.requests[0].body), { mode: "Global" });
  assert.equal(host.menuItem("mode:global").checked, true);
  assert.equal(host.menuItem("mode:rule").checked, false);
  assert.equal(storage.get("selection").mode, "global");
  assert.match(header(), /^已开启 · 全局/);

  await select("node:2");
  const put = daemons.requests.find((request) => request.method === "PUT");
  assert.equal(put.path, `/proxies/${encodeURIComponent("节点选择")}`);
  assert.deepEqual(JSON.parse(put.body), { name: JMS_NAMES[2] });
  assert.equal(host.menuItem("node:2").checked, true);
  assert.equal(host.menuItem("node:auto").checked, false);
  assert.equal(submenu("节点").title, `节点选择 · ${JMS_NAMES[2]}`);

  clash.delays = { [JMS_NAMES[0]]: 88, [JMS_NAMES[3]]: 1234 };
  daemons.requests.length = 0;
  await select("test");
  const delays = daemons.requests.filter((request) => request.path.includes("/delay?"));
  assert.equal(delays.length, 6);
  assert.ok(delays.every((request) => request.path.endsWith(`url=${encodeURIComponent("https://www.gstatic.com/generate_204")}&timeout=5000`)));
  assert.ok(delays.every((request) => !/[\s#]/.test(request.path)), "节点名里的 @ 与空格都转义了");
  assert.equal(host.menuItem("node:0").subtitle, "Shadowsocks · 88 ms");
  assert.equal(host.menuItem("node:3").subtitle, "VLESS · 1234 ms");
  assert.equal(host.menuItem("node:1").subtitle, "VLESS · 超时");
  assert.equal(storage.get("latency").values[JMS_NAMES[0]], 88);

  await select("copy");
  assert.deepEqual(scene.clipboard, ["export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890"]);

  // 关掉再开：cache.db 会记着上一次的模式与节点，开启后要重新放回用户选的那一份。
  await select("toggle");
  daemons.requests.length = 0;
  await select("toggle");
  assert.deepEqual(JSON.parse(daemons.requests.find((request) => request.method === "PATCH").body), { mode: "Global" });
  assert.deepEqual(JSON.parse(daemons.requests.find((request) => request.method === "PUT").body), { name: JMS_NAMES[2] });
  assert.equal(lastConfig(scene).experimental.clash_api.default_mode, "Global");
  assert.equal(lastConfig(scene).outbounds[0].default, JMS_NAMES[2]);
  await select("mode:rule");
  await select("node:auto");
});

test("被别的代理工具拦着：内核照常跑，系统代理一项写明原因、不打勾", async () => {
  await reset();
  const message = "当前系统代理由「Surge」提供（127.0.0.1:6152），Jarvis 写了也不会生效";
  daemons.blockSystemProxy({ serviceName: "Surge", address: "127.0.0.1:6152", message });
  await menu("start");
  await select("toggle");
  assert.equal(daemons.status("sing-box").state, "running");
  assert.equal(daemons.systemProxy.owner, "none", "被拦着时宿主什么都不写");
  const item = host.menuItem("systemProxy");
  assert.equal(item.checked, false);
  assert.equal(item.subtitle, message);
  assert.equal(host.latestMenuBar.symbol, "network");
  await select("copy");
  assert.match(scene.clipboard.at(-1), /^export https_proxy=http:\/\/127\.0\.0\.1:7890 /);
});

test("没装 sing-box：菜单给「在终端中安装」，点了跑 manifest 里那段脚本", async () => {
  await reset();
  daemons.daemons[0].located = "";
  await menu("start");
  assert.equal(header(), "没有找到 sing-box");
  assert.equal(host.menuItem("toggle"), undefined);
  await select("install");
  assert.deepEqual(scene.terminal, ["install"]);

  scene.preferences = { singBoxPath: "/Users/someone/bin/sing-box" };
  daemons.daemons[0].located = undefined;
  await menu("open");
  // 填了路径时宿主按它答；fakeDaemons 把填的路径原样当作找到——这里只核对路径确实交给了宿主。
  assert.equal(callsOf(scene, "daemon.status").at(-1).params.executable, "/Users/someone/bin/sing-box");
});

test("内核意外退出：横幅带最后一行、图标换成感叹号、宿主已还原系统代理", async () => {
  await reset();
  await menu("start");
  await select("toggle");
  assert.equal(daemons.systemProxy.owner, "self");
  daemons.crash("sing-box", {
    exitCode: 1,
    lines: ["+0800 2026-10-28 10:00:00 INFO router: updated", "+0800 2026-10-28 10:00:01 FATAL[0010] inbound/mixed[mixed-in]: listen tcp 127.0.0.1:7890: bind: address already in use"],
  });
  await idle(scene);
  assert.equal(daemons.systemProxy.owner, "none", "fakeDaemons 照宿主兜底还原");
  assert.equal(scene.notifications.length, 1);
  assert.equal(scene.notifications[0].title, "代理已停止：sing-box 意外退出");
  assert.match(scene.notifications[0].body, /FATAL\[0010\] inbound\/mixed\[mixed-in\]: listen tcp 127\.0\.0\.1:7890: bind: address already in use/);
  assert.equal(host.latestMenuBar.symbol, "exclamationmark.triangle");
  assert.equal(header(), "出错了：本地端口 7890 被别的程序占着");
  assert.equal(storage.get("failure").hint, "在设置里换一个本地端口，或者先关掉占着它的程序。");

  // 再开一次成功：失败记录清掉。
  await select("toggle");
  assert.equal(host.latestMenuBar.symbol, "network");
  assert.equal(storage.get("failure"), undefined);
});

test("规则集第一次下载失败（1 秒内退出）：不分流再起一次，菜单照常开着", async () => {
  await reset();
  await menu("start");
  const before = callsOf(scene, "daemon.start").length;
  daemons.failNext("daemon.start", {
    code: "host.failure",
    message: "sing-box 启动后 1 秒内退出了",
    detail: "+0800 2026-10-28 10:00:00 FATAL[0000] start service: initialize rule-set: initial rule-set: geosite-cn: Get \"https://testingcf.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs\": EOF",
  });
  await select("toggle");
  const starts = callsOf(scene, "daemon.start").slice(before);
  assert.equal(starts.length, 2);
  assert.equal(JSON.parse(starts[0].params.config).route.rule_set.length, 2);
  assert.equal(JSON.parse(starts[1].params.config).route.rule_set, undefined, "第二次不带远程规则集");
  assert.equal(daemons.status("sing-box").state, "running");
  assert.equal(storage.get("control").ruleSetFallback, true);
  assert.equal(scene.notifications.length, 0);
  assert.equal(host.latestMenuBar.symbol, "network");
});

test("规则集在等就绪时才失败（起来之后退出）：读日志认出来、同样不分流再起，不发「意外退出」横幅", async () => {
  await reset();
  await menu("start");
  const before = callsOf(scene, "daemon.start").length;
  clash.beforeVersion = () => {
    if (lastConfig(scene).route.rule_set) {
      daemons.crash("sing-box", { lines: ["+0800 2026-10-28 10:00:05 FATAL[0005] start service: initial rule-set: geoip-cn: context deadline exceeded"] });
      return false;
    }
    return true;
  };
  const done = select("toggle");
  // 第一次就绪探测答 503 后扩展睡 500 毫秒再看：拨过去。
  await flush();
  await timers.advance(500);
  await done;
  await idle(scene);
  const starts = callsOf(scene, "daemon.start").slice(before);
  assert.equal(starts.length, 2);
  assert.equal(JSON.parse(starts[1].params.config).route.rule_set, undefined);
  assert.equal(daemons.status("sing-box").state, "running");
  assert.equal(scene.notifications.length, 0, "开启过程中的退出由开启的那一方处理");
  assert.equal(storage.get("control").starting, false);
});

test("/proxy：不带参数切换，开 / 关指定，认不出的参数说清楚", async () => {
  await reset();
  await command(undefined);
  assert.equal(daemons.status("sing-box").state, "running");
  assert.equal(scene.notifications.at(-1).title, "代理");
  assert.match(scene.notifications.at(-1).body, /^代理已开启 · 127\.0\.0\.1:7890/);

  await command("开");
  assert.equal(scene.notifications.at(-1).body, "代理已经开着");

  await command("关");
  assert.equal(daemons.status("sing-box").state, "stopped");
  assert.equal(scene.notifications.at(-1).body, "代理已关闭");

  await command("明天");
  assert.equal(scene.notifications.at(-1).title, "代理没能完成");
  assert.match(scene.notifications.at(-1).body, /认不出「明天」/);
  assert.equal(daemons.status("sing-box").state, "stopped");
});

test("两条订阅合并：重名的加序号；一条失败时保留它上一次的节点；删掉一条后它的节点块一并删掉", async () => {
  await reset();
  const extra = {
    outbounds: [
      { type: "selector", tag: "proxy", outbounds: ["dup"] },
      { type: "trojan", tag: JMS_NAMES[0], server: "t.example.net", server_port: 443, password: "synthetic", tls: { enabled: true, server_name: "t.example.net" } },
      { type: "tuic", tag: "TUIC 东京", server: "q.example.net", server_port: 443, uuid: UUID, password: "synthetic", tls: { enabled: true, alpn: ["h3"] } },
      { type: "wireguard", tag: "wg" },
    ],
  };
  scene.subscriptions = [JMS, EXTRA];
  scene.responses[EXTRA] = { status: 200, headers: {}, text: JSON.stringify(extra) };
  await menu("start");
  await select("update");
  const names = submenu("节点").items.filter((item) => item.kind === "item").map((item) => item.title);
  assert.deepEqual(names, ["自动选择", ...JMS_NAMES, `${JMS_NAMES[0]} 2`, "TUIC 东京"]);
  const records = storage.get("subscriptions");
  assert.deepEqual(records.map((record) => [record.position, record.host, record.format, record.nodeCount, record.skippedTotal]), [
    [1, "sub.example.com", "base64", 6, 0],
    [2, "extra.example.net", "sing-box", 2, 1],
  ]);
  assert.equal(records[1].skipped[0].reason, "本期不支持 wireguard 出站");

  scene.responses[EXTRA] = { throws: { code: "host.failure", message: "连不上 extra.example.net" } };
  await select("update");
  assert.match(scene.notifications.at(-1).body, /2 条订阅里 1 条没更新上（extra\.example\.net：连不上 extra\.example\.net）；现有 8 个节点/);
  assert.equal(storage.get("subscriptions")[1].error, "连不上 extra.example.net");
  assert.equal(submenu("节点").items.filter((item) => item.kind === "item").length, 9, "失败的那条留着上一次的节点");

  const extraId = storage.get("subscriptions")[1].id;
  assert.ok(storage.get(`nodes:${extraId}:0`));
  scene.subscriptions = [JMS];
  await select("update");
  assert.equal(storage.get(`nodes:${extraId}:0`), undefined);
  assert.equal(storage.get("subscriptions").length, 1);
});

test("订阅更新后节点变了、内核开着：重新载入用上新节点——不断进程、系统代理一直指着它", async () => {
  await reset();
  await menu("start");
  await select("update");
  await select("toggle");
  const digest = storage.get("control").nodesDigest;
  const starts = callsOf(scene, "daemon.start").length;
  const reloads = daemons.reloads["sing-box"] ?? 0;
  const disables = callsOf(scene, "systemProxy.disable").length;
  scene.responses[JMS] = { status: 200, headers: {}, text: base64(jmsLinks.slice(0, 3).join("\n")) };
  await select("update");
  assert.equal(callsOf(scene, "daemon.start").length, starts, "没有停了再起");
  assert.equal(daemons.reloads["sing-box"], reloads + 1, "SIGHUP 重载");
  assert.equal(callsOf(scene, "systemProxy.disable").length, disables, "系统代理没有被还原过");
  assert.notEqual(storage.get("control").nodesDigest, digest);
  assert.equal(lastConfig(scene).outbounds.filter((outbound) => outbound.tag.startsWith("JMS-")).length, 3);
  assert.equal(daemons.systemProxy.owner, "self");
  assert.match(scene.notifications.at(-1).body, /已重新载入以用上新节点/);
});

test("自动开启与订阅自动更新：start 时按偏好开启；每 30 秒看一次日程，到点就拉", async () => {
  await reset();
  scene.preferences = { autoStart: true, updateInterval: "6h" };
  storage.map.delete("schedule");
  const fetchesBefore = scene.fetches.length;
  await menu("start");
  assert.equal(daemons.status("sing-box").state, "running", "autoStart：start 时开启");
  await timers.advance(30_000);
  await idle(scene);
  assert.equal(scene.fetches.length, fetchesBefore + 1, "到点拉了一次");
  await timers.advance(30_000);
  await idle(scene);
  assert.equal(scene.fetches.length, fetchesBefore + 1, "刚拉过，不再拉");
});

test("菜单栏速率：开着且偏好要显示时，图标旁每秒刷新上下行", async () => {
  await reset();
  scene.preferences = { showSpeed: true, updateInterval: "never" };
  await menu("start");
  if (daemons.status("sing-box").state !== "running") await select("toggle");
  clash.totals = { upload: 0, download: 0 };
  await timers.advance(1000);
  clash.totals = { upload: 10 * 1024, download: 2 * 1024 * 1024 };
  await timers.advance(1000);
  await idle(scene);
  assert.equal(host.latestMenuBar.title, "↓2M\n↑10K", "两行：下行在上、上行在下，每行 ≤ 10 字");
  const orb = host.latestOrb;
  assert.equal(orb.kind, "traffic", "悬浮球那一层跟着推");
  assert.equal(orb.download, 2 * 1024 * 1024);
  assert.equal(orb.upload, 10 * 1024);
  clash.totals = { upload: 20 * 1024, download: 4 * 1024 * 1024 };
  await timers.advance(1000);
  await idle(scene);
  const chart = host.latestMenuBar.items[0];
  assert.equal(chart.kind, "chart", "两个点以上才画菜单顶部那块曲线");
  assert.deepEqual(chart.series.map((series) => series.tone), ["download", "upload"]);
  assert.deepEqual(chart.series[0].values, [2 * 1024 * 1024, 2 * 1024 * 1024]);
});
