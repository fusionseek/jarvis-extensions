/**
 * 测试共用（不是测试文件）。
 *
 * - `loadSource()` 把 `src/` 里的纯函数模块（解析器、排段、单位）现编成一份 ESM 直接 import——产物 `dist/extension.js` 是 IIFE，
 *   解析器从服务那一面看不到；这里**只在测试时**编译，不落盘、不随扩展发布。
 * - `fixture(name)` 读 `test/fixtures/` 里的样例输出。除 `mediainfo-movie-hdr.json` 是照 MediaInfo JSON 的形状手写的
 *   （测 Dolby Vision、多轨与上百条章节），其余都是真跑出来的：mediainfo 那几份出自 MediaInfoLib 26.10（与 MediaInfo.app 同一个库）、
 *   ffprobe 那几份出自 ffprobe 8.0，对象是 ffmpeg 现生成的测试片（testsrc / sine，2–3 秒）。
 * - `assertContract(result)` 按宿主的 `$defs.fileDetailsResult`（jarvis-mac `contracts/schemas/extensions/bridge.v2.schema.json`，下面逐字抄了一份）
 *   校验一份结果：越界的结果宿主整份拒收，测试里先拦。
 *
 * **从不执行真的 mediainfo / ffprobe**：进程一律由测试替身回放。
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
export const extensionRoot = join(here, "..");
const repositoryRoot = join(extensionRoot, "..", "..");
const require = createRequire(import.meta.url);

/**
 * 现编 `src/` 里的纯函数模块。
 * @returns 模块命名空间（`units`、`report`、`mediainfo`、`ffprobe`、`claims` 的全部导出）。
 */
export async function loadSource() {
  const result = await build({
    stdin: {
      contents: [
        'export * from "./src/units.ts";',
        'export * from "./src/report.ts";',
        'export * from "./src/mediainfo.ts";',
        'export * from "./src/ffprobe.ts";',
        'export * from "./src/claims.ts";',
        'export * from "./src/failures.ts";',
      ].join("\n"),
      resolveDir: extensionRoot,
      loader: "ts",
      sourcefile: "test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: ["es2020"],
    write: false,
    logLevel: "silent",
    alias: { "@fusionseek/jarvis-extension-sdk": join(repositoryRoot, "sdk", "src", "index.ts") },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

/**
 * 读一份样例输出（原文）。
 * @param {string} name `test/fixtures/` 下的文件名。
 * @returns {string}
 */
export function fixture(name) {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

/** 宿主的 `$defs.fileDetailsResult`（逐字抄自 bridge.v2.schema.json）。 */
const fileDetailsResultSchema = {
  type: "object",
  required: ["sections"],
  properties: {
    sections: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        required: ["title", "rows"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 32 },
          rows: {
            type: "array",
            minItems: 1,
            maxItems: 80,
            items: {
              type: "object",
              required: ["label", "value"],
              properties: {
                label: { type: "string", minLength: 1, maxLength: 40 },
                value: { type: "string", minLength: 1, maxLength: 500 },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    notice: { type: "string", maxLength: 200 },
  },
  additionalProperties: false,
};

/** 宿主的 `$defs.fileDetailsDescribe`（逐字抄自 bridge.v2.schema.json）。 */
const fileDetailsDescribeSchema = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      uniqueItems: true,
      items: { enum: ["folder", "image", "video", "audio", "pdf", "archive", "code", "text", "table", "application", "installer", "other"] },
    },
    extensions: { type: "array", minItems: 1, maxItems: 128, uniqueItems: true, items: { type: "string", pattern: "^[a-z0-9][a-z0-9+_-]{0,15}$" } },
    folders: { type: "boolean" },
  },
  additionalProperties: false,
};

const Ajv = require("ajv/dist/2020.js");
const ajv = new Ajv({ allErrors: true, strict: true });
const validateResult = ajv.compile(fileDetailsResultSchema);
const validateDescribe = ajv.compile(fileDetailsDescribeSchema);

/**
 * 断言一份 `inspect` 的结果过得了宿主的契约。
 * @param {unknown} result
 */
export function assertContract(result) {
  const ok = validateResult(result);
  assert.ok(ok, `结果不合契约：${JSON.stringify(validateResult.errors)}`);
}

/**
 * 断言一份 `describe` 的结果过得了宿主的契约。
 * @param {unknown} result
 */
export function assertDescribeContract(result) {
  const ok = validateDescribe(result);
  assert.ok(ok, `describe 不合契约：${JSON.stringify(validateDescribe.errors)}`);
}

/**
 * 段 → `{ 段标题: { 标签: 值 } }`，好按名字断言。
 * @param {{ title: string, rows: { label: string, value: string }[] }[]} sections
 */
export function byTitle(sections) {
  return Object.fromEntries(sections.map((section) => [section.title, Object.fromEntries(section.rows.map((row) => [row.label, row.value]))]));
}
