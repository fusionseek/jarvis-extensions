import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// SDK 2.13（jarvis-mac specs/20261030-170731-input-source-switch-p1）：输入源、前台应用、一闪而过的提示，与本地的授权变化监听。
const host = createTestHost({
  async: {
    "inputSources.list": async () => [
      { id: "com.apple.keylayout.ABC", name: "ABC", kind: "keyboardLayout", languages: ["en"] },
      { id: "com.tencent.inputmethod.wetype.pinyin", name: "微信输入法", kind: "inputMode", languages: ["zh-Hans"] },
    ],
    "inputSources.current": async () => ({ id: "com.apple.keylayout.ABC" }),
    "inputSources.select": async (params) => {
      if (params.id === "gone") throw { code: "target.unavailable", message: "这个输入源没有启用", detail: "unknown" };
      return { id: params.id, effective: true };
    },
    "frontmostApp.current": async () => ({ bundleId: "com.apple.dt.Xcode", name: "Xcode", pid: 4021 }),
    "hud.show": async () => null,
  },
});
const { jarvis, capabilityTiers, sdkVersion, JarvisError } = await import("../dist/index.js");

test("SDK 2.13：四项新能力的档位", () => {
  assert.equal(sdkVersion, "2.13.0");
  assert.equal(capabilityTiers["inputSources.read"], "medium");
  assert.equal(capabilityTiers["inputSources.select"], "medium");
  assert.equal(capabilityTiers["system.activity"], "medium");
  assert.equal(capabilityTiers["hud.show"], "low");
});

test("inputSources：list / current / select 原样上线缆", async () => {
  const sources = await jarvis.inputSources.list();
  assert.equal(sources.length, 2);
  assert.deepEqual(await jarvis.inputSources.current(), { id: "com.apple.keylayout.ABC" });
  const selection = await jarvis.inputSources.select("com.tencent.inputmethod.wetype.pinyin");
  assert.deepEqual(selection, { id: "com.tencent.inputmethod.wetype.pinyin", effective: true });
  const request = host.invocations.findLast((entry) => entry.namespace === "inputSources" && entry.method === "select");
  assert.deepEqual(request.params, { id: "com.tencent.inputmethod.wetype.pinyin" });
});

test("inputSources.select：不认识的 id 是 target.unavailable", async () => {
  await assert.rejects(
    () => jarvis.inputSources.select("gone"),
    (error) => error instanceof JarvisError && error.code === "target.unavailable" && error.detail === "unknown",
  );
});

test("inputSources.observe：订在自己的命名空间上，退订发 inputSources.unsubscribe", async () => {
  const events = [];
  const stop = jarvis.inputSources.observe((event) => events.push(event));
  const request = host.invocations.findLast((entry) => entry.namespace === "inputSources" && entry.method === "observe");
  assert.match(request.params.token, /^inputSources\.observe#/);
  host.emit(request.params.token, { type: "selected", id: "com.apple.keylayout.ABC", bySelf: true });
  host.emit(request.params.token, { type: "listChanged" });
  assert.deepEqual(events, [{ type: "selected", id: "com.apple.keylayout.ABC", bySelf: true }, { type: "listChanged" }]);
  stop();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const unsubscribe = host.invocations.findLast((entry) => entry.namespace === "inputSources" && entry.method === "unsubscribe");
  assert.equal(unsubscribe.params.token, request.params.token);
});

test("frontmostApp：current 与 observe", async () => {
  assert.equal((await jarvis.frontmostApp.current()).bundleId, "com.apple.dt.Xcode");
  const apps = [];
  jarvis.frontmostApp.observe((app) => apps.push(app.bundleId));
  const request = host.invocations.findLast((entry) => entry.namespace === "frontmostApp" && entry.method === "observe");
  host.emit(request.params.token, { bundleId: "com.tencent.xinWeChat", name: "微信", pid: 512 });
  assert.deepEqual(apps, ["com.tencent.xinWeChat"]);
});

test("hud.show：没给的可选项不上线缆", async () => {
  await jarvis.hud.show({ text: "ABC", anchor: "caret" });
  await jarvis.hud.show({ text: "已切到全局", anchor: "pointer", symbol: "network", duration: 800 });
  const shows = host.invocations.filter((entry) => entry.namespace === "hud" && entry.method === "show").map((entry) => entry.params);
  assert.deepEqual(shows, [
    { text: "ABC", anchor: "caret" },
    { text: "已切到全局", anchor: "pointer", symbol: "network", duration: 800 },
  ]);
});

test("permissions.onChange：本地听 permissionsChanged，不上线缆；退订之后不再回调", () => {
  const seen = [];
  const before = host.invocations.length;
  const stop = jarvis.permissions.onChange((granted) => seen.push(granted));
  host.dispatch({ type: "permissionsChanged", granted: ["system.activity"] });
  stop();
  host.dispatch({ type: "permissionsChanged", granted: [] });
  assert.deepEqual(seen, [["system.activity"]]);
  assert.equal(host.invocations.slice(before).filter((entry) => entry.namespace === "permissions").length, 0);
});
