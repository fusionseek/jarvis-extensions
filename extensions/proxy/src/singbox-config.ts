/**
 * 生成 sing-box 1.14 配置：系统代理模式（P-9「生成的 sing-box 配置」）与 TUN 增强模式（jarvis-mac
 * `specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-7）；两种模式都吃同一套导入的 Surge 规则（T-9）与页面规则（T-8）。
 *
 * ## 系统代理模式
 *
 * 系统代理模式的形状决定了下面几乎每一个选择：应用把**域名**交给我们的 `mixed` 入站（HTTP CONNECT / SOCKS），
 * DNS 不经过 sing-box。于是：
 *
 * - 走代理的连接由远端解析域名，本机一次 DNS 都不用查；
 * - 本机 DNS 只用在三处——解析节点服务器的域名、直连出去的域名、下载规则集的那个 CDN。这三处都**必须**直连解析
 *   （代理还没通的时候就得先解析节点），所以只配一个 `local` 服务器（系统解析器）：它跟着用户当前的网络走
 *   （公司内网的 DNS、DHCP 下发的 DNS），也不依赖任何一家公共 DNS 在当前网络里可达。
 *
 * ## TUN 增强模式（参照 Surge 增强模式）
 *
 * TUN 段（地址、`auto_route`、`strict_route`、协议栈、不进 TUN 的路由）由宿主的网络助手填，这里**不写 tun 入站**——宿主的守卫会拒绝它。
 * 应用交来的是 IP 包，于是：
 *
 * - DNS 要劫持（路由规则 `protocol: dns → hijack-dns`），并由 sing-box 自己答：默认给 **fake-ip**（`198.18.0.0/15`），
 *   连接进来时按假 IP 认回域名，域名规则对每一个应用都有效——与 Surge 增强模式相同；`always-real-ip` 的域名照给真实地址；
 * - 直连解析用 UDP 直接问 `dns-server`（导入的，没有则 223.5.5.5）：不用系统解析器——它的查询会被路由进 TUN、再被劫持回来，绕成一个圈；
 * - 代理那一侧的解析走经「节点选择」的 DoH（1.1.1.1），答案不被污染；
 * - `route.find_process`：按进程分流（导入的 `PROCESS-NAME`）与「当前页面」认浏览器的连接都靠它。
 *
 * 纯数据，不碰宿主：返回一个普通对象，调用方 `JSON.stringify` 之后交给 `daemon.start` / `tunnel.start`。
 * 字段名逐个对过 sing-box 1.14 文档与源码（`option/*.go`），并在本机 `sing-box check`（1.14.4）上验过无错误、无弃用警告。
 */
import { DIRECT_TAG, SELECTOR_TAG, URLTEST_TAG, dedupeNodeNames, reservedTags, type ProxyNode } from "./nodes.js";
import type { PageRule, PolicyRef } from "./rules.js";
import { toCIDR, type ConvertedList, type GroupMember, type ImportedRule, type Policy, type SurgeImport } from "./surge.js";

export { DIRECT_TAG, SELECTOR_TAG, URLTEST_TAG } from "./nodes.js";

/** 出站模式：规则 / 全局 / 直连。 */
export type ProxyMode = "rule" | "global" | "direct";

/**
 * 出站模式在 Clash API 里的名字。
 *
 * sing-box 的模式表是从配置里出现过的 `clash_mode` 取值**原样**收集来的，再按 `Rule`、`Global`、`Direct` 的顺序排、
 * 把 `default_mode` 补在最前（`experimental/clashmode`）。`PATCH /configs {"mode": …}` 与 `clash_mode` 规则的比较
 * 都不分大小写，但 `GET /configs` 报回来的是表里的原样写法——所以规则、`default_mode` 一律用这三个首字母大写的写法，
 * 让模式表恰好是这三项、读回来的名字也恰好是它们。
 */
export const clashModeNames: Readonly<Record<ProxyMode, string>> = { rule: "Rule", global: "Global", direct: "Direct" };

/**
 * Clash API 报回来的模式名 → 出站模式。
 * @param name `GET /configs` 的 `mode`。
 * @returns 出站模式；不认识的名字为 `null`。
 */
export function proxyModeFromClash(name: string): ProxyMode | null {
  const lowered = name.trim().toLowerCase();
  for (const mode of Object.keys(clashModeNames) as ProxyMode[]) if (clashModeNames[mode].toLowerCase() === lowered) return mode;
  return null;
}

