#!/usr/bin/env node
/**
 * PR 门禁：schema 与产物之外，CI 还要查的两件事。
 *
 * `npm run verify` 查的是"这一份快照自洽"；这里查的是"这一次改动相对主干合不合规"——
 * 两件事都只有拿到 base 才问得出来：
 *
 * 1. **版本递增**：改过的扩展，`version` 必须严格大于主干上的那一个。
 *    不递增的扩展装不上去：宿主按 `availableUpdate(installed, registry)` 比较，
 *    版本没涨就永远是「已安装」，用户拿不到新产物。
 *    新扩展按 docs/13 从 `0.1.0` 或 `1.0.0` 起。
 * 2. **registry diff 范围**：`registry.json` 里变动的条目必须都属于本次改动的扩展。
 *    这份索引是生成物，一次 PR 改到别人的条目，只可能是拿了脏工作区重新生成的。
 *    `generatedAt` 与 `source.commit` 每次生成都变，不算。
 * 3. **锁文件跟上**：扩展是 npm workspace，版本号记在 `package-lock.json` 里。升了版本却没跑
 *    `npm install`，CI 的 `npm ci` 会以一句 `Missing: jarvis-ext-… from lock file` 失败——
 *    那句话没有告诉任何人该做什么，所以这里先用人话拦一道。
 *
 * 用法：
 *   node scripts/check-pr.mjs              # 与 origin/main 比
 *   node scripts/check-pr.mjs HEAD~1       # 与任意 base 比（本地推之前自查）
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] ?? "origin/main";

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
/** base 上那一版文件；那边没有这个文件时为 `null`（新增）。 */
const fileAtBase = (path) => {
  try {
    return execFileSync("git", ["show", `${base}:${path}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

const problems = [];
const notes = [];

/** `1.2.3` → `[1, 2, 3]`；schema 已经保证了形状，这里只做比较。 */
const parse = (version) => version.split(".").map(Number);
const greater = (a, b) => {
  const [x, y, z] = parse(a);
  const [p, q, r] = parse(b);
  return x !== p ? x > p : y !== q ? y > q : z > r;
};

// 本次改动碰过哪些扩展目录
const changed = git(["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
const touched = new Set(
  changed.map((path) => /^extensions\/([^/]+)\//.exec(path)?.[1]).filter((id) => id !== undefined),
);

// ── 1. 版本递增 ─────────────────────────────────────────────────────────
for (const id of [...touched].sort()) {
  const manifestPath = `extensions/${id}/extension.json`;
  if (!existsSync(join(ROOT, manifestPath))) {
    notes.push(`${id}：整个目录被删掉了，跳过版本检查`);
    continue;
  }
  const head = JSON.parse(readFileSync(join(ROOT, manifestPath), "utf8"));
  const raw = fileAtBase(manifestPath);
  if (raw === null) {
    if (head.version !== "0.1.0" && head.version !== "1.0.0") {
      problems.push(`${id}：新扩展的 version 是 ${head.version}，docs/13 要求从 0.1.0 或 1.0.0 起`);
    } else {
      notes.push(`${id}：新扩展 ${head.version}`);
    }
    continue;
  }
  const previous = JSON.parse(raw).version;
  if (!greater(head.version, previous)) {
    problems.push(`${id}：version 没有相对主干递增（${previous} → ${head.version}）——不涨版本的产物宿主不会更新`);
  } else {
    notes.push(`${id}：${previous} → ${head.version}`);
  }
}

// ── 2. 锁文件跟上版本 ───────────────────────────────────────────────────
// 放在依赖装好之前跑：这一条本身不需要任何依赖，而它拦的正是"装不起来"。
const lockPath = join(ROOT, "package-lock.json");
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  for (const id of [...touched].sort()) {
    const manifestPath = join(ROOT, `extensions/${id}/extension.json`);
    if (!existsSync(manifestPath)) continue;
    const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
    const recorded = lock.packages?.[`extensions/${id}`]?.version;
    if (recorded !== version) {
      problems.push(
        `${id}：package-lock.json 里记的是 ${recorded ?? "（没有这一项）"}，扩展是 ${version}——升完版本要跑一次 npm install 并把锁文件一起提交`,
      );
    }
  }
}

// ── 3. registry.json 的 diff 范围 ───────────────────────────────────────
const registryPath = "registry.json";
const baseRegistryRaw = fileAtBase(registryPath);
if (baseRegistryRaw !== null && changed.includes(registryPath)) {
  const entriesOf = (raw) => new Map(JSON.parse(raw).extensions.map((e) => [e.id, JSON.stringify(e)]));
  const before = entriesOf(baseRegistryRaw);
  const after = entriesOf(readFileSync(join(ROOT, registryPath), "utf8"));
  const moved = new Set();
  for (const [id, entry] of after) if (before.get(id) !== entry) moved.add(id);
  for (const id of before.keys()) if (!after.has(id)) moved.add(id);
  const strays = [...moved].filter((id) => !touched.has(id)).sort();
  if (strays.length) {
    problems.push(`registry.json 动了本次 PR 没有改的扩展：${strays.join("、")}——这份索引是生成物，多半是拿脏工作区重新生成的`);
  } else if (moved.size) {
    notes.push(`registry.json：只动了 ${[...moved].sort().join("、")}`);
  } else {
    notes.push("registry.json：只有 generatedAt / source.commit 变了");
  }
}

// ── 结果 ────────────────────────────────────────────────────────────────
console.log(`[check-pr] base = ${base}，本次碰过的扩展：${touched.size ? [...touched].sort().join("、") : "（没有）"}`);
for (const note of notes) console.log(`  · ${note}`);
if (problems.length) {
  console.error("\x1b[31m[check-pr] 未通过：\x1b[0m");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("[check-pr] 通过。");
