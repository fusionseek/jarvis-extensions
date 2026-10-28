/**
 * 今天的流量统计（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）：窗口「活动」页的分时柱与 Top 10。
 *
 * 纯函数，不碰宿主。后台会话在代理开着时每秒已经读一次 `/connections`（悬浮球与菜单栏要它），这里把同一份快照按连接 id 记差值：
 * 一条连接上一次读到 `↑ a / ↓ b`，这一次 `↑ a' / ↓ b'`，差值记进「今天第几个小时」的桶与「今天按进程 / 域名 / 策略」的合计。
 * 第一次见到的连接把它到此刻的全部字节记进去（它多半是这一秒刚建的）；从快照里消失的连接最后不到一秒的字节记不到——
 * 这是轮询的代价，换来的是不必让 sing-box 把每条连接的结束推过来。
 *
 * 只记今天：本地 0 点换天清零。存进扩展存储的一份（`stats.today`）至多 24 个桶、每类至多 {@link maximumKeys} 个键，
 * 超出时按合计淘汰最小的——一份几 KB，远在存储单键 64 KB 之内。
 */
import type { ConnectionInfo, ConnectionsSnapshot } from "./clash.js";
import { DIRECT_TAG } from "./nodes.js";

/** 每类至多记多少个键（进程、域名、策略各自）。200：Top 10 只用前十，留够余量让后来居上的不被早早淘汰。 */
export const maximumKeys = 200;

/** 一个键（一个进程 / 域名 / 策略）今天的合计。 */
export interface Usage {
  upload: number;
  download: number;
  /** 今天见过几条连接。 */
  connections: number;
}

/** 24 个小时桶：`upload[h]` / `download[h]` 是本地 h 点到 h+1 点之间的字节数。 */
export interface HourBuckets {
  upload: number[];
  download: number[];
}

/** 今天的统计（存进 `stats.today` 的那一份）。 */
export interface DayStats {
  /** 本地日期 `YYYY-MM-DD`。 */
  day: string;
  /** 全部连接。 */
  all: HourBuckets;
  /** 只算出站链最后一跳不是直连、不是拒绝的连接（「仅代理」）。 */
  proxy: HourBuckets;
  processes: Record<string, Usage>;
  domains: Record<string, Usage>;
  policies: Record<string, Usage>;
  /** 最近一次记账的时刻（Unix 毫秒）。 */
  updatedAt: number;
}

/** 记账的状态：今天的统计 + 每条连接上一次读到的累计（只在内存里）。 */
export interface StatsState {
  stats: DayStats;
  seen: Map<string, { upload: number; download: number }>;
}

/** Top 10 的一类。 */
export type UsageCategory = "processes" | "domains" | "policies";

/**
 * 本地日期。
 * @param now Unix 毫秒。
 * @returns `YYYY-MM-DD`。
 */