/** `mixed` 入站的 tag。 */
export const MIXED_INBOUND_TAG = "mixed-in";

/** 唯一那台 DNS 服务器（系统解析器）的 tag。 */
export const LOCAL_DNS_TAG = "local";

/** 下载规则集用的 HTTP 客户端的 tag（见 {@link buildConfig} 里 `http_clients` 那段）。 */
export const RULE_SET_HTTP_CLIENT_TAG = "rule-set-direct";

/**
 * 中国大陆分流用的两份远程规则集：SagerNet 官方 `sing-geosite` / `sing-geoip` 仓库 `rule-set` 分支里的二进制 `.srs`。
 *
 * 地址走 jsDelivr 的 `testingcf.jsdelivr.net`（Cloudflare 承载的那一路）而不是 `raw.githubusercontent.com`：
 * 后者在中国大陆直连多半不通，而规则集恰恰要直连下载（见 `http_clients`）。`cdn.jsdelivr.net` 在 2021 年 ICP 备案被吊销之后
 * 在大陆的解析时好时坏，`testingcf` 是大陆用户里流传最广、最稳的那个镜像。
 *
 * 规则集第一次启动时必须下载成功，否则 sing-box 以「initial rule-set: …」拒绝启动（`route/rule/rule_set_remote.go`）；
 * 下载过一次之后存在 `cache.db` 里，之后离线也起得来，每天（默认 `update_interval`）后台更新一次。
 * 所以调用方遇到这条启动失败时，可以先用 `chinaRules: false` 起一份不分流的配置。
 */
export const chinaRuleSets: readonly { tag: string; url: string }[] = [
  { tag: "geosite-cn", url: "https://testingcf.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs" },
  { tag: "geoip-cn", url: "https://testingcf.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs" },
];

/** 内核跑在哪：用户态常驻进程（系统代理模式）或宿主网络助手里的 root 内核（TUN）。 */
export type KernelKind = "daemon" | "tunnel";

/** TUN 下的 DNS：`fakeip`（默认，与 Surge 增强模式相同）或真实 IP。 */
export type DNSMode = "fakeip" | "realip";

/** fake-ip 的地址段：与 Surge、Clash 一系相同，`198.18.0.0/15` 是 RFC 2544 的测试段，不会撞上真实地址。 */
export const fakeIPRanges = { inet4: "198.18.0.0/15", inet6: "fc00::/18" } as const;

/** TUN 下直连解析的默认 DNS（导入的配置里没有 `dns-server` 时）：阿里公共 DNS，大陆网络里最稳的那一个。 */
export const defaultDirectDNS = "223.5.5.5";

/** 代理那一侧的 DoH。 */
export const proxyDNSServer = "1.1.1.1";

/**
 * 默认不给假 IP 的域名（`always-real-ip`，与 Surge 的默认名单同一用意）：局域网名字、NTP、系统联网检测、STUN、Apple 推送与时间——
 * 这些要么拿 IP 本身做事（STUN、推送长连接），要么在代理还没起来之前就要用（时间、联网检测），给假 IP 会坏。
 */
export const defaultRealIPDomains: readonly string[] = [
  "*.lan",
  "*.local",
  "*.localdomain",
  "*.home.arpa",
  "time.*.com",
  "ntp.*.com",
  "*.ntp.org.cn",
  "*.pool.ntp.org",
  "time.apple.com",
  "*.push.apple.com",
  "*.msftconnecttest.com",
  "*.msftncsi.com",
  "stun.*.*",
  "stun.*.*.*",
  "+.stun.*.*",
  "localhost.ptlogin2.qq.com",
];

/** 不进 TUN 的默认路由：局域网三段与运营商级 NAT（Tailscale 也在这一段）。宿主另外必加回环、链路本地与组播。 */
export const defaultExcludeRoutes: readonly string[] = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"];

