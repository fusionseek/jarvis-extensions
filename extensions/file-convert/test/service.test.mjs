/**
 * 对着构建产物跑：宿主替身经 `files.actions` 调 `describe / run`。
 * **从不执行真的转换工具**：`process.locate` / `process.run` 全是桩；ffmpeg 的进度行由桩经订阅推过去。
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
      installed.has(executable) ? { path: `/usr/bin/${executable}`, source: "discovered" } : { path: null, problem: "notFound" },
    "process.run": async (params) => {
      runs.push(params);
      return reply(params);
    },
    "process.cancel": () => null,
  },
});
await import(join(here, "..", "dist", "extension.js"));

const directory = "dir-0123456789abcdef0123456789abcdef";
const handle = (index) => `file-${String(index).padStart(32, "0")}`;
const file = (index, name, extension, category) => ({ file: handle(index), name, extension, category, size: 1024, folder: false });
const run = (action, files) =>
  host.callService({ point: "files.actions", service: "convert", method: "run", granted: ["process.run"], request: { action, files, directory } });

beforeEach(() => {
  installed = new Set(["sips", "afconvert", "avconvert", "textutil", "plutil"]);
  runs = [];
  reply = () => ({ exitCode: 0, stderr: "" });
});

test("describe：一组、带产物类型；只有系统自带的工具时不报要装工具的格式", async () => {
  const outcome = await host.callService({ point: "files.actions", service: "convert", method: "describe" });
  assert.equal(outcome.result.ok, true);
  const value = outcome.result.value;
  assert.equal(value.groups[0].title, "格式转换");
  assert.ok(value.actions.every((action) => action.group === "convert" && action.produces));
  assert.ok(!value.actions.some((action) => action.id === "to-mp3"));
  assert.equal(runs.length, 0, "describe 不跑任何工具");
});

test("run：sips 一张一张转、产物名换扩展名，逐个报进度", async () => {
  const outcome = await run("to-jpg", [file(1, "a.png", "png", "image"), file(2, "b.heic", "heic", "image")]);
  assert.equal(outcome.result.ok, true, JSON.stringify(outcome.result));
  assert.deepEqual(outcome.result.value.outputs, ["a.jpg", "b.jpg"]);
  assert.deepEqual(runs.map((params) => params.arguments), [
    ["-s", "format", "jpeg", { file: handle(1) }, "--out", { output: "a.jpg" }],
    ["-s", "format", "jpeg", { file: handle(2) }, "--out", { output: "b.jpg" }],
  ]);
  assert.ok(runs.every((params) => params.directory === directory), "产物写进暂存目录");
  const perFile = outcome.progress.flatMap((progress) => progress.files ?? []);
  assert.deepEqual(perFile.filter((entry) => entry.fraction === 1).map((entry) => entry.index), [0, 1], "每一项做完报 1");
});

test("run：ffmpeg 的进度按 ffprobe 读到的时长算成百分比", async () => {
  installed.add("ffmpeg");
  installed.add("ffprobe");
  reply = (params) => {
    if (params.executable.endsWith("ffprobe")) return { exitCode: 0, stderr: "", stdout: "4.000000\n" };
    host.emit(params.token, { lines: ["out_time_us=1000000", "progress=continue"] });
    host.emit(params.token, { lines: ["out_time_us=3000000", "progress=end"] });
    return { exitCode: 0, stderr: "" };
  };
  const outcome = await run("to-mp3", [file(1, "clip.mov", "mov", "video")]);
  assert.equal(outcome.result.ok, true, JSON.stringify(outcome.result));
  assert.deepEqual(outcome.result.value.outputs, ["clip.mp3"]);
  const fractions = outcome.progress.flatMap((progress) => progress.files ?? []).map((entry) => entry.fraction);
  assert.ok(fractions.includes(1), `${fractions}`);
  assert.ok(fractions.some((fraction) => fraction > 0 && fraction < 1), `中间有百分比：${fractions}`);
});

test("run：两步的路线（DOC → Markdown）中间产物写在暂存目录、只交回最后一步的", async () => {
  installed.add("pandoc");
  const outcome = await run("to-md", [file(1, "notes.doc", "doc", "text")]);
  assert.equal(outcome.result.ok, true, JSON.stringify(outcome.result));
  assert.deepEqual(outcome.result.value.outputs, ["notes.md"]);
  assert.deepEqual(runs.map((params) => params.executable.split("/").pop()), ["textutil", "pandoc"]);
  assert.deepEqual(runs[1].arguments, [{ output: "notes.html" }, "-t", "gfm", "-o", { output: "notes.md" }], "第二步的输入是暂存目录里的中间产物");
});

test("run：一项失败不挡别的；全失败时报错（写给用户的那一句）", async () => {
  reply = (params) => (params.arguments.some((argument) => argument.file === handle(2)) ? { exitCode: 1, stderr: "Error: Unable to render destination image" } : { exitCode: 0, stderr: "" });
  const partial = await run("to-png", [file(1, "a.jpg", "jpg", "image"), file(2, "b.jpg", "jpg", "image")]);
  assert.deepEqual(partial.result.value.outputs, ["a.png"]);
  assert.match(partial.result.value.message, /1 个没转成：b\.jpg：sips：Error: Unable to render destination image/);
  reply = () => ({ exitCode: 1, stderr: "boom" });
  const failed = await run("to-png", [file(1, "a.jpg", "jpg", "image")]);
  assert.equal(failed.result.ok, false);
  assert.match(failed.result.error.message, /boom/);
});

test("run：LibreOffice 的产物名由输入定；同一批里撞名的那一项不转", async () => {
  installed.add("soffice");
  const outcome = await run("to-pdf", [file(1, "report.docx", "docx", "text"), file(2, "report.xlsx", "xlsx", "table")]);
  assert.deepEqual(outcome.result.value.outputs, ["report.pdf"]);
  assert.match(outcome.result.value.message, /LibreOffice 不让另起名字/);
  assert.deepEqual(runs[0].arguments, ["--headless", "--convert-to", "pdf", { file: handle(1) }]);
});
