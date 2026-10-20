/**
 * 对着构建产物跑：宿主替身经 `code.format` 调 `describe / format`。
 * **从不执行真的格式化工具**：`process.locate` / `process.run` 全是桩。
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost } from "../../../sdk/dist/testing.js";

const here = dirname(fileURLToPath(import.meta.url));
let installed;
let runs;
let reply;

const host = createTestHost({
  async: {
    "process.locate": async ({ executable }) =>
      installed.has(executable) ? { path: executable.startsWith("/") ? executable : `/opt/homebrew/bin/${executable}`, source: "discovered" } : { path: null, problem: "notFound" },
    "process.run": async (params) => {
      runs.push(params);
      return reply(params);
    },
  },
});
await import(join(here, "..", "dist", "extension.js"));

beforeEach(() => {
  installed = new Set();
  runs = [];
  reply = (params) => ({ exitCode: 0, stderr: "", stdout: (params.stdin ?? "").replace(/=/g, " = ") });
});

const DIR = "dir-0123456789abcdef0123456789abcdef";
const describe = () => host.callService({ point: "code.format", service: "formatters", method: "describe", granted: ["process.run"] });
const format = (request, preferences = {}) =>
  host.callService({ point: "code.format", service: "formatters", method: "format", granted: ["process.run"], preferences, request: { directory: DIR, ...request } });

test("describe：装了的语言能用、写出工具；没装的写怎么装；每个工具只找一次", async () => {
  installed = new Set(["clang-format", "prettier"]);
  const outcome = await describe();
  assert.equal(outcome.result.ok, true);
  const byID = Object.fromEntries(outcome.result.value.languages.map((l) => [l.id, l]));
  assert.deepEqual(byID.cpp, { id: "cpp", available: true, tool: "clang-format" });
  assert.deepEqual(byID.java, { id: "java", available: true, tool: "clang-format" }, "google-java-format 没装就用 clang-format");
  assert.deepEqual(byID.yaml, { id: "yaml", available: true, tool: "prettier" });
  assert.equal(byID.kotlin.available, false);
  assert.match(byID.kotlin.message, /brew install ktfmt/);
  assert.equal(byID.sql, undefined, "不认的语言不报");
});

test("describe：xcrun 在、但 swift-format 不在（只装了命令行工具）时 Swift 不能用", async () => {
  installed = new Set(["/usr/bin/xcrun"]);
  reply = (params) => ({ exitCode: params.arguments[0] === "--find" ? 72 : 0, stderr: "xcrun: error: unable to find utility" });
  const outcome = await describe();
  const swift = outcome.result.value.languages.find((l) => l.id === "swift");
  assert.equal(swift.available, false);
  assert.deepEqual(runs.map((r) => r.arguments), [["--find", "swift-format"]]);

  reply = () => ({ exitCode: 0, stderr: "", stdout: "" });
  const again = await describe();
  assert.deepEqual(again.result.value.languages.find((l) => l.id === "swift"), { id: "swift", available: true, tool: "xcrun swift-format" });
});

test("format：原文走 stdin、在文件所在目录里跑、收整份 stdout，参数是声明过的那一组", async () => {
  installed = new Set(["ruff"]);
  const outcome = await format({ language: "python", fileName: "app.py", text: "x=1\n\n\ny=2\n" });
  assert.deepEqual(outcome.result, { ok: true, value: { text: "x = 1\n\n\ny = 2\n", tool: "ruff" } }, "空行一行不少");
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].arguments, ["format", "--stdin-filename", "jarvis-format.py", "-"]);
  assert.equal(runs[0].executable, "/opt/homebrew/bin/ruff");
  assert.equal(runs[0].stdin, "x=1\n\n\ny=2\n");
  assert.equal(runs[0].directory, DIR);
  assert.equal(runs[0].output, "text");
});

test("format：用户填的路径与 Java 风格偏好", async () => {
  installed = new Set(["/opt/tools/google-java-format"]);
  const outcome = await format({ language: "java", fileName: "A.java", text: "class A{}\n" }, { googleJavaFormat: "/opt/tools/google-java-format", javaStyle: "aosp" });
  assert.equal(outcome.result.ok, true);
  assert.equal(runs[0].executable, "/opt/tools/google-java-format");
  assert.deepEqual(runs[0].arguments, ["--aosp", "-"]);
});

test("format：工具退出码非 0 → 失败，原因带 stderr；一个工具都没有 → 失败，写怎么装", async () => {
  installed = new Set(["shfmt"]);
  reply = () => ({ exitCode: 1, stderr: "<standard input>:3:1: reached EOF without closing quote '\n", stdout: "" });
  const failed = await format({ language: "shell", fileName: "run.sh", text: "echo 'x\n" });
  assert.equal(failed.result.ok, false);
  assert.match(failed.result.error.message, /^shfmt 没能格式化（退出码 1）：<standard input>:3:1/);

  installed = new Set();
  const missing = await format({ language: "kotlin", fileName: "A.kt", text: "fun a(){}\n" });
  assert.equal(missing.result.ok, false);
  assert.match(missing.result.error.message, /没找到 ktfmt：brew install ktfmt/);
  assert.equal(runs.length, 1, "没装就不跑");
});

test("format：原文不空、工具却什么都没吐 → 失败（不当成格式化成了空文件）；原文本来就空则照常", async () => {
  installed = new Set(["gofmt"]);
  reply = () => ({ exitCode: 0, stderr: "", stdout: "" });
  const empty = await format({ language: "go", fileName: "main.go", text: "package main\n" });
  assert.equal(empty.result.ok, false);
  const blank = await format({ language: "go", fileName: "main.go", text: "" });
  assert.deepEqual(blank.result, { ok: true, value: { text: "", tool: "gofmt" } });
  assert.deepEqual(runs[0].arguments, []);
});

test("format：不认的语言交回 capability.unknown", async () => {
  const outcome = await format({ language: "sql", fileName: "a.sql", text: "select 1" });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "capability.unknown");
});
