/**
 * 「代理」的动作：开、关、切模式、切节点、测速、更新订阅、读流量、增强模式、策略组、页面规则、导入 Surge 配置——
 * 前台页面与后台会话（菜单栏、指令）共用这一份。
 *
 * 内核有两种（jarvis-mac `specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-7）：系统代理模式跑用户态常驻进程（`jarvis.daemon`），
 * 增强模式跑宿主网络助手里的 root 内核（`jarvis.tunnel`）。两者都是同一个 sing-box、同一套 Clash API；切节点、测速、读连接只经 {@link ProxyCore.clash}，
 * 它按存储里记着的那一个内核发请求，上层不分是哪一种。同一时刻只跑一个：两个都要监听同一个本地端口。
 *
 * 两个会话各有一个 `ProxyCore`，内存互不相通（P-7）。所以这里**不把任何要跨会话看到的东西只放在内存里**：
 * 常驻进程与系统代理每次现问宿主（`daemon.status`、`systemProxy.status`），其余（节点、选择、延迟、控制口 secret、失败）
 * 一律落 `jarvis.storage`，另一个会话下一次读就看得见。内存里只留「这个会话正在做什么」（`busy`）与刚测出、还没落盘的延迟。
 */
import {
  jarvis,
  sleep,
  type BrowserActiveTab,
  type DaemonResponse,
  type DaemonStatus,
  type SystemProxyStatus,
  type TunnelStatus,
} from "@fusionseek/jarvis-extension-sdk";
import {
  DAEMON_ID,
  delayConcurrency,
  delayPath,
  parseConnections,
  parseDelay,
  parseGroupNow,
  proxyPath,
  randomSecret,
  runLimited,
  type ConnectionsSnapshot,
} from "./clash.js";
import { dedupeNodeNames, DIRECT_TAG, SELECTOR_TAG, URLTEST_TAG, type ProxyNode } from "./nodes.js";
import { normalizePageRules, pageDomains, removePageRule, upsertPageRule, urlHost, type PageRule, type PolicyRef, type SeenConnection } from "./rules.js";
import {
  buildConfig,
  clashModeNames,
  groupTags,
  memberTag,
  systemProxyBypass,
  terminalProxyCommand,
  tunnelExcludeRoutes,
  type ConfigOptions,
  type KernelKind,
  type ProxyMode,
  routePlan,
  type RoutePlan,
} from "./singbox-config.js";
import {
  describeFailure,
  isPortConflict,
  isRuleSetFailure,
  memberTitle,
  normalizePreferences,
  normalizeSelection,
  phaseOf,
  requiredCapability,
  runningKernel,
  wantsTunnel,
  type FailureRecord,
  type GroupView,
  type PageView,
  type Phase,
  type ProxyPreferences,
  type Selection,
  type TunCondition,
} from "./status.js";
import { convertSurgeList, convertSurgeProfile, convertedCount, type ConvertedList, type SurgeImport } from "./surge.js";
import {
  chunkItems,
  chunkNodes,
  digest,
  ruleSetChunkKey,
  splitHeadlessRules,
  surgeRuleChunkKey,
  type RuleSetRecord,
  type StoredSurge,
  headerValue,
  nextRecord,
  nodeChunkKey,
  nodesDigest,
  parseSubscriptionUserinfo,
  storageKeys,
  subscriptionId,
  type TunSwitch,
  type ControlRecord,
  type FetchOutcome,
  type LatencyRecord,
  type Schedule,
  type SubscriptionRecord,
} from "./store.js";
import { parseSubscription } from "./subscription.js";

/** manifest `process.terminal` 里那段脚本的 id：装过就升级，没装就装。 */
export const INSTALL_SCRIPT_ID = "install";

/**
 * 拉订阅时的 User-Agent。机场面板（V2Board / Xboard 一系）按 UA 里有没有 `sing-box` 决定回什么格式：
 * 带上它，回来的要么是本扩展认得的分享链接，要么是 sing-box 自己的 JSON——而不是 Clash YAML（本期不认）。
 */
export const SUBSCRIPTION_USER_AGENT = "sing-box 1.14.4 (Jarvis)";

/** 停掉自己的内核之后等多久再起：sing-box 收到 SIGTERM 关监听、宿主收进程都要一点时间。 */
const portReleaseMs = 500;

/** 等内核就绪（Clash API 开始答话）至多多久。远程规则集第一次下载就在这段时间里，30 秒足够慢网络把两份几十 KB 的文件拉完。 */
const readyTimeoutMs = 30_000;

/** 控制口请求的默认超时（秒）。 */
const requestTimeoutSeconds = 10;

/** 全部能力：页面上「授权」一次问完。 */
export const allCapabilities = [
  "process.daemon",
  "system.proxy",
  "network.tunnel",
  "network.https",
  "terminal.run",
  "notifications.post",
  "clipboard.write",
  "browser.activeTab",
  "files.pick",
] as const;

/** 增强模式要的能力。 */
export const tunnelCapability = "network.tunnel";

/** 一次读到的全部事实。 */
export interface Snapshot {
  granted: string[];
  preferences: ProxyPreferences;
  daemon: DaemonStatus | null;
  /** `tunnel.status`（授权了增强模式才问）；没授权、读不出为 `null`。 */
  tunnel: TunnelStatus | null;
  /** 在跑的内核；没在跑为 `null`。 */
  kernel: KernelKind | null;
  /** 增强模式此刻的状况（菜单那一项与面板那一行）。 */
  tun: TunCondition;
  proxy: SystemProxyStatus | null;
  nodes: ProxyNode[];
  subscriptions: SubscriptionRecord[];
  /** 偏好里填了几条订阅地址。 */
  subscriptionCount: number;
  /** 已经按节点列表校正过：选中的节点不在了就是「自动选择」。 */
  selection: Selection;
  latency: LatencyRecord;
  control: ControlRecord | null;
  failure: FailureRecord | null;
  phase: Phase;
  pageRules: PageRule[];
  /** 导入的 Surge 配置（规则另外存）；没导入为 `null`。 */
  surge: StoredSurge | null;
  /** 导入配置里那些外部规则集拉没拉到。 */
  ruleSetRecords: RuleSetRecord[];
  /** 偏好「规则集地址」里填了哪些。 */
  ruleSetURLs: string[];
  /** 导入的策略组（`useSurgeRules` 关着时为空）。 */
  groups: GroupView[];
  /** 此刻的规则摘要：与 `control.rulesDigest` 不同 = 重新载入才用得上。 */
  rulesDigest: string;
}

/** 一个动作的结果：给页面的那一行提示与静默指令的横幅。 */
export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * 一段给人看的错误说明。
 * @param error 抛出的东西。
 * @returns 一句话。
 */
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}

/**
 * 错误里带的内核输出（`daemon.start` 失败时 `detail` 是最后 20 行）。
 * @param error 抛出的东西。
 * @returns 行；没有时是错误本身那一句。
 */
