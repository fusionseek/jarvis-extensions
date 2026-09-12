import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

const host = createTestHost();
const { defineExtension, ui } = await import("../dist/index.js");

defineExtension({
  page: { render: () => ui.scroll({ children: [ui.text({ key: "where", text: "page" })] }) },
});

test("没给 popover 的扩展，弹窗里画页面那棵树", async () => {
  host.dispatch({ type: "activate", context: { entry: "command", surface: "popover", granted: [], preferences: {}, commands: [] } });
  await host.settle();
  assert.equal(host.latestSurface, "popover");
  assert.equal(host.find((n) => n.key === "where").props.text, "page");
});
