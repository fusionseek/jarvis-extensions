/**
 * 当前页面规则（jarvis-mac `specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-8）：用户在菜单栏「当前页面」或窗口「规则」页里
 * 给一个网站指定「走代理 / 直连 / 拒绝 / 走某个策略组」，存进扩展存储，排在**所有规则之前**（用户亲手加的最具体），写入即重载内核。
 *
 * 「当前页面」= 浏览器地址栏的主机 + 这个浏览器的网络进程最近 30 秒连过的主机，按可注册域名（eTLD+1）归并：
 * 一个页面要拉 CDN、接口、统计好几家的域名，只给地址栏那一个，「直连」之后页面照样卡在别的域名上。
 *
 * 纯函数，不碰宿主。
 */

/** 页面规则的策略：`proxy` = 「节点选择」，`group:<名字>` = 导入的 Surge 策略组。 */
export type PolicyRef = "proxy" | "direct" | "reject" | `group:${string}`;

/** 一条页面规则。 */
export interface PageRule {
  /** 规则 id：`<kind>:<value>`——同一个域名同一种匹配只有一条，再加就是改策略。 */
  id: string;
  /** `domain_suffix` 含全部子域名（菜单里加的都是这种）；`domain` 只认这一个主机。 */
  kind: "domain_suffix" | "domain";
  value: string;
  policy: PolicyRef;
  createdAt: number;
}

/** 页面规则至多几条：再多就该去导入一份完整的规则了，菜单与「规则」页也列不下。 */
export const maximumPageRules = 500;

/**
 * 一个策略能不能写进规则。
 * @param value 原文。
 * @returns 是不是。
 */
export function isPolicyRef(value: unknown): value is PolicyRef {
  return value === "proxy" || value === "direct" || value === "reject" || (typeof value === "string" && /^group:.+$/.test(value));
}

/**
 * 存储里读出来的页面规则：坏的条目丢掉、id 重复的只留第一条（新加的在前）。
 * @param raw 存储里的值。
 * @returns 规则。
 */
