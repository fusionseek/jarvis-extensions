/**
 * sing-box 配置生成：形状、规则顺序、模式名、选项校验，以及交给本机真实的 `sing-box check` 验一遍。
 *
 * `sing-box check` 只构造、不启动：不监听端口、不联网、不下载规则集（远程规则集在 `StartContext` 里才下载），
 * 所以连 `chinaRules: true` 的那份也能离线验。本机没装 sing-box 时这两条跳过并说明。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSource, base64, base64url, jmsSubscription, UUID, UUID_2, REALITY_PUBLIC_KEY } from "./support.mjs";

const {
  buildConfig,
  terminalProxyCommand,
  parseSubscription,
  proxyModeFromClash,
  clashModeNames,
  chinaRuleSets,
  SELECTOR_TAG,
  URLTEST_TAG,
  DIRECT_TAG,
  RULE_SET_HTTP_CLIENT_TAG,
  convertSurgeProfile,
  convertSurgeList,
  tunnelExcludeRoutes,
  systemProxyBypass,
  groupTags,
  realIPMatch,
  fakeIPRanges,
} = await loadSource();

const SING_BOX = "/opt/homebrew/bin/sing-box";

const jmsNodes = parseSubscription(jmsSubscription).nodes;

/** 每种协议、每种传输至少一个节点：交给 `sing-box check` 的那份配置用它，任何一个字段写错都会让 check 失败。 */
const everyProtocol = parseSubscription(
  [
    `ss://${base64url("aes-256-gcm:pw")}@203.0.113.1:8388#ss`,
    `ss://${base64("chacha20-ietf-poly1305:0>>?@203.0.113.7:8388")}#ss-legacy`,
    `ss://2022-blake3-aes-128-gcm:${encodeURIComponent(Buffer.alloc(16, 3).toString("base64"))}@203.0.113.2:443#ss-2022`,
    `ss://${base64url("aes-128-gcm:pw")}@203.0.113.3:443?plugin=${encodeURIComponent("obfs-local;obfs=tls;obfs-host=a.example.com")}#ss-obfs`,
    `vmess://${base64(JSON.stringify({ ps: "vmess-ws", add: "v.example.com", port: "443", id: UUID, aid: "0", net: "ws", host: "cdn.example.com", path: "/ray?ed=2048", tls: "tls", alpn: "h2,http/1.1", fp: "firefox" }))}`,
    `vmess://${base64url(JSON.stringify({ ps: "vmess-grpc", add: "v.example.com", port: 443, id: UUID, net: "grpc", path: "svc", tls: "tls" }))}`,
    `vmess://${base64(JSON.stringify({ ps: "vmess-http", add: "v.example.com", port: "80", id: UUID, net: "tcp", type: "http", host: "www.example.net", path: "/" }))}`,
    `vless://${UUID_2}@[2001:db8::3]:8443?security=tls&sni=v.example.com&type=ws&host=cdn.example.com&path=%2Fws#vless-ws`,
    `vless://${UUID}@g.example.com:443?security=reality&sni=www.example.org&pbk=${REALITY_PUBLIC_KEY}&type=grpc&serviceName=svc#vless-grpc-reality`,
    `vless://${UUID}@h.example.com:443?security=tls&type=h2&host=h.example.com&path=%2Fh2#vless-h2`,
    `vless://${UUID}@u.example.com:80?type=httpupgrade&host=u.example.com&path=%2Fup#vless-httpupgrade`,
    "trojan://pw@t.example.com:443?sni=t.example.com&alpn=h2#trojan",
    "hysteria2://pw@h.example.com:8443?sni=h.example.com&obfs=salamander&obfs-password=x#hy2",
    "hy2://pw@h.example.com:443,20000-30000#hy2-hopping",
    `tuic://${UUID}:pw@q.example.com:443?congestion_control=bbr&udp_relay_mode=native&sni=q.example.com#tuic`,
    "anytls://pw@a.example.com/?sni=a.example.com#anytls",
    `anytls://pw@r.example.com:443?security=reality&sni=www.example.org&pbk=${REALITY_PUBLIC_KEY}&fp=chrome#anytls-reality`,
  ].join("\n"),
);