/** 生成配置要的东西。 */
export interface ConfigOptions {
  /** 节点；至少一个。名字会再去一次重（见 {@link dedupeNodeNames}），调用方最好先自己去好、拿同一份显示。 */
  nodes: readonly ProxyNode[];
  /** `mixed` 入站（HTTP + SOCKS）监听的本机端口。 */
  mixedPort: number;
  /** Clash API 监听的本机端口（`daemon.start` 的 `controlPort`）。 */
  controlPort: number;
  /** Clash API 的 secret（`Authorization: Bearer …`）；不能为空。 */
  controlSecret: string;
  /** 出站模式。 */
  mode: ProxyMode;
  /** 「自动选择」与测速用的地址（偏好「延迟测试地址」）。 */
  testURL: string;
  /** 「节点选择」默认选中谁：节点名或「自动选择」；不是组员时用「自动选择」。 */
  selected?: string;
  /** 是否加中国大陆域名 / IP 直连的远程规则集。关掉时生成的配置不联网下载任何东西（测试用它）。`surge` 有值时不看它：导入的配置自带分流。 */
  chinaRules: boolean;
  /** 跑在哪。省略 = `daemon`（系统代理模式）。 */
  kernel?: KernelKind;
  /** TUN 下的 DNS。省略 = `fakeip`。 */
  dnsMode?: DNSMode;
  /** 页面规则（排在所有规则之前）。 */
  pageRules?: readonly PageRule[];
  /** 导入的 Surge 配置；`null` / 省略 = 不用。 */
  surge?: SurgeImport | null;
  /** 拉回来的外部规则集（tag → 内容）。没拉到的规则集，引用它的规则这一次跳过。 */
  ruleSets?: Readonly<Record<string, ConvertedList>>;
  /** 导入的策略组各选了谁（组名 → 组员 tag）。 */
  groupSelection?: Readonly<Record<string, string>>;
}

/**
 * 导入的策略组在配置里的 tag：就是 Surge 里的名字；撞上节点名或我们自己的组名时加「 · Surge」。界面上显示与点选用的都是这一份。
 * @param surge 导入结果。
 * @param nodes 节点（去过重的）。
 * @returns 组名 → tag。
 */
export function groupTags(surge: Pick<SurgeImport, "groups"> | null | undefined, nodes: readonly ProxyNode[]): Map<string, string> {
  const tags = new Map<string, string>();
  if (!surge) return tags;
  const used = new Set<string>([...reservedTags, ...nodes.map((node) => node.name)]);
  for (const group of surge.groups) {
    let tag = group.name;
    if (used.has(tag)) tag = `${group.name} · Surge`;
    for (let index = 2; used.has(tag); index += 1) tag = `${group.name} · Surge ${index}`;
    used.add(tag);
    tags.set(group.name, tag);
  }
  return tags;
}

/**
 * 一个组员在配置里的 tag。
 * @param member 组员。
 * @param tags 组名 → tag。
 * @returns tag。
 */
export function memberTag(member: GroupMember, tags: ReadonlyMap<string, string>): string {
  switch (member.kind) {
    case "direct":
      return DIRECT_TAG;
    case "auto":
      return URLTEST_TAG;
    case "group":
      return tags.get(member.name) ?? SELECTOR_TAG;
    default:
      return SELECTOR_TAG;
  }
}

/**
 * 不进 TUN 的路由：默认的局域网段 + 导入的 `tun-excluded-routes` / `bypass-tun`，去重、至多 256 条（宿主的上限）。
 * @param surge 导入结果。
 * @returns CIDR。
 */
export function tunnelExcludeRoutes(surge: Pick<SurgeImport, "general"> | null | undefined): string[] {
  const routes = [...defaultExcludeRoutes, ...(surge?.general.tunExcludedRoutes ?? []), ...(surge?.general.bypassTun ?? [])]
    .map((route) => toCIDR(route))
    .filter((route): route is string => route !== null);
  return [...new Set(routes)].slice(0, 256);
}

/**
 * 系统代理的例外：导入的 `skip-proxy`（宿主另外必加 `127.0.0.1`、`::1`、`localhost`、`*.local`、`169.254/16`）。
 * 单独一个 `*` 不要：那等于让所有网站都绕开代理。
 * @param surge 导入结果。
 * @returns 至多 64 条、不带空白。
 */
export function systemProxyBypass(surge: Pick<SurgeImport, "general"> | null | undefined): string[] {
  const entries = (surge?.general.skipProxy ?? []).filter((entry) => entry !== "*" && /^\S{1,253}$/.test(entry));
  return [...new Set(entries)].slice(0, 64);
}

