/**
 * 纯函数：设置的读法、排序、按什么分组、交给全局搜索的目录、页面上的预览。
 *
 * 这一份就是全局搜索里应用怎么排的全部规则——宿主只照着画（`launcher.apps · catalog`）。
 */
import type { LauncherAppsCatalog, LauncherAppsGroup, MacApp, MacAppLocation } from "@fusionseek/jarvis-extension-sdk";

/** 应用视图怎么分组。 */
export type GroupMode = "category" | "letter" | "location" | "none";
/** 组里怎么排。 */
export type SortMode = "name" | "recent" | "added";

/** 这个扩展的全部设置（存在 `jarvis.storage` 的 `settings` 键里）。 */
export interface Settings {
  group: GroupMode;
  sort: SortMode;
  /** 普通搜索时结果里出不出应用。 */
  showInSearch: boolean;
  /** 搜索结果里至多几条。 */
  searchLimit: number;
  /** 要不要系统自带的应用（`/System/Applications`）。 */
  includeSystem: boolean;
}

export const groupModes: readonly GroupMode[] = ["category", "letter", "location", "none"];
export const sortModes: readonly SortMode[] = ["name", "recent", "added"];
/** 搜索结果条数的几档：3 / 4 / 6。宿主上限是 8；再多就把最近打开与工具挤出一屏了。 */
export const searchLimits: readonly number[] = [3, 4, 6];

export const groupTitles: Record<GroupMode, string> = { category: "分类", letter: "首字母", location: "位置", none: "不分组" };
export const sortTitles: Record<SortMode, string> = { name: "名称", recent: "最近使用", added: "最近添加" };

/** 默认：按分类分组、组里按名称（对照 macOS 26「应用程序」那一屏），搜索里出 4 条，系统应用也列。 */
export const defaultSettings: Settings = { group: "category", sort: "name", showInSearch: true, searchLimit: 4, includeSystem: true };

/**
 * 读存储里的设置：认不出的字段回落到默认（存储是这个扩展自己写的，但升级后可能少字段）。
 * @param raw `jarvis.storage.get("settings")` 的结果。
 * @returns 设置。
 */
export function normalizeSettings(raw: unknown): Settings {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    group: groupModes.includes(value.group as GroupMode) ? (value.group as GroupMode) : defaultSettings.group,
    sort: sortModes.includes(value.sort as SortMode) ? (value.sort as SortMode) : defaultSettings.sort,
    showInSearch: typeof value.showInSearch === "boolean" ? value.showInSearch : defaultSettings.showInSearch,
    searchLimit: searchLimits.includes(value.searchLimit as number) ? (value.searchLimit as number) : defaultSettings.searchLimit,
    includeSystem: typeof value.includeSystem === "boolean" ? value.includeSystem : defaultSettings.includeSystem,
  };
}

// 宿主的 JavaScriptCore 带 ICU，认拼音排序规则；万一没有 Intl，退回 localeCompare（首字母组照样按分界字分，只是不够准）。
const collator: { compare(a: string, b: string): number } = (() => {
  try {
    return new Intl.Collator("zh-Hans-u-co-pinyin", { numeric: true, sensitivity: "base" });
  } catch {
    return { compare: (a: string, b: string) => a.localeCompare(b) };
  }
})();

/**
 * 按名字比：先按首字母组（汉字取拼音首字母，`#` 最后），同组里再按拼音序——`Arc、备忘录、微信、Xcode` 这样交错排，
 * 不是中文排序规则默认的「汉字一段、拉丁字母一段」。
 */
export function compareNames(a: string, b: string): number {
  const la = letterOf(a);
  const lb = letterOf(b);
  if (la !== lb) {
    if (la === "#") return 1;
    if (lb === "#") return -1;
    return la < lb ? -1 : 1;
  }
  return collator.compare(a, b);
}

/**
 * 组里的先后。最近使用 / 最近添加：新的在先，没有时刻的排在后面、再按名字。
 * @param apps 应用。
 * @param sort 怎么排。
 * @returns 排好的新数组。
 */
export function sortApps(apps: readonly MacApp[], sort: SortMode): MacApp[] {
  const byName = (a: MacApp, b: MacApp) => compareNames(a.name, b.name);
  if (sort === "name") return [...apps].sort(byName);
  const key = sort === "recent" ? "lastUsedAt" : "addedAt";
  return [...apps].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    }
    return byName(a, b);
  });
}

