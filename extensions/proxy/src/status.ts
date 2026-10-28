/**
 * 「代理」此刻处在哪一步、该怎么说、菜单栏画什么（纯函数，不碰宿主）。
 *
 * 工具箱、窗口与菜单栏三处界面读同一份判断：此刻是没授权、没装、没订阅、关着、开着还是起不来。
 * 判断写在这里而不是各处视图里，是为了三处永远说同一句话——菜单栏说「开着」、面板说「起不来」的那种不一致，
 * 用户只会以为两处有一处坏了。
 */
import type {
  BrowserActiveTabStatus,
  DaemonStatus,
  MenuBarItem,
  MenuBarModel,
  SystemProxyStatus,
  TunnelHelperState,
  TunnelStatus,
} from "@fusionseek/jarvis-extension-sdk";
import { formatDelay, type TrafficRate } from "./clash.js";
import { DIRECT_TAG, SELECTOR_TAG, URLTEST_TAG, type ProxyProtocol } from "./nodes.js";
import { pageRuleFor, policyTitle, type PageDomain, type PageRule, type PolicyRef } from "./rules.js";
import { clashModeNames, type DNSMode, type KernelKind, type ProxyMode } from "./singbox-config.js";
import { updateIntervals, type ControlRecord, type UpdateInterval } from "./store.js";
import { fixedRate, shortRate, type Attempt, type TrafficReading } from "./traffic.js";

// MARK: - 偏好

/** 偏好（`contributes.settings`，`subscriptions` 进钥匙串、不在这里）。 */
export interface ProxyPreferences {
  mixedPort: number;
  controlPort: number;
  /** 开启时设为系统代理。 */
  systemProxy: boolean;
  /** 启动 Jarvis 时自动开启。 */
  autoStart: boolean;
  /** 中国大陆直连。 */
  chinaRules: boolean;
  testURL: string;
  /** sing-box 路径；空 = 宿主自动定位。 */
  singBoxPath: string;
  updateInterval: UpdateInterval;
  /** 菜单栏显示速率。 */
  showSpeed: boolean;
  /** 菜单栏速率多少秒换一次（1–60）：写的是这段时间里的平均有效速率（jarvis-mac `specs/20261028-130540-proxy-walkthrough-fixes` W-2）。 */
  speedInterval: number;
  /**
   * 增强模式（TUN）。**唯一的真源**：菜单、工具箱、`/proxy tun` 拨开关都写它（`jarvis.preferences.set`，W-6），设置页那一项就是它。
   * 上一版另有 `Selection.tun`（菜单里拨过之后以那一次为准），于是工具箱开着、设置页关着。
   */
  tun: boolean;
  /** TUN 下的 DNS。 */
  dnsMode: DNSMode;
  /** TUN 协议栈。 */
  tunStack: TunStack;
  /** 用导入的 Surge 规则（导入过才有意义）。 */
  useSurgeRules: boolean;
}

/** TUN 协议栈（与 SDK 的 `TunnelStack` 同一组值）。 */
export type TunStack = "mixed" | "system" | "gvisor";

/** 与 manifest 里的默认值逐项相同：宿主没给（旧版本宿主、还没写过偏好）时按它算。 */
export const defaultPreferences: Readonly<ProxyPreferences> = {
  mixedPort: 7890,
  controlPort: 19090,
  systemProxy: true,
  autoStart: false,
  chinaRules: true,
  testURL: "https://www.gstatic.com/generate_204",
  singBoxPath: "",
  updateInterval: "daily",
  showSpeed: false,
  speedInterval: 1,
  tun: false,
  dnsMode: "fakeip",
  tunStack: "mixed",
  useSurgeRules: true,
};

/**
 * 把宿主给的偏好读成完整、合法的一份：缺的、类型不对的、越界的一律回到默认。
 * @param raw `preferences.all()` 或事件里带的偏好。
 * @returns 偏好。
 */
export function normalizePreferences(raw: Record<string, unknown> | undefined): ProxyPreferences {
  const source = raw ?? {};
  const port = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : fallback;
  const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
  const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value.trim() : fallback);
  const testURL = text(source.testURL, defaultPreferences.testURL);
  const interval = source.updateInterval;
  return {
    mixedPort: port(source.mixedPort, defaultPreferences.mixedPort),
    controlPort: port(source.controlPort, defaultPreferences.controlPort),
    systemProxy: flag(source.systemProxy, defaultPreferences.systemProxy),
    autoStart: flag(source.autoStart, defaultPreferences.autoStart),
    chinaRules: flag(source.chinaRules, defaultPreferences.chinaRules),
    // sing-box 的测速只认 https（`http://` 开头的地址会被它丢掉、换成默认地址）：填错了就用默认，免得读数与填的对不上。
    testURL: /^https:\/\/\S+$/i.test(testURL) ? testURL : defaultPreferences.testURL,
    singBoxPath: text(source.singBoxPath, ""),
    updateInterval: updateIntervals.includes(interval as UpdateInterval) ? (interval as UpdateInterval) : defaultPreferences.updateInterval,
    showSpeed: flag(source.showSpeed, defaultPreferences.showSpeed),
    speedInterval:
      typeof source.speedInterval === "number" && Number.isFinite(source.speedInterval)
        ? Math.min(60, Math.max(1, Math.round(source.speedInterval)))
        : defaultPreferences.speedInterval,
    tun: flag(source.tun, defaultPreferences.tun),
    dnsMode: source.dnsMode === "realip" ? "realip" : "fakeip",
    tunStack: source.tunStack === "system" || source.tunStack === "gvisor" ? source.tunStack : "mixed",
    useSurgeRules: flag(source.useSurgeRules, defaultPreferences.useSurgeRules),
  };
}

