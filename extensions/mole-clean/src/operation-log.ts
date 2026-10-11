/**
 * Mole 的操作日志（`~/Library/Logs/mole/operations.log`）：深度清理的逐项明细从这里来
 * （移植自宿主 `MoleOperationLog.swift`）。
 *
 * `mo clean` 的标准输出每个清理目标**整个做完**才打一行，一个目标删上几分钟时界面上什么都不动；
 * 而它每删一个文件（或目录）都会**当场**往这份日志追加一行：
 *
 * ```
 * # ========== clean run=<id> session started at 2026-10-11 17:49:14 ==========
 * [2026-10-11 17:49:28] [clean run=<id>] REMOVED /Users/me/Library/Caches/Adobe (66KB)
 * [2026-10-11 17:49:58] [clean run=<id>] FAILED /Users/me/Library/Caches/Google (removal timed out)
 * [2026-10-11 17:49:14] [clean run=<id>] SKIPPED /Users/me/Library/Caches/CloudKit (whitelist)
 * # ========== clean run=<id> session ended at 2026-10-11 18:02:06, 10989 items, 10.27GB ==========
 * ```
 *
 * 格式来自 Mole 1.59 的 `lib/core/log.sh`（`log_operation`、`log_operation_session_start/end`）。
 */
import type { FilesAPI } from "@fusionseek/jarvis-extension-sdk";
import { bytesFromToken, strictInteger } from "./output-parser.js";

/**
 * 日志的位置。Mole 写死在主目录下、不读环境变量；这里写成与 manifest `files.read` **逐字相同**的那一串，
 * 主目录由宿主展开——扩展不知道、也不需要知道用户的主目录在哪。
 */
export const operationLogPath = "~/Library/Logs/mole/operations.log";

/** 一行操作日志读出来的东西。 */
export type OperationLogLine =
  /** 会话开始：`# ========== clean run=<id> session started at … ==========`。 */
  | { kind: "sessionStarted"; command: string; run: string }
  /** 会话结束：带 Mole 自己统计的条目数与大小原文。 */
  | { kind: "sessionEnded"; command: string; run: string; items: number | null; size: string | null }
  /** 一次操作（`REMOVED` / `FAILED` / `SKIPPED` …）。 */
  | { kind: "operation"; command: string; run: string; action: string; path: string; detail: string | null };

const markerPrefix = "# ========== ";
const markerSuffix = " ==========";

/** `clean run=<id>` → (`clean`, `<id>`)。没有 run id 的旧格式（Mole 早期版本）认不出会话，返回 `null`。 */
function commandAndRun(tag: string): { command: string; run: string } | null {
  const at = tag.indexOf(" run=");
  if (at < 0) return null;
  const command = tag.slice(0, at);
  const run = tag.slice(at + " run=".length);
  if (!command || !run || run.includes(" ")) return null;
  return { command, run };
}

/**
 * 解析一行。认不出的行返回 `null`。
 * @param raw 日志的一行（不含换行）。
 * @returns 解析结果。
 */
