#!/usr/bin/env node
/**
 * 校验扩展：schema、跨字段规则、目录约定、产物。
 *
 * schema 是真源（schemas/extension.v2.schema.json），这里用 Ajv 跑它；跨字段规则是 schema
 * 表达不了的那几条，写在下面并与 docs/03-manifest.md 一一对应——宿主（jarvis-mac 的
 * `ExtensionManifest.validate()`）查的是同一份清单。任何一条不过即非零退出：
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

/** 与内置工具、内容模式撞名的 id。 */
const RESERVED_IDS = new Set([
  "palette", "clipboard", "base64", "hash", "regex", "url", "json", "time", "junkclean", "clean",
  "apk", "datapull", "screenshot", "quicktransfer", "gallery", "extension", "extensions", "jarvis",
]);

/**
 * 内置 `/` 指令认的全部词（jarvis-mac `LauncherCommand.aliases` 与速记 `MemoComposerCommand`）。
 * 扩展指令与它们撞了，宿主不加载那一条——在这里先拦下，好过装上之后才发现 `/` 下拉里没有它。
 */
const RESERVED_SLASH = new Set([
  "color", "colour", "颜色", "调色板", "hash", "md5", "sha1", "sha256", "sha512", "哈希", "base64", "b64",
  "url", "链接", "time", "ts", "timestamp", "时间", "时间戳", "json", "regex", "正则", "mind", "脑图",
  "flow", "流程图", "seq", "时序图", "lane", "泳道图", "arch", "架构图", "architecture", "todo", "待办",
  "memo", "note", "速记", "记", "find", "查找", "diff", "compare", "对比", "比较", "gitdiff", "gdiff", "git对比",
  "git", "gitlog", "git图", "clean", "cleanup", "清理",
]);
const FORBIDDEN_TOKENS = ["XMLHttpRequest", "WebSocket", "require(", "importScripts", "eval(", "new Function("];
const MAX_BUNDLE_BYTES = 512 * 1024;
const REPORTING_CAPABILITIES = ["notifications.post", "clipboard.write", "inbox.post"];

let Ajv;
let addFormats;
try {
  Ajv = require("ajv/dist/2020.js");
  addFormats = require("ajv-formats");
} catch {
  console.error("\x1b[31m[validate] 找不到 ajv / ajv-formats。在仓库根目录跑一次 npm install。\x1b[0m");
  process.exit(1);
}

// `strictRequired: false`：schema 用 `anyOf: [{ required: ["toolbox"] }, …]` 表达「至少入驻一个有入口的域」，
// 那几个分支只写 required、不重复写 properties——Ajv 严格模式会把它当成笔误拒掉，而它是有意的。
const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validateManifest = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "extension.v2.schema.json"), "utf8")));

const problems = [];
function problem(dir, message) {
  problems.push(`${basename(dir)}: ${message}`);
}

/** 到目前为止收集到的全部问题。调用方（build-registry）据此拒绝生成。 */
export function collectedProblems() {
  return [...problems];
}

/** 重复项。 */
function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

