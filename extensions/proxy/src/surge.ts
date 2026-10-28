/**
 * 导入 Surge 配置（jarvis-mac `specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-9）：把一份 Surge 的 `.conf` 读成
 * 「代理」能用的东西——规则、策略组、TUN 相关的几项 `[General]`、`[Host]`——转不了的逐类记进报告（纯函数，不碰宿主）。
 *
 * 转出来的规则直接写成 sing-box 路由规则的匹配字段（`domain_suffix`、`ip_cidr`……），与节点一样：中间层每多一个字段就多一处对不上的机会。
 * 策略写成 {@link Policy}：直连、拒绝，或者一个策略组的名字（Surge 里的 `Proxies`、`Apple`、`Telegram`……在 sing-box 里各是一个 selector）。
 *
 * 几处语义照 Surge 的说明书来，而不是照字面翻：
 *
 * - **IP 规则会触发解析**：Surge 走到第一条不带 `no-resolve` 的 IP 类规则（`IP-CIDR`、`GEOIP`、含 IP 的 `RULE-SET`）时才去查 DNS；
 *   sing-box 的 `ip_cidr` 只比目标本来就是 IP 的连接。所以在那一条之前插一条 `{ action: "resolve" }`（编译时，见 `singbox-config.ts`）——
 *   它之前的规则照旧只按域名比，之后的规则域名与 IP 都比得上。
 * - **相邻、同策略的目标规则合并成一条**：sing-box 一条规则里 `domain` / `domain_suffix` / `domain_keyword` / `domain_regex` / `ip_cidr`
 *   之间是「或」，所以 Surge 里连着的 772 条 `DOMAIN-SUFFIX,…,Proxies` 合成一条不改变命中结果，配置也小一个数量级。不同策略之间不合并：顺序就是语义。
 * - **`RULE-SET` 的地址要联网**：地址来自用户挑的文件、不是用户在设置里亲手填的，宿主不会替它放行（上一期 P-5）。这里只记下地址；
 *   拉回来的列表由 {@link convertSurgeList} 转成 sing-box 的内联规则集。
 */
import { digest } from "./store.js";

// MARK: - 类型

/** 一条规则（或一个策略组成员）最后落到哪。 */
export type Policy = { kind: "direct" } | { kind: "reject"; drop: boolean } | { kind: "group"; name: string };

/** 策略组的一个成员。`nodes` = 「节点选择」，`auto` = 「自动选择」：Surge 配置里的节点名我们不认（节点来自订阅），一律落到这两个组上。 */
export type GroupMember = { kind: "direct" } | { kind: "group"; name: string } | { kind: "nodes" } | { kind: "auto" };

/** 一个策略组。 */
export interface SurgeGroup {
  name: string;
  /** Surge 里的类型（`select`、`url-test`……），给人看。 */
  type: string;
  members: GroupMember[];
}

/** sing-box 路由规则的匹配字段（不含 `action` / `outbound`）。 */
export type RuleMatch = Record<string, unknown>;

/** 转出来的一条规则。 */
export type ImportedRule =
  | { kind: "match"; match: RuleMatch; policy: Policy; resolve: boolean }
  /** 一个 `RULE-SET` / `DOMAIN-SET`：内容要拉回来才有；`noResolve` 为假且内容里有 IP 规则时编译前插 resolve。 */
  | { kind: "ruleSet"; tag: string; policy: Policy; noResolve: boolean };

/** 一个要联网拉的外部规则集。 */
export interface SurgeRuleSetRef {
  /** 在配置里的 tag：`surge-<地址摘要>`。 */
  tag: string;
  url: string;
  host: string;
  /** `RULE-SET`（Surge 规则列表）或 `DOMAIN-SET`（域名列表）。 */
  format: "rule-set" | "domain-set";
}

/** `[General]` 里与「代理」有关的几项。 */
export interface SurgeGeneral {
  /** `tun-excluded-routes`：不进 TUN 的路由（CIDR）。 */
  tunExcludedRoutes: string[];
  /** `bypass-tun`：同上（Surge 4 的写法）。 */
  bypassTun: string[];
  /** `always-real-ip`：不给假 IP 的域名（`*.` 开头的是后缀）。 */
  alwaysRealIP: string[];
  /** `dns-server`：直连解析用的 DNS（IP；`system` 记成 `system`）。 */
  dnsServers: string[];
  /** `skip-proxy`：系统代理的例外。 */
  skipProxy: string[];
  excludeSimpleHostnames: boolean;
  /** `ipv6`；没写为 `null`。 */
  ipv6: boolean | null;
}

