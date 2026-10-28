/**
 * 窗口「规则」页那张表（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）：
 * ID、类型、目标、策略、使用计数、注释。纯函数，不碰宿主。
 *
 * 行来自交给 sing-box 的那份路由（{@link routePlan}，与 `buildConfig` 同一份真源）；使用计数来自 Clash API 每条连接的 `rule` 字段。
 * 实测 sing-box 1.14.4 的写法（`route/rule` 各 item 的 `String()`）：
 *
 * - `domain=example.org domain_suffix=[example.com iana.org] => route(节点选择)`——一个值不带方括号，几个值方括号里空格分隔；
 * - 条件的先后是 sing-box 内部的顺序，不是配置里写的顺序（`domain_suffix=[localhost local] ip_is_private=true => route(direct)`）；
 * - 逻辑规则：子规则之间 ` && ` / ` || `（`domain_suffix=example.net && network=tcp => route(direct)`）；
 * - 没命中任何规则：`final`；`rulePayload` 恒为空串。
 *
 * 所以按「动作 + 条件的键集合 + 每个键的值」认回是哪一条：值对不上（进程名里有空格，方括号里分不清）时退到「动作 + 键集合」的第一条。
 */
import { DIRECT_TAG, SELECTOR_TAG } from "./nodes.js";
import type { RoutePlan, RuleOrigin } from "./singbox-config.js";

/** 表里的一行。 */
export interface RuleRow {
  /** 1 起，与交给 sing-box 的先后一致（不数嗅探、解析这类不分流的规则）。 */
  id: number;
  type: string;
  target: string;
  policy: string;
  hits: number;
  note: string;
}

/** 一条规则（或一个 `rule` 字段）认得出来的样子。 */
interface Signature {
  action: string;
  keys: string[];
  values: Map<string, string[]>;
}

/** 不是匹配条件的字段。 */
const nonConditionKeys = new Set(["action", "outbound", "method", "no_drop", "invert", "type", "mode", "rules", "override_address", "override_port", "network_strategy", "fallback_delay", "udp_disable_domain_unmapping", "udp_connect", "udp_timeout", "tls_fragment", "tls_record_fragment"]);

/**
 * 一条生成的路由规则 → 认得出来的样子。
 * @param rule 路由规则。
 * @returns 样子；嗅探 / 解析 / DNS 劫持这类不分流的为 `null`。
 */
function signatureOf(rule: Record<string, unknown>): Signature | null {
  const action = actionOf(rule);
  if (!action) return null;
  const values = new Map<string, string[]>();
  const collect = (source: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(source)) {
      if (nonConditionKeys.has(key)) continue;
      const list = (Array.isArray(value) ? value : [value]).map((item) => String(item));
      values.set(key, [...(values.get(key) ?? []), ...list]);
    }
  };
  if (rule.type === "logical" && Array.isArray(rule.rules)) {
    for (const sub of rule.rules) if (typeof sub === "object" && sub !== null) collect(sub as Record<string, unknown>);
  } else {
    collect(rule);
  }
  return { action, keys: [...values.keys()].sort(), values };
}

/** 规则的动作在 `rule` 字段里的写法：`route(<出站>)` / `reject`；不分流的为 `null`。 */
function actionOf(rule: Record<string, unknown>): string | null {
  if (rule.action === "route" && typeof rule.outbound === "string") return `route(${rule.outbound})`;
  if (rule.action === "reject") return "reject";
  return null;
}

/**
 * 读一个 `rule` 字段。
 * @param text 字段原文。
 * @returns 样子；`final` 或读不出为 `null`。
 */