// MARK: - 选择

/** 用户选的出站模式与节点（存储 `selection`）。 */
export interface Selection {
  mode: ProxyMode;
  /** 「节点选择」选中的组员：节点名或「自动选择」。 */
  node: string;
  /**
   * 上一版在菜单 / 面板里拨过的增强模式；`null` = 没拨过。**只读来迁移**：读到布尔值时写进偏好 `tun` 再清掉（`ProxyCore.migrateTunSelection`），
   * 是否用增强模式只看偏好（W-6）。
   */
  tun: boolean | null;
  /** 导入的策略组各选了谁（组名 → 组员 tag）。 */
  groups: Record<string, string>;
}

export const defaultSelection: Readonly<Selection> = { mode: "rule", node: URLTEST_TAG, tun: null, groups: {} };

/**
 * @param raw 存储里读出来的值。
 * @returns 合法的选择。
 */
export function normalizeSelection(raw: unknown): Selection {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const mode = Object.prototype.hasOwnProperty.call(clashModeNames, value.mode as string) ? (value.mode as ProxyMode) : defaultSelection.mode;
  const node = typeof value.node === "string" && value.node.length > 0 ? value.node : defaultSelection.node;
  const tun = typeof value.tun === "boolean" ? value.tun : null;
  const groups: Record<string, string> = {};
  if (typeof value.groups === "object" && value.groups !== null) {
    for (const [name, member] of Object.entries(value.groups as Record<string, unknown>)) if (typeof member === "string") groups[name] = member;
  }
  return { mode, node, tun, groups };
}

/**
 * 这一次开启用不用增强模式：只看偏好 `tun`（W-6：菜单、工具箱、设置页同一份真源）。
 * @param preferences 偏好。
 * @returns 用不用。
 */
export function wantsTunnel(preferences: ProxyPreferences): boolean {
  return preferences.tun;
}

/** 出站模式的中文名。 */
export const modeTitles: Readonly<Record<ProxyMode, string>> = { rule: "规则", global: "全局", direct: "直连" };

/** 出站模式的一句话说明。 */
export const modeHelps: Readonly<Record<ProxyMode, string>> = {
  rule: "局域网与中国大陆直连，其余走所选节点",
  global: "除局域网外全部走所选节点",
  direct: "全部直连，代理开着也不经过节点",
};

/** 协议的短名（节点行的说明里用）。 */
export const protocolTitles: Readonly<Record<ProxyProtocol, string>> = {
  shadowsocks: "Shadowsocks",
  vmess: "VMess",
  vless: "VLESS",
  trojan: "Trojan",
  hysteria2: "Hysteria2",
  tuic: "TUIC",
};

// MARK: - 处在哪一步

/** 需要用户点头的能力：没有它就什么都做不了。 */
export const requiredCapability = "process.daemon";

/**
 * 此刻处在哪一步：
 * - `notGranted`：没授权常驻进程；
 * - `notInstalled`：找不到 sing-box（填的路径坏了也算）；
 * - `noNodes`：没有节点（没填订阅、或一条都没拉下来）；
 * - `running`：内核在跑；
 * - `failed`：上一次起不来或意外退出了，还没被用户关掉 / 重新开启；
 * - `stopped`：关着。
 */
export type Phase = "notGranted" | "notInstalled" | "noNodes" | "running" | "failed" | "stopped";

/** 存储里的失败记录。 */
export interface FailureRecord {
  at: number;
  /** 一句话。 */
  message: string;
  /** 内核输出的最后几行（至多 20 行）。 */
  lines: string[];
  /** 下一步怎么办；没有为空串。 */
  hint: string;
}

/** 判断用的事实。 */
export interface PhaseInput {
  granted: readonly string[];
  /** `daemon.status`；读不出为 `null`。 */
  daemon: DaemonStatus | null;
  /** `tunnel.status`（SDK 2.10）；没授权、读不出为 `null`。 */
  tunnel?: TunnelStatus | null;
  nodeCount: number;
  failure: FailureRecord | null;
}

/**
 * @param input 事实。
 * @returns 处在哪一步。
 */
export function phaseOf(input: PhaseInput): Phase {
  if (!input.granted.includes(requiredCapability)) return "notGranted";
  if (input.daemon?.state === "running" || input.tunnel?.state === "running") return "running";
  if (input.daemon && input.daemon.executable === "") return "notInstalled";
  if (input.nodeCount === 0) return "noNodes";
  if (input.failure || input.daemon?.state === "exited" || input.tunnel?.state === "exited") return "failed";
  return "stopped";
}