/** 一份合法的选项。 */
const options = (overrides = {}) => ({
  nodes: jmsNodes,
  mixedPort: 7890,
  controlPort: 9090,
  controlSecret: "synthetic-secret",
  mode: "rule",
  testURL: "https://www.gstatic.com/generate_204",
  chinaRules: false,
  ...overrides,
});

test("入站、出站与策略组", () => {
  const config = buildConfig(options());
  assert.deepEqual(config.inbounds, [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 7890 }]);
  assert.equal(SELECTOR_TAG, "节点选择");
  assert.equal(URLTEST_TAG, "自动选择");
  const names = jmsNodes.map((n) => n.name);
  assert.deepEqual(
    config.outbounds.map((o) => o.tag),
    [SELECTOR_TAG, URLTEST_TAG, ...names, DIRECT_TAG],
  );
  assert.deepEqual(config.outbounds[0], {
    type: "selector",
    tag: SELECTOR_TAG,
    outbounds: [URLTEST_TAG, ...names],
    default: URLTEST_TAG,
    interrupt_exist_connections: true,
  });
  assert.deepEqual(config.outbounds[1], {
    type: "urltest",
    tag: URLTEST_TAG,
    outbounds: names,
    url: "https://www.gstatic.com/generate_204",
  });
  assert.deepEqual(config.outbounds[3], { tag: names[1], ...jmsNodes[1].outbound }, "节点出站 = 解析出的出站 + tag");
  assert.deepEqual(config.outbounds.at(-1), { type: "direct", tag: DIRECT_TAG });
});

test("「节点选择」默认选中：选项里点名的组员；不是组员时用「自动选择」", () => {
  const name = jmsNodes[3].name;
  assert.equal(buildConfig(options({ selected: name })).outbounds[0].default, name);
  assert.equal(buildConfig(options({ selected: URLTEST_TAG })).outbounds[0].default, URLTEST_TAG);
  assert.equal(buildConfig(options({ selected: "已经不在订阅里的节点" })).outbounds[0].default, URLTEST_TAG);
  assert.equal(buildConfig(options({ selected: DIRECT_TAG })).outbounds[0].default, URLTEST_TAG, "direct 不是组员");
});

test("路由：嗅探 → 私有地址直连 → 模式规则 → final 节点选择；DNS 只有系统解析器", () => {
  const config = buildConfig(options());
  assert.deepEqual(config.route, {
    rules: [
      { action: "sniff" },
      { ip_is_private: true, domain_suffix: ["localhost", "local"], action: "route", outbound: DIRECT_TAG },
      { clash_mode: "Direct", action: "route", outbound: DIRECT_TAG },
      { clash_mode: "Global", action: "route", outbound: SELECTOR_TAG },
    ],
    final: SELECTOR_TAG,
    default_domain_resolver: "local",
    find_process: true,
  });
  assert.deepEqual(config.dns, { servers: [{ type: "local", tag: "local" }] });
  assert.equal(config.http_clients, undefined, "不分流时不需要下载任何东西");
  assert.deepEqual(config.log, { level: "info", timestamp: true });
  assert.deepEqual(config.experimental, {
    cache_file: { enabled: true },
    clash_api: { external_controller: "127.0.0.1:9090", secret: "synthetic-secret", default_mode: "Rule" },
  });
});

test("中国大陆分流：两份远程规则集、直连下载的 HTTP 客户端，规则排在模式规则之后", () => {
  const config = buildConfig(options({ chinaRules: true }));
  assert.deepEqual(config.route.rules.slice(4), [
    { rule_set: "geosite-cn", action: "route", outbound: DIRECT_TAG },
    { rule_set: "geoip-cn", action: "route", outbound: DIRECT_TAG },
  ]);
  assert.deepEqual(config.route.rule_set, [
    { type: "remote", tag: "geosite-cn", format: "binary", url: "https://testingcf.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs" },
    { type: "remote", tag: "geoip-cn", format: "binary", url: "https://testingcf.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs" },
  ]);
  assert.equal(chinaRuleSets.length, 2);
  assert.deepEqual(config.http_clients, [{ tag: RULE_SET_HTTP_CLIENT_TAG }], "不写 detour：指向空的 direct 出站会被 sing-box 拒绝");
  assert.equal(config.route.default_http_client, RULE_SET_HTTP_CLIENT_TAG);
  for (const set of config.route.rule_set) assert.equal(set.download_detour, undefined, "1.14 弃用的字段不出现");
});

