/**
 * 前台会话里的「规则」页与增强模式（T-8 / T-9 / T-10）：导入 Surge 配置（宿主画打开面板）、外部规则集只拉用户贴进设置的那些、
 * 读当前页面并一键加规则、增强模式没授权时那一屏。对着构建产物跑，与 page.test.mjs 各自一个进程。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { jmsSubscription } from "./support.mjs";
import { ALL, createProxyHost, idle } from "./host.mjs";

const scene = await createProxyHost();
const { host, storage } = scene;

const JMS = "https://sub.example.com/link/synthetic-token?mu=0";
const RULE_SET = "https://rules.example.com/ForceProxy.list";
const chrome = { bundleId: "com.google.Chrome", name: "Google Chrome", path: "/Applications/Google Chrome.app" };

const byKey = (key) => host.find((node) => node.key === key);
const collect = (node, predicate, out = []) => {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) collect(child, predicate, out);
  return out;
};
const pressAction = async (node, id) => {
  const action = (node.props.actions ?? []).find((candidate) => candidate.id === id);
  assert.ok(action, `${node.key} 上应有动作 ${id}`);
  host.dispatch({ type: "ui", handler: action.on.press, payload: {} });
  await idle(scene);
};
const activate = async (surface = "window") => {
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { entry: "toolbox", surface, granted: scene.granted, preferences: scene.preferences, commands: [] } });
  await idle(scene);
};
const showRules = async () => {
  await host.fire(host.latest, "change", "rules");
  await idle(scene);
};

const profile = `[General]
tun-excluded-routes = 203.0.113.7/32
[Proxy Group]
Proxies = select, DIRECT, JP
[Rule]
DOMAIN-SUFFIX,google.com,Proxies
USER-AGENT,Instagram*,Proxies
RULE-SET,${RULE_SET},Proxies
FINAL,Proxies
[MITM]
ca-passphrase = synthetic-passphrase
`;

scene.granted = [...ALL];
scene.preferences = { updateInterval: "never" };
scene.subscriptions = [JMS];
scene.responses = { [JMS]: { status: 200, headers: {}, text: jmsSubscription } };

test("窗口多一页「规则」：当前页面、页面规则、Surge 配置、内置", async () => {
  await activate();
  assert.deepEqual(host.latest.props.items.map((item) => item.value), ["activity", "processes", "policies", "rules"]);
  await showRules();
  for (const key of ["current-page", "page-rules-section", "surge", "builtin-rules"]) assert.ok(byKey(key), key);
  assert.equal(byKey("page-rules").props.emptyState.props.title, "还没有页面规则");
});

test("导入 Surge 配置：宿主画打开面板（起点是 Surge 的配置目录）；报告列出转不了的；外部规则集要用户贴进设置", async () => {
  scene.picked = { name: "synthetic.conf", text: profile };
  await pressAction(byKey("surge"), "import");
  assert.deepEqual(scene.picks.at(-1), { title: "选一份 Surge 配置（.conf）", directory: "~/Library/Application Support/Surge/Profiles", extensions: ["conf", "txt"] });
  const stored = storage.get("surge");
  assert.equal(stored.sourceName, "synthetic.conf");
  assert.equal(stored.ruleChunks, 1);
  assert.ok(!JSON.stringify([...storage.map.values()]).includes("synthetic-passphrase"), "存储里不能有 MITM 口令");
  assert.match(byKey("surge-rules").props.value, /^3 \/ 4 条/);
  assert.equal(byKey("surge-groups").props.value, "Proxies");
  assert.ok(byKey("unsupported:USER-AGENT"));
  assert.ok(byKey("unsupported:[MITM]"));
  assert.equal(byKey("rule-sets-copy").props.text, RULE_SET, "复制下来贴进设置");
  assert.equal(scene.fetches.filter((fetch) => fetch.url === RULE_SET).length, 0, "没贴进设置的地址不去拉");
  // 窗口里上一个动作的结果写在页头状态行里（jarvis-mac specs/20261029-082059-proxy-window-desktop-layout D-2）。
  assert.match(byKey("rules-header").props.subtitle, /导入了「synthetic.conf」/);
});

test("贴进「规则集地址」之后拉、转、存；页面上写明条数", async () => {
  scene.ruleSetURLs = [RULE_SET];
  scene.responses[RULE_SET] = { status: 200, headers: {}, text: "DOMAIN-SUFFIX,force.example\nIP-CIDR,192.0.2.0/24,no-resolve\nUSER-AGENT,x\n" };
  await pressAction(byKey("surge"), "update-sets");
  const records = Object.values(storage.get("ruleSets"));
  assert.equal(records.length, 1);
  assert.equal(records[0].total, 3);
  assert.equal(records[0].skipped, 1);
  assert.ok(records[0].fetchedAt > 0);
  assert.match(byKey(`rule-set:${records[0].tag}`).props.subtitle, /^3 条/);
  assert.equal(byKey("rule-sets-copy"), undefined, "都贴进去了就不再提示");
});

test("读当前页面：地址栏的域名一排策略；点一下加规则、再点同一个删掉", async () => {
  scene.tab = { browser: chrome, frontmost: false, status: "ok", url: "https://www.github.com/x", title: "x" };
  await pressAction(byKey("current-page"), "read-page");
  assert.equal(byKey("page-domain:0").props.title, "github.com");
  const chips = byKey("page-policy:0:chips").children.map((chip) => chip.props.title);
  assert.deepEqual(chips, ["走代理", "直连", "拒绝", "走「Proxies」"], "导入的策略组也在");
  await host.fire(byKey("page-policy:0:direct"), "press");
  await idle(scene);
  assert.deepEqual(storage.get("pageRules").map((rule) => [rule.value, rule.policy]), [["github.com", "direct"]]);
  assert.equal(byKey("page-policy:0:direct").props.selected, true);
  assert.ok(byKey("page-rule:domain_suffix:github.com"));
  await host.fire(byKey("page-policy:0:direct"), "press");
  await idle(scene);
  assert.deepEqual(storage.get("pageRules"), []);
});

test("浏览器没允许「自动化」：那一句原样给出", async () => {
  scene.tab = { browser: chrome, frontmost: true, status: "denied", message: "在 系统设置 › 隐私与安全性 › 自动化 里允许 Jarvis 控制「Google Chrome」" };
  await pressAction(byKey("current-page"), "read-page");
  assert.match(byKey("page-status").props.text, /自动化/);
});

test("撤掉导入的配置：回到内置规则", async () => {
  await pressAction(byKey("surge"), "clear");
  assert.equal(storage.get("surge"), undefined);
  assert.equal(byKey("surge-rules"), undefined);
});

test("工具箱：增强模式一行；想用但没授权时一张说明卡，「授权」只问这一项", async () => {
  scene.granted = ALL.filter((id) => id !== "network.tunnel");
  storage.map.set("selection", JSON.stringify({ mode: "rule", node: "自动选择", tun: true, groups: {} }));
  scene.permissionRequests.length = 0;
  await activate("toolbox");
  const toggle = byKey("tun");
  assert.equal(toggle.kind, "toggle");
  assert.equal(toggle.props.disabled, true);
  assert.match(toggle.props.subtitle, /还没有授权/);
  const note = byKey("tun-not-granted");
  assert.ok(note);
  await pressAction(note, "grant-tun");
  assert.deepEqual(scene.permissionRequests, [["network.tunnel"]]);
  assert.equal(byKey("tun-not-granted"), undefined);
  assert.ok(byKey("tun-password"), "授权了：说明第一次要管理员密码");
});

test("窗口命令 import-surge（菜单栏点的）：开到「规则」页并弹打开面板", async () => {
  scene.granted = [...ALL];
  await activate();
  const picks = scene.picks.length;
  scene.picked = null;
  host.dispatch({ type: "command", context: { id: "import-surge", trigger: "page", granted: scene.granted, preferences: scene.preferences } });
  await idle(scene);
  assert.equal(scene.picks.length, picks + 1);
  assert.equal(host.latest.props.value, "rules");
});