/** `[Host]` 里的一条。 */
export type HostEntry = { kind: "address"; domain: string; addresses: string[] } | { kind: "server"; domain: string; server: string };

/** 一类转不了的东西。 */
export interface UnsupportedKind {
  /** `USER-AGENT`、`[URL Rewrite]`…… */
  kind: string;
  count: number;
  /** 至多 5 条原文（不含任何凭据：只取规则段与 `[Host]` 的行，`[Proxy]` / `[MITM]` / `[Script]` 只数不抄）。 */
  samples: string[];
  /** 为什么转不了。 */
  reason: string;
}

/** 导入报告。 */
export interface SurgeReport {
  /** `[Rule]` 里一共几条规则。 */
  ruleLines: number;
  /** 按 Surge 类型数，转出来了几条。 */
  converted: Record<string, number>;
  unsupported: UnsupportedKind[];
  /** 各段有几行。 */
  sections: { name: string; lines: number }[];
  /** 合并之后的 sing-box 规则条数。 */
  compiledRules: number;
}

/** 一次导入的全部产物（存进扩展存储）。 */
export interface SurgeImport {
  version: 1;
  /** 用户挑的那个文件的名字。 */
  sourceName: string;
  importedAt: number;
  general: SurgeGeneral;
  groups: SurgeGroup[];
  rules: ImportedRule[];
  /** `FINAL`；没写为 `null`（落到「节点选择」）。 */
  final: Policy | null;
  hosts: HostEntry[];
  ruleSets: SurgeRuleSetRef[];
  /** 用到的 `GEOIP` 国家码（小写）。 */
  geoip: string[];
  report: SurgeReport;
}

// MARK: - 读段

/** 一份配置按段切开：段名 → 有内容的行（去掉注释与空行）。 */
export function splitSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  sections.set(current, []);
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";") || line.startsWith("//")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current)!.push(line);
  }
  return sections;
}

/**
 * 把 `a, b, "c, d", (e, f)` 按顶层逗号切开：引号与括号里的逗号不算。
 * @param text 一行。
 * @returns 去掉首尾空白的各段。
 */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth = Math.max(0, depth - 1);
    if (!quoted && depth === 0 && char === ",") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.map((part) => part.replace(/^"(.*)"$/, "$1"));
}

/** 一行规则后面的 `// 注释`。 */
function stripTrailingComment(line: string): string {
  const index = line.search(/\s\/\/\s/);
  return (index >= 0 ? line.slice(0, index) : line).trim();
}

// MARK: - [General]

/** 逗号分隔的列表。 */
function list(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 读 `[General]`。
 * @param lines 段里的行。
 * @returns 与「代理」有关的几项。
 */
export function parseGeneral(lines: readonly string[]): SurgeGeneral {
  const values = new Map<string, string>();
  for (const line of lines) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    values.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }
  const flag = (key: string): boolean | null => {
    const value = values.get(key)?.toLowerCase();
    if (value === undefined) return null;
    return value === "true" || value === "1" || value === "yes";
  };
  const servers = list(values.get("dns-server")).filter((server) => server === "system" || isIPAddress(server));
  return {
    tunExcludedRoutes: list(values.get("tun-excluded-routes")).map(toCIDR).filter((value): value is string => value !== null),
    bypassTun: list(values.get("bypass-tun")).map(toCIDR).filter((value): value is string => value !== null),
    alwaysRealIP: list(values.get("always-real-ip")),
    dnsServers: servers,
    skipProxy: list(values.get("skip-proxy")),
    excludeSimpleHostnames: flag("exclude-simple-hostnames") ?? false,
    ipv6: flag("ipv6"),
  };
}

