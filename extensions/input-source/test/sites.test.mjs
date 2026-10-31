/**
 * 网站规则跑在假宿主上（jarvis-mac specs/20261030-234919-input-source-site-rules S-2 / S-3）：有网站规则才订当前页；
 * 订阅时补发的那一页不切；切回浏览器用缓存的上一页；换了页、决定出来的目标变了才切，手动换了的不换回去；
 * 菜单里给此刻这一页定输入法；工具箱页「此刻」卡的当前页、「网站」卡（jarvis-mac specs/20261031-080909-input-source-walkthrough-fixes W-3）与「加网站」那一步。单独一个文件：要一个干净的假宿主。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ABC, PINYIN, extensionRoot, sources } from "./support.mjs";

const { createTestHost } = await import(pathToFileURL(join(extensionRoot, "..", "..", "sdk", "dist", "testing.js")).href);

const CHROME = { bundleId: "com.google.Chrome", name: "Google Chrome", pid: 3 };
const WARP = { bundleId: "dev.warp.Warp-Stable", name: "Warp", pid: 1 };
const base = ["hud.show", "inputSources.read", "inputSources.select", "system.activity", "apps.read"];
let granted = [...base, "browser.activeTab", "browser.activeTab.watch"];
const storage = new Map([["rules", { [CHROME.bundleId]: { mode: "fixed", source: PINYIN, name: "Chrome" } }]]);
let current = PINYIN;
let frontmost = CHROME;
let activeTab = null;
const selects = [];
const host = createTestHost({
  async: {
    "storage.get": async (params) => storage.get(params.key) ?? null,
    "storage.set": async (params) => void storage.set(params.key, params.value),
    "preferences.observe": async () => null,
    "preferences.all": async () => ({}),
    "inputSources.list": async () => sources,
    "inputSources.current": async () => ({ id: current }),
    "inputSources.select": async (params) => {
      selects.push(params.id);
      current = params.id;
      return { id: params.id, effective: true };
    },
    "inputSources.observe": async () => null,
    "frontmostApp.observe": async () => null,
    "frontmostApp.current": async () => frontmost,
    "browser.watchActiveTab": async () => null,
    "browser.unsubscribe": async () => null,
    "browser.activeTab": async () => activeTab,
    "hud.show": async () => null,
    "apps.list": async () => [],
    "apps.icons": async () => [],
    "permissions.request": async (params) => {
      granted = [...new Set([...granted, ...params.ids])];
      return { granted, denied: [] };
    },
  },
});
await import(pathToFileURL(join(extensionRoot, "dist", "extension.js")).href);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchToken = () => host.subscriptionToken("browser", "watchActiveTab");
const tab = (url, browser = CHROME) => ({
  browser: { bundleId: browser.bundleId, name: browser.name, path: `/Applications/${browser.name}.app` },
  frontmost: true,
  status: "ok",
  url,
  title: url,
});
const front = async (app) => {
  frontmost = app;
  host.emit(host.subscriptionToken("frontmostApp"), app);
  await host.settle();
};
const page = async (url, browser = CHROME) => {
  host.emit(watchToken(), tab(url, browser));
  await host.settle();
};
const unsubscribes = () => host.invocations.filter((call) => call.namespace === "browser" && call.method === "unsubscribe").length;

test("没有网站规则：有授权也不订当前页", async () => {
  await host.menuBarEvent("start", { granted, preferences: {} });
  assert.equal(watchToken(), undefined, "没有网站规则的人不付这份代价");
});

test("有网站规则：启动时订上；订阅时补发的那一页只记下、不切", async () => {
  storage.set("sites", [{ pattern: "github.com", source: ABC }]);
  // 用户在页面里刚加了第一条网站规则：后台在下一次换前台时订上；先模拟一次授权变化让后台重读。
  host.dispatch({ type: "permissionsChanged", granted });
  await host.settle();
  assert.ok(watchToken(), "订上了");
  host.emit(host.subscriptionToken("frontmostApp"), CHROME);
  await host.settle();
  await page("https://github.com/fusionseek");
  assert.deepEqual(selects, [], "启动、刚允许时补发的那一条不替你换");
});

test("切回浏览器：用缓存的上一页当场对上，网站规则比应用规则优先", async () => {
  await front(WARP);
  await front(CHROME);
  assert.deepEqual(selects, [ABC], "Chrome 的应用规则是拼音，但这一页在 github.com 上");
  assert.equal(current, ABC);
});

test("换了页：决定变了才切；同一个决定不切；手动换了的不换回去", async () => {
  selects.length = 0;
  await page("https://example.com/");
  assert.deepEqual(selects, [PINYIN], "离开 github.com：落回 Chrome 的应用规则");
  await page("https://example.com/other");
  assert.deepEqual(selects, [PINYIN], "还是拼音：不切");

  // 用户在这一页上手动换成 ABC。
  current = ABC;
  host.emit(host.subscriptionToken("inputSources"), { type: "selected", id: ABC, bySelf: false });
  await host.settle();
  await page("https://example.com/third");
  assert.equal(current, ABC, "决定没变（还是拼音）：不和用户打架");

  await page("https://gist.github.com/x");
  await sleep(350);
  await host.settle();
  assert.deepEqual(selects, [PINYIN], "到了 github：目标 ABC，此刻已经是 ABC，不再调一次");
});

test("别的浏览器推来的页（读的时候用户切走了）不算", async () => {
  selects.length = 0;
  await page("https://github.com/", { bundleId: "com.apple.Safari", name: "Safari" });
  await page("https://example.com/", { bundleId: "com.apple.Safari", name: "Safari" });
  assert.deepEqual(selects, []);
});

test("菜单：前台浏览器有页面时，给这一页定输入法；最后一条删掉就退订", async () => {
  await page("https://github.com/fusionseek");
  await host.menuBarEvent("open", { granted, preferences: {} });
  assert.ok(host.menuItem("site:none"), "有网站那一段");
  await host.menuBarEvent("select", { itemId: "site:1", granted, preferences: {} });
  assert.deepEqual(storage.get("sites"), [{ pattern: "github.com", source: PINYIN }]);
  assert.equal(current, PINYIN, "当场换过去");

  const before = unsubscribes();
  await host.menuBarEvent("select", { itemId: "site:none", granted, preferences: {} });
  assert.deepEqual(storage.get("sites"), []);
  assert.equal(unsubscribes(), before + 1, "没有网站规则了：退订");
  assert.equal(host.latestMenuBar.items.some((item) => item.id === "site:none"), false, "缓存一起清掉");
});

test("菜单：没订着当前页时，点开菜单读一次——第一条网站规则也能从菜单里定", async () => {
  activeTab = tab("https://www.yuque.com/doc/1");
  await host.menuBarEvent("open", { granted, preferences: {} });
  assert.match(host.menuItem("site:none") ? "ok" : "", /ok/);
  await host.menuBarEvent("select", { itemId: "site:0", granted, preferences: {} });
  assert.deepEqual(storage.get("sites"), [{ pattern: "yuque.com", source: ABC }]);
  assert.ok(watchToken(), "第一条：订上");
});

const openPage = async (pageGranted = granted) => {
  host.dispatch({ type: "activate", context: { surface: "toolbox", entry: "toolbox", granted: pageGranted, preferences: {}, commands: [] } });
  await host.settle();
};
const byKey = (key) => host.find((node) => node.key === key);

test("工具箱页·网站卡总在：前台不是浏览器、也还没允许读地址（W-3）", async () => {
  frontmost = WARP;
  activeTab = null;
  await openPage(base);
  assert.equal(byKey("now:site"), undefined, "前台不是浏览器：此刻卡上没有网站那一行");
  const section = byKey("sites");
  assert.equal(section.props.title, "网站 · WEBSITES");
  assert.deepEqual(
    section.props.actions.map((action) => [action.id, action.title, action.symbol]),
    [["addSite", "添加网站", undefined]],
    "文字动作，不是一枚地球",
  );
  assert.equal(byKey(`group:fixed:${PINYIN}`).props.actions.some((action) => action.id === "addSite"), false, "分组卡上不再有地球");
  const cards = host.find((node) => node.key === "content").children.map((node) => node.key);
  assert.ok(cards.indexOf("card:sites") > cards.indexOf(`card:group:fixed:${PINYIN}`), "在各输入法分组之后");
  assert.equal(cards.at(-1), "card:others", "「无规则的应用」仍在最后");
});

test("工具箱页·此刻：前台是浏览器时多一行当前页，一点即定这个网站", async () => {
  frontmost = CHROME;
  activeTab = tab("https://github.com/fusionseek");
  await openPage();
  const row = byKey("now:site");
  assert.equal(row.props.title, "github.com");
  assert.equal(row.props.subtitle, "这个网站没有规则，跟着应用的");
  const grid = byKey("now:site:choices");
  assert.deepEqual(grid.children.map((chip) => chip.key), [`now:site:fixed:${ABC}`, `now:site:fixed:${PINYIN}`, "now:site:none"], "网站上没有「记住上次」");
  assert.equal(byKey("now:site:none").props.selected, true);
  await host.fire(byKey(`now:site:fixed:${ABC}`), "press");
  assert.deepEqual(storage.get("sites").find((site) => site.pattern === "github.com"), { pattern: "github.com", source: ABC });
  assert.equal(byKey("now:site").props.subtitle, "网站规则 · 用 ABC");
  assert.equal(byKey("site:github.com").props.subtitle, "用 ABC · 此刻在看", "列在网站卡里");
  assert.match(byKey("sites").props.trailing, /^\d+ 个网站$/);
  assert.equal(byKey(`group:fixed:${ABC}`).props.trailing, "0 个应用", "分组卡只数应用");
});

test("工具箱页·加网站：网站卡头「添加网站」进那一步，先选输入法（默认此刻在用的），填网址规范化后添加", async () => {
  current = ABC;
  await openPage();
  const section = byKey("sites");
  host.dispatch({ type: "ui", handler: section.props.actions[0].on.press, payload: {} });
  await host.settle();
  assert.ok(byKey("addSite:field"), "进了加网站那一步");
  assert.equal(byKey("addSite:access"), undefined, "两项授权都有：不提示");
  assert.equal(byKey("addSite:current").props.title, "github.com", "此刻这一页一点即填");
  assert.deepEqual(byKey("addSite:choices").children.map((chip) => chip.key), [`addSite:fixed:${ABC}`, `addSite:fixed:${PINYIN}`], "只有输入法，没有「跟随应用」");
  assert.equal(byKey(`addSite:fixed:${ABC}`).props.selected, true, "默认选此刻正在用的那一个");
  await host.fire(byKey(`addSite:fixed:${PINYIN}`), "press");
  assert.equal(byKey(`addSite:fixed:${PINYIN}`).props.selected, true);

  await host.fire(byKey("addSite:field"), "change", "not a host");
  assert.ok(byKey("addSite:invalid"));
  await host.fire(byKey("addSite:field"), "change", "https://www.Notion.so/team/");
  assert.equal(byKey("addSite:add").props.title, "添加 notion.so/team");
  await host.fire(byKey("addSite:add"), "press");
  assert.deepEqual(storage.get("sites").find((site) => site.pattern === "notion.so/team"), { pattern: "notion.so/team", source: PINYIN });
  assert.equal(byKey("site:notion.so/team").props.subtitle, "用 微信输入法", "回到分组页，在网站卡里，用选中的拼音");
  assert.equal(byKey("site:notion.so/team").props.selected, true, "刚加的那一行点亮");
});

test("工具箱页·网站行：点开换成别的、× 删除", async () => {
  await host.fire(byKey("site:notion.so/team"), "press");
  assert.ok(byKey("site:notion.so/team:choices"));
  await host.fire(byKey(`site:notion.so/team:fixed:${ABC}`), "press");
  assert.equal(storage.get("sites").find((site) => site.pattern === "notion.so/team").source, ABC);
  const row = byKey("site:notion.so/team");
  host.dispatch({ type: "ui", handler: row.props.actions[0].on.press, payload: {} });
  await host.settle();
  assert.equal(storage.get("sites").some((site) => site.pattern === "notion.so/team"), false);
});