/**
 * 此刻在跑的是哪一个内核。
 * @param daemon `daemon.status`。
 * @param tunnel `tunnel.status`。
 * @returns 内核；都没在跑为 `null`。
 */
export function runningKernel(daemon: DaemonStatus | null, tunnel: TunnelStatus | null | undefined): KernelKind | null {
  if (tunnel?.state === "running") return "tunnel";
  if (daemon?.state === "running") return "daemon";
  return null;
}

/** 增强模式此刻该怎么说。 */
export interface TunCondition {
  /** 授权了 `network.tunnel`。 */
  granted: boolean;
  /** 想用（拨过的或偏好）。 */
  wanted: boolean;
  /** 在跑。 */
  active: boolean;
  /** 网络助手的样子；读不出为 `null`。 */
  helper: TunnelHelperState | null;
  /** 用户那份 sing-box 与 root 目录里的副本是不是同一版。 */
  matchesInstalled: boolean;
  /** 别的 VPN 占着主网卡时的原话；没有为 `null`。 */
  blocker: string | null;
}

/**
 * 增强模式那一项下面的灰字：拦着、要密码、版本变了、没授权。
 * @param tun 状况。
 * @returns 一句话；没什么要说的为 `null`。
 */
export function tunSubtitle(tun: TunCondition): string | null {
  if (!tun.granted) return "还没有授权：打开「代理」点授权";
  if (tun.blocker) return tun.blocker;
  if (tun.active) return "整机网络经过 sing-box（命令行工具也是）";
  if (tun.helper === "notInstalled" || tun.helper === null) return "第一次打开要输一次管理员密码，装上网络助手";
  if (tun.helper === "outdated") return "网络助手要更新：打开时再要一次管理员密码";
  if (tun.helper === "unreachable") return "网络助手装了但连不上：打开时重装一次（要管理员密码）";
  if (!tun.matchesInstalled) return "sing-box 换了版本：打开时再要一次管理员密码，把新版拷进去";
  return null;
}

// MARK: - 失败怎么说

/**
 * sing-box 起不来是不是因为规则集第一次下载失败（`route/rule/rule_set_remote.go`：「initial rule-set: <tag>」）。
 * 是的话不分流再起一次就能用。
 * @param text 错误与输出。
 * @returns 是不是。
 */
export function isRuleSetFailure(text: string): boolean {
  return /initial rule-set/i.test(text);
}

/**
 * 从内核的输出里读出「为什么起不来 / 为什么连不上」与下一步。按常见程度排：端口被占、规则集、版本太旧、REALITY 握手。
 * @param lines 输出的最后几行。
 * @param preferences 偏好（说清是哪个端口）。
 * @returns 一句话与下一步。
 */
/**
 * 内核的输出是不是「端口被占着」（jarvis-mac `specs/20261028-130540-proxy-walkthrough-fixes` W-4）。
 * @param lines 输出。
 * @returns 是为 `true`。
 */
export function isPortConflict(lines: readonly string[]): boolean {
  return /address already in use/i.test(lines.join("\n"));
}

export function describeFailure(lines: readonly string[], preferences: ProxyPreferences): { message: string; hint: string } {
  const text = lines.join("\n");
  const last = lastMeaningfulLine(lines);
  const portMatch = /listen tcp [^:\s]*:(\d+).*address already in use/i.exec(text) ?? /:(\d+): bind: address already in use/i.exec(text);
  if (portMatch || /address already in use/i.test(text)) {
    const port = portMatch ? Number(portMatch[1]) : null;
    const which = port === preferences.controlPort ? "控制端口" : port === preferences.mixedPort ? "本地端口" : "端口";
    return {
      message: port ? `${which} ${port} 被别的程序占着` : "端口被别的程序占着",
      hint: `在设置里换一个${which === "端口" ? "本地端口或控制端口" : which}，或者先关掉占着它的程序。`,
    };
  }
  if (isRuleSetFailure(text)) {
    return { message: "中国大陆分流规则集下载失败", hint: "检查网络后重试；或者在设置里关掉「中国大陆直连」，不分流运行。" };
  }
  if (/unknown field|unknown (?:transport|obfs|outbound|inbound) type|decode config/i.test(text)) {
    return { message: "sing-box 不认识这份配置", hint: "装着的 sing-box 可能太旧（需要 1.12 以上）。在终端里运行 brew upgrade sing-box 之后重试。" };
  }
  if (/reality/i.test(text) && /(handshake|verif|invalid|processed invalid connection|EOF)/i.test(text)) {
    return {
      message: "REALITY 握手失败",
      hint: "sing-box 版本太旧时连不上新的 REALITY 服务端。在终端里运行 brew upgrade sing-box 之后重试；仍不行就换一个节点。",
    };
  }
  return { message: last || "sing-box 没能启动", hint: "" };
}

/**
 * 最后一行有内容的输出，去掉时间戳与颜色码前缀，给横幅与菜单用。
 * @param lines 输出。
 * @returns 一行；没有为空串。
 */
