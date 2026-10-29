import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// SDK 2.11（jarvis-mac specs/20261029-225323-menubar-manager-p1）：几枚状态项的模型、左键 press 事件、
// 菜单栏指针 / 菜单栏上的项 / 屏幕三种订阅在线缆上的形状。
const pointerEvents = [];
const changes = [];
const screenLists = [];
const host = createTestHost({
  async: {
    "menuBar.update": async () => null,
    "menuBarPointer.observe": async () => null,
    "menuBarPointer.unsubscribe": async () => null,
    "menuBarExtras.list": async () => [{ id: "com.figma.Desktop", ownerBundleId: "com.figma.Desktop", ownerName: "Figma", title: "", frame: { x: 962, y: 0, width: 32, height: 33 }, screen: "1", onScreen: false, movable: true }],
    "menuBarExtras.observe": async () => null,
    "menuBarExtras.unsubscribe": async () => null,
    "screens.list": async () => [],
    "screens.observe": async () => null,
  },
});
const { defineExtension, jarvis, capabilityTiers } = await import("../dist/index.js");

const presses = [];
defineExtension({
  menuBar: {
    async start() {
      await jarvis.menuBar.update({ statusItem: "toggle", symbol: "chevron.left", primaryClick: "event", items: [] });
      await jarvis.menuBar.update({ statusItem: "hidden", blank: true, length: 10000, items: [] });
    },
    select() {},
    press(context, statusItem, modifiers) {
      presses.push({ statusItem, modifiers, granted: context.granted });
    },
  },
});

test("两项新能力都是中档", () => {
  assert.equal(capabilityTiers["menuBar.pointer"], "medium");
  assert.equal(capabilityTiers["menuBarExtras.read"], "medium");
});

test("几枚状态项的模型原样上线缆：statusItem / length / blank / primaryClick", async () => {
  await host.menuBarEvent("start");
  const updates = host.invocations.filter((request) => request.namespace === "menuBar" && request.method === "update");
  assert.deepEqual(updates.map((request) => request.params.statusItem), ["toggle", "hidden"]);
  assert.deepEqual(host.statusItem("hidden"), { statusItem: "hidden", blank: true, length: 10000, items: [] });
  assert.equal(host.statusItem("toggle").primaryClick, "event");
});

test("press 落到回调，带状态项与修饰键；不是 primaryClick: event 的那一枚，替身不发", async () => {
  await host.menuBarEvent("press", { statusItem: "toggle", modifiers: ["option"], granted: ["menuBar.pointer"] });
  assert.deepEqual(presses, [{ statusItem: "toggle", modifiers: ["option"], granted: ["menuBar.pointer"] }]);
  await assert.rejects(() => host.menuBarEvent("press", { statusItem: "hidden" }), /primaryClick/);
});

test("observePointer：订阅自己的命名空间、types 去重上线缆；退订同一个 token", async () => {
  const stop = jarvis.menuBar.observePointer(["enter", "exit", "enter"], (event) => pointerEvents.push(event));
  await host.settle();
  const request = host.invocations.find((entry) => entry.namespace === "menuBarPointer" && entry.method === "observe");
  assert.deepEqual(request.params.types, ["enter", "exit"]);
  host.emit(request.params.token, { type: "enter", screen: "1", x: 900, modifiers: [] });
  assert.deepEqual(pointerEvents, [{ type: "enter", screen: "1", x: 900, modifiers: [] }]);
  stop();
  await host.settle();
  const unsubscribe = host.invocations.find((entry) => entry.namespace === "menuBarPointer" && entry.method === "unsubscribe");
  assert.equal(unsubscribe.params.token, request.params.token);
});

test("menuBarExtras.list / observe 与 screens.observe（推来的是 { screens }，回调拿到数组）", async () => {
  const items = await jarvis.menuBarExtras.list();
  assert.equal(items[0].id, "com.figma.Desktop");
  jarvis.menuBarExtras.observe((change) => changes.push(change));
  jarvis.screens.observe((screens) => screenLists.push(screens));
  await host.settle();
  host.emit(host.subscriptionToken("menuBarExtras"), { added: [], removed: ["com.figma.Desktop"] });
  host.emit(host.subscriptionToken("screens"), { screens: [{ id: "1" }] });
  assert.deepEqual(changes, [{ added: [], removed: ["com.figma.Desktop"] }]);
  assert.deepEqual(screenLists, [[{ id: "1" }]]);
});
