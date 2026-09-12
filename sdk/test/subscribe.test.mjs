import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// 没有 preferences.observe 的桩：宿主会以 capability.unknown 拒绝这条订阅。
const host = createTestHost();
const { defineExtension, jarvis } = await import("../dist/index.js");
defineExtension({});

test("被宿主拒绝的订阅记一条 warn，不变成未处理的 rejection", async () => {
  let fired = 0;
  const off = jarvis.preferences.onChange(() => (fired += 1));
  await host.settle();
  assert.ok(host.logs.some((l) => l.level === "warn" && l.message.includes("preferences.observe")));
  assert.equal(fired, 0);
  off();
  await host.settle();
});
