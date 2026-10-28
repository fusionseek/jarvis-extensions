/**
 * 当前页面规则（T-8）：主机规整、可注册域名、认浏览器的网络进程、「当前页面」的域名归并、页面规则的增删与编译。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./support.mjs";

const {
  normalizeHost,
  urlHost,
  registrableDomain,
  isBrowserProcess,
  pageDomains,
  upsertPageRule,
  removePageRule,
  normalizePageRules,
  pageRuleFor,
  policyTitle,
  compilePageRules,
  SELECTOR_TAG,
  DIRECT_TAG,
} = await loadSource();

const chrome = { bundleId: "com.google.Chrome", name: "Google Chrome", path: "/Applications/Google Chrome.app" };
const safari = { bundleId: "com.apple.Safari", name: "Safari", path: "/Applications/Safari.app" };
const chromeHelper = "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/130/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper";

test("主机与可注册域名", () => {
  assert.equal(normalizeHost("API.GitHub.com:443"), "api.github.com");
  assert.equal(normalizeHost("[2001:db8::1]:443"), "2001:db8::1");
  assert.equal(normalizeHost("bad host"), "");
  assert.equal(urlHost("https://user@www.github.com:8443/a?b#c"), "www.github.com");
  assert.equal(urlHost("about:blank"), "", "不是网页");
  assert.equal(registrableDomain("api.github.com"), "github.com");
  assert.equal(registrableDomain("www.bbc.co.uk"), "bbc.co.uk");
  assert.equal(registrableDomain("a.b.example.com.cn"), "example.com.cn");
  assert.equal(registrableDomain("someone.github.io"), "someone.github.io", "公共托管的二级后缀");
  assert.equal(registrableDomain("192.0.2.1"), "192.0.2.1");
  assert.equal(registrableDomain("localhost"), "localhost");
});

test("认浏览器的网络进程：Chromium 系在包里；Safari 是 WebKit.Networking", () => {
  assert.equal(isBrowserProcess(chromeHelper, chrome), true);
  assert.equal(isBrowserProcess("/Applications/Google Chrome Canary.app/Contents/MacOS/x", chrome), false, "前缀要到包路径为止");
  assert.equal(isBrowserProcess("/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking", safari), true);
  assert.equal(isBrowserProcess("/usr/bin/curl", safari), false);
  assert.equal(isBrowserProcess("", chrome), false);
});

test("当前页面：地址栏的在最前，其余按连接数；只认这个浏览器、只看最近 30 秒", () => {
  const now = 100_000;
  const seen = [
    { host: "github.githubassets.com", process: chromeHelper, at: now - 1000, chains: ["c95s5", "节点选择"], failed: false },
    { host: "avatars.githubusercontent.com", process: chromeHelper, at: now - 2000, chains: [], failed: true },
    { host: "avatars.githubusercontent.com", process: chromeHelper, at: now - 3000, chains: ["direct"], failed: false },
    { host: "api.github.com", process: chromeHelper, at: now - 500, chains: ["direct"], failed: false },
    { host: "old.example.com", process: chromeHelper, at: now - 60_000, chains: [], failed: false },
    { host: "curl.example.com", process: "/usr/bin/curl", at: now - 100, chains: [], failed: false },
  ];
  const domains = pageDomains("github.com", chrome, seen, now);
  assert.deepEqual(
    domains.map((domain) => [domain.domain, domain.isPage, domain.connections, domain.failed, domain.route]),
    [
      ["github.com", true, 1, 0, "direct"],
      ["githubusercontent.com", false, 2, 1, "direct"],
      ["githubassets.com", false, 1, 0, "节点选择"],
    ],
  );
  assert.deepEqual(domains[0].hosts, ["github.com", "api.github.com"]);
  assert.deepEqual(pageDomains("", null, seen, now), [], "没有浏览器也没有地址");
});

test("页面规则：同一个域名再加就是改策略、新的在前；删；坏条目丢掉；子域名命中", () => {
  let rules = upsertPageRule([], { kind: "domain_suffix", value: "GitHub.com", policy: "direct" }, 1);
  rules = upsertPageRule(rules, { kind: "domain_suffix", value: "google.com", policy: "proxy" }, 2);
  rules = upsertPageRule(rules, { kind: "domain_suffix", value: "github.com", policy: "group:Apple" }, 3);
  assert.deepEqual(rules.map((rule) => [rule.id, rule.policy]), [["domain_suffix:github.com", "group:Apple"], ["domain_suffix:google.com", "proxy"]]);
  assert.equal(pageRuleFor(rules, "api.github.com").policy, "group:Apple");
  assert.equal(pageRuleFor(rules, "notgithub.com"), null);
  assert.deepEqual(removePageRule(rules, "domain_suffix:google.com").length, 1);
  assert.deepEqual(normalizePageRules([{ kind: "domain", value: "a.example.com", policy: "direct" }, { kind: "x", value: "b", policy: "direct" }, { kind: "domain", value: "c", policy: "nope" }, "garbage"]).length, 1);
  assert.equal(policyTitle("group:Telegram"), "走「Telegram」");
});

test("编译：相邻同策略并成一条；组不在了退回节点选择", () => {
  const rules = [
    { id: "domain_suffix:a.com", kind: "domain_suffix", value: "a.com", policy: "direct", createdAt: 1 },
    { id: "domain:b.com", kind: "domain", value: "b.com", policy: "direct", createdAt: 1 },
    { id: "domain_suffix:c.com", kind: "domain_suffix", value: "c.com", policy: "reject", createdAt: 1 },
    { id: "domain_suffix:d.com", kind: "domain_suffix", value: "d.com", policy: "group:Gone", createdAt: 1 },
    { id: "domain_suffix:e.com", kind: "domain_suffix", value: "e.com", policy: "proxy", createdAt: 1 },
  ];
  assert.deepEqual(compilePageRules(rules, new Map()), [
    { domain: ["b.com"], domain_suffix: ["a.com"], action: "route", outbound: DIRECT_TAG },
    { domain_suffix: ["c.com"], action: "reject" },
    { domain_suffix: ["d.com"], action: "route", outbound: SELECTOR_TAG },
    { domain_suffix: ["e.com"], action: "route", outbound: SELECTOR_TAG },
  ]);
});