export function parseRuleText(text: string): Signature | null {
  const arrow = text.lastIndexOf(" => ");
  if (arrow < 0) return null;
  const rawAction = text.slice(arrow + 4).trim();
  const action = rawAction.startsWith("reject") ? "reject" : rawAction;
  const values = new Map<string, string[]>();
  const pattern = /([a-z_]+)=(\[[^\]]*\]|\S+)/g;
  const conditions = text.slice(0, arrow);
  for (let match = pattern.exec(conditions); match; match = pattern.exec(conditions)) {
    const raw = match[2];
    const list = raw.startsWith("[") ? raw.slice(1, -1).split(" ").filter((item) => item.length > 0) : [raw];
    values.set(match[1], [...(values.get(match[1]) ?? []), ...list]);
  }
  return { action, keys: [...values.keys()].sort(), values };
}

/** 两份值（无序）是否相同。 */
function sameValues(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left || !right || left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

/**
 * 一个 `rule` 字段是路由里的第几条。
 * @param plan 路由。
 * @param text `rule` 字段。
 * @returns 规则下标（`plan.rules` 里的）；`"final"` = 兜底；认不出为 `null`。
 */
export function matchRule(plan: RoutePlan, text: string): number | "final" | null {
  if (text === "final") return "final";
  const wanted = parseRuleText(text);
  if (!wanted) return null;
  let fallback: number | null = null;
  for (const [index, rule] of plan.rules.entries()) {
    const signature = signatureOf(rule);
    if (!signature || signature.action !== wanted.action) continue;
    if (signature.keys.length !== wanted.keys.length || signature.keys.some((key, position) => key !== wanted.keys[position])) continue;
    if (signature.keys.every((key) => sameValues(signature.values.get(key), wanted.values.get(key)))) return index;
    if (fallback === null) fallback = index;
  }
  return fallback;
}

/** 条件键在表里的写法（Surge 那一套名字，用户从 Surge 搬过来认得）。 */
const typeTitles: Readonly<Record<string, string>> = {
  domain: "DOMAIN",
  domain_suffix: "DOMAIN-SUFFIX",
  domain_keyword: "DOMAIN-KEYWORD",
  domain_regex: "DOMAIN-REGEX",
  ip_cidr: "IP-CIDR",
  source_ip_cidr: "SRC-IP",
  ip_is_private: "LAN",
  rule_set: "RULE-SET",
  process_name: "PROCESS-NAME",
  process_path: "PROCESS-PATH",
  clash_mode: "MODE",
  port: "DEST-PORT",
  port_range: "DEST-PORT",
  source_port: "SRC-PORT",
  network: "NETWORK",
  protocol: "PROTOCOL",
};

/**
 * 出站 tag 在「策略」一列的写法。
 * @param action `route(<tag>)` / `reject`。
 */
export function policyColumn(action: string): string {
  if (action === "reject") return "拒绝";
  const tag = action.slice("route(".length, -1);
  if (tag === DIRECT_TAG) return "直连";
  return tag;
}

/** 注释一列。 */
function noteOf(origin: RuleOrigin): string {
  switch (origin.kind) {
    case "lan":
      return "局域网与本机一律直连";
    case "mode":
      return origin.mode === "direct" ? "出站模式「直连」时全部直连" : "出站模式「全局」时全部走节点选择";
    case "page":
      return "页面规则";
    case "surge":
      return `Surge 导入 · 第 ${origin.index} 条`;
    case "surgeFinal":
      return "Surge 的 FINAL";
    case "china":
      return "内置：中国大陆直连";
    default:
      return "";
  }
}

/**
 * 目标一列：值逗号分隔，多于 3 个写「等 N 项」。
 * @param values 值。
 * @param titles 规则集 tag → 好认的名字（导入配置里外部规则集的文件名）。
 */
function targetOf(values: Map<string, string[]>, titles: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  for (const [key, list] of values) {
    if (key === "ip_is_private") continue;
    const shown = list.map((value) => (key === "rule_set" ? (titles.get(value) ?? value) : value));
    parts.push(...shown);
  }
  if (parts.length === 0) return "—";
  const head = parts.slice(0, 3).join(", ");
  const text = parts.length > 3 ? `${head} 等 ${parts.length} 项` : head;
  return text.length > 200 ? text.slice(0, 200) : text;
}

/**
 * 表里的全部行：分流规则按先后编号，最后一行是兜底。
 * @param plan 路由。
 * @param hits `rule` 字段 → 本次开启以来的连接数。
 * @param titles 规则集 tag → 好认的名字。
 * @returns 行。
 */
export function ruleRows(plan: RoutePlan, hits: Readonly<Record<string, number>>, titles: ReadonlyMap<string, string> = new Map()): RuleRow[] {
  const counts = new Map<number | "final", number>();
  for (const [text, count] of Object.entries(hits)) {
    const index = matchRule(plan, text);
    if (index === null) continue;
    counts.set(index, (counts.get(index) ?? 0) + count);
  }
  const rows: RuleRow[] = [];
  for (const [index, rule] of plan.rules.entries()) {
    const origin = plan.origins[index] ?? { kind: "plumbing" };
    const signature = signatureOf(rule);
    if (!signature || origin.kind === "plumbing") continue;
    const type =
      rule.type === "logical"
        ? String(rule.mode ?? "and").toUpperCase()
        : signature.keys.length === 0
          ? "FINAL"
          : [...new Set(signature.keys.filter((key) => !(origin.kind === "lan" && key === "domain_suffix")).map((key) => typeTitles[key] ?? key.toUpperCase()))].join(" + ");
    rows.push({ id: rows.length + 1, type, target: targetOf(signature.values, titles), policy: policyColumn(signature.action), hits: counts.get(index) ?? 0, note: noteOf(origin) });
  }
  rows.push({
    id: rows.length + 1,
    type: "FINAL",
    target: "—",
    policy: policyColumn(`route(${plan.final})`),
    hits: counts.get("final") ?? 0,
    note: plan.finalFromSurge ? "Surge 的 FINAL：没命中任何规则的连接" : `兜底：没命中任何规则的连接走${plan.final === SELECTOR_TAG ? "「节点选择」" : `「${plan.final}」`}`,
  });
  return rows;
}

/** 本次开启以来每个 `rule` 字段的连接数（存储 `ruleHits`）。 */
export interface RuleHits {
  /** 这一份内核的 `ControlRecord.startedAt`：换了一份就从 0 记。 */
  startedAt: number;
  counts: Record<string, number>;
}

/** 至多记多少种 `rule` 字段：一份配置几百条规则，再多是规则集里的条目被展开了，按次数淘汰最少的。 */
export const maximumRuleHitKeys = 400;

/**
 * 记一份快照里新出现的连接（同一条连接只记一次）。
 * @param hits 上一份；`null` 或不是这一份内核的从 0 起。
 * @param startedAt 此刻在跑的那一份的 `startedAt`。
 * @param connections 快照里的连接（id 与 `rule`）。
 * @param seen 已经记过的连接 id（调用方留着，跨快照用；这里会往里加、并删掉已经不在快照里的）。
 * @returns 新的一份。
 */
export function countRuleHits(
  hits: RuleHits | null,
  startedAt: number,
  connections: readonly { id: string; rule: string }[],
  seen: Set<string>,
): RuleHits {
  const counts = hits && hits.startedAt === startedAt ? { ...hits.counts } : {};
  const present = new Set<string>();
  for (const connection of connections) {
    if (!connection.id) continue;
    present.add(connection.id);
    if (seen.has(connection.id) || !connection.rule) continue;
    seen.add(connection.id);
    counts[connection.rule] = (counts[connection.rule] ?? 0) + 1;
  }
  for (const id of [...seen]) if (!present.has(id)) seen.delete(id);
  const entries = Object.entries(counts);
  if (entries.length <= maximumRuleHitKeys) return { startedAt, counts };
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { startedAt, counts: Object.fromEntries(entries.slice(0, maximumRuleHitKeys)) };
}
