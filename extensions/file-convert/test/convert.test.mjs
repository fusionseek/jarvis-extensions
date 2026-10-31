/**
 * 纯函数：路线规划、describe、命令与 manifest、进度解析。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extensionRoot, loadSource } from "./support.mjs";
import { generatedExecutables } from "../scripts/generate-manifest.mjs";

const source = await loadSource();
const manifest = JSON.parse(readFileSync(join(extensionRoot, "extension.json"), "utf8"));
const builtins = new Set(["sips", "afconvert", "avconvert", "textutil", "plutil"]);
const everything = new Set([...builtins, "ffmpeg", "ffprobe", "magick", "pandoc", "soffice"]);
const toolsOf = (steps) => steps.map((step) => step.conversion.tool);

test("路线：一步能到的走一步，先用系统自带的", () => {
  assert.deepEqual(toolsOf(source.plan("png", "jpg", everything)), ["sips"]);
  assert.deepEqual(toolsOf(source.plan("wav", "m4a", everything)), ["afconvert"], "afconvert 比 ffmpeg 便宜");
  assert.deepEqual(toolsOf(source.plan("mov", "mp4", everything)), ["avconvert"]);
  assert.deepEqual(toolsOf(source.plan("mkv", "mp4", everything)), ["ffmpeg"], "avconvert 读不了 MKV");
  assert.deepEqual(toolsOf(source.plan("docx", "rtf", everything)), ["textutil"]);
  assert.deepEqual(toolsOf(source.plan("png", "webp", everything)), ["magick"]);
  assert.deepEqual(toolsOf(source.plan("png", "webp", new Set([...builtins, "ffmpeg"]))), ["ffmpeg"], "没有 ImageMagick 时 FFmpeg 写 WebP");
  assert.equal(source.plan("png", "png", everything), undefined, "同一种格式不转");
});

test("路线：一步到不了的拆两步，至多两步；工具不在就到不了", () => {
  const doc = source.plan("doc", "md", everything);
  assert.deepEqual(toolsOf(doc), ["textutil", "pandoc"]);
  assert.equal(doc[0].to, "html");
  assert.equal(source.plan("doc", "md", builtins), undefined, "没有 pandoc：Markdown 到不了");
  assert.equal(source.plan("mp3", "mp4", everything), undefined, "音频转不成视频");
  assert.equal(source.plan("png", "mp3", everything), undefined);
});

test("describe：一组「格式转换」，每个格式认的源按此刻的工具算；只用系统自带时没有 MP3 / WebP / Markdown", () => {
  const described = source.describeActions(builtins);
  assert.deepEqual(described.groups, [{ id: "convert", title: "格式转换", symbol: "arrow.triangle.2.circlepath" }]);
  const ids = described.actions.map((action) => action.id);
  for (const id of ["to-png", "to-jpg", "to-heic", "to-pdf", "to-m4a", "to-mp4", "to-docx", "to-json"]) assert.ok(ids.includes(id), id);
  for (const id of ["to-mp3", "to-webp", "to-md", "to-mkv"]) assert.ok(!ids.includes(id), `${id} 要装工具`);
  for (const action of described.actions) {
    assert.equal(action.group, "convert");
    assert.equal(action.produces, action.id.slice(3));
    assert.match(action.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    assert.ok(action.title.length >= 1 && action.title.length <= 24);
    assert.ok(action.extensions.length >= 1 && action.extensions.length <= 64);
    for (const extension of action.extensions) assert.match(extension, /^[a-z0-9][a-z0-9+_-]{0,15}$/);
  }
  const png = described.actions.find((action) => action.id === "to-png");
  assert.ok(!png.extensions.includes("png"), "转 PNG 不出现在 PNG 上");
  assert.ok(png.extensions.includes("jpeg"), "别名也认");
  const full = source.describeActions(everything);
  assert.ok(full.actions.length <= 64);
  assert.ok(full.actions.some((action) => action.id === "to-mp3"));
  const forPng = full.actions.filter((action) => action.extensions.includes("png"));
  assert.ok(forPng.length <= 12, `一张 PNG 的外圈至多 12 片（${forPng.map((action) => action.id).join(" ")}）`);
});

test("manifest 的 process.executables 就是引擎表生成的那一份", async () => {
  assert.deepEqual(manifest.process.executables, await generatedExecutables());
  for (const executable of manifest.process.executables) {
    assert.ok(executable.arguments.length <= 64, `${executable.name} 至多 64 组`);
    for (const shape of executable.arguments) {
      assert.ok(shape.length <= 32);
      for (const argument of shape) assert.match(argument, /^[^\s;&|`$<>]+$/u, `${executable.name}: ${argument}`);
    }
  }
});

test("发出的每一条命令都与声明的某一组逐项相等（输入是原文件或中间产物）", () => {
  const declared = new Map(manifest.process.executables.map((item) => [item.name, item.arguments.map((shape) => JSON.stringify(shape))]));
  const placeholder = (argument) => (typeof argument === "string" ? argument : "file" in argument ? "{file}" : "{output}");
  for (const conversion of source.conversions) {
    for (const input of [{ file: "file-0123456789abcdef0123456789abcdef" }, { output: "a.html" }]) {
      const args = source.expand(conversion.template, input, conversion.tool === "soffice" ? undefined : "out.x").map(placeholder);
      assert.ok(declared.get(conversion.tool)?.includes(JSON.stringify(args)), `${conversion.tool} → ${conversion.to}: ${args.join(" ")}`);
    }
  }
});

test("进度：ffmpeg 按时长算、做完 100%；avconvert 读百分比", () => {
  assert.equal(source.ffmpegFraction("out_time_us=1500000", 3), 0.5);
  assert.equal(source.ffmpegFraction("out_time_ms=6000000", 3), 0.99, "超了也停在 99%，做完才 100%");
  assert.equal(source.ffmpegFraction("progress=end", undefined), 1);
  assert.equal(source.ffmpegFraction("out_time_us=1500000", undefined), undefined, "不知道时长：只认做完");
  assert.equal(source.ffmpegFraction("bitrate=  41.6kbits/s", 3), undefined);
  assert.equal(source.avconvertFraction("avconvert progress:  37.50% complete"), 0.375);
  assert.equal(source.avconvertFraction("avconvert completed with error:0."), undefined);
  assert.equal(source.parseDuration("12.345000\n"), 12.345);
  assert.equal(source.parseDuration("N/A"), undefined);
});

test("产物名：原名换扩展名；同一批重名加「 2」（不分大小写）；不以点开头", () => {
  const taken = new Set();
  assert.equal(source.outputName("a.PNG", "jpg", taken), "a.jpg");
  assert.equal(source.outputName("A.heic", "jpg", taken), "A 2.jpg");
  assert.equal(source.outputName(".hidden.png", "jpg", taken), "hidden.jpg");
});
