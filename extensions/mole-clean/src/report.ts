/**
 * 把一次运行的状态写成交给宿主的报告（移植自宿主 `MoleCleaner.report(from:)`）。
 *
 * 明细有两个来源：标准输出（区段与每个目标做完后的一行小结）与操作日志（每删一项当场一行）。
 * **每一类取大的那个数**：两边都不完整——浏览器 Service Worker、`npm cache clean` 这类用命令清的只在标准输出里，
 * 而一个目标中途被打断时只有日志记得删掉了多少。取和会重复计，取大的那个才是「至少清掉了这么多」。
 */
import type { JunkCleanReport, JunkCleanSection } from "@fusionseek/jarvis-extension-sdk";
import { clampList, clampText, limits } from "./limits.js";
import type { OperationLogParser } from "./operation-log.js";
import { localizedTitle, type CleanOutputParser } from "./output-parser.js";
import { panelSize } from "./size-format.js";

/** `mo clean` 是怎么结束的。 */
export type RunOutcome =
  /** 进程退出了：退出码与 stderr 末尾。 */
  | { kind: "exited"; exitCode: number; stderr: string }
  /** 用户取消了（宿主中断了进程）。 */
  | { kind: "cancelled" };

/** 取消且 Mole 没来得及打印收尾标题时，整次失败写什么。 */
export const cancelledText = "已取消";

/** Mole 的 Tracked 总数与明细之和差多少才值得说一句。1 MB：小于它的差是四舍五入，不是漏计。 */
const trackedMismatchThreshold = 1_000_000;

/**
 * 一份只有整次失败的报告（没找到 mo、没授权、没能启动）。
 * @param failure 原因。
 * @returns 报告。
 */
export function failureReport(failure: string): JunkCleanReport {
  return { sections: [], notes: [], failure: clampText(failure, limits.text) };
}

/**
 * 写报告。
 * @param parser 标准输出的解析结果。
 * @param log 操作日志的累计结果。
 * @param outcome 进程是怎么结束的。
 * @returns 报告（已按宿主线缆的上限剪好）。
 */
export function buildReport(parser: CleanOutputParser, log: OperationLogParser, outcome: RunOutcome): JunkCleanReport {
  const sections: JunkCleanSection[] = parser.sections.slice(0, limits.sections).map((section, index) => {
    const bucket = log.buckets.get(index);
    const freed = Math.max(section.freedBytes, bucket?.freedBytes ?? 0);
    const items = Math.max(section.itemCount, bucket?.removedCount ?? 0);
    const failures = [...(bucket?.failures ?? [])];
    if (bucket && bucket.failureCount > bucket.failures.length) {
      failures.push(`另有 ${bucket.failureCount - bucket.failures.length} 项没删掉`);
    }
    const result: JunkCleanSection = {
      id: clampText(section.title, limits.sectionTitle),
      title: clampText(localizedTitle(section.title), limits.sectionTitle),
      freedBytes: freed,
      itemCount: items,
    };
    if (items === 0 && freed === 0) result.skipped = { reason: "notPresent" };
    if (failures.length > 0) {
      result.failures = clampList(
        failures.map((failure) => clampText(failure, limits.text)),
        limits.sectionList,
        (hidden) => `另有 ${hidden} 条失败明细从略`,
      );
    }
    if (section.notes.length > 0) {
      result.notes = clampList(
        section.notes.map((note) => clampText(note, limits.text)),
        limits.sectionList,
        (hidden) => `另有 ${hidden} 条说明从略`,
      );
    }
    return result;
  });

  const notes: string[] = [];
  if (parser.systemSkipped) notes.push("系统级清理需要管理员权限，这次由 Mole 自动跳过。");
  if (parser.freeSpaceDelta !== null) {
    notes.push(`磁盘可用空间变化 ${parser.freeSpaceDelta}（含废纸篓与 Homebrew 等未计入明细的部分）。`);
  }
  if (log.skippedCount > 0) notes.push(`按 Mole 的受保护名单与白名单跳过了 ${log.skippedCount} 项。`);
  if (parser.trackedBytes !== null) {
    const sum = sections.reduce((total, section) => total + section.freedBytes, 0);
    if (Math.abs(parser.trackedBytes - sum) > trackedMismatchThreshold) {
      notes.push(
        `Mole 自己统计的总数为 ${panelSize(parser.trackedBytes)}：它不计浏览器 Service Worker 等几项，` +
          "这里按逐项删除记录与每一类的小结取大的那个。",
      );
    }
  }

  let failure: string | undefined;
  if (parser.heading === null) {
    // 没有收尾标题：退出码非零是整次失败；取消是用户的决定，但这一次确实没跑完。
    if (outcome.kind === "cancelled") {
      failure = cancelledText;
    } else if (outcome.exitCode !== 0) {
      // 与 Swift `split(separator:)` 一致：空行不算一行。
      const tail = outcome.stderr
        .split("\n")
        .filter((line) => line.length > 0)
        .slice(-3)
        .join(" ");
      failure = `mo clean 退出码 ${outcome.exitCode}${tail ? `：${tail}` : ""}`;
    }
  } else if (parser.heading !== "Cleanup complete") {
    // 有收尾标题就不算整次失败（被打断、被取消也是 Mole 自己收的尾，前面的分类照样作数）。
    notes.push(`Mole 报告：${parser.heading}。`);
  }

  const report: JunkCleanReport = {
    sections,
    notes: clampList(
      notes.map((note) => clampText(note, limits.text)),
      limits.reportNotes,
      (hidden) => `另有 ${hidden} 条说明从略`,
    ),
  };
  if (failure !== undefined) report.failure = clampText(failure, limits.text);
  return report;
}