/**
 * 一条路由规则从哪来（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3：窗口「规则」页的「注释」一列）。
 *
 * - `plumbing`：嗅探、DNS 劫持、解析——让后面的规则认得出域名的那几条，不是分流规则，规则页不列；
 * - `lan`：局域网直连；`mode`：出站模式「直连」「全局」；`page`：页面规则；
 * - `surge`：导入的 Surge 规则（`index` 是它在导入结果里排第几，1 起）；`surgeFinal`：导入配置的 `FINAL` 是拒绝时那一条；
 * - `china`：内置「中国大陆直连」那两个规则集。
 */
export type RuleOrigin =
  | { kind: "plumbing" }
  | { kind: "lan" }
  | { kind: "mode"; mode: "direct" | "global" }
  | { kind: "page" }
  | { kind: "surge"; index: number }
  | { kind: "surgeFinal" }
  | { kind: "china" };

/** 一份配置里的路由：规则与它们各自的来历（一一对应）、兜底出站、要下载 / 内联的规则集。 */
export interface RoutePlan {
  rules: Record<string, unknown>[];
  origins: RuleOrigin[];
  /** 兜底出站的 tag。 */
  final: string;
  /** 兜底来自导入的 Surge 配置（`FINAL`）还是默认的「节点选择」。 */
  finalFromSurge: boolean;
  remoteSets: { tag: string; url: string }[];
  inlineSets: Record<string, unknown>[];
}

/**
 * 路由那一段（{@link buildConfig} 与规则页同一份真源：规则页列的就是交给 sing-box 的那几条，顺序与序号一致）。
 * @param options 选项。
 * @returns 路由。
 */
export function routePlan(options: ConfigOptions): RoutePlan {
  const tunnel = options.kernel === "tunnel";
  const surge = options.surge ?? null;
  const tags = groupTags(surge, dedupeNodeNames(options.nodes));
  const rules: Record<string, unknown>[] = [{ action: "sniff" }];
  const origins: RuleOrigin[] = [{ kind: "plumbing" }];
  const push = (origin: RuleOrigin, ...added: Record<string, unknown>[]) => {
    for (const rule of added) {
      rules.push(rule);
      origins.push(origin);
    }
  };
  // TUN：发往 53 的查询由 sing-box 自己答（fake-ip / 分流解析），排在一切规则之前——不然一条「直连」规则会把它原样放出去。
  if (tunnel) push({ kind: "plumbing" }, { protocol: "dns", action: "hijack-dns" });
  push({ kind: "lan" }, { ip_is_private: true, domain_suffix: ["localhost", "local"], action: "route", outbound: DIRECT_TAG });
  push({ kind: "mode", mode: "direct" }, { clash_mode: clashModeNames.direct, action: "route", outbound: DIRECT_TAG });
  push({ kind: "mode", mode: "global" }, { clash_mode: clashModeNames.global, action: "route", outbound: SELECTOR_TAG });
  push({ kind: "page" }, ...compilePageRules(options.pageRules ?? [], tags));

  const remoteSets: { tag: string; url: string }[] = [];
  const inlineSets: Record<string, unknown>[] = [];
  let final = SELECTOR_TAG;
  let finalFromSurge = false;
  if (surge) {
    const compiled = compileSurgeRules(surge.rules, tags, options.ruleSets ?? {});
    compiled.rules.forEach((rule, index) => push(compiled.origins[index] ?? { kind: "plumbing" }, rule));
    for (const tag of compiled.usedRuleSets) inlineSets.push({ type: "inline", tag, rules: options.ruleSets?.[tag]?.rules ?? [] });
    for (const code of surge.geoip) remoteSets.push({ tag: `geoip-${code}`, url: geoipRuleSetURL(code) });
    if (surge.final) {
      finalFromSurge = true;
      if (surge.final.kind === "reject") push({ kind: "surgeFinal" }, ruleFor({}, surge.final, tags));
      else final = outboundOf(surge.final, tags);
    }
  } else if (options.chinaRules) {
    push(
      { kind: "china" },
      { rule_set: "geosite-cn", action: "route", outbound: DIRECT_TAG },
      { rule_set: "geoip-cn", action: "route", outbound: DIRECT_TAG },
    );
    remoteSets.push(...chinaRuleSets);
  }
  return { rules, origins, final, finalFromSurge, remoteSets, inlineSets };
}

