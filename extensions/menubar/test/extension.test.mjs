/**
 * 整个扩展跑在假宿主上：菜单栏域 start 推三枚状态项、按设置订指针；点控制项 / 菜单 / 指令收放；
 * 露着时才订指针进出、指针离开后倒计时收回；工具箱页读清单分三段。
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extra, extensionRoot, notchScreen } from "./support.mjs";

const { createTestHost } = await import(pathToFileURL(join(extensionRoot, "..", "..", "sdk", "dist", "testing.js")).href);

mock.timers.enable({ apis: ["setTimeout", "Date"] });

let preferences = {};
let items = [];
const subscriptions = [];
const host = createTestHost({
  async: {
    "menuBar.update": async () => null,
    "menuBarPointer.observe": async (params) => void subscriptions.push(params.types.join(",")),
    "menuBarPointer.unsubscribe": async () => null,
    "preferences.observe": async () => null,
    "preferences.all": async () => preferences,
    "permissions.granted": async () => ["menuBar.pointer", "menuBarExtras.read"],
    "screens.list": async () => [notchScreen],
    "menuBarExtras.list": async () => items,
    "menuBarExtras.observe": async () => null,
    "menuBarExtras.unsubscribe": async () => null,
    "commands.run": async () => null,
  },
});
await import(pathToFileURL(join(extensionRoot, "dist", "extension.js")).href);

const granted = ["menuBar.pointer", "menuBarExtras.read"];
const blank = (id) => host.statusItem(id)?.blank === true && host.statusItem(id)?.length === 10000;

test("start：三枚都推了，启动时一律收着；只订点击（不订随鼠标移动的那种）", async () => {
  await host.menuBarEvent("start", { granted, preferences });
  assert.equal(host.statusItem("toggle").primaryClick, "event");
  assert.ok(blank("hidden"));
  assert.ok(blank("always"));
  assert.deepEqual(subscriptions, ["click"]);
});

test("点控制项露出来：隐藏段边界缩回竖线、开始订进出；指针离开 10 秒收回、退订进出", async () => {
  await host.menuBarEvent("press", { statusItem: "toggle", modifiers: [], granted });
  assert.equal(host.statusItem("hidden").length, "auto");
  assert.ok(blank("always"), "永远隐藏段仍收着");
  assert.equal(subscriptions.at(-1), "enter,exit,click");

  const token = host.subscriptionToken("menuBarPointer");
  host.emit(token, { type: "enter", screen: "1", x: 900, modifiers: [] });
  await host.settle();
  mock.timers.tick(60_000);
  await host.settle();
  assert.equal(host.statusItem("hidden").length, "auto", "指针在菜单栏上时不收");

  host.emit(token, { type: "exit", screen: "1", x: 900, modifiers: [] });
  await host.settle();
  mock.timers.tick(9_000);
  await host.settle();
  assert.equal(host.statusItem("hidden").length, "auto");
  mock.timers.tick(1_500);
  await host.settle();
  assert.ok(blank("hidden"), "离开 10 秒收回");
  assert.equal(subscriptions.at(-1), "click", "收起之后不再留意指针移动");
});

test("从指令露出来、指针不在菜单栏上（宿主没补发 enter）：10 秒后照样收回", async () => {
  await host.dispatch({ type: "command", context: { id: "toggle", trigger: "slash", granted, preferences, commands: [] } });
  await host.settle();
  assert.equal(host.statusItem("hidden").length, "auto");
  mock.timers.tick(10_500);
  await host.settle();
  assert.ok(blank("hidden"), "不能假定指针在菜单栏上：那样 exit 永远不来");
});

test("⌥ 点：永远隐藏段也露出来；菜单「全部收起」收回", async () => {
  await host.menuBarEvent("press", { statusItem: "toggle", modifiers: ["option"], granted });
  assert.equal(host.statusItem("always").length, "auto");
  await host.menuBarEvent("select", { statusItem: "toggle", itemId: "collapse-all", granted });
  assert.ok(blank("hidden"));
  assert.ok(blank("always"));
});

test("点菜单栏空白处切换；点在菜单标题上不算", async () => {
  const token = host.subscriptionToken("menuBarPointer");
  host.emit(token, { type: "click", screen: "1", x: 400, modifiers: [], button: "left", onItem: false, onAppMenu: true });
  await host.settle();
  assert.ok(blank("hidden"));
  host.emit(token, { type: "click", screen: "1", x: 1250, modifiers: [], button: "left", onItem: false, onAppMenu: false });
  await host.settle();
  assert.equal(host.statusItem("hidden").length, "auto");
  host.emit(host.subscriptionToken("menuBarPointer"), { type: "click", screen: "1", x: 1250, modifiers: [], button: "left", onItem: false, onAppMenu: false });
  await host.settle();
  assert.ok(blank("hidden"));
});

test("/menubar 指令切换", async () => {
  await host.dispatch({ type: "command", context: { id: "toggle", trigger: "slash", granted, preferences, commands: [] } });
  await host.settle();
  assert.equal(host.statusItem("hidden").length, "auto");
  await host.dispatch({ type: "command", context: { id: "toggle", trigger: "slash", granted, preferences, commands: [] } });
  await host.settle();
  assert.ok(blank("hidden"));
});

test("工具箱页：按边界分三段，刘海下面的单独标出", async () => {
  items = [
    extra("com.always", -10300, { name: "很少用" }),
    extra("me.always", -10260, { width: 5016, mine: "always", onScreen: false, screen: null }),
    extra("com.hidden", -5250, { name: "藏起来的", onScreen: false, screen: null }),
    extra("me.hidden", -4199, { width: 5016, mine: "hidden", onScreen: false, screen: null }),
    extra("me.toggle", 817, { width: 30, mine: "toggle" }),
    extra("com.figma", 862, { name: "Figma", onScreen: false }),
    extra("com.wifi", 1336, { name: "Wi‑Fi" }),
  ];
  await host.dispatch({ type: "activate", context: { surface: "toolbox", entry: "toolbox", granted, preferences, commands: [] } });
  await host.settle();
  assert.ok(host.find((node) => node.key === "hidden:com.hidden"));
  assert.ok(host.find((node) => node.key === "always:com.always"));
  assert.ok(host.find((node) => node.key === "notch:com.figma"));
  assert.ok(host.find((node) => node.key === "shown:com.wifi"));
  assert.equal(host.find((node) => node.key === "shown:com.figma"), undefined, "被刘海挡住的不再列在显示段");
  assert.equal(host.find((node) => node.key === "state").props.title, "已收起 2 颗");
});

test("工具箱页：没有辅助功能权限时给引导", async () => {
  host.dispatch({ type: "deactivate" });
  items = Promise.reject({ code: "permission.unavailable", message: "Jarvis 还没有辅助功能权限" });
  items.catch(() => undefined);
  await host.dispatch({ type: "activate", context: { surface: "toolbox", entry: "toolbox", granted, preferences, commands: [] } });
  await host.settle();
  assert.ok(host.find((node) => node.key === "ax"));
});
