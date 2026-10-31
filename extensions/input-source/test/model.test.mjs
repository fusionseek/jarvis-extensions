/**
 * 纯函数：决定切到哪一个、记住上次、规则的增删与说明、菜单栏模型。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ABC, PINYIN, loadModel, sources } from "./support.mjs";

const model = await loadModel();
const enabled = [ABC, PINYIN];
const settings = (overrides = {}) => ({ ...model.defaultSettings, ...overrides });

test("resolveTarget：固定规则、记住上次", () => {
  const memory = {
    rules: {
      "com.apple.dt.Xcode": { mode: "fixed", source: ABC, name: "Xcode" },
      "com.tencent.xinWeChat": { mode: "remember", name: "微信" },
    },
    lastUsed: { "com.tencent.xinWeChat": PINYIN, "com.apple.Terminal": PINYIN },
  };
  assert.equal(model.resolveTarget("com.apple.dt.Xcode", memory, settings(), enabled), ABC);
  assert.equal(model.resolveTarget("com.tencent.xinWeChat", memory, settings(), enabled), PINYIN);
  assert.equal(model.resolveTarget("com.apple.Terminal", memory, settings(), enabled), undefined, "无规则 + 默认「不动」：不动");
  const fresh = { rules: { "com.tencent.xinWeChat": { mode: "remember", name: "微信" } }, lastUsed: {} };
  assert.equal(model.resolveTarget("com.tencent.xinWeChat", fresh, settings(), enabled), undefined, "记住上次而从没记过：不动");
});

test("resolveTarget：无规则的应用按偏好", () => {
  const memory = { rules: {}, lastUsed: { "com.apple.Notes": PINYIN }, fallbackSource: ABC };
  assert.equal(model.resolveTarget("com.apple.Notes", memory, settings(), enabled), undefined, "默认不动");
  assert.equal(model.resolveTarget("com.apple.Notes", memory, settings({ others: "remember" }), enabled), PINYIN);
  assert.equal(model.resolveTarget("com.apple.Notes", memory, settings({ others: "default" }), enabled), ABC);
  assert.equal(model.resolveTarget("com.apple.Notes", { rules: {}, lastUsed: {} }, settings({ others: "default" }), enabled), undefined, "没定默认输入法：不动");
});

test("resolveTarget：目标已经停用就不动", () => {
  const memory = { rules: { "com.apple.dt.Xcode": { mode: "fixed", source: "com.apple.keylayout.US", name: "Xcode" } }, lastUsed: {} };
  assert.equal(model.resolveTarget("com.apple.dt.Xcode", memory, settings(), enabled), undefined);
});

test("remember：同一个不重写、最近的放最后、超过上限丢最旧的", () => {
  const first = model.remember({}, "a", ABC);
  assert.deepEqual(first, { a: ABC });
  assert.equal(model.remember(first, "a", ABC), first, "没变时原样交回，调用方省一次写库");
  assert.deepEqual(Object.keys(model.remember({ a: ABC, b: ABC }, "a", PINYIN)), ["b", "a"]);
  let many = {};
  for (let index = 0; index < model.maximumRemembered + 5; index += 1) many = model.remember(many, `app${index}`, ABC);
  assert.equal(Object.keys(many).length, model.maximumRemembered);
  assert.ok(!("app0" in many), "最旧的先丢");
});

test("规则与选择器的值互转；无规则 = 删掉；上一版的「不管它」不再认", () => {
  assert.equal(model.ruleChoice(undefined), "none");
  assert.equal(model.ruleChoice({ mode: "fixed", source: ABC, name: "Xcode" }), `fixed:${ABC}`);
  assert.deepEqual(model.ruleFromChoice(`fixed:${PINYIN}`, "微信"), { mode: "fixed", source: PINYIN, name: "微信" });
  assert.equal(model.ruleFromChoice("none", "微信"), undefined);
  assert.equal(model.ruleFromChoice("ignore", "微信"), undefined, "「不管它」合进了无规则");
  assert.equal(model.choiceFromMenuItem("ignore", sources), undefined, "菜单里也没有了");
  const rules = model.setRule({}, "x", { mode: "remember", name: "X" });
  assert.deepEqual(model.setRule(rules, "x", undefined), {});
});

test("setRule：到上限就不再加新的，改旧的照常", () => {
  let rules = {};
  for (let index = 0; index < model.maximumRules; index += 1) rules = model.setRule(rules, `app${index}`, { mode: "remember", name: `${index}` });
  assert.equal(model.setRule(rules, "new", { mode: "remember", name: "new" }), rules);
  assert.equal(model.setRule(rules, "app1", { mode: "fixed", source: ABC, name: "1" }).app1.mode, "fixed");
});

test("isSystemSource：com.apple. 开头的是系统自带（画字标），其余是三方（用自己的图标）", () => {
  assert.equal(model.isSystemSource(sources[0]), true, "ABC");
  assert.equal(model.isSystemSource({ id: "com.apple.inputmethod.SCIM.ITABC", name: "简体拼音", kind: "inputMode", languages: ["zh-Hans"] }), true);
  assert.equal(model.isSystemSource(sources[1]), false, "微信输入法");
});

test("shortLabel：中文「中」、繁体「繁」、日文「あ」，其余取首字母", () => {
  assert.equal(model.shortLabel(sources[1]), "中");
  assert.equal(model.shortLabel(sources[0]), "A");
  assert.equal(model.shortLabel({ id: "x", name: "繁体拼音", kind: "inputMode", languages: ["zh-Hant"] }), "繁");
  assert.equal(model.shortLabel({ id: "k", name: "Kotoeri", kind: "inputMode", languages: ["ja"] }), "あ");
  assert.equal(model.shortLabel(undefined), "");
});

test("菜单：给此刻的应用单选一个；菜单项按序号引用输入法", () => {
  const menu = model.menuModel({
    app: { bundleId: "com.apple.dt.Xcode", name: "Xcode" },
    rules: { "com.apple.dt.Xcode": { mode: "fixed", source: PINYIN, name: "Xcode" } },
    sources,
    currentId: PINYIN,
    settings: settings(),
  });
  assert.equal(menu.title, "中");
  assert.equal(menu.symbol, "keyboard");
  const checked = menu.items.filter((item) => item.kind === "item" && item.checked).map((item) => item.id);
  assert.deepEqual(checked, ["fixed:1"]);
  for (const item of menu.items) if (item.kind === "item") assert.match(item.id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, "菜单项 id 合 bridge 的格式");
  assert.equal(model.choiceFromMenuItem("fixed:1", sources), `fixed:${PINYIN}`);
  assert.equal(model.choiceFromMenuItem("fixed:9", sources), undefined);
  assert.equal(model.choiceFromMenuItem("pause", sources), "pause");
  const ids = menu.items.filter((item) => item.kind === "item").map((item) => item.id);
  assert.deepEqual(ids, ["fixed:0", "fixed:1", "remember", "none", "pause"], "「不管它」「不写规则」合成一项「无规则」");
  assert.equal(menu.items.find((item) => item.id === "none").title, "无规则");
  assert.equal(menu.items.find((item) => item.id === "none").subtitle, "跟着「无规则的应用」：不动");
});

test("菜单：暂停时图标换一枚、短字可以关掉；没有前台应用时只剩暂停", () => {
  const menu = model.menuModel({ rules: {}, sources, currentId: ABC, settings: settings({ paused: true, menuBarLabel: false }) });
  assert.equal(menu.symbol, "keyboard.badge.ellipsis");
  assert.equal(menu.title, undefined);
  assert.deepEqual(menu.items.map((item) => item.id), ["pause"]);
  assert.equal(menu.items[0].checked, true);
});

test("readSettings：不认识的值退回默认；提示位置只剩悬浮球与屏幕两档（默认悬浮球），旧的三档读作默认", () => {
  assert.equal(model.defaultSettings.hudAnchor, "orb");
  assert.deepEqual(model.readSettings({ others: "weird", hud: "yes", hudAnchor: "screen" }), { ...model.defaultSettings, hudAnchor: "screen" });
  for (const old of ["caret", "window", "pointer"]) assert.equal(model.readSettings({ hudAnchor: old }).hudAnchor, "orb", old);
});

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 30);
const app = (name, bundleId, category, daysAgo) => ({ id: `/Applications/${name}.app`, name, bundleId, category, lastUsedAt: daysAgo === null ? null : now - daysAgo * day });

test("groupRules：每个输入法一组（空的也给）、有内容才给记住上次、停用的单独一组", () => {
  const groups = model.groupRules(
    {
      b: { mode: "fixed", source: ABC, name: "终端" },
      a: { mode: "fixed", source: ABC, name: "Xcode" },
      c: { mode: "remember", name: "游戏" },
      d: { mode: "fixed", source: "com.apple.keylayout.US", name: "旧的" },
    },
    sources,
  );
  assert.deepEqual(groups.map((group) => group.key), [`fixed:${ABC}`, `fixed:${PINYIN}`, "remember", "stale"]);
  assert.deepEqual(groups[0].entries.map((entry) => entry.rule.name), ["Xcode", "终端"].sort((a, b) => a.localeCompare(b, "zh-Hans")), "组内按应用名、中文排序规则");
  assert.equal(groups[1].entries.length, 0);
  assert.equal(groups[3].addable, false);
});

test("candidates：有 bundle id 的、同一个 bundle 留最近用过的、最近用过的在前、搜名字或 bundle id", () => {
  const apps = [
    app("Xcode", "com.apple.dt.Xcode", "public.app-category.developer-tools", 1),
    app("Xcode 旧版", "com.apple.dt.Xcode", "public.app-category.developer-tools", 40),
    app("没打开过", "com.example.never", null, null),
    app("脚本", null, null, 0),
    app("微信", "com.tencent.xinWeChat", "public.app-category.social-networking", 0),
  ];
  const { list, truncated } = model.candidates(apps, "");
  assert.deepEqual(list.map((item) => item.name), ["微信", "Xcode", "没打开过"]);
  assert.equal(truncated, false);
  assert.deepEqual(model.candidates(apps, "tencent").list.map((item) => item.name), ["微信"]);
  const many = Array.from({ length: 70 }, (_, index) => app(`应用${index}`, `com.example.${index}`, null, index));
  assert.equal(model.candidates(many, "").list.length, model.maximumCandidates);
  assert.equal(model.candidates(many, "").truncated, true);
});

test("suggestions：开发工具 → 键盘布局、社交 → 中文；有规则的、一个月没用的、没分类的不推；至多 6 条", () => {
  const apps = [
    app("Xcode", "com.apple.dt.Xcode", "public.app-category.developer-tools", 1),
    app("微信", "com.tencent.xinWeChat", "public.app-category.social-networking", 0),
    app("终端", "com.apple.Terminal", "public.app-category.developer-tools", 2),
    app("很久没用", "com.example.old", "public.app-category.developer-tools", 45),
    app("备忘录", "com.apple.Notes", null, 0),
  ];
  const list = model.suggestions(apps, { "com.apple.Terminal": { mode: "remember", name: "终端" } }, sources, now);
  assert.deepEqual(list, [
    { bundleId: "com.tencent.xinWeChat", name: "微信", choice: `fixed:${PINYIN}` },
    { bundleId: "com.apple.dt.Xcode", name: "Xcode", choice: `fixed:${ABC}` },
  ]);
  assert.equal(model.suggestionSummary(list, sources), "微信 → 微信输入法；Xcode → ABC");
  assert.deepEqual(model.suggestions(apps, {}, [sources[0]], now).map((item) => item.name), ["Xcode", "终端"], "没有中文输入法就不推聊天应用");
});

test("lastUsedTitle 与 choiceTitle", () => {
  assert.equal(model.lastUsedTitle(null, now), undefined);
  assert.equal(model.lastUsedTitle(now - 3600_000, now), "今天用过");
  assert.equal(model.lastUsedTitle(now - day, now), "昨天用过");
  assert.equal(model.lastUsedTitle(now - 5 * day, now), "5 天前用过");
  assert.equal(model.lastUsedTitle(now - 65 * day, now), "2 个月前用过");
  assert.equal(model.choiceTitle(`fixed:${ABC}`, sources), "用 ABC");
  assert.equal(model.choiceTitle("fixed:gone", sources), "用一个已停用的输入法");
  assert.equal(model.choiceTitle("none", sources), "无规则");
});

test("choiceChips：每个输入法一枚（带图标），加记住上次、无规则——两个输入法时四枚", () => {
  const chips = model.choiceChips(sources);
  assert.deepEqual(chips.map((chip) => chip.value), [`fixed:${ABC}`, `fixed:${PINYIN}`, "remember", "none"]);
  assert.deepEqual(chips.map((chip) => chip.title), ["ABC", "微信输入法", "记住上次", "无规则"]);
  assert.equal(chips[1].image.id, "icon-pinyin");
});
