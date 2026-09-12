#!/usr/bin/env node
/**
 * 校验扩展：schema、跨字段规则、目录约定、产物。
 *
 * schema 是真源（schemas/extension.v1.schema.json），这里用 Ajv 跑它；跨字段规则是 schema
 * 表达不了的那几条，写在下面并与 docs/03-manifest.md 一一对应。任何一条不过即非零退出——
 * 校验脚本不给"警告但通过"，因为通过的 PR 会被合并。
 *
 * 用法：
 *   node scripts/validate.mjs                    校验 extensions/ 下全部
 *   node scripts/validate.mjs extensions/<id>    校验一个
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const RESERVED_IDS = new Set([
  "palette", "clipboard", "base64", "hash", "regex", "url", "json", "time",
  "apk", "datapull", "screenshot", "quicktransfer", "gallery", "extension", "extensions", "jarvis",
]);
const FORBIDDEN_TOKENS = ["XMLHttpRequest", "WebSocket", "require(", "importScripts", "eval(", "new Function("];
const MAX_BUNDLE_BYTES = 512 * 1024;
const OBSERVE_CAPABILITIES = new Set(["clipboard.read", "quickTransfer.status", "tasks.read"]);

let Ajv;
let addFormats;
try {
  Ajv = require("ajv/dist/2020.js");
  addFormats = require("ajv-formats");
} catch {
  console.error("\x1b[31m[validate] 找不到 ajv / ajv-formats。在仓库根目录跑一次 npm install。\x1b[0m");
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateManifest = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "extension.v1.schema.json"), "utf8")));

const problems = [];
function problem(dir, message) {
  problems.push(`${basename(dir)}: ${message}`);
}

/** 到目前为止收集到的全部问题。调用方（build-registry）据此拒绝生成。 */
export function collectedProblems() {
  return [...problems];
}