test("出站模式：三种模式对应 Clash API 的首字母大写写法，读回来不分大小写", () => {
  assert.deepEqual(clashModeNames, { rule: "Rule", global: "Global", direct: "Direct" });
  for (const mode of ["rule", "global", "direct"]) {
    assert.equal(buildConfig(options({ mode })).experimental.clash_api.default_mode, clashModeNames[mode]);
    assert.equal(proxyModeFromClash(clashModeNames[mode]), mode);
  }
  assert.equal(proxyModeFromClash(" global "), "global");
  assert.equal(proxyModeFromClash("Enhanced"), null);
});

test("节点名再去一次重，且不改调用方的节点", () => {
  const nodes = [jmsNodes[0], { ...jmsNodes[1], name: jmsNodes[0].name }, { ...jmsNodes[2], name: SELECTOR_TAG }];
  const before = JSON.stringify(nodes);
  const config = buildConfig(options({ nodes }));
  assert.deepEqual(config.outbounds.slice(2, 5).map((o) => o.tag), [jmsNodes[0].name, `${jmsNodes[0].name} 2`, `${SELECTOR_TAG} 2`]);
  config.outbounds[2].server = "changed";
  assert.equal(JSON.stringify(nodes), before);
});

test("调用方给错的选项抛错（中文）", () => {
  assert.throws(() => buildConfig(options({ nodes: [] })), /没有可用的节点/);
  assert.throws(() => buildConfig(options({ mixedPort: 80 })), /本地端口/);
  assert.throws(() => buildConfig(options({ controlPort: 70000 })), /控制端口/);
  assert.throws(() => buildConfig(options({ controlPort: 7890 })), /不能相同/);
  assert.throws(() => buildConfig(options({ controlSecret: "" })), /secret/);
  assert.throws(() => buildConfig(options({ testURL: "ftp://example.com" })), /延迟测试地址/);
  assert.throws(() => buildConfig(options({ mode: "enhanced" })), /出站模式/);
});

test("终端代理命令", () => {
  assert.equal(
    terminalProxyCommand(7890),
    "export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890",
  );
});

/**
 * 写进临时目录、跑 `sing-box check`。
 * @returns `{ status, output }`。
 */
