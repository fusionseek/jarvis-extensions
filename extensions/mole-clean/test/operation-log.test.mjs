/**
 * Mole 操作日志：解析、只认一次会话的累计、增量读取与轮转（移植自宿主 `MoleOperationLogTests`）。
 * 日志写在临时目录里，读取经 `hostFiles()` 按宿主 `files.stat / tail` 的语义进行。
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostFiles, loadSource, RUN } from "./support.mjs";

const { parseOperationLogLine, OperationLogParser, OperationLogReader, failureLimit, operationLogPath } = await loadSource();

let directory;
let logPath;
const append = (lines) => appendFileSync(logPath, lines.map((line) => `${line}\n`).join(""));

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "mole-oplog-"));
  logPath = join(directory, "operations.log");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** 与本机 Mole 1.59.1 写出的日志同形（路径换成了 /Users/me）。 */
test("解析会话标记与操作行", () => {
  assert.deepEqual(parseOperationLogLine(`# ========== clean run=${RUN} session started at 2026-10-11 17:49:14 ==========`), {
    kind: "sessionStarted",
    command: "clean",
    run: RUN,
  });
  assert.deepEqual(
    parseOperationLogLine(`# ========== clean run=${RUN} session ended at 2026-10-11 18:02:06, 10989 items, 10.27GB ==========`),
    { kind: "sessionEnded", command: "clean", run: RUN, items: 10989, size: "10.27GB" },
  );
  assert.deepEqual(parseOperationLogLine(`[2026-10-11 17:49:28] [clean run=${RUN}] REMOVED /Users/me/Library/Caches/Adobe (66KB)`), {
    kind: "operation",
    command: "clean",
    run: RUN,
    action: "REMOVED",
    path: "/Users/me/Library/Caches/Adobe",
    detail: "66KB",
  });
  assert.deepEqual(
    parseOperationLogLine(`[2026-10-11 17:49:28] [clean run=${RUN}] REMOVED /Users/me/Library/Caches/GeoServices`),
    { kind: "operation", command: "clean", run: RUN, action: "REMOVED", path: "/Users/me/Library/Caches/GeoServices", detail: null },
    "有的删除记录不带大小",
  );
  assert.deepEqual(
    parseOperationLogLine(
      `[2026-10-11 17:58:28] [clean run=${RUN}] FAILED /Users/me/Library/Caches/Google/Chrome/Profile 1 (removal timed out)`,
    ),
    {
      kind: "operation",
      command: "clean",
      run: RUN,
      action: "FAILED",
      path: "/Users/me/Library/Caches/Google/Chrome/Profile 1",
      detail: "removal timed out",
    },
    "路径里有空格",
  );
  assert.deepEqual(
    parseOperationLogLine(
      `[2026-10-11 17:50:00] [clean run=${RUN}] REMOVED /Users/me/Library/Application Support/抖音/Cache/Cache_Data (920MB)`,
    ),
    {
      kind: "operation",
      command: "clean",
      run: RUN,
      action: "REMOVED",
      path: "/Users/me/Library/Application Support/抖音/Cache/Cache_Data",
      detail: "920MB",
    },
  );
  assert.equal(parseOperationLogLine(""), null);
  assert.equal(parseOperationLogLine("[2026-10-11 17:49:28] [clean] REMOVED /x (1KB)"), null, "没有 run id 的旧格式认不出会话");
  assert.equal(parseOperationLogLine("[t] [clean run=a] removed /x (1KB)"), null, "动作必须是大写");
  assert.equal(parseOperationLogLine("# ========== clean run=a session paused at x =========="), null);
  assert.equal(parseOperationLogLine("random text"), null);
  assert.equal(operationLogPath, "~/Library/Logs/mole/operations.log", "与 manifest files.read 逐字相同");
});