export function parseOperationLogLine(raw: string): OperationLogLine | null {
  const line = raw.trim();
  if (line.startsWith(markerPrefix) && line.endsWith(markerSuffix)) {
    const inner = line.slice(markerPrefix.length, line.length - markerSuffix.length);
    const started = inner.indexOf(" session started at ");
    if (started >= 0) {
      const tag = commandAndRun(inner.slice(0, started));
      return tag ? { kind: "sessionStarted", ...tag } : null;
    }
    const ended = inner.indexOf(" session ended at ");
    if (ended >= 0) {
      const tag = commandAndRun(inner.slice(0, ended));
      if (!tag) return null;
      // 「…, 10989 items, 10.27GB」：时间之后两段。
      const tail = inner.slice(ended + " session ended at ".length).split(", ");
      const items = tail.length >= 2 ? strictInteger(tail[tail.length - 2]!.replace(/ items/g, "")) : null;
      const size = tail.length >= 3 ? tail[tail.length - 1]! : null;
      return { kind: "sessionEnded", ...tag, items, size };
    }
    return null;
  }
  // [时间] [command run=<id>] ACTION 路径[ (详情)]
  if (!line.startsWith("[")) return null;
  const firstClose = line.indexOf("]");
  if (firstClose < 0) return null;
  const afterTime = line.slice(firstClose + 1).replace(/^ +/, "");
  if (!afterTime.startsWith("[")) return null;
  const tagClose = afterTime.indexOf("]");
  if (tagClose < 0) return null;
  const tag = commandAndRun(afterTime.slice(1, tagClose));
  if (!tag) return null;
  const rest = afterTime.slice(tagClose + 1).replace(/^ +/, "");
  const space = rest.indexOf(" ");
  if (space < 0) return null;
  const action = rest.slice(0, space);
  if (!/^[\p{Uppercase}_]+$/u.test(action)) return null;
  let path = rest.slice(space + 1);
  let detail: string | null = null;
  // 详情是行尾最后一对括号；路径里本身带括号（「报告 (1)」）时，Mole 也会在它后面再加一对，取最后一对仍是详情。
  if (path.endsWith(")")) {
    const open = path.lastIndexOf(" (");
    if (open >= 0) {
      detail = path.slice(open + 2, path.length - 1);
      path = path.slice(0, open);
    }
  }
  if (!path) return null;
  return { kind: "operation", ...tag, action, path, detail };
}

/** 一类（标准输出里的一个区段）在日志里累计到的东西。 */
export interface LogBucket {
  freedBytes: number;
  removedCount: number;
  /** 删除失败的条目（路径 · 原因），只留前 `failureLimit` 条。 */
  failures: string[];
  failureCount: number;
}

/** 每一类最多留几条失败明细。3：够看出是权限、超时还是正在使用，再多结果页就成了日志。 */
export const failureLimit = 3;

/**
 * 操作日志的解析与累计（纯数据，不碰文件）。
 *
 * **只认一次会话**：开跑之后出现的第一个 `clean` 会话就是我们这一次（run id 是 Mole 自己生成的不透明串，
 * 认不出是不是我们起的那个进程，只能按先后）；别的会话（用户同时在终端里跑的）一律不计。
 */
export class OperationLogParser {
  /** 认下的那一次会话。 */
  run: string | null = null;
  /** 会话结束了（读到了结束标记）。之后的行一律不计。 */
  ended = false;
  /** Mole 自己在结束标记里写的条目数与大小原文。 */
  endedItems: number | null = null;
  endedSize: string | null = null;
  /** 按类累计。键是标准输出里区段的下标（`-1` = 第一个区段之前）。 */
  readonly buckets = new Map<number, LogBucket>();
  /** 受保护 / 白名单跳过的条目数。 */
  skippedCount = 0;
  /** 最近删掉的那一项（绝对路径）。 */
  lastRemoved: string | null = null;

  /** 认下了会话：明细可信。 */
  get isBound(): boolean {
    return this.run !== null;
  }

  /** 全部类加起来释放的字节数。 */
  get freedBytes(): number {
    let total = 0;
    for (const bucket of this.buckets.values()) total += bucket.freedBytes;
    return total;
  }

  /** 全部类加起来删掉的条目数。 */
  get removedCount(): number {
    let total = 0;
    for (const bucket of this.buckets.values()) total += bucket.removedCount;
    return total;
  }

  /**
   * 喂一行。
   * @param raw 日志的一行（不含换行）。
   * @param section 此刻标准输出停在第几个区段（`-1` = 还没有）。
   * @returns 无返回值。
   */
  consume(raw: string, section: number): void {
    const line = parseOperationLogLine(raw);
    if (!line) return;
    switch (line.kind) {
      case "sessionStarted":
        if (this.run === null && line.command === "clean") this.run = line.run;
        return;
      case "sessionEnded":
        if (line.run !== this.run) return;
        this.ended = true;
        this.endedItems = line.items;
        this.endedSize = line.size;
        return;
      case "operation": {
        if (line.run !== this.run || this.ended) return;
        const bucket = this.buckets.get(section) ?? { freedBytes: 0, removedCount: 0, failures: [], failureCount: 0 };
        switch (line.action) {
          case "REMOVED": {
            bucket.removedCount += 1;
            const bytes = line.detail === null ? null : bytesFromToken(line.detail);
            if (bytes !== null) bucket.freedBytes += bytes;
            this.lastRemoved = line.path;
            break;
          }
          case "FAILED":
            bucket.failureCount += 1;
            if (bucket.failures.length < failureLimit) {
              bucket.failures.push(line.detail === null ? line.path : `${line.path} · ${line.detail}`);
            }
            break;
          case "SKIPPED":
            this.skippedCount += 1;
            break;
          default:
            break;
        }
        this.buckets.set(section, bucket);
        return;
      }
    }
  }
}

