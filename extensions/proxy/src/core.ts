/**
 * 「代理」的动作：开、关、切模式、切节点、测速、更新订阅、读流量——前台页面与后台会话（菜单栏、指令）共用这一份。
 *
 * 两个会话各有一个 `ProxyCore`，内存互不相通（P-7）。所以这里**不把任何要跨会话看到的东西只放在内存里**：
 * 常驻进程与系统代理每次现问宿主（`daemon.status`、`systemProxy.status`），其余（节点、选择、延迟、控制口 secret、失败）
 * 一律落 `jarvis.storage`，另一个会话下一次读就看得见。内存里只留「这个会话正在做什么」（`busy`）与刚测出、还没落盘的延迟。
 */
import { jarvis, sleep, type DaemonResponse, type DaemonStatus, type SystemProxyStatus } from "@fusionseek/jarvis-extension-sdk";
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
import { dedupeNodeNames, SELECTOR_TAG, URLTEST_TAG, type ProxyNode } from "./nodes.js";
import { buildConfig, clashModeNames, terminalProxyCommand, type ProxyMode } from "./singbox-config.js";
import {
  describeFailure,
  isRuleSetFailure,
  normalizePreferences,
  normalizeSelection,
  phaseOf,
  requiredCapability,
  type FailureRecord,
  type Phase,
  type ProxyPreferences,
  type Selection,
} from "./status.js";
import {
  chunkNodes,
  headerValue,
  nextRecord,
  nodeChunkKey,
  nodesDigest,
  parseSubscriptionUserinfo,
  storageKeys,
  subscriptionId,
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

/** 等内核就绪（Clash API 开始答话）至多多久。远程规则集第一次下载就在这段时间里，30 秒足够慢网络把两份几十 KB 的文件拉完。 */
const readyTimeoutMs = 30_000;

/** 控制口请求的默认超时（秒）。 */
const requestTimeoutSeconds = 10;

/** 全部能力：页面上「授权」一次问完。 */
export const allCapabilities = ["process.daemon", "system.proxy", "network.https", "terminal.run", "notifications.post", "clipboard.write"] as const;

/** 一次读到的全部事实。 */
export interface Snapshot {
  granted: string[];
  preferences: ProxyPreferences;
  daemon: DaemonStatus | null;
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

  /** 偏好里的订阅地址（进钥匙串的 `urlList`，只能单独读）。 */
  async subscriptionURLs(): Promise<string[]> {
    try {
      const value = await jarvis.preferences.get<unknown>("subscriptions");
      return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string" && /^https:\/\//i.test(url.trim())).map((url) => url.trim()) : [];
    } catch {
      return [];
    }
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

  /** 用户选的模式与节点（未按节点列表校正）。 */
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

  /**
   * 读全部事实。
   * @param context 事件里带来的授权与偏好（菜单栏、指令）；省略时现问。
   * @returns 快照。
   */
  async snapshot(context: { granted?: string[]; preferences?: Record<string, unknown> } = {}): Promise<Snapshot> {
    const granted = context.granted ?? (await this.granted());
    const preferences = await this.preferences(context.preferences);
    const records = await this.records();
    const [nodes, selection, latency, control, failure, subscriptionCount] = await Promise.all([
      this.nodes(records),
      this.selection(),
      this.latency(),
      this.control(),
      read<FailureRecord>(storageKeys.failure),
      this.subscriptionURLs().then((urls) => urls.length),
    ]);
    let daemon: DaemonStatus | null = null;
    let proxy: SystemProxyStatus | null = null;
    if (granted.includes(requiredCapability)) {
      try {
        daemon = await jarvis.daemon.status(DAEMON_ID, preferences.singBoxPath || undefined);
      } catch {
        daemon = null;
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
    return {
      granted,
      preferences,
      daemon,
      proxy,
      nodes,
      subscriptions: records,
      subscriptionCount,
      selection: effective,
      latency,
      control,
      failure: failed,
      phase: phaseOf({ granted, daemon, nodeCount: nodes.length, failure: failed }),
    };
  }

  /**
   * 发一个 Clash API 请求。
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
    return jarvis.daemon.request({
      id: DAEMON_ID,
      method,
      path,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      timeout,
    });
  }

  // MARK: 开与关

  /**
   * 开启：查装没装 → 有没有节点 → 生成配置 → 起内核 → 等它就绪 → 把模式与节点重新放回去 → 设系统代理。
   * @param context 事件里带来的授权与偏好。
   * @returns 结果。
   */
  async turnOn(context: { granted?: string[]; preferences?: Record<string, unknown> } = {}): Promise<ActionResult> {
    if (this.busy) return { ok: false, message: `${this.busy}，稍等` };
    const granted = context.granted ?? (await this.granted());
    if (!granted.includes(requiredCapability)) return { ok: false, message: "还没有授权「代理」在后台运行 sing-box" };
    const preferences = await this.preferences(context.preferences);
    this.setBusy("正在开启");
    try {
      const executable = preferences.singBoxPath || undefined;
      const status = await jarvis.daemon.status(DAEMON_ID, executable);
      if (status.state === "running") {
        const proxy = await this.applySystemProxy(granted, preferences.systemProxy, (await this.control())?.mixedPort ?? preferences.mixedPort);
        return { ok: true, message: proxy ?? "代理已经开着" };
      }
      if (status.executable === "") {
        return { ok: false, message: preferences.singBoxPath ? `设置里填的 sing-box 路径不可用：${preferences.singBoxPath}` : "没有找到 sing-box：先在「代理」里安装" };
      }
      let nodes = await this.nodes();
      if (nodes.length === 0 && granted.includes("network.https")) {
        // 填了订阅却还没拉过（刚装好、刚填完）：先拉一次再开，省得用户先点「更新订阅」再点「开启」。
        this.busy = null;
        await this.updateSubscriptions({ granted, restartIfChanged: false });
        this.setBusy("正在开启");
        nodes = await this.nodes();
      }
      if (nodes.length === 0) return { ok: false, message: "没有节点：在设置里填订阅地址，再更新订阅" };

      const selection = await this.selection();
      const secret = randomSecret();
      let chinaRules = preferences.chinaRules;
      let fallback = false;
      try {
        await this.startDaemon(nodes, preferences, selection, secret, chinaRules);
      } catch (error) {
        if (!(chinaRules && isRuleSetFailure(errorLines(error).join("\n")))) throw error;
        // 规则集第一次下载失败时 sing-box 拒绝启动；不分流再起一次——全部流量走节点，总比代理开不了强。
        chinaRules = false;
        fallback = true;
        await this.startDaemon(nodes, preferences, selection, secret, chinaRules);
      }
      await remove(storageKeys.failure);
      await this.applySelection(selection, nodes);
      const proxy = await this.applySystemProxy(granted, preferences.systemProxy, preferences.mixedPort);
      const parts = [`代理已开启 · 127.0.0.1:${preferences.mixedPort}`];
      if (fallback) parts.push("中国大陆规则集下载失败，这次不分流");
      if (proxy) parts.push(proxy);
      return { ok: true, message: parts.join("；") };
    } catch (error) {
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
   * 起内核并等它就绪。远程规则集在 sing-box 的启动阶段下载（`daemon.start` 只等 1 秒），所以「起来了」之后还要等 Clash API 开始答话；
   * 这期间进程退了，读它的输出当失败抛出——上层据此判断要不要不分流再试一次。
   */
  private async startDaemon(nodes: ProxyNode[], preferences: ProxyPreferences, selection: Selection, secret: string, chinaRules: boolean): Promise<void> {
    const config = buildConfig({
      nodes,
      mixedPort: preferences.mixedPort,
      controlPort: preferences.controlPort,
      controlSecret: secret,
      mode: selection.mode,
      testURL: preferences.testURL,
      selected: selection.node,
      chinaRules,
    });
    const control: ControlRecord = {
      secret,
      controlPort: preferences.controlPort,
      mixedPort: preferences.mixedPort,
      chinaRules,
      ruleSetFallback: preferences.chinaRules && !chinaRules,
      testURL: preferences.testURL,
      nodesDigest: nodesDigest(nodes),
      startedAt: Date.now(),
      starting: true,
    };
    // 先写 secret 再起：后台会话在内核起来的那一刻就可能要调控制口。
    await write(storageKeys.control, control);
    await jarvis.daemon.start({
      id: DAEMON_ID,
      config: JSON.stringify(config),
      controlPort: preferences.controlPort,
      ...(preferences.singBoxPath ? { executable: preferences.singBoxPath } : {}),
    });
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      const status = await jarvis.daemon.status(DAEMON_ID);
      if (status.state !== "running") {
        let lines: string[] = [];
        try {
          lines = (await jarvis.daemon.logs(DAEMON_ID)).slice(-20);
        } catch {
          lines = [];
        }
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
   * 把模式与「节点选择」放回用户选的样子。`cache.db` 记着上一次的模式与选中项，启动时以它为准，
   * 配置里的 `default_mode` / `default` 只管第一次——用户在内核停着的时候改过，不放回去就会被缓存盖掉。
   */
  private async applySelection(selection: Selection, nodes: ProxyNode[]): Promise<void> {
    try {
      await this.clash("PATCH", "/configs", { mode: clashModeNames[selection.mode] });
      const members = new Set([URLTEST_TAG, ...nodes.map((node) => node.name)]);
      await this.clash("PUT", proxyPath(SELECTOR_TAG), { name: members.has(selection.node) ? selection.node : URLTEST_TAG });
    } catch (error) {
      jarvis.log.warn("模式与节点没能放回去", errorMessage(error));
    }
  }

  /**
   * 按偏好设系统代理。
   * @returns 要告诉用户的一句话（被拦着、别人接管着、没授权）；一切正常为 `null`。
   */
  private async applySystemProxy(granted: string[], wanted: boolean, port: number): Promise<string | null> {
    if (!wanted) return null;
    if (!granted.includes("system.proxy")) return "没有授权修改系统代理，只在本机端口上可用";
    try {
      const status = await jarvis.systemProxy.enable({ port });
      return status.blocker ? status.blocker.message : null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  /**
   * 关闭：先还原系统代理，再停内核（反过来的话中间那一下系统代理指着一个没人监听的端口）。
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
   * 换一份配置重开（订阅更新过、端口改过）。
   * @returns 结果。
   */
  async restart(): Promise<ActionResult> {
    const off = await this.turnOff();
    if (!off.ok) return off;
    return this.turnOn();
  }

  // MARK: 模式、节点、系统代理

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
      const status = await jarvis.systemProxy.enable({ port });
      return status.blocker ? { ok: false, message: status.blocker.message } : { ok: true, message: `系统代理指向 127.0.0.1:${port}` };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  /** 内核此刻在不在跑。 */
  async isRunning(): Promise<boolean> {
    try {
      return (await jarvis.daemon.status(DAEMON_ID)).state === "running";
    } catch {
      return false;
    }
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

  /** 内核最近 500 行输出。 */
  async logs(): Promise<string[]> {
    try {
      return await jarvis.daemon.logs(DAEMON_ID);
    } catch {
      return [];
    }
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

  // MARK: 订阅

  /**
   * 拉一遍偏好里的全部订阅。每条各自成败：失败的那条留着上一次的节点，只记下原因。
   * 内核开着、节点又真的变了，就重开一次让新节点生效（sing-box 不支持热加载出站）。
   * @param options 授权（省略时现问）与要不要重开。
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
          const restarted = await this.restart();
          summary = { ok: restarted.ok, message: `${summary.message}；${restarted.ok ? "已重新开启以用上新节点" : restarted.message}` };
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