export function errorLines(error: unknown): string[] {
  const detail = typeof error === "object" && error !== null && "detail" in error ? (error as { detail?: unknown }).detail : undefined;
  const text = typeof detail === "string" && detail.trim().length > 0 ? detail : errorMessage(error);
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

/**
 * 读一个存储键；读不出（没有、宿主拒绝）为 `undefined`。
 * @param key 键。
 * @returns 值。
 */
async function read<T>(key: string): Promise<T | undefined> {
  try {
    return await jarvis.storage.get<T>(key);
  } catch {
    return undefined;
  }
}

/**
 * 写一个存储键；写不进去只记日志——存储坏了不该让代理开不了。
 * @param key 键。
 * @param value 值。
 */
async function write(key: string, value: unknown): Promise<void> {
  try {
    await jarvis.storage.set(key, value);
  } catch (error) {
    jarvis.log.warn(`存储写不进去：${key}`, errorMessage(error));
  }
}

/**
 * 删一个存储键。
 * @param key 键。
 */
async function remove(key: string): Promise<void> {
  try {
    await jarvis.storage.delete(key);
  } catch {
    // 删不掉的旧块只是占地方：读的时候按记录里的块数读，不会读到它。
  }
}

/** 一份配置要的、与节点无关的那几样（规则、导入、规则集、策略组选择），以及它们的摘要。 */
interface RuleInputs {
  pageRules: PageRule[];
  surge: SurgeImport | null;
  ruleSets: Record<string, ConvertedList>;
  digest: string;
}

export class ProxyCore {
  /** 这个会话正在做的事；`null` = 闲着。 */
  busy: string | null = null;
  /** 本会话刚测出、已经交给界面但可能还没落盘的延迟。 */
  private pendingLatency: Record<string, number | null> = {};

  /**
   * @param changed 状态变了（忙闲、测出一个延迟）时调用：页面重画、菜单栏重推。
   */
  constructor(private readonly changed: () => void) {}

  private setBusy(busy: string | null): void {
    this.busy = busy;
    this.changed();
  }

  /** 此刻已授予的能力（每次现问：授权会在设置里被撤销）。 */
  async granted(): Promise<string[]> {
    try {
      return await jarvis.permissions.granted();
    } catch {
      return [];
    }
  }

  /**
   * 偏好。
   * @param raw 事件里带来的偏好；省略时现问宿主。
   * @returns 完整、合法的一份。
   */
  async preferences(raw?: Record<string, unknown>): Promise<ProxyPreferences> {
    if (raw) return normalizePreferences(raw);
    try {
      return normalizePreferences(await jarvis.preferences.all());
    } catch {
      return normalizePreferences({});
    }
  }

  /**
   * 一项 `urlList` 偏好此刻的地址（进钥匙串的只能单独读，交回数组；不进的可能是数组或 JSON 串）。
   * @param key 偏好的 key。
   * @returns 去掉空白的 https 地址。
   */
  private async urlList(key: string): Promise<string[]> {
    try {
      let value = await jarvis.preferences.get<unknown>(key);
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          value = [];
        }
      }
      return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string" && /^https:\/\//i.test(url.trim())).map((url) => url.trim()) : [];
    } catch {
      return [];
    }
  }

  /** 偏好里的订阅地址（进钥匙串的 `urlList`，只能单独读）。 */
  subscriptionURLs(): Promise<string[]> {
    return this.urlList("subscriptions");
  }

  /** 偏好「规则集地址」里的地址：导入的配置里 `RULE-SET` 的地址，用户亲手贴进来的才去拉（宿主只放行这些主机）。 */
  ruleSetURLs(): Promise<string[]> {
    return this.urlList("ruleSets");
  }

  /** 订阅记录。 */
  async records(): Promise<SubscriptionRecord[]> {
    const value = await read<SubscriptionRecord[]>(storageKeys.subscriptions);
    return Array.isArray(value) ? value : [];
  }

  /**
   * 全部节点：按订阅在偏好里的顺序拼起来、再去一次重（两家机场都有「香港 01」是常事）。界面显示的与配置里的 tag 是同一份名字。
   * @param records 订阅记录；省略时现读。
   * @returns 节点。
   */
  async nodes(records?: SubscriptionRecord[]): Promise<ProxyNode[]> {
    const list = records ?? (await this.records());
    const all: ProxyNode[] = [];
    for (const record of [...list].sort((a, b) => a.position - b.position)) {
      for (let index = 0; index < record.chunks; index += 1) {
        const chunk = await read<ProxyNode[]>(nodeChunkKey(record.id, index));
        if (Array.isArray(chunk)) all.push(...chunk);
      }
    }
    return dedupeNodeNames(all);
  }

  /** 用户选的模式、节点、增强模式与策略组（未按节点列表校正）。 */
  async selection(): Promise<Selection> {
    return normalizeSelection(await read(storageKeys.selection));
  }

  /** 最近一次测速，叠上本会话刚测出的。 */
  async latency(): Promise<LatencyRecord> {
    const stored = await read<LatencyRecord>(storageKeys.latency);
    const values = stored && typeof stored.values === "object" && stored.values !== null ? stored.values : {};
    return { values: { ...values, ...this.pendingLatency }, testedAt: stored?.testedAt ?? null };
  }

  /** 此刻在跑的那一份的控制口记录。 */
  async control(): Promise<ControlRecord | null> {
    const value = await read<ControlRecord>(storageKeys.control);
    return value && typeof value.secret === "string" ? value : null;
  }

  /** 页面规则。 */
  async pageRules(): Promise<PageRule[]> {
    return normalizePageRules(await read(storageKeys.pageRules));
  }

  /** 导入的 Surge 配置（不含规则）。 */
  async storedSurge(): Promise<StoredSurge | null> {
    const value = await read<StoredSurge>(storageKeys.surge);
    return value && value.version === 1 ? value : null;
  }

  /** 导入的 Surge 配置（含规则）；没导入为 `null`。 */
  async surgeImport(): Promise<SurgeImport | null> {
    const stored = await this.storedSurge();
    if (!stored) return null;
    const rules: SurgeImport["rules"] = [];
    for (let index = 0; index < stored.ruleChunks; index += 1) {
      const chunk = await read<SurgeImport["rules"]>(surgeRuleChunkKey(index));
      if (Array.isArray(chunk)) rules.push(...chunk);
    }
    const { ruleChunks: _chunks, ...rest } = stored;
    return { ...rest, rules };
  }

  /** 外部规则集的记录。 */
  async ruleSetRecords(): Promise<RuleSetRecord[]> {
    const value = await read<Record<string, RuleSetRecord>>(storageKeys.ruleSets);
    return value && typeof value === "object" ? Object.values(value) : [];
  }

  /** 拉到了的外部规则集的内容。 */
  async ruleSetContents(records?: RuleSetRecord[]): Promise<Record<string, ConvertedList>> {
    const out: Record<string, ConvertedList> = {};
    for (const record of records ?? (await this.ruleSetRecords())) {
      if (record.chunks === 0) continue;
      const rules: ConvertedList["rules"] = [];
      for (let index = 0; index < record.chunks; index += 1) {
        const chunk = await read<ConvertedList["rules"]>(ruleSetChunkKey(record.tag, index));
        if (Array.isArray(chunk)) rules.push(...chunk);
      }
      out[record.tag] = { rules, hasIP: record.hasIP, total: record.total, skipped: record.skipped };
    }
    return out;
  }

  /**
   * 一份配置里与节点无关的输入，与它们的摘要。
   * @param preferences 偏好。
   * @returns 输入。
   */
  private async ruleInputs(preferences: ProxyPreferences): Promise<RuleInputs> {
    const pageRules = await this.pageRules();
    const surge = preferences.useSurgeRules ? await this.surgeImport() : null;
    const ruleSets = surge ? await this.ruleSetContents() : {};
    const digestText = JSON.stringify({ pageRules: pageRules.map((rule) => [rule.id, rule.policy]), surge: surge ? [surge.importedAt, surge.sourceName] : null, sets: Object.keys(ruleSets).map((tag) => [tag, ruleSets[tag].total]), dns: preferences.dnsMode, stack: preferences.tunStack });
    return { pageRules, surge, ruleSets, digest: digest(digestText) };
  }

  /**
   * 导入的策略组（菜单与面板画它）。
   * @param surge 导入结果（不含规则也行）。
   * @param nodes 节点。
   * @param selection 选择。
   * @returns 组。
   */
  groupViews(surge: Pick<SurgeImport, "groups"> | null, nodes: readonly ProxyNode[], selection: Selection): GroupView[] {
    if (!surge) return [];
    const tags = groupTags(surge, nodes);
    return surge.groups.map((group) => {
      const tag = tags.get(group.name) ?? group.name;
      const members = [...new Set(group.members.map((member) => memberTag(member, tags)))].filter((member) => member !== tag).map((member) => ({ tag: member, title: memberTitle(member) }));
      const chosen = selection.groups[group.name];
      return { name: group.name, tag, members, selected: chosen && members.some((member) => member.tag === chosen) ? chosen : (members[0]?.tag ?? SELECTOR_TAG) };
    });
  }

  /**
   * 读全部事实。
   * @param context 事件里带来的授权与偏好（菜单栏、指令）；省略时现问。
   * @returns 快照。
   */
  async snapshot(context: { granted?: string[]; preferences?: Record<string, unknown> } = {}): Promise<Snapshot> {
    const granted = context.granted ?? (await this.granted());
    const preferences = await this.preferences(context.preferences);
    const records = await this.records();
    const [nodes, selection, latency, control, failure, subscriptionCount, pageRules, storedSurge, ruleSetRecords, ruleSetURLs, rules] = await Promise.all([
      this.nodes(records),
      this.selection(),
      this.latency(),
      this.control(),
      read<FailureRecord>(storageKeys.failure),
      this.subscriptionURLs().then((urls) => urls.length),
      this.pageRules(),
      this.storedSurge(),
      this.ruleSetRecords(),
      this.ruleSetURLs(),
      this.ruleInputs(preferences),
    ]);
    let daemon: DaemonStatus | null = null;
    let tunnel: TunnelStatus | null = null;
    let proxy: SystemProxyStatus | null = null;
    if (granted.includes(requiredCapability)) {
      try {
        daemon = await jarvis.daemon.status(DAEMON_ID, preferences.singBoxPath || undefined);
      } catch {
        daemon = null;
      }
    }
    if (granted.includes(tunnelCapability)) {
      try {
        tunnel = await jarvis.tunnel.status(preferences.singBoxPath || undefined);
      } catch {
        tunnel = null;
      }
    }
    if (granted.includes("system.proxy")) {
      try {
        proxy = await jarvis.systemProxy.status();
      } catch {
        proxy = null;
      }
    }
    const members = new Set([URLTEST_TAG, ...nodes.map((node) => node.name)]);
    const effective = members.has(selection.node) ? selection : { ...selection, node: URLTEST_TAG };
    const failed = failure && typeof failure.message === "string" ? failure : null;
    const kernel = runningKernel(daemon, tunnel);
    return {
      granted,
      preferences,
      daemon,
      tunnel,
      kernel,
      tun: {
        granted: granted.includes(tunnelCapability),
        wanted: wantsTunnel(preferences),
        active: kernel === "tunnel",
        helper: tunnel?.helper.state ?? null,
        matchesInstalled: tunnel?.kernel.matchesInstalled ?? false,
        blocker: tunnel?.blocker?.message ?? null,
      },
      proxy,
      nodes,
      subscriptions: records,
      subscriptionCount,
      selection: effective,
      latency,
      control,
      failure: failed,
      phase: phaseOf({ granted, daemon, tunnel, nodeCount: nodes.length, failure: failed }),
      pageRules,
      surge: storedSurge,
      ruleSetRecords,
      ruleSetURLs,
      groups: preferences.useSurgeRules ? this.groupViews(storedSurge, nodes, selection) : [],
      rulesDigest: rules.digest,
    };
  }

  /**
   * 发一个 Clash API 请求：发往存储里记着的那一个内核（系统代理模式经 `daemon.request`，增强模式经 `tunnel.request`）。
   * @param method 方法。
   * @param path 路径。
   * @param body 请求体（对象，转 JSON）。
   * @param timeout 超时秒。
   * @returns 响应。
   */
  async clash(method: "GET" | "PUT" | "PATCH", path: string, body?: unknown, timeout = requestTimeoutSeconds): Promise<DaemonResponse> {
    const control = await this.control();
    const headers: { Authorization?: string; "Content-Type"?: string } = {};
    if (control) headers.Authorization = `Bearer ${control.secret}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const request = { method, path, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), timeout };
    if ((control?.kernel ?? "daemon") === "tunnel") return jarvis.tunnel.request(request);
    return jarvis.daemon.request({ id: DAEMON_ID, ...request });
  }

  // MARK: 内核

  /** 一个内核此刻在不在跑。 */
  private async kernelRunning(kind: KernelKind): Promise<boolean> {
    try {
      return kind === "tunnel" ? (await jarvis.tunnel.status()).state === "running" : (await jarvis.daemon.status(DAEMON_ID)).state === "running";
    } catch {
      return false;
    }
  }

  /** 内核此刻在不在跑（任一个）。 */
  async isRunning(): Promise<boolean> {
    if (await this.kernelRunning("daemon")) return true;
    const granted = await this.granted();
    return granted.includes(tunnelCapability) && (await this.kernelRunning("tunnel"));
  }

  /** 此刻在跑的内核；都没在跑为 `null`。 */
  async activeKernel(): Promise<KernelKind | null> {
    if (await this.kernelRunning("daemon")) return "daemon";
    const granted = await this.granted();
    if (granted.includes(tunnelCapability) && (await this.kernelRunning("tunnel"))) return "tunnel";
    return null;
  }

  /** 一个内核最近 500 行输出。 */
  private async kernelLogs(kind: KernelKind): Promise<string[]> {
    try {
      return kind === "tunnel" ? await jarvis.tunnel.logs() : await jarvis.daemon.logs(DAEMON_ID);
    } catch {
      return [];
    }
  }

  // MARK: 开与关

  /**
   * 开启：查装没装 → 有没有节点 → 生成配置 → 起内核（系统代理模式或增强模式）→ 等它就绪 → 把模式、节点、策略组放回去 → 设系统代理。
   * @param context 事件里带来的授权与偏好。
   * @returns 结果。
   */
  async turnOn(context: { granted?: string[]; preferences?: Record<string, unknown> } = {}): Promise<ActionResult> {
    if (this.busy) return { ok: false, message: `${this.busy}，稍等` };
    const granted = context.granted ?? (await this.granted());
    if (!granted.includes(requiredCapability)) return { ok: false, message: "还没有授权「代理」在后台运行 sing-box" };
    const preferences = await this.preferences(context.preferences);
    const selection = await this.selection();
    const kernel: KernelKind = wantsTunnel(preferences) ? "tunnel" : "daemon";
    if (kernel === "tunnel" && !granted.includes(tunnelCapability)) {
      return { ok: false, message: "还没有授权增强模式（TUN）：打开「代理」点授权，或在菜单里关掉增强模式" };
    }
    this.setBusy(kernel === "tunnel" ? "正在开启增强模式" : "正在开启");
    try {
      const executable = preferences.singBoxPath || undefined;
      const running = await this.activeKernel();
      if (running) {
        const port = (await this.control())?.mixedPort ?? preferences.mixedPort;
        const proxy = await this.applySystemProxy(granted, preferences.systemProxy, port);
        return { ok: true, message: proxy ?? "代理已经开着" };
      }
      const status = await jarvis.daemon.status(DAEMON_ID, executable);
      if (status.executable === "") {
        return { ok: false, message: preferences.singBoxPath ? `设置里选的 sing-box 路径不可用：${preferences.singBoxPath}` : "没有找到 sing-box：先在「代理」里安装" };
      }
      let nodes = await this.nodes();
      if (nodes.length === 0 && granted.includes("network.https")) {
        // 填了订阅却还没拉过（刚装好、刚填完）：先拉一次再开，省得用户先点「更新订阅」再点「开启」。
        this.busy = null;
        await this.updateSubscriptions({ granted, restartIfChanged: false });
        this.setBusy(kernel === "tunnel" ? "正在开启增强模式" : "正在开启");
        nodes = await this.nodes();
      }
      if (nodes.length === 0) return { ok: false, message: "没有节点：在设置里填订阅地址，再更新订阅" };

      const secret = randomSecret();
      let chinaRules = preferences.chinaRules;
      let fallback = false;
      const rules = await this.ruleInputs(preferences);
      try {
        await this.startKernelReleasingOwnPorts(kernel, nodes, preferences, selection, secret, chinaRules, rules);
      } catch (error) {
        if ((error as { blocked?: boolean }).blocked) throw error;
        if (!(chinaRules && !rules.surge && isRuleSetFailure(errorLines(error).join("\n")))) throw error;
        // 规则集第一次下载失败时 sing-box 拒绝启动；不分流再起一次——全部流量走节点，总比代理开不了强。
        chinaRules = false;
        fallback = true;
        await this.startKernel(kernel, nodes, preferences, selection, secret, chinaRules, rules);
      }
      await remove(storageKeys.failure);
      await this.applySelection(selection, nodes);
      const proxy = await this.applySystemProxy(granted, preferences.systemProxy, preferences.mixedPort);
      const parts = [kernel === "tunnel" ? "增强模式已开启 · 整机网络经过 sing-box" : `代理已开启 · 127.0.0.1:${preferences.mixedPort}`];
      if (fallback) parts.push("中国大陆规则集下载失败，这次不分流");
      if (proxy) parts.push(proxy);
      return { ok: true, message: parts.join("；") };
    } catch (error) {
      if ((error as { blocked?: boolean }).blocked) {
        await this.markStarted();
        await remove(storageKeys.control);
        return { ok: false, message: errorMessage(error) };
      }
      if ((error as { code?: string }).code === "permission.denied" && kernel === "tunnel") {
        await remove(storageKeys.control);
        return { ok: false, message: `${errorMessage(error)}：增强模式要装一次网络助手，再点一次打开、输入管理员密码即可` };
      }
      const lines = errorLines(error);
      const { message, hint } = describeFailure(lines, preferences);
      const failure: FailureRecord = { at: Date.now(), message, lines: lines.slice(-20), hint };
      await write(storageKeys.failure, failure);
      await this.markStarted();
      return { ok: false, message: hint ? `${message}：${hint}` : message };
    } finally {
      this.setBusy(null);
    }
  }

  /**
   * 一份配置。
   * @param kernel 跑在哪。
   * @param nodes 节点。
   * @param preferences 偏好。
   * @param selection 选择。
   * @param secret 控制口 secret。
   * @param chinaRules 这一次分不分流。
   * @param rules 规则输入。
   * @returns 配置与它的选项。
   */
  private config(kernel: KernelKind, nodes: ProxyNode[], preferences: ProxyPreferences, selection: Selection, secret: string, chinaRules: boolean, rules: RuleInputs, ports?: { mixedPort: number; controlPort: number }): Record<string, unknown> {
    const options: ConfigOptions = {
      nodes,
      mixedPort: ports?.mixedPort ?? preferences.mixedPort,
      controlPort: ports?.controlPort ?? preferences.controlPort,
      controlSecret: secret,
      mode: selection.mode,
      testURL: preferences.testURL,
      selected: selection.node,
      chinaRules,
      kernel,
      dnsMode: preferences.dnsMode,
      pageRules: rules.pageRules,
      surge: rules.surge,
      ruleSets: rules.ruleSets,
      groupSelection: selection.groups,
    };
    return buildConfig(options);
  }

  /**
   * 起内核；撞上「端口被占着」时先停掉自己的两个内核、等半秒再起一次（W-4）。
   *
   * 仓库主人：「Jarvis 自己的端口释放和占用，我理解应该可以自行处理」。占着 7890 / 19090 的多半是 Jarvis 自己：
   * 另一种模式的内核还没退完、上一个实例留下的 sing-box（宿主在 `daemon.start` 前也会收同目录的遗留进程）。
   * 第二次还冲突才是真的被别的程序占着，照常报出来。
   */
  private async startKernelReleasingOwnPorts(
    kernel: KernelKind,
    nodes: ProxyNode[],
    preferences: ProxyPreferences,
    selection: Selection,
    secret: string,
    chinaRules: boolean,
    rules: RuleInputs,
  ): Promise<void> {
    try {
      await this.startKernel(kernel, nodes, preferences, selection, secret, chinaRules, rules);
    } catch (error) {
      if ((error as { blocked?: boolean }).blocked || !isPortConflict(errorLines(error))) throw error;
      jarvis.log.info("端口被占着：先停掉自己的内核再起一次");
      await this.stopOwnKernels();
      await sleep(portReleaseMs);
      await this.startKernel(kernel, nodes, preferences, selection, secret, chinaRules, rules);
    }
  }

  /** 停自己的两个内核（哪一个在跑都停得掉；没在跑是空操作）。 */
  private async stopOwnKernels(): Promise<void> {
    try {
      await jarvis.daemon.stop(DAEMON_ID);
    } catch (error) {
      jarvis.log.warn("常驻内核没能停下", errorMessage(error));
    }
    if ((await this.granted()).includes(tunnelCapability)) {
      try {
        await jarvis.tunnel.stop();
      } catch (error) {
        jarvis.log.warn("增强模式没能停下", errorMessage(error));
      }
    }
  }

  /**
   * 起内核并等它就绪。远程规则集在 sing-box 的启动阶段下载（宿主只等 1–1.5 秒），所以「起来了」之后还要等 Clash API 开始答话；
   * 这期间进程退了，读它的输出当失败抛出——上层据此判断要不要不分流再试一次。增强模式被别的 VPN 拦着时抛 `{ blocked: true }`。
   */
  private async startKernel(
    kernel: KernelKind,
    nodes: ProxyNode[],
    preferences: ProxyPreferences,
    selection: Selection,
    secret: string,
    chinaRules: boolean,
    rules: RuleInputs,
  ): Promise<void> {
    const config = this.config(kernel, nodes, preferences, selection, secret, chinaRules, rules);
    const control: ControlRecord = {
      kernel,
      secret,
      controlPort: preferences.controlPort,
      mixedPort: preferences.mixedPort,
      chinaRules,
      ruleSetFallback: preferences.chinaRules && !chinaRules && !rules.surge,
      testURL: preferences.testURL,
      nodesDigest: nodesDigest(nodes),
      rulesDigest: rules.digest,
      startedAt: Date.now(),
      starting: true,
    };
    // 先写 secret 再起：后台会话在内核起来的那一刻就可能要调控制口。
    await write(storageKeys.control, control);
    if (kernel === "tunnel") {
      const status = await jarvis.tunnel.start({
        config: JSON.stringify(config),
        controlPort: preferences.controlPort,
        ...(preferences.singBoxPath ? { executable: preferences.singBoxPath } : {}),
        excludeRoutes: tunnelExcludeRoutes(rules.surge),
        stack: preferences.tunStack,
        ipv6: rules.surge?.general.ipv6 !== false,
      });
      if (status.state !== "running") {
        throw { blocked: true, message: status.blocker?.message ?? "增强模式没有起来：另一个 VPN 或增强模式正占着网络" };
      }
    } else {
      await jarvis.daemon.start({
        id: DAEMON_ID,
        config: JSON.stringify(config),
        controlPort: preferences.controlPort,
        ...(preferences.singBoxPath ? { executable: preferences.singBoxPath } : {}),
      });
    }
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      if (!(await this.kernelRunning(kernel))) {
        const lines = (await this.kernelLogs(kernel)).slice(-20);
        throw { message: "sing-box 启动后退出了", detail: lines.join("\n") || "sing-box 启动后退出了" };
      }
      try {
        const response = await this.clash("GET", "/version", undefined, 2);
        if (response.status === 200) break;
      } catch {
        // 控制口还没开：规则集还在下载。
      }
      if (Date.now() >= deadline) {
        jarvis.log.warn("等了 30 秒 Clash API 仍没答话，按已开启处理");
        break;
      }
      await sleep(500);
    }
    await this.markStarted();
  }

  /** 把存储里的 `starting` 落下。 */
  private async markStarted(): Promise<void> {
    const control = await this.control();
    if (control?.starting) await write(storageKeys.control, { ...control, starting: false });
  }

  /**
   * 把模式、「节点选择」与导入的策略组放回用户选的样子。`cache.db` 记着上一次的模式与选中项，启动时以它为准，
   * 配置里的 `default_mode` / `default` 只管第一次——用户在内核停着的时候改过，不放回去就会被缓存盖掉。
   */
  private async applySelection(selection: Selection, nodes: ProxyNode[]): Promise<void> {
    try {
      await this.clash("PATCH", "/configs", { mode: clashModeNames[selection.mode] });
      const members = new Set([URLTEST_TAG, ...nodes.map((node) => node.name)]);
      await this.clash("PUT", proxyPath(SELECTOR_TAG), { name: members.has(selection.node) ? selection.node : URLTEST_TAG });
      const preferences = await this.preferences();
      const surge = preferences.useSurgeRules ? await this.storedSurge() : null;
      for (const group of this.groupViews(surge, nodes, selection)) {
        if (selection.groups[group.name] === undefined) continue;
        await this.clash("PUT", proxyPath(group.tag), { name: group.selected });
      }
    } catch (error) {
      jarvis.log.warn("模式与节点没能放回去", errorMessage(error));
    }
  }

  /**
   * 按偏好设系统代理（增强模式下照样设：认系统代理的应用少绕一次 TUN，与 Surge 增强模式相同）。
   * @returns 要告诉用户的一句话（被拦着、别人接管着、没授权）；一切正常为 `null`。
   */
  private async applySystemProxy(granted: string[], wanted: boolean, port: number): Promise<string | null> {
    if (!wanted) return null;
    if (!granted.includes("system.proxy")) return "没有授权修改系统代理，只在本机端口上可用";
    try {
      const status = await jarvis.systemProxy.enable({ port, bypass: systemProxyBypass(await this.storedSurge()) });
      return status.blocker ? status.blocker.message : null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  /**
   * 关闭：先还原系统代理，再停内核（反过来的话中间那一下系统代理指着一个没人监听的端口）。两个内核都停一次：哪一个在跑都停得掉。
   * @returns 结果。
   */
  async turnOff(): Promise<ActionResult> {
    if (this.busy) return { ok: false, message: `${this.busy}，稍等` };
    this.setBusy("正在关闭");
    try {
      const granted = await this.granted();
      if (granted.includes("system.proxy")) {
        try {
          await jarvis.systemProxy.disable();
        } catch (error) {
          jarvis.log.warn("系统代理没能还原（宿主会在内核停下后兜底还原）", errorMessage(error));
        }
      }
      await jarvis.daemon.stop(DAEMON_ID);
      if (granted.includes(tunnelCapability)) {
        try {
          await jarvis.tunnel.stop();
        } catch (error) {
          jarvis.log.warn("增强模式没能停下", errorMessage(error));
        }
      }
      await remove(storageKeys.failure);
      await remove(storageKeys.control);
      return { ok: true, message: "代理已关闭" };
    } catch (error) {
      return { ok: false, message: `没能关闭：${errorMessage(error)}` };
    } finally {
      this.setBusy(null);
    }
  }

  /**
   * 重开（端口改过、换了内核）：会断开现有连接一下。
   * @returns 结果。
   */
  async restart(): Promise<ActionResult> {
    const off = await this.turnOff();
    if (!off.ok) return off;
    return this.turnOn();
  }

  /**
   * 重新载入：换一份配置、不断进程（`daemon.reload` / `tunnel.reload`，sing-box 收到 SIGHUP 原进程重载）。节点、规则、测速地址变了都走这条路；
   * 端口改过、内核要换时只能重开（见 `restartReasons`），这里会转去 {@link restart}。没在跑时什么都不做。
   * @returns 结果。
   */
  async reload(): Promise<ActionResult> {
    if (this.busy) return { ok: false, message: `${this.busy}，稍等` };
    const control = await this.control();
    const kernel = await this.activeKernel();
    if (!control || !kernel) return { ok: true, message: "" };
    const preferences = await this.preferences();
    const selection = await this.selection();
    const wanted: KernelKind = wantsTunnel(preferences) ? "tunnel" : "daemon";
    if (control.mixedPort !== preferences.mixedPort || control.controlPort !== preferences.controlPort || wanted !== kernel) return this.restart();
    this.setBusy("正在重新载入");
    try {
      const nodes = await this.nodes();
      if (nodes.length === 0) return { ok: false, message: "没有节点：先更新订阅" };
      const rules = await this.ruleInputs(preferences);
      const chinaRules = preferences.chinaRules;
      const config = JSON.stringify(this.config(kernel, nodes, preferences, selection, control.secret, chinaRules, rules, { mixedPort: control.mixedPort, controlPort: control.controlPort }));
      if (kernel === "tunnel") await jarvis.tunnel.reload(config);
      else await jarvis.daemon.reload({ id: DAEMON_ID, config });
      await write(storageKeys.control, {
        ...control,
        kernel,
        chinaRules,
        ruleSetFallback: false,
        testURL: preferences.testURL,
        nodesDigest: nodesDigest(nodes),
        rulesDigest: rules.digest,
      } satisfies ControlRecord);
      await this.waitReady(kernel);
      await this.applySelection(selection, nodes);
      return { ok: true, message: "已重新载入配置" };
    } catch (error) {
      return { ok: false, message: `没能重新载入：${errorMessage(error)}` };
    } finally {
      this.setBusy(null);
    }
  }

  /** 重载之后等 Clash API 重新答话（sing-box 重载时控制口会关一下），至多 10 秒。 */
  private async waitReady(kernel: KernelKind): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (!(await this.kernelRunning(kernel))) return;
      try {
        if ((await this.clash("GET", "/version", undefined, 2)).status === 200) return;
      } catch {
        // 还在重载。
      }
      await sleep(300);
    }
  }

  // MARK: 模式、节点、策略组、增强模式、系统代理

  /**
   * 换出站模式：记下来，开着就当场换。
   * @param mode 模式。
   */
  async setMode(mode: ProxyMode): Promise<ActionResult> {
    const selection = await this.selection();
    await write(storageKeys.selection, { ...selection, mode });
    if (!(await this.isRunning())) return { ok: true, message: "" };
    try {
      const response = await this.clash("PATCH", "/configs", { mode: clashModeNames[mode] });
      return response.status < 300 ? { ok: true, message: "" } : { ok: false, message: `没能换模式（${response.status}）` };
    } catch (error) {
      return { ok: false, message: `没能换模式：${errorMessage(error)}` };
    }
  }

  /**
   * 换节点：记下来，开着就当场换（`节点选择` 打断旧连接，见配置）。
   * @param name 节点名或「自动选择」。
   */
  async selectNode(name: string): Promise<ActionResult> {
    const selection = await this.selection();
    await write(storageKeys.selection, { ...selection, node: name });
    if (!(await this.isRunning())) return { ok: true, message: "" };
    try {
      const response = await this.clash("PUT", proxyPath(SELECTOR_TAG), { name });
      return response.status < 300 ? { ok: true, message: "" } : { ok: false, message: `没能切到「${name}」（${response.status}）` };
    } catch (error) {
      return { ok: false, message: `没能切节点：${errorMessage(error)}` };
    }
  }

  /**
   * 给导入的一个策略组换组员：记下来，开着就当场换。
   * @param group 组（Surge 里的名字）。
   * @param member 组员 tag。
   */
  async selectGroupMember(group: GroupView, member: string): Promise<ActionResult> {
    const selection = await this.selection();
    await write(storageKeys.selection, { ...selection, groups: { ...selection.groups, [group.name]: member } });
    if (!(await this.isRunning())) return { ok: true, message: "" };
    try {
      const response = await this.clash("PUT", proxyPath(group.tag), { name: member });
      return response.status < 300 ? { ok: true, message: "" } : { ok: false, message: `「${group.name}」没能切到「${memberTitle(member)}」（${response.status}）` };
    } catch (error) {
      return { ok: false, message: `没能切策略组：${errorMessage(error)}` };
    }
  }

  /**
   * 开 / 关增强模式：写偏好 `tun`（W-6：菜单、工具箱、`/proxy tun` 与设置页同一份真源），开着就换一个内核重开——
   * 两个内核都要监听同一个本地端口，不能同时跑。第一次打开时宿主会弹管理员密码框装网络助手。
   * 写之前先记一笔 `tunSwitch`：宿主把这次变更也通知给后台会话，它据此认出是自己人在换，不再换一次。
   * @param on 开还是关。
   */
  async setTun(on: boolean): Promise<ActionResult> {
    await write(storageKeys.tunSwitch, { on, at: Date.now() } satisfies TunSwitch);
    try {
      await jarvis.preferences.set("tun", on);
    } catch (error) {
      return { ok: false, message: `没能改「增强模式」：${errorMessage(error)}` };
    }
    return this.applyTun(on);
  }

  /**
   * 按偏好 `tun` 换内核：开着且内核与它不符时重开；没开着什么都不做（下次开启按它）。设置页改了这一项走这里（后台会话）。
   * @param on 偏好此刻的值。
   * @returns 结果。
   */
  async applyTun(on: boolean): Promise<ActionResult> {
    const kernel = await this.activeKernel();
    if (!kernel) return { ok: true, message: on ? "下次开启代理时用增强模式" : "下次开启代理时用系统代理模式" };
    if ((kernel === "tunnel") === on) return { ok: true, message: "" };
    return this.restart();
  }

  /**
   * 上一版把菜单里拨的增强模式记在 `selection.tun`：读到布尔值就写进偏好再清掉，之后只看偏好（W-6）。
   * 写不进去（旧宿主没有 `preferences.set`）时留着不动，下次再试。
   */
  async migrateTunSelection(): Promise<void> {
    const selection = await this.selection();
    if (selection.tun === null) return;
    try {
      await write(storageKeys.tunSwitch, { on: selection.tun, at: Date.now() } satisfies TunSwitch);
      await jarvis.preferences.set("tun", selection.tun);
      await write(storageKeys.selection, { ...selection, tun: null });
    } catch (error) {
      jarvis.log.warn("增强模式的旧开关没能搬进偏好", errorMessage(error));
    }
  }

  /**
   * 开 / 关系统代理（不改偏好：偏好只决定「开启代理时要不要顺手设」）。
   * @param on 开还是关。
   */
  async setSystemProxy(on: boolean): Promise<ActionResult> {
    const granted = await this.granted();
    if (!granted.includes("system.proxy")) return { ok: false, message: "没有授权修改系统代理" };
    try {
      if (!on) {
        await jarvis.systemProxy.disable();
        return { ok: true, message: "系统代理已还原" };
      }
      const control = await this.control();
      const port = control?.mixedPort ?? (await this.preferences()).mixedPort;
      const status = await jarvis.systemProxy.enable({ port, bypass: systemProxyBypass(await this.storedSurge()) });
      return status.blocker ? { ok: false, message: status.blocker.message } : { ok: true, message: `系统代理指向 127.0.0.1:${port}` };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  // MARK: 页面规则

  /**
   * 给一个域名定策略（`null` = 删掉它的规则），开着就重新载入——不断连接、不动系统代理。
   * @param domain 域名（`domain_suffix`：含全部子域名）。
   * @param policy 策略。
   * @returns 结果。
   */
  async setPageRule(domain: string, policy: PolicyRef | null): Promise<ActionResult> {
    const rules = await this.pageRules();
    const id = `domain_suffix:${domain}`;
    const next = policy === null ? removePageRule(rules, id) : upsertPageRule(rules, { kind: "domain_suffix", value: domain, policy }, Date.now());
    await write(storageKeys.pageRules, next);
    const reloaded = await this.reload();
    if (!reloaded.ok) return reloaded;
    return { ok: true, message: policy === null ? `删掉了 ${domain} 的规则` : `${domain} 以后${policyLabel(policy)}` };
  }

  /**
   * 删一条页面规则（按 id）。
   * @param id 规则 id。
   */
  async removePageRule(id: string): Promise<ActionResult> {
    await write(storageKeys.pageRules, removePageRule(await this.pageRules(), id));
    return this.reload();
  }

  /**
   * 读「当前页面」：浏览器地址栏 + 这个浏览器的进程最近 30 秒连过的主机。
   * @param granted 已授予的能力。
   * @param seen 最近的连接（日志与快照合起来的）。
   * @returns 读到的东西。
   */
  async currentPage(granted: readonly string[], seen: readonly SeenConnection[]): Promise<PageView> {
    if (!granted.includes("browser.activeTab")) return { browser: null, host: "", status: "notGranted", message: "还没有授权读取浏览器当前页", domains: [] };
    let tab: BrowserActiveTab = null;
    try {
      tab = await jarvis.browser.activeTab();
    } catch (error) {
      return { browser: null, host: "", status: "unavailable", message: errorMessage(error), domains: [] };
    }
    if (!tab) return { browser: null, host: "", status: "none", message: "", domains: [] };
    const host = tab.status === "ok" && tab.url ? urlHost(tab.url) : "";
    return {
      browser: tab.browser.name,
      host,
      status: tab.status,
      message: tab.message ?? (tab.status === "denied" ? `在 系统设置 › 隐私与安全性 › 自动化 里允许 Jarvis 控制「${tab.browser.name}」` : tab.status === "unsupported" ? `读不到「${tab.browser.name}」的地址：只能看下面这些连接` : ""),
      domains: pageDomains(host, tab.browser, seen, Date.now()),
    };
  }

  // MARK: 测速、流量、日志

  /**
   * 测一遍节点延迟：4 个一批，每测出一个就通知界面亮起读数，全部测完写进存储（另一个会话读得到）。
   * @param names 要测的节点；省略 = 全部。
   * @returns 结果。
   */
  async testLatency(names?: string[]): Promise<ActionResult> {
    if (this.busy) return { ok: false, message: `${this.busy}，稍等` };
    if (!(await this.isRunning())) return { ok: false, message: "代理开着才能测速" };
    const targets = names ?? (await this.nodes()).map((node) => node.name);
    if (targets.length === 0) return { ok: false, message: "没有节点可测" };
    const control = await this.control();
    const url = control?.testURL ?? (await this.preferences()).testURL;
    this.setBusy("正在测速");
    let reachable = 0;
    try {
      await runLimited(targets, delayConcurrency, async (name) => {
        let delay: number | null = null;
        try {
          delay = parseDelay(await this.clash("GET", delayPath(name, url), undefined, requestTimeoutSeconds));
        } catch {
          delay = null;
        }
        if (delay !== null) reachable += 1;
        this.pendingLatency[name] = delay;
        this.changed();
      });
      const stored = await read<LatencyRecord>(storageKeys.latency);
      const values = { ...(stored?.values ?? {}), ...this.pendingLatency };
      await write(storageKeys.latency, { values, testedAt: Date.now() });
      this.pendingLatency = {};
      return { ok: true, message: `测完 ${targets.length} 个节点，${reachable} 个连得上` };
    } finally {
      this.setBusy(null);
    }
  }

  /**
   * 此刻的路由（窗口「规则」页那张表，jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）：
   * 与开启时交给 sing-box 的同一份算法、同一份输入（页面规则、导入的配置、拉到的外部规则集）；这一份有没有分流按在跑的那一份记的为准。
   * 改过规则还没重新载入时，这里列的是新的那一份——页面上「重新载入之后生效」那张卡会说清楚。
   * @param snapshot 快照。
   * @returns 路由。
   */
  async routeTable(snapshot: Snapshot): Promise<RoutePlan> {
    const rules = await this.ruleInputs(snapshot.preferences);
    return routePlan({
      nodes: snapshot.nodes,
      mixedPort: snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort,
      controlPort: snapshot.control?.controlPort ?? snapshot.preferences.controlPort,
      controlSecret: snapshot.control?.secret ?? "-",
      mode: snapshot.selection.mode,
      testURL: snapshot.preferences.testURL,
      selected: snapshot.selection.node,
      chinaRules: snapshot.control ? snapshot.control.chinaRules && !snapshot.control.ruleSetFallback : snapshot.preferences.chinaRules,
      kernel: snapshot.kernel ?? snapshot.control?.kernel ?? "daemon",
      dnsMode: snapshot.preferences.dnsMode,
      pageRules: rules.pageRules,
      surge: rules.surge,
      ruleSets: rules.ruleSets,
      groupSelection: snapshot.selection.groups,
    });
  }

  /**
   * 经直连出站测一次「Internet 延迟」（窗口「活动」页那张卡）：本机到外网通不通、要多久，不经过任何节点。
   * @param url 测试地址（https）。
   * @returns 毫秒；没在跑、超时、连不上为 `null`。
   */
  async internetLatency(url: string): Promise<number | null> {
    try {
      return parseDelay(await this.clash("GET", delayPath(DIRECT_TAG, url), undefined, requestTimeoutSeconds));
    } catch {
      return null;
    }
  }

  /** 读一份连接快照；没在跑、读不出为 `null`。 */
  async connections(): Promise<ConnectionsSnapshot | null> {
    try {
      return parseConnections(await this.clash("GET", "/connections", undefined, 3));
    } catch {
      return null;
    }
  }

  /** 「自动选择」此刻选中的节点；读不出为 `null`。 */
  async autoPick(): Promise<string | null> {
    try {
      return parseGroupNow(await this.clash("GET", proxyPath(URLTEST_TAG), undefined, 3));
    } catch {
      return null;
    }
  }

  /** 在跑的内核（没在跑就按存储里记着的那一个）最近 500 行输出。 */
  async logs(): Promise<string[]> {
    const kernel = (await this.activeKernel()) ?? (await this.control())?.kernel ?? "daemon";
    return this.kernelLogs(kernel);
  }

  /**
   * 终端代理命令（按此刻在跑的那一份的端口；没在跑按偏好）。
   * @param preferences 偏好。
   * @param control 控制口记录。
   */
  terminalCommand(preferences: ProxyPreferences, control: ControlRecord | null): string {
    return terminalProxyCommand(control?.mixedPort ?? preferences.mixedPort);
  }

  /** 在终端里装（或升级）sing-box。 */
  async install(): Promise<ActionResult> {
    try {
      await jarvis.terminal.run(INSTALL_SCRIPT_ID);
      return { ok: true, message: "已在终端里开始安装；装好之后回到这里就能开启" };
    } catch (error) {
      return { ok: false, message: `没能打开终端：${errorMessage(error)}` };
    }
  }

  // MARK: 导入 Surge 配置与外部规则集

  /**
   * 导入一份 Surge 配置：转换、存下（规则切块），开着就重新载入；再把「规则集地址」里已经填了的那几个拉一遍。
   * @param text 文件正文。
   * @param name 文件名。
   * @returns 结果。
   */
  async importSurge(text: string, name: string): Promise<ActionResult> {
    let imported: SurgeImport;
    try {
      imported = convertSurgeProfile(text, name, Date.now());
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
    const previous = await this.storedSurge();
    const blocks = chunkItems(imported.rules);
    for (let index = 0; index < blocks.length; index += 1) await write(surgeRuleChunkKey(index), blocks[index]);
    for (let stale = blocks.length; stale < (previous?.ruleChunks ?? 0); stale += 1) await remove(surgeRuleChunkKey(stale));
    const { rules: _rules, ...rest } = imported;
    await write(storageKeys.surge, { ...rest, ruleChunks: blocks.length } satisfies StoredSurge);
    // 不在这份配置里的外部规则集：记录与内容一并删掉。
    const records = await this.ruleSetRecords();
    const keep = new Set(imported.ruleSets.map((ref) => ref.tag));
    const kept: Record<string, RuleSetRecord> = {};
    for (const record of records) {
      if (keep.has(record.tag)) kept[record.tag] = record;
      else for (let index = 0; index < record.chunks; index += 1) await remove(ruleSetChunkKey(record.tag, index));
    }
    await write(storageKeys.ruleSets, kept);
    const pending = imported.ruleSets.length;
    const parts = [`导入了「${name}」：${convertedCount(imported.report)} / ${imported.report.ruleLines} 条规则转成 sing-box、${imported.groups.length} 个策略组`];
    const unsupported = imported.report.unsupported.reduce((sum, kind) => sum + kind.count, 0);
    if (unsupported > 0) parts.push(`${unsupported} 项转不了（见「规则」页）`);
    const granted = await this.granted();
    if (pending > 0) {
      const fetched = granted.includes("network.https") ? await this.updateRuleSets({ reload: false }) : null;
      parts.push(fetched?.message || `${pending} 个外部规则集要联网拉：把地址贴进 设置 ›「规则集地址」`);
    }
    const reloaded = await this.reload();
    if (!reloaded.ok) parts.push(reloaded.message);
    return { ok: true, message: parts.join("；") };
  }

  /** 撤掉导入的 Surge 配置，回到内置规则。 */
  async clearSurge(): Promise<ActionResult> {
    const stored = await this.storedSurge();
    for (let index = 0; index < (stored?.ruleChunks ?? 0); index += 1) await remove(surgeRuleChunkKey(index));
    for (const record of await this.ruleSetRecords()) for (let index = 0; index < record.chunks; index += 1) await remove(ruleSetChunkKey(record.tag, index));
    await remove(storageKeys.surge);
    await remove(storageKeys.ruleSets);
    const reloaded = await this.reload();
    return reloaded.ok ? { ok: true, message: "撤掉了导入的 Surge 配置，回到内置规则" } : reloaded;
  }

  /**
   * 拉一遍导入配置里的外部规则集——只拉用户贴进「规则集地址」的那些（宿主只放行用户亲手填的主机）。每个各自成败：没拉到的留着上一次的内容。
   * @param options `reload`：拉完、内容变了且开着就重新载入（默认要）。
   * @returns 结果；没导入、没有外部规则集为 `{ ok: true, message: "" }`。
   */
  async updateRuleSets(options: { reload?: boolean } = {}): Promise<ActionResult> {
    const surge = await this.storedSurge();
    if (!surge || surge.ruleSets.length === 0) return { ok: true, message: "" };
    const allowed = new Set(await this.ruleSetURLs());
    const previous = new Map((await this.ruleSetRecords()).map((record) => [record.tag, record]));
    const next: Record<string, RuleSetRecord> = {};
    let fetched = 0;
    let waiting = 0;
    let changed = false;
    const failures: string[] = [];
    for (const ref of surge.ruleSets) {
      const before = previous.get(ref.tag);
      const base: RuleSetRecord = before ?? { ...ref, fetchedAt: null, attemptedAt: null, error: null, total: 0, skipped: 0, hasIP: false, chunks: 0 };
      if (!allowed.has(ref.url)) {
        waiting += 1;
        next[ref.tag] = { ...base, error: base.chunks > 0 ? base.error : "还没贴进「规则集地址」" };
        continue;
      }
      const now = Date.now();
      try {
        const response = await jarvis.net.fetch(ref.url, { method: "GET", headers: { "User-Agent": SUBSCRIPTION_USER_AGENT } });
        if (response.status < 200 || response.status >= 300) throw new Error(`服务器回了 HTTP ${response.status}`);
        const list = convertSurgeList(response.text, ref.format);
        const blocks = chunkItems(splitHeadlessRules(list.rules));
        for (let index = 0; index < blocks.length; index += 1) await write(ruleSetChunkKey(ref.tag, index), blocks[index]);
        for (let stale = blocks.length; stale < base.chunks; stale += 1) await remove(ruleSetChunkKey(ref.tag, stale));
        changed ||= base.total !== list.total || base.chunks !== blocks.length || base.fetchedAt === null;
        next[ref.tag] = { ...base, fetchedAt: now, attemptedAt: now, error: null, total: list.total, skipped: list.skipped, hasIP: list.hasIP, chunks: blocks.length };
        fetched += 1;
      } catch (error) {
        failures.push(`${ref.host}：${errorMessage(error)}`);
        next[ref.tag] = { ...base, attemptedAt: now, error: errorMessage(error) };
      }
    }
    await write(storageKeys.ruleSets, next);
    const parts: string[] = [];
    if (fetched > 0) parts.push(`拉到 ${fetched} 个外部规则集`);
    if (waiting > 0) parts.push(`${waiting} 个还没贴进「规则集地址」`);
    if (failures.length > 0) parts.push(`没拉到：${failures.join("；")}`);
    if (changed && options.reload !== false) {
      const reloaded = await this.reload();
      if (!reloaded.ok) parts.push(reloaded.message);
    }
    return { ok: failures.length === 0, message: parts.join("；") };
  }

  // MARK: 订阅

  /**
   * 拉一遍偏好里的全部订阅。每条各自成败：失败的那条留着上一次的节点，只记下原因。
   * 内核开着、节点又真的变了，就重新载入一次让新节点生效（不断进程：`daemon.reload` / `tunnel.reload`）。
   * @param options 授权（省略时现问）与要不要重新载入。
   * @returns 结果。
   */
  async updateSubscriptions(options: { granted?: string[]; restartIfChanged?: boolean } = {}): Promise<ActionResult> {
    if (this.busy) return { ok: false, message: `${this.busy}，稍等` };
    const granted = options.granted ?? (await this.granted());
    if (!granted.includes("network.https")) return { ok: false, message: "还没有授权「代理」拉取订阅地址" };
    const urls = await this.subscriptionURLs();
    if (urls.length === 0) return { ok: false, message: "设置里还没有订阅地址" };
    this.setBusy("正在更新订阅");
    let summary: ActionResult;
    try {
      const previous = await this.records();
      const now = Date.now();
      const outcomes = await Promise.all(urls.map((url) => this.fetchSubscription(url)));
      const records: SubscriptionRecord[] = [];
      for (let index = 0; index < urls.length; index += 1) {
        const id = subscriptionId(urls[index]);
        const before = previous.find((record) => record.id === id);
        const outcome = outcomes[index];
        let chunks = 0;
        if (outcome.ok) {
          const blocks = chunkNodes(outcome.nodes);
          for (let block = 0; block < blocks.length; block += 1) await write(nodeChunkKey(id, block), blocks[block]);
          chunks = blocks.length;
          for (let stale = chunks; stale < (before?.chunks ?? 0); stale += 1) await remove(nodeChunkKey(id, stale));
        }
        records.push(nextRecord(before, urls[index], index + 1, outcome, chunks, now));
      }
      // 偏好里删掉的订阅：节点块一并删掉。
      const kept = new Set(records.map((record) => record.id));
      for (const record of previous) {
        if (kept.has(record.id)) continue;
        for (let block = 0; block < record.chunks; block += 1) await remove(nodeChunkKey(record.id, block));
      }
      await write(storageKeys.subscriptions, records);
      const succeeded = outcomes.filter((outcome) => outcome.ok).length;
      const schedule = (await read<Schedule>(storageKeys.schedule)) ?? { lastAttemptAt: null, lastSuccessAt: null };
      await write(storageKeys.schedule, { lastAttemptAt: now, lastSuccessAt: succeeded > 0 ? now : schedule.lastSuccessAt });
      const nodes = await this.nodes(records);
      const failures = records.filter((record) => record.error).map((record) => `${record.host}：${record.error}`);
      summary = {
        ok: succeeded > 0,
        message:
          succeeded === urls.length
            ? `更新了 ${urls.length} 条订阅，共 ${nodes.length} 个节点`
            : `${urls.length} 条订阅里 ${urls.length - succeeded} 条没更新上（${failures.join("；")}）；现有 ${nodes.length} 个节点`,
      };
      if (options.restartIfChanged !== false && succeeded > 0) {
        const control = await this.control();
        if (control && control.nodesDigest !== nodesDigest(nodes) && (await this.isRunning())) {
          this.setBusy(null);
          const reloaded = await this.reload();
          summary = { ok: reloaded.ok, message: `${summary.message}；${reloaded.ok ? "已重新载入以用上新节点" : reloaded.message}` };
        }
      }
    } catch (error) {
      summary = { ok: false, message: `更新订阅出错：${errorMessage(error)}` };
    } finally {
      if (this.busy === "正在更新订阅") this.setBusy(null);
    }
    return summary;
  }

  /**
   * 「更新订阅与规则集」：订阅一遍、外部规则集一遍（菜单与自动更新用）。
   * @param granted 已授予的能力。
   * @returns 两件事合起来的结果。
   */
  async updateAll(granted?: string[]): Promise<ActionResult> {
    const subscriptions = await this.updateSubscriptions({ granted });
    const sets = await this.updateRuleSets();
    const message = [subscriptions.message, sets.message].filter((part) => part.length > 0).join("；");
    return { ok: subscriptions.ok && sets.ok, message };
  }

  /**
   * 拉一条订阅并解析。
   * @param url 地址。
   * @returns 结果。
   */
  private async fetchSubscription(url: string): Promise<FetchOutcome> {
    try {
      const response = await jarvis.net.fetch(url, { method: "GET", headers: { "User-Agent": SUBSCRIPTION_USER_AGENT } });
      if (response.status < 200 || response.status >= 300) return { ok: false, error: `服务器回了 HTTP ${response.status}` };
      const parsed = parseSubscription(response.text);
      if (parsed.nodes.length === 0) {
        return { ok: false, error: parsed.skipped[0] ? `没有认出任何节点（${parsed.skipped[0].reason}）` : "订阅是空的", skipped: parsed.skipped };
      }
      return {
        ok: true,
        format: parsed.format,
        nodes: parsed.nodes,
        skipped: parsed.skipped,
        usage: parseSubscriptionUserinfo(headerValue(response.headers ?? {}, "subscription-userinfo")),
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }
}

/** 「以后走代理」「以后直连」这种说法。 */
function policyLabel(policy: PolicyRef): string {
  if (policy === "proxy") return "走代理";
  if (policy === "direct") return "直连";
  if (policy === "reject") return "一律拒绝";
  return `走「${policy.slice("group:".length)}」`;
}