/** 只认开跑之后的第一个 clean 会话：别的会话、会话之前与结束之后的行一律不计；按区段累计、失败只留前几条。 */
test("只累计认下的那一次会话，按区段分桶", () => {
  const parser = new OperationLogParser();
  const other = "20261011174900-1-2-3";
  parser.consume(`[2026-10-11 17:49:00] [clean run=${other}] REMOVED /Users/me/early (1GB)`, 0);
  parser.consume(`# ========== optimize run=${other} session started at 2026-10-11 17:49:10 ==========`, 0);
  assert.equal(parser.isBound, false, "optimize 会话不认");
  parser.consume(`# ========== clean run=${RUN} session started at 2026-10-11 17:49:14 ==========`, -1);
  assert.equal(parser.run, RUN);
  parser.consume(`[t] [clean run=${RUN}] SKIPPED /Users/me/Library/Caches/CloudKit (whitelist)`, 0);
  parser.consume(`[t] [clean run=${RUN}] REMOVED /Users/me/Library/Caches/Adobe (66KB)`, 0);
  parser.consume(`[t] [clean run=${RUN}] REMOVED /Users/me/Library/Caches/GeoServices`, 0);
  parser.consume(`[t] [clean run=${other}] REMOVED /Users/me/elsewhere (5GB)`, 0);
  for (let index = 0; index < 5; index += 1) {
    parser.consume(`[t] [clean run=${RUN}] FAILED /Users/me/Library/Caches/x${index} (removal timed out)`, 1);
  }
  parser.consume(`[t] [clean run=${RUN}] REMOVED /Users/me/Library/Caches/Google (1.39GB)`, 1);
  parser.consume(`# ========== clean run=${RUN} session ended at 2026-10-11 18:02:06, 3 items, 1.39GB ==========`, 1);
  parser.consume(`[t] [clean run=${RUN}] REMOVED /Users/me/after (9GB)`, 1);

  assert.equal(parser.buckets.get(0).removedCount, 2);
  assert.equal(parser.buckets.get(0).freedBytes, 66_000);
  assert.equal(parser.buckets.get(1).freedBytes, 1_390_000_000);
  assert.equal(parser.buckets.get(1).failureCount, 5);
  assert.equal(parser.buckets.get(1).failures.length, failureLimit);
  assert.equal(parser.buckets.get(1).failures[0], "/Users/me/Library/Caches/x0 · removal timed out");
  assert.equal(parser.skippedCount, 1);
  assert.equal(parser.freedBytes, 66_000 + 1_390_000_000, "别的会话、结束之后的都不算");
  assert.equal(parser.removedCount, 3);
  assert.equal(parser.lastRemoved, "/Users/me/Library/Caches/Google");
  assert.equal(parser.ended, true);
  assert.equal(parser.endedItems, 3);
  assert.equal(parser.endedSize, "1.39GB");
});

/** 从开跑那一刻的末尾读起；半行留到下一次；文件被轮转（换了 inode 或变小）就从新文件开头读。 */
test("只读开跑之后新增的完整行，跟得上轮转", async () => {
  append(["old 1", "old 2"]);
  const files = hostFiles(logPath);
  const reader = await OperationLogReader.open(files, operationLogPath);
  assert.deepEqual(await reader.readNewLines(), [], "开跑之前的不算");

  append(["new 1"]);
  appendFileSync(logPath, "new 2 (half");
  assert.deepEqual(await reader.readNewLines(), ["new 1"], "半行等下一次");
  append([") done"]);
  assert.deepEqual(await reader.readNewLines(), ["new 2 (half) done"]);

  // Mole 轮转：旧文件改名为 .old，新建一份（新 inode）。
  renameSync(logPath, `${logPath}.old`);
  append(["rotated 1"]);
  assert.deepEqual(await reader.readNewLines(), ["rotated 1"]);
  append(["rotated 2"]);
  assert.deepEqual(await reader.readNewLines(), ["rotated 2"]);

  // 原地截短（同一个 inode、变小了）也当作轮转。
  writeFileSync(logPath, "short\n");
  assert.deepEqual(await reader.readNewLines(), ["short"]);

  assert.ok(files.calls.every((call) => call.path === operationLogPath), "扩展交给宿主的是 manifest 里那一串，主目录由宿主展开");
});

test("日志不在就什么都不读；开跑之后才出现的从头读", async () => {
  const reader = await OperationLogReader.open(hostFiles(logPath));
  assert.deepEqual(await reader.readNewLines(), [], "日志不在就什么都不读");
  append([`# ========== clean run=${RUN} session started at t ==========`]);
  assert.deepEqual(await reader.readNewLines(), [`# ========== clean run=${RUN} session started at t ==========`]);
});

test("一次读不完（宿主一次 ≤ 1 MB）时接着读到末尾", async () => {
  writeFileSync(logPath, "");
  const reader = await OperationLogReader.open(hostFiles(logPath, { chunk: 16 }));
  const lines = Array.from({ length: 10 }, (_, index) => `line number ${index}`);
  append(lines);
  assert.deepEqual(await reader.readNewLines(), lines);
});

test("宿主拒绝时：开不了就退回只看标准输出，读到一半被拒不抛错", async () => {
  const denied = { code: "permission.denied", message: "没授权" };
  assert.equal(await OperationLogReader.open({ stat: async () => Promise.reject(denied), tail: async () => null }), null);
  let allow = true;
  const files = hostFiles(logPath);
  writeFileSync(logPath, "");
  const reader = await OperationLogReader.open({
    stat: (path) => (allow ? files.stat(path) : Promise.reject(denied)),
    tail: (path, offset) => files.tail(path, offset),
  });
  append(["a"]);
  allow = false;
  assert.deepEqual(await reader.readNewLines(), []);
  allow = true;
  assert.deepEqual(await reader.readNewLines(), ["a"], "下一次接着读，没有丢");
});
