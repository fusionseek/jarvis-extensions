import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// SDK 2.12（jarvis-mac specs/20261030-081832-menubar-manager-p2）：截菜单栏上的项、点开它与按次的菜单开关、
// commands.run 把弹窗锚到自己的状态项上、新的错误码。
const host = createTestHost({
  async: {
    "menuBarExtras.capture": async (params) => params.ids.map((id) => ({ id, live: id === "a" })),
    "menuBarExtras.press": async (params) => {
      if (params.id === "far") throw { code: "target.unavailable", message: "这颗菜单栏图标此刻在屏幕外，点不开", detail: "offscreen" };
      return { via: "accessibility" };
    },
    "commands.run": async () => null,
  },
});
const { jarvis, capabilityTiers, sdkVersion, JarvisError } = await import("../dist/index.js");

test("SDK 2.12：两项新能力都是高档", () => {
  assert.equal(sdkVersion, "2.12.0");
  assert.equal(capabilityTiers["menuBarExtras.capture"], "high");
  assert.equal(capabilityTiers["menuBarExtras.control"], "high");
});

test("capture：ids 去重上线缆，结果原样交回", async () => {
  const result = await jarvis.menuBarExtras.capture(["a", "b", "a"]);
  const request = host.invocations.find((entry) => entry.namespace === "menuBarExtras" && entry.method === "capture");
  assert.deepEqual(request.params, { ids: ["a", "b"] });
  assert.deepEqual(result, [{ id: "a", live: true }, { id: "b", live: false }]);
});

test("press：不要 onMenu 时不带 token；button 默认 left", async () => {
  const result = await jarvis.menuBarExtras.press("wifi");
  assert.deepEqual(result, { via: "accessibility" });
  const request = host.invocations.findLast((entry) => entry.method === "press");
  assert.deepEqual(request.params, { id: "wifi", button: "left" });
});

test("press + onMenu：开、关推到这一次自己的 token 上，关了之后就不再收", async () => {
  const states = [];
  await jarvis.menuBarExtras.press("karabiner", { button: "right", onMenu: (state) => states.push(state) });
  const request = host.invocations.findLast((entry) => entry.method === "press");
  assert.equal(request.params.button, "right");
  assert.match(request.params.token, /^menuBarExtras\.press#/);
  host.emit(request.params.token, { id: "karabiner", state: "opened" });
  host.emit(request.params.token, { id: "karabiner", state: "closed" });
  host.emit(request.params.token, { id: "karabiner", state: "opened" });
  assert.deepEqual(states, ["opened", "closed"], "closed 之后忘掉这个 token");
});

test("press 在屏外：target.unavailable 原样变成 JarvisError，token 随之作废", async () => {
  const states = [];
  await assert.rejects(
    () => jarvis.menuBarExtras.press("far", { onMenu: (state) => states.push(state) }),
    (error) => error instanceof JarvisError && error.code === "target.unavailable" && error.detail === "offscreen",
  );
  const request = host.invocations.findLast((entry) => entry.method === "press");
  host.emit(request.params.token, { id: "far", state: "none" });
  assert.deepEqual(states, []);
});

test("commands.run：字符串照旧是参数；对象带 anchor 上线缆", async () => {
  await jarvis.commands.run("toggle");
  await jarvis.commands.run("reveal-item", "com.figma.Desktop");
  await jarvis.commands.run("bar", { argument: "all", anchor: { statusItem: "toggle" } });
  await jarvis.commands.run("bar", { anchor: { statusItem: "toggle" } });
  const runs = host.invocations.filter((entry) => entry.namespace === "commands" && entry.method === "run").map((entry) => entry.params);
  assert.deepEqual(runs, [
    { id: "toggle" },
    { id: "reveal-item", argument: "com.figma.Desktop" },
    { id: "bar", argument: "all", anchor: { statusItem: "toggle" } },
    { id: "bar", anchor: { statusItem: "toggle" } },
  ]);
});