export function lastMeaningfulLine(lines: readonly string[]): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/^[+-]\d{4} \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+/, "")
      .trim();
    if (line.length > 0) return line;
  }
  return "";
}

// MARK: - 要不要重开 / 重新载入

/**
 * 在跑的那一份与此刻的偏好有哪些不一样、**只能重开**才用得上（端口要重新监听；控制口是宿主在启动时记下的；内核换了）。
 * @param control 在跑的那一份。
 * @param preferences 此刻的偏好。
 * @param wantedKernel 此刻想用的内核；不比较为 `null`。
 * @returns 不一样的地方（给人看）；一样为空数组。
 */
export function restartReasons(control: ControlRecord | null, preferences: ProxyPreferences, wantedKernel: KernelKind | null = null): string[] {
  if (!control) return [];
  const reasons: string[] = [];
  if (control.mixedPort !== preferences.mixedPort) reasons.push("本地端口改过");
  if (control.controlPort !== preferences.controlPort) reasons.push("控制端口改过");
  if (wantedKernel !== null && (control.kernel ?? "daemon") !== wantedKernel) reasons.push(wantedKernel === "tunnel" ? "增强模式打开了" : "增强模式关掉了");
  return reasons;
}

/**
 * 在跑的那一份与此刻有哪些不一样、**重新载入**（换配置不断进程）就用得上：节点、规则、测速地址、分流。
 * @param control 在跑的那一份。
 * @param preferences 此刻的偏好。
 * @param digestNow 存储里最新节点的摘要。
 * @param rulesDigestNow 此刻的规则摘要（页面规则、导入的配置、外部规则集、DNS 模式）；不比较为 `null`。
 * @returns 不一样的地方；一样为空数组。
 */
export function reloadReasons(control: ControlRecord | null, preferences: ProxyPreferences, digestNow: string, rulesDigestNow: string | null = null): string[] {
  if (!control) return [];
  const reasons: string[] = [];
  if (control.nodesDigest !== digestNow) reasons.push("订阅更新过");
  if (control.testURL !== preferences.testURL) reasons.push("延迟测试地址改过");
  // 规则集下载失败、这一次没分流的不算：那不是用户改的，重载也未必下得下来。
  if (control.chinaRules !== preferences.chinaRules && !control.ruleSetFallback) reasons.push("中国大陆直连改过");
  if (rulesDigestNow !== null && control.rulesDigest !== undefined && control.rulesDigest !== rulesDigestNow) reasons.push("规则改过");
  return reasons;
}

// MARK: - 指令参数

/** `/proxy` 后面那段字的意思：开关，或者换模式（`tun` = 增强模式、`notun` = 系统代理模式）。 */
export type ToggleIntent = "on" | "off" | "toggle" | "tun" | "notun";

/**
 * `/proxy`（切换）、`/proxy 开`、`/proxy 关`、`/proxy tun`（增强模式）、`/proxy 系统代理`。
 * @param argument 指令后面那段字。
 * @returns 意思；认不出为 `null`。
 */
export function parseToggleArgument(argument: string | undefined): ToggleIntent | null {
  const value = (argument ?? "").trim().toLowerCase();
  if (value === "") return "toggle";
  if (/^(开|开启|打开|启动|on|start|enable)$/.test(value)) return "on";
  if (/^(关|关闭|停止|停|off|stop|disable)$/.test(value)) return "off";
  if (/^(tun|增强|增强模式|enhanced)$/.test(value)) return "tun";
  if (/^(系统代理|普通|notun|system|proxy)$/.test(value)) return "notun";
  return null;
}

// MARK: - 系统代理说什么

/** 系统代理此刻的状况（开着的时候才有意义）。 */
export type SystemProxyCondition =
  /** 指着我们。 */
  | { kind: "active" }
  /** 被别的工具拦着（Surge 增强模式这一类），带它的原话。 */
  | { kind: "blocked"; message: string }
  /** 另一个扩展接管着。 */
  | { kind: "other"; message: string }
  /** 没授权修改系统代理。 */
  | { kind: "notGranted" }
  /** 没指向我们（偏好里关着，或用户在菜单里关了）。 */
  | { kind: "off" };

/**
 * @param proxy `systemProxy.status`；读不出为 `null`。
 * @param granted 已授予的能力。
 * @returns 状况。
 */
export function systemProxyCondition(proxy: SystemProxyStatus | null, granted: readonly string[]): SystemProxyCondition {
  if (!granted.includes("system.proxy")) return { kind: "notGranted" };
  if (!proxy) return { kind: "off" };
  if (proxy.blocker) return { kind: "blocked", message: proxy.blocker.message };
  if (proxy.owner === "other") return { kind: "other", message: `系统代理已由「${proxy.otherName ?? "另一个扩展"}」接管` };
  if (proxy.owner === "self") return { kind: "active" };
  return { kind: "off" };
}

// MARK: - 菜单栏（Surge 式，T-11）