/** 是不是一个 IPv4 / IPv6 字面量（不带端口）。 */
export function isIPAddress(value: string): boolean {
  if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(value)) return value.split(".").every((part) => Number(part) <= 255);
  return /^[0-9a-f:]+$/i.test(value) && value.includes(":") && value.split("::").length <= 2;
}

/**
 * 一个地址或网段写成 CIDR：`1.2.3.4` → `1.2.3.4/32`；坏的为 `null`。
 * @param value 原文。
 * @returns CIDR。
 */
export function toCIDR(value: string): string | null {
  const [address, prefix] = value.split("/");
  if (!isIPAddress(address)) return null;
  const v6 = address.includes(":");
  if (prefix === undefined) return `${address}/${v6 ? 128 : 32}`;
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (v6 ? 128 : 32)) return null;
  return `${address}/${Number(prefix)}`;
}

// MARK: - 策略

/** Surge 内置的拒绝策略：`-DROP` 直接丢包（不回 RST），其余一律回拒绝。 */
const rejectPolicies = new Set(["REJECT", "REJECT-TINYGIF", "REJECT-DROP", "REJECT-NO-DROP", "REJECT-200"]);

/**
 * 一个策略名。
 * @param name 原文。
 * @returns 策略；`DIRECT` / `REJECT*` 以外的都是策略组。
 */
export function policyOf(name: string): Policy {
  const upper = name.trim().toUpperCase();
  if (upper === "DIRECT") return { kind: "direct" };
  if (rejectPolicies.has(upper)) return { kind: "reject", drop: upper === "REJECT-DROP" };
  return { kind: "group", name: name.trim() };
}

/** 两个策略是不是同一个。 */
export function samePolicy(a: Policy, b: Policy): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "group" && b.kind === "group") return a.name === b.name;
  if (a.kind === "reject" && b.kind === "reject") return a.drop === b.drop;
  return true;
}

// MARK: - 规则

/** 目标类字段：一条 sing-box 规则里它们之间是「或」，可以合并。 */
const destinationFields = new Set(["domain", "domain_suffix", "domain_keyword", "domain_regex", "ip_cidr"]);

/** 一条规则转出来的匹配（单条，不合并）。 */
type Converted = { match: RuleMatch; ip: boolean } | { unsupported: string };

/** Surge 的通配写法（`*` 任意长、`?` 一个字符）转成正则。 */
function wildcardRegex(pattern: string): string {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return `^${escaped}$`;
}

/** 一个端口或 `80-90` 区间。 */
function portMatch(value: string, single: string, range: string): RuleMatch | null {
  const span = /^(\d{1,5})-(\d{1,5})$/.exec(value);
  if (span) return { [range]: [`${Number(span[1])}:${Number(span[2])}`] };
  if (/^\d{1,5}$/.test(value) && Number(value) <= 65535) return { [single]: [Number(value)] };
  return null;
}

/**
 * 一条 Surge 规则的「类型,值」转成 sing-box 匹配（不含策略）。
 * @param type 类型（大写）。
 * @param value 值。
 * @returns 匹配与「是不是 IP 类」；转不了时写明原因。
 */
