/**
 * 导入 Surge 配置（T-9）：每一类规则怎么转、相邻同策略怎么合并、IP 规则前的 resolve、策略组怎么落、[Host] 与 [General]、
 * 转不了的怎么记，以及外部规则集的转换与切块。
 *
 * 配置全是**合成**的（主机在 example.* 下、IP 在文档网段里）：不得换成真实配置——真实的 Surge 配置里有 MITM 证书口令与节点密码。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./support.mjs";

const {
  convertSurgeProfile,
  convertSurgeList,
  convertedCount,
  splitTopLevel,
  splitSections,
  parseGeneral,
  policyOf,
  toCIDR,
  splitHeadlessRules,
  chunkItems,
  utf8Length,
} = await loadSource();

const profile = `#!MANAGED-CONFIG https://example.com/managed interval=86400
[General]
loglevel = notify
dns-server = 223.5.5.5, system, 2001:db8::53, not-an-ip
tun-excluded-routes = 203.0.113.7/32, 198.51.100.0/24, 10.0.0.0/33
bypass-tun = 192.168.0.0/16, 10.0.0.0/8
always-real-ip = *.msftconnecttest.com, time.example.com
skip-proxy = 127.0.0.1, localhost, *.lan, *
exclude-simple-hostnames = true
ipv6 = false

[Proxy]
JP = ss, 203.0.113.9, 8388, encrypt-method=aes-256-gcm, password=synthetic

[Proxy Group]
Proxies = select, JP, Auto, DIRECT
Auto = url-test, JP, url=http://www.gstatic.com/generate_204, interval=600
Apple = select, DIRECT, Proxies
Loop = select, Loop2
Loop2 = select, Loop
Remote = select, policy-path=https://example.com/nodes.list

[Rule]
// 注释
DOMAIN-SUFFIX,google.com,Proxies
DOMAIN-SUFFIX,youtube.com,Proxies
DOMAIN,www.example.org,Proxies
DOMAIN-KEYWORD,blogspot,Proxies
DOMAIN-SUFFIX,ads.example.com,REJECT
DOMAIN,tracker.example.com,REJECT-DROP
PROCESS-NAME,Telegram,Telegram
PROCESS-NAME,/Applications/Discord.app/Contents/MacOS/Discord,Telegram
IP-CIDR,91.108.4.0/22,Telegram,no-resolve
IP-CIDR6,2001:b28:f23d::/48,Telegram,no-resolve
DOMAIN-SUFFIX,apple.com,Apple
USER-AGENT,Instagram*,Proxies
URL-REGEX,^https?://ad\\.example\\.com,REJECT
AND,((DOMAIN-SUFFIX,example.net), (DEST-PORT,443)),DIRECT
OR,((DOMAIN,a.example.com), (DOMAIN,b.example.com)),Proxies
NOT,((DOMAIN-SUFFIX,example.edu)),DIRECT
DEST-PORT,8000-8100,DIRECT
PROTOCOL,QUIC,REJECT
RULE-SET,LAN,DIRECT
RULE-SET,SYSTEM,DIRECT
RULE-SET,https://rules.example.com/ForceProxy.list,Proxies
DOMAIN-SET,https://rules.example.com/ads.txt,REJECT
IP-CIDR,198.18.0.0/15,DIRECT
GEOIP,CN,DIRECT
GEOIP,JP,Proxies,no-resolve
FINAL,Proxies,dns-failed

[Host]
router.example.lan = 192.168.1.1
double.example.com = 192.0.2.1, 192.0.2.2
intra.example.com = server:10.0.0.53
sys.example.com = server:system
*.wild.example.com = 192.0.2.3
alias.example.com = target.example.com

[URL Rewrite]
^https://a.example.com https://b.example.com 302

[MITM]
hostname = *.example.com
ca-passphrase = synthetic-passphrase

[Script]
s = type=http-response,pattern=^https://x.example.com,script-path=https://example.com/s.js
`;

const imported = convertSurgeProfile(profile, "synthetic.conf", 1_700_000_000_000);

test("切段与逗号：引号、括号里的逗号不切；注释与空行丢掉", () => {
  assert.deepEqual(splitTopLevel('AND,((DOMAIN,a), (DEST-PORT,443)),"My Group, A",no-resolve'), ["AND", "((DOMAIN,a), (DEST-PORT,443))", "My Group, A", "no-resolve"]);
  const sections = splitSections("# x\n[General]\na = 1\n\n// y\n[Rule]\nFINAL,DIRECT\n");
  assert.deepEqual([...sections.keys()], ["", "General", "Rule"]);
  assert.deepEqual(sections.get("Rule"), ["FINAL,DIRECT"]);
});

test("[General]：TUN 相关几项；坏的网段与不是 IP 的 DNS 丢掉", () => {
  assert.deepEqual(imported.general, {
    tunExcludedRoutes: ["203.0.113.7/32", "198.51.100.0/24"],
    bypassTun: ["192.168.0.0/16", "10.0.0.0/8"],
    alwaysRealIP: ["*.msftconnecttest.com", "time.example.com"],
    dnsServers: ["223.5.5.5", "system", "2001:db8::53"],
    skipProxy: ["127.0.0.1", "localhost", "*.lan", "*"],
    excludeSimpleHostnames: true,
    ipv6: false,
  });
  assert.equal(parseGeneral([]).ipv6, null);
  assert.equal(toCIDR("1.2.3.4"), "1.2.3.4/32");
  assert.equal(toCIDR("2001:db8::1"), "2001:db8::1/128");
  assert.equal(toCIDR("1.2.3.4/40"), null);
});

test("策略：DIRECT、REJECT 一家（-DROP 丢包）、其余都是策略组", () => {
  assert.deepEqual(policyOf("direct"), { kind: "direct" });
  assert.deepEqual(policyOf("REJECT-TINYGIF"), { kind: "reject", drop: false });
  assert.deepEqual(policyOf("REJECT-DROP"), { kind: "reject", drop: true });
  assert.deepEqual(policyOf(" Proxies "), { kind: "group", name: "Proxies" });
});

test("规则：每一类的转法、相邻同策略合并、不同策略不合并（顺序就是语义）", () => {
  const rules = imported.rules;
  assert.deepEqual(rules[0], {
    kind: "match",
    match: { domain_suffix: ["google.com", "youtube.com"], domain: ["www.example.org"], domain_keyword: ["blogspot"] },
    policy: { kind: "group", name: "Proxies" },
    resolve: false,
  });
  assert.deepEqual(rules[1], { kind: "match", match: { domain_suffix: ["ads.example.com"] }, policy: { kind: "reject", drop: false }, resolve: false });
  assert.deepEqual(rules[2], { kind: "match", match: { domain: ["tracker.example.com"] }, policy: { kind: "reject", drop: true }, resolve: false });
  assert.deepEqual(rules[3].match, { process_name: ["Telegram", "Discord"] }, "同一种非目标字段也能合并；完整路径只取文件名（process_path 过不了增强模式的守卫）");
  assert.deepEqual(rules[4].match, { ip_cidr: ["91.108.4.0/22", "2001:b28:f23d::/48"] }, "进程规则与 IP 规则不能合（字段之间是「与」）");
  assert.equal(rules[4].resolve, false, "no-resolve");
  const logical = rules.filter((rule) => rule.kind === "match" && rule.match.type === "logical");
  assert.deepEqual(logical[0].match, { type: "logical", mode: "and", rules: [{ domain_suffix: ["example.net"] }, { port: [443] }] });
  assert.deepEqual(logical[1].match, { type: "logical", mode: "or", rules: [{ domain: ["a.example.com"] }, { domain: ["b.example.com"] }] });
  assert.ok(rules.some((rule) => rule.kind === "match" && rule.match.invert === true && rule.match.domain_suffix?.[0] === "example.edu"), "NOT → invert");
  assert.ok(rules.some((rule) => rule.kind === "match" && rule.match.port_range?.[0] === "8000:8100"));
  assert.ok(rules.some((rule) => rule.kind === "match" && rule.match.protocol?.[0] === "quic"));
  assert.ok(rules.some((rule) => rule.kind === "match" && rule.match.ip_is_private === true), "RULE-SET,LAN");
  const sets = rules.filter((rule) => rule.kind === "ruleSet");
  assert.equal(sets.length, 2);
  assert.equal(sets[1].noResolve, true, "DOMAIN-SET 里只有域名");
  const ipRule = rules.find((rule) => rule.kind === "match" && rule.match.ip_cidr?.[0] === "198.18.0.0/15");
  assert.equal(ipRule.resolve, true, "不带 no-resolve 的 IP 规则要解析");
  const geo = rules.filter((rule) => rule.kind === "match" && rule.match.rule_set);
  assert.deepEqual(geo.map((rule) => [rule.match.rule_set[0], rule.resolve]), [["geoip-cn", true], ["geoip-jp", false]]);
  assert.deepEqual(imported.geoip, ["cn", "jp"]);
  assert.deepEqual(imported.final, { kind: "group", name: "Proxies" });
  assert.deepEqual(imported.ruleSets.map((ref) => [ref.host, ref.format]), [["rules.example.com", "rule-set"], ["rules.example.com", "domain-set"]]);
  assert.match(imported.ruleSets[0].tag, /^surge-[0-9a-f]{16}$/);
});

test("报告：按类型计数、转不了的逐类带原因；凭据所在的段只数不抄", () => {
  const report = imported.report;
  assert.equal(report.ruleLines, 26);
  assert.equal(report.converted["DOMAIN-SUFFIX"], 4);
  assert.equal(report.converted["RULE-SET"], 2, "LAN 与一个地址");
  assert.equal(convertedCount(report), 23);
  const kinds = Object.fromEntries(report.unsupported.map((kind) => [kind.kind, kind]));
  assert.equal(kinds["USER-AGENT"].count, 1);
  assert.match(kinds["USER-AGENT"].reason, /MITM/);
  assert.equal(kinds["URL-REGEX"].count, 1);
  assert.equal(kinds["RULE-SET,SYSTEM"].count, 1);
  assert.equal(kinds["[MITM]"].count, 2);
  assert.deepEqual(kinds["[MITM]"].samples, [], "[MITM] 里有证书口令：只数不抄");
  assert.deepEqual(kinds["[Proxy]"].samples, []);
  assert.equal(kinds["[Script]"].count, 1);
  assert.equal(kinds["[URL Rewrite]"].count, 1);
  assert.equal(kinds["[Host] 通配"].count, 1);
  assert.equal(kinds["[Host] 别名"].count, 1);
  assert.ok(!JSON.stringify(imported).includes("synthetic-passphrase"), "导入结果里不能有口令");
  assert.ok(!JSON.stringify(imported).includes("password=synthetic"), "也不能有节点密码");
});

test("策略组：节点名落到「节点选择」，url-test 默认「自动选择」，规则里用到却没定义的补上，成环的边删掉", () => {
  const groups = Object.fromEntries(imported.groups.map((group) => [group.name, group.members]));
  assert.deepEqual(groups.Proxies, [{ kind: "nodes" }, { kind: "group", name: "Auto" }, { kind: "direct" }, { kind: "auto" }]);
  assert.deepEqual(groups.Auto, [{ kind: "auto" }, { kind: "nodes" }]);
  assert.deepEqual(groups.Apple, [{ kind: "direct" }, { kind: "group", name: "Proxies" }, { kind: "nodes" }, { kind: "auto" }]);
  assert.deepEqual(groups.Remote, [{ kind: "nodes" }, { kind: "auto" }], "policy-path 的成员我们没有：落到节点选择");
  assert.deepEqual(groups.Telegram, [{ kind: "nodes" }, { kind: "auto" }, { kind: "direct" }], "规则里用到、没定义的");
  const loop = [...groups.Loop, ...groups.Loop2].filter((member) => member.kind === "group");
  assert.equal(loop.length, 1, "Loop ⇄ Loop2 只留一条边");
});

test("[Host]：IP 进 hosts、server:IP 指定 DNS；通配、别名、server:system 进报告", () => {
  assert.deepEqual(imported.hosts, [
    { kind: "address", domain: "router.example.lan", addresses: ["192.168.1.1"] },
    { kind: "address", domain: "double.example.com", addresses: ["192.0.2.1", "192.0.2.2"] },
    { kind: "server", domain: "intra.example.com", server: "10.0.0.53" },
  ]);
});

test("挑错了文件（没有规则也没有组）：说清楚", () => {
  assert.throws(() => convertSurgeProfile("hello\nworld\n", "a.txt", 1), /挑的是 Surge 的配置/);
});

test("外部规则集：规则列表与域名列表各自转；目标类并成一条、别的字段各一条", () => {
  const list = convertSurgeList(
    "# 注释\nDOMAIN-SUFFIX,a.example.com\nDOMAIN,b.example.com\nIP-CIDR,192.0.2.0/24,no-resolve\nIP-CIDR,198.51.100.0/24\nPROCESS-NAME,curl\nUSER-AGENT,x*\nGEOIP,CN\n",
    "rule-set",
  );
  assert.deepEqual(list.rules, [{ domain_suffix: ["a.example.com"], domain: ["b.example.com"], ip_cidr: ["192.0.2.0/24", "198.51.100.0/24"] }, { process_name: ["curl"] }]);
  assert.equal(list.hasIP, true, "有一条没写 no-resolve");
  assert.equal(convertSurgeList("IP-CIDR,192.0.2.0/24,no-resolve\n", "rule-set").hasIP, false, "全写了 no-resolve 就不触发解析");
  assert.equal(list.total, 7);
  assert.equal(list.skipped, 2, "USER-AGENT 与列表里的 GEOIP（要另一个规则集）跳过");
  const domains = convertSurgeList(".example.com\nexact.example.org\nbad domain\n", "domain-set");
  assert.deepEqual(domains.rules, [{ domain_suffix: ["example.com"], domain: ["exact.example.org"] }]);
  assert.equal(domains.hasIP, false);
  assert.equal(domains.skipped, 1);
});

test("规则集切块：一条几千个后缀的规则拆成几条、每块放得进存储", () => {
  const big = { domain_suffix: Array.from({ length: 6000 }, (_, index) => `host-${index}.example.com`) };
  const split = splitHeadlessRules([big, { process_name: ["curl"] }]);
  assert.ok(split.length > 2);
  assert.deepEqual(split.flatMap((rule) => rule.domain_suffix ?? []).length, 6000, "一个都不丢");
  for (const block of chunkItems(split)) assert.ok(utf8Length(JSON.stringify(block)) <= 48 * 1024);
});
