/**
 * 存储的形状：哪几个键、每个键里放什么、节点怎么切块（纯函数，读写在 `core.ts`）。
 *
 * 为什么要存：前台页面与后台会话是两个 JSContext（P-7），内存不共享；宿主只替我们记着常驻进程与系统代理的状态，
 * 订阅解析出的节点、选中的节点与模式、测出的延迟、控制口的 secret 要两边都看得见，只能放 `jarvis.storage`。
 *
 * 三条约束决定了布局：
 *
 * 1. **单个键 ≤ 64 KB**：一份几百个节点的订阅会超，所以节点按订阅、按大小切块（`nodes:<订阅 id>:<序号>`）；
 * 2. **两个会话会同时写**：键按「谁写」分开（选择、延迟、控制口、失败、日程各一个键），一个会话写自己的那一项不会冲掉另一个会话写的另一项；
 * 3. **订阅地址是密码**（`urlList` 进钥匙串）：存储里不放地址本身，只放它的散列（认出「还是那一条」）与主机名（给人看是哪一家）。
 */
import type { ProxyNode } from "./nodes.js";
import type { KernelKind } from "./singbox-config.js";
import type { SkippedLine, SubscriptionFormat } from "./subscription.js";
import type { HeadlessRule, SurgeImport, SurgeRuleSetRef } from "./surge.js";

/** 存储里的键。 */
export const storageKeys = {
  /** `SubscriptionRecord[]`，按偏好里地址的顺序。 */
  subscriptions: "subscriptions",
  /** `Selection`：出站模式与「节点选择」选中的组员。 */
  selection: "selection",
  /** `LatencyRecord`：每个节点最近一次测速。 */
  latency: "latency",
  /** `ControlRecord`：此刻在跑的那一份内核的控制口与它用的设置。 */
  control: "control",
  /** `FailureRecord`：最近一次起不来 / 意外退出；成功开启或用户关掉时清掉。 */
  failure: "failure",
  /** `Schedule`：订阅自动更新的日程。 */
  schedule: "schedule",
  /** `PageRule[]`：用户给网站加的规则，新的在前（SDK 2.10 这一期，T-8）。 */
  pageRules: "pageRules",
  /** `StoredSurge`：导入的 Surge 配置，规则另外切块（`surge:rules:<序号>`）。 */
  surge: "surge",
  /** `Record<tag, RuleSetRecord>`：导入配置里那些外部规则集拉没拉到，内容另外切块（`ruleset:<tag>:<序号>`）。 */
  ruleSets: "ruleSets",
  /**
   * `TunSwitch`：自己刚把偏好 `tun` 改成了什么（jarvis-mac `specs/20261028-130540-proxy-walkthrough-fixes` W-6）。
   * 宿主把每次偏好变更都通知给所有会话、包括写的那一个；后台会话看到 30 秒内、值相同的这一笔，就知道是自己人在换内核，不再换一次。
   */
  tunSwitch: "tunSwitch",
  /**
   * `DayStats`：今天的流量（分时桶、按进程 / 域名 / 策略的合计），后台会话每分钟写一次（jarvis-mac
   * `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）。窗口「活动」页读它。
   */
  statsToday: "stats.today",
  /** `RuleHits`：本次开启以来每个 `rule` 字段的连接数（窗口「规则」页的使用计数），与 `stats.today` 一起写。 */
  ruleHits: "ruleHits",
} as const;

/** 自己刚写的那一次增强模式开关（`storageKeys.tunSwitch`）。 */
export interface TunSwitch {
  on: boolean;
  at: number;
}

/** 自己写的那一笔多久之内算「回声」。 */
export const tunSwitchEchoMs = 30_000;

/**
 * 一次 `tun` 偏好变更是不是自己刚写的那一次的回声。
 * @param marker 存储里的那一笔。
 * @param on 变更后的值。
 * @param now 现在。
 * @returns 是回声为 `true`（不要再换内核）。
 */