/** 读日志要用的那两项宿主能力（`files.read`）。抽出来只为单测能注入一个按宿主语义读临时文件的替身。 */
export type LogFiles = Pick<FilesAPI, "stat" | "tail">;

/**
 * 一次读取最多追几轮。宿主的 `files.tail` 一次 ≤ 1 MB；Mole 一行一百来字节，半秒一次读的情况下一轮就够，
 * 轮转之后从头读一份大日志时才会要几轮。上限只防一个失控的文件把这一次读变成一个停不下来的循环。
 */
const maximumTailRounds = 64;

/**
 * 从某个位置起读操作日志新增的行（只读，不改它）。
 *
 * 不用文件监视：Mole 每写一行都是一次「打开 · 追加 · 关闭」，读的一方按需把新增的字节读出来就够了；
 * 调用方决定什么时候读（定时、以及标准输出换区段之前）。
 *
 * 半行由宿主处理：`files.tail` 只交回完整的行，返回的 `offset` 停在最后一个换行之后，半行留到下一次。
 *
 * Mole 在会话开始时可能把超过 5MB 的日志改名为 `.old` 再新建一份：读到文件变小、或者换了 inode，就从新文件的开头读。
 */
export class OperationLogReader {
  private constructor(
    private readonly files: LogFiles,
    private readonly path: string,
    private offset: number,
    private inode: number | null,
  ) {}

  /**
   * 从文件此刻的末尾开始读：开跑之前的会话不算。文件此刻不在时从 0 开始——Mole 开跑时才建它。
   * @param files 宿主的 `files` 能力（单测注入替身）。
   * @param path 日志路径（manifest 里声明的那一串）。
   * @returns 读取器；宿主不让读（没授权、没声明）时为 `null`，调用方只看标准输出。
   */
  static async open(files: LogFiles, path: string = operationLogPath): Promise<OperationLogReader | null> {
    try {
      const stat = await files.stat(path);
      return new OperationLogReader(files, path, stat?.size ?? 0, stat?.inode ?? null);
    } catch {
      return null;
    }
  }

  /**
   * 读出新增的完整行。文件不在、或宿主这一次拒绝时什么都不返回——明细缺一拍不该让整次清理失败。
   * @returns 新增的行（不含换行）。
   */
  async readNewLines(): Promise<string[]> {
    const lines: string[] = [];
    try {
      const stat = await this.files.stat(this.path);
      if (!stat) return lines;
      if (stat.inode !== this.inode || stat.size < this.offset) {
        // 轮转过了：新文件从头读。
        this.inode = stat.inode;
        this.offset = 0;
      }
      if (stat.size <= this.offset) return lines;
      for (let round = 0; round < maximumTailRounds; round += 1) {
        const requested = this.offset;
        const tail = await this.files.tail(this.path, requested);
        if (!tail) break;
        if (tail.inode !== this.inode || tail.size < requested) {
          // 两次调用之间又轮转了：这一段是新文件中间的字节，作废，从新文件开头再读。
          this.inode = tail.inode;
          this.offset = 0;
          continue;
        }
        lines.push(...tail.lines);
        this.offset = tail.offset;
        if (tail.offset <= requested || tail.offset >= tail.size) break;
      }
    } catch {
      // 读到一半被拒（例如授权刚被撤销）：已经读到的照交，下一次再试。
    }
    return lines;
  }
}