function singBoxCheck(config) {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-proxy-"));
  try {
    const file = join(directory, "config.json");
    writeFileSync(file, JSON.stringify(config, null, 2));
    const result = spawnSync(SING_BOX, ["check", "-c", file, "-D", directory], { encoding: "utf8", timeout: 20_000 });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const chinaRules of [false, true]) {
  test(
    `sing-box check 通过且没有弃用警告（chinaRules: ${chinaRules}）`,
    { skip: existsSync(SING_BOX) ? false : `本机没有 ${SING_BOX}（brew install sing-box）` },
    () => {
      assert.equal(everyProtocol.skipped.length, 0, JSON.stringify(everyProtocol.skipped));
      assert.equal(everyProtocol.nodes.length, 17);
      const nodes = [...jmsNodes, ...everyProtocol.nodes];
      const { status, output } = singBoxCheck(buildConfig(options({ nodes, chinaRules, selected: jmsNodes[1].name })));
      assert.equal(status, 0, output);
      assert.doesNotMatch(output, /WARN|ERROR|FATAL|deprecated/i, output);
    },
  );
}

// MARK: - 增强模式（TUN）与导入的 Surge 规则（jarvis-mac specs/20261028-111714-proxy-tun-orb-traffic-page-rules T-7 / T-9）

/** 一份合成的 Surge 配置（主机与 IP 都是编的）。 */
const surgeProfile = `[General]
dns-server = 180.184.1.1, system
tun-excluded-routes = 203.0.113.7/32
bypass-tun = 192.168.0.0/16
always-real-ip = *.msftconnecttest.com, stun.*.*
skip-proxy = 127.0.0.1, localhost, *
[Proxy Group]
Proxies = select, Auto, DIRECT
Auto = url-test, a, url=http://x
[Rule]
DOMAIN-SUFFIX,google.com,Proxies
DOMAIN,ad.example.com,REJECT
PROCESS-NAME,Telegram,Telegram
IP-CIDR,91.108.4.0/22,Telegram,no-resolve
RULE-SET,https://rules.example.com/ForceProxy.list,Proxies
IP-CIDR,10.10.0.0/16,DIRECT
GEOIP,CN,DIRECT
FINAL,Proxies
[Host]
router.example.lan = 192.168.1.1
intra.example.com = server:10.0.0.53
`;
const surge = convertSurgeProfile(surgeProfile, "synthetic.conf", 1);
const ruleSets = { [surge.ruleSets[0].tag]: convertSurgeList("DOMAIN-SUFFIX,force.example\nIP-CIDR,192.0.2.0/24,no-resolve\n", "rule-set") };
const pageRules = [
  { id: "domain_suffix:github.com", kind: "domain_suffix", value: "github.com", policy: "direct", createdAt: 1 },
  { id: "domain_suffix:x.example.com", kind: "domain_suffix", value: "x.example.com", policy: "group:Telegram", createdAt: 1 },
];

/** 宿主的网络助手会填进去的 TUN 段（扩展的配置里不许有它，check 时补上演一遍宿主）。 */
const hostTun = (routes) => ({ type: "tun", tag: "tun-in", address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"], mtu: 9000, auto_route: true, strict_route: true, stack: "mixed", route_exclude_address: routes });

test("TUN：不写 tun 入站（宿主填）、DNS 劫持排第一、出站绑网卡、按进程分流开着", () => {
  const config = buildConfig(options({ kernel: "tunnel" }));
  assert.deepEqual(config.inbounds, [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 7890 }], "系统代理与终端命令仍指向它");
  assert.deepEqual(config.route.rules.slice(0, 2), [{ action: "sniff" }, { protocol: "dns", action: "hijack-dns" }]);
  assert.equal(config.route.auto_detect_interface, true);
  assert.equal(config.route.find_process, true);
  assert.equal(config.route.default_domain_resolver, "dns-direct", "不用系统解析器：它的查询会绕进 TUN 再被劫持回来");
  assert.deepEqual(config.experimental.cache_file, { enabled: true, store_fakeip: true });
  const servers = Object.fromEntries(config.dns.servers.map((server) => [server.tag, server]));
  assert.deepEqual(servers["dns-direct"], { type: "udp", tag: "dns-direct", server: "223.5.5.5" });
  assert.deepEqual(servers["dns-proxy"], { type: "https", tag: "dns-proxy", server: "1.1.1.1", detour: SELECTOR_TAG });
  assert.deepEqual(servers["dns-fakeip"], { type: "fakeip", tag: "dns-fakeip", inet4_range: fakeIPRanges.inet4, inet6_range: fakeIPRanges.inet6 });
  assert.deepEqual(config.dns.rules.at(-1), { query_type: ["A", "AAAA"], action: "route", server: "dns-fakeip" });
  assert.equal(config.dns.final, "dns-proxy");
  assert.ok(!JSON.stringify(config).includes('"output"'), "不写日志文件");
  assert.ok(!/_path"|"path"/.test(JSON.stringify(config)), "不带任何文件路径（宿主守卫会拒）");
});

test("TUN 真实 IP：没有 fakeip 服务器与假 IP 规则，cache 不存假 IP", () => {
  const config = buildConfig(options({ kernel: "tunnel", dnsMode: "realip" }));
  assert.ok(!config.dns.servers.some((server) => server.type === "fakeip"));
  assert.ok(!config.dns.rules.some((rule) => rule.server === "dns-fakeip"));
  assert.deepEqual(config.experimental.cache_file, { enabled: true });
});

test("always-real-ip 的写法：*. 是后缀，别处有 * 的是正则，其余是完整域名", () => {
  assert.deepEqual(realIPMatch(["*.msftconnecttest.com", "time.apple.com", "stun.*.*", "*"]), {
    domain: ["time.apple.com"],
    domain_suffix: ["msftconnecttest.com"],
    domain_regex: ["^stun\\.[^.]+\\.[^.]+$"],
  });
});

test("导入的 Surge 规则：页面规则在最前、导入的规则替代内置分流、resolve 插在第一条要解析的 IP 规则之前、FINAL", () => {
  const config = buildConfig(options({ chinaRules: true, surge, ruleSets, pageRules }));
  const rules = config.route.rules;
  const tags = groupTags(surge, jmsNodes);
  assert.deepEqual(rules.slice(4, 6), [
    { domain_suffix: ["github.com"], action: "route", outbound: DIRECT_TAG },
    { domain_suffix: ["x.example.com"], action: "route", outbound: tags.get("Telegram") },
  ]);
  const after = rules.slice(6);
  assert.deepEqual(after[0], { domain_suffix: ["google.com"], action: "route", outbound: "Proxies" });
  assert.deepEqual(after[1], { domain: ["ad.example.com"], action: "reject" });
  assert.deepEqual(after[2], { process_name: ["Telegram"], action: "route", outbound: "Telegram" });
  assert.deepEqual(after[3], { ip_cidr: ["91.108.4.0/22"], action: "route", outbound: "Telegram" }, "no-resolve 的不触发解析");
  assert.deepEqual(after[4], { rule_set: [surge.ruleSets[0].tag], action: "route", outbound: "Proxies" }, "规则集里的 IP 规则都带 no-resolve：不触发");
  assert.deepEqual(after[5], { action: "resolve" });
  assert.deepEqual(after[6], { ip_cidr: ["10.10.0.0/16"], action: "route", outbound: DIRECT_TAG });
  assert.deepEqual(after[7], { rule_set: ["geoip-cn"], action: "route", outbound: DIRECT_TAG });
  assert.equal(config.route.final, "Proxies");
  assert.ok(!rules.some((rule) => rule.rule_set?.[0] === "geosite-cn"), "导入的配置自带分流：内置的不加");
  assert.deepEqual(
    config.route.rule_set.map((set) => [set.type, set.tag]),
    [["remote", "geoip-cn"], ["inline", surge.ruleSets[0].tag]],
  );
  const proxies = config.outbounds.find((outbound) => outbound.tag === "Proxies");
  assert.deepEqual(proxies, { type: "selector", tag: "Proxies", outbounds: ["Auto", DIRECT_TAG, SELECTOR_TAG, URLTEST_TAG], default: "Auto", interrupt_exist_connections: true });
  assert.ok(config.dns.rules.some((rule) => rule.server === "dns-hosts"), "[Host] 的 IP 进 hosts");
  assert.ok(config.dns.servers.some((server) => server.type === "udp" && server.server === "10.0.0.53"), "server:IP 单开一台");
});

test("没拉到的外部规则集：引用它的那条规则这一次跳过，配置照样起得来", () => {
  const config = buildConfig(options({ surge }));
  assert.ok(!config.route.rules.some((rule) => rule.rule_set?.[0]?.startsWith("surge-")));
  assert.ok(!(config.route.rule_set ?? []).some((set) => set.type === "inline"));
});

test("不进 TUN 的路由与系统代理例外：默认局域网段 + 导入的；单独一个 * 不要", () => {
  assert.deepEqual(tunnelExcludeRoutes(surge), ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "203.0.113.7/32"]);
  assert.deepEqual(tunnelExcludeRoutes(null), ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"]);
  assert.deepEqual(systemProxyBypass(surge), ["127.0.0.1", "localhost"]);
});

test("TUN 用导入的 dns-server（system 不算），ipv6 = false 时只要 IPv4", () => {
  const config = buildConfig(options({ kernel: "tunnel", surge: { ...surge, general: { ...surge.general, ipv6: false } } }));
  assert.equal(config.dns.servers.find((server) => server.tag === "dns-direct").server, "180.184.1.1");
  assert.equal(config.dns.strategy, "ipv4_only");
});

for (const [label, overrides] of [
  ["TUN fake-ip + 导入的规则", { kernel: "tunnel", surge, ruleSets, pageRules, chinaRules: true }],
  ["TUN 真实 IP + 内置分流", { kernel: "tunnel", dnsMode: "realip", chinaRules: true, pageRules }],
  ["系统代理 + 导入的规则", { surge, ruleSets, pageRules }],
]) {
  test(
    `sing-box check 通过且没有弃用警告（${label}）`,
    { skip: existsSync(SING_BOX) ? false : `本机没有 ${SING_BOX}（brew install sing-box）` },
    () => {
      const config = buildConfig(options({ nodes: [...jmsNodes, ...everyProtocol.nodes], ...overrides }));
      if (overrides.kernel === "tunnel") config.inbounds.unshift(hostTun(tunnelExcludeRoutes(overrides.surge)));
      const { status, output } = singBoxCheck(config);
      assert.equal(status, 0, output);
      assert.doesNotMatch(output, /WARN|ERROR|FATAL|deprecated/i, output);
    },
  );
}
