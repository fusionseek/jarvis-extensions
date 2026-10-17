/**
 * 纯函数：大小怎么写、怎么排、怎么搜、一屏画几行、下一批该问哪几个包、选哪台设备、设备为什么读不了。
 *
 * 全部不碰 `jarvis`，因此 `test/model.test.mjs` 能在 node 里直接断言；`session.ts` 与 `page.ts` 只是把它们接到宿主上。
 */
import type { AndroidApp, AndroidAppDetail, AndroidAppScope, AndroidDevice } from "@fusionseek/jarvis-extension-sdk";

/** 怎么排：`size` = 占得多的在前；`name` = 按应用名（读不到名字的按包名）。 */
export type SortOrder = "size" | "name";

/**
 * 列表一次多画几行。
 *
 * 40 行约是这块面板滚三屏的量：第一屏露出来的五六行之外留足余量，又不至于一进来就把几百行一起交给宿主。
 * 也是「一屏一屏读应用名」的单位——读名字只读画出来的这些行。
 */
export const pageSize = 40;

/**
 * 列表最多画几行。
 *
 * 一次 render 至多 500 个节点（`maximumNodesPerRender`）；每行是一个节点，页面其余的段、说明、按钮约 30 个，
 * 留出余量取 400。装了几百个系统应用的手机在「全部」里滚到底会碰到它，这时页面说一句「用搜索缩小范围」。
 */
export const maximumRows = 400;

/** 缓存里的一条详情，连同读它那一刻的安装包大小：大小变了 = 应用更新过，名字、版本、图标都可能变了。 */
export interface CachedDetail {
  detail: AndroidAppDetail;
  apkBytes: number | null;
}

// ── 大小 ────────────────────────────────────────────────────────────────

/** 十进制单位：与 Android「设置 › 存储」、Finder 同一套（1 KB = 1000 B），用户拿去对照时数字对得上。 */
const units = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * 字节数的读法：`1.2 GB`、`312 MB`、`45.3 MB`、`0 B`。
 *
 * 100 以下留一位小数、100 以上取整：一列数字里「1.24 GB」与「312.57 MB」并排时，多出来的位数只是噪音。
 * 四舍五入会进到下一档时先升单位：999.7 MB 写成 1 GB，不写 1000 MB。
 * @param bytes 字节数；负数与 NaN 当 0。
 * @returns 读数。
 */
export function formatBytes(bytes: number): string {
  const total = Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0;
  if (total < 1000) return `${total} B`;
  let value = total;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (value >= 999.5 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const text = value < 99.95 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(0);
  return `${text} ${units[unit]}`;
}

/**
 * 一个应用一共占多少：安装包 + 数据 + 缓存里**知道的**那几块。
 * @param app 应用。
 * @returns 字节数；三块都不知道时为 `null`（「不知道」不是 0）。
 */
export function totalBytes(app: AndroidApp): number | null {
  const parts = [app.apkBytes, app.dataBytes, app.cacheBytes].filter((part): part is number => part !== null);
  return parts.length === 0 ? null : parts.reduce((sum, part) => sum + part, 0);
}

/**
 * 行上那段大小。安装包与数据都知道时把两块分开写（「卸载能省多少」「清数据能省多少」是两个问题）；
 * 只知道一部分时只写总数；全不知道时明说读不出来，而不是写 0。
 * @param app 应用。
 * @returns 例如 `1.2 GB · 安装包 300 MB / 数据 900 MB`、`42 MB`、`大小读不出`。
 */
export function sizeLine(app: AndroidApp): string {
  const total = totalBytes(app);
  if (total === null) return "大小读不出";
  if (app.apkBytes !== null && app.dataBytes !== null) {
    const data = app.dataBytes + (app.cacheBytes ?? 0);
    return `${formatBytes(total)} · 安装包 ${formatBytes(app.apkBytes)} / 数据 ${formatBytes(data)}`;
  }
  return formatBytes(total);
}

// ── 名字、搜索、排序 ──────────────────────────────────────────────────

/**
 * 一行的标题：读到应用名就用应用名，没读到（还没轮到、或读不出）就用包名。
 * @param app 应用。
 * @param detail 缓存里那条详情；没有为 `undefined`。
 * @returns 标题。
 */
export function displayName(app: AndroidApp, detail: AndroidAppDetail | undefined): string {
  const label = detail?.label?.trim();
  return label ? label : app.package;
}

/**
 * 行的说明：系统应用先标一个「系统」；标题已经是应用名时补上包名（标题就是包名时不再重复）；最后是大小。
 * @param app 应用。
 * @param detail 缓存里那条详情。
 * @param scope 此刻列的是哪一种；只有「全部」里才需要区分系统应用。
 * @returns 说明。
 */
export function rowSubtitle(app: AndroidApp, detail: AndroidAppDetail | undefined, scope: AndroidAppScope): string {
  const parts: string[] = [];
  if (scope === "all" && app.system) parts.push("系统");
  if (displayName(app, detail) !== app.package) parts.push(app.package);
  parts.push(sizeLine(app));
  return parts.join(" · ");
}

/**
 * 搜索：应用名或包名里含有这串字（不分大小写，首尾空白不算）。
 *
 * 应用名要读过才知道，因此没读到名字的应用**只按包名**匹配——空结果那一屏会把这件事说出来。
 * @param app 应用。
 * @param detail 缓存里那条详情。
 * @param query 搜索框里的字。
 * @returns 是否留下。
 */
export function matchesQuery(app: AndroidApp, detail: AndroidAppDetail | undefined, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  if (app.package.toLowerCase().includes(needle)) return true;
  return (detail?.label ?? "").toLowerCase().includes(needle);
}

/**
 * 名字的比较：中文按拼音、数字按数值（「微信 2」排在「微信 10」前面）。
 *
 * 只建一个 `Intl.Collator`：几百个应用排一次序要比较几千次，每次 `localeCompare(…, locale)` 都现建一个比较器。
 */
let collator: Intl.Collator | null = null;
function compareNames(a: string, b: string): number {
  collator ??= new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });
  return collator.compare(a, b);
}

