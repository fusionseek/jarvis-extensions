/**
 * 对着构建产物跑：宿主替身经 `files.details` 调 `describe / inspect`。
 * **从不执行真的 mediainfo / ffprobe**：`process.locate` / `process.run` / `process.cancel` 全是桩，输出回放 `test/fixtures/` 里的样例。
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost } from "../../../sdk/dist/testing.js";
import { assertContract, assertDescribeContract, byTitle, fixture } from "./support.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "..", "extension.json"), "utf8"));

let installed;
let chosen;
let located;
let runs;
let cancels;
let reply;

const host = createTestHost({
  async: {
    "process.locate": async ({ executable }) => {
      located.push(executable);
      // 带 / 的是设置里选的路径：在就照原样交回（custom），不在就报坏——宿主就是这样答的。
      if (executable.includes("/")) return chosen.has(executable) ? { path: executable, source: "custom" } : { path: null, problem: "missing" };
      return installed.has(executable) ? { path: `/opt/homebrew/bin/${executable}`, source: "discovered" } : { path: null, problem: "notFound" };
    },
    "process.run": async (params) => {
      runs.push(params);
      return reply(params);
    },
    "process.cancel": (params) => {
      cancels.push(params);
      return null;
    },
  },
});
await import(join(here, "..", "dist", "extension.js"));

const handle = "file-0123456789abcdef0123456789abcdef";
const fileOf = (name, extension, category = "video") => ({ file: handle, name, extension, category, size: 2411583, folder: false });
const inspect = (file = fileOf("rich.mkv", "mkv"), preferences = {}) =>
  host.callService({ point: "files.details", service: "media", method: "inspect", preferences, granted: ["process.run"], request: { files: [file] } });

/** 工具名 → 这一次回放的输出。 */
let outputs;

beforeEach(() => {
  installed = new Set();
  chosen = new Set();
  located = [];
  runs = [];
  cancels = [];
  outputs = {};
  reply = (params) => {
    const name = params.executable.split("/").pop();
    const output = outputs[name];
    if (!output) throw new Error(`没给 ${name} 准备输出`);
    return typeof output === "function" ? output(params) : { exitCode: 0, stderr: "", stdout: output };
  };
});

/** manifest 里声明的那组参数，`{file}` 换成这一次传的句柄对象——宿主就是这样逐项比的。 */
function declaredArguments(executable) {
  const entry = manifest.process.executables.find((item) => item.name === executable);
  assert.ok(entry, `${executable} 没在 manifest 里声明`);
  assert.equal(entry.arguments.length, 1, "每个工具只声明一组参数");
  return entry.arguments[0].map((argument) => (argument === "{file}" ? { file: handle } : argument));
}

test("describe：认 video / audio 与一张容器扩展名表，不跑任何工具、合契约", async () => {
  const outcome = await host.callService({ point: "files.details", service: "media", method: "describe" });
  assert.equal(outcome.result.ok, true);
  assertDescribeContract(outcome.result.value);
  assert.deepEqual(outcome.result.value.categories, ["video", "audio"]);
  assert.ok(outcome.result.value.extensions.includes("mkv"));
  assert.equal(runs.length, 0);
});

test("inspect：装了 mediainfo 就只跑它，参数与 manifest 声明逐项相等，收整份 stdout，没有 notice", async () => {
  installed = new Set(["mediainfo", "ffprobe"]);
  outputs.mediainfo = fixture("mediainfo-matroska.json");
  const outcome = await inspect();
  assert.equal(outcome.result.ok, true, JSON.stringify(outcome.result.error));
  assertContract(outcome.result.value);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].executable, "/opt/homebrew/bin/mediainfo");
  assert.deepEqual(runs[0].arguments, declaredArguments("mediainfo"));
  assert.equal(runs[0].output, "text");
  assert.equal(runs[0].directory, undefined, "详情没有暂存目录");
  assert.equal(outcome.result.value.notice, undefined);
  const by = byTitle(outcome.result.value.sections);
  assert.equal(by["概要"]["格式"], "Matroska（版本 4）");
  assert.equal(by["视频"]["分辨率"], "1 920 × 1 080 像素");
});

