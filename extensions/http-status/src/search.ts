/**
 * 查找与搜索：输入框里那一串字符怎么变成一条码、一列码，或者一句"没有这个码"。
 *
 * 三条路，按这个顺序试：
 *
 * 1. **类**（`4xx`）——分类那一屏点一行就是走这条；
 * 2. **数字**——三位且在表里 = 直接开详情；一到两位 = 前缀（`40` → 400…409）；
 * 3. **关键词**——英文名、中文名与别名的子串匹配，中英文都收（搜「超时」命中 408 / 504 / 522 / 524）。
 *
 * 里头还有一条捷径：整行日志粘进来也认（`< HTTP/1.1 502 Bad Gateway` → 502）。
 * 它与 ⌥⌘/ 从剪贴板里抓码用的是同一个 `extractCode`，因为那两件事本来就是同一件。
 *
 * 排序永远是**按码升序**，没有"相关度"：查手册的人要的是可预测，不是每次换一批。
 */
import { byCode, catalog, classOf, type StatusCode } from "./data.js";

export type StatusClass = 1 | 2 | 3 | 4 | 5;

export interface SearchOptions {
  /** 会话值：列表结果里要不要带上非标准码。精确查某个码时不受它影响——你都把码敲全了。 */
  includeUnofficial: boolean;
  /** 「只看 5xx」那枚 chip。 */
  classFilter: StatusClass | null;
}

export type SearchOutcome =
  /** 空输入：画分类那一屏。 */
  | { kind: "browse" }
  /** 敲了一个确切的码：直接进详情。 */
  | { kind: "exact"; entry: StatusCode }
  /** 多条命中：画结果清单。`label` 是段标题右端那句读数。 */
  | { kind: "list"; entries: StatusCode[]; label: string }
  /** 什么都没命中。`reason` 决定空屏上那句话怎么写。 */
  | { kind: "empty"; reason: "out-of-range" | "no-such-code" | "no-match" };

const CLASS_PATTERN = /^([1-5])\s*x{2}$/i;
const DIGITS_ONLY = /^\d{1,3}$/;

/** 列表结果的过滤：非标准码与类筛选。 */
function filtered(entries: StatusCode[], options: SearchOptions): StatusCode[] {
  return entries.filter((entry) => {
    if (entry.unofficial && !options.includeUnofficial) return false;
    if (options.classFilter && classOf(entry.code) !== options.classFilter) return false;
    return true;
  });
}

/**
 * 从任意一段文字里抓出状态码。⌥⌘/ 读剪贴板与搜索框粘整行都走它。
 *
 * 按把握从大到小试三种形状，第一个命中就返回：响应行（`HTTP/1.1 502`）、
 * 带名字的字段（`status: 404`、`状态码 500`），最后才是"一个孤零零的三位数"。
 * 顺序不是装饰：日志里 `port 8080` 与 `took 404ms` 到处都是，
 * 先认前两种能把绝大多数误抓挡在外面。
 */
export function extractCode(text: string): number | null {
  if (!text) return null;
  const patterns = [
    /HTTP\/\d(?:\.\d)?\s+([1-5]\d{2})\b/i,
    /\b(?:status(?:\s*code)?|code|状态码|返回码)\s*[:：=]?\s*([1-5]\d{2})\b/i,
    /(?:^|[^\d.])([1-5]\d{2})(?![\d.])/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const code = Number(match[1]);
      if (code >= 100 && code <= 599) return code;
    }
  }
  return null;
}

/** 关键词匹配：英文名、中文名、别名。大小写不敏感，不匹配 `summary`——那会把半张表都捞回来。 */
function matchesKeyword(entry: StatusCode, needle: string): boolean {
  if (entry.name.toLowerCase().includes(needle)) return true;
  if (entry.zh.includes(needle)) return true;
  return (entry.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle));
}

