import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

const host = createTestHost({ async: { "commands.run": async () => undefined } });
const { defineExtension } = await import("../dist/index.js");

defineExtension({ commands: { go: () => undefined } });

test("没有自定义页面的扩展，SDK 按命令清单画默认页", async () => {
  host.dispatch({
    type: "activate",
    context: {
      entry: "toolbox",
      granted: [],
      preferences: {},
      commands: [{ id: "go", title: "出发", hotkey: "⌥⌘G", presentation: "silent" }],
    },
  });
  await host.settle();
  const row = host.find((n) => n.kind === "row");
  assert.equal(row.props.title, "出发");
  assert.equal(row.props.subtitle, "快捷键 ⌥⌘G");
  await host.fire(row, "press");
  assert.ok(host.invocations.some((i) => i.namespace === "commands" && i.method === "run"));
});

test("defineExtension 只能调用一次", async () => {
  assert.throws(() => defineExtension({}), /只能调用一次/);
});
