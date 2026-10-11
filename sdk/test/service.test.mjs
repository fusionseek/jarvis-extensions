import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// process.run 的桩：先往 token 上推两批输出，再兑现结果——与宿主「输出先于结果」的保证一致。
let cancelled = [];
const host = createTestHost({
  async: {
    "process.locate": async ({ executable }) =>
      executable === "mo" ? { path: "/opt/homebrew/bin/mo", source: "discovered" } : { path: null, problem: "notFound" },
    "process.run": async ({ token, arguments: args }, h) => {
      h.emit(token, { lines: ["➤ App caches", "  ✓ User app cache · 4 items, 1.63GB"] });
      h.emit(token, { lines: [`args=${args.join(" ")}`] });
      return { exitCode: 0, stderr: "" };
    },
    "process.cancel": async ({ token }) => {
      cancelled.push(token);
    },
  },
});
const { defineExtension, jarvis, JarvisError } = await import("../dist/index.js");

let seenLines = [];
let releaseRun;

defineExtension({
  services: {
    mole: {
      status: ({ preferences }) => ({ ready: preferences.command === "mo", summary: `用 ${preferences.command}`, actions: [] }),
      async run(context, progress, signal) {
        if (context.preferences.mode === "wait") {
          await new Promise((resolve) => {
            releaseRun = resolve;
            signal.onCancel(resolve);
          });
          return { sections: [], notes: [signal.cancelled ? "被取消了" : "跑完了"] };
        }
        const handle = jarvis.process.run({ executable: "mo", arguments: ["clean"], onLine: (line) => seenLines.push(line) });
        progress({ freedBytes: 10, itemCount: 1, completedSections: 0 });
        const result = await handle.result;
        progress({ freedBytes: 20, itemCount: 2, completedSections: 1 });
        return { sections: [{ id: "x", title: "X", freedBytes: 20, itemCount: 2 }], notes: [`exit ${result.exitCode}`] };
      },
      action: (id) => {
        if (id === "boom") throw new JarvisError({ code: "invalid.argument", message: "不认识" });
        return { watchStatus: id === "install" };
      },
    },
  },
});

test("status 拿到宿主给的偏好", async () => {
  const outcome = await host.callService({ service: "mole", method: "status", preferences: { command: "mo" } });
  assert.deepEqual(outcome.result, { ok: true, value: { ready: true, summary: "用 mo", actions: [] } });
});

test("run：进度经 service.progress 回到宿主，输出行先于结果，报告经 service.resolve 交回", async () => {
  const outcome = await host.callService({ service: "mole", method: "run", preferences: {}, granted: ["process.run"] });
  assert.equal(outcome.result.ok, true);
  assert.deepEqual(outcome.result.value.notes, ["exit 0"]);
  assert.deepEqual(outcome.progress.map((p) => p.freedBytes), [10, 20]);
  assert.deepEqual(seenLines, ["➤ App caches", "  ✓ User app cache · 4 items, 1.63GB", "args=clean"]);
});

test("serviceCancel 触发取消信号", async () => {
  const callId = host.nextCallId;
  const pending = host.callService({ service: "mole", method: "run", preferences: { mode: "wait" } });
  await host.settle();
  host.cancelService(callId);
  const outcome = await pending;
  assert.deepEqual(outcome.result.value.notes, ["被取消了"]);
});

test("action 抛出的 JarvisError 原样变成失败结果；没写的服务给 capability.unknown", async () => {
  const ok = await host.callService({ service: "mole", method: "action", actionId: "install" });
  assert.deepEqual(ok.result, { ok: true, value: { watchStatus: true } });
  const bad = await host.callService({ service: "mole", method: "action", actionId: "boom" });
  assert.equal(bad.result.ok, false);
  assert.equal(bad.result.error.code, "invalid.argument");
  const missing = await host.callService({ service: "nope", method: "status" });
  assert.equal(missing.result.error.code, "capability.unknown");
});

test("process.locate 与 cancel 按名字上线缆", async () => {
  assert.deepEqual(await jarvis.process.locate("mo"), { path: "/opt/homebrew/bin/mo", source: "discovered" });
  assert.deepEqual(await jarvis.process.locate("/tmp/mo"), { path: null, problem: "notFound" });
  const handle = jarvis.process.run({ executable: "mo", arguments: ["--version"] });
  handle.cancel();
  handle.cancel();
  await handle.result;
  await host.settle();
  assert.equal(cancelled.length, 1);
});
