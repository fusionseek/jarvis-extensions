/**
 * 把 `mo clean` 打到标准输出的纯文本读成一份分类结果（移植自宿主 `MoleCleanOutputParser`）。
 *
 * 读的是三样东西：`➤ 区段` 行定下当前区段；区段里 `  ✓ 描述 · [N items, ]大小` 的行累进那一段；
 * 末尾 `Tracked cleanup: X | Items cleaned: N` 与 `Free space: A (+B)` 两行给出总数与真实的磁盘变化。
 * 解析是尽力而为：Mole 里不少行没有大小（例如废纸篓、`brew cleanup`），它们也不进 Mole 自己的 Tracked 总数。
 *
 * 纯数据，不碰宿主：单测直接喂行。
 */

/** 读到的一段。 */
export interface OutputSection {
  /** Mole 打印的区段名（英文原文，也是报告里这一类的 `id`）。 */
  title: string;
  freedBytes: number;
  itemCount: number;
  /** 「bun cache：skipped (whitelist)」这类没清掉东西的说明。 */
  notes: string[];
}

/** `mo clean` 收尾时打印的几种标题。 */
const headings = new Set(["Cleanup complete", "Cleanup cancelled", "Cleanup interrupted", "Cleanup incomplete"]);

/**
 * `mo clean` 打印区段的固定顺序（Mole `bin/clean.sh` 的 `run_clean_sections`）。空段不打印，
 * 但出现的那些永远按这个顺序——于是「现在到了第几段」就是一个诚实的进度估计。
 */
export const sectionOrder: readonly string[] = [
  "System",
  "User essentials",
  "App caches",
  "Browsers",
  "Cloud & Office",
  "Developer tools",
  "Apps & utilities",
  "Virtualization",
  "Application Support",
  "App leftovers",
  "Apple Silicon updates",
  "Device backups & firmware",
  "Time Machine",
  "Large files",
  "Project artifacts",
];

/** 一个非负十进制数（`2.40`、`12`、`.5`、`1e3`）：与 Swift `Double(String)` 认得的那部分相同，但不认 `inf` / `nan`。 */
const decimalPattern = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * `2.40GB` / `512.3MB` / `12KB` / `100B` → 字节。Mole 用十进制单位（1 KB = 1000 B）。
 * @param text 大小记号。
 * @returns 字节数；不是大小记号（`items`、`GB`、`-1GB`）时为 `null`。
 */
export function bytesFromToken(text: string): number | null {
  const units: [string, number][] = [
    ["TB", 1e12],
    ["GB", 1e9],
    ["MB", 1e6],
    ["KB", 1e3],
    ["B", 1],
  ];
  for (const [suffix, scale] of units) {
    if (!text.endsWith(suffix)) continue;
    // 第一个对上的后缀就是答案：`2GB` 也以 `B` 结尾，但它先被 `GB` 认走；认不出数字就不是大小，不再往下试。
    const number = text.slice(0, text.length - suffix.length);
    if (!decimalPattern.test(number)) return null;
    const value = Number(number);
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * scale);
  }
  return null;
}

/**
 * 严格的整数：整串都是数字才算（与 Swift `Int(String)` 一致），`12x` 不是 12。
 * @param text 原文。
 * @returns 整数；不是时为 `null`。
 */
export function strictInteger(text: string): number | null {
  return /^[+-]?\d+$/.test(text) ? Number(text) : null;
}

/** 去掉终端颜色码。宿主给 `mo` 设了 `NO_COLOR=1`，但 Mole 有几行是硬编码的转义序列。 */
function stripANSI(text: string): string {
  return text.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");
}

/**
 * 这一行是不是一个新区段的标题（`➤ User essentials`）。
 *
 * 单独露出来是因为 `LiveState` 要在**换区段之前**先把操作日志读干净，判断必须与解析器同一套规则——
 * 两边各写一遍，一边认、一边不认的那一行就会让日志归错类。
 * @param raw 标准输出的一行。
 * @returns 区段名；不是标题行时为 `null`。
 */
export function sectionHeading(raw: string): string | null {
  const trimmed = stripANSI(raw).trim();
  if (!trimmed.startsWith("➤ ")) return null;
  return trimmed.slice(2).trim();
}

/**
 * Mole 的区段名在结果页上的中文名。不认识的原样显示：Mole 新加的区段照样能看，只是没翻译。
 * @param title Mole 打印的区段名。
 * @returns 中文名。
 */
export function localizedTitle(title: string): string {
  switch (title) {
    case "System":
      return "系统（需管理员权限）";
    case "User essentials":
      return "用户缓存、日志与废纸篓";
    case "App caches":
      return "应用缓存";
    case "Browsers":
      return "浏览器缓存";
    case "Cloud & Office":
      return "云盘与办公";
    case "Developer tools":
      return "开发工具缓存";
    case "Apps & utilities":
      return "应用与工具";
    case "Virtualization":
      return "虚拟化";
    case "Application Support":
      return "应用支持日志";
    case "App leftovers":
      return "已卸载应用残留";
    case "Apple Silicon updates":
      return "Apple 芯片更新缓存";
    case "Device backups & firmware":
      return "设备固件";
    case "Time Machine":
      return "时间机器未完成备份";
    case "Large files":
      return "大文件（仅提示）";
    case "Project artifacts":
      return "项目构建产物（仅提示）";
    case "External volume":
      return "外接卷";
    default:
      return title;
  }
}

