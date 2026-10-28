/**
 * 增强模式、导入的策略组、当前页面规则、最近请求与悬浮球（jarvis-mac `specs/20261028-111714-proxy-tun-orb-traffic-page-rules`），
 * 对着构建产物从后台会话（菜单栏）走一遍：SDK 的 `fakeDaemons()` 扮演常驻进程、网络助手（装没装、拦着、取消授权、守卫）与系统代理。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { jmsSubscription, loadSource } from "./support.mjs";
import { ALL, callsOf, createProxyHost, idle, lastConfig } from "./host.mjs";

const { convertSurgeProfile, chunkItems } = await loadSource();
const scene = await createProxyHost();
const { host, daemons, storage, clash, timers } = scene;

const JMS = "https://sub.example.com/link/synthetic-token?mu=0";
const chrome = { bundleId: "com.google.Chrome", name: "Google Chrome", path: "/Applications/Google Chrome.app" };
const chromeHelper = "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper";

const menu = async (event, options = {}) => {
  await host.menuBarEvent(event, { granted: scene.granted, preferences: scene.preferences, ...options });
  await idle(scene);
};
const select = (itemId) => menu("select", { itemId });
const item = (id) => host.menuItem(id);
const submenu = (prefix, items = host.latestMenuBar.items) => items.find((entry) => entry.kind === "submenu" && entry.title.startsWith(prefix));

/** 一条连接的几行日志（sing-box 1.14.4 实测的写法）。 */
const connectionLines = (id, port, target, { dial = true, fail = null } = {}) => [
  `+0800 2026-10-28 11:31:39 INFO [${id} 0ms] inbound/mixed[mixed-in]: inbound connection from 127.0.0.1:${port}`,
  `+0800 2026-10-28 11:31:39 INFO [${id} 0ms] inbound/mixed[mixed-in]: inbound connection to ${target}`,
  `+0800 2026-10-28 11:31:39 INFO [${id} 2ms] router: found process path: ${chromeHelper}, user: Fusion`,
  ...(dial ? [`+0800 2026-10-28 11:31:39 INFO [${id} 2ms] outbound/vless[node]: outbound connection to ${target}`] : []),
  ...(fail ? [`+0800 2026-10-28 11:31:40 ERROR [${id} 5.0s] connection: open connection to ${target} using outbound/vless[node]: ${fail}`] : []),
];

async function reset() {
  await select("toggle").catch(() => undefined);
  if (daemons.status("sing-box").state === "running" || daemons.tunnelStatus().state === "running") await select("toggle");
  daemons.blockTunnel(null);
  daemons.blockSystemProxy(null);
  scene.granted = [...ALL];
  scene.preferences = { updateInterval: "never" };
  scene.subscriptions = [JMS];
  scene.responses = { [JMS]: { status: 200, headers: {}, text: jmsSubscription } };
  scene.notifications.length = 0;
  scene.tab = null;
}

test("增强模式没打开过：菜单那一项写着第一次要管理员密码；关着时拨它只记下来", async () => {
  scene.granted = [...ALL];
  scene.preferences = { updateInterval: "never" };
  scene.subscriptions = [JMS];
  scene.responses = { [JMS]: { status: 200, headers: {}, text: jmsSubscription } };
  await menu("start");
  await select("update");
  const tun = item("tun");
  assert.equal(tun.title, "增强模式（TUN）");
  assert.match(tun.subtitle, /第一次打开要输一次管理员密码/);
  assert.equal(tun.checked, false);
  await select("tun");
  assert.equal(scene.preferences.tun, true, "拨的是偏好本身：设置页那一项同时变开（W-6）");
  assert.deepEqual(scene.preferenceWrites.at(-1), { key: "tun", value: true });
  assert.equal(storage.get("selection")?.tun ?? null, null, "不再另记一份");
  assert.equal(item("tun").checked, true, "关着时勾 = 下次开启用它");
  assert.match(scene.notifications.at(-1).body, /下次开启代理时用增强模式/);
  assert.equal(callsOf(scene, "tunnel.start").length, 0);
});

