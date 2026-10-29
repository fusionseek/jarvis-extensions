/**
 * 前台会话（工具箱那一页、窗口标签）对着构建产物跑：断言卡住时的那一屏、按下去之后宿主收到了什么、页面变成了什么。
 * 后台会话（菜单栏、指令）在 background.test.mjs，各自一个进程——与真机一样两边内存不相通。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { jmsSubscription } from "./support.mjs";
import { ALL, callsOf, clashCalls, createProxyHost, idle, lastConfig } from "./host.mjs";

const scene = await createProxyHost();
const { host, daemons, storage, clash, timers } = scene;

const JMS = "https://sub.example.com/link/synthetic-token?mu=0";

const byKey = (key) => host.find((node) => node.key === key);
const collect = (node, predicate, out = []) => {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) collect(child, predicate, out);
  return out;
};
const lastControl = () => storage.get("control");
const countNodes = (node) => (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 1);
const fire = async (node, event, payload) => {
  await host.fire(node, event, payload);
  await idle(scene);
};
const pressAction = async (node, id) => {
  const action = (node.props.actions ?? []).find((candidate) => candidate.id === id);
  assert.ok(action, `${node.key} 上应有动作 ${id}`);
  host.dispatch({ type: "ui", handler: action.on.press, payload: {} });
  await idle(scene);
};
const activate = async (surface = "toolbox") => {
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { entry: "toolbox", surface, granted: scene.granted, preferences: scene.preferences, commands: [] } });
  await idle(scene);
};

async function reset() {
  host.dispatch({ type: "deactivate" });
  if (daemons.status("sing-box").state === "running") {
    await daemons.stubs["daemon.stop"]({ id: "sing-box" }, host);
  }
  daemons.daemons[0].located = undefined;
  daemons.blockSystemProxy(null);
  scene.granted = [...ALL];
  scene.preferences = {};
  scene.subscriptions = [JMS];
  scene.responses = { [JMS]: { status: 200, headers: {}, text: jmsSubscription } };
  scene.permissionRequests.length = 0;
  scene.terminal.length = 0;
  scene.opened.length = 0;
  storage.map.delete("failure");
}

test("没授权：一张说明卡，按「授权」一次问完全部九项", async () => {
  await reset();
  scene.granted = [];
  await activate();
  const note = byKey("not-granted");
  assert.equal(note.kind, "note");
  assert.equal(note.props.title, "还没有授权");
  assert.equal(byKey("power").props.disabled, true);
  await pressAction(note, "grant");
  assert.deepEqual(scene.permissionRequests, [ALL]);
  assert.equal(byKey("not-granted"), undefined);
});

test("没有订阅：说明卡指向设置；填了订阅、按「更新订阅」之后节点列出来", async () => {
  await reset();
  scene.subscriptions = [];
  await activate();
  const note = byKey("no-subscription");
  assert.equal(note.props.title, "还没有订阅");
  await pressAction(note, "settings");
  assert.deepEqual(scene.opened, ["settings"]);

  scene.subscriptions = [JMS];
  await activate();
  await pressAction(byKey("no-nodes"), "update");
  assert.equal(byKey("no-nodes"), undefined);
  const rows = collect(byKey("nodes"), (node) => node.kind === "row");
  assert.equal(rows.length, 7, "自动选择 + 6 个节点");
  assert.equal(rows[0].props.title, "自动选择");
  assert.equal(rows[0].props.selected, true);
  assert.equal(rows[1].props.subtitle, "Shadowsocks");
  assert.equal(byKey("sub:" + storage.get("subscriptions")[0].id).props.title, "1. sub.example.com");
});

// jarvis-mac specs/20261028-191224-git-push-error-proxy-dashboard-issue-links P-2：工具箱里就能加订阅地址——框由宿主画（preference 节点）。
test("工具箱填订阅：没有订阅时直接画宿主的地址框；在框里填了（扩展读不到字）2 秒内自己拉一遍；有了之后收进「管理订阅」", async () => {
  await reset();
  scene.subscriptions = [];
  storage.map.delete("subscriptions");
  await activate();
  const editor = byKey("subscriptions-editor");
  assert.equal(editor.kind, "preference");
  assert.deepEqual(editor.props, { preference: "subscriptions" }, "只点名那一项偏好，没有地址、没有句柄");
  assert.equal(editor.on, undefined);

  // 用户在宿主画的框里填了地址：宿主不推变更（地址进钥匙串），扩展每 2 秒现问一次。
  const fetchesBefore = scene.fetches.length;
  scene.subscriptions = [JMS];
  await timers.advance(2000);
  await idle(scene);
  assert.equal(scene.fetches.slice(fetchesBefore).filter((fetch) => fetch.url === JMS).length, 1, "多了新地址就拉一遍");
  assert.equal(byKey("subscriptions-editor"), undefined, "有了订阅就收起来");
  const section = byKey("subscriptions-section");
  await pressAction(section, "manage");
  assert.ok(byKey("subscriptions-editor"), "「管理订阅」展开地址框");
  await pressAction(byKey("subscriptions-section"), "manage");
  assert.equal(byKey("subscriptions-editor"), undefined);
});

test("没装 sing-box：「在终端中安装」跑脚本，之后每 2 秒查一次，装好就换掉那张卡", async () => {
  await reset();
  daemons.daemons[0].located = "";
  await activate();
  const note = byKey("not-installed");
  assert.equal(note.props.title, "没有找到 sing-box");
  await pressAction(note, "install");
  assert.deepEqual(scene.terminal, ["install"]);
  assert.match(byKey("not-installed").props.body, /终端里正在安装/);
  assert.equal(byKey("not-installed").props.actions[0].disabled, true);

  daemons.daemons[0].located = "/opt/homebrew/bin/sing-box";
  await timers.advance(2000);
  await idle(scene);
  assert.equal(byKey("not-installed"), undefined);
  assert.equal(byKey("power").props.disabled, false);
});

test("填了坏路径：不给安装，指向设置", async () => {
  await reset();
  scene.preferences = { singBoxPath: "/nowhere/sing-box" };
  scene.badPath = "/nowhere/sing-box";
  await activate();
  assert.equal(callsOf(scene, "daemon.status").at(-1).params.executable, "/nowhere/sing-box");
  const note = byKey("bad-path");
  assert.equal(note.props.title, "设置里选的 sing-box 路径不可用");
  assert.deepEqual(note.props.actions.map((action) => action.id), ["settings"], "装一个新的救不了写错的路径");
  assert.equal(byKey("not-installed"), undefined);
  scene.badPath = null;
});

test("开：总开关、模式、点节点、测速、速率、终端命令；关：总开关", async () => {
  await reset();
  await activate();
  await fire(byKey("power"), "change", true);
  assert.equal(daemons.status("sing-box").state, "running");
  assert.equal(byKey("power").props.value, true);
  assert.equal(byKey("power").props.subtitle, "已开启 · 规则 · 127.0.0.1:7890");
  assert.equal(byKey("system-proxy").props.value, true);
  assert.equal(byKey("system-proxy").props.subtitle, "系统代理指向 127.0.0.1:7890");
  assert.match(byKey("message").props.text, /^代理已开启/);

  daemons.requests.length = 0;
  await fire(byKey("mode-picker"), "change", "direct");
  assert.deepEqual(JSON.parse(daemons.requests.find((request) => request.method === "PATCH").body), { mode: "Direct" });
  assert.equal(byKey("mode-picker").props.value, "direct");

  const names = collect(byKey("nodes"), (node) => node.kind === "row").map((row) => row.props.title);
  await fire(byKey(`node:${names[3]}`), "press");
  assert.deepEqual(JSON.parse(daemons.requests.find((request) => request.method === "PUT").body), { name: names[3] });
  assert.equal(byKey(`node:${names[3]}`).props.selected, true);

  clash.delays = { [names[1]]: 66 };
  await pressAction(byKey("nodes-section"), "test");
  assert.equal(byKey(`node:${names[1]}`).props.subtitle, "Shadowsocks · 66 ms");
  assert.equal(byKey(`node:${names[1]}`).props.tint, "live");
  assert.equal(byKey(`node:${names[2]}`).props.subtitle, "VLESS · 超时");
  assert.equal(byKey(`node:${names[2]}`).props.tint, "danger");

  clash.totals = { upload: 0, download: 0 };
  await timers.advance(1000);
  clash.totals = { upload: 2048, download: 3 * 1024 * 1024 };
  await timers.advance(1000);
  await idle(scene);
  assert.equal(byKey("status").props.trailing, "↓ 3.0 MB/s  ↑ 2.0 KB/s");
  // 菜单顶部那块曲线也在工具箱里（仓库主人走查第 3 条）：两个点以上才画。
  assert.equal(byKey("traffic-chart"), undefined, "一个点画不成线");
  clash.totals = { upload: 4096, download: 4 * 1024 * 1024 };
  await timers.advance(1000);
  await idle(scene);
  const chart = byKey("traffic-chart");
  assert.equal(chart.kind, "chart");
  assert.deepEqual(chart.props.series.map((series) => series.tone), ["download", "upload"]);
  assert.equal(chart.props.series[0].values.length, 2);
  assert.ok(chart.props.label.length <= 80);

  assert.equal(byKey("terminal-copy").props.text, "export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890");
  assert.ok(countNodes(host.latest) <= 500);
  // 页面也推一份菜单栏模型：后台会话此刻未必在跑，图标不能停在旧状态。
  assert.equal(host.latestMenuBar.symbol, "network");

  await fire(byKey("power"), "change", false);
  assert.equal(daemons.status("sing-box").state, "stopped");
  assert.equal(byKey("system-proxy"), undefined);
  assert.equal(host.latestMenuBar.symbol, "network.slash");
  await fire(byKey("mode-picker"), "change", "rule");
  await fire(byKey("node:auto"), "press");
});

test("系统代理被 Surge 拦着：说明卡写它的原话，给复制终端命令", async () => {
  await reset();
  const message = "当前系统代理由「Surge」提供（127.0.0.1:6152），Jarvis 写了也不会生效";
  daemons.blockSystemProxy({ serviceName: "Surge", address: "127.0.0.1:6152", message });
  await activate();
  await fire(byKey("power"), "change", true);
  assert.equal(daemons.status("sing-box").state, "running");
  const note = byKey("blocked");
  assert.equal(note.props.title, "系统代理被别的代理工具拦着");
  assert.ok(note.props.body.startsWith(message));
  assert.match(byKey("blocked-copy").props.text, /^export https_proxy=http:\/\/127\.0\.0\.1:7890 /);
  assert.equal(byKey("system-proxy").props.value, false);
  assert.equal(byKey("message").props.text, `代理已开启 · 127.0.0.1:7890；${message}`);
  await fire(byKey("power"), "change", false);
});

const portInUse = {
  code: "host.failure",
  message: "sing-box 启动后 1 秒内退出了",
  detail: [
    "+0800 2026-10-28 10:00:00 INFO network: updated default interface en0",
    "+0800 2026-10-28 10:00:00 FATAL[0000] start service: start clash-api: listen tcp 127.0.0.1:19090: bind: address already in use",
  ].join("\n"),
};

test("端口被 Jarvis 自己占着：先停掉自己的内核、再起一次，用户看不到失败", async () => {
  await reset();
  await activate();
  daemons.failNext("daemon.start", portInUse);
  const before = daemons.calls.length;
  await fire(byKey("power"), "change", true);
  // 停掉自己的内核之后等半秒再起（扩展里的 sleep 由假定时器接管）。
  await timers.advance(500);
  await idle(scene);
  assert.equal(byKey("failed"), undefined, "第二次起来了：这一次冲突是自己的旧内核，不该报给用户");
  assert.equal(daemons.status("sing-box").state, "running");
  const methods = daemons.calls.slice(before).map((call) => call.method);
  const firstStart = methods.indexOf("daemon.start");
  const retry = methods.lastIndexOf("daemon.start");
  assert.ok(firstStart >= 0 && retry > firstStart, "起了两次");
  assert.ok(methods.slice(firstStart, retry).includes("daemon.stop"), "两次之间先停自己的内核，把端口放出来");
  await fire(byKey("power"), "change", false);
});

test("起不来：端口被占，说明卡写哪个端口、怎么办，附上最后几行输出", async () => {
  await reset();
  await activate();
  // 停掉自己的内核再试一次仍然冲突：才是真的被别的程序占着。
  daemons.failNext("daemon.start", portInUse, 2);
  await fire(byKey("power"), "change", true);
  await timers.advance(500);
  await idle(scene);
  const note = byKey("failed");
  assert.equal(note.props.title, "控制端口 19090 被别的程序占着");
  assert.equal(note.props.body, "在设置里换一个控制端口，或者先关掉占着它的程序。");
  assert.match(byKey("failed-lines").props.text, /address already in use$/);
  assert.equal(host.latestMenuBar.symbol, "exclamationmark.triangle");

  await pressAction(note, "retry");
  assert.equal(byKey("failed"), undefined);
  assert.equal(daemons.status("sing-box").state, "running");
});

test("REALITY 握手失败（版本太旧）：给「在终端中更新 sing-box」", async () => {
  await reset();
  await activate();
  if (daemons.status("sing-box").state === "running") await fire(byKey("power"), "change", false);
  daemons.failNext("daemon.start", {
    code: "host.failure",
    message: "sing-box 启动后 1 秒内退出了",
    detail: "+0800 2026-10-28 10:00:00 ERROR outbound/vless[JMS]: reality verification failed: handshake: EOF",
  });
  await fire(byKey("power"), "change", true);
  const note = byKey("failed");
  assert.equal(note.props.title, "REALITY 握手失败");
  assert.match(note.props.body, /brew upgrade sing-box/);
  await pressAction(note, "upgrade");
  assert.deepEqual(scene.terminal, ["install"], "同一段脚本：装过就 brew upgrade");
});

test("开着时改了端口：提示重新开启，按下去用新端口重开", async () => {
  await reset();
  await activate();
  if (daemons.status("sing-box").state !== "running") await fire(byKey("power"), "change", true);
  scene.preferences = { mixedPort: 7891 };
  await activate();
  const note = byKey("restart");
  assert.match(note.props.body, /^本地端口改过/);
  await pressAction(note, "restart");
  assert.equal(lastConfig(scene).inbounds[0].listen_port, 7891);
  assert.equal(daemons.systemProxy.port, 7891);
  assert.equal(byKey("restart"), undefined);
});

test("窗口：左边栏活动 / 进程 / 策略 / 规则（jarvis-mac specs/20261028-191224-git-push-error-proxy-dashboard-issue-links P-3）", async () => {
  await reset();
  await activate("window");
  const root = host.latest;
  assert.equal(root.kind, "sidebar", "窗口的根是侧栏");
  assert.deepEqual(root.props.items.map((item) => item.value), ["activity", "processes", "policies", "rules"]);
  assert.equal(root.props.value, "activity");
  assert.equal(root.children.length, 1, "侧栏下恰好一页");
  assert.equal(root.children[0].kind, "scroll");

  // 活动页（jarvis-mac specs/20261029-082059-proxy-window-desktop-layout D-7）：页头右边两个开关与电源键；关着时打开「系统代理」= 开启代理。
  const header = byKey("activity-header");
  assert.equal(header.kind, "header");
  assert.deepEqual(header.children.map((child) => child.key), ["activity-system-proxy", "activity-tun", "activity-power"]);
  assert.equal(byKey("activity-system-proxy").props.value, false);
  await fire(byKey("activity-system-proxy"), "change", true);
  assert.equal(daemons.status("sing-box").state, "running");
  assert.equal(byKey("activity-system-proxy").props.value, true);
  assert.equal(byKey("activity-header").props.tint, "live");
  // 成功的结果在页头停几秒就换回实时状态，不一直挡着状态行。
  assert.match(byKey("activity-header").props.subtitle, /代理已开启/);
  await timers.advance(7000);
  await idle(scene);
  assert.match(byKey("activity-header").props.subtitle, /^已开启 · 127\.0\.0\.1:\d+ · 规则判定$/);
  assert.equal(byKey("fact-network:value").props.text, "Wi-Fi · en0");
  assert.equal(byKey("fact-mode:value").props.text, "规则判定");
  assert.match(byKey("fact-profile:value").props.text, /sub\.example\.com · \d+ 个节点/);
  assert.equal(collect(host.latest, (node) => node.kind === "segmented").length, 0, "活动页没有通栏分段：切换在面板头上");

  clash.connections = [
    {
      id: "c-1",
      metadata: { network: "tcp", type: "mixed/mixed-in", sourceIP: "127.0.0.1", destinationIP: "", sourcePort: "50000", destinationPort: "443", host: "www.example.org", dnsMode: "normal", processPath: "/Applications/Safari.app/Contents/MacOS/Safari (Fusion)" },
      upload: 1024,
      download: 4096,
      start: "2026-10-28T10:00:00+08:00",
      chains: ["JMS-1234567@c95s2.example.com:443", "自动选择", "节点选择"],
      rule: "final",
      rulePayload: "",
    },
  ];
  await timers.advance(1000);
  await idle(scene);
  assert.equal(byKey("card-connections:value").props.text, "1");
  assert.equal(byKey("card-connections:value").props.style, "metric");
  assert.equal(byKey("card-connections:caption").props.text, "1 个程序");
  for (const key of ["traffic-hours", "top-table:processes", "card-latency", "card-upload", "card-download"]) assert.ok(byKey(key), key);
  assert.equal(byKey("traffic-hours").props.labels.length, 24);
  assert.equal(byKey("traffic-hours").props.series[0].values.length, 24);
  assert.deepEqual(byKey("traffic").props.segments.map((segment) => segment.value), ["all", "proxy"]);
  await fire(byKey("top"), "segment", "domains");
  assert.equal(byKey("top").props.segment, "domains");
  assert.ok(byKey("top-table:domains"));

  // 进程页：每个程序一行；连接表；日志。
  await fire(host.latest, "change", "processes");
  assert.equal(host.latest.props.value, "processes");
  clash.connections = [{ ...clash.connections[0], upload: 3072, download: 12288 }];
  await timers.advance(1000);
  await idle(scene);
  assert.equal(host.latest.children[0].kind, "stack", "进程页不整页滚：两栏撑满、表在自己里面滚");
  assert.deepEqual(byKey("processes-split").props, { minimum: 360, spacing: "regular", weights: [2, 3], fill: true });
  const processes = byKey("process-table");
  assert.equal(processes.props.scroll, true);
  assert.equal(processes.props.rows[0].id, "Safari");
  assert.equal(processes.props.rows[0].cells[0], "Safari");
  assert.equal(processes.props.rows[0].cells[1], "1");
  assert.equal(processes.props.rows[0].cells[2], "8.0 KB/s", "两份快照之间下行多了 8 KB、隔 1 秒");
  let connections = byKey("connections");
  assert.deepEqual(connections.props.rows[0].cells.slice(0, 3), ["www.example.org:443", "Safari", "节点选择 → 自动选择 → JMS-1234567@c95s2.example.com:443"]);
  // 点一个程序：右边只看它的连接，第二列从「程序」换成「规则」；再点一次回到全部。
  await fire(processes, "select", "Safari");
  assert.equal(byKey("process-table").props.selection, "Safari");
  assert.equal(byKey("connections-section").props.title, "连接 · Safari");
  connections = byKey("connections");
  assert.equal(connections.props.columns[1].title, "规则");
  assert.equal(connections.props.rows[0].cells[1], "final");
  await fire(byKey("process-table"), "select", "Safari");
  assert.equal(byKey("process-table").props.selection, undefined);
  assert.equal(byKey("connections-section").props.title, "连接 · 全部程序");
  // 搜索：对不上的程序与连接都收起来。
  await fire(byKey("process-search"), "change", "nothing-matches");
  assert.equal(byKey("process-table").props.rows.length, 0);
  assert.equal(byKey("connections").props.rows.length, 0);
  await fire(byKey("process-search"), "change", "");
  daemons.output("sing-box", ["+0800 2026-10-28 10:00:02 INFO inbound/mixed[mixed-in]: inbound connection to www.example.org:443"]);
  await fire(host.latest, "change", "policies");
  await fire(host.latest, "change", "processes");
  assert.match(byKey("log-text").props.value, /inbound connection to www\.example\.org:443/);
  assert.equal(byKey("log-text").props.readOnly, true);

  // 策略页：页头里的出站模式是紧凑分段；左栏策略组、右边那一组的节点卡；点卡 = 选它并只测它一个；订阅地址由宿主画（preference 节点）。
  await fire(host.latest, "change", "policies");
  assert.equal(byKey("policy-mode-picker").props.layout, "compact");
  assert.ok(byKey("policies-header").children.some((child) => child.key === "policy-mode-picker"));
  assert.equal(byKey("policy-group:节点选择").props.selected, true);
  const nodeCards = collect(byKey("node-cards"), (node) => node.kind === "card");
  assert.ok(nodeCards.length >= 2);
  const target = nodeCards[1];
  const name = target.key.slice("node:".length);
  clash.delays[name] = 123;
  const before = scene.daemons.requests.length;
  await fire(target, "press");
  const delayRequests = scene.daemons.requests.slice(before).filter((request) => request.path.includes("/delay"));
  assert.equal(delayRequests.length, 1, "只测点的那一个");
  assert.match(byKey(`node:${name}:detail`).props.text, /已选 · .*123 ms/);
  assert.deepEqual(byKey("subscriptions-editor").props, { preference: "subscriptions" });

  // 规则页：表里有兜底，命中计数来自后台记的 ruleHits。
  storage.map.set("ruleHits", JSON.stringify({ startedAt: lastControl().startedAt, counts: { final: 3 } }));
  await fire(host.latest, "change", "rules");
  const table = byKey("rule-table");
  const final = table.props.rows.at(-1).cells;
  assert.equal(final[1], "FINAL");
  assert.equal(final[4], "3");
  assert.deepEqual(table.props.columns.map((column) => column.title), ["ID", "类型", "目标", "策略", "使用计数", "注释"]);
  assert.ok(countNodes(host.latest) <= 500);
  await fire(byKey("activity-power") ?? (await fire(host.latest, "change", "activity"), byKey("activity-power")), "press");
});

test("页面开着时内核意外退出（菜单栏关着、后台没人记）：页面自己记下失败、进「起不来」那一屏", async () => {
  await reset();
  await activate();
  if (daemons.status("sing-box").state !== "running") await fire(byKey("power"), "change", true);
  daemons.crash("sing-box", { exitCode: 2, lines: ["+0800 2026-10-28 11:00:00 FATAL[0300] router: open cache.db: permission denied"] });
  await idle(scene);
  const note = byKey("failed");
  assert.equal(note.props.title, "FATAL[0300] router: open cache.db: permission denied");
  assert.match(byKey("failed-lines").props.text, /permission denied$/);
  assert.equal(byKey("power").props.value, false);
  assert.equal(storage.get("failure").message, "FATAL[0300] router: open cache.db: permission denied");
  assert.equal(scene.notifications.length, 0, "横幅只由后台会话发");
});