export function convertCondition(type: string, value: string): Converted {
  switch (type) {
    case "DOMAIN":
      return { match: { domain: [value.toLowerCase()] }, ip: false };
    case "DOMAIN-SUFFIX":
      return { match: { domain_suffix: [value.toLowerCase().replace(/^\./, "")] }, ip: false };
    case "DOMAIN-KEYWORD":
      return { match: { domain_keyword: [value.toLowerCase()] }, ip: false };
    case "DOMAIN-WILDCARD":
      return { match: { domain_regex: [wildcardRegex(value.toLowerCase())] }, ip: false };
    case "IP-CIDR":
    case "IP-CIDR6": {
      const cidr = toCIDR(value);
      return cidr ? { match: { ip_cidr: [cidr] }, ip: true } : { unsupported: "网段写错了" };
    }
    case "GEOIP":
      return /^[a-z]{2}$/i.test(value) ? { match: { rule_set: [`geoip-${value.toLowerCase()}`] }, ip: true } : { unsupported: "国家码写错了" };
    case "PROCESS-NAME":
      // 写了完整路径的只取文件名：sing-box 的 `process_path` 是一个以 `_path` 结尾的键，增强模式下宿主的守卫会整份拒绝（它分不出
      // 「匹配字段」与「文件路径」），而按文件名认进程在 macOS 上几乎总是够的。
      return { match: { process_name: [value.includes("/") ? (value.split("/").pop() ?? value) : value] }, ip: false };
    case "DEST-PORT": {
      const match = portMatch(value, "port", "port_range");
      return match ? { match, ip: false } : { unsupported: "端口写错了" };
    }
    case "SRC-PORT": {
      const match = portMatch(value, "source_port", "source_port_range");
      return match ? { match, ip: false } : { unsupported: "端口写错了" };
    }
    case "SRC-IP": {
      const cidr = toCIDR(value);
      return cidr ? { match: { source_ip_cidr: [cidr] }, ip: false } : { unsupported: "地址写错了" };
    }
    case "PROTOCOL": {
      const upper = value.toUpperCase();
      if (upper === "TCP" || upper === "UDP") return { match: { network: [upper.toLowerCase()] }, ip: false };
      const sniffed: Record<string, string> = { HTTP: "http", HTTPS: "tls", QUIC: "quic", STUN: "stun" };
      return sniffed[upper] ? { match: { protocol: [sniffed[upper]] }, ip: false } : { unsupported: `sing-box 认不出协议 ${value}` };
    }
    default:
      return { unsupported: unsupportedReason(type) };
  }
}

/** 转不了的规则类型为什么转不了。 */
function unsupportedReason(type: string): string {
  switch (type) {
    case "USER-AGENT":
    case "URL-REGEX":
      return "要解开 HTTPS 正文（MITM）才看得到，sing-box 不做";
    case "IP-ASN":
      return "sing-box 1.14 不按 ASN 分流";
    case "SUBNET":
    case "CELLULAR-RADIO":
    case "CELLULAR-CARRIER":
    case "DEVICE-NAME":
    case "HOSTNAME-TYPE":
      return "Surge 专有的环境条件";
    case "SCRIPT":
      return "脚本规则不导入";
    case "IN-PORT":
      return "「代理」只有一个本机端口";
    default:
      return "认不出的规则类型";
  }
}

/**
 * `AND,((DOMAIN,a), (DEST-PORT,443))` 这一类。子规则全部能转才转。
 * @param type `AND` / `OR` / `NOT`。
 * @param body 括号里那一段（含最外层括号）。
 * @returns sing-box 逻辑规则的匹配部分。
 */
function convertLogical(type: string, body: string): Converted {
  const inner = body.trim().replace(/^\((.*)\)$/s, "$1");
  const parts = splitTopLevel(inner).filter((part) => part.length > 0);
  if (parts.length === 0) return { unsupported: "逻辑规则是空的" };
  const rules: RuleMatch[] = [];
  let ip = false;
  for (const part of parts) {
    const sub = part.replace(/^\((.*)\)$/s, "$1");
    const fields = splitTopLevel(sub);
    const subType = (fields[0] ?? "").toUpperCase();
    const converted = subType === "AND" || subType === "OR" || subType === "NOT" ? convertLogical(subType, fields.slice(1).join(",")) : convertCondition(subType, fields[1] ?? "");
    if ("unsupported" in converted) return { unsupported: `子规则 ${subType}：${converted.unsupported}` };
    ip ||= converted.ip;
    rules.push(converted.match);
  }
  if (type === "NOT") {
    if (rules.length !== 1) return { unsupported: "NOT 只能带一条子规则" };
    return { match: { ...rules[0], invert: true }, ip };
  }
  return { match: { type: "logical", mode: type === "AND" ? "and" : "or", rules }, ip };
}

/** 两个匹配能不能合成一条：都只有目标类字段；或者字段集合完全相同（例如都是 `process_name`）。 */
function mergeable(a: RuleMatch, b: RuleMatch): boolean {
  if (a.type === "logical" || b.type === "logical" || a.invert || b.invert) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.every((key) => destinationFields.has(key)) && keysB.every((key) => destinationFields.has(key))) return true;
  return keysA.length === 1 && keysB.length === 1 && keysA[0] === keysB[0] && Array.isArray(a[keysA[0]]);
}