export function isTunSwitchEcho(marker: unknown, on: boolean, now: number): boolean {
  if (typeof marker !== "object" || marker === null) return false;
  const value = marker as Partial<TunSwitch>;
  return value.on === on && typeof value.at === "number" && now - value.at >= 0 && now - value.at < tunSwitchEchoMs;
}

/**
 * 导入的 Surge 规则的一块。
 * @param index 第几块。
 * @returns 键。
 */
export function surgeRuleChunkKey(index: number): string {
  return `surge:rules:${index}`;
}

/**
 * 一个外部规则集内容的一块。
 * @param tag 规则集 tag。
 * @param index 第几块。
 * @returns 键。
 */
export function ruleSetChunkKey(tag: string, index: number): string {
  return `ruleset:${tag}:${index}`;
}

/** 存储里的导入结果：规则不在这里（切块存），只留块数。 */
export type StoredSurge = Omit<SurgeImport, "rules"> & { ruleChunks: number };

/** 一个外部规则集此刻的样子。 */
export interface RuleSetRecord extends SurgeRuleSetRef {
  /** 最近一次拉到的时刻；从没拉到为 `null`。 */
  fetchedAt: number | null;
  attemptedAt: number | null;
  /** 最近一次没拉到的原因；拉到了为 `null`。没拉到时内容仍是上一次拉到的那一份。 */
  error: string | null;
  /** 认出了几条、跳过几条。 */
  total: number;
  skipped: number;
  /** 里面有 IP 类规则。 */
  hasIP: boolean;
  chunks: number;
}

/**
 * 把一组任意东西切成每块不超过 `maxBytes`（按 JSON 的 UTF-8 字节数）的几块。一项自己就超过上限时单独成块（不丢）。
 * @param items 东西。
 * @param maxBytes 每块上限。
 * @returns 块。
 */