export function search(query: string, options: SearchOptions): SearchOutcome {
  const trimmed = query.trim();
  if (trimmed === "") return { kind: "browse" };

  // 1. 类
  const classMatch = CLASS_PATTERN.exec(trimmed);
  if (classMatch?.[1]) {
    const klass = Number(classMatch[1]) as StatusClass;
    const entries = filtered(catalog.filter((entry) => classOf(entry.code) === klass), options);
    return entries.length
      ? { kind: "list", entries, label: `${klass}xx · ${entries.length} 个` }
      : { kind: "empty", reason: "no-match" };
  }

  // 2. 数字
  if (DIGITS_ONLY.test(trimmed)) {
    if (trimmed.length === 3) {
      const code = Number(trimmed);
      const entry = byCode(code);
      if (entry) return { kind: "exact", entry };
      return { kind: "empty", reason: classOf(code) === 0 ? "out-of-range" : "no-such-code" };
    }
    const entries = filtered(catalog.filter((entry) => String(entry.code).startsWith(trimmed)), options);
    return entries.length
      ? { kind: "list", entries, label: `${trimmed}… · ${entries.length} 个` }
      : { kind: "empty", reason: "no-such-code" };
  }

  // 2.5 粘进来一整行：`< HTTP/1.1 502 Bad Gateway`
  const embedded = extractCode(trimmed);
  if (embedded !== null) {
    const entry = byCode(embedded);
    if (entry) return { kind: "exact", entry };
  }

  // 3. 关键词
  const needle = trimmed.toLowerCase();
  const entries = filtered(catalog.filter((entry) => matchesKeyword(entry, needle)), options);
  if (entries.length === 1 && entries[0]) return { kind: "exact", entry: entries[0] };
  return entries.length
    ? { kind: "list", entries, label: `${entries.length} 个` }
    : { kind: "empty", reason: "no-match" };
}

export interface ClassSummary {
  klass: StatusClass;
  /** 段标题：`4xx · 客户端错误`。 */
  title: string;
  /** 副标：这一类里前几个码，给人一眼认出"是这一类"。 */
  preview: string;
  count: number;
  symbol: string;
  tint: "neutral" | "live" | "blue" | "alert" | "danger";
}

const CLASS_META: Record<StatusClass, { title: string; symbol: string; tint: ClassSummary["tint"] }> = {
  1: { title: "1xx · 信息", symbol: "info.circle", tint: "neutral" },
  2: { title: "2xx · 成功", symbol: "checkmark.circle", tint: "live" },
  3: { title: "3xx · 重定向", symbol: "arrow.triangle.turn.up.right.circle", tint: "blue" },
  4: { title: "4xx · 客户端错误", symbol: "exclamationmark.triangle", tint: "alert" },
  5: { title: "5xx · 服务端错误", symbol: "xmark.octagon", tint: "danger" },
};

/** 分类那一屏的五行。**只数标准码**：非标准码不属于任何一类的"官方成员"。 */
export function classSummaries(): ClassSummary[] {
  return ([1, 2, 3, 4, 5] as StatusClass[]).map((klass) => {
    const entries = catalog.filter((entry) => !entry.unofficial && classOf(entry.code) === klass);
    const preview = entries.slice(0, 5).map((entry) => entry.code).join(" ");
    const meta = CLASS_META[klass];
    return {
      klass,
      title: meta.title,
      symbol: meta.symbol,
      tint: meta.tint,
      preview: entries.length > 5 ? `${preview} …` : preview,
      count: entries.length,
    };
  });
}

/** 一个码画成什么颜色。非标准码不换色——它的"非标准"由徽标说，不由颜色说。 */
export function tintFor(code: number): "neutral" | "live" | "blue" | "alert" | "danger" {
  return CLASS_META[(classOf(code) || 1) as StatusClass].tint;
}

export function symbolFor(code: number): string {
  return CLASS_META[(classOf(code) || 1) as StatusClass].symbol;
}