test("打开：当场装网络助手、起 TUN 内核（不起用户态那一个）；配置里没有 tun 段、有 DNS 劫持；控制口经 tunnel.request", async () => {
  await select("toggle");
  assert.equal(daemons.installs, 1, "第一次：用户输了一次管理员密码");
  assert.equal(daemons.tunnelStatus().state, "running");
  assert.equal(daemons.status("sing-box").state, "stopped", "两个内核要同一个本地端口：不同时跑");
  assert.equal(callsOf(scene, "daemon.start").length, 0);
  const start = daemons.tunnelStart;
  assert.equal(start.controlPort, 19090);
  assert.equal(start.stack, "mixed");
  assert.equal(start.ipv6, true);
  assert.deepEqual(start.excludeRoutes, ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"]);
  const config = lastConfig(scene);
  assert.ok(!config.inbounds.some((inbound) => inbound.type === "tun"), "TUN 段由宿主填");
  assert.deepEqual(config.route.rules[1], { protocol: "dns", action: "hijack-dns" });
  assert.equal(storage.get("control").kernel, "tunnel");
  const viaTunnel = daemons.requests.filter((request) => request.id === undefined);
  assert.ok(viaTunnel.some((request) => request.path === "/version"), "就绪等待经 tunnel.request");
  assert.equal(host.latestMenuBar.symbol, "network.badge.shield.half.filled");
  assert.match(host.latestMenuBar.items.find((entry) => entry.kind === "header").title, /增强模式/);
  assert.equal(daemons.systemProxy.owner, "self", "增强模式下照样设系统代理（认系统代理的应用少绕一次 TUN）");
  assert.equal(item("tun").checked, true);
});

test("悬浮球：开着每秒推有效速率与成败；失败的请求进「最近请求」、画红；点它给那个域名加规则（重新载入、不断开）", async () => {
  clash.totals = { upload: 0, download: 0 };
  clash.connections = [];
  daemons.tunnelOutput([...connectionLines("11", 50011, "github.com:443"), ...connectionLines("12", 50012, "blocked.example.com:443", { fail: "dial tcp 203.0.113.5:443: i/o timeout" })]);
  clash.connections = [{ id: "u-11", metadata: { host: "github.com", destinationPort: "443", sourceIP: "127.0.0.1", sourcePort: "50011", processPath: `${chromeHelper} (Fusion)`, network: "tcp" }, upload: 500, download: 90_000, chains: ["node", "节点选择"], rule: "final", start: new Date().toISOString() }];
  await timers.advance(1000);
  clash.totals = { upload: 2000, download: 1_000_000 };
  await timers.advance(1000);
  await idle(scene);
  const orb = host.latestOrb;
  assert.equal(orb.kind, "traffic");
  assert.equal(orb.succeeded, 1, "拿到回包的那一条");
  assert.equal(orb.failed, 1, "拨号超时的那一条");
  assert.ok(orb.download > 0);
  assert.match(orb.caption, /^增强模式 · /);
  const recent = submenu("最近请求");
  const failed = submenu("✕ blocked.example.com", recent.items);
  assert.ok(failed, "失败的带 ✕");
  assert.equal(failed.items[0].tone, "critical");
  assert.match(failed.items[0].title, /i\/o timeout/);
  const index = recent.items.indexOf(failed);
  const reloads = daemons.tunnelReloads;
  await select(`recent:${index}:direct`);
  assert.deepEqual(storage.get("pageRules").map((rule) => [rule.value, rule.policy]), [["example.com", "direct"]], "按可注册域名加");
  assert.equal(daemons.tunnelReloads, reloads + 1, "SIGHUP 重载，不是停了再起");
  assert.equal(daemons.tunnelStatus().state, "running");
  assert.ok(lastConfig(scene).route.rules.some((rule) => rule.domain_suffix?.[0] === "example.com" && rule.outbound === "direct"));
});

test("当前页面：读地址栏 + 浏览器进程最近连过的域名；选一个策略就加规则、勾上；再点同一个删掉", async () => {
  scene.tab = { browser: chrome, frontmost: false, status: "ok", url: "https://github.com/fusionseek", title: "x" };
  daemons.tunnelOutput(connectionLines("21", 50021, "avatars.githubusercontent.com:443"));
  await menu("open");
  const page = submenu("当前页面");
  assert.equal(page.title, "当前页面 · github.com");
  assert.equal(page.items[0].title, "Google Chrome · github.com");
  const domains = page.items.filter((entry) => entry.kind === "submenu").map((entry) => entry.title.split(" · ")[0]);
  assert.equal(domains[0], "github.com", "地址栏那一个在最前");
  assert.ok(domains.includes("githubusercontent.com"), "页面拉的别家域名也在");
  await select("page:0:proxy");
  assert.equal(storage.get("pageRules")[0].value, "github.com");
  assert.equal(item("page:0:proxy").checked, true);
  await select("page:0:clear");
  assert.ok(!storage.get("pageRules").some((rule) => rule.value === "github.com"));
});

test("没授权读浏览器：「当前页面」里说清楚，不读", async () => {
  scene.granted = ALL.filter((id) => id !== "browser.activeTab");
  const before = host.invocations.filter((call) => call.namespace === "browser").length;
  await menu("open");
  assert.match(submenu("当前页面").items[0].title, /还没有授权读取浏览器当前页/);
  assert.equal(host.invocations.filter((call) => call.namespace === "browser").length, before);
  scene.granted = [...ALL];
});

test("导入的策略组：菜单里一组一个子菜单；选组员记进存储并当场切", async () => {
  const imported = convertSurgeProfile("[Proxy Group]\nProxies = select, DIRECT, JP\n[Rule]\nDOMAIN-SUFFIX,google.com,Proxies\nFINAL,Proxies\n", "s.conf", 1);
  const { rules, ...rest } = imported;
  const blocks = chunkItems(rules);
  blocks.forEach((block, index) => storage.map.set(`surge:rules:${index}`, JSON.stringify(block)));
  storage.map.set("surge", JSON.stringify({ ...rest, ruleChunks: blocks.length }));
  await select("reload");
  assert.ok(lastConfig(scene).outbounds.some((outbound) => outbound.tag === "Proxies"), "重新载入之后组在配置里");
  const group = submenu("Proxies");
  assert.equal(group.title, "Proxies · 直连", "select 组默认第一个成员（与 Surge 相同）");
  const memberIndex = group.items.findIndex((entry) => entry.title === "节点选择");
  await select(`group:0:${memberIndex}`);
  assert.equal(storage.get("selection").groups.Proxies, "节点选择");
  assert.ok(daemons.requests.some((request) => request.method === "PUT" && decodeURIComponent(request.path) === "/proxies/Proxies"));
  assert.equal(submenu("Proxies").title, "Proxies · 节点选择");
});

test("开着时拨增强模式：换回系统代理模式（停 TUN、起用户态内核），系统代理重新接管", async () => {
  await select("tun");
  assert.equal(daemons.tunnelStatus().state, "stopped");
  assert.equal(daemons.status("sing-box").state, "running");
  assert.equal(storage.get("control").kernel, "daemon");
  assert.equal(daemons.systemProxy.owner, "self");
  assert.equal(item("tun").checked, false);
  await select("toggle");
  assert.equal(host.latestOrb, null, "关了：悬浮球那一层撤掉");
});

test("别的 VPN 占着主网卡：不装不起，横幅里是拦截方的原话", async () => {
  await reset();
  await menu("start");
  await select("tun");
  daemons.blockTunnel({ interface: "utun4", serviceName: "Surge", message: "当前整机网络由「Surge」的增强模式接管（utun4），先在 Surge 里关掉增强模式" });
  const installs = daemons.installs;
  await select("toggle");
  assert.equal(daemons.tunnelStatus().state === "running", false);
  assert.equal(daemons.status("sing-box").state, "stopped");
  assert.equal(daemons.installs, installs);
  assert.match(scene.notifications.at(-1).body, /Surge/);
  assert.match(item("tun").subtitle, /Surge/);
  daemons.blockTunnel(null);
});

test("用户取消管理员授权：什么都没装，说清楚再点一次", async () => {
  daemons.tunnel.helper = "outdated";
  daemons.cancelNextInstall();
  await select("toggle");
  assert.equal(daemons.tunnelStatus().state === "running", false);
  assert.match(scene.notifications.at(-1).body, /管理员授权被取消/);
  assert.match(item("tun").subtitle, /网络助手要更新/);
  await select("toggle");
  assert.equal(daemons.tunnelStatus().state, "running", "再点一次、输了密码就起来");
  await select("toggle");
});

test("/proxy tun 与 /proxy 系统代理", async () => {
  await reset();
  host.dispatch({ type: "command", context: { id: "toggle", trigger: "slash", scope: "launcher", argument: "tun", granted: scene.granted, preferences: scene.preferences } });
  await idle(scene);
  assert.equal(scene.preferences.tun, true, "/proxy tun 写的也是偏好本身");
  host.dispatch({ type: "command", context: { id: "toggle", trigger: "slash", scope: "launcher", argument: "系统代理", granted: scene.granted, preferences: scene.preferences } });
  await idle(scene);
  assert.equal(scene.preferences.tun, false);
});

test("设置页改「增强模式」：代理开着时后台会话当场换内核；自己写的那一次回声不再换一次", async () => {
  await reset();
  await select("toggle");
  assert.equal(daemons.status("sing-box").state, "running", "偏好关着：系统代理模式");
  const startsBefore = callsOf(scene, "tunnel.start").length;
  // 设置页（宿主）写的：没有 tunSwitch 那一笔。
  scene.changePreferences({ tun: true });
  await idle(scene);
  assert.equal(daemons.tunnelStatus().state, "running", "设置页与工具箱同一份真源：改哪边都当场生效");
  assert.equal(daemons.status("sing-box").state, "stopped");
  assert.equal(callsOf(scene, "tunnel.start").length, startsBefore + 1, "只换了一次");

  // 菜单里拨回去：写偏好 + 自己换；回声到后台会话时认出 tunSwitch，不再换。
  const daemonStarts = callsOf(scene, "daemon.start").length;
  await select("tun");
  await idle(scene);
  assert.equal(scene.preferences.tun, false);
  assert.equal(daemons.status("sing-box").state, "running");
  assert.equal(callsOf(scene, "daemon.start").length, daemonStarts + 1, "回声不再起第二次");
  await select("toggle");
});

test("上一版拨过的 selection.tun：后台会话起来时搬进偏好再清掉", async () => {
  await reset();
  storage.map.set("selection", JSON.stringify({ mode: "rule", node: "自动选择", tun: true, groups: {} }));
  await menu("start");
  assert.equal(scene.preferences.tun, true);
  assert.equal(storage.get("selection").tun, null);
  scene.preferences = { ...scene.preferences, tun: false };
});

test("菜单「导入 Surge 配置」「规则」经窗口命令打开（挑文件要用户在场）", async () => {
  await select("import");
  await select("rules");
  assert.deepEqual(scene.commandsRun.slice(-2), ["import-surge", "rules"]);
});
