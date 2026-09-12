import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// 先装替身，再加载 SDK：运行时对宿主是延迟绑定的，但 defineExtension 之后事件就会往替身里发。
const host = createTestHost({
  async: {
    "storage.get": async ({ key }) => (key === "count" ? 41 : undefined),
    "commands.run": async () => undefined,
    "clipboard.read": async () => "from clipboard",
    "net.fetch": async () => {
      throw { code: "permission.denied", message: "no" };
    },
  },
  sync: {
    "text.language.detect": ({ text }) => ({ code: /[一-鿿]/.test(text) ? "zh-Hans" : "en", confidence: 0.9, candidates: [] }),
  },
});
const { defineExtension, jarvis, ui, JarvisError } = await import("../dist/index.js");

let count = 0;
let lastCommand = null;

defineExtension({
  page: {
    async activate() {
      count = (await jarvis.storage.get("count")) ?? 0;
    },
    render() {
      return ui.scroll({
        children: [
          ui.section({
            title: "计数 · COUNT",
            children: [
              ui.readout({ label: "count", value: String(count) }),
              ui.button({ key: "bump", title: "+1", onPress: () => (count += 1) }),
              ui.field({ key: "name", value: "", label: "名字", onChange: () => undefined }),
            ],
          }),
        ],
      });
    },
  },
  commands: {
    hello: (context) => {
      lastCommand = context;
    },
  },
});

test("activate 之后提交一棵树，异步取回的状态画进去了", async () => {
  host.dispatch({ type: "activate", context: { entry: "toolbox", granted: [], preferences: {}, commands: [] } });
  await host.settle();
  assert.ok(host.latest, "应该有一次提交");
  assert.equal(host.latest.kind, "scroll");
  const readout = host.find((n) => n.kind === "readout");
  assert.equal(readout.props.value, "41");
  // 回调换成了句柄，线缆上没有函数
  const button = host.find((n) => n.key === "bump");
  assert.equal(typeof button.on.press, "string");
  assert.equal(JSON.stringify(host.latest).includes("function"), false);
});

test("ui 事件回调之后自动重画", async () => {
  const before = host.commits.length;
  await host.fire(host.find((n) => n.key === "bump"), "press");
  assert.equal(host.commits.length, before + 1);
  assert.equal(host.find((n) => n.kind === "readout").props.value, "42");
});

test("命令按 id 落到处理函数，带触发来源与偏好", async () => {
  host.dispatch({ type: "command", context: { id: "hello", trigger: "hotkey", granted: ["clipboard.read"], preferences: { a: 1 } } });
  await host.settle();
  assert.equal(lastCommand.trigger, "hotkey");
  assert.deepEqual(lastCommand.preferences, { a: 1 });
});

test("manifest 里有、代码里没有的命令记一条错误日志而不是崩", async () => {
  host.dispatch({ type: "command", context: { id: "missing", trigger: "page", granted: [], preferences: {} } });
  await host.settle();
  assert.ok(host.logs.some((l) => l.level === "error" && l.message.includes("missing")));
});

test("宿主拒绝变成 JarvisError，同步纯函数直接返回", async () => {
  await assert.rejects(jarvis.net.fetch("https://x"), (e) => e instanceof JarvisError && e.code === "permission.denied");
  await assert.rejects(jarvis.memo.list(), (e) => e instanceof JarvisError && e.code === "capability.unknown");
  assert.equal(jarvis.text.language.detect("你好").code, "zh-Hans");
  assert.equal(await jarvis.clipboard.read(), "from clipboard");
});

test("deactivate 之后页面不再提交", async () => {
  host.dispatch({ type: "deactivate" });
  const before = host.commits.length;
  jarvis.ui.update();
  await host.settle();
  assert.equal(host.commits.length, before);
});
