import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// 文件管理器的文件动作（SDK 2.13，jarvis-mac specs/20261031-080031-file-manager-p2-actions-ring A-2…A-4）：
// files.actions 的服务分派、进度经 service.progress、取消、process.run 的 { file } / { output } 参数上线缆的样子。
let runs = [];
const host = createTestHost({
  async: {
    "process.run": async (params) => {
      runs.push(params);
      return { exitCode: 0, stderr: "" };
    },
  },
});
const { defineExtension, jarvis } = await import("../dist/index.js");

const handle = "file-0123456789abcdef0123456789abcdef";
const directory = "dir-0123456789abcdef0123456789abcdef";
let cancelled = false;

defineExtension({
  services: {
    converters: {
      describe() {
        return { actions: [{ id: "to-png", title: "转为 PNG", symbol: "photo", categories: ["image"] }] };
      },
      async run(request, _context, progress, signal) {
        signal.onCancel(() => { cancelled = true; });
        progress({ fraction: 0.5, message: "第 1 / 2 张" });
        const run = jarvis.process.run({
          executable: "sips",
          arguments: ["-s", "format", "png", { file: request.files[0].file }, "--out", { output: "a.png" }],
          directory: request.directory,
        });
        await run.result;
        return { outputs: ["a.png"] };
      },
    },
  },
});

test("files.actions · describe：动作清单经 service.resolve 交回", async () => {
  const outcome = await host.callService({ point: "files.actions", service: "converters", method: "describe" });
  assert.deepEqual(outcome.result, { ok: true, value: { actions: [{ id: "to-png", title: "转为 PNG", symbol: "photo", categories: ["image"] }] } });
});

test("files.actions · run：入参交给实现、进度上线缆、{ file } / { output } 原样交给宿主替换", async () => {
  runs = [];
  const request = { action: "to-png", files: [{ file: handle, name: "a.heic", extension: "heic", category: "image", folder: false }], directory };
  const outcome = await host.callService({ point: "files.actions", service: "converters", method: "run", granted: ["process.run"], request });
  assert.deepEqual(outcome.result, { ok: true, value: { outputs: ["a.png"] } });
  assert.deepEqual(outcome.progress, [{ fraction: 0.5, message: "第 1 / 2 张" }]);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].arguments, ["-s", "format", "png", { file: handle }, "--out", { output: "a.png" }]);
  assert.equal(runs[0].directory, directory);
});

test("files.actions · run 被取消：signal 触发，实现照常交回", async () => {
  cancelled = false;
  const request = { action: "to-png", files: [{ file: handle, name: "a.heic", extension: "heic", category: "image", folder: false }], directory };
  const callId = host.nextCallId;
  const pending = host.callService({ point: "files.actions", service: "converters", method: "run", request });
  host.cancelService(callId);
  const outcome = await pending;
  assert.equal(cancelled, true);
  assert.equal(outcome.result.ok, true);
});

test("files.actions 不认识的方法：交回 capability.unknown，不抛", async () => {
  const outcome = await host.callService({ point: "files.actions", service: "converters", method: "format" });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "capability.unknown");
});