export function localDay(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 24 个 0。 */
function emptyBuckets(): HourBuckets {
  return { upload: new Array(24).fill(0), download: new Array(24).fill(0) };
}

/**
 * 空的一天。
 * @param now Unix 毫秒。
 */
export function emptyDay(now: number): DayStats {
  return { day: localDay(now), all: emptyBuckets(), proxy: emptyBuckets(), processes: {}, domains: {}, policies: {}, updatedAt: now };
}

/**
 * 从存储读回来的那一份：形状不对、不是今天的，一律换成空的一天。
 * @param raw 存储里的值。
 * @param now Unix 毫秒。
 * @returns 今天的统计。
 */
export function restoreDay(raw: unknown, now: number): DayStats {
  if (typeof raw !== "object" || raw === null) return emptyDay(now);
  const value = raw as Partial<DayStats>;
  if (value.day !== localDay(now)) return emptyDay(now);
  const buckets = (input: unknown): HourBuckets => {
    const source = (typeof input === "object" && input !== null ? input : {}) as Partial<HourBuckets>;
    const column = (list: unknown) => Array.from({ length: 24 }, (_, hour) => {
      const number = Array.isArray(list) ? list[hour] : 0;
      return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : 0;
    });
    return { upload: column(source.upload), download: column(source.download) };
  };
  const usages = (input: unknown): Record<string, Usage> => {
    const out: Record<string, Usage> = {};
    if (typeof input !== "object" || input === null) return out;
    for (const [key, usage] of Object.entries(input as Record<string, unknown>)) {
      if (typeof usage !== "object" || usage === null) continue;
      const item = usage as Partial<Usage>;
      const number = (field: unknown) => (typeof field === "number" && Number.isFinite(field) && field > 0 ? field : 0);
      out[key] = { upload: number(item.upload), download: number(item.download), connections: number(item.connections) };
    }
    return out;
  };
  return {
    day: value.day,
    all: buckets(value.all),
    proxy: buckets(value.proxy),
    processes: usages(value.processes),
    domains: usages(value.domains),
    policies: usages(value.policies),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : now,
  };
}

/**
 * 一条连接的进程名：路径的最后一段；sing-box 没查到进程时为「未知进程」。
 * @param connection 连接。
 */
export function processName(connection: Pick<ConnectionInfo, "process">): string {
  const name = connection.process.split("/").pop() ?? "";
  return name.length > 0 ? name : "未知进程";
}

/**
 * 一条连接的域名（去掉端口；IPv6 去掉方括号）。
 * @param connection 连接。
 */
export function domainOf(connection: Pick<ConnectionInfo, "host">): string {
  const host = connection.host;
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]") > 0 ? host.indexOf("]") : undefined);
  const colon = host.lastIndexOf(":");
  const bare = colon > 0 && host.indexOf(":") === colon ? host.slice(0, colon) : host;
  return bare.length > 0 ? bare : "（没有主机名）";
}

/**
 * 一条连接命中的策略：出站链的最后一项——路由规则直接指向的那个出站（「节点选择」、导入的策略组、直连）。
 * sing-box 给的顺序是最终出站在前（`["JMS-c95s2", "节点选择"]`），所以取最后一项（实测 1.14.4）。
 * @param connection 连接。
 */
export function connectionPolicy(connection: Pick<ConnectionInfo, "chains">): string {
  return connection.chains[connection.chains.length - 1] ?? DIRECT_TAG;
}

/**
 * 这条连接算不算「经过代理」：最终出站不是直连（被拒绝的连接没有字节，不必另判）。
 * @param connection 连接。
 */
export function isProxied(connection: Pick<ConnectionInfo, "chains">): boolean {
  const final = connection.chains[0];
  return final !== undefined && final !== DIRECT_TAG;
}

/** 把一份用量加进一类，必要时淘汰合计最小的。 */
function add(target: Record<string, Usage>, key: string, upload: number, download: number, isNew: boolean): void {
  const usage = target[key] ?? { upload: 0, download: 0, connections: 0 };
  usage.upload += upload;
  usage.download += download;
  if (isNew) usage.connections += 1;
  target[key] = usage;
}

/**
 * 每类至多 `limit` 个键：按合计（上 + 下）从大到小留前 `limit` 个。
 * @param usages 一类。
 * @param limit 上限。
 * @returns 截好的一类（新对象）。
 */
export function trimUsages(usages: Record<string, Usage>, limit: number = maximumKeys): Record<string, Usage> {
  const entries = Object.entries(usages);
  if (entries.length <= limit) return usages;
  entries.sort((a, b) => b[1].upload + b[1].download - (a[1].upload + a[1].download) || a[0].localeCompare(b[0]));
  return Object.fromEntries(entries.slice(0, limit));
}

/**
 * 记一份快照。换天时先清零（`seen` 留着：跨过 0 点的连接只把 0 点之后的增量记进新的一天）。
 * @param state 上一次的状态（不改它）。
 * @param snapshot 这一份快照。
 * @param now Unix 毫秒。
 * @returns 新的状态。
 */
