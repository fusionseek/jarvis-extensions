import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// 文件详情的属性扩展（SDK 2.13，jarvis-mac specs/20261031-192049-files-details-media-info-type-select M-1）：
// files.details 的服务分派、inspect 的入参与 { file } 参数上线缆的样子、选中一换宿主发 serviceCancel 时 signal 触发、进程被取消。
let runs = [];
let cancels = [];
let releaseRun;
const host = createTestHost({
  async: {
    "process.run": (params) => {
      runs.push(params);
      // 挂住到测试放行：取消的那条用例要在进程还在跑的时候发 serviceCancel。
      return new Promise((resolve) => {
        releaseRun = () => resolve({ exitCode: 0, stderr: "", stdout: '{"ok":true}' });
      });
    },
    "process.cancel": (params) => {
      cancels.push(params);
      releaseRun?.();
      return null;
    },
  },
});
const { defineExtension, fileDetailsLimits, jarvis } = await import("../dist/index.js");

/** 让在途的能力调用走到桩里（不能用 host.settle()：它要等挂住的 process.run 兑现）。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const handle = "file-0123456789abcdef0123456789abcdef";
const file = { file: handle, name: "song.flac", extension: "flac", category: "audio", size: 31457280, folder: false };
let cancelled = false;

defineExtension({
  services: {
    media: {
      describe() {
        return { categories: ["video", "audio"], extensions: ["mkv", "flac"] };
      },
      async inspect(request, _context, signal) {
        signal.onCancel(() => { cancelled = true; });
        const run = jarvis.process.run({ executable: "mediainfo", arguments: ["--Output=JSON", { file: request.files[0].file }], output: "text" });
        signal.onCancel(() => run.cancel());
        const result = await run.result;
        return { sections: [{ title: "概要", rows: [{ label: "文件", value: request.files[0].name }, { label: "输出", value: result.stdout }] }] };
      },
    },
  },
});

test("files.details · describe：认领范围经 service.resolve 交回", async () => {
  const outcome = await host.callService({ point: "files.details", service: "media", method: "describe" });
  assert.deepEqual(outcome.result, { ok: true, value: { categories: ["video", "audio"], extensions: ["mkv", "flac"] } });
});

test("files.details · inspect：入参交给实现、{ file } 原样交给宿主替换、段原样交回", async () => {
  runs = [];
  const pending = host.callService({ point: "files.details", service: "media", method: "inspect", granted: ["process.run"], request: { files: [file] } });
  await tick();
  releaseRun();
  const outcome = await pending;
  assert.deepEqual(outcome.result, {
    ok: true,
    value: { sections: [{ title: "概要", rows: [{ label: "文件", value: "song.flac" }, { label: "输出", value: '{"ok":true}' }] }] },
  });
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].arguments, ["--Output=JSON", { file: handle }]);
  assert.equal(runs[0].output, "text");
  assert.equal(runs[0].directory, undefined, "详情没有暂存目录");
});

test("files.details · inspect 被取消（用户换了选中）：signal 触发、进程被 cancel", async () => {
  cancelled = false;
  cancels = [];
  const callId = host.nextCallId;
  const pending = host.callService({ point: "files.details", service: "media", method: "inspect", granted: ["process.run"], request: { files: [file] } });
  await tick();
  host.cancelService(callId);
  const outcome = await pending;
  assert.equal(cancelled, true);
  assert.equal(cancels.length, 1, "进行中的进程收到 process.cancel");
  assert.ok(outcome.result, "取消之后照常交回一次结果（宿主不再看）");
});

test("files.details 不认识的方法：交回 capability.unknown，不抛", async () => {
  const outcome = await host.callService({ point: "files.details", service: "media", method: "run" });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "capability.unknown");
});

test("fileDetailsLimits 与 bridge schema 的 fileDetailsResult 同一份上限", () => {
  assert.deepEqual({ ...fileDetailsLimits }, { sections: 16, rows: 80, title: 32, label: 40, value: 500, notice: 200, extensions: 128 });
});
