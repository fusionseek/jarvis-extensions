/**
 * 生成 sing-box 1.14 配置：**系统代理模式**（不开 TUN，P-12 才做），P-9「生成的 sing-box 配置」。
 *
 * 系统代理模式的形状决定了下面几乎每一个选择：应用把**域名**交给我们的 `mixed` 入站（HTTP CONNECT / SOCKS），
 * DNS 不经过 sing-box。于是：
 *
 * - 走代理的连接由远端解析域名，本机一次 DNS 都不用查；
 * - 本机 DNS 只用在三处——解析节点服务器的域名、直连出去的域名、下载规则集的那个 CDN。这三处都**必须**直连解析
 *   （代理还没通的时候就得先解析节点），所以只配一个 `local` 服务器（系统解析器）：它跟着用户当前的网络走
 *   （公司内网的 DNS、DHCP 下发的 DNS），也不依赖任何一家公共 DNS 在当前网络里可达。
 *
 * 纯数据，不碰宿主：返回一个普通对象，调用方 `JSON.stringify` 之后交给 `daemon.start`。
 * 字段名逐个对过 sing-box 1.14 文档与源码（`option/*.go`），并在本机 `sing-box check`（1.14.4）上验过无错误、无弃用警告。
 */
import { DIRECT_TAG, SELECTOR_TAG, URLTEST_TAG, dedupeNodeNames, type ProxyNode } from "./nodes.js";

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
  /** 是否加中国大陆域名 / IP 直连的远程规则集。关掉时生成的配置不联网下载任何东西（测试用它）。 */
  chinaRules: boolean;
}

/**
 * 生成配置。
 *
 * 规则的顺序（第一条命中即定）：
 * 1. `sniff`——SOCKS 客户端有时交来的是 IP，嗅探 TLS SNI / HTTP Host 补出域名，后面的域名规则才有东西可比；
 * 2. 私有地址与 `localhost` / `.local` 直连——放在模式规则之前：「全局」也不该把局域网流量送出国；
 * 3. `clash_mode` 直连 / 全局；
 * 4. （`chinaRules`）`geosite-cn` 直连、`geoip-cn` 直连；
 * 5. 其余（`route.final`）走「节点选择」。
 *
 * `geoip-cn` **只比对本来就是 IP 的目标**，不为它先把域名解析一遍（不加 `resolve` 动作）：系统代理模式下交来的几乎都是域名，
 * 为了比 IP 而先查本机 DNS，会让每一个走代理的网站都先向本地 DNS 泄露一次域名、多等一个 DNS 往返，还会拿到被污染的答案。
 * 大陆网站由 `geosite-cn` 按域名认出；漏网的那些走代理也照样打得开，只是绕了路。
 * @param options 见 {@link ConfigOptions}。
 * @returns sing-box 配置对象。
 * @throws 没有节点、端口不合法或相同、secret 为空、测速地址不是 http(s) 时抛 `Error`（中文说明）——这些是调用方的错，不是订阅的。
 */
export function buildConfig(options: ConfigOptions): Record<string, unknown> {
  validate(options);
  const nodes = dedupeNodeNames(options.nodes);
  const names = nodes.map((node) => node.name);
  const members = [URLTEST_TAG, ...names];
  const selected = options.selected !== undefined && members.includes(options.selected) ? options.selected : URLTEST_TAG;

  const rules: Record<string, unknown>[] = [
    { action: "sniff" },
    { ip_is_private: true, domain_suffix: ["localhost", "local"], action: "route", outbound: DIRECT_TAG },
    { clash_mode: clashModeNames.direct, action: "route", outbound: DIRECT_TAG },
    { clash_mode: clashModeNames.global, action: "route", outbound: SELECTOR_TAG },
  ];
  const route: Record<string, unknown> = {
    rules,
    final: SELECTOR_TAG,
    default_domain_resolver: LOCAL_DNS_TAG,
  };
  const config: Record<string, unknown> = {
    log: { level: "info", timestamp: true },
    dns: {
      servers: [{ type: "local", tag: LOCAL_DNS_TAG }],
    },
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
      ...nodes.map((node) => ({ type: node.outbound.type, tag: node.name, ...cloneOutbound(node.outbound) })),
      { type: "direct", tag: DIRECT_TAG },
    ],
    route,
    experimental: {
      // 相对路径：sing-box 以 `-D <工作目录>` 启动，`cache.db` 落在宿主给的那个目录里。
      // 它记住「节点选择」选中的节点、当前出站模式与下载过的规则集——下次启动时这三样**以它为准**，
      // `selector.default` 与 `default_mode` 只在第一次（或缓存里的值不再是组员 / 模式）时生效。
      cache_file: { enabled: true },
      clash_api: {
        external_controller: `127.0.0.1:${options.controlPort}`,
        secret: options.controlSecret,
        default_mode: clashModeNames[options.mode],
      },
    },
  };

  if (options.chinaRules) {
    rules.push(
      { rule_set: "geosite-cn", action: "route", outbound: DIRECT_TAG },
      { rule_set: "geoip-cn", action: "route", outbound: DIRECT_TAG },
    );
    route.rule_set = chinaRuleSets.map((set) => ({ type: "remote", tag: set.tag, format: "binary", url: set.url }));
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
