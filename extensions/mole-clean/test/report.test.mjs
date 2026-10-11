/**
 * 报告与运行中的状态：两路明细取大的那个、失败与说明、整次失败、宿主线缆的上限；
 * 进度只在变了时给，换区段之前先把日志读干净。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource, RUN, sampleOutput } from "./support.mjs";

const { CleanOutputParser, OperationLogParser, LiveState, buildReport, cancelledText, limits } = await loadSource();

const parse = (lines) => {
  const parser = new CleanOutputParser();
  for (const line of lines) parser.consume(line);
  return parser;
};
const exited = (exitCode = 0, stderr = "") => ({ kind: "exited", exitCode, stderr });
const started = `# ========== clean run=${RUN} session started at t ==========`;
const op = (action, path, detail) => `[t] [clean run=${RUN}] ${action} ${path}${detail ? ` (${detail})` : ""}`;

test("一次完整输出写成报告：中文分类名、空段标成没有可清的、整次说明", () => {
  const report = buildReport(parse(sampleOutput), new OperationLogParser(), exited());
  assert.equal(report.failure, undefined);
  assert.deepEqual(report.sections.map((s) => s.title), ["系统（需管理员权限）", "用户缓存、日志与废纸篓", "浏览器缓存", "开发工具缓存"]);
  assert.deepEqual(report.sections.map((s) => s.id), ["System", "User essentials", "Browsers", "Developer tools"]);
  assert.deepEqual(report.sections[0].skipped, { reason: "notPresent" });
  assert.equal(report.sections[1].skipped, undefined);
  const freed = report.sections.reduce((sum, s) => sum + s.freedBytes, 0);
  assert.equal(freed, 2_400_000_000 + 312_500_000 + 48_200_000 + 1_100_000_000);
  assert.ok(report.notes.some((n) => n.includes("管理员权限")));
  assert.ok(report.notes.some((n) => n.includes("+4.10GB")));
  assert.ok(
    report.notes.some((n) => n.startsWith("Mole 自己统计的总数为 3.87 GB")),
    "Tracked 3.87GB 与明细之和 3.86GB 差了 9 MB：说一句，数字用面板的写法",
  );
  assert.ok(!report.notes.some((n) => n.startsWith("Mole 报告")), "Cleanup complete 不另写一句");
});

test("Tracked 与明细之和相差不到 1 MB 时不说", () => {
  const parser = parse(["➤ User essentials", "  ✓ User app cache · 2.40GB", "Tracked cleanup: 2.40GB | Items cleaned: 1"]);
  const report = buildReport(parser, new OperationLogParser(), exited());
  assert.ok(!report.notes.some((n) => n.includes("Mole 自己统计的总数")));
});

test("每一类取两边大的那个；失败只列前三条再加一句；白名单跳过与 Tracked 差额写进说明", () => {
  const parser = parse([
    "➤ User essentials",
    "  ✓ User app cache · 2 items, 1.20GB",
    "➤ App caches",
    "  ✓ Maps geo tile cache · 2 items, 600MB",
    "  ✓ Chrome Service Worker · 2.40GB, 3 protected",
    "Cleanup complete",
    "Tracked cleanup: 2.90GB | Items cleaned: 5 | Categories: 3",
  ]);
  const log = new OperationLogParser();
  log.consume(started, -1);
  log.consume(op("SKIPPED", "/Users/me/Library/Caches/CloudKit", "whitelist"), 0);
  log.consume(op("REMOVED", "/a", "500MB"), 0);
  log.consume(op("REMOVED", "/b", "800MB"), 0);
  log.consume(op("REMOVED", "/c", "1KB"), 0);
  for (let index = 0; index < 5; index += 1) log.consume(op("FAILED", `/f${index}`, "removal timed out"), 1);
  const report = buildReport(parser, log, exited());
  assert.equal(report.sections[0].freedBytes, 1_300_001_000, "日志比小结大：取日志");
  assert.equal(report.sections[0].itemCount, 3, "条目也取大的那个");
  assert.equal(report.sections[1].freedBytes, 3_000_000_000, "Service Worker 只在标准输出里");
  assert.deepEqual(report.sections[1].failures, [
    "/f0 · removal timed out",
    "/f1 · removal timed out",
    "/f2 · removal timed out",
    "另有 2 项没删掉",
  ]);
  assert.ok(report.notes.includes("按 Mole 的受保护名单与白名单跳过了 1 项。"));
  assert.ok(
    report.notes.includes(
      "Mole 自己统计的总数为 2.90 GB：它不计浏览器 Service Worker 等几项，这里按逐项删除记录与每一类的小结取大的那个。",
    ),
  );
});

test("整次失败：退出码非零且没有收尾标题；有标题就只是一句说明", () => {
  const crashed = buildReport(parse(["➤ System"]), new OperationLogParser(), exited(2, "line1\nError: cannot read cwd\n"));
  assert.equal(crashed.failure, "mo clean 退出码 2：line1 Error: cannot read cwd");
  const silent = buildReport(parse([]), new OperationLogParser(), exited(1, ""));
  assert.equal(silent.failure, "mo clean 退出码 1", "stderr 是空的就不带冒号");
  const tail = buildReport(parse([]), new OperationLogParser(), exited(3, "a\nb\n\nc\nd"));
  assert.equal(tail.failure, "mo clean 退出码 3：b c d", "只留最后三行，空行不算");

  const cancelled = buildReport(parse(["➤ User essentials", "Cleanup cancelled"]), new OperationLogParser(), exited(130));
  assert.equal(cancelled.failure, undefined, "有收尾标题就不算整次失败");
  assert.ok(cancelled.notes.includes("Mole 报告：Cleanup cancelled。"));
});

test("取消：没有收尾标题写「已取消」，前面清掉的照样报；有标题就按 Mole 说的", () => {
  const partial = buildReport(parse(["➤ User essentials", "  ✓ User app cache · 2.40GB"]), new OperationLogParser(), {
    kind: "cancelled",
  });
  assert.equal(partial.failure, cancelledText);
  assert.equal(partial.sections[0].freedBytes, 2_400_000_000);
  const interrupted = buildReport(parse(["➤ User essentials", "Cleanup interrupted"]), new OperationLogParser(), { kind: "cancelled" });
  assert.equal(interrupted.failure, undefined);
  assert.ok(interrupted.notes.includes("Mole 报告：Cleanup interrupted。"));
});

test("按宿主线缆的上限剪：区段数、每段说明条数、每条长度", () => {
  const lines = [];
  for (let index = 0; index < 70; index += 1) lines.push(`➤ Section ${index}`);
  lines.push("➤ Many skips");
  for (let index = 0; index < 12; index += 1) lines.push(`  ✓ cache ${index} · skipped (whitelist)`);
  const parser = parse(lines);
  const log = new OperationLogParser();
  log.consume(started, -1);
  log.consume(op("FAILED", `/${"x".repeat(600)}`, "removal timed out"), 0);
  const report = buildReport(parser, log, exited(9, "e".repeat(1000)));
  assert.equal(report.sections.length, limits.sections);
  assert.ok(report.sections[0].failures[0].length <= limits.text);
  assert.ok(report.failure.length <= limits.text);

  const skips = buildReport(parse(lines.slice(70)), new OperationLogParser(), exited());
  const notes = skips.sections[0].notes;
  assert.equal(notes.length, limits.sectionList);
  assert.equal(notes[notes.length - 1], "另有 5 条说明从略");
  const long = buildReport(parse([`➤ ${"Very long title ".repeat(10)}`]), new OperationLogParser(), exited());
  assert.ok(long.sections[0].id.length <= limits.sectionTitle);
  assert.ok(long.sections[0].title.length <= limits.sectionTitle);
});

/** 一个按脚本交行的日志读取器替身：`push()` 的行在下一次 `readNewLines()` 时交出去。 */
function scriptedReader() {
  const pending = [];
  return {
    push: (...lines) => pending.push(...lines),
    readNewLines: async () => pending.splice(0, pending.length),
  };
}

