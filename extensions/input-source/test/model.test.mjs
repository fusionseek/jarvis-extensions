/**
 * 纯函数：决定切到哪一个、记住上次、规则的增删与说明、菜单栏模型。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ABC, PINYIN, loadModel, sources } from "./support.mjs";

const model = await loadModel();
const enabled = [ABC, PINYIN];
const settings = (overrides = {}) => ({ ...model.defaultSettings, ...overrides });

test("resolveTarget：固定规则、记住上次、不管它", () => {
  const memory = {
    rules: {
      "com.apple.dt.Xcode": { mode: "fixed", source: ABC, name: "Xcode" },
      "com.tencent.xinWeChat": { mode: "remember", name: "微信" },
      "com.apple.Terminal": { mode: "ignore", name: "终端" },
    },
    lastUsed: { "com.tencent.xinWeChat": PINYIN, "com.apple.Terminal": PINYIN },
  };
  assert.equal(model.resolveTarget("com.apple.dt.Xcode", memory, settings(), enabled), ABC);
  assert.equal(model.resolveTarget("com.tencent.xinWeChat", memory, settings(), enabled), PINYIN);
  assert.equal(model.resolveTarget("com.apple.Terminal", memory, settings({ others: "remember" }), enabled), undefined, "不管它就是不管，哪怕其余应用是记住上次");
  const fresh = { rules: { "com.tencent.xinWeChat": { mode: "remember", name: "微信" } }, lastUsed: {} };
  assert.equal(model.resolveTarget("com.tencent.xinWeChat", fresh, settings(), enabled), undefined, "记住上次而从没记过：不动");
});

test("resolveTarget：没写规则的应用按偏好", () => {
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

test("规则与选择器的值互转；不写规则 = 删掉", () => {
  assert.equal(model.ruleChoice(undefined), "none");
  assert.equal(model.ruleChoice({ mode: "fixed", source: ABC, name: "Xcode" }), `fixed:${ABC}`);
  assert.deepEqual(model.ruleFromChoice(`fixed:${PINYIN}`, "微信"), { mode: "fixed", source: PINYIN, name: "微信" });
  assert.equal(model.ruleFromChoice("none", "微信"), undefined);
  const rules = model.setRule({}, "x", { mode: "ignore", name: "X" });
  assert.deepEqual(model.setRule(rules, "x", undefined), {});
});

test("setRule：到上限就不再加新的，改旧的照常", () => {
  let rules = {};
  for (let index = 0; index < model.maximumRules; index += 1) rules = model.setRule(rules, `app${index}`, { mode: "ignore", name: `${index}` });
  assert.equal(model.setRule(rules, "new", { mode: "ignore", name: "new" }), rules);
  assert.equal(model.setRule(rules, "app1", { mode: "remember", name: "1" }).app1.mode, "remember");
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
});

test("菜单：暂停时图标换一枚、短字可以关掉；没有前台应用时只剩暂停", () => {
  const menu = model.menuModel({ rules: {}, sources, currentId: ABC, settings: settings({ paused: true, menuBarLabel: false }) });
  assert.equal(menu.symbol, "keyboard.badge.ellipsis");
  assert.equal(menu.title, undefined);
  assert.deepEqual(menu.items.map((item) => item.id), ["pause"]);
  assert.equal(menu.items[0].checked, true);
});

test("readSettings：不认识的值退回默认", () => {
  assert.deepEqual(model.readSettings({ others: "weird", hud: "yes", hudAnchor: "screen" }), { ...model.defaultSettings, hudAnchor: "screen" });
});