export function chunkItems<T>(items: readonly T[], maxBytes: number = maximumChunkBytes): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 2;
  for (const item of items) {
    const bytes = utf8Length(JSON.stringify(item)) + 1;
    if (current.length > 0 && size + bytes > maxBytes) {
      chunks.push(current);
      current = [];
      size = 2;
    }
    current.push(item);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * 把规则集里过大的一条拆成几条（每条只带一部分值）：规则集里各条之间是「或」，一条 `domain_suffix: [几千个]` 拆成几条，命中结果不变；
 * 拆完每条都放得进一块。只拆数组字段，几种字段一起的那条按字段各拆各的。
 * @param rules 规则。
 * @param maxBytes 每条上限。
 * @returns 新规则。
 */
export function splitHeadlessRules(rules: readonly HeadlessRule[], maxBytes: number = maximumChunkBytes - 1024): HeadlessRule[] {
  const out: HeadlessRule[] = [];
  for (const rule of rules) {
    if (utf8Length(JSON.stringify(rule)) <= maxBytes) {
      out.push(rule);
      continue;
    }
    const scalars: HeadlessRule = {};
    const arrays: [string, unknown[]][] = [];
    for (const [key, value] of Object.entries(rule)) {
      if (Array.isArray(value)) arrays.push([key, value]);
      else scalars[key] = value;
    }
    // 只有一种字段，或几种都是目标类（「或」）：各自切开；混着别的字段（「与」）的不拆，原样单独成块。
    const destination = new Set(["domain", "domain_suffix", "domain_keyword", "domain_regex", "ip_cidr"]);
    if (arrays.length > 1 && !arrays.every(([key]) => destination.has(key))) {
      out.push(rule);
      continue;
    }
    for (const [key, values] of arrays) {
      for (const part of chunkItems(values, maxBytes)) out.push({ ...scalars, [key]: part });
    }
  }
  return out;
}

/**
 * 一块节点的键。
 * @param subscriptionId 订阅 id。
 * @param index 第几块（0 起）。
 * @returns 键。
 */
export function nodeChunkKey(subscriptionId: string, index: number): string {
  return `nodes:${subscriptionId}:${index}`;
}

/**
 * 一块的字节上限。宿主的上限是 64 KB；留出四分之一给存储那一侧的转义与包装，不贴着上限走。
 */
export const maximumChunkBytes = 48 * 1024;

/**
 * UTF-8 字节数。中文节点名一个字 3 字节，按码元数估会少算三分之二。
 * @param text 文字。
 * @returns 字节数。
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * 把节点切成每块不超过 `maxBytes`（按 JSON 的 UTF-8 字节数）的几块。一个节点自己就超过上限时单独成块（不丢）。
 * @param nodes 节点。
 * @param maxBytes 每块上限。
 * @returns 块；没有节点时为空数组。
 */
export function chunkNodes(nodes: readonly ProxyNode[], maxBytes: number = maximumChunkBytes): ProxyNode[][] {
  const chunks: ProxyNode[][] = [];
  let current: ProxyNode[] = [];
  let size = 2;
  for (const node of nodes) {
    const bytes = utf8Length(JSON.stringify(node)) + 1;
    if (current.length > 0 && size + bytes > maxBytes) {
      chunks.push(current);
      current = [];
      size = 2;
    }
    current.push(node);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** 订阅响应头 `Subscription-Userinfo` 里的用量（字节、Unix 秒）。 */
export interface SubscriptionUsage {
  upload: number;
  download: number;
  total: number;
  /** 到期时刻，Unix 毫秒；没写为 `null`。 */
  expire: number | null;
}

/**
 * 按名字（不分大小写）取一个响应头。
 * @param headers 响应头。
 * @param name 名字。
 * @returns 值；没有为 `undefined`。
 */
export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lowered = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === lowered) return headers[key];
  return undefined;
}

/**
 * 解析 `Subscription-Userinfo: upload=1; download=2; total=3; expire=1700000000`（机场面板的通行写法，时刻是 Unix 秒）。
 * @param value 头的值。
 * @returns 用量；没有这个头或一个数都读不出为 `null`。
 */
export function parseSubscriptionUserinfo(value: string | undefined): SubscriptionUsage | null {
  if (!value) return null;
  const fields: Record<string, number> = {};
  for (const part of value.split(";")) {
    const match = /^\s*([a-z]+)\s*=\s*(\d+(?:\.\d+)?)\s*$/i.exec(part);
    if (match) fields[match[1].toLowerCase()] = Number(match[2]);
  }
  if (fields.upload === undefined && fields.download === undefined && fields.total === undefined) return null;
  return {
    upload: fields.upload ?? 0,
    download: fields.download ?? 0,
    total: fields.total ?? 0,
    expire: fields.expire ? fields.expire * 1000 : null,
  };
}

/** 一条订阅在存储里的记录。 */
export interface SubscriptionRecord {
  /** 地址的散列（{@link subscriptionId}）：认出「还是那一条」，又不把带 token 的地址写进存储。 */
  id: string;
  /** 主机名，给人看是哪一家。 */
  host: string;
  /** 在偏好里是第几条（1 起）。 */
  position: number;
  /** 最近一次成功时认出的外形；从没成功过为 `null`。 */
  format: SubscriptionFormat | null;
  /** 最近一次成功时认出的节点数。 */
  nodeCount: number;
  /** 节点存了几块。 */
  chunks: number;
  /** 认不出的行（至多 {@link maximumSkippedPerSubscription} 条）。 */
  skipped: SkippedLine[];
  /** 认不出的行一共几条。 */
  skippedTotal: number;
  /** 最近一次成功的时刻（Unix 毫秒）；从没成功过为 `null`。 */
  fetchedAt: number | null;
  /** 最近一次尝试的时刻。 */
  attemptedAt: number;
  /** 最近一次尝试失败的原因；成功为 `null`。失败时节点仍是上一次成功的那一份。 */
  error: string | null;
  usage: SubscriptionUsage | null;
}

/** 每条订阅留几条认不出的行：足够看出是哪一类问题，又不让一份几百行乱码的订阅把这个键撑过 64 KB。 */
export const maximumSkippedPerSubscription = 30;

/**
 * FNV-1a 32 位。
 * @param text 文字。
 * @param seed 初值。
 * @returns 32 位无符号整数。
 */
function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 一段文字的 16 位十六进制摘要（两个不同初值的 FNV-1a 拼起来）。不是密码学散列：用来认「是不是同一条」「节点变没变」，
 * 不用来保密——地址里的 token 不会因为它而更难猜，但它也不会出现在存储里。
 * @param text 文字。
 * @returns 16 位十六进制。
 */
export function digest(text: string): string {
  const hex = (value: number): string => `00000000${value.toString(16)}`.slice(-8);
  return hex(fnv1a(text, 0x811c9dc5)) + hex(fnv1a(text, 0x01234567));
}

/**
 * 一条订阅地址的 id。
 * @param url 地址。
 * @returns id。
 */
export function subscriptionId(url: string): string {
  return digest(url.trim());
}

/**
 * 一条地址的主机名（给人看）。
 * @param url 地址。
 * @returns 主机名；读不出时为「订阅」。
 */
export function subscriptionHost(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url.trim());
  return match ? match[1].toLowerCase() : "订阅";
}