/** 把 `b` 并进 `a`（同名数组拼起来）。 */
function merge(a: RuleMatch, b: RuleMatch): RuleMatch {
  const out: RuleMatch = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = [...((out[key] as unknown[] | undefined) ?? []), ...(value as unknown[])];
  return out;
}

/** 报告里一类转不了的，往里记一条。 */
function noteUnsupported(report: Map<string, UnsupportedKind>, kind: string, reason: string, sample: string | null): void {
  const entry = report.get(kind) ?? { kind, count: 0, samples: [], reason };
  entry.count += 1;
  if (sample !== null && entry.samples.length < 5) entry.samples.push(sample.slice(0, 160));
  report.set(kind, entry);
}

/**
 * 读 `[Rule]`。
 * @param lines 段里的行。
 * @param unsupported 报告（往里记）。
 * @returns 规则、`FINAL`、外部规则集、用到的 GEOIP、按类型的计数。
 */
export function parseRules(
  lines: readonly string[],
  unsupported: Map<string, UnsupportedKind>,
): { rules: ImportedRule[]; final: Policy | null; ruleSets: SurgeRuleSetRef[]; geoip: string[]; converted: Record<string, number>; count: number } {
  const rules: ImportedRule[] = [];
  const ruleSets: SurgeRuleSetRef[] = [];
  const geoip = new Set<string>();
  const converted: Record<string, number> = {};
  let final: Policy | null = null;
  let count = 0;
  const bump = (type: string) => {
    converted[type] = (converted[type] ?? 0) + 1;
  };
  for (const raw of lines) {
    const line = stripTrailingComment(raw);
    if (line.length === 0) continue;
    count += 1;
    const fields = splitTopLevel(line);
    const type = (fields[0] ?? "").toUpperCase();
    if (type === "FINAL" || type === "MATCH") {
      if (fields[1]) {
        final = policyOf(fields[1]);
        bump("FINAL");
      }
      continue;
    }
    if (type === "AND" || type === "OR" || type === "NOT") {
      const policy = fields[2] ? policyOf(fields[2]) : null;
      const result = policy ? convertLogical(type, fields[1] ?? "") : { unsupported: "没写策略" };
      if ("unsupported" in result) noteUnsupported(unsupported, type, result.unsupported, line);
      else {
        rules.push({ kind: "match", match: result.match, policy: policy!, resolve: result.ip && !fields.slice(3).some((option) => option.toLowerCase() === "no-resolve") });
        bump(type);
      }
      continue;
    }
    const value = fields[1] ?? "";
    const policyName = fields[2];
    const options = fields.slice(3).map((option) => option.toLowerCase());
    if (!policyName) {
      noteUnsupported(unsupported, type || "（空）", "没写策略", line);
      continue;
    }
    const policy = policyOf(policyName);
    if (type === "RULE-SET" || type === "DOMAIN-SET") {
      if (type === "RULE-SET" && value.toUpperCase() === "LAN") {
        rules.push({ kind: "match", match: { ip_is_private: true }, policy, resolve: false });
        bump(type);
        continue;
      }
      if (!/^https:\/\/\S+$/i.test(value)) {
        noteUnsupported(unsupported, `${type},${value.toUpperCase() === "SYSTEM" ? "SYSTEM" : "非 https 地址"}`, value.toUpperCase() === "SYSTEM" ? "Surge 内置的系统服务名单，没有公开的内容" : "只拉 https 地址", line);
        continue;
      }
      const tag = `surge-${digest(value)}`;
      if (!ruleSets.some((ref) => ref.tag === tag)) {
        ruleSets.push({ tag, url: value, host: hostOf(value), format: type === "RULE-SET" ? "rule-set" : "domain-set" });
      }
      rules.push({ kind: "ruleSet", tag, policy, noResolve: options.includes("no-resolve") || type === "DOMAIN-SET" });
      bump(type);
      continue;
    }
    const result = convertCondition(type, value);
    if ("unsupported" in result) {
      noteUnsupported(unsupported, type, result.unsupported, line);
      continue;
    }
    if (type === "GEOIP") geoip.add(value.toLowerCase());
    const resolve = result.ip && !options.includes("no-resolve");
    const previous = rules[rules.length - 1];
    if (previous && previous.kind === "match" && samePolicy(previous.policy, policy) && previous.resolve === resolve && mergeable(previous.match, result.match)) {
      previous.match = merge(previous.match, result.match);
    } else {
      rules.push({ kind: "match", match: result.match, policy, resolve });
    }
    bump(type);
  }
  return { rules, final, ruleSets, geoip: [...geoip], converted, count };
}