/** 整份菜单至多几项（宿主的上限）：节点列多少由剩下的位置决定。 */
export const maximumMenuItems = 300;

/** 菜单里节点子菜单至多列几个（位置够的时候）。 */
export const maximumMenuNodes = 250;

/** 「最近请求」至多列几条：每条是一个三项的子菜单，十几条已经是一屏。 */
export const maximumRecentRequests = 12;

/** 导入的一个策略组（菜单与面板画它）。 */
export interface GroupView {
  /** Surge 里的名字。 */
  name: string;
  /** 配置里的 tag（撞名时带「 · Surge」）。 */
  tag: string;
  /** 组员（tag 与给人看的名字）。 */
  members: { tag: string; title: string }[];
  /** 此刻选中的组员 tag。 */
  selected: string;
}

/** 「当前页面」读到了什么。 */
export interface PageView {
  /** 浏览器的名字；从没用过浏览器为 `null`。 */
  browser: string | null;
  /** 地址栏的主机；读不出为空串。 */
  host: string;
  status: BrowserActiveTabStatus | "notGranted" | "none";
  message: string;
  domains: PageDomain[];
}

/** 菜单栏要的事实。 */
export interface MenuInput {
  phase: Phase;
  preferences: ProxyPreferences;
  selection: Selection;
  nodes: readonly { name: string; protocol: ProxyProtocol }[];
  /** 节点名 → 毫秒（`null` = 超时）。没测过的不在里面。 */
  latency: Readonly<Record<string, number | null>>;
  proxy: SystemProxyStatus | null;
  granted: readonly string[];
  /** 「自动选择」此刻选中的节点；不知道为 `null`。 */
  autoPick: string | null;
  /** 速率；算不出为 `null`。 */
  rate: TrafficRate | null;
  failure: FailureRecord | null;
  /** 正在做的事（开启中、测速中……）；没有为 `null`。 */
  busy: string | null;
  /** 在跑的内核；没在跑为 `null`。 */
  kernel?: KernelKind | null;
  /** 增强模式此刻的状况；省略 = 没有 TUN 这一项（旧宿主）。 */
  tun?: TunCondition | null;
  /** 导入的策略组。 */
  groups?: readonly GroupView[];
  /** 当前页面；没读为 `null`。 */
  page?: PageView | null;
  pageRules?: readonly PageRule[];
  /** 最近的请求（新的在前）。 */
  recent?: readonly Attempt[];
  /** 有效速率与成败（外圈那一份）。 */
  reading?: TrafficReading | null;
  /** 最近一分钟的有效速率（旧的在前），菜单顶部那块曲线。 */
  history?: { upload: number[]; download: number[] } | null;
  /** 菜单栏两行写的那一份：最近 `speedInterval` 秒的平均有效速率（W-2）；还没攒满第一段时为 `null`，回落到 `reading`。 */
  titleRate?: { upload: number; download: number } | null;
}

/**
 * 菜单栏图标旁那两行：`↓ 34K` / `↑1.2K`，下行在上（用户关心的是下行）。
 * @param rate 字节 / 秒。
 * @returns 两行（`\n` 分隔），每行恰好 5 个字符。
 */
export function speedTitle(rate: { upload: number; download: number }): string {
  return `↓${fixedRate(rate.download)}\n↑${fixedRate(rate.upload)}`;
}

/**
 * 菜单项的文字至多 80 字。剪掉不补「…」：仓库主人定过，按钮与菜单项的文字结尾不带省略号。
 * @param text 原文。
 * @returns 至多 80 个码元。
 */
export function menuText(text: string): string {
  if (text.length <= 80) return text;
  let cut = text.slice(0, 80);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut;
}

/**
 * 节点在菜单里的 id：`node:<序号>`（名字里有中文、空格，进不了 id 的字符集）。`node:auto` 是「自动选择」。
 * @param index 在节点列表里的序号；`-1` = 自动选择。
 * @returns id。
 */
export function nodeItemId(index: number): string {
  return index < 0 ? "node:auto" : `node:${index}`;
}

/** 菜单里给一个域名选策略时的写法：`proxy` / `direct` / `reject` / `clear`（删掉页面规则）/ `g<组序号>`。 */
export type MenuPolicy = "proxy" | "direct" | "reject" | "clear" | `g${number}`;

/** 菜单里一项被点了，是哪一类。 */
export type MenuAction =
  | { kind: "toggle" }
  | { kind: "systemProxy" }
  | { kind: "tun" }
  | { kind: "mode"; mode: ProxyMode }
  | { kind: "node"; index: number }
  | { kind: "group"; group: number; member: number }
  | { kind: "page"; domain: number; policy: MenuPolicy }
  | { kind: "recent"; request: number; policy: MenuPolicy }
  | { kind: "test" }
  | { kind: "update" }
  | { kind: "reload" }
  | { kind: "import" }
  | { kind: "rules" }
  | { kind: "copy" }
  | { kind: "install" };

/**
 * @param id 菜单项 id。
 * @returns 动作；不认识为 `null`。
 */
