/**
 * 一次深度清理跑的过程中的全部状态：标准输出的解析 + 操作日志的读取与累计（移植自宿主 `MoleLiveState`）。
 *
 * 两路输入各自到达：标准输出逐行（宿主按 100ms 合批推过来），日志由定时器去读。宿主那一版用一把锁护着；
 * 这里读日志是一次异步的宿主调用，锁换成**一条串行队列**——每一行输出、每一次读日志都排进同一条队，
 * 前一件做完才做下一件，于是「先读干净日志、再换区段」这条顺序在 `await` 之间也不会被插队。
 *
 * **归类**：日志行不带区段名，按「此刻标准输出停在哪个区段」归。标准输出每出现一个新区段 `➤`，**先把日志读干净再换区段**——
 * Mole 顺序执行，上一段的删除记录一定先于下一段的标题落盘，这样归类不会错位。
 */
import type { JunkCleanProgress } from "@fusionseek/jarvis-extension-sdk";
import { clampPath, clampText, limits } from "./limits.js";
import { CleanOutputParser, localizedTitle, sectionHeading } from "./output-parser.js";
import { OperationLogParser, type OperationLogReader } from "./operation-log.js";

/** 一份进度的比较键：字段顺序固定，`JSON.stringify` 相同即两份进度相同。 */
function progressKey(progress: JunkCleanProgress): string {
  return JSON.stringify([
    progress.sectionTitle ?? null,
    progress.freedBytes,
    progress.itemCount,
    progress.completedSections,
    progress.fraction ?? null,
    progress.currentItem ?? null,
  ]);
}

/** 跑一次清理期间的状态。 */
export class LiveState {
  /** 标准输出的解析结果。 */
  readonly parser = new CleanOutputParser();
  /** 操作日志的累计结果。 */
  readonly log = new OperationLogParser();
  private queue: Promise<unknown> = Promise.resolve();
  private lastEmitted: string | null = null;

  /**
   * 建一份状态。
   * @param reader 操作日志读取器；`null` 时只看标准输出（没授权 `files.read`、宿主不让读）。
   */
  constructor(private readonly reader: OperationLogReader | null) {}

  /**
   * 喂一行标准输出；数字或区段变了时给出一份进度。
   * @param line 一行。
   * @returns 进度；没变时为 `null`。
   */
  consume(line: string): Promise<JunkCleanProgress | null> {
    return this.serial(async () => {
      if (sectionHeading(line) !== null) await this.drainLog();
      this.parser.consume(line);
      return this.emitIfChanged();
    });
  }

  /**
   * 读一次操作日志；数字变了时给出一份进度。
   * @returns 进度；没变时为 `null`。
   */
  poll(): Promise<JunkCleanProgress | null> {
    return this.serial(async () => {
      await this.drainLog();
      return this.emitIfChanged();
    });
  }

  /**
   * 等队列里已经排着的事全部做完。
   * @returns 做完时兑现。
   */
  idle(): Promise<void> {
    return this.serial(async () => undefined);
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    // 一件事出错不能卡死后面的：队列只关心「做完了」，不关心成败。
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async drainLog(): Promise<void> {
    if (!this.reader) return;
    const section = this.parser.sections.length - 1;
    for (const line of await this.reader.readNewLines()) this.log.consume(line, section);
  }

  private emitIfChanged(): JunkCleanProgress | null {
    let freed = 0;
    let items = 0;
    this.parser.sections.forEach((section, index) => {
      const bucket = this.log.buckets.get(index);
      freed += Math.max(section.freedBytes, bucket?.freedBytes ?? 0);
      items += Math.max(section.itemCount, bucket?.removedCount ?? 0);
    });
    // 第一个区段之前删掉的（不该有，有就照算）。
    const before = this.log.buckets.get(-1);
    freed += before?.freedBytes ?? 0;
    items += before?.removedCount ?? 0;
    const current = this.parser.sections[this.parser.sections.length - 1];
    const snapshot: JunkCleanProgress = {
      freedBytes: freed,
      itemCount: items,
      completedSections: Math.max(0, this.parser.sections.length - 1),
      fraction: this.parser.estimatedFraction,
    };
    if (current) snapshot.sectionTitle = clampText(localizedTitle(current.title), limits.sectionTitle);
    // 交绝对路径：主目录写成 `~` 是宿主的事——它知道主目录在哪，扩展不需要知道。
    if (this.log.lastRemoved !== null) snapshot.currentItem = clampPath(this.log.lastRemoved, limits.currentItem);
    const key = progressKey(snapshot);
    if (key === this.lastEmitted) return null;
    this.lastEmitted = key;
    return snapshot;
  }
}
