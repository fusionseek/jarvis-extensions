import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// 先装替身，再加载 SDK：defineExtension 之后事件就会往替身里发。
const host = createTestHost({
  async: {
    "system.openExtensionSettings": async () => undefined,
    "screenshot.capture": async (params) => ({ file: { id: "f1", name: "shot.png", byteCount: 1, extension: "png" }, width: 10, height: 10, hint: params.hint }),
  },
});
const { defineExtension, jarvis, ui } = await import("../dist/index.js");

const lifecycle = [];
let count = 0;

defineExtension({
  toolbox: {
    activate: () => lifecycle.push("toolbox:activate"),
    deactivate: () => lifecycle.push("toolbox:deactivate"),
    render: () => ui.scroll({ children: [ui.text({ key: "where", text: `toolbox ${count}` })] }),
  },
  popover: {
    activate: () => lifecycle.push("popover:activate"),
    deactivate: () => lifecycle.push("popover:deactivate"),
    render: () =>
      ui.scroll({
        children: [ui.text({ key: "where", text: `popover ${count}` }), ui.button({ key: "bump", title: "+1", onPress: () => (count += 1) })],
      }),
  },
});

const context = { entry: "command", granted: [], preferences: {}, commands: [] };

test("activate 在 popover 这一面时提交的是弹窗那棵树，commit 上标着 surface", async () => {
  host.dispatch({ type: "activate", context: { ...context, surface: "popover" } });
  await host.settle();
  assert.equal(host.latestSurface, "popover");
  assert.equal(host.find((n) => n.key === "where").props.text, "popover 0");
  assert.deepEqual(lifecycle, ["popover:activate"]);
});

test("弹窗里的事件回调之后仍在弹窗这一面重画", async () => {
  await host.fire(host.find((n) => n.key === "bump"), "press");
  assert.equal(host.latestSurface, "popover");
  assert.equal(host.find((n) => n.key === "where").props.text, "popover 1");
});

test("「在面板里打开」= 先 deactivate 弹窗再 activate 工具箱页面，状态还在", async () => {
  host.dispatch({ type: "deactivate" });
  const before = host.commits.length;
  jarvis.ui.update();
  await host.settle();
  assert.equal(host.commits.length, before, "一面都没开着时不提交");
  host.dispatch({ type: "activate", context: { ...context, entry: "toolbox", surface: "toolbox" } });
  await host.settle();
  assert.equal(host.latestSurface, "toolbox");
  assert.equal(host.find((n) => n.key === "where").props.text, "toolbox 1");
  assert.deepEqual(lifecycle, ["popover:activate", "popover:deactivate", "toolbox:activate"]);
});

test("没给 window 的扩展，窗口那一面画工具箱页面", async () => {
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { ...context, entry: "search", surface: "window" } });
  await host.settle();
  assert.equal(host.latestSurface, "window");
  assert.equal(host.find((n) => n.key === "where").props.text, "toolbox 1");
});

test("能力按名字上线缆：system.openExtensionSettings 与 capture 的 hint", async () => {
  await jarvis.system.openExtensionSettings();
  assert.ok(host.invocations.some((i) => i.namespace === "system" && i.method === "openExtensionSettings"));
  const shot = await jarvis.screenshot.capture({ selectionOnly: true, recognizeText: true, hint: "松手即翻译" });
  assert.equal(shot.hint, "松手即翻译");
  const request = host.invocations.find((i) => i.namespace === "screenshot" && i.method === "capture");
  assert.equal(request.params.hint, "松手即翻译");
  assert.equal(request.params.selectionOnly, true);
});