/** 一个地址的主机名。 */
export function hostOf(url: string): string {
  const match = /^https?:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url.trim());
  return match ? match[1].toLowerCase() : "";
}

// MARK: - [Proxy Group]

/**
 * 读 `[Proxy Group]`。`select` 以外的类型（`url-test`、`fallback`、`load-balance`……）同样画成一个可以手选的组，
 * 只是默认选「自动选择」——sing-box 的 urltest 组成员必须是真节点，而这些组的成员是 Surge 配置里的节点名，我们这边没有。
 * @param lines 段里的行。
 * @returns 组（成员里的组名之后再按出现过的组校正）。
 */
export function parseGroups(lines: readonly string[]): SurgeGroup[] {
  const groups: SurgeGroup[] = [];
  for (const line of lines) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    const fields = splitTopLevel(line.slice(index + 1));
    const type = (fields[0] ?? "select").toLowerCase();
    const raw = fields.slice(1);
    const members: string[] = [];
    let external = false;
    for (const field of raw) {
      const option = /^([a-z0-9-]+)\s*=\s*(.*)$/i.exec(field);
      if (option) {
        const key = option[1].toLowerCase();
        if (key === "policy-path" || key === "include-all-proxies" || key === "include-other-group" || key === "policy-regex-filter") external = true;
        continue;
      }
      if (field.length > 0) members.push(field);
    }
    groups.push({ name, type, members: members.map((member) => ({ kind: "group", name: member }) as GroupMember).concat(external ? [{ kind: "nodes" }] : []) });
  }
  return groups;
}

/**
 * 把组成员落到我们认得的东西上，并补上规则里用到、却没定义的组；去掉成环的引用。
 * @param defined `[Proxy Group]` 里的组。
 * @param referenced 规则与 `FINAL` 里用到的组名（按出现先后）。
 * @returns 组。
 */
export function resolveGroups(defined: readonly SurgeGroup[], referenced: readonly string[]): SurgeGroup[] {
  const names = new Set(defined.map((group) => group.name));
  const out: SurgeGroup[] = [];
  for (const group of defined) {
    const members: GroupMember[] = [];
    const push = (member: GroupMember) => {
      if (!members.some((existing) => JSON.stringify(existing) === JSON.stringify(member))) members.push(member);
    };
    for (const member of group.members) {
      if (member.kind !== "group") {
        push(member);
        continue;
      }
      const policy = policyOf(member.name);
      if (policy.kind === "direct") push({ kind: "direct" });
      else if (policy.kind === "reject") continue;
      else if (names.has(member.name) && member.name !== group.name) push({ kind: "group", name: member.name });
      else push({ kind: "nodes" });
    }
    const automatic = group.type !== "select";
    if (!members.some((member) => member.kind === "nodes" || member.kind === "auto")) push({ kind: "nodes" });
    if (!members.some((member) => member.kind === "auto")) {
      if (automatic) members.unshift({ kind: "auto" });
      else push({ kind: "auto" });
    } else if (automatic) {
      const index = members.findIndex((member) => member.kind === "auto");
      members.unshift(...members.splice(index, 1));
    }
    out.push({ name: group.name, type: group.type, members });
  }
  for (const name of referenced) {
    if (names.has(name) || out.some((group) => group.name === name)) continue;
    out.push({ name, type: "select", members: [{ kind: "nodes" }, { kind: "auto" }, { kind: "direct" }] });
  }
  return breakCycles(out);
}