/**
 * 一组节点的摘要：内核跑着的那一份与存储里最新的那一份不同，就要重启才能用上新节点。
 * @param nodes 节点。
 * @returns 摘要。
 */
export function nodesDigest(nodes: readonly ProxyNode[]): string {
  return digest(JSON.stringify(nodes));
}

/** 订阅自动更新：不自动 / 每 6 小时 / 每天。 */
export type UpdateInterval = "never" | "6h" | "daily";

/** 偏好里的三种写法。 */
export const updateIntervals: readonly UpdateInterval[] = ["never", "6h", "daily"];

/**
 * @param interval 偏好。
 * @returns 间隔毫秒；不自动为 `null`。
 */
export function updateIntervalMs(interval: UpdateInterval): number | null {
  switch (interval) {
    case "6h":
      return 6 * 60 * 60 * 1000;
    case "daily":
      return 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/** 订阅自动更新的日程。 */
export interface Schedule {
  /** 最近一次（自动或手动）更新的时刻。 */
  lastAttemptAt: number | null;
  /** 最近一次至少有一条订阅成功的时刻。 */
  lastSuccessAt: number | null;
}

/**
 * 失败后多久再试。30 分钟：机场偶尔抽风，几分钟一次地重试只是在用户的网络里制造噪音；
 * 等满一整个周期（6 小时 / 一天）又太久。
 */
export const retryAfterFailureMs = 30 * 60 * 1000;

/**
 * 现在该不该自动更新。
 * @param schedule 日程。
 * @param interval 偏好。
 * @param now 现在（Unix 毫秒）。
 * @returns 该不该。
 */
export function isUpdateDue(schedule: Schedule, interval: UpdateInterval, now: number): boolean {
  const period = updateIntervalMs(interval);
  if (period === null) return false;
  if (schedule.lastAttemptAt !== null && now - schedule.lastAttemptAt < Math.min(period, retryAfterFailureMs)) return false;
  return schedule.lastSuccessAt === null || now - schedule.lastSuccessAt >= period;
}

/** 一次拉取的结果。 */
export type FetchOutcome =
  | { ok: true; format: SubscriptionFormat; nodes: ProxyNode[]; skipped: SkippedLine[]; usage: SubscriptionUsage | null }
  /** 失败：连不上、HTTP 错误、或一条节点都没认出来（`skipped` 是认不出的那些行，给「订阅」那一页看）。 */
  | { ok: false; error: string; skipped?: SkippedLine[] };

/**
 * 拉完一条订阅之后它的记录。失败时节点、外形、用量都留上一次成功的那一份，只记下这一次的原因——
 * 机场一时连不上，不该让用户手里的节点跟着清空。
 * @param previous 上一次的记录（没有为 `undefined`）。
 * @param url 地址。
 * @param position 在偏好里是第几条（1 起）。
 * @param outcome 这一次的结果。
 * @param chunks 这一次成功时节点存了几块（失败时不看）。
 * @param now 现在。
 * @returns 新记录。
 */
export function nextRecord(
  previous: SubscriptionRecord | undefined,
  url: string,
  position: number,
  outcome: FetchOutcome,
  chunks: number,
  now: number,
): SubscriptionRecord {
  const base: SubscriptionRecord = previous
    ? { ...previous, position, host: subscriptionHost(url) }
    : {
        id: subscriptionId(url),
        host: subscriptionHost(url),
        position,
        format: null,
        nodeCount: 0,
        chunks: 0,
        skipped: [],
        skippedTotal: 0,
        fetchedAt: null,
        attemptedAt: now,
        error: null,
        usage: null,
      };
  if (!outcome.ok) {
    const failed = { ...base, attemptedAt: now, error: outcome.error };
    if (!outcome.skipped) return failed;
    return { ...failed, skipped: outcome.skipped.slice(0, maximumSkippedPerSubscription), skippedTotal: outcome.skipped.length };
  }
  return {
    ...base,
    format: outcome.format,
    nodeCount: outcome.nodes.length,
    chunks,
    skipped: outcome.skipped.slice(0, maximumSkippedPerSubscription),
    skippedTotal: outcome.skipped.length,
    fetchedAt: now,
    attemptedAt: now,
    error: null,
    usage: outcome.usage,
  };
}

/**
 * 「3 分钟前」这一类说法。
 * @param at 时刻（Unix 毫秒）。
 * @param now 现在。
 * @returns 说法。
 */
export function formatAge(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/**
 * 用量的一句话：「已用 12 GB / 500 GB · 2027-01-01 到期」。
 * @param usage 用量。
 * @returns 一句话。
 */
export function describeUsage(usage: SubscriptionUsage): string {
  const gigabytes = (bytes: number): string => {
    const value = bytes / 1024 ** 3;
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} GB`;
  };
  const parts = [`已用 ${gigabytes(usage.upload + usage.download)}${usage.total > 0 ? ` / ${gigabytes(usage.total)}` : ""}`];
  if (usage.expire !== null) {
    const date = new Date(usage.expire);
    const pad = (value: number): string => `0${value}`.slice(-2);
    parts.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 到期`);
  }
  return parts.join(" · ");
}

/** 此刻在跑的那一份内核用的东西（存储 `control`）。 */
export interface ControlRecord {
  /** 跑在哪：用户态常驻进程（系统代理模式）或网络助手里的 root 内核（TUN）。旧记录没有这一项 = `daemon`。 */
  kernel?: KernelKind;
  secret: string;
  controlPort: number;
  mixedPort: number;
  /** 这一份配置里有没有中国大陆分流规则。 */
  chinaRules: boolean;
  /** 偏好要分流，但规则集下载失败、这一次没分流。 */
  ruleSetFallback: boolean;
  testURL: string;
  /** 起这一份时的节点摘要：与存储里最新的不同 = 订阅更新过，重新载入才用得上。 */
  nodesDigest: string;
  /** 起（或重新载入）这一份时的规则摘要：页面规则、导入的配置、外部规则集、DNS 模式。与此刻的不同 = 重新载入才用得上。 */
  rulesDigest?: string;
  startedAt: number;
  /** 还在等它就绪：这期间的退出由正在开启的那个会话自己报，后台不另发横幅。 */
  starting: boolean;
}

/** 最近一次测速（存储 `latency`）。 */
export interface LatencyRecord {
  /** 节点名 → 毫秒；`null` = 超时 / 连不上。 */
  values: Record<string, number | null>;
  testedAt: number | null;
}