/**
 * 排序。不改入参。
 *
 * - `size`：总大小从大到小；大小读不出的排在最后（它们不是「最小」）；同样大的按名字。
 * - `name`：按标题（应用名，读不到就是包名）；同名的按包名，让顺序在每一次重画之间稳定。
 *   zh 的排序规则里汉字排在拉丁字母之前，所以还没读到名字的行（标题是 `com.…`）自然落在有中文名的那些后面。
 * @param apps 应用。
 * @param order 怎么排。
 * @param detailOf 取一个包的详情。
 * @returns 排好的新数组。
 */
export function sortApps(apps: readonly AndroidApp[], order: SortOrder, detailOf: (name: string) => AndroidAppDetail | undefined): AndroidApp[] {
  const byName = (a: AndroidApp, b: AndroidApp) =>
    compareNames(displayName(a, detailOf(a.package)), displayName(b, detailOf(b.package))) || compareNames(a.package, b.package);
  if (order === "name") return [...apps].sort(byName);
  return [...apps].sort((a, b) => {
    const x = totalBytes(a);
    const y = totalBytes(b);
    if (x === null && y === null) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || byName(a, b);
  });
}

// ── 汇总 ────────────────────────────────────────────────────────────────

/** 一组应用的汇总。 */
export interface AppSummary {
  count: number;
  /** 知道大小的那些加起来。 */
  bytes: number;
  /** 大小一块都读不出的个数。 */
  unknown: number;
}

/**
 * 汇总一组应用。
 * @param apps 应用。
 * @returns 个数、已知大小之和、读不出大小的个数。
 */
export function summarize(apps: readonly AndroidApp[]): AppSummary {
  let bytes = 0;
  let unknown = 0;
  for (const app of apps) {
    const total = totalBytes(app);
    if (total === null) unknown += 1;
    else bytes += total;
  }
  return { count: apps.length, bytes, unknown };
}

/**
 * 段标题右端那一行：`86 个应用 · 共 12.4 GB`；在搜时写 `匹配 3 / 86 · 共 1.1 GB`（共多少按匹配到的算）。
 * @param matched 搜索之后留下的。
 * @param all 这台设备、这一种范围里的全部。
 * @param searching 搜索框里有没有字。
 * @returns 读数。
 */
export function summaryLine(matched: AppSummary, all: AppSummary, searching: boolean): string {
  const head = searching ? `匹配 ${matched.count} / ${all.count}` : `${all.count} 个应用`;
  return `${head} · 共 ${formatBytes(searching ? matched.bytes : all.bytes)}`;
}

// ── 分页与分批 ──────────────────────────────────────────────────────────

/**
 * 此刻画几行：不超过已经展开的行数、不超过上限、不超过有的行数。
 * @param available 过滤之后有几行。
 * @param visibleCount 已经展开到几行（`pageSize` 的整数倍）。
 * @returns 画几行。
 */
