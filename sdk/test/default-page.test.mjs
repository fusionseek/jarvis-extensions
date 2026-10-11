import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

const host = createTestHost({ async: { "commands.run": async () => undefined } });
const { defineExtension } = await import("../dist/index.js");

defineExtension({ commands: { go: () => undefined, look: () => undefined } });

test("没有自定义页面的扩展，SDK 按命令清单画默认页；快捷键优先、其次 / 指令", async () => {
  host.dispatch({
    type: "activate",
    context: {
      entry: "toolbox",
      surface: "toolbox",
      granted: [],
      preferences: {},
      commands: [
        { id: "go", title: "出发", hotkey: "⌥⌘G", presentation: "silent" },
        { id: "look", title: "查一下", slash: "/look", presentation: "toolbox" },
      ],
    },
  });
  await host.settle();
  const rows = host.latest.children[0].children;
  assert.equal(rows[0].props.title, "出发");
  assert.equal(rows[0].props.subtitle, "快捷键 ⌥⌘G");
  assert.equal(rows[1].props.subtitle, "指令 /look");
  await host.fire(rows[0], "press");
  assert.ok(host.invocations.some((i) => i.namespace === "commands" && i.method === "run" && i.params.id === "go"));
});

test("defineExtension 只能调用一次", async () => {
  assert.throws(() => defineExtension({}), /只能调用一次/);
});