export function normalizePageRules(raw: unknown): PageRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PageRule[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rule = item as Record<string, unknown>;
    const kind = rule.kind === "domain" ? "domain" : rule.kind === "domain_suffix" ? "domain_suffix" : null;
    const value = typeof rule.value === "string" ? normalizeHost(rule.value) : "";
    if (!kind || !value || !isPolicyRef(rule.policy)) continue;
    const id = `${kind}:${value}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, kind, value, policy: rule.policy, createdAt: typeof rule.createdAt === "number" ? rule.createdAt : 0 });
  }
  return out.slice(0, maximumPageRules);
}

/**
 * 加一条（或改掉同一个域名那一条的策略），新的排最前。
 * @param rules 现有规则。
 * @param rule 要加的。
 * @param now 现在。
 * @returns 新数组。
 */
export function upsertPageRule(rules: readonly PageRule[], rule: { kind: PageRule["kind"]; value: string; policy: PolicyRef }, now: number): PageRule[] {
  const value = normalizeHost(rule.value);
  if (!value) return [...rules];
  const id = `${rule.kind}:${value}`;
  return [{ id, kind: rule.kind, value, policy: rule.policy, createdAt: now }, ...rules.filter((existing) => existing.id !== id)].slice(0, maximumPageRules);
}

/**
 * 删一条。
 * @param rules 现有规则。
 * @param id 规则 id。
 * @returns 新数组。
 */
export function removePageRule(rules: readonly PageRule[], id: string): PageRule[] {
  return rules.filter((rule) => rule.id !== id);
}

/**
 * 一个主机（可能带端口、方括号、末尾的点、大写）规整成小写的主机名。坏的为空串。
 * @param value 原文。
 * @returns 主机名。
 */
export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
  if (bracket) return bracket[1];
  if ((host.match(/:/g) ?? []).length === 1) host = host.replace(/:\d+$/, "");
  host = host.replace(/\.$/, "");
  return /^[a-z0-9_.:-]+$/.test(host) ? host : "";
}

/**
 * 地址栏里那个地址的主机名。
 * @param url 地址。
 * @returns 主机名；不是 http(s) 页面（`about:blank`、扩展页、本地文件）为空串。
 */
export function urlHost(url: string): string {
  const match = /^https?:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url.trim());
  return match ? normalizeHost(match[1]) : "";
}

/** 是不是 IP 字面量（IP 不归并成可注册域名）。 */
function isIP(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/**
 * 常见的二级公共后缀：`example.com.cn` 的可注册域名是它自己，不是 `com.cn`。
 * 不带一整份公共后缀表（它有一万多行，扩展的产物会大几百 KB）；这几十个覆盖了绝大多数会出现在代理规则里的网站。
 */
const secondLevelSuffixes = new Set([
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "com.hk", "net.hk", "org.hk", "edu.hk", "gov.hk",
  "com.tw", "net.tw", "org.tw", "edu.tw", "gov.tw",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "co.kr", "or.kr", "ne.kr", "ac.kr", "go.kr",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "com.sg", "edu.sg", "gov.sg", "com.my", "com.br", "com.mx", "com.tr", "com.ru", "co.in", "co.nz", "co.za",
  "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "herokuapp.com", "appspot.com",
  "cloudfront.net", "azurewebsites.net", "blogspot.com", "fly.dev",
]);

/**
 * 可注册域名（eTLD+1）：`api.github.com` → `github.com`、`www.bbc.co.uk` → `bbc.co.uk`。IP 与单段主机名原样。
 * @param host 主机名。
 * @returns 可注册域名。
 */
export function registrableDomain(host: string): string {
  const name = normalizeHost(host);
  if (!name || isIP(name)) return name;
  const labels = name.split(".");
  if (labels.length <= 2) return name;
  const lastTwo = labels.slice(-2).join(".");
  if (secondLevelSuffixes.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/** 当前浏览器（`browser.activeTab()` 里的 `browser`）。 */
export interface BrowserInfo {
  bundleId: string;
  name: string;
  path: string;
}

/**
 * 一条连接的进程是不是这个浏览器的网络进程。
 *
 * - Chromium 系（Chrome、Edge、Brave、Arc、Vivaldi）的网络服务跑在包里面的 Helper 进程里：进程路径落在浏览器包路径之下就算；
 * - Safari 的网络在系统的 `com.apple.WebKit.Networking`（不在 Safari 包里，也被别的 WebKit 应用共用——这是能做到的最近似）。
 * @param processPath sing-box 报的进程路径（末尾的「 (用户名)」已去掉）。
 * @param browser 浏览器。
 * @returns 是不是。
 */
export function isBrowserProcess(processPath: string, browser: BrowserInfo): boolean {
  if (!processPath) return false;
  if (browser.bundleId === "com.apple.Safari" || browser.bundleId === "com.apple.SafariTechnologyPreview") {
    return processPath.includes("com.apple.WebKit.Networking") || processPath.startsWith(`${browser.path.replace(/\/$/, "")}/`);
  }
  const root = browser.path.replace(/\/$/, "");
  return root.length > 0 && processPath.startsWith(`${root}/`);
}

/** 一次连接记录（来自日志与连接快照的合并，见 `traffic.ts`）。 */
export interface SeenConnection {
  host: string;
  process: string;
  at: number;
  /** 出站链，最终出站在前（sing-box 的顺序）；不知道为空。 */
  chains: string[];
  failed: boolean;
}

/** 「当前页面」里的一个域名。 */
export interface PageDomain {
  /** 可注册域名。 */
  domain: string;
  /** 这个域名下见过的主机（至多 4 个，给人看）。 */
  hosts: string[];
  /** 是地址栏的那一个。 */
  isPage: boolean;
  /** 最近 30 秒的连接数。 */
  connections: number;
  /** 其中失败的。 */
  failed: number;
  /** 最近一条连接走的出站（链里离用户最近的那个策略组 / 出站）；不知道为 `null`。 */
  route: string | null;
}

/** 「当前页面」至多列几个域名：菜单的子菜单里放得下、又不至于把整页的统计域名都列出来。 */
export const maximumPageDomains = 8;

/**
 * 当前页面的域名。
 * @param pageHost 地址栏的主机；读不出为空串。
 * @param browser 浏览器；没有为 `null`（只看地址栏）。
 * @param seen 最近的连接。
 * @param now 现在。
 * @param windowMs 看最近多久。
 * @returns 地址栏那个在最前，其余按连接数从多到少。
 */
export function pageDomains(pageHost: string, browser: BrowserInfo | null, seen: readonly SeenConnection[], now: number, windowMs = 30_000): PageDomain[] {
  const byDomain = new Map<string, PageDomain & { latest: number }>();
  const pageDomain = pageHost ? registrableDomain(pageHost) : "";
  if (pageDomain) byDomain.set(pageDomain, { domain: pageDomain, hosts: [pageHost], isPage: true, connections: 0, failed: 0, route: null, latest: 0 });
  for (const connection of seen) {
    if (now - connection.at > windowMs) continue;
    if (!browser || !isBrowserProcess(connection.process, browser)) continue;
    const host = normalizeHost(connection.host);
    if (!host) continue;
    const domain = registrableDomain(host);
    const entry = byDomain.get(domain) ?? { domain, hosts: [], isPage: false, connections: 0, failed: 0, route: null, latest: 0 };
    entry.connections += 1;
    if (connection.failed) entry.failed += 1;
    if (!entry.hosts.includes(host) && entry.hosts.length < 4) entry.hosts.push(host);
    if (connection.at >= entry.latest && connection.chains.length > 0) {
      entry.latest = connection.at;
      entry.route = connection.chains[connection.chains.length - 1];
    }
    byDomain.set(domain, entry);
  }
  const list = [...byDomain.values()].sort((a, b) => Number(b.isPage) - Number(a.isPage) || b.connections - a.connections || a.domain.localeCompare(b.domain));
  return list.slice(0, maximumPageDomains).map(({ latest: _latest, ...domain }) => domain);
}

/**
 * 一个域名此刻被哪条页面规则管着（`domain_suffix` 含子域名）。
 * @param rules 页面规则。
 * @param host 主机或域名。
 * @returns 规则；没有为 `null`。
 */
export function pageRuleFor(rules: readonly PageRule[], host: string): PageRule | null {
  const name = normalizeHost(host);
  for (const rule of rules) {
    if (rule.kind === "domain" && rule.value === name) return rule;
    if (rule.kind === "domain_suffix" && (name === rule.value || name.endsWith(`.${rule.value}`))) return rule;
  }
  return null;
}

/** 策略的中文名。 */
export function policyTitle(policy: PolicyRef): string {
  if (policy === "proxy") return "走代理";
  if (policy === "direct") return "直连";
  if (policy === "reject") return "拒绝";
  return `走「${policy.slice("group:".length)}」`;
}
