import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// Git 的代码格式化（SDK 2.7）：code.format 的服务分派，process.run 的 stdin / directory / output 三个选项上线缆的样子。
let runs = [];
const host = createTestHost({
  async: {
    "process.run": async (params) => {
      runs.push(params);
      return { exitCode: 0, stderr: "", stdout: params.stdin?.toUpperCase() ?? "" };
    },
  },
});
const { defineExtension, jarvis, sdkVersion } = await import("../dist/index.js");

defineExtension({
  services: {
    formatters: {
      describe(context) {
        return { languages: [{ id: "swift", available: context.granted.includes("process.run"), tool: "swift-format" }] };
      },
      async format(request) {
        const run = jarvis.process.run({ executable: "swift-format", arguments: ["format"], stdin: request.text, directory: request.directory, output: "text" });
        const result = await run.result;
        return { text: result.stdout, tool: "swift-format" };
      },
    },
  },
});

test("SDK 是 2.12.0", () => {
  assert.equal(sdkVersion, "2.12.0");
});

test("code.format · describe：拿到宿主给的授权，语言清单经 service.resolve 交回", async () => {
  const outcome = await host.callService({ point: "code.format", service: "formatters", method: "describe", granted: ["process.run"] });
  assert.deepEqual(outcome.result, { ok: true, value: { languages: [{ id: "swift", available: true, tool: "swift-format" }] } });
});

test("code.format · format：入参原样交给实现；stdin / directory / output 上线缆", async () => {
  runs = [];
  const request = { language: "swift", fileName: "A.swift", text: "let a=1\n", directory: "dir-0123456789abcdef0123456789abcdef" };
  const outcome = await host.callService({ point: "code.format", service: "formatters", method: "format", granted: ["process.run"], request });
  assert.deepEqual(outcome.result, { ok: true, value: { text: "LET A=1\n", tool: "swift-format" } });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].stdin, "let a=1\n");
  assert.equal(runs[0].directory, "dir-0123456789abcdef0123456789abcdef");
  assert.equal(runs[0].output, "text");
  assert.deepEqual(runs[0].arguments, ["format"]);
});

test("process.run 没给新选项时与 2.6 的请求一字不差", async () => {
  runs = [];
  await jarvis.process.run({ executable: "mo", arguments: ["--version"] }).result;
  assert.deepEqual(Object.keys(runs[0]).sort(), ["arguments", "executable", "token"]);
});

test("code.format 不认识的方法：交回 capability.unknown，不抛", async () => {
  const outcome = await host.callService({ point: "code.format", service: "formatters", method: "catalog" });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "capability.unknown");
});
