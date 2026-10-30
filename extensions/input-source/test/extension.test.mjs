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

const granted = ["hud.show", "inputSources.read", "inputSources.select", "system.activity"];
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
  assert.deepEqual(huds.at(-1), { text: "ABC", anchor: "caret" });
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
  assert.equal(huds.at(-1).image.id, "icon-pinyin");
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

test("工具箱页：此刻的应用、规则列表；改规则写进存储，删掉规则", async () => {
  frontmost = { bundleId: "com.apple.dt.Xcode", name: "Xcode", pid: 11 };
  host.dispatch({ type: "activate", context: { surface: "toolbox", entry: "toolbox", granted, preferences, commands: [] } });
  await host.settle();
  const picker = host.find((node) => node.kind === "picker" && node.key === "now:rule");
  assert.equal(picker.props.value, `fixed:${ABC}`);
  await host.fire(picker, "change", "ignore");
  assert.equal(storage.get("rules")["com.apple.dt.Xcode"].mode, "ignore");
  const row = host.find((node) => node.kind === "row" && node.key === "rule:com.apple.Notes");
  assert.ok(row, "规则列表里有备忘录");
  host.dispatch({ type: "ui", handler: row.props.actions[0].on.press, payload: {} });
  await host.settle();
  assert.ok(!("com.apple.Notes" in storage.get("rules")));
});