test("进度只在变了时给；换区段之前先把日志读干净", async () => {
  const reader = scriptedReader();
  const state = new LiveState(reader);
  const emitted = [];
  const feed = async (line) => {
    const progress = await state.consume(line);
    if (progress) emitted.push(progress);
    return progress;
  };
  reader.push(started);
  assert.notEqual(await feed("➤ User essentials"), null);
  // 小结还没出来，日志已经删了两项：读一次日志就涨上去。
  reader.push(op("REMOVED", "/Users/me/Library/Caches/Adobe", "500MB"), op("REMOVED", "/Users/me/Library/Caches/GameKit", "700MB"));
  const polled = await state.poll();
  assert.equal(polled.freedBytes, 1_200_000_000);
  assert.equal(polled.currentItem, "/Users/me/Library/Caches/GameKit", "交绝对路径，主目录由宿主写成 ~");
  assert.equal(polled.sectionTitle, "用户缓存、日志与废纸篓");
  assert.equal(await state.poll(), null, "什么都没变就不给");
  assert.equal(await feed(""), null, "空行不变");
  assert.equal(await feed("  ✓ User app cache · 2 items, 1.20GB"), null, "小结与日志一样大：数字没变");
  // 这一条日志落盘在下一段标题之前：换区段时先读进来，归到 User essentials。
  reader.push(op("REMOVED", "/Users/me/late", "100MB"));
  const next = await feed("➤ App caches");
  assert.equal(state.log.buckets.get(0).freedBytes, 1_300_000_000);
  assert.equal(state.log.buckets.get(1), undefined);
  assert.equal(next.completedSections, 1);
  assert.equal(next.freedBytes, 1_300_000_000);
  assert.ok(Math.abs(next.fraction - 2 / 15) < 1e-12);
  const keys = emitted.map((p) => JSON.stringify(p));
  assert.equal(new Set(keys).size, keys.length, "相邻两次不会一样");
});

test("第一个区段之前删掉的照算；没有日志时只看标准输出", async () => {
  const reader = scriptedReader();
  const state = new LiveState(reader);
  reader.push(started, op("REMOVED", "/early", "1KB"));
  const first = await state.poll();
  assert.equal(first.freedBytes, 1000);
  assert.equal(first.itemCount, 1);
  assert.equal(first.sectionTitle, undefined);

  const plain = new LiveState(null);
  await plain.consume("➤ User essentials");
  const progress = await plain.consume("  ✓ User app cache · 2 items, 1.20GB");
  assert.equal(progress.freedBytes, 1_200_000_000);
  assert.equal(progress.itemCount, 2);
  assert.equal(progress.currentItem, undefined);
});