test("inspect：只有 ffprobe 时用它（参数与 manifest 逐项相等），notice 说装上 MediaInfo 能读出更多", async () => {
  installed = new Set(["ffprobe"]);
  outputs.ffprobe = fixture("ffprobe-mp4.json");
  const outcome = await inspect(fileOf("out.mp4", "mp4"));
  assert.equal(outcome.result.ok, true, JSON.stringify(outcome.result.error));
  assertContract(outcome.result.value);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].arguments, declaredArguments("ffprobe"));
  assert.ok(runs[0].arguments.length <= 8, "一组至多 8 个参数");
  assert.equal(outcome.result.value.notice, "用的是 ffprobe；装上 MediaInfo 命令行（brew install media-info）能读出更多。");
  assert.equal(byTitle(outcome.result.value.sections)["视频"]["格式"], "AVC（High 4:4:4 Predictive@L3.1）");
});

test("inspect：两样都没装，交回给用户看的那一句（host.failure），一个进程都不跑", async () => {
  const outcome = await inspect();
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "host.failure");
  assert.equal(outcome.result.error.message, "没找到 mediainfo 或 ffprobe：在「设置 · 文件 · 文件详情」里装一个（brew install media-info 或 brew install ffmpeg）");
  assert.equal(runs.length, 0);
});

test("inspect：mediainfo 吐的不是 JSON 时换 ffprobe，notice 写清楚为什么；只有 mediainfo 时把原因交给用户", async () => {
  installed = new Set(["mediainfo", "ffprobe"]);
  outputs.mediainfo = "General\nComplete name : rich.mkv\n";
  outputs.ffprobe = fixture("ffprobe-matroska.json");
  const fallback = await inspect();
  assert.equal(fallback.result.ok, true, JSON.stringify(fallback.result.error));
  assert.deepEqual(runs.map((run) => run.executable.split("/").pop()), ["mediainfo", "ffprobe"]);
  assert.equal(fallback.result.value.notice, "mediainfo 没读出来（输出不是 JSON），这次用的是 ffprobe。");

  installed = new Set(["mediainfo"]);
  const alone = await inspect();
  assert.equal(alone.result.ok, false);
  assert.equal(alone.result.error.message, "mediainfo 交回的不是 JSON：它的版本可能太旧，跑一次 brew upgrade media-info 再试。");
});

test("inspect：ffprobe 起不来（Homebrew 升级了它依赖的库，dyld 在启动时就停）——叫用户 brew upgrade ffmpeg", async () => {
  installed = new Set(["ffprobe"]);
  outputs.ffprobe = () => ({
    exitCode: -6,
    stderr:
      "dyld[5750]: Library not loaded: /opt/homebrew/opt/x265/lib/libx265.215.dylib\n  Referenced from: <B06DD045> /opt/homebrew/Cellar/ffmpeg/8.0/bin/ffprobe\n  Reason: tried: '/opt/homebrew/opt/x265/lib/libx265.215.dylib' (no such file)",
    stdout: "",
  });
  const outcome = await inspect();
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.message, "ffprobe 起不来：它依赖的库被 Homebrew 升级换掉了。在终端里跑 brew upgrade ffmpeg（不行就 brew reinstall ffmpeg）再试。");
});

test("inspect：ffprobe 读不了（空文件：退出码 1、stdout 是 {}）——写 stderr 的最后一句，不带路径", async () => {
  installed = new Set(["ffprobe"]);
  outputs.ffprobe = () => ({
    exitCode: 1,
    stderr: "[mov,mp4,m4a,3gp,3g2,mj2 @ 0xb2f04c000] moov atom not found\n/Users/me/Movies/empty.mov: Invalid data found when processing input\n",
    stdout: "{\n\n}\n",
  });
  const outcome = await inspect(fileOf("empty.mov", "mov"));
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.message, "ffprobe 读不了这个文件：Invalid data found when processing input");
});

test("inspect：mediainfo 认不出格式就再试 ffprobe；两个都认不出时合成一句", async () => {
  installed = new Set(["mediainfo", "ffprobe"]);
  outputs.mediainfo = fixture("mediainfo-empty.json");
  outputs.ffprobe = () => ({ exitCode: 0, stderr: "", stdout: "{}" });
  const outcome = await inspect(fileOf("empty.mov", "mov"));
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.message, "mediainfo 与 ffprobe 都认不出这个文件的格式：它可能不是影音文件，或者已经损坏。");
  assert.equal(runs.length, 2);
});

test("inspect：上百条章节截到 40 行、整份过契约", async () => {
  installed = new Set(["mediainfo"]);
  outputs.mediainfo = fixture("mediainfo-movie-hdr.json");
  const outcome = await inspect(fileOf("movie.mkv", "mkv"));
  assert.equal(outcome.result.ok, true);
  assertContract(outcome.result.value);
  const chapters = outcome.result.value.sections.find((section) => section.title === "章节");
  assert.equal(chapters.rows.length, 40);
  assert.equal(chapters.rows.at(-1).value, "共 60 章，这里只列出前 39 章");
});