export function rowsToRender(available: number, visibleCount: number): number {
  return Math.max(0, Math.min(available, visibleCount, maximumRows));
}

/**
 * 还能不能再展开一页：后面还有、且没碰到上限。
 * @param available 过滤之后有几行。
 * @param visibleCount 已经展开到几行。
 * @returns 能不能。
 */
export function canLoadMore(available: number, visibleCount: number): boolean {
  return visibleCount < Math.min(available, maximumRows);
}

/**
 * 再展开一页之后是几行。
 * @param visibleCount 此刻展开到几行。
 * @returns 新的行数（不超过上限）。
 */
export function nextVisibleCount(visibleCount: number): number {
  return Math.min(visibleCount + pageSize, maximumRows);
}

/**
 * 下一批该问哪几个包：按给的顺序（屏幕上从上往下）挑还没有可用详情的，去重，至多 `limit` 个。
 * @param packages 候选，按优先级排好（先是画出来的行）。
 * @param isKnown 这个包是不是已经有可用的详情（含读过但读不出的那种：不再问）。
 * @param limit 一批至多几个（宿主的上限是 8）。
 * @returns 这一批；空数组 = 没有要问的了。
 */
export function nextDetailsBatch(packages: readonly string[], isKnown: (name: string) => boolean, limit: number): string[] {
  const batch: string[] = [];
  const seen = new Set<string>();
  for (const name of packages) {
    if (batch.length >= limit) break;
    if (seen.has(name)) continue;
    seen.add(name);
    if (!isKnown(name)) batch.push(name);
  }
  return batch;
}

/**
 * 缓存里那条详情还能不能用：读它那一刻的安装包大小与此刻一样。大小变了 = 应用更新过（或换了一个同名包），
 * 名字、版本、图标都可能变了，重新读；两边都不知道大小时照用（没有更好的判据，也不值得为它重拉一次安装包）。
 * @param entry 缓存里那一条。
 * @param app 此刻列表里的这个应用。
 * @returns 能不能用。
 */
export function isCacheFresh(entry: CachedDetail, app: AndroidApp): boolean {
  return entry.apkBytes === app.apkBytes;
}

// ── 设备 ────────────────────────────────────────────────────────────────

/**
 * 选哪台设备：刚才选着的那台还 ready 就不动它（重新扫描不该把人从正在看的那台手机上拽走），否则选第一台 ready 的。
 * @param devices adb 此刻看得见的设备。
 * @param current 刚才选着的序列号。
 * @returns 序列号；一台 ready 的都没有为 `null`。
 */
export function chooseSerial(devices: readonly AndroidDevice[], current: string | null): string | null {
  const ready = devices.filter((device) => device.ready);
  if (current !== null && ready.some((device) => device.serial === current)) return current;
  return ready[0]?.serial ?? null;
}

/**
 * 一台读不了的设备该怎么跟用户说：标题说它怎么了，提示说他该去哪儿做什么。
 * @param device 不是 `ready` 的那台。
 * @returns 标题与提示。
 */
export function deviceIssue(device: AndroidDevice): { title: string; hint: string } {
  switch (device.state) {
    case "unauthorized":
      return { title: `${device.name} 还没允许这台电脑调试`, hint: "在手机上点「允许 USB 调试」，再点重新扫描" };
    case "offline":
      return { title: `${device.name} 离线`, hint: "重新插一次 USB 线，或在手机上关掉再打开 USB 调试，再点重新扫描" };
    default:
      return { title: `${device.name} 此刻读不了应用`, hint: "它不在正常开机的系统里（recovery、sideload 之类）；开机进系统后再点重新扫描" };
  }
}

/**
 * 从一次被拒的调用里取出错误码与那句人话。
 * @param error `catch` 到的东西。
 * @param fallback 宿主没给话时用的那一句。
 * @returns 错误码（认不出为 `undefined`）与给人读的话。
 */
export function describeError(error: unknown, fallback: string): { code: string | undefined; message: string } {
  const shape = (error ?? {}) as { code?: unknown; message?: unknown; detail?: unknown };
  const code = typeof shape.code === "string" ? shape.code : undefined;
  const detail = typeof shape.detail === "string" && shape.detail.trim() !== "" ? shape.detail : undefined;
  const message = typeof shape.message === "string" && shape.message.trim() !== "" ? shape.message : undefined;
  return { code, message: detail ?? message ?? fallback };
}
