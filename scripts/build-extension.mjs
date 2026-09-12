#!/usr/bin/env node
/**
 * 把一个扩展目录构建成 dist/extension.js。
 *
 * 一次 esbuild bundle：IIFE、ES2020、不压缩、SDK 内联。**不压缩**是刻意的——产物提交进仓库，
 * 审核者要读得了它；体积上限 512 KB 对不压缩的产物也绰绰有余。
 *
 * SDK 从源码解析（alias 到 sdk/src/index.ts），因此不需要先构建 SDK；宿主也永远拿不到一份
 * "与仓库里的 SDK 源码不一致"的产物。
 *
 * 用法：
 *   node scripts/build-extension.mjs extensions/<id>          构建一次
 *   node scripts/build-extension.mjs extensions/<id> --watch  改动即重建
 *   node scripts/build-extension.mjs --all                    构建 extensions/ 下全部
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SDK_ENTRY = join(ROOT, "sdk", "src", "index.ts");
const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`\x1b[31m[build-extension] ${message}\x1b[0m`);
  process.exit(1);
}

let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  fail("找不到 esbuild。在仓库根目录跑一次 npm install。");
}

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const all = args.includes("--all");
const targets = all
  ? readdirSync(join(ROOT, "extensions"))
      .map((name) => join(ROOT, "extensions", name))
      .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, "extension.json")))
  : args.filter((a) => !a.startsWith("--")).map((a) => resolve(a));

if (targets.length === 0) fail("给一个扩展目录，或 --all。");
if (watch && targets.length !== 1) fail("--watch 一次只看一个目录。");

async function build(dir) {
  const manifestPath = join(dir, "extension.json");
  if (!existsSync(manifestPath)) fail(`${dir} 里没有 extension.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = join(dir, "src", "index.ts");
  if (!existsSync(entry)) fail(`${dir} 里没有 src/index.ts`);
  const outfile = join(dir, manifest.main ?? "dist/extension.js");
  const sdkVersion = JSON.parse(readFileSync(join(ROOT, "sdk", "package.json"), "utf8")).version;

  const options = {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    platform: "neutral",
    target: ["es2020"],
    minify: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "info",
    alias: { "@fusionseek/jarvis-extension-sdk": SDK_ENTRY },
    // 没有 node 内置模块可用：宿主里只有 ES2020 标准库。
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: `// jarvis-extension bundle · ${manifest.id}@${manifest.version} · sdk ${sdkVersion} · 由 scripts/build-extension.mjs 生成，请勿手改` },
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log(`[build-extension] 监视 ${dir} …（Ctrl-C 退出）`);
    return;
  }
  await esbuild.build(options);
  const size = statSync(outfile).size;
  if (size > 512 * 1024) fail(`${outfile} 有 ${size} 字节，超过 512 KB 上限。`);
  console.log(`[build-extension] ${manifest.id}@${manifest.version} → ${outfile}（${size} 字节）`);
}

for (const dir of targets) {
  // eslint-disable-next-line no-await-in-loop
  await build(dir);
}
