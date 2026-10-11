import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

const host = createTestHost();
const { defineExtension, ui } = await import("../dist/index.js");

defineExtension({
  toolbox: { render: () => ui.scroll({ children: [ui.text({ key: "where", text: "toolbox" })] }) },
  window: { render: () => ui.scroll({ children: [ui.text({ key: "where", text: "window" })] }) },
});

test("没给 popover 的扩展，弹窗里画工具箱页面那棵树", async () => {
  host.dispatch({ type: "activate", context: { entry: "command", surface: "popover", granted: [], preferences: {}, commands: [] } });
  await host.settle();
  assert.equal(host.latestSurface, "popover");
  assert.equal(host.find((n) => n.key === "where").props.text, "toolbox");
});

test("给了 window 的扩展，窗口那一面画它自己的树", async () => {
  host.dispatch({ type: "deactivate" });
  host.dispatch({ type: "activate", context: { entry: "search", surface: "window", granted: [], preferences: {}, commands: [] } });
  await host.settle();
  assert.equal(host.latestSurface, "window");
  assert.equal(host.find((n) => n.key === "where").props.text, "window");
});