/**
 * 生成配置。
 *
 * 规则的顺序（第一条命中即定）：
 * 1. `sniff`——SOCKS 客户端有时交来的是 IP，嗅探 TLS SNI / HTTP Host 补出域名，后面的域名规则才有东西可比；
 * 2. （TUN）DNS 劫持；
 * 3. 私有地址与 `localhost` / `.local` 直连——放在模式规则之前：「全局」也不该把局域网流量送出国；
 * 4. `clash_mode` 直连 / 全局；
 * 5. 页面规则——用户亲手给一个网站定的，最具体，排在一切导入与内置规则之前；
 * 6. 导入的 Surge 规则（有导入时），否则（`chinaRules`）`geosite-cn` 直连、`geoip-cn` 直连；
 * 7. 其余（`route.final`）走导入配置的 `FINAL`，没有则「节点选择」。
 *
 * 内置的 `geoip-cn` **只比对本来就是 IP 的目标**，不为它先把域名解析一遍（不加 `resolve` 动作）：系统代理模式下交来的几乎都是域名，
 * 为了比 IP 而先查本机 DNS，会让每一个走代理的网站都先向本地 DNS 泄露一次域名、多等一个 DNS 往返，还会拿到被污染的答案。
 * 大陆网站由 `geosite-cn` 按域名认出；漏网的那些走代理也照样打得开，只是绕了路。
 * @param options 见 {@link ConfigOptions}。
 * @returns sing-box 配置对象。
 * @throws 没有节点、端口不合法或相同、secret 为空、测速地址不是 http(s) 时抛 `Error`（中文说明）——这些是调用方的错，不是订阅的。
 */
export function buildConfig(options: ConfigOptions): Record<string, unknown> {
  validate(options);
  const tunnel = options.kernel === "tunnel";
  const fakeIP = tunnel && (options.dnsMode ?? "fakeip") === "fakeip";
  const surge = options.surge ?? null;
  const nodes = dedupeNodeNames(options.nodes);
  const names = nodes.map((node) => node.name);
  const members = [URLTEST_TAG, ...names];
  const selected = options.selected !== undefined && members.includes(options.selected) ? options.selected : URLTEST_TAG;
  const tags = groupTags(surge, nodes);
  const directDNS = tunnel ? "dns-direct" : LOCAL_DNS_TAG;

  const plan = routePlan(options);
  const { rules, remoteSets, inlineSets, final } = plan;

  const route: Record<string, unknown> = {
    rules,
    final,
    default_domain_resolver: directDNS,
    // 按进程分流（导入的 PROCESS-NAME）与「当前页面」认浏览器的连接都要它；系统代理模式下对本机连进来的连接同样查得到（实测）。
    find_process: true,
  };
  // macOS 上出站必须绑物理网卡，否则节点的流量绕回 TUN 自己（宿主也会强制写上，这里写明是为了配置本身读得懂）。
  if (tunnel) route.auto_detect_interface = true;

  const groupOutbounds = (surge?.groups ?? []).map((group) => {
    const tag = tags.get(group.name) ?? group.name;
    const outbounds = [...new Set(group.members.map((member) => memberTag(member, tags)))].filter((member) => member !== tag);
    const chosen = options.groupSelection?.[group.name];
    return {
      type: "selector",
      tag,
      outbounds,
      default: chosen !== undefined && outbounds.includes(chosen) ? chosen : outbounds[0],
      interrupt_exist_connections: true,
    };
  });

  const config: Record<string, unknown> = {
    log: { level: "info", timestamp: true },
    dns: buildDNS({ tunnel, fakeIP, surge, chinaRules: !surge && options.chinaRules }),
    inbounds: [{ type: "mixed", tag: MIXED_INBOUND_TAG, listen: "127.0.0.1", listen_port: options.mixedPort }],
    outbounds: [
      {
        type: "selector",
        tag: SELECTOR_TAG,
        outbounds: members,
        default: selected,
        // 手动换节点多半是因为当前这个慢了或断了；不打断旧连接的话，开着的页面与长连接还挂在坏节点上，「切了没用」。
        interrupt_exist_connections: true,
      },
      // 自动切换不打断：它是在后台按延迟挑，挑中更快的那个不代表旧的那条连接已经坏了。
      { type: "urltest", tag: URLTEST_TAG, outbounds: names, url: options.testURL },
      ...groupOutbounds,
      ...nodes.map((node) => ({ type: node.outbound.type, tag: node.name, ...cloneOutbound(node.outbound) })),
      { type: "direct", tag: DIRECT_TAG },
    ],
    route,
    experimental: {
      // 相对路径：sing-box 以 `-D <工作目录>` 启动，`cache.db` 落在宿主给的那个目录里（TUN 下是网络助手的 root 目录，宿主的守卫不许写 path）。
      // 它记住「节点选择」选中的节点、当前出站模式与下载过的规则集——下次启动时这三样**以它为准**，
      // `selector.default` 与 `default_mode` 只在第一次（或缓存里的值不再是组员 / 模式）时生效。TUN 下还记着假 IP 的映射：
      // 重载、重启之后应用手里缓存着的 198.18.x.x 仍然认得回域名。
      cache_file: fakeIP ? { enabled: true, store_fakeip: true } : { enabled: true },
      clash_api: {
        external_controller: `127.0.0.1:${options.controlPort}`,
        secret: options.controlSecret,
        default_mode: clashModeNames[options.mode],
      },
    },
  };

  if (remoteSets.length > 0 || inlineSets.length > 0) {
    route.rule_set = [
      ...remoteSets.map((set) => ({ type: "remote", tag: set.tag, format: "binary", url: set.url })),
      ...inlineSets,
    ];
  }
  if (remoteSets.length > 0) {
    // 1.14 起 `download_detour` 弃用，「不写就走默认出站」的隐式 HTTP 客户端也弃用（1.16 删除），必须显式声明 `http_clients`。
    // 这个客户端**不写 `detour`** = 用 sing-box 自己的默认拨号器直连：
    // - 不走「节点选择」：规则集是启动的前提，节点不通时它也得下得下来，否则代理整个起不来；
    // - 不写 `detour: "direct"`：sing-box 会以「detour to an empty direct outbound makes no sense」拒绝它（`common/dialer/detour.go`），
    //   而且这个错只在真正下载时才报，`sing-box check` 查不出来。
    config.http_clients = [{ tag: RULE_SET_HTTP_CLIENT_TAG }];
    route.default_http_client = RULE_SET_HTTP_CLIENT_TAG;
  }
  return config;
}