/** 一个扩展目录的全部检查。返回 manifest（合法时）。 */
export function checkExtension(dir) {
  const manifestPath = join(dir, "extension.json");
  if (!existsSync(manifestPath)) {
    problem(dir, "没有 extension.json");
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    problem(dir, `extension.json 不是合法 JSON：${e.message}`);
    return null;
  }

  if (!validateManifest(manifest)) {
    for (const err of validateManifest.errors ?? []) {
      problem(dir, `schema：${err.instancePath || "/"} ${err.message}`);
    }
    return null;
  }

  // 目录约定
  if (manifest.id !== basename(dir)) problem(dir, `id「${manifest.id}」与目录名不一致`);
  if (RESERVED_IDS.has(manifest.id)) problem(dir, `id「${manifest.id}」是保留 id`);

  // 跨字段规则（docs/03-manifest.md）
  const ids = manifest.capabilities.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) problem(dir, `capabilities 里重复：${[...new Set(dupes)].join("、")}`);
  const has = (id) => ids.includes(id);
  if (has("network.https") !== Boolean(manifest.network)) {
    problem(dir, "network.https 能力与 network.hosts 必须同时出现或同时缺席");
  }
  if (manifest.inbox !== false) {
    if (manifest.inbox.cards && !has("inbox.post")) problem(dir, "inbox.cards 为 true 必须声明 inbox.post");
    if (manifest.inbox.notifications && !has("notifications.post")) problem(dir, "inbox.notifications 为 true 必须声明 notifications.post");
    if (!manifest.inbox.cards && !manifest.inbox.notifications) problem(dir, "inbox 两项都是 false 时直接写 inbox: false");
    if (!manifest.inbox.cards && has("inbox.post")) problem(dir, "声明了 inbox.post 却把 inbox.cards 关着");
  } else {
    if (has("inbox.post")) problem(dir, "声明了 inbox.post 却写了 inbox: false");
    if (has("notifications.post")) problem(dir, "声明了 notifications.post 却写了 inbox: false");
  }
  // 命令与快捷键
  const commands = manifest.commands ?? [];
  const commandIds = commands.map((c) => c.id);
  const dupCommands = commandIds.filter((id, i) => commandIds.indexOf(id) !== i);
  if (dupCommands.length) problem(dir, `commands 里重复的 id：${[...new Set(dupCommands)].join("、")}`);
  const hotkeys = commands.filter((c) => c.hotkey).map((c) => c.hotkey.default);
  const dupHotkeys = hotkeys.filter((k, i) => hotkeys.indexOf(k) !== i);
  if (dupHotkeys.length) problem(dir, `两条命令用了同一个快捷键：${[...new Set(dupHotkeys)].join("、")}`);
  if (hotkeys.length > 0 && !has("hotkeys.register")) problem(dir, "有命令声明了快捷键，必须同时声明 hotkeys.register 能力");
  if (hotkeys.length === 0 && has("hotkeys.register")) problem(dir, "声明了 hotkeys.register 却没有任何命令带快捷键");
  for (const c of commands) {
    if (c.presentation === "silent" && !has("notifications.post") && !has("clipboard.write") && !has("inbox.post")) {
      problem(dir, `命令「${c.id}」是 silent 的，却没有任何把结果交给用户的能力（notifications.post / clipboard.write / inbox.post）`);
    }
  }
  if (manifest.background) {
    const hasBackgroundWork = has("inbox.post") || ids.some((id) => OBSERVE_CAPABILITIES.has(id));
    if (!hasBackgroundWork) problem(dir, "background: true 但没有任何后台要做的事（inbox.post 或带 observe 的能力）");
  }
  if (manifest.settings !== false) {
    const keys = manifest.settings.preferences.map((p) => p.key);
    const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupKeys.length) problem(dir, `preferences 里重复的 key：${[...new Set(dupKeys)].join("、")}`);
    for (const p of manifest.settings.preferences) {
      if (p.type === "select" && !p.options.some((o) => o.value === p.default)) {
        problem(dir, `preference「${p.key}」的 default 不在 options 里`);
      }
      if (p.type === "number" && (p.default < p.minimum || p.default > p.maximum)) {
        problem(dir, `preference「${p.key}」的 default 越界`);
      }
      if (p.type === "multiselect") {
        const values = new Set(p.options.map((o) => o.value));
        for (const v of p.default) if (!values.has(v)) problem(dir, `preference「${p.key}」的 default 里「${v}」不在 options 里`);
      }
    }
  }
  // 提示级：keywords 里重复标题 / 说明里的词
  const visible = `${manifest.toolbox.name} ${manifest.toolbox.subtitle}`.toLowerCase();
  for (const kw of manifest.toolbox.keywords ?? []) {
    if (visible.includes(kw.toLowerCase())) problem(dir, `keyword「${kw}」已经出现在标题或说明里，删掉它`);
  }

  // 产物
  const bundlePath = join(dir, manifest.main);
  if (!existsSync(bundlePath)) {
    problem(dir, `产物 ${manifest.main} 不存在——先 node scripts/build-extension.mjs ${dir}`);
  } else {
    const size = statSync(bundlePath).size;
    if (size > MAX_BUNDLE_BYTES) problem(dir, `产物 ${size} 字节，超过 512 KB`);
    const source = readFileSync(bundlePath, "utf8");
    for (const token of FORBIDDEN_TOKENS) {
      if (source.includes(token)) problem(dir, `产物里出现了「${token}」——宿主环境没有它，也不允许它`);
    }
    if (!source.includes("__jarvisHost")) problem(dir, "产物里没有 __jarvisHost：它不是用 SDK 构建出来的");
  }
  if (!existsSync(join(dir, "README.md"))) problem(dir, "缺 README.md");
  return manifest;
}

export function extensionDirectories() {
  const base = join(ROOT, "extensions");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((name) => join(base, name))
    .filter((dir) => statSync(dir).isDirectory())
    .sort();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dirs = args.length ? args.map((a) => resolve(a)) : extensionDirectories();
  if (dirs.length === 0) {
    console.log("[validate] extensions/ 下还没有扩展。");
    process.exit(0);
  }
  const seen = new Set();
  for (const dir of dirs) {
    const manifest = checkExtension(dir);
    if (manifest) {
      if (seen.has(manifest.id)) problem(dir, `id「${manifest.id}」重复`);
      seen.add(manifest.id);
    }
  }
  if (problems.length) {
    console.error("\x1b[31m[validate] 未通过：\x1b[0m");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[validate] ${dirs.length} 个扩展全部通过。`);
}