// 拼音首字母分组：用拼音排序规则把一个汉字放进「阿…八…嚓…」这串分界字之间——不带字典也能分出 A–Z。
// 分界字逐个对过 ICU 的拼音序（每个字母组里排最前的那一个）；多音字按 ICU 取的那个音（「长」归 Z）。
const letterBoundaries: readonly [string, string][] = [
  ["A", "阿"], ["B", "八"], ["C", "嚓"], ["D", "哒"], ["E", "妸"], ["F", "发"], ["G", "旮"], ["H", "哈"], ["J", "讥"], ["K", "咔"],
  ["L", "垃"], ["M", "呣"], ["N", "拏"], ["O", "噢"], ["P", "妑"], ["Q", "七"], ["R", "呥"], ["S", "仨"], ["T", "他"], ["W", "屲"],
  ["X", "夕"], ["Y", "丫"], ["Z", "帀"],
];

/**
 * 名字的首字母组：拉丁字母取它本身（大写），汉字按拼音，数字与符号归「#」。
 * @param name 名字。
 * @returns `A`–`Z` 或 `#`。
 */
export function letterOf(name: string): string {
  const first = name.trim().charAt(0);
  if (/[A-Za-z]/.test(first)) return first.toUpperCase();
  if (/[㐀-鿿]/.test(first)) {
    let letter = "#";
    for (const [candidate, boundary] of letterBoundaries) {
      if (collator.compare(first, boundary) >= 0) letter = candidate;
      else break;
    }
    return letter;
  }
  return "#";
}

const locationOrder: readonly MacAppLocation[] = ["applications", "user", "system", "other"];

/**
 * 按设置分组：
 * - 分类：按分类名（拼音序），「其他」最后；
 * - 首字母：A–Z，「#」最后；
 * - 位置：应用程序、我的应用、系统、其他位置；
 * - 不分组：一组「全部应用」。
 *
 * 组里按 `sort` 排；空组不出。
 * @param apps 应用（已按设置筛过系统应用）。
 * @param settings 设置。
 * @returns 组。
 */
export function groupApps(apps: readonly MacApp[], settings: Settings): LauncherAppsGroup[] {
  if (settings.group === "none") {
    return apps.length === 0 ? [] : [{ id: "all", title: "全部应用", apps: sortApps(apps, settings.sort).map((app) => app.id) }];
  }
  const buckets = new Map<string, { id: string; title: string; apps: MacApp[] }>();
  for (const app of apps) {
    const [id, title] =
      settings.group === "category"
        ? [`category:${app.category ?? "other"}`, app.categoryTitle]
        : settings.group === "letter"
          ? [`letter:${letterOf(app.name)}`, letterOf(app.name)]
          : [`location:${app.location}`, app.locationTitle];
    const bucket = buckets.get(id) ?? { id, title, apps: [] };
    bucket.apps.push(app);
    buckets.set(id, bucket);
  }
  const ordered = [...buckets.values()].sort((a, b) => {
    if (settings.group === "location") {
      return locationOrder.indexOf(a.id.slice("location:".length) as MacAppLocation) - locationOrder.indexOf(b.id.slice("location:".length) as MacAppLocation);
    }
    const lastA = a.id === "category:other" || a.title === "#";
    const lastB = b.id === "category:other" || b.title === "#";
    if (lastA !== lastB) return lastA ? 1 : -1;
    return settings.group === "letter" ? a.title.localeCompare(b.title) : compareNames(a.title, b.title);
  });
  return ordered.map((bucket) => ({ id: bucket.id, title: bucket.title, apps: sortApps(bucket.apps, settings.sort).map((app) => app.id) }));
}

/**
 * 交给全局搜索的目录（`launcher.apps · catalog`）。
 * @param apps `jarvis.apps.list()` 的结果。
 * @param settings 设置。
 * @returns 目录。
 */
export function catalog(apps: readonly MacApp[], settings: Settings): LauncherAppsCatalog {
  const visible = settings.includeSystem ? apps : apps.filter((app) => !app.system);
  return { showInSearch: settings.showInSearch, searchLimit: settings.searchLimit, groups: groupApps(visible, settings) };
}

/** 页面预览里的一组：标题、个数、前几个名字。 */
export interface PreviewGroup {
  id: string;
  title: string;
  count: number;
  sample: string;
}

/**
 * 页面上的预览：按这套设置分出来的每一组（个数 + 前三个名字），与全局搜索里看到的一致。
 * @param apps 应用。
 * @param settings 设置。
 * @returns 组。
 */
export function preview(apps: readonly MacApp[], settings: Settings): PreviewGroup[] {
  const byID = new Map(apps.map((app) => [app.id, app] as const));
  return catalog(apps, settings).groups.map((group) => {
    const names = group.apps.slice(0, 3).map((id) => byID.get(id)?.name ?? "");
    const more = group.apps.length > 3 ? " 等" : "";
    return { id: group.id, title: group.title, count: group.apps.length, sample: names.join("、") + more };
  });
}