/**
 * 一个国家的 GEOIP 规则集地址（与中国大陆分流同一个仓库、同一个镜像）。
 * @param code 小写国家码。
 * @returns 地址。
 */
export function geoipRuleSetURL(code: string): string {
  return `https://testingcf.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-${code}.srs`;
}

/** 一个策略落到哪个出站（拒绝不在这里：它是一个动作，不是出站）。 */
function outboundOf(policy: Exclude<Policy, { kind: "reject" }>, tags: ReadonlyMap<string, string>): string {
  return policy.kind === "direct" ? DIRECT_TAG : (tags.get(policy.name) ?? SELECTOR_TAG);
}

/** 匹配 + 策略 → 一条路由规则。 */
function ruleFor(match: Record<string, unknown>, policy: Policy, tags: ReadonlyMap<string, string>): Record<string, unknown> {
  if (policy.kind === "reject") return policy.drop ? { ...match, action: "reject", method: "drop" } : { ...match, action: "reject" };
  return { ...match, action: "route", outbound: outboundOf(policy, tags) };
}

/** 页面规则的策略 → Surge 那一套策略（组不在了退回「节点选择」）。 */
function pagePolicy(policy: PolicyRef): Policy {
  if (policy === "direct") return { kind: "direct" };
  if (policy === "reject") return { kind: "reject", drop: false };
  if (policy === "proxy") return { kind: "group", name: SELECTOR_TAG };
  return { kind: "group", name: policy.slice("group:".length) };
}

/**
 * 页面规则 → 路由规则：相邻、同策略的并成一条（`domain` 与 `domain_suffix` 在一条规则里是「或」）。
 * @param rules 页面规则（新加的在前）。
 * @param tags 组名 → tag。
 * @returns 路由规则。
 */
