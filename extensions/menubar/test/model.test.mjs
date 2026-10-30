/**
 * 纯逻辑：收放、三枚状态项的模型、该订哪几种指针事件、点空白处、自动收回、工具箱页的分段。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extra, loadModel, notchScreen } from "./support.mjs";

const model = await loadModel();
const settings = model.defaultSettings;

test("点控制项：普通点在露与收之间切；⌥ 点连永远隐藏的一起", () => {
  const shown = model.press(model.collapsedState, [], settings);
  assert.deepEqual(shown, { expanded: true, alwaysRevealed: false });
  assert.deepEqual(model.press(shown, [], settings), model.collapsedState);
  const all = model.press(model.collapsedState, ["option"], settings);
  assert.deepEqual(all, { expanded: true, alwaysRevealed: true });
  assert.deepEqual(model.press(all, ["option"], settings), model.collapsedState);
  assert.deepEqual(model.press(model.collapsedState, ["option"], { ...settings, alwaysHidden: false }), { expanded: true, alwaysRevealed: false }, "永远隐藏段关掉时 ⌥ 点等于普通点");
});

test("收着：两条边界都是 10000 点宽的空白；控制项左键发事件", () => {
  const [toggle, hidden, always] = model.statusModels(model.collapsedState, settings);
  assert.equal(toggle.statusItem, "toggle");
  assert.equal(toggle.primaryClick, "event");
  assert.equal(toggle.symbol, "chevron.left");
  assert.deepEqual({ blank: hidden.blank, length: hidden.length }, { blank: true, length: 10000 });
  assert.deepEqual({ blank: always.blank, length: always.length }, { blank: true, length: 10000 });
});

test("露着：隐藏段边界缩回一条竖线，永远隐藏段仍撑着；⌥ 点之后两条都是竖线", () => {
  const [, hidden, always] = model.statusModels({ expanded: true, alwaysRevealed: false }, settings);
  assert.deepEqual({ blank: hidden.blank, length: hidden.length, symbol: hidden.symbol }, { blank: undefined, length: "auto", symbol: "poweron" });
  assert.equal(always.length, 10000);
  const [, , alwaysShown] = model.statusModels({ expanded: true, alwaysRevealed: true }, settings);
  assert.equal(alwaysShown.length, "auto");
});

test("永远隐藏段关掉：那一枚不画（也就不占位、不分段）", () => {
  const [, , always] = model.statusModels(model.collapsedState, { ...settings, alwaysHidden: false });
  assert.equal(always.hidden, true);
  assert.equal(always.length, "auto");
});

test("指针订阅只订用得着的：收着、没开悬停时不订进出（那是随鼠标移动触发的监听）", () => {
  assert.deepEqual(model.pointerTypes(model.collapsedState, settings, true), ["click"]);
  assert.deepEqual(model.pointerTypes({ expanded: true, alwaysRevealed: false }, settings, true), ["enter", "exit", "click"], "露着要等指针离开再收回");
  assert.deepEqual(model.pointerTypes(model.collapsedState, { ...settings, hoverReveal: true, scrollReveal: true }, true), ["enter", "exit", "click", "scroll"]);
  assert.deepEqual(model.pointerTypes(model.collapsedState, { ...settings, clickReveal: false }, true), [], "什么都没开：一个监听都不装");
  assert.deepEqual(model.pointerTypes({ expanded: true, alwaysRevealed: false }, { ...settings, autoRehide: 0, clickReveal: false }, true), []);
  assert.deepEqual(model.pointerTypes({ expanded: true, alwaysRevealed: false }, settings, false), [], "没授权就不订");
});

test("点空白处：不在图标上、不在菜单标题上；读不到菜单标题时只认屏幕右半边", () => {
  const click = (overrides) => ({ type: "click", screen: "1", x: 1200, modifiers: [], button: "left", onItem: false, onAppMenu: false, ...overrides });
  assert.equal(model.isEmptyAreaClick(click({}), [notchScreen]), true);
  assert.equal(model.isEmptyAreaClick(click({ onItem: true }), [notchScreen]), false);
  assert.equal(model.isEmptyAreaClick(click({ onAppMenu: true }), [notchScreen]), false);
  assert.equal(model.isEmptyAreaClick(click({ button: "right" }), [notchScreen]), false);
  assert.equal(model.isEmptyAreaClick(click({ onAppMenu: null, x: 300 }), [notchScreen]), false);
  assert.equal(model.isEmptyAreaClick(click({ onAppMenu: null, x: 1300 }), [notchScreen]), true);
});

test("自动收回：0 = 不收；点过某颗图标至少等 20 秒", () => {
  assert.equal(model.rehideDelay(settings, false), 10_000);
  assert.equal(model.rehideDelay(settings, true), 20_000);
  assert.equal(model.rehideDelay({ ...settings, autoRehide: 45 }, true), 45_000);
  assert.equal(model.rehideDelay({ ...settings, autoRehide: 0 }, false), null);
});

test("设置：缺的用默认、秒数夹在 0–120", () => {
  assert.deepEqual(model.readSettings({}), model.defaultSettings);
  assert.equal(model.readSettings({ autoRehide: 999 }).autoRehide, 120);
  assert.equal(model.readSettings({ autoRehide: -3 }).autoRehide, 0);
  assert.equal(model.readSettings({ hoverReveal: "yes" }).hoverReveal, false);
});

test("分段：收着时边界被撑宽落在屏幕外，左边的一律在它左边；刘海下面的单独标出", () => {
  const items = [
    extra("always.app", -10300),
    extra("me.always", -10260, { width: 5016, mine: "always", onScreen: false, screen: null }),
    extra("hidden.app", -5250, { onScreen: false, screen: null }),
    extra("me.hidden", -4199, { width: 5016, mine: "hidden", onScreen: false, screen: null }),
    extra("me.toggle", 817, { width: 30, mine: "toggle", onScreen: false }),
    extra("figma", 862, { onScreen: false }),
    extra("wifi", 1336),
  ];
  const layout = model.classify(items, [notchScreen]);
  assert.deepEqual(layout.always.map((item) => item.id), ["always.app"]);
  assert.deepEqual(layout.hidden.map((item) => item.id), ["hidden.app"]);
  assert.deepEqual(layout.shown.map((item) => item.id), ["figma", "wifi"]);
  assert.deepEqual(layout.notched.map((item) => item.id), ["figma"]);
  assert.equal(layout.collapsed, true);
  assert.equal(layout.hasDivider, true);
});

test("分段：露着时边界是一条竖线，照样按它的左边分", () => {
  const items = [extra("a", 600), extra("me.hidden", 640, { width: 16, mine: "hidden" }), extra("b", 700)];
  const layout = model.classify(items, [notchScreen]);
  assert.deepEqual(layout.hidden.map((item) => item.id), ["a"]);
  assert.deepEqual(layout.shown.map((item) => item.id), ["b"]);
  assert.equal(layout.collapsed, false);
});

// 1.1（jarvis-mac specs/20261030-081832-menubar-manager-p2 N-7）

test("设置：showIn 只认 menuBar / bar，notchToBar 默认开", () => {
  assert.equal(model.readSettings({}).showIn, "menuBar");
  assert.equal(model.readSettings({ showIn: "bar" }).showIn, "bar");
  assert.equal(model.readSettings({ showIn: "strip" }).showIn, "menuBar");
  assert.equal(model.readSettings({}).notchToBar, true);
  assert.equal(model.readSettings({ notchToBar: false }).notchToBar, false);
});

test("看不见：不在屏上、中点落在屏幕范围里（刘海下、刘海左边）；挤出屏幕的不算", () => {
  assert.equal(model.isObscured(extra("a", 886, { onScreen: false }), [notchScreen]), true, "刘海下面");
  assert.equal(model.isObscured(extra("b", 600, { onScreen: false }), [notchScreen]), true, "挤到刘海左边、应用菜单底下");
  assert.equal(model.isObscured(extra("c", -3700, { onScreen: false }), [notchScreen]), false, "收起时我们自己藏的");
  assert.equal(model.isObscured(extra("d", 1100), [notchScreen]), false);
  assert.equal(model.isWithinScreens(extra("a", 886, { onScreen: false }), [notchScreen]), true, "刘海下面的能点开");
});

test("副栏里放哪些：隐藏段 + 看不见的；all 再加永远隐藏段；obscured 只放看不见的；从左到右", () => {
  const items = [
    extra("always-1", -9200, { onScreen: false }),
    extra("always", -9157, { width: 5016, onScreen: false, mine: "always" }),
    extra("hidden-1", -3740, { onScreen: false }),
    extra("hidden-2", -3700, { onScreen: false }),
    extra("hidden", -3626, { width: 5016, onScreen: false, mine: "hidden" }),
    extra("notched", 1400, { onScreen: false }),
    extra("shown", 1440),
    extra("toggle", 1480, { mine: "toggle" }),
  ];
  // 收着时 hidden 那枚撑到 x = −3626…1390：「notched」挪到它右边、算显示段，却看不见。
  items[5] = extra("notched", 900, { onScreen: false });
  items[4] = extra("hidden", -3626, { width: 1000, onScreen: false, mine: "hidden" });
  assert.deepEqual(model.barItems(items, [notchScreen], "hidden").map((item) => item.id), ["hidden-1", "hidden-2", "notched"]);
  assert.deepEqual(model.barItems(items, [notchScreen], "all").map((item) => item.id), ["always-1", "hidden-1", "hidden-2", "notched"]);
  assert.deepEqual(model.barItems(items, [notchScreen], "obscured").map((item) => item.id), ["notched"]);
  assert.equal(model.barScope("all"), "all");
  assert.equal(model.barScope(undefined), "hidden");
  assert.equal(model.barScope("everything"), "hidden");
});

test("截哪几颗：隐藏段与永远隐藏段里此刻露着的；显示段一直看得见，不截；至多 40", () => {
  const items = [
    extra("hidden-1", 1000),
    extra("hidden-2", 860, { onScreen: false }),
    extra("hidden", 1250, { width: 22, mine: "hidden" }),
    extra("shown", 1300),
  ];
  assert.deepEqual(model.captureTargets(items, [notchScreen]), ["hidden-1"], "刘海下面的截不到，不去截");
  const many = [...Array.from({ length: 50 }, (_, index) => extra(`h${index}`, index * 10)), extra("hidden", 1250, { width: 22, mine: "hidden" })];
  assert.equal(model.captureTargets(many, [notchScreen]).length, 40);
});
