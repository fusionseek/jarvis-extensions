/**
 * 网站规则的纯函数（jarvis-mac specs/20261030-234919-input-source-site-rules S-2）：规范化、匹配（子域、按段对齐的路径、最长优先）、
 * 与应用规则的优先级、分组、菜单里网站那一段。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ABC, PINYIN, loadModel, sources } from "./support.mjs";

const model = await loadModel();
const enabled = [ABC, PINYIN];
const settings = (overrides = {}) => ({ ...model.defaultSettings, ...overrides });
const CHROME = "com.google.Chrome";

test("normalizePattern：去协议、www、端口、查询、片段、结尾斜杠，主机名小写、路径保留大小写", () => {
  assert.equal(model.normalizePattern("https://www.GitHub.com/"), "github.com");
  assert.equal(model.normalizePattern("  github.com  "), "github.com");
  assert.equal(model.normalizePattern("http://localhost:3000/app?x=1#top"), "localhost/app");
  assert.equal(model.normalizePattern("docs.google.com/spreadsheets/"), "docs.google.com/spreadsheets");
  assert.equal(model.normalizePattern("https://Example.com/Wiki/Page"), "example.com/Wiki/Page");
  assert.equal(model.normalizePattern("*.yuque.com"), "yuque.com", "通配写法收成主机名（本来就管子域）");
  assert.equal(model.normalizePattern("user:pw@git.example.com/x"), "git.example.com/x");
  for (const bad of ["", "   ", "http://", "not a host", "-bad.com", "a..b", "中文.com"]) {
    assert.equal(model.normalizePattern(bad), undefined, JSON.stringify(bad));
  }
});

test("matchSite：子域命中、路径按段对齐、最长优先、只认 http(s)", () => {
  const sites = [
    { pattern: "github.com", source: ABC },
    { pattern: "google.com", source: PINYIN },
    { pattern: "docs.google.com/spreadsheets", source: ABC },
  ];
  assert.equal(model.matchSite("https://github.com/fusionseek", sites)?.pattern, "github.com");
  assert.equal(model.matchSite("https://gist.github.com/x", sites)?.pattern, "github.com", "子域");
  assert.equal(model.matchSite("https://notgithub.com/", sites), undefined, "后缀不在点上不算");
  assert.equal(model.matchSite("https://www.github.com/", sites)?.pattern, "github.com");
  assert.equal(model.matchSite("https://docs.google.com/spreadsheets/d/1", sites)?.pattern, "docs.google.com/spreadsheets", "最长的那条赢");
  assert.equal(model.matchSite("https://docs.google.com/spreadsheets", sites)?.pattern, "docs.google.com/spreadsheets");
  assert.equal(model.matchSite("https://docs.google.com/spreadsheetsX/1", sites)?.pattern, "google.com", "路径按段对齐");
  assert.equal(model.matchSite("https://docs.google.com/document/d/1", sites)?.pattern, "google.com");
  assert.equal(model.matchSite("chrome://settings", sites), undefined);
  assert.equal(model.matchSite("file:///Users/a/github.com", sites), undefined);
});

test("resolveTarget：网站规则比应用规则优先，但只在那个浏览器就是前台时", () => {
  const memory = {
    rules: { [CHROME]: { mode: "fixed", source: PINYIN, name: "Chrome" } },
    lastUsed: {},
    sites: [{ pattern: "github.com", source: ABC }],
  };
  const page = { bundleId: CHROME, url: "https://github.com/a" };
  assert.equal(model.resolveTarget(CHROME, memory, settings(), enabled, page), ABC);
  assert.equal(model.resolveTarget(CHROME, memory, settings(), enabled, { bundleId: CHROME, url: "https://example.com" }), PINYIN, "没命中网站：按应用");
  assert.equal(model.resolveTarget(CHROME, memory, settings(), enabled), PINYIN, "不知道哪一页：按应用");
  assert.equal(model.resolveTarget("com.apple.Safari", memory, settings(), enabled, page), undefined, "页面属于别的浏览器：不看");
  const stale = { ...memory, sites: [{ pattern: "github.com", source: "com.apple.keylayout.US" }] };
  assert.equal(model.resolveTarget(CHROME, stale, settings(), enabled, page), PINYIN, "网站规则的输入法停用了：落回应用规则");
});

test("setSite：同一个 pattern 只留一条、删除、上限", () => {
  let sites = model.setSite([], "github.com", ABC);
  sites = model.setSite(sites, "github.com", PINYIN);
  assert.deepEqual(sites, [{ pattern: "github.com", source: PINYIN }]);
  assert.deepEqual(model.setSite(sites, "github.com", undefined), []);
  const full = Array.from({ length: model.maximumSites }, (_, index) => ({ pattern: `s${index}.com`, source: ABC }));
  assert.equal(model.setSite(full, "new.com", ABC).length, model.maximumSites, "满了不加新的");
  assert.equal(model.setSite(full, "s0.com", PINYIN).find((site) => site.pattern === "s0.com").source, PINYIN, "满了也能改已有的");
});

test("sitePatternFor：已经命中一条就改那一条，否则用主机名", () => {
  const sites = [{ pattern: "docs.google.com/spreadsheets", source: ABC }];
  assert.equal(model.sitePatternFor("https://docs.google.com/spreadsheets/d/1", sites), "docs.google.com/spreadsheets");
  assert.equal(model.sitePatternFor("https://www.docs.google.com/document", sites), "docs.google.com");
  assert.equal(model.sitePatternFor("chrome://newtab", sites), undefined);
});

test("groupRules：网站跟着输入法分组，停用的单独一组", () => {
  const sites = [
    { pattern: "yuque.com", source: PINYIN },
    { pattern: "github.com", source: ABC },
    { pattern: "old.com", source: "com.apple.keylayout.US" },
  ];
  const groups = model.groupRules({}, sources, sites);
  assert.deepEqual(groups.find((group) => group.key === `fixed:${ABC}`).sites.map((site) => site.pattern), ["github.com"]);
  assert.deepEqual(groups.find((group) => group.key === `fixed:${PINYIN}`).sites.map((site) => site.pattern), ["yuque.com"]);
  assert.deepEqual(groups.find((group) => group.key === "stale").sites.map((site) => site.pattern), ["old.com"]);
  assert.equal(model.groupRules({}, sources).find((group) => group.key === "stale"), undefined, "没有停用的就没有那一组");
});

test("menuModel：前台浏览器有页面时多一段「在 github.com 上用」", () => {
  const sites = [{ pattern: "github.com", source: ABC }];
  const menu = model.menuModel({
    app: { bundleId: CHROME, name: "Chrome" },
    page: { bundleId: CHROME, url: "https://gist.github.com/x" },
    sites,
    rules: {},
    sources,
    currentId: ABC,
    settings: settings(),
  });
  const header = menu.items.find((item) => item.kind === "header" && item.title.includes("github.com"));
  assert.equal(header.title, "在「github.com」上用", "命中的那条，不是 gist.github.com");
  assert.equal(menu.items.find((item) => item.id === model.siteItemID(0)).checked, true);
  assert.equal(menu.items.find((item) => item.id === "site:none").checked, false);
  assert.deepEqual(model.siteChoiceFromMenuItem(model.siteItemID(1), sources), { source: PINYIN });
  assert.deepEqual(model.siteChoiceFromMenuItem("site:none", sources), { source: undefined });
  assert.equal(model.siteChoiceFromMenuItem("fixed:0", sources), undefined);
  assert.equal(model.choiceFromMenuItem("site:0", sources), undefined, "应用那一段不认网站的项");

  const plain = model.menuModel({ app: { bundleId: CHROME, name: "Chrome" }, rules: {}, sources, currentId: ABC, settings: settings() });
  assert.equal(plain.items.some((item) => item.id === "site:none"), false, "不知道哪一页：没有网站那一段");
});