export function compilePageRules(rules: readonly PageRule[], tags: ReadonlyMap<string, string>): Record<string, unknown>[] {
  const out: { policy: PolicyRef; match: { domain: string[]; domain_suffix: string[] } }[] = [];
  for (const rule of rules) {
    const last = out[out.length - 1];
    const entry = last && last.policy === rule.policy ? last : { policy: rule.policy, match: { domain: [], domain_suffix: [] } };
    if (entry !== last) out.push(entry);
    entry.match[rule.kind].push(rule.value);
  }
  const groupTagsWithSelector = new Map(tags);
  groupTagsWithSelector.set(SELECTOR_TAG, SELECTOR_TAG);
  return out.map((entry) => {
    const match: Record<string, unknown> = {};
    if (entry.match.domain.length > 0) match.domain = entry.match.domain;
    if (entry.match.domain_suffix.length > 0) match.domain_suffix = entry.match.domain_suffix;
    return ruleFor(match, pagePolicy(entry.policy), groupTagsWithSelector);
  });
}

/**
 * 导入的 Surge 规则 → 路由规则。第一条要解析的规则（不带 `no-resolve` 的 IP 类、含 IP 的外部规则集）之前插一条 `resolve`。
 * 引用了还没拉到的外部规则集的规则跳过。
 * @param rules 导入的规则。
 * @param tags 组名 → tag。
 * @param ruleSets 拉到了的外部规则集。
 * @returns 路由规则与用到的规则集 tag。
 */
export function compileSurgeRules(
  rules: readonly ImportedRule[],
  tags: ReadonlyMap<string, string>,
  ruleSets: Readonly<Record<string, ConvertedList>>,
): { rules: Record<string, unknown>[]; usedRuleSets: string[]; origins: RuleOrigin[]; count: number } {
  const out: Record<string, unknown>[] = [];
  const origins: RuleOrigin[] = [];
  const used: string[] = [];
  let resolved = false;
  for (const [position, rule] of rules.entries()) {
    let match: Record<string, unknown>;
    let resolve: boolean;
    if (rule.kind === "ruleSet") {
      const content = ruleSets[rule.tag];
      if (!content || content.rules.length === 0) continue;
      match = { rule_set: [rule.tag] };
      resolve = content.hasIP && !rule.noResolve;
      if (!used.includes(rule.tag)) used.push(rule.tag);
    } else {
      match = rule.match;
      resolve = rule.resolve;
    }
    if (resolve && !resolved) {
      out.push({ action: "resolve" });
      origins.push({ kind: "plumbing" });
      resolved = true;
    }
    out.push(ruleFor(match, rule.policy, tags));
    origins.push({ kind: "surge", index: position + 1 });
  }
  return { rules: out, usedRuleSets: used, origins, count: rules.length };
}

/**
 * 一条 `always-real-ip` 写法 → DNS 规则的匹配字段：`*.x` 是后缀、`+.x` 同样当后缀、别处有 `*` 的写成正则、其余是完整域名。
 * @param patterns 写法。
 * @returns 匹配字段；一个都没有为 `null`。
 */
export function realIPMatch(patterns: readonly string[]): Record<string, string[]> | null {
  const domain: string[] = [];
  const suffix: string[] = [];
  const regex: string[] = [];
  for (const raw of patterns) {
    const pattern = raw.trim().toLowerCase();
    if (!pattern || pattern === "*") continue;
    const plain = /^(?:\*|\+)\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(pattern);
    if (plain) suffix.push(plain[1]);
    else if (/[*?+]/.test(pattern)) regex.push(`^${pattern.replace(/^\+\./, "*.").replace(/[.^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+").replace(/\?/g, ".")}$`);
    else domain.push(pattern);
  }
  const match: Record<string, string[]> = {};
  if (domain.length > 0) match.domain = [...new Set(domain)];
  if (suffix.length > 0) match.domain_suffix = [...new Set(suffix)];
  if (regex.length > 0) match.domain_regex = [...new Set(regex)];
  return Object.keys(match).length > 0 ? match : null;
}