export function parseMenuItemId(id: string): MenuAction | null {
  switch (id) {
    case "toggle":
    case "systemProxy":
    case "tun":
    case "test":
    case "update":
    case "reload":
    case "import":
    case "rules":
    case "copy":
    case "install":
      return { kind: id };
  }
  const mode = /^mode:(rule|global|direct)$/.exec(id);
  if (mode) return { kind: "mode", mode: mode[1] as ProxyMode };
  if (id === "node:auto") return { kind: "node", index: -1 };
  const node = /^node:(\d+)$/.exec(id);
  if (node) return { kind: "node", index: Number(node[1]) };
  const group = /^group:(\d+):(\d+)$/.exec(id);
  if (group) return { kind: "group", group: Number(group[1]), member: Number(group[2]) };
  const pick = /^(page|recent):(\d+):(proxy|direct|reject|clear|g\d+)$/.exec(id);
  if (pick) {
    const index = Number(pick[2]);
    const policy = pick[3] as MenuPolicy;
    return pick[1] === "page" ? { kind: "page", domain: index, policy } : { kind: "recent", request: index, policy };
  }
  return null;
}

/**
 * 菜单里的策略写法 → 页面规则的策略。
 * @param policy 写法。
 * @param groups 导入的策略组。
 * @returns 策略；`clear` 与认不出的组为 `null`。
 */
export function menuPolicyRef(policy: MenuPolicy, groups: readonly GroupView[]): PolicyRef | null {
  if (policy === "proxy" || policy === "direct" || policy === "reject") return policy;
  if (policy === "clear") return null;
  const group = groups[Number(policy.slice(1))];
  return group ? `group:${group.name}` : null;
}

/**
 * 状态行（菜单里的段标题、面板里的那一句）。
 * @param input 事实。
 * @returns 一句话。
 */
export function statusLine(input: Pick<MenuInput, "phase" | "preferences" | "selection" | "busy" | "failure"> & { kernel?: KernelKind | null }): string {
  if (input.busy) return input.busy;
  switch (input.phase) {
    case "notGranted":
      return "还没授权：打开「代理」点授权";
    case "notInstalled":
      return input.preferences.singBoxPath ? "设置里选的 sing-box 路径不可用" : "没有找到 sing-box";
    case "noNodes":
      return "没有节点：在设置里填订阅地址";
    case "running":
      return input.kernel === "tunnel"
        ? `已开启 · ${modeTitles[input.selection.mode]} · 增强模式`
        : `已开启 · ${modeTitles[input.selection.mode]} · 127.0.0.1:${input.preferences.mixedPort}`;
    case "failed":
      return menuText(`出错了：${input.failure?.message ?? "sing-box 退出了"}`);
    default:
      return "已关闭";
  }
}

/** 一个组员的名字（`direct` 给人看是「直连」）。 */
export function memberTitle(tag: string): string {
  return tag === DIRECT_TAG ? "直连" : tag;
}

/** 数一列菜单项有几项（含子菜单里的）。 */
export function countMenuItems(items: readonly MenuBarItem[]): number {
  return items.reduce((total, item) => total + 1 + (item.kind === "submenu" ? countMenuItems(item.items) : 0), 0);
}

/** 给一个域名 / 一条请求选策略的那几项（勾 = 此刻的页面规则）。 */
function policyItems(prefix: string, current: PolicyRef | null, groups: readonly GroupView[], withGroups: boolean, enabled: boolean): MenuBarItem[] {
  const items: MenuBarItem[] = (["proxy", "direct", "reject"] as const).map((policy) => ({
    kind: "item" as const,
    id: `${prefix}:${policy}`,
    title: policyTitle(policy),
    checked: current === policy,
    enabled,
  }));
  if (withGroups && groups.length > 0) {
    items.push({ kind: "separator" });
    groups.forEach((group, index) => {
      const ref: PolicyRef = `group:${group.name}`;
      items.push({ kind: "item", id: `${prefix}:g${index}`, title: menuText(policyTitle(ref)), checked: current === ref, enabled });
    });
  }
  if (current !== null) {
    items.push({ kind: "separator" });
    items.push({ kind: "item", id: `${prefix}:clear`, title: "删掉这条规则", symbol: "trash", enabled });
  }
  return items;
}

