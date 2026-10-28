/**
 * 今天的流量统计与规则表（jarvis-mac specs/20261028-191224-git-push-error-proxy-dashboard-issue-links P-3）：纯函数。
 * `rule` 字段的写法照 sing-box 1.14.4 实测（本机起一份内核读 /connections）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./support.mjs";

const {
  countRuleHits,
  domainOf,
  emptyDay,
  ingest,
  isProxied,
  localDay,
  matchRule,
  maximumKeys,
  parseRuleText,
  connectionPolicy,
  processName,
  processRates,
  restoreDay,
  routePlan,
  ruleRows,
  topUsages,
  trimUsages,
} = await loadSource();

const at = (hour, minute = 0, day = 28) => new Date(2026, 9, day, hour, minute).getTime();
const connection = (id, upload, download, extra = {}) => ({ id, host: "www.example.org:443", network: "tcp", rule: "final", chains: ["JMS", "节点选择"], upload, download, start: 0, source: "", process: "/usr/bin/curl", ...extra });

test("记账：按连接 id 记差值；第一次见的整条记；消失的连接从 seen 里去掉", () => {
  let state = { stats: emptyDay(at(9)), seen: new Map() };
  state = ingest(state, { uploadTotal: 0, downloadTotal: 0, connections: [connection("a", 100, 1000)] }, at(9, 1));
  state = ingest(state, { uploadTotal: 0, downloadTotal: 0, connections: [connection("a", 150, 3000), connection("b", 10, 20, { chains: ["direct"], process: "", host: "[2001:db8::1]:443" })] }, at(9, 2));
  assert.deepEqual(state.stats.processes.curl, { upload: 150, download: 3000, connections: 1 });
  assert.deepEqual(state.stats.processes["未知进程"], { upload: 10, download: 20, connections: 1 });
  assert.equal(state.stats.domains["2001:db8::1"].download, 20);
  assert.equal(state.stats.all.download[9], 3020);
  assert.equal(state.stats.proxy.download[9], 3000, "直连的不进「仅代理」");
  assert.equal(state.stats.policies.direct.upload, 10);
  state = ingest(state, { uploadTotal: 0, downloadTotal: 0, connections: [connection("b", 10, 20, { chains: ["direct"] })] }, at(10));
  assert.deepEqual([...state.seen.keys()], ["b"]);
  assert.equal(state.stats.all.download[10], 0, "没变的连接不记");
});

test("换天：本地 0 点清零；跨过 0 点的连接只把之后的增量记进新的一天", () => {
  let state = { stats: emptyDay(at(23, 59)), seen: new Map() };
  state = ingest(state, { connections: [connection("a", 0, 500)] }, at(23, 59));
  state = ingest(state, { connections: [connection("a", 0, 800)] }, at(0, 0, 29));
  assert.equal(state.stats.day, localDay(at(0, 0, 29)));
  assert.equal(state.stats.all.download[0], 300);
  assert.equal(state.stats.all.download[23], 0);
});

test("读回存储：不是今天、形状不对的换成空的一天；每类至多 200 个键", () => {
  assert.equal(restoreDay({ day: "2000-01-01" }, at(9)).all.download.length, 24);
  assert.equal(restoreDay(null, at(9)).day, localDay(at(9)));
  const kept = restoreDay({ day: localDay(at(9)), all: { download: [1, -5, "x"] }, processes: { curl: { upload: 2, download: "3" } } }, at(9));
  assert.deepEqual(kept.all.download.slice(0, 3), [1, 0, 0]);
  assert.deepEqual(kept.processes.curl, { upload: 2, download: 0, connections: 0 });
  const many = Object.fromEntries(Array.from({ length: maximumKeys + 5 }, (_, index) => [`p${index}`, { upload: index, download: 0, connections: 1 }]));
  const trimmed = trimUsages(many);
  assert.equal(Object.keys(trimmed).length, maximumKeys);
  assert.ok(!("p0" in trimmed), "淘汰合计最小的");
});

test("Top 10 与进程速率", () => {
  const stats = emptyDay(at(9));
  stats.domains = { a: { upload: 1, download: 1, connections: 1 }, b: { upload: 0, download: 9, connections: 1 } };
  assert.deepEqual(topUsages(stats, "domains").map(([name]) => name), ["b", "a"]);
  const before = { connections: [connection("a", 0, 0), connection("b", 0, 0, { process: "/Applications/Safari.app/Contents/MacOS/Safari" })] };
  const after = { connections: [connection("a", 200, 2000), connection("b", 0, 100, { process: "/Applications/Safari.app/Contents/MacOS/Safari" }), connection("c", 9999, 9999)] };
  const rates = processRates(before, after, 2);
  assert.deepEqual(rates.map((row) => [row.name, row.connections, row.upload, row.download]), [["curl", 2, 100, 1000], ["Safari", 1, 0, 50]], "第一次见的 c 只算连接数、不算速率");
  assert.equal(processName({ process: "" }), "未知进程");
  assert.equal(domainOf({ host: "www.example.org:443" }), "www.example.org");
  assert.equal(connectionPolicy({ chains: ["JMS", "自动选择", "节点选择"] }), "节点选择");
  assert.equal(isProxied({ chains: ["direct", "节点选择"] }), false, "节点选择此刻选着直连");
});

test("rule 字段：sing-box 实测的几种写法都读得出", () => {
  assert.deepEqual(parseRuleText("domain=example.org domain_suffix=[example.com iana.org] => route(节点选择)"), {
    action: "route(节点选择)",
    keys: ["domain", "domain_suffix"],
    values: new Map([["domain", ["example.org"]], ["domain_suffix", ["example.com", "iana.org"]]]),
  });
  assert.equal(parseRuleText("final"), null);
  assert.deepEqual(parseRuleText("domain_suffix=example.net && network=tcp => route(direct)").keys, ["domain_suffix", "network"]);
});

test("规则表：与交给 sing-box 的路由同一份；命中按 rule 字段认回；最后一行兜底", () => {
  const plan = routePlan({
    nodes: [],
    mixedPort: 7890,
    controlPort: 19090,
    controlSecret: "s",
    mode: "rule",
    testURL: "https://example.com",
    chinaRules: true,
    pageRules: [
      { id: "1", kind: "domain_suffix", value: "google.com", policy: "proxy", createdAt: 0 },
      { id: "2", kind: "domain", value: "example.org", policy: "proxy", createdAt: 0 },
    ],
  });
  const hits = {
    "domain_suffix=[localhost local] ip_is_private=true => route(direct)": 2,
    "domain=example.org domain_suffix=google.com => route(节点选择)": 5,
    "rule_set=geosite-cn => route(direct)": 7,
    "clash_mode=Global => route(节点选择)": 1,
    final: 4,
    "process_name=nothing => route(direct)": 9,
  };
  assert.equal(matchRule(plan, "rule_set=geosite-cn => route(direct)"), plan.rules.findIndex((rule) => rule.rule_set === "geosite-cn"));
  const rows = ruleRows(plan, hits);
  assert.deepEqual(rows.map((row) => [row.id, row.type, row.policy, row.hits, row.note]), [
    [1, "LAN", "直连", 2, "局域网与本机一律直连"],
    [2, "MODE", "直连", 0, "出站模式「直连」时全部直连"],
    [3, "MODE", "节点选择", 1, "出站模式「全局」时全部走节点选择"],
    [4, "DOMAIN + DOMAIN-SUFFIX", "节点选择", 5, "页面规则"],
    [5, "RULE-SET", "直连", 7, "内置：中国大陆直连"],
    [6, "RULE-SET", "直连", 0, "内置：中国大陆直连"],
    [7, "FINAL", "节点选择", 4, "兜底：没命中任何规则的连接走「节点选择」"],
  ]);
  assert.equal(rows[3].target, "example.org, google.com");
});

test("规则命中：同一条连接只记一次；换了一份内核从 0 记；消失的连接从 seen 里去掉", () => {
  const seen = new Set();
  let hits = countRuleHits(null, 1, [{ id: "a", rule: "final" }, { id: "b", rule: "final" }], seen);
  hits = countRuleHits(hits, 1, [{ id: "a", rule: "final" }, { id: "c", rule: "x => route(direct)" }], seen);
  assert.deepEqual(hits, { startedAt: 1, counts: { final: 2, "x => route(direct)": 1 } });
  assert.deepEqual([...seen].sort(), ["a", "c"]);
  assert.deepEqual(countRuleHits(hits, 2, [], seen).counts, {}, "换了一份内核");
});
