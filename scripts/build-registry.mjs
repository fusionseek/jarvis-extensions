#!/usr/bin/env node
/**
 * 从各扩展的 extension.json 生成仓库根的 registry.json。
 *
 * 宿主只读 registry.json 来罗列扩展库；它是 manifest 的投影加三样宿主安装时要的事实：
 * 目录、产物指纹（SHA-256 与字节数）、更新时间。**不得手改**——每次改动跑一次本脚本；
 * CI 用 --check 校验已提交的那一份没有落后。
 *
 * 用法：
 *   node scripts/build-registry.mjs          生成
 *   node scripts/build-registry.mjs --check  校验（忽略 generatedAt / source.commit / updatedAt 这三个随时间变的字段）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { checkExtension, collectedProblems, extensionDirectories } from "./validate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "registry.json");
const REPOSITORY = "https://github.com/fusionseek/jarvis-extensions";
const CHECK = process.argv.includes("--check");
const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`\x1b[31m[build-registry] ${message}\x1b[0m`);
  process.exit(1);
}

function git(args) {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const commit = git(["rev-parse", "HEAD"]) || "0".repeat(40);

const entries = [];
for (const dir of extensionDirectories()) {
  const manifest = checkExtension(dir);
  if (!manifest) fail(`${dir} 没通过校验，先跑 node scripts/validate.mjs`);
  const bundlePath = join(dir, manifest.main);
  const bytes = readFileSync(bundlePath);
  const rel = relative(ROOT, dir).split("\\").join("/");
  const updatedAt = git(["log", "-1", "--format=%cI", "--", rel]) || new Date().toISOString();
  const entry = {
    id: manifest.id,
    version: manifest.version,
    toolbox: manifest.toolbox,
    description: manifest.description,
    author: manifest.author,
    sdk: manifest.sdk,
    minimumJarvisVersion: manifest.minimumJarvisVersion,
    capabilities: manifest.capabilities.map((c) => c.id),
    settings: manifest.settings !== false,
    inbox: manifest.inbox,
    background: manifest.background ?? false,
    path: rel,
    bundle: {
      path: `${rel}/${manifest.main}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteCount: bytes.length,
    },
    updatedAt,
  };
  if (manifest.repository) entry.repository = manifest.repository;
  if (manifest.network) entry.network = manifest.network;
  if (manifest.commands?.length) {
    entry.commands = manifest.commands.map((c) => ({
      id: c.id,
      title: c.title,
      ...(c.hotkey ? { hotkey: c.hotkey.default } : {}),
      presentation: c.presentation,
    }));
  }
  entries.push(entry);
}
entries.sort((a, b) => a.id.localeCompare(b.id));

// 校验没过就不生成：一份带着已知问题的 registry 会被宿主原样读走。
const problems = collectedProblems();
if (problems.length) {
  for (const p of problems) console.error(`  - ${p}`);
  fail("有扩展没通过校验，不生成 registry.json");
}

const registry = {
  registryVersion: 1,
  generatedAt: new Date().toISOString(),
  source: { repository: REPOSITORY, commit },
  extensions: entries,
};

// 生成物也要过自己的 schema：写出一份宿主读不了的 registry 比不写更糟。
const Ajv = require("ajv/dist/2020.js");
const addFormats = require("ajv-formats");
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "registry.v1.schema.json"), "utf8")));
if (!validate(registry)) {
  for (const err of validate.errors ?? []) console.error(`  - ${err.instancePath || "/"} ${err.message}`);
  fail("生成的 registry.json 不符合 schemas/registry.v1.schema.json");
}

const stable = (r) => ({
  ...r,
  generatedAt: undefined,
  source: { ...r.source, commit: undefined },
  extensions: r.extensions.map((e) => ({ ...e, updatedAt: undefined })),
});

if (CHECK) {
  if (!existsSync(OUT)) fail("registry.json 不存在，跑一次 node scripts/build-registry.mjs");
  const current = JSON.parse(readFileSync(OUT, "utf8"));
  if (JSON.stringify(stable(current)) !== JSON.stringify(stable(registry))) {
    fail("registry.json 已落后于各扩展的 manifest 或产物。跑一次 node scripts/build-registry.mjs 再提交。");
  }
  console.log(`[build-registry] registry.json 与 ${entries.length} 个扩展一致。`);
} else {
  writeFileSync(OUT, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`[build-registry] 写出 ${entries.length} 个扩展 → registry.json`);
}