/** 偏好的默认值与选项是否自洽。 */
function checkPreferences(dir, preferences, where) {
  for (const p of preferences) {
    if (p.type === "select" && !p.options.some((o) => o.value === p.default)) {
      problem(dir, `${where}「${p.key}」的 default 不在 options 里`);
    }
    if (p.type === "number" && (p.default < p.minimum || p.default > p.maximum)) {
      problem(dir, `${where}「${p.key}」的 default 越界`);
    }
    if (p.type === "multiselect") {
      const values = new Set(p.options.map((o) => o.value));
      for (const v of p.default) if (!values.has(v)) problem(dir, `${where}「${p.key}」的 default 里「${v}」不在 options 里`);
    }
  }
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

  const contributes = manifest.contributes;
  const ids = manifest.capabilities.map((c) => c.id);
  const dupes = duplicates(ids);
  if (dupes.length) problem(dir, `capabilities 里重复：${dupes.join("、")}`);
  const has = (id) => ids.includes(id);

  // ── 能力 ⇔ 声明对象 ──────────────────────────────────────────────────
  if (has("network.https") !== Boolean(manifest.network)) {
    problem(dir, "network.https 能力与 network.hosts 必须同时出现或同时缺席");
  }
  const executables = manifest.process?.executables ?? [];
  const scripts = manifest.process?.terminal ?? [];
  if (has("process.run") !== executables.length > 0) {
    problem(dir, "process.run 能力与 process.executables 必须同时出现或同时缺席");
  }
  if (has("terminal.run") !== scripts.length > 0) {
    problem(dir, "terminal.run 能力与 process.terminal 必须同时出现或同时缺席");
  }
  if (has("files.read") !== Boolean(manifest.files)) {
    problem(dir, "files.read 能力与 files.read 路径必须同时出现或同时缺席");
  }
  const dupExecutables = duplicates(executables.map((e) => e.name));
  if (dupExecutables.length) problem(dir, `process.executables 里重复的名字：${dupExecutables.join("、")}`);
  for (const executable of executables) {
    const shapes = executable.arguments.map((a) => JSON.stringify(a));
    if (duplicates(shapes).length) problem(dir, `可执行文件「${executable.name}」有重复的参数组合`);
  }
  const dupScripts = duplicates(scripts.map((s) => s.id));
  if (dupScripts.length) problem(dir, `process.terminal 里重复的 id：${dupScripts.join("、")}`);
  for (const path of manifest.files?.read ?? []) {
    if (path.split("/").includes("..")) problem(dir, `files.read 路径「${path}」里不能有 ..`);
  }

  // ── Inbox 通道 ───────────────────────────────────────────────────────
  if (manifest.inbox !== false) {
    if (manifest.inbox.messages && !has("inbox.post")) problem(dir, "inbox.messages 为 true 必须声明 inbox.post");
    if (manifest.inbox.notifications && !has("notifications.post")) problem(dir, "inbox.notifications 为 true 必须声明 notifications.post");
    if (!manifest.inbox.messages && !manifest.inbox.notifications) problem(dir, "inbox 两项都是 false 时直接写 inbox: false");
    if (!manifest.inbox.messages && has("inbox.post")) problem(dir, "声明了 inbox.post 却把 inbox.messages 关着");
    if (!manifest.inbox.notifications && has("notifications.post")) problem(dir, "声明了 notifications.post 却把 inbox.notifications 关着");
  } else {
    if (has("inbox.post")) problem(dir, "声明了 inbox.post 却写了 inbox: false");
    if (has("notifications.post")) problem(dir, "声明了 notifications.post 却写了 inbox: false");
  }

  // ── 指令域 ───────────────────────────────────────────────────────────
  const commands = contributes.commands ?? [];
  const dupCommands = duplicates(commands.map((c) => c.id));
  if (dupCommands.length) problem(dir, `commands 里重复的 id：${dupCommands.join("、")}`);
  const hotkeys = commands.filter((c) => c.hotkey).map((c) => c.hotkey);
  const dupHotkeys = duplicates(hotkeys);
  if (dupHotkeys.length) problem(dir, `两条命令用了同一个快捷键：${dupHotkeys.join("、")}`);
  if (hotkeys.length > 0 && !has("hotkeys.register")) problem(dir, "有命令声明了快捷键，必须同时声明 hotkeys.register 能力");
  if (hotkeys.length === 0 && has("hotkeys.register")) problem(dir, "声明了 hotkeys.register 却没有任何命令带快捷键");
  const slashWords = [];
  for (const c of commands) {
    if ((c.presentation === "toolbox" || c.presentation === "popover") && !contributes.toolbox) {
      problem(dir, `命令「${c.id}」落在 ${c.presentation}，却没有入驻工具箱域（contributes.toolbox）`);
    }
    if (c.presentation === "window" && !contributes.window) {
      problem(dir, `命令「${c.id}」落在 window，却没有入驻窗口域（contributes.window）`);
    }
    if (c.presentation === "silent" && !REPORTING_CAPABILITIES.some(has)) {
      problem(dir, `命令「${c.id}」是 silent 的，却没有任何把结果交给用户的能力（${REPORTING_CAPABILITIES.join(" / ")}）`);
    }
    if (c.slash) {
      for (const word of [c.slash.keyword, ...(c.slash.aliases ?? [])]) {
        if (RESERVED_SLASH.has(word.toLowerCase())) problem(dir, `命令「${c.id}」的 / 指令「${word}」与内置指令撞了`);
        slashWords.push(word.toLowerCase());
      }
    }
  }
  const dupSlash = duplicates(slashWords);
  if (dupSlash.length) problem(dir, `两条命令认同一个 / 指令词：${dupSlash.join("、")}`);

  // ── 服务域与设置域 ──────────────────────────────────────────────────
  const services = contributes.services ?? [];
  const dupServices = duplicates(services.map((s) => s.id));
  if (dupServices.length) problem(dir, `services 里重复的 id：${dupServices.join("、")}`);
  const preferenceKeys = [
    ...(contributes.settings?.preferences ?? []).map((p) => p.key),
    ...services.flatMap((s) => (s.preferences ?? []).map((p) => p.key)),
  ];
  const dupKeys = duplicates(preferenceKeys);
  if (dupKeys.length) problem(dir, `偏好的 key 重复（设置与服务共用一个命名空间）：${dupKeys.join("、")}`);
  checkPreferences(dir, contributes.settings?.preferences ?? [], "preference");
  for (const service of services) checkPreferences(dir, service.preferences ?? [], `服务「${service.id}」的 preference`);

  // ── 提示级：keywords 里重复名字 / 说明里的词 ────────────────────────
  for (const [domain, entry] of [["toolbox", contributes.toolbox], ["window", contributes.window]]) {
    if (!entry) continue;
    const visible = `${manifest.name} ${entry.subtitle}`.toLowerCase();
    for (const kw of entry.keywords ?? []) {
      if (visible.includes(kw.toLowerCase())) problem(dir, `${domain}.keywords「${kw}」已经出现在名字或说明里，删掉它`);
    }
  }

  // ── 产物 ─────────────────────────────────────────────────────────────
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

/** `extensions/` 下的全部扩展目录。 */
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
  const slashOwners = new Map();
  for (const dir of dirs) {
    const manifest = checkExtension(dir);
    if (!manifest) continue;
    if (seen.has(manifest.id)) problem(dir, `id「${manifest.id}」重复`);
    seen.add(manifest.id);
    // 两个扩展认同一个 / 指令词：宿主先装先得，后装的那条不加载——仓库里就不该出现。
    for (const command of manifest.contributes.commands ?? []) {
      for (const word of command.slash ? [command.slash.keyword, ...(command.slash.aliases ?? [])] : []) {
        const owner = slashOwners.get(word.toLowerCase());
        if (owner && owner !== manifest.id) problem(dir, `/ 指令词「${word}」已经属于扩展「${owner}」`);
        slashOwners.set(word.toLowerCase(), manifest.id);
      }
    }
  }
  if (problems.length) {
    console.error("\x1b[31m[validate] 未通过：\x1b[0m");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[validate] ${dirs.length} 个扩展全部通过。`);
}