test("inspect 被取消（用户换了选中）：进行中的进程收到 process.cancel，交回 cancelled，不再试下一个工具", async () => {
  installed = new Set(["mediainfo", "ffprobe"]);
  let finish;
  outputs.mediainfo = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const callId = host.nextCallId;
  const pending = inspect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runs.length, 1, "mediainfo 已经在跑");
  host.cancelService(callId);
  // 真宿主收到 process.cancel 之后以 cancelled 拒绝那一次 run；替身里让它照常结束，扩展也要认得出这一次已经取消了。
  finish({ exitCode: 0, stderr: "", stdout: fixture("mediainfo-matroska.json") });
  const outcome = await pending;
  assert.equal(cancels.length, 1);
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "cancelled");
  assert.equal(runs.length, 1, "取消之后不再起 ffprobe");
});

test("inspect：文件夹不读（describe 没认文件夹，宿主不该交过来）", async () => {
  installed = new Set(["mediainfo"]);
  const outcome = await inspect({ ...fileOf("Movies", ""), category: "folder", folder: true, size: undefined });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "invalid.argument");
  assert.equal(runs.length, 0);
});

test("manifest：每个工具只声明代码里真的会跑的那一组参数，{file} 独占一项", () => {
  assert.deepEqual(
    manifest.process.executables.map((entry) => [entry.name, entry.arguments]),
    [
      ["mediainfo", [["--Output=JSON", "{file}"]]],
      ["ffprobe", [["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", "{file}"]]],
    ],
  );
  assert.deepEqual(manifest.capabilities.map((capability) => capability.id), ["process.run", "terminal.run"]);
  assert.deepEqual(manifest.contributes.services.map((service) => [service.point, service.id]), [["files.details", "media"]]);
});

test("manifest：两个工具各一项 executable 偏好，「在终端中安装 / 修复」指向声明过的脚本，脚本装过就更新、没装就安装", () => {
  const preferences = manifest.contributes.services[0].preferences;
  assert.deepEqual(preferences.map((item) => [item.key, item.type, item.executable, item.install]), [
    ["mediainfoPath", "executable", "mediainfo", "install-media-info"],
    ["ffprobePath", "executable", "ffprobe", "install-ffmpeg"],
  ]);
  const scripts = Object.fromEntries(manifest.process.terminal.map((item) => [item.id, item.script.join("\n")]));
  for (const [id, formula] of [["install-media-info", "media-info"], ["install-ffmpeg", "ffmpeg"]]) {
    assert.ok(scripts[id], `${id} 没声明`);
    assert.match(scripts[id], new RegExp(`brew list --formula ${formula}`));
    assert.match(scripts[id], new RegExp(`brew upgrade ${formula}`), "装过就更新（起不来时就是这一步修好）");
    assert.match(scripts[id], new RegExp(`brew install ${formula}`));
    assert.match(scripts[id], /read -r _/, "跑完停住，让人看清结果");
  }
});

test("inspect：设置里选过路径就用选的那一份，不再自动找", async () => {
  installed = new Set(["mediainfo"]);
  chosen = new Set(["/Users/me/bin/mediainfo"]);
  outputs.mediainfo = fixture("mediainfo-matroska.json");
  const outcome = await inspect(undefined, { mediainfoPath: "/Users/me/bin/mediainfo" });
  assert.equal(outcome.result.ok, true, JSON.stringify(outcome.result.error));
  assert.equal(located[0], "/Users/me/bin/mediainfo");
  assert.equal(runs[0].executable, "/Users/me/bin/mediainfo");
});

test("inspect：选的路径坏了就报坏、不悄悄换成自动找到的那一份；另一个工具照常能用", async () => {
  installed = new Set(["mediainfo"]);
  const broken = await inspect(undefined, { mediainfoPath: "/Users/me/bin/mediainfo" });
  assert.equal(broken.result.ok, false);
  assert.match(broken.result.error.message, /设置里选的 mediainfo 不可用：\/Users\/me\/bin\/mediainfo/);
  assert.equal(runs.length, 0, "没有退回 /opt/homebrew/bin/mediainfo");

  installed = new Set(["ffprobe"]);
  outputs.ffprobe = fixture("ffprobe-mp4.json");
  const fallback = await inspect(fileOf("clip.mp4", "mp4"), { mediainfoPath: "/Users/me/bin/mediainfo" });
  assert.equal(fallback.result.ok, true, JSON.stringify(fallback.result.error));
  assert.match(fallback.result.value.notice, /mediainfo 没读出来（选的路径不可用）/);
});