/** 「当前页面」那一个子菜单。 */
function pageSubmenu(input: MenuInput, groups: readonly GroupView[]): MenuBarItem {
  const page = input.page ?? null;
  const rules = input.pageRules ?? [];
  const items: MenuBarItem[] = [];
  let title = "当前页面";
  if (!input.granted.includes("browser.activeTab")) {
    items.push({ kind: "header", title: "还没有授权读取浏览器当前页：打开「代理」点授权" });
  } else if (!page || page.status === "none") {
    items.push({ kind: "header", title: "还没用过浏览器：在 Safari、Chrome 等里打开一页再来" });
  } else {
    if (page.host) title = menuText(`当前页面 · ${page.host}`);
    const where = page.browser ? `${page.browser}${page.host ? ` · ${page.host}` : ""}` : page.host;
    if (page.status !== "ok") items.push({ kind: "header", title: menuText(page.message || `读不到${page.browser ?? "浏览器"}的地址`) });
    else items.push({ kind: "header", title: menuText(where) });
    if (page.domains.length === 0) {
      items.push({ kind: "item", id: "page-empty", title: "这一页还没有经过代理的连接", enabled: false });
    }
    page.domains.forEach((domain, index) => {
      const rule = pageRuleFor(rules, domain.domain);
      const parts = [domain.domain];
      if (rule) parts.push(policyTitle(rule.policy));
      else if (domain.route) parts.push(`此刻 ${memberTitle(domain.route)}`);
      if (domain.failed > 0) parts.push(`${domain.failed} 失败`);
      const children: MenuBarItem[] = [];
      if (domain.hosts.length > 0) children.push({ kind: "header", title: menuText(domain.hosts.join("、")) });
      children.push(...policyItems(`page:${index}`, rule?.policy ?? null, groups, true, input.busy === null));
      items.push({ kind: "submenu", title: menuText(parts.join(" · ")), symbol: domain.isPage ? "globe" : "link", items: children });
    });
  }
  return { kind: "submenu", title, symbol: "safari", items };
}

/** 「最近请求」那一个子菜单。 */
function recentSubmenu(input: MenuInput): MenuBarItem | null {
  const recent = (input.recent ?? []).slice(0, maximumRecentRequests);
  if (input.phase !== "running") return null;
  const rules = input.pageRules ?? [];
  const items: MenuBarItem[] =
    recent.length === 0
      ? [{ kind: "item", id: "recent-empty", title: "还没有请求", enabled: false }]
      : recent.map((attempt, index) => {
          const failed = attempt.outcome === "failed";
          const rule = pageRuleFor(rules, attempt.host);
          const status = failed ? `失败：${attempt.reason}` : attempt.outcome === "pending" ? "进行中" : `成功${attempt.chains.length > 0 ? ` · ${memberTitle(attempt.chains[attempt.chains.length - 1])}` : ""}`;
          return {
            kind: "submenu" as const,
            title: menuText(`${failed ? "✕ " : ""}${attempt.host}${attempt.port && attempt.port !== 443 && attempt.port !== 80 ? `:${attempt.port}` : ""}`),
            items: [
              { kind: "item" as const, id: `recent-info:${index}`, title: menuText(status), ...(failed ? { tone: "critical" as const } : { tone: "secondary" as const }), enabled: false },
              { kind: "separator" as const },
              ...policyItems(`recent:${index}`, rule?.policy ?? null, [], false, input.busy === null),
            ],
          };
        });
  return { kind: "submenu", title: "最近请求", symbol: "clock.arrow.circlepath", items };
}

/**
 * 菜单栏模型（Surge 式：顶部一块流量曲线、开关、增强模式、出站模式、策略组、当前页面、最近请求、动作）。
 * 宿主在末尾自己追加「打开「代理」」与「「代理」的设置」，这里不写它们。整份不超过 300 项：节点列多少由剩下的位置决定。
 * @param input 事实。
 * @returns 模型。
 */