/** 去掉成环的组引用（Surge 允许，sing-box 起不来）：按先后做一次深度优先，指回祖先的那条边删掉。 */
function breakCycles(groups: SurgeGroup[]): SurgeGroup[] {
  const byName = new Map(groups.map((group) => [group.name, group]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (group: SurgeGroup) => {
    state.set(group.name, "visiting");
    group.members = group.members.filter((member) => {
      if (member.kind !== "group") return true;
      const target = byName.get(member.name);
      if (!target) return false;
      if (state.get(target.name) === "visiting") return false;
      if (!state.has(target.name)) visit(target);
      return true;
    });
    if (group.members.length === 0) group.members.push({ kind: "nodes" });
    state.set(group.name, "done");
  };
  for (const group of groups) if (!state.has(group.name)) visit(group);
  return groups;
}

// MARK: - [Host]

/**
 * 读 `[Host]`。`域名 = IP`（可以几个）进 hosts；`域名 = server:IP` 指定这个域名用哪台 DNS；通配与别名转不了。
 * @param lines 段里的行。
 * @param unsupported 报告。
 * @returns 条目。
 */
export function parseHosts(lines: readonly string[], unsupported: Map<string, UnsupportedKind>): HostEntry[] {
  const entries: HostEntry[] = [];
  for (const line of lines) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const domain = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (domain.includes("*")) {
      noteUnsupported(unsupported, "[Host] 通配", "sing-box 的 hosts 只认完整域名", line);
      continue;
    }
    const server = /^server:(.+)$/i.exec(value);
    if (server) {
      const target = server[1].trim();
      if (isIPAddress(target)) entries.push({ kind: "server", domain, server: target });
      else noteUnsupported(unsupported, "[Host] server:", target === "system" || target === "syslib" ? "交给系统解析就是默认行为" : "只认 IP 写的 DNS", line);
      continue;
    }
    const addresses = list(value);
    if (addresses.length > 0 && addresses.every(isIPAddress)) entries.push({ kind: "address", domain, addresses });
    else noteUnsupported(unsupported, "[Host] 别名", "域名指向另一个域名（CNAME 式）转不了", line);
  }
  return entries;
}

// MARK: - 整份

/** 只数不抄的段：里面有凭据（`[Proxy]` 的密码、`[MITM]` 的证书口令、`[Script]` 的参数）或者是 sing-box 做不了的事。 */
const countOnlySections: Readonly<Record<string, string>> = {
  Proxy: "节点来自订阅：本期不从 Surge 配置导入节点",
  MITM: "sing-box 不做 HTTPS 解密",
  Script: "sing-box 不跑脚本",
  "URL Rewrite": "要解开 HTTPS 正文才能改写",
  "Header Rewrite": "要解开 HTTPS 正文才能改写",
  "Body Rewrite": "要解开 HTTPS 正文才能改写",
  "Map Local": "要解开 HTTPS 正文才能替换",
  "SSID Setting": "Surge 专有的环境条件",
  WireGuard: "节点来自订阅",
  Panel: "Surge 的面板",
};

/** 认得、会转的段。 */
const handledSections = new Set(["General", "Rule", "Proxy Group", "Host", "Replica"]);

/**
 * 导入一份 Surge 配置。
 * @param text 文件正文。
 * @param sourceName 文件名（给人看）。
 * @param now 现在（Unix 毫秒）。
 * @returns 导入结果。
 * @throws 一条规则、一个组都读不出来时抛 `Error`（中文）：多半是挑错了文件。
 */
export function convertSurgeProfile(text: string, sourceName: string, now: number): SurgeImport {
  const sections = splitSections(text);
  const unsupported = new Map<string, UnsupportedKind>();
  const general = parseGeneral(sections.get("General") ?? []);
  const parsed = parseRules(sections.get("Rule") ?? [], unsupported);
  const referenced: string[] = [];
  const note = (policy: Policy | null) => {
    if (policy?.kind === "group" && !referenced.includes(policy.name)) referenced.push(policy.name);
  };
  for (const rule of parsed.rules) note(rule.policy);
  note(parsed.final);
  const groups = resolveGroups(parseGroups(sections.get("Proxy Group") ?? []), referenced);
  const hosts = parseHosts(sections.get("Host") ?? [], unsupported);
  for (const [name, reason] of Object.entries(countOnlySections)) {
    const lines = sections.get(name)?.length ?? 0;
    if (lines > 0) unsupported.set(`[${name}]`, { kind: `[${name}]`, count: lines, samples: [], reason });
  }
  for (const [name, lines] of sections) {
    if (name === "" || handledSections.has(name) || countOnlySections[name] !== undefined || lines.length === 0) continue;
    unsupported.set(`[${name}]`, { kind: `[${name}]`, count: lines.length, samples: [], reason: "认不出的段" });
  }
  if (parsed.count === 0 && groups.length === 0) throw new Error("这份文件里没有 [Rule] 规则：挑的是 Surge 的配置（.conf）吗");
  return {
    version: 1,
    sourceName,
    importedAt: now,
    general,
    groups,
    rules: parsed.rules,
    final: parsed.final,
    hosts,
    ruleSets: parsed.ruleSets,
    geoip: parsed.geoip,
    report: {
      ruleLines: parsed.count,
      converted: parsed.converted,
      unsupported: [...unsupported.values()].sort((a, b) => b.count - a.count),
      sections: [...sections].filter(([name, lines]) => name !== "" && lines.length > 0).map(([name, lines]) => ({ name, lines: lines.length })),
      compiledRules: parsed.rules.length,
    },
  };
}

/** 一次导入里所有转出来的规则条数（报告给人看的那个「转出 N 条」）。 */
export function convertedCount(report: SurgeReport): number {
  return Object.values(report.converted).reduce((sum, count) => sum + count, 0);
}

// MARK: - 外部规则集

/** sing-box 内联规则集里的一条（headless rule）。 */
export type HeadlessRule = Record<string, unknown>;

/** 一份外部规则集转出来的东西。 */
export interface ConvertedList {
  rules: HeadlessRule[];
  /** 里面有没写 `no-resolve` 的 IP 类规则：引用它的那条规则也没写 `no-resolve` 时编译前要插 resolve。 */
  hasIP: boolean;
  /** 认出了几条、转不了几条。 */
  total: number;
  skipped: number;
}

/**
 * 把拉回来的 Surge 规则列表（`RULE-SET`：每行 `类型,值[,no-resolve]`）或域名列表（`DOMAIN-SET`：每行一个域名，`.` 开头的含子域名）
 * 转成 sing-box 内联规则集。目标类的并成一条，其余每种字段各一条（字段之间是「与」，不能混在一条里）。
 * @param text 正文。
 * @param format 哪一种。
 * @returns 规则。
 */
export function convertSurgeList(text: string, format: SurgeRuleSetRef["format"]): ConvertedList {
  const destination: RuleMatch = {};
  const others = new Map<string, RuleMatch>();
  let hasIP = false;
  let total = 0;
  let skipped = 0;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = stripTrailingComment(raw.trim());
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";") || line.startsWith("//")) continue;
    total += 1;
    if (format === "domain-set") {
      const domain = line.toLowerCase();
      if (!/^\.?[a-z0-9*-]+(\.[a-z0-9-]+)*$/.test(domain)) {
        skipped += 1;
        continue;
      }
      const key = domain.startsWith(".") ? "domain_suffix" : "domain";
      destination[key] = [...((destination[key] as string[] | undefined) ?? []), domain.replace(/^\./, "")];
      continue;
    }
    const fields = splitTopLevel(line);
    const result = convertCondition((fields[0] ?? "").toUpperCase(), fields[1] ?? "");
    if ("unsupported" in result || result.match.rule_set) {
      skipped += 1;
      continue;
    }
    // 列表里自己写了 no-resolve 的 IP 规则不触发解析（与 Surge 相同）；只要有一条没写，引用它的规则之前就要解析。
    hasIP ||= result.ip && !fields.slice(2).some((option) => option.toLowerCase() === "no-resolve");
    const keys = Object.keys(result.match);
    if (keys.every((key) => destinationFields.has(key))) {
      for (const key of keys) destination[key] = [...((destination[key] as unknown[] | undefined) ?? []), ...(result.match[key] as unknown[])];
    } else {
      const signature = keys.sort().join("+");
      others.set(signature, merge(others.get(signature) ?? {}, result.match));
    }
  }
  const rules: HeadlessRule[] = [];
  if (Object.keys(destination).length > 0) rules.push(destination);
  rules.push(...others.values());
  return { rules, hasIP, total, skipped };
}
