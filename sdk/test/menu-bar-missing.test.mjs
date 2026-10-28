import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// 没入驻菜单栏域的扩展：宿主拒绝 menuBar.update（给了同名桩就用桩），被拒的模型不进 menuBarModels；
// manifest 入驻了、代码里却没交 menuBar 时，事件记一条 error 日志而不是崩。
const host = createTestHost({
  async: {
    "menuBar.update": async () => {
      throw { code: "surface.unavailable", message: "这个扩展没有入驻菜单栏域" };
    },
  },
});
const { defineExtension, jarvis, JarvisError } = await import("../dist/index.js");
defineExtension({});

test("被拒的 menuBar.update 变成 JarvisError，替身不记那份模型", async () => {
  await assert.rejects(
    jarvis.menuBar.update({ items: [] }),
    (error) => error instanceof JarvisError && error.code === "surface.unavailable",
  );
  assert.equal(host.menuBarModels.length, 0);
  assert.equal(host.latestMenuBar, undefined);
});

test("defineExtension 里没有 menuBar：start 记一条 error 日志", async () => {
  await host.menuBarEvent("start");
  assert.ok(host.logs.some((log) => log.level === "error" && log.message.includes("menuBar")));
});