export function ingest(state: StatsState, snapshot: ConnectionsSnapshot, now: number): StatsState {
  const day = localDay(now);
  const base = state.stats.day === day ? state.stats : emptyDay(now);
  const stats: DayStats = {
    day,
    all: { upload: [...base.all.upload], download: [...base.all.download] },
    proxy: { upload: [...base.proxy.upload], download: [...base.proxy.download] },
    processes: { ...base.processes },
    domains: { ...base.domains },
    policies: { ...base.policies },
    updatedAt: now,
  };
  for (const category of ["processes", "domains", "policies"] as const) {
    stats[category] = Object.fromEntries(Object.entries(stats[category]).map(([key, usage]) => [key, { ...usage }]));
  }
  const hour = new Date(now).getHours();
  const seen = new Map<string, { upload: number; download: number }>();
  for (const connection of snapshot.connections) {
    if (!connection.id) continue;
    const previous = state.seen.get(connection.id);
    // 累计变小（不该发生）当作从 0 起：宁可少记，不记负数。
    const upload = Math.max(0, connection.upload - (previous && connection.upload >= previous.upload ? previous.upload : 0));
    const download = Math.max(0, connection.download - (previous && connection.download >= previous.download ? previous.download : 0));
    seen.set(connection.id, { upload: connection.upload, download: connection.download });
    const isNew = previous === undefined;
    if (upload === 0 && download === 0 && !isNew) continue;
    stats.all.upload[hour] += upload;
    stats.all.download[hour] += download;
    if (isProxied(connection)) {
      stats.proxy.upload[hour] += upload;
      stats.proxy.download[hour] += download;
    }
    add(stats.processes, processName(connection), upload, download, isNew);
    add(stats.domains, domainOf(connection), upload, download, isNew);
    add(stats.policies, connectionPolicy(connection), upload, download, isNew);
  }
  stats.processes = trimUsages(stats.processes);
  stats.domains = trimUsages(stats.domains);
  stats.policies = trimUsages(stats.policies);
  return { stats, seen };
}

/**
 * 一类的 Top N（按合计从大到小）。
 * @param stats 今天的统计。
 * @param category 哪一类。
 * @param limit 几个。
 * @returns `[名字, 用量]`。
 */
export function topUsages(stats: DayStats, category: UsageCategory, limit = 10): [string, Usage][] {
  return Object.entries(stats[category])
    .sort((a, b) => b[1].upload + b[1].download - (a[1].upload + a[1].download) || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

/** 一条连接此刻的速率（两份快照之间的差 ÷ 时间）。 */
export interface ProcessRate {
  name: string;
  connections: number;
  /** 字节 / 秒。 */
  upload: number;
  download: number;
}

/**
 * 每个程序此刻的速率（「进程」页）：两份相邻快照按连接 id 求差、按进程名合在一起。
 * 第一次见到的连接没有「上一份」，这一拍不算它的速率（不然一条刚建的大连接会顶到第一，下一拍又掉下来）。
 * @param previous 上一份快照；没有为 `null`。
 * @param current 这一份。
 * @param seconds 两份之间隔了几秒（> 0）。
 * @returns 按（下行 + 上行）速率从大到小；连接数照算全部连接。
 */
export function processRates(previous: ConnectionsSnapshot | null, current: ConnectionsSnapshot, seconds: number): ProcessRate[] {
  const before = new Map((previous?.connections ?? []).map((connection) => [connection.id, connection]));
  const rows = new Map<string, ProcessRate>();
  const span = seconds > 0 ? seconds : 1;
  for (const connection of current.connections) {
    const name = processName(connection);
    const row = rows.get(name) ?? { name, connections: 0, upload: 0, download: 0 };
    row.connections += 1;
    const last = before.get(connection.id);
    if (last) {
      row.upload += Math.max(0, connection.upload - last.upload) / span;
      row.download += Math.max(0, connection.download - last.download) / span;
    }
    rows.set(name, row);
  }
  return [...rows.values()].sort((a, b) => b.upload + b.download - (a.upload + a.download) || b.connections - a.connections || a.name.localeCompare(b.name));
}