/** 标准输出解析器：一行一行喂，随时读当前结论。 */
export class CleanOutputParser {
  /** 按出现顺序的区段。 */
  readonly sections: OutputSection[] = [];
  /** `Tracked cleanup` 的总数（字节）。 */
  trackedBytes: number | null = null;
  /** `Items cleaned` 的总数。 */
  trackedItems: number | null = null;
  /** `Free space` 的变化原文（例如 `+4.50GB`）。 */
  freeSpaceDelta: string | null = null;
  /** 收尾标题（`Cleanup complete` / `Cleanup cancelled` / …）。 */
  heading: string | null = null;
  /** 系统级那一段因为没有 sudo 被跳过。 */
  systemSkipped = false;

  /**
   * 喂一行。
   * @param raw 标准输出的一行（不含换行）。
   * @returns 无返回值。
   */
  consume(raw: string): void {
    const title = sectionHeading(raw);
    if (title !== null) {
      this.sections.push({ title, freedBytes: 0, itemCount: 0, notes: [] });
      return;
    }
    const trimmed = stripANSI(raw).trim();
    if (trimmed.includes("System-level cleanup skipped")) this.systemSkipped = true;
    if (headings.has(trimmed)) {
      this.heading = trimmed;
      return;
    }
    if (trimmed.startsWith("Tracked cleanup:")) {
      // 与 Swift `split(separator:)` 一致：两个 `|` 之间什么都没有的那一段不算。
      const parts = trimmed
        .slice("Tracked cleanup:".length)
        .split("|")
        .filter((part) => part.length > 0)
        .map((part) => part.trim());
      const first = parts[0];
      if (first !== undefined) this.trackedBytes = bytesFromToken(first.replace(/At least /g, ""));
      const items = parts.slice(1).find((part) => part.startsWith("Items cleaned:"));
      if (items !== undefined) this.trackedItems = strictInteger(items.slice("Items cleaned:".length).trim());
      return;
    }
    if (trimmed.startsWith("Free space:")) {
      const open = trimmed.indexOf("(");
      const close = trimmed.lastIndexOf(")");
      if (open >= 0 && open < close) this.freeSpaceDelta = trimmed.slice(open + 1, close);
      return;
    }
    const section = this.sections[this.sections.length - 1];
    if (!trimmed.startsWith("✓ ") || section === undefined) return;
    const body = trimmed.slice(2);
    const pieces = body.split(" · ");
    // 有 ` · ` 时详情是最后一段；没有时（「Cleaned 2 items, about 7.8MB」「Orphaned app container stubs, 3 removed」）
    // 整行都是详情——只要里面读得出大小或条目数。
    const detail = pieces.length >= 2 ? pieces[pieces.length - 1]! : body;
    if (detail.startsWith("skipped")) {
      // 「bun cache · skipped (whitelist)」：没清掉任何东西，记成说明，不算条目。
      section.notes.push(`${pieces[0]}：${detail}`);
      return;
    }
    // 条目数的几种写法：「12 items」「3 dirs」「Cleaned 2 items」「3 removed」「removed 4 (1.2GB)」。
    const counted = /(\d+) (items?|files?|dirs?|stubs?|removed)\b/.exec(detail) ?? /(Cleaned|removed) (\d+)/.exec(detail);
    // 大小是这一行的最后一个形如 `2.40GB` 的记号；括号、逗号包着的照读（「removed 3 (1.2GB)」）。
    const tokens = detail.split(/[ ,()]/).filter((token) => token.length > 0);
    let size: number | null = null;
    for (let index = tokens.length - 1; index >= 0 && size === null; index -= 1) size = bytesFromToken(tokens[index]!);
    if (pieces.length < 2 && counted === null && size === null) return;
    if (size !== null) section.freedBytes += size;
    // 没写条目数的行算 1 项；只写条目数的行（「Trash · emptied, 9 items」）只记条目、不加大小。
    let count = 1;
    if (counted !== null) {
      for (const word of counted[0].split(" ")) {
        const value = strictInteger(word);
        if (value !== null) {
          count = value;
          break;
        }
      }
    }
    section.itemCount += count;
  }

  /**
   * 按读到的区段估一个进度：最靠后的那个已知区段**刚开始**时的位置（第 i 段 → i / 15）。
   * 没读到任何已知区段时为 0；不认识的区段不推进、也不倒退。
   */
  get estimatedFraction(): number {
    let last = -1;
    for (const section of this.sections) last = Math.max(last, sectionOrder.indexOf(section.title));
    return last < 0 ? 0 : last / sectionOrder.length;
  }
}