export function buildMenuModel(input: MenuInput): MenuBarModel {
  const running = input.phase === "running";
  const tunActive = running && input.kernel === "tunnel";
  const symbol = tunActive ? "network.badge.shield.half.filled" : running ? "network" : input.phase === "failed" ? "exclamationmark.triangle" : "network.slash";
  const groups = input.groups ?? [];
  const head: MenuBarItem[] = [];
  const reading = input.reading ?? null;
  const history = input.history ?? null;
  if (running && history && (history.download.length > 1 || history.upload.length > 1)) {
    const caption = reading ? `↓ ${shortRate(reading.download)}B/s  ↑ ${shortRate(reading.upload)}B/s · 10 秒内成功 ${reading.succeeded}、失败 ${reading.failed}` : undefined;
    head.push({
      kind: "chart",
      series: [
        { tone: "download", values: history.download.slice(-120) },
        { tone: "upload", values: history.upload.slice(-120) },
      ],
      ...(caption ? { caption: menuText(caption) } : {}),
    });
  }
  head.push({ kind: "header", title: menuText(statusLine(input)) });

  if (input.phase === "notInstalled") {
    if (!input.preferences.singBoxPath && input.granted.includes("terminal.run")) {
      head.push({ kind: "item", id: "install", title: "在终端中安装 sing-box", symbol: "terminal" });
    }
  } else if (input.phase !== "notGranted" && input.phase !== "noNodes") {
    head.push({
      kind: "item",
      id: "toggle",
      title: running ? "关闭代理" : "开启代理",
      symbol: running ? "stop.circle" : "play.circle",
      enabled: input.busy === null,
    });
  }

  const condition = systemProxyCondition(input.proxy, input.granted);
  const proxySubtitle =
    condition.kind === "blocked" || condition.kind === "other"
      ? condition.message
      : condition.kind === "notGranted"
        ? "没有授权修改系统代理"
        : undefined;
  head.push({ kind: "separator" });
  head.push({
    kind: "item",
    id: "systemProxy",
    title: "设为系统代理",
    ...(proxySubtitle ? { subtitle: menuText(proxySubtitle) } : {}),
    checked: running && condition.kind === "active",
    enabled: running && input.busy === null && condition.kind !== "notGranted" && condition.kind !== "other",
  });
  if (input.tun) {
    const subtitle = tunSubtitle({ ...input.tun, active: tunActive });
    head.push({
      kind: "item",
      id: "tun",
      title: "增强模式（TUN）",
      ...(subtitle ? { subtitle: menuText(subtitle) } : {}),
      checked: running ? tunActive : input.tun.wanted,
      enabled: input.tun.granted && input.busy === null && input.phase !== "notGranted" && input.phase !== "notInstalled",
    });
  }
  head.push({
    kind: "submenu",
    title: `出站模式 · ${modeTitles[input.selection.mode]}`,
    items: (Object.keys(modeTitles) as ProxyMode[]).map((mode) => ({
      kind: "item" as const,
      id: `mode:${mode}`,
      title: modeTitles[mode],
      subtitle: modeHelps[mode],
      checked: input.selection.mode === mode,
    })),
  });

  const groupItems: MenuBarItem[] = groups.map((group, groupIndex) => ({
    kind: "submenu" as const,
    title: menuText(`${group.name} · ${memberTitle(group.selected)}`),
    items: group.members.map((member, memberIndex) => ({
      kind: "item" as const,
      id: `group:${groupIndex}:${memberIndex}`,
      title: menuText(memberTitle(member.title)),
      checked: group.selected === member.tag,
    })),
  }));

  const tail: MenuBarItem[] = [];
  if (input.phase !== "notGranted") {
    tail.push({ kind: "separator" });
    tail.push(pageSubmenu(input, groups));
    const recent = recentSubmenu(input);
    if (recent) tail.push(recent);
  }
  tail.push({ kind: "separator" });
  tail.push({ kind: "item", id: "test", title: "测速", symbol: "speedometer", enabled: running && input.busy === null && input.nodes.length > 0 });
  tail.push({ kind: "item", id: "update", title: "更新订阅与规则集", symbol: "arrow.clockwise", enabled: input.busy === null });
  tail.push({ kind: "item", id: "reload", title: "重新载入配置", symbol: "arrow.triangle.2.circlepath", enabled: running && input.busy === null });
  tail.push({ kind: "item", id: "import", title: "导入 Surge 配置", symbol: "square.and.arrow.down" });
  tail.push({ kind: "item", id: "rules", title: "规则", symbol: "list.bullet.rectangle" });
  tail.push({ kind: "item", id: "copy", title: "复制终端代理命令", symbol: "doc.on.clipboard", enabled: input.granted.includes("clipboard.write") });

  const items: MenuBarItem[] = [...head];
  if (input.nodes.length > 0 || groups.length > 0) {
    items.push({ kind: "separator" });
    if (groups.length > 0) items.push({ kind: "header", title: "策略组" });
  }
  if (input.nodes.length > 0) {
    // 节点占剩下的位置：别的部分都放下之后还剩几项，节点就列几个（至少 20 个）。
    const others = countMenuItems(items) + countMenuItems(groupItems) + countMenuItems(tail) + 4;
    const room = Math.max(20, Math.min(maximumMenuNodes, maximumMenuItems - others));
    const shown = input.nodes.slice(0, room);
    const autoSubtitle = input.autoPick && running ? `此刻：${input.autoPick}` : "按延迟自动挑最快的";
    const nodeItems: MenuBarItem[] = [
      { kind: "item", id: nodeItemId(-1), title: URLTEST_TAG, subtitle: menuText(autoSubtitle), checked: input.selection.node === URLTEST_TAG },
      { kind: "separator" },
      ...shown.map((node, index) => {
        const delay = formatDelay(input.latency[node.name]);
        return {
          kind: "item" as const,
          id: nodeItemId(index),
          title: menuText(node.name),
          subtitle: delay ? `${protocolTitles[node.protocol]} · ${delay}` : protocolTitles[node.protocol],
          checked: input.selection.node === node.name,
        };
      }),
    ];
    if (input.nodes.length > shown.length) {
      nodeItems.push({ kind: "item", id: "nodes-more", title: `另有 ${input.nodes.length - shown.length} 个节点，在「代理」窗口里看`, enabled: false });
    }
    items.push({ kind: "submenu", title: menuText(`${SELECTOR_TAG} · ${input.selection.node}`), items: nodeItems });
  }
  items.push(...groupItems, ...tail);

  const model: MenuBarModel = { symbol, items, tooltip: menuText(`代理 · ${statusLine(input)}`) };
  if (running && input.preferences.showSpeed) {
    // 两行、每行恰好「箭头 + 4 个字符」：宿主用等宽字体画，读数怎么变状态项都不伸缩（W-2）。
    const shown = input.titleRate ?? (reading ? { upload: reading.upload, download: reading.download } : input.rate ? { upload: input.rate.up, download: input.rate.down } : null);
    if (shown) model.title = speedTitle(shown);
  }
  return model;
}