/** DNS 段。 */
function buildDNS(input: { tunnel: boolean; fakeIP: boolean; surge: SurgeImport | null; chinaRules: boolean }): Record<string, unknown> {
  const servers: Record<string, unknown>[] = [];
  const rules: Record<string, unknown>[] = [];
  const surge = input.surge;
  const hostAddresses = (surge?.hosts ?? []).filter((entry): entry is Extract<typeof entry, { kind: "address" }> => entry.kind === "address");
  const hostServers = (surge?.hosts ?? []).filter((entry): entry is Extract<typeof entry, { kind: "server" }> => entry.kind === "server");
  if (!input.tunnel) {
    servers.push({ type: "local", tag: LOCAL_DNS_TAG });
  } else {
    const upstream = surge?.general.dnsServers.find((server) => server !== "system") ?? defaultDirectDNS;
    servers.push({ type: "udp", tag: "dns-direct", server: upstream });
    servers.push({ type: "https", tag: "dns-proxy", server: proxyDNSServer, detour: SELECTOR_TAG });
    if (input.fakeIP) servers.push({ type: "fakeip", tag: "dns-fakeip", inet4_range: fakeIPRanges.inet4, inet6_range: fakeIPRanges.inet6 });
  }
  if (hostAddresses.length > 0) {
    const predefined: Record<string, string[]> = {};
    for (const entry of hostAddresses) predefined[entry.domain] = entry.addresses;
    servers.push({ type: "hosts", tag: "dns-hosts", predefined });
    rules.push({ domain: hostAddresses.map((entry) => entry.domain), action: "route", server: "dns-hosts" });
  }
  const perServer = new Map<string, string[]>();
  for (const entry of hostServers) perServer.set(entry.server, [...(perServer.get(entry.server) ?? []), entry.domain]);
  let index = 0;
  for (const [server, domains] of perServer) {
    index += 1;
    servers.push({ type: "udp", tag: `dns-host-${index}`, server });
    rules.push({ domain: domains, action: "route", server: `dns-host-${index}` });
  }
  const dns: Record<string, unknown> = { servers };
  if (input.tunnel) {
    const realIP = realIPMatch([...defaultRealIPDomains, ...(surge?.general.alwaysRealIP ?? [])]);
    if (realIP) rules.push({ ...realIP, action: "route", server: "dns-direct" });
    rules.push({ clash_mode: clashModeNames.direct, action: "route", server: "dns-direct" });
    if (input.chinaRules) rules.push({ rule_set: "geosite-cn", action: "route", server: "dns-direct" });
    if (input.fakeIP) rules.push({ query_type: ["A", "AAAA"], action: "route", server: "dns-fakeip" });
    dns.final = "dns-proxy";
    if (surge?.general.ipv6 === false) dns.strategy = "ipv4_only";
  }
  if (rules.length > 0) dns.rules = rules;
  return dns;
}

/**
 * 给命令行工具的一条 `export`：它们不读系统代理，只认这几个环境变量。
 * `all_proxy` 用 SOCKS5：git、ssh（经 nc）等不说 HTTP 的工具认它；`mixed` 入站同一个端口两种协议都接。
 * @param mixedPort `mixed` 入站端口。
 * @returns 一行 shell 命令。
 */
export function terminalProxyCommand(mixedPort: number): string {
  const http = `http://127.0.0.1:${mixedPort}`;
  return `export https_proxy=${http} http_proxy=${http} all_proxy=socks5://127.0.0.1:${mixedPort}`;
}

/**
 * 出站深拷贝一份：配置要被 `JSON.stringify`，调用方手里的节点不能被改到；拷贝里的 `tag` 去掉，由调用方写节点名。
 * @param outbound 节点的出站。
 * @returns 拷贝。
 */
function cloneOutbound(outbound: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(outbound)) as Record<string, unknown>;
  delete copy.tag;
  return copy;
}

/**
 * 校验调用方给的选项。
 * @param options 选项。
 * @throws 不合法时抛 `Error`。
 */
function validate(options: ConfigOptions): void {
  if (options.nodes.length === 0) throw new Error("没有可用的节点：先更新订阅");
  for (const [label, port] of [
    ["本地端口", options.mixedPort],
    ["控制端口", options.controlPort],
  ] as const) {
    // 1024 以下要 root；sing-box 以用户身份运行，监听不了。
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`${label}必须是 1024–65535 之间的整数：${port}`);
  }
  if (options.mixedPort === options.controlPort) throw new Error(`本地端口与控制端口不能相同：${options.mixedPort}`);
  if (options.controlSecret.length === 0) throw new Error("控制口的 secret 不能为空");
  if (!/^https?:\/\/\S+$/i.test(options.testURL)) throw new Error(`延迟测试地址必须是 http(s) 地址：${options.testURL}`);
  if (!Object.prototype.hasOwnProperty.call(clashModeNames, options.mode)) throw new Error(`不认识的出站模式：${options.mode}`);
}
