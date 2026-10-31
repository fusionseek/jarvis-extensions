/**
 * 整个扩展跑在假宿主上：菜单栏域 start 订前台与输入法；菜单里给此刻的应用定规则、当场换过去；切应用按规则换、
 * 闪一枚提示；手动换的记给那个应用、自己切的不记；暂停期间不切；「切回上一个」；工具箱页读写规则。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ABC, PINYIN, extensionRoot, sources } from "./support.mjs";

const { createTestHost } = await import(pathToFileURL(join(extensionRoot, "..", "..", "sdk", "dist", "testing.js")).href);

const granted = ["hud.show", "inputSources.read", "inputSources.select", "system.activity", "apps.read"];
const day = 24 * 60 * 60 * 1000;
const apps = [
  { id: "/Applications/Visual Studio Code.app", name: "Visual Studio Code", bundleId: "com.microsoft.VSCode", category: "public.app-category.developer-tools", lastUsedAt: Date.now() - day },
  { id: "/Applications/WeChat.app", name: "微信", bundleId: "com.tencent.xinWeChat", category: "public.app-category.social-networking", lastUsedAt: Date.now() - 2 * day },
  { id: "/Applications/Feishu.app", name: "飞书", bundleId: "com.bytedance.lark", category: "public.app-category.business", lastUsedAt: Date.now() - 3 * day },
  { id: "/Applications/Old.app", name: "很久没用", bundleId: "com.example.old", category: "public.app-category.developer-tools", lastUsedAt: Date.now() - 90 * day },
];
const storage = new Map();
let preferences = {};
let current = PINYIN;
const selects = [];
const huds = [];
let frontmost = { bundleId: "com.apple.dt.Xcode", name: "Xcode", pid: 11 };
const host = createTestHost({
  async: {
    "storage.get": async (params) => storage.get(params.key) ?? null,
    "storage.set": async (params) => void storage.set(params.key, params.value),
    "preferences.observe": async () => null,
    "preferences.all": async () => preferences,
    "preferences.set": async (params) => void (preferences = { ...preferences, [params.key]: params.value }),
    "inputSources.list": async () => sources,
    "inputSources.current": async () => ({ id: current }),
    "inputSources.select": async (params) => {
      selects.push(params.id);
      current = params.id;
      return { id: params.id, effective: true };
    },
    "inputSources.observe": async () => null,
    "inputSources.unsubscribe": async () => null,
    "frontmostApp.observe": async () => null,
    "frontmostApp.unsubscribe": async () => null,
    "frontmostApp.current": async () => frontmost,
    "hud.show": async (params) => void huds.push(params),
    "commands.run": async () => null,
    "apps.list": async () => apps,
    "apps.icons": async (params) => params.bundleIds.map((bundleId) => ({ bundleId, icon: { id: `icon-${bundleId}`, name: "a.png", byteCount: 1, extension: "png" } })),
    "permissions.request": async (params) => ({ granted: [...granted, ...params.ids], denied: [] }),
  },
});
await import(pathToFileURL(join(extensionRoot, "dist", "extension.js")).href);

const front = async (bundleId, name) => {
  frontmost = { bundleId, name, pid: 20 };
  host.emit(host.subscriptionToken("frontmostApp"), frontmost);
  await host.settle();
};
const selected = async (id, bySelf) => {
  current = id;
  host.emit(host.subscriptionToken("inputSources"), { type: "selected", id, bySelf });
  await host.settle();
};
const command = async (id) => {
  await host.dispatch({ type: "command", context: { id, trigger: "hotkey", granted, preferences, commands: [] } });
  await host.settle();
};

test("start：订前台与输入法；宿主补发的那一条此刻的前台只记下、不切", async () => {
  await host.menuBarEvent("start", { granted, preferences });
  assert.ok(host.subscriptionToken("frontmostApp"));
  assert.ok(host.subscriptionToken("inputSources"));
  await front("com.apple.dt.Xcode", "Xcode");
  assert.deepEqual(selects, [], "启动不替你换掉正在用的输入法");
  const menu = host.menuBarModels.at(-1);
  assert.equal(menu.title, "中");
  assert.equal(menu.items[0].title, "在「Xcode」里用");
});

test("菜单里给 Xcode 选 ABC：存规则、当场换过去、闪一枚带图标的提示", async () => {
  await host.menuBarEvent("select", { itemId: "fixed:0", granted, preferences });
  assert.deepEqual(storage.get("rules"), { "com.apple.dt.Xcode": { mode: "fixed", source: ABC, name: "Xcode" } });
  assert.deepEqual(selects, [ABC]);
  assert.deepEqual(huds.at(-1), { text: "ABC", anchor: "orb", duration: 2000, monogram: "A" }, "默认粘连悬浮球、停 2 秒；系统自带的 ABC 画字标键帽「A」");
  await selected(ABC, true);
});

test("切到没规则的微信：默认不动；在那里手动换成拼音，记给微信", async () => {
  await front("com.tencent.xinWeChat", "微信");
  assert.deepEqual(selects, [ABC]);
  await selected(PINYIN, false);
  assert.deepEqual(storage.get("lastUsed"), { "com.tencent.xinWeChat": PINYIN });
});

test("切回 Xcode：按规则换成 ABC；自己切的那一次不记进「上次用的」", async () => {
  await front("com.apple.dt.Xcode", "Xcode");
  assert.deepEqual(selects, [ABC, ABC]);
  assert.equal(huds.at(-1).text, "ABC");
  await selected(ABC, true);
  assert.deepEqual(storage.get("lastUsed"), { "com.tencent.xinWeChat": PINYIN }, "bySelf 的不记");
});

test("其余应用改成「记住上次」：切回微信换回拼音，提示带拼音的图标", async () => {
  preferences = { ...preferences, others: "remember" };
  host.dispatch({ type: "preferencesChanged", changes: { others: "remember" } });
  host.emit(host.subscriptionToken("preferences"), { others: "remember" });
  await host.settle();
  await front("com.tencent.xinWeChat", "微信");
  assert.equal(selects.at(-1), PINYIN);
  assert.equal(huds.at(-1).text, "微信输入法");
  assert.equal(huds.at(-1).image.id, "icon-pinyin", "三方输入法用它自己的图标");
  assert.equal(huds.at(-1).monogram, undefined);
  await selected(PINYIN, true);
});

test("暂停：偏好写成 true、提示一下；暂停期间切应用不换", async () => {
  await command("pause");
  assert.equal(preferences.paused, true);
  assert.equal(huds.at(-1).text, "自动切换已暂停");
  const before = selects.length;
  await front("com.apple.dt.Xcode", "Xcode");
  assert.equal(selects.length, before);
  assert.equal(host.menuBarModels.at(-1).symbol, "keyboard.badge.ellipsis");
  await command("pause");
  assert.equal(preferences.paused, false);
});

test("切回上一个：在此刻与上一个之间来回", async () => {
  // 此刻是拼音（暂停期间没换），上一个是 ABC。
  await command("previous");
  assert.equal(selects.at(-1), ABC);
});

test("把此刻的输入法定给当前应用", async () => {
  await front("com.apple.Notes", "备忘录");
  current = PINYIN;
  await selected(PINYIN, false);
  await command("remember-here");
  assert.deepEqual(storage.get("rules")["com.apple.Notes"], { mode: "fixed", source: PINYIN, name: "备忘录" });
  assert.equal(huds.at(-1).text, "备忘录 用 微信输入法");
});

const press = async (node, index = 0) => {
  host.dispatch({ type: "ui", handler: node.props.actions[index].on.press, payload: {} });
  await host.settle();
};
const openPage = async () => {
  host.dispatch({ type: "activate", context: { surface: "toolbox", entry: "toolbox", granted, preferences, commands: [] } });
  await host.settle();
};

test("工具箱页·此刻：一张青色条的卡，一行四枚（两个输入法 + 记住上次 + 无规则）等宽排开；点「无规则」删掉规则", async () => {
  frontmost = { bundleId: "com.apple.dt.Xcode", name: "Xcode", pid: 11 };
  await openPage();
  const nowCard = host.find((node) => node.kind === "card" && node.key === "card:now");
  assert.equal(nowCard.props.tint, "accent");
  assert.equal(nowCard.props.stripe, true);
  const grid = host.find((node) => node.kind === "grid" && node.key === "now:choices");
  assert.deepEqual(
    grid.children.map((chip) => chip.key),
    [`now:fixed:${ABC}`, `now:fixed:${PINYIN}`, "now:remember", "now:none"],
    "合并之后四枚，352 宽的卡里一行放得下（最小列宽 80）",
  );
  assert.equal(grid.props.minimum, 80);
  assert.equal(host.find((node) => node.kind === "chip" && node.key === `now:fixed:${ABC}`).props.selected, true);
  assert.equal(host.find((node) => node.kind === "chip" && node.key === "now:none").props.title, "无规则");
  await host.fire(host.find((node) => node.kind === "chip" && node.key === "now:none"), "press");
  assert.ok(!("com.apple.dt.Xcode" in storage.get("rules")), "无规则 = 没有规则");
  assert.equal(host.find((node) => node.kind === "row" && node.key === "now:app").props.subtitle, "无规则 · 记住上次用的", "说它此刻跟着哪一档");
  await host.fire(host.find((node) => node.kind === "chip" && node.key === `now:fixed:${ABC}`), "press");
});

test("工具箱页·此刻：刷新重读前台应用与此刻输入法", async () => {
  frontmost = { bundleId: "com.tencent.xinWeChat", name: "微信", pid: 30 };
  current = PINYIN;
  await press(host.find((node) => node.kind === "section" && node.key === "now"));
  assert.equal(host.find((node) => node.kind === "row" && node.key === "now:app").props.title, "微信");
  assert.equal(host.find((node) => node.kind === "section" && node.key === "now").props.trailing, "正在用 微信输入法");
  frontmost = { bundleId: "com.apple.dt.Xcode", name: "Xcode", pid: 11 };
  await press(host.find((node) => node.kind === "section" && node.key === "now"));
});

test("工具箱页·分组：每个输入法一张卡（空的也画），各一种色条；没有「不管它」；最后一张「无规则的应用」不带色条", async () => {
  const abc = host.find((node) => node.kind === "card" && node.key === `card:group:fixed:${ABC}`);
  const pinyin = host.find((node) => node.kind === "card" && node.key === `card:group:fixed:${PINYIN}`);
  assert.deepEqual([abc.props.tint, pinyin.props.tint], ["blue", "violet"], "按系统输入法菜单的顺序轮流取");
  assert.equal(abc.props.stripe, true);
  assert.equal(host.find((node) => node.key === "group:ignore"), undefined);
  const others = host.find((node) => node.kind === "card" && node.key === "card:others");
  assert.equal(others.props.stripe, undefined);
  assert.equal(host.find((node) => node.kind === "section" && node.key === "others").props.title, "无规则的应用 · OTHERS");
  assert.equal(host.find((node) => node.kind === "preference" && node.key === "others").props.preference, "others");
});

test("工具箱页·推荐：开发工具 → ABC、社交 → 中文；一个月没用的不推；全部添加之后卡片不再出现", async () => {
  const note = host.find((node) => node.kind === "note" && node.key === "suggestions");
  assert.ok(note, "有推荐卡");
  assert.match(note.props.body, /Visual Studio Code → ABC/);
  assert.match(note.props.body, /微信 → 微信输入法/);
  assert.doesNotMatch(note.props.body, /很久没用|飞书/);
  await press(note, 0);
  assert.equal(storage.get("rules")["com.microsoft.VSCode"].source, ABC);
  assert.equal(storage.get("rules")["com.tencent.xinWeChat"].source, PINYIN);
  assert.equal(storage.get("suggestionsDismissed"), true);
  assert.equal(host.find((node) => node.kind === "note" && node.key === "suggestions"), undefined);
});

test("工具箱页·自己加：点「用 ABC」的 +，挑飞书；回到分组页，飞书落在 ABC 组且点亮", async () => {
  await press(host.find((node) => node.kind === "section" && node.key === `group:fixed:${ABC}`));
  const feishu = host.find((node) => node.kind === "row" && node.key === "app:com.bytedance.lark");
  assert.ok(feishu, "加应用那一步列出装着的应用");
  assert.equal(feishu.props.image.id, "icon-com.bytedance.lark", "带图标");
  const wechat = host.find((node) => node.kind === "row" && node.key === "app:com.tencent.xinWeChat");
  assert.equal(wechat.props.subtitle, "现在：用 微信输入法", "已经有规则的写着它在哪一组");
  await host.fire(feishu, "press");
  assert.deepEqual(storage.get("rules")["com.bytedance.lark"], { mode: "fixed", source: ABC, name: "飞书" });
  const row = host.find((node) => node.kind === "row" && node.key === "rule:com.bytedance.lark");
  assert.equal(row.props.selected, true, "刚加的那一行点亮");
});

test("工具箱页·搜索：在全部里按名字找", async () => {
  await press(host.find((node) => node.kind === "section" && node.key === `group:fixed:${PINYIN}`));
  await host.fire(host.find((node) => node.kind === "search" && node.key === "add:search"), "change", "很久");
  assert.ok(host.find((node) => node.kind === "row" && node.key === "app:com.example.old"));
  assert.equal(host.find((node) => node.kind === "row" && node.key === "app:com.bytedance.lark"), undefined);
  await host.fire(host.find((node) => node.kind === "row" && node.key === "add:back"), "press");
  assert.ok(host.find((node) => node.kind === "section" && node.key === "now"), "返回分组页");
});

test("工具箱页·换组与删除：点一行展开「换成」，一点挪组；× 删掉", async () => {
  await host.fire(host.find((node) => node.kind === "row" && node.key === "rule:com.bytedance.lark"), "press");
  const move = host.find((node) => node.kind === "chip" && node.key === `rule:com.bytedance.lark:fixed:${PINYIN}`);
  assert.ok(move, "展开了「换成」");
  assert.equal(host.find((node) => node.kind === "chip" && node.key === `rule:com.bytedance.lark:fixed:${ABC}`), undefined, "不列它此刻所在的那一组");
  await host.fire(move, "press");
  assert.equal(storage.get("rules")["com.bytedance.lark"].source, PINYIN);
  await press(host.find((node) => node.kind === "row" && node.key === "rule:com.bytedance.lark"));
  assert.ok(!("com.bytedance.lark" in storage.get("rules")));
});

test("上一版存下的「不管它」读出来当作无规则：页面上不出现、也不再挡住「无规则的应用」那一档", async () => {
  storage.set("rules", { ...storage.get("rules"), "com.valvesoftware.steam": { mode: "ignore", name: "Steam" } });
  await openPage();
  assert.equal(host.find((node) => node.kind === "row" && node.key === "rule:com.valvesoftware.steam"), undefined);
  // 「无规则的应用」此刻是「记住上次」：Steam 不再被「不管它」挡住，按记下的换。
  await front("com.valvesoftware.steam", "Steam");
  await selected(ABC, false);
  await front("com.tencent.xinWeChat", "微信");
  await front("com.valvesoftware.steam", "Steam");
  assert.equal(selects.at(-1), ABC);
});

test("提示位置选「悬浮球旁」：锚点 orb、停 2 秒，图标照给（宿主把它放进球心）", async () => {
  preferences = { ...preferences, hudAnchor: "orb" };
  host.dispatch({ type: "preferencesChanged", changes: { hudAnchor: "orb" } });
  // 页面与后台各订了一份偏好：宿主对每一份都推。
  const tokens = host.invocations.filter((entry) => entry.namespace === "preferences" && entry.method === "observe").map((entry) => entry.params.token);
  for (const token of new Set(tokens)) host.emit(token, { hudAnchor: "orb" });
  await host.settle();
  await selected(PINYIN, false);
  await front("com.apple.dt.Xcode", "Xcode");
  assert.equal(selects.at(-1), ABC);
  const hud = huds.at(-1);
  assert.equal(hud.anchor, "orb");
  assert.equal(hud.duration, 2000);
  assert.equal(hud.text, "ABC");
  assert.equal(hud.monogram, "A", "球心画字标键帽，不用系统那枚浅底图标");
  assert.equal(hud.image, undefined);
});
